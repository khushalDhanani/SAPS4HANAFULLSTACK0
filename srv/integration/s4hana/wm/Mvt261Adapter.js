'use strict';

const LOG = require('../logger')('mvt261-adapter');
const { S4HttpClient } = require('../S4HttpClient');
const { formatDateToYMD } = require('../../../common/dateUtils');
const { RfcClient } = require('../RfcClient');
const { parseSapNumber } = require('../sapFacts');
const { buildBaseItem, buildHeaderEnvelope } = require('./goods-issue/s4common');

/**
 * Read-only finder for the FIRST goods movement of movement type 261 (GET only, no ABAP change).
 *  - MMIM_MATDOC_OV_SRV/F_Mmim_Findmatdoc (SAP "Material Documents Overview"): MATDOC items with
 *    posting date, entry timestamp, order, XAUTO and the cancelled flag; SAP filters, sorts and counts.
 *    Live: every item is returned once per StockChangeType/Context, so the query pins
 *    StockChangeType '05' (9,940 rows = A_MaterialDocumentItem count for 261; 71 cancelled = 71 x 262).
 *  - API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem: the reversing 262 (SMBLN/SJAHR/SMBLP) of the
 *    rows shown, as evidence only.
 * SAP applies the plant / movement type authorizations of the calling user in both services.
 */
const FIND_PATH = '/sap/opu/odata/sap/MMIM_MATDOC_OV_SRV/F_Mmim_Findmatdoc';
const ITEM_PATH = '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem';
const MATDOC_API = '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV';
const TOP = 5;

/**
 * Open 261 reservation items = RESB with XLOEK and KZEAR blank. Live: RESB 467 rows = this entity 467
 * rows, 0 key or quantity differences; 393 of them still have quantity to issue (BDMNG > ENMNG).
 */
const RESV_PATH = '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem';
const RESV_SELECT = [
  'Reservation', 'ReservationItem', 'RecordType', 'OrderID', 'OrderDescription', 'Product', 'ProductName', 'Plant',
  'StorageLocation', 'MatlCompRequirementDate', 'ResvnItmRequiredQtyInBaseUnit', 'ResvnItmWithdrawnQtyInBaseUnit',
  'BaseUnit', 'GoodsMovementIsAllowed'
].join(',');
const PAGE = 1000;
const MAX_OPEN_ITEMS = 5000;

const KEY = 'MaterialDocument asc,MaterialDocumentYear asc,MaterialDocumentItem asc';
/** $orderby per definition of "first", with the SAP table fields it stands for. */
const DEFINITIONS = {
  A: { orderby: `PostingDate asc,CreationDateTime asc,${KEY}`, sortKey: 'BUDAT, CPUDT, CPUTM, MBLNR, MJAHR, ZEILE' },
  B: { orderby: `CreationDateTime asc,${KEY}`, sortKey: 'CPUDT, CPUTM, MBLNR, MJAHR, ZEILE' },
  C: { orderby: 'MaterialDocumentYear asc,MaterialDocument asc,MaterialDocumentItem asc', sortKey: 'MJAHR, MBLNR, ZEILE' }
};

const SELECT = [
  'MaterialDocument', 'MaterialDocumentYear', 'MaterialDocumentItem', 'PostingDate', 'CreationDateTime',
  'Material', 'MaterialName', 'Plant', 'StorageLocation', 'OrderID', 'QuantityInEntryUnit', 'EntryUnit',
  'IsAutomaticallyCreated', 'IsCancelled', 'CreatedByUser'
].join(',');

const RE = {
  plant: /^[A-Z0-9]{1,4}$/,
  material: /^[A-Z0-9][A-Z0-9_./-]{0,39}$/,
  order: /^\d{1,12}$/,
  date: /^\d{4}-\d{2}-\d{2}$/
};

/**
 * Order system statuses the cycle evaluates (JEST-STAT; texts verified live in TJ02T):
 * I0001 CRTD, I0002 REL, I0043 LKD, I0045 TECO, I0046 CLSD, I0076 DLFL.
 */
const ORDER_STATUS = { I0001: 'CRTD', I0002: 'REL', I0043: 'LKD', I0045: 'TECO', I0046: 'CLSD', I0076: 'DLFL' };
const ORDER_BLOCKERS = { LKD: 'order is locked', TECO: 'order is technically completed', CLSD: 'order is closed', DLFL: 'order has the deletion flag' };

const strip = (v) => String(v || '').replace(/^0+(?=.)/, '');
const sapDate = (v) => (/^\d{8}$/.test(v || '') && v !== '00000000' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Trust-boundary check: values go into an OData $filter, so only the listed characters pass. */
function clean(value, label, re, mandatory) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s && !mandatory) return '';
  if (!re.test(s)) throw httpError(400, `${label} is missing or invalid`);
  return s;
}

const isoInstant = (v) => {
  const m = /\/Date\((-?\d+)/.exec(v || '');
  return m ? new Date(Number(m[1])).toISOString() : null;
};

class Mvt261Adapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.rfc = options.rfc || new RfcClient();
  }

  async _results(path, params, context) {
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    try {
      const { data } = await this.client.get(path, { query });
      return data?.d || {};
    } catch (e) {
      LOG.error(`${context}: ${e.message}`);
      throw httpError(e.status || 502, `${context}: ${e.message}`);
    }
  }

  async _table(table, fields, where, context) {
    try {
      return await this.rfc.readTable(table, fields, where);
    } catch (e) {
      LOG.error(`${context}: ${e.message}`);
      throw httpError(e.status || 502, `${context}: ${e.message}`);
    }
  }

  /** Active system statuses (short texts, e.g. "REL LKD") per order number, from JEST. */
  async _orderStatuses(orders) {
    const out = {};
    const list = [...new Set(orders.filter(Boolean).map((o) => strip(o).padStart(12, '0')))];
    for (let i = 0; i < list.length; i += 40) {
      const or = list.slice(i, i + 40).map((o, n) => `${n ? 'OR ' : '( '}OBJNR = 'OR${o}'`);
      const rows = await this._table('JEST', ['OBJNR', 'STAT'], ["INACT = ''", 'AND', ...or, ')'], 'Read order statuses');
      for (const r of rows) {
        const key = strip(r.OBJNR.slice(2));
        if (ORDER_STATUS[r.STAT]) (out[key] = out[key] || []).push(ORDER_STATUS[r.STAT]);
      }
    }
    return out;
  }

  /** "doc/year/item" of the 262 that reverses each cancelled row; {} when SAP does not answer. */
  async _reversedBy(rows) {
    const docs = [...new Set(rows.filter((r) => r.IsCancelled).map((r) => `${r.MaterialDocument}/${r.MaterialDocumentYear}`))];
    if (!docs.length) return {};
    const pairs = docs.map((d) => d.split('/')).map(([doc, year]) => `(ReversedMaterialDocument eq '${doc}' and ReversedMaterialDocumentYear eq '${year}')`);
    try {
      const d = await this._results(ITEM_PATH, {
        $filter: `GoodsMovementType eq '262' and (${pairs.join(' or ')})`,
        $select: 'MaterialDocument,MaterialDocumentYear,MaterialDocumentItem,ReversedMaterialDocument,ReversedMaterialDocumentYear,ReversedMaterialDocumentItem',
        $format: 'json'
      }, 'Read reversal documents');
      return Object.fromEntries((d.results || []).map((r) => [
        `${r.ReversedMaterialDocument}/${r.ReversedMaterialDocumentYear}/${Number(r.ReversedMaterialDocumentItem)}`,
        `${r.MaterialDocument}/${r.MaterialDocumentYear}/${String(r.MaterialDocumentItem).padStart(4, '0')}`
      ]));
    } catch (_e) {
      return {}; // evidence only: IsReversed still comes from SAP's cancelled flag
    }
  }

  /**
   * All open movement type 261 reservation items, earliest requirement first.
   * ponytail: SAP cannot compare required with withdrawn quantity in $filter, so the open-quantity rule
   * runs here over at most MAX_OPEN_ITEMS rows (Truncated says when that cut applies); push it into a
   * CDS view if the open list ever grows past that.
   */
  async openItems(input = {}) {
    const plant = clean(input.plant, 'Plant', RE.plant);
    const material = clean(input.material, 'Material', RE.material);
    const order = clean(input.productionOrder, 'Production Order', RE.order);
    const reservation = clean(input.reservation, 'Reservation', /^\d{1,10}$/);
    const from = clean(input.dateFrom, 'Requirement date from', RE.date);
    const to = clean(input.dateTo, 'Requirement date to', RE.date);
    if ((from || to) && (!from || !to || from > to)) throw httpError(400, 'Requirement date range needs a valid from and to date');

    const filter = ["GoodsMovementType eq '261'", 'ReservationItemIsFinallyIssued eq false', 'ReservationItmIsMarkedForDeltn eq false'];
    if (plant) filter.push(`Plant eq '${plant}'`);
    if (material) filter.push(`Product eq '${material}'`);
    if (order) filter.push(`OrderID eq '${order}'`);
    if (reservation) filter.push(`Reservation eq '${reservation}'`);
    if (from) filter.push(`MatlCompRequirementDate ge datetime'${from}T00:00:00'`, `MatlCompRequirementDate le datetime'${to}T00:00:00'`);

    const rows = [];
    let sapCount = 0;
    do {
      const d = await this._results(RESV_PATH, {
        $filter: filter.join(' and '),
        $orderby: 'MatlCompRequirementDate asc,Reservation asc,ReservationItem asc',
        $top: PAGE,
        $skip: rows.length,
        $inlinecount: 'allpages',
        $select: RESV_SELECT,
        $format: 'json'
      }, 'Read open movement type 261 reservation items');
      sapCount = Number(d.__count || 0);
      if (!(d.results || []).length) break;
      rows.push(...d.results);
    } while (rows.length < sapCount && rows.length < MAX_OPEN_ITEMS);

    const Items = rows.map((r) => {
      const required = Number(r.ResvnItmRequiredQtyInBaseUnit) || 0;
      const withdrawn = Number(r.ResvnItmWithdrawnQtyInBaseUnit) || 0;
      return {
        Reservation: r.Reservation,
        ReservationItem: r.ReservationItem,
        RecordType: r.RecordType || '',
        ProductionOrder: r.OrderID || '',
        OrderDescription: r.OrderDescription || '',
        Material: r.Product || '',
        MaterialName: r.ProductName || '',
        Plant: r.Plant || '',
        StorageLocation: r.StorageLocation || '',
        RequirementDate: formatDateToYMD(r.MatlCompRequirementDate),
        RequiredQuantity: required,
        WithdrawnQuantity: withdrawn,
        OpenQuantity: Math.max(0, required - withdrawn),
        Unit: r.BaseUnit || '',
        MovementAllowed: !!r.GoodsMovementIsAllowed
      };
    }).filter((i) => input.includeFullyWithdrawn || i.OpenQuantity > 0);

    // Order status is an extra column: the list stays usable when RFC is not available.
    try {
      const statuses = await this._orderStatuses(Items.map((i) => i.ProductionOrder));
      Items.forEach((i) => { i.OrderStatus = (statuses[strip(i.ProductionOrder)] || []).sort().join(' '); });
    } catch (e) {
      LOG.warn(`Order statuses not read: ${e.message}`);
      Items.forEach((i) => { i.OrderStatus = ''; });
    }

    return { TotalCount: Items.length, SapOpenCount: sapCount, Truncated: rows.length < sapCount, Items };
  }

  /**
   * Read-only 261 cycle of one reservation item: reservation, order, stock, WM staging, document
   * history and closure, each with a status (done / open / blocked) and the reason.
   * Tables: RESB, AUFK, JEST, MARD, MCHB, T320, LQUA, LTBK, LTBP, LTAK, LTAP, MATDOC (all read live over RFC).
   * ponytail: one RFC connection per table read (about a dozen); pool them if the page feels slow.
   */
  async cycle(input = {}) {
    const rsnum = clean(input.reservation, 'Reservation', /^\d{1,10}$/, true).padStart(10, '0');
    const rspos = clean(input.item, 'Reservation item', /^\d{1,4}$/, true).padStart(4, '0');
    const read = (table, fields, where) => this._table(table, fields, where, `Read ${table} for reservation ${strip(rsnum)}/${strip(rspos)}`);

    const [resb] = await read('RESB',
      ['RSNUM', 'RSPOS', 'AUFNR', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDTER', 'BDMNG', 'ENMNG', 'MEINS', 'XLOEK', 'KZEAR', 'XWAOK'],
      [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`, "AND BWART = '261'"]);
    if (!resb) throw httpError(404, `Reservation ${strip(rsnum)} item ${strip(rspos)} with movement type 261 not found`);

    const required = parseSapNumber(resb.BDMNG);
    const withdrawn = parseSapNumber(resb.ENMNG);
    const open = Math.max(0, required - withdrawn);
    const matWhere = [`MATNR = '${resb.MATNR}'`, `AND WERKS = '${resb.WERKS}'`].concat(resb.LGORT ? [`AND LGORT = '${resb.LGORT}'`] : []);

    const [aufk] = resb.AUFNR ? await read('AUFK', ['AUFNR', 'AUART', 'LOEKZ'], [`AUFNR = '${resb.AUFNR}'`]) : [];
    const statuses = resb.AUFNR ? ((await this._orderStatuses([resb.AUFNR]))[strip(resb.AUFNR)] || []).sort() : [];
    const mard = await read('MARD', ['LGORT', 'LABST'], matWhere);
    const mchb = await read('MCHB', ['LGORT', 'CHARG', 'CLABS'], [...matWhere, 'AND CLABS > 0']);
    const t320 = resb.LGORT ? await read('T320', ['LGNUM'], [`WERKS = '${resb.WERKS}'`, `AND LGORT = '${resb.LGORT}'`]) : [];
    const lqua = await read('LQUA', ['LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'CHARG', 'VERME', 'LENUM'], [...matWhere, 'AND VERME > 0']);
    const ltbk = await read('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'STATU'], [`RSNUM = '${rsnum}'`]);
    const TransferRequirements = [];
    const TransferOrders = [];
    for (const tr of ltbk) {
      const key = [`LGNUM = '${tr.LGNUM}'`, `AND TBNUM = '${tr.TBNUM}'`];
      const items = await read('LTBP', ['TBPOS', 'MENGE', 'TAMEN', 'ELIKZ'], [...key, `AND MATNR = '${resb.MATNR}'`]);
      for (const it of items) {
        TransferRequirements.push({
          Warehouse: tr.LGNUM, TransferRequirement: strip(tr.TBNUM), Item: strip(it.TBPOS), MovementType: tr.BWLVS,
          Quantity: parseSapNumber(it.MENGE), TransferOrderQuantity: parseSapNumber(it.TAMEN), Completed: tr.STATU === 'E' || it.ELIKZ === 'X'
        });
      }
      if (!items.length) continue; // transfer requirement is for other materials of the reservation
      for (const to of await read('LTAK', ['TANUM', 'BWLVS'], key)) {
        const lines = await read('LTAP', ['TAPOS', 'PQUIT'], [`LGNUM = '${tr.LGNUM}'`, `AND TANUM = '${to.TANUM}'`, `AND MATNR = '${resb.MATNR}'`]);
        if (!lines.length) continue;
        TransferOrders.push({
          Warehouse: tr.LGNUM, TransferOrder: strip(to.TANUM), TransferRequirement: strip(tr.TBNUM), MovementType: to.BWLVS,
          Confirmed: lines.every((l) => l.PQUIT === 'X')
        });
      }
    }
    const docs = await read('MATDOC',
      ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'BUDAT', 'MENGE', 'MEINS', 'CHARG', 'LGORT', 'SMBLN', 'SJAHR', 'SMBLP', 'CANCELLED', 'USNAM'],
      [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`, "AND RECORD_TYPE = 'MDOC'", "AND ( BWART = '261' OR BWART = '262' )"]);

    const stockAtLocation = mard.reduce((sum, r) => sum + parseSapNumber(r.LABST), 0);
    const History = docs.map((d) => ({
      MaterialDocument: d.MBLNR, MaterialDocumentYear: d.MJAHR, MaterialDocumentItem: d.ZEILE, MovementType: d.BWART,
      PostingDate: sapDate(d.BUDAT), Quantity: parseSapNumber(d.MENGE), Unit: d.MEINS, Batch: d.CHARG, StorageLocation: d.LGORT,
      Reverses: d.SMBLN ? `${d.SMBLN}/${d.SJAHR}/${d.SMBLP}` : '', IsReversed: d.CANCELLED === 'X', CreatedByUser: d.USNAM
    })).sort((a, b) => `${a.MaterialDocumentYear}${a.MaterialDocument}${a.MaterialDocumentItem}`.localeCompare(`${b.MaterialDocumentYear}${b.MaterialDocument}${b.MaterialDocumentItem}`));
    const effective261 = History.filter((h) => h.MovementType === '261' && !h.IsReversed);

    // Steps: a blocked step carries the reason; nothing here posts or changes data.
    const orderBlockers = statuses.filter((st) => ORDER_BLOCKERS[st]).map((st) => ORDER_BLOCKERS[st]);
    if (aufk && aufk.LOEKZ === 'X' && !statuses.includes('DLFL')) orderBlockers.push(ORDER_BLOCKERS.DLFL);
    if (aufk && !statuses.includes('REL')) orderBlockers.unshift('order is not released');
    const resvBlockers = [resb.XLOEK === 'X' && 'item is deleted', resb.KZEAR === 'X' && 'final issue is set', resb.XWAOK !== 'X' && 'goods movement is not allowed for the item'].filter(Boolean);
    const step = (Step, Status, Reason = '') => ({ Step, Status, Reason });
    const blockedBefore = [...resvBlockers, ...orderBlockers];
    const openTr = TransferRequirements.filter((t) => !t.Completed);
    const openTo = TransferOrders.filter((t) => !t.Confirmed);
    const Steps = [
      step('Reservation', resvBlockers.length ? 'blocked' : 'done', resvBlockers.join('; ')),
      step('ProductionOrder', !aufk ? 'blocked' : orderBlockers.length ? 'blocked' : 'done', !aufk ? 'no order on the reservation item' : orderBlockers.join('; ')),
      step('Availability', open === 0 ? 'done' : stockAtLocation >= open ? 'done' : 'blocked',
        open > 0 && stockAtLocation < open ? `unrestricted stock ${stockAtLocation} ${resb.MEINS} is less than the open quantity ${open} ${resb.MEINS}` : ''),
      step('WmStaging', openTr.length || openTo.length ? 'open' : 'done',
        !t320.length && !ltbk.length ? 'storage location is not WM-managed and no transfer requirement exists'
          : openTr.length ? `${openTr.length} transfer requirement item(s) not completed`
            : openTo.length ? `${openTo.length} transfer order(s) not confirmed` : ''),
      step('GoodsIssue', open === 0 ? 'done' : blockedBefore.length ? 'blocked' : 'open', open > 0 ? blockedBefore.join('; ') : ''),
      step('DocumentHistory', History.length ? 'done' : 'open', History.length ? '' : 'no 261 or 262 document yet'),
      step('Reversal', effective261.length ? 'open' : 'done', effective261.length ? `${effective261.length} document(s) of movement type 261 can be reversed` : ''),
      step('Closure', open === 0 || resvBlockers.length ? 'done' : 'open', open === 0 ? '' : resvBlockers.length ? resvBlockers.join('; ') : `${open} ${resb.MEINS} still open`)
    ];

    return {
      Reservation: strip(resb.RSNUM), ReservationItem: strip(resb.RSPOS), ProductionOrder: strip(resb.AUFNR), OrderType: aufk ? aufk.AUART : '',
      OrderStatus: statuses.join(' '), Material: strip(resb.MATNR), Plant: resb.WERKS, StorageLocation: resb.LGORT, Batch: resb.CHARG,
      RequirementDate: sapDate(resb.BDTER), RequiredQuantity: required, WithdrawnQuantity: withdrawn, OpenQuantity: open, Unit: resb.MEINS,
      IsDeleted: resb.XLOEK === 'X', IsFinalIssue: resb.KZEAR === 'X', MovementAllowed: resb.XWAOK === 'X',
      Warehouse: t320[0] ? t320[0].LGNUM : '',
      Steps,
      Stock: [
        ...mard.map((r) => ({ StorageLocation: r.LGORT, Batch: '', Quantity: parseSapNumber(r.LABST) })),
        ...mchb.map((r) => ({ StorageLocation: r.LGORT, Batch: r.CHARG, Quantity: parseSapNumber(r.CLABS) }))
      ],
      Quants: lqua.map((q) => ({ Warehouse: q.LGNUM, StorageType: q.LGTYP, StorageBin: q.LGPLA, StorageLocation: q.LGORT, Batch: q.CHARG, AvailableQuantity: parseSapNumber(q.VERME), StorageUnit: strip(q.LENUM) })),
      TransferRequirements, TransferOrders, History
    };
  }

  async _post(path, data, context) {
    try {
      const res = await this.client.post(path, { data, csrfPath: `${MATDOC_API}/` });
      return { body: res.data?.d || res.data || {}, sapMessage: res.headers?.['sap-message'] || '' };
    } catch (e) {
      LOG.error(`${context}: ${e.message}`);
      throw httpError(e.status || 502, `${context}: ${e.message}`);
    }
  }

  /**
   * Post one goods issue 261 against a reservation item (API_MATERIAL_DOCUMENT_SRV deep insert,
   * goods movement code 03, referencing reservation, item and order). Reservation, order status and
   * stock are re-read immediately before; anything not postable is refused with 422 and no SAP call.
   * A response without a material document (e.g. SAP created a delivery instead) is an error.
   * ponytail: no idempotency key and no retry here - one call is one posting. Add an attempt store
   * (as GoodsIssueAttemptStore does for 201) before this is wired to a button.
   */
  async postGoodsIssue(input = {}) {
    const quantity = Number(input.quantity);
    const batch = clean(input.batch, 'Batch', /^[A-Z0-9]{1,10}$/);
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');

    const c = await this.cycle(input);
    const gi = c.Steps.find((st) => st.Step === 'GoodsIssue');
    if (gi.Status !== 'open') throw httpError(422, `Goods issue not possible: ${gi.Reason || 'nothing left to issue'}`);
    if (quantity > c.OpenQuantity) throw httpError(422, `Quantity ${quantity} exceeds the open quantity ${c.OpenQuantity} ${c.Unit}`);
    if (!c.StorageLocation) throw httpError(422, 'Goods issue not possible: the reservation item has no storage location');
    const batches = c.Stock.filter((st) => st.Batch);
    if (batches.length && !batch) throw httpError(422, 'Goods issue not possible: the material has batch stock, a batch is required');
    const stock = (batch ? batches.filter((st) => st.Batch === batch) : c.Stock.filter((st) => !st.Batch)).reduce((sum, st) => sum + st.Quantity, 0);
    if (stock < quantity) throw httpError(422, `Goods issue not possible: unrestricted stock ${stock} ${c.Unit} is less than ${quantity} ${c.Unit}`);

    // Entry unit in external format, from the same service the list reads.
    const d = await this._results(RESV_PATH, {
      $filter: `Reservation eq '${c.Reservation}' and ReservationItem eq '${c.ReservationItem}' and GoodsMovementType eq '261'`,
      $select: 'Reservation,ReservationItem,BaseUnit',
      $format: 'json'
    }, 'Read reservation item unit');
    const unit = d.results?.[0]?.BaseUnit;
    if (!unit) throw httpError(422, 'Goods issue not possible: unit of the reservation item could not be read');

    const payload = buildHeaderEnvelope({
      gmCode: '03',
      headerText: `GI Resv ${c.Reservation}`,
      item: buildBaseItem({
        Material: c.Material, Unit: unit, IssueQty: quantity, Plant: c.Plant, StorageLocation: c.StorageLocation,
        ReservationNo: c.Reservation, ReservationItem: c.ReservationItem, Batch: batch, OrderNo: c.ProductionOrder
      }, '261')
    });
    const { body, sapMessage } = await this._post(`${MATDOC_API}/A_MaterialDocumentHeader`, payload, `Post goods issue 261 for reservation ${c.Reservation}/${c.ReservationItem}`);
    if (!body.MaterialDocument) throw httpError(502, `SAP did not return a material document for the goods issue. sap-message: ${sapMessage || '(none)'}`);
    return { MaterialDocument: body.MaterialDocument, MaterialDocumentYear: body.MaterialDocumentYear, SapMessage: sapMessage };
  }

  /** Reverse one material document with the API's own Cancel action (SAP writes the 262 and SMBLN). */
  async reverse(input = {}) {
    const doc = clean(input.materialDocument, 'Material document', /^\d{10}$/, true);
    const year = clean(input.materialDocumentYear, 'Material document year', /^\d{4}$/, true);
    const { body, sapMessage } = await this._post(`${MATDOC_API}/Cancel?MaterialDocument='${doc}'&MaterialDocumentYear='${year}'`, {}, `Reverse material document ${doc}/${year}`);
    const rev = body.Cancel || body;
    if (!rev.MaterialDocument) throw httpError(502, `SAP did not return a reversal document. sap-message: ${sapMessage || '(none)'}`);
    return { MaterialDocument: rev.MaterialDocument, MaterialDocumentYear: rev.MaterialDocumentYear, SapMessage: sapMessage };
  }

  async findFirst(input = {}) {
    const plant = clean(input.plant, 'Plant', RE.plant, true);
    const material = clean(input.material, 'Material', RE.material);
    const order = clean(input.productionOrder, 'Production Order', RE.order);
    const from = clean(input.dateFrom, 'Posting date from', RE.date);
    const to = clean(input.dateTo, 'Posting date to', RE.date);
    const definition = clean(input.definition || 'A', 'Definition', /^[ABC]$/, true);
    if ((from || to) && (!from || !to || from > to)) throw httpError(400, 'Posting date range needs a valid from and to date');

    const filter = ["GoodsMovementType eq '261'", "StockChangeType eq '05'", `Plant eq '${plant}'`];
    if (material) filter.push(`Material eq '${material}'`);
    if (order) filter.push(`OrderID eq '${order}'`);
    if (from) filter.push(`PostingDate ge datetime'${from}T00:00:00'`, `PostingDate le datetime'${to}T00:00:00'`);
    if (input.excludeReversed) filter.push('IsCancelled eq false');
    if (input.manualOnly) filter.push("IsAutomaticallyCreated eq ''");

    const { orderby, sortKey } = DEFINITIONS[definition];
    const d = await this._results(FIND_PATH, {
      $filter: filter.join(' and '),
      $orderby: orderby,
      $top: TOP,
      $inlinecount: 'allpages',
      $select: SELECT,
      $format: 'json'
    }, 'Read movement type 261 documents');

    const rows = d.results || [];
    const reversedBy = await this._reversedBy(rows);
    const Top = rows.map((r, i) => ({
      Rank: i + 1,
      MaterialDocument: r.MaterialDocument,
      MaterialDocumentYear: r.MaterialDocumentYear,
      MaterialDocumentItem: r.MaterialDocumentItem,
      PostingDate: formatDateToYMD(r.PostingDate),
      EntryTimestamp: isoInstant(r.CreationDateTime),
      Material: r.Material,
      MaterialName: r.MaterialName || '',
      Plant: r.Plant,
      StorageLocation: r.StorageLocation || '',
      ProductionOrder: r.OrderID || '',
      Quantity: Number(r.QuantityInEntryUnit),
      Unit: r.EntryUnit || '',
      IsAutomaticallyCreated: !!r.IsAutomaticallyCreated,
      IsReversed: !!r.IsCancelled,
      ReversedBy: reversedBy[`${r.MaterialDocument}/${r.MaterialDocumentYear}/${Number(r.MaterialDocumentItem)}`] || '',
      CreatedByUser: r.CreatedByUser || ''
    }));

    return { Definition: definition, SortKey: sortKey, TotalCount: Number(d.__count || 0), Top };
  }
}

module.exports = Mvt261Adapter;
