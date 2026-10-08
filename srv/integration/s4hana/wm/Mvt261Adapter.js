'use strict';

const LOG = require('../logger')('mvt261-adapter');
const { S4HttpClient } = require('../S4HttpClient');
const { formatDateToYMD } = require('../../../common/dateUtils');
const { RfcClient } = require('../RfcClient');
const s4Config = require('../s4Config');
const { parseSapNumber } = require('../sapFacts');
const { buildBaseItem, buildHeaderEnvelope } = require('./goods-issue/s4common');
const GoodsIssuePostingClient = require('./goods-issue/GoodsIssuePostingClient');

/**
 * Read-only finder for the FIRST goods movement of movement type 261 (GET only, no ABAP change).
 *  - MMIM_MATDOC_OV_SRV/F_Mmim_Findmatdoc (SAP "Material Documents Overview"): MATDOC items with
 *    posting date, entry timestamp, order, XAUTO and the cancelled flag; SAP filters, sorts and counts.
 *    Live: every item is returned once per StockChangeType/Context, so the query pins
 *    StockChangeType '05' (9,940 rows = A_MaterialDocumentItem count for 261; 71 cancelled = 71 x 262).
 *  - API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem: the reversing 262 (SMBLN/SJAHR/SMBLP) of the
 *    rows shown, as evidence only.
 * Authorization: the OData reads above enforce the end user's plant / movement-type authorizations
 * only when the S/4 destination uses principal propagation. The RFC_READ_TABLE path used by the
 * cycle / scan / open-list reads runs under the fixed technical user (S4_USERNAME in RfcClient), so
 * it does NOT apply per-end-user plant authorization - the app role (service.cds @requires) is the
 * gate there. See AUDIT_261.md F10.
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

/** Why a reservation item / its order cannot take a goods issue; shared by the cycle and the scan checks. */
function blockers(resb, aufk, statuses, configuredWarehouse) {
  const orderBlockers = statuses.filter((st) => ORDER_BLOCKERS[st]).map((st) => ORDER_BLOCKERS[st]);
  if (aufk && aufk.LOEKZ === 'X' && !statuses.includes('DLFL')) orderBlockers.push(ORDER_BLOCKERS.DLFL);
  if (aufk && !statuses.includes('REL')) orderBlockers.unshift('order is not released');
  const resvBlockers = [
    resb.XLOEK === 'X' && 'item is deleted',
    resb.KZEAR === 'X' && 'final issue is set',
    resb.XWAOK !== 'X' && 'goods movement is not allowed for the item',
    // F5: a backflushed component is issued automatically at order confirmation (CO11N); a manual 261
    // here would consume it a second time, so it is blocked outright.
    isBackflush(resb.RGEKZ) && 'component is backflushed at order confirmation (CO11N); it is issued automatically there - do not issue it here, ask your supervisor if a manual issue is genuinely required'
  ].filter(Boolean);
  if (resb.LGNUM && configuredWarehouse !== undefined) {
    if (configuredWarehouse && resb.LGNUM !== configuredWarehouse) {
      resvBlockers.push(`transmitted warehouse number is ${resb.LGNUM}; determined warehouse number is ${configuredWarehouse}`);
    } else if (!configuredWarehouse) {
      resvBlockers.push(`transmitted warehouse number is ${resb.LGNUM}; storage location is not warehouse-managed`);
    }
  }
  return { resvBlockers, orderBlockers };
}

/** LQUA block flags checked on a scanned storage unit (R3), in SAP field names. */
const QUANT_BLOCK_FLAGS = ['SKZUA', 'SKZUE', 'SKZSA', 'SKZSE', 'SKZSI', 'SPGRU'];

const strip = (v) => String(v || '').replace(/^0+(?=.)/, '');
const sapDate = (v) => (/^\d{8}$/.test(v || '') && v !== '00000000' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);
const round = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
/** RESB-RGEKZ (backflush indicator): blank / '0' = no backflush; anything else = backflushed at order confirmation. */
const isBackflush = (v) => { const s = String(v || '').trim(); return s !== '' && s !== '0'; };

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
    // Storage type / bin combinations whose stock is not ready to issue (R4). Configuration, not SAP data:
    // cds.env.s4.mvt261NotReadyBins = [{ storageType, bin, reason }]. Empty list = rule switched off.
    this.notReadyBins = options.notReadyBins || s4Config._getRaw('mvt261NotReadyBins') || [];
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

  /**
   * Server-side plant authorization (F10). allowedPlants comes from plantScope(req.user):
   *   undefined -> not scoped (direct/internal calls, tests); null -> Admin / all plants; [] -> none;
   *   [..] -> exactly those. Throws 403 (not an empty result) when the plant is out of scope.
   */
  _scopeGuard(plant, allowedPlants) {
    if (allowedPlants === undefined || allowedPlants === null) return;
    const p = String(plant || '').trim().toUpperCase();
    if (!allowedPlants.includes(p)) throw httpError(403, `Not authorized for plant ${p || '(none)'}`);
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
   * All open movement type 261 reservation items, latest requirement first (DESC).
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

    // F10: a user restricted to certain plants sees only those; a specific plant outside the scope is a
    // 403 (never a silently empty list), and a user with no plant scope at all is a 403.
    const allowed = input.allowedPlants;
    if (Array.isArray(allowed)) {
      if (plant && !allowed.includes(plant)) throw httpError(403, `Not authorized for plant ${plant}`);
      if (!allowed.length) throw httpError(403, 'Not authorized for any plant');
    }

    const filter = ["GoodsMovementType eq '261'", 'ReservationItemIsFinallyIssued eq false', 'ReservationItmIsMarkedForDeltn eq false'];
    if (plant) filter.push(`Plant eq '${plant}'`);
    else if (Array.isArray(allowed) && allowed.length) filter.push(`(${allowed.map((p) => `Plant eq '${p}'`).join(' or ')})`);
    if (material) filter.push(`Product eq '${material}'`);
    if (order) filter.push(`OrderID eq '${order}'`);
    if (reservation) filter.push(`Reservation eq '${reservation}'`);
    if (from) filter.push(`MatlCompRequirementDate ge datetime'${from}T00:00:00'`, `MatlCompRequirementDate le datetime'${to}T00:00:00'`);

    const rows = [];
    let sapCount = 0;
    do {
      const d = await this._results(RESV_PATH, {
        $filter: filter.join(' and '),
        $orderby: 'MatlCompRequirementDate desc,Reservation desc,ReservationItem desc',
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

    // Order status and scan readiness are extra columns: the plain list stays usable when RFC is not
    // available, but "scan possible only" cannot be answered without them and then fails loudly.
    // Readiness per reservation is the same _issuable rule the scan page and the posting gate use
    // (per issue location / warehouse), not a plant-wide storage-unit count.
    try {
      const statuses = await this._orderStatuses(Items.map((i) => i.ProductionOrder));
      const warehouses = await this._warehouses(Items);
      const facts = await this._reservationFacts(Items);
      const supplyLocs = await this._supplyAreaLocations(Items, facts);
      const quantsByMat = await this._plantQuants(Items);
      const stockByMat = await this._nonWmStock(Items, facts, warehouses);
      Items.forEach((i) => {
        const st = (statuses[strip(i.ProductionOrder)] || []).sort();
        const warehouse = warehouses[`${i.Plant}|${i.StorageLocation}`] || '';
        const f = facts[`${strip(i.Reservation)}|${strip(i.ReservationItem)}`];
        const supplySloc = f && f.PRVBE ? (supplyLocs[`${i.Plant}|${f.PRVBE}`] || '') : '';
        const quants = quantsByMat[`${strip(i.Material)}|${i.Plant}`] || [];
        const locationStock = stockByMat[`${strip(i.Material)}|${i.Plant}`] || [];
        const issuable = this._issuable(
          { warehouse, storageLocation: i.StorageLocation, supplyAreaStorageLocation: supplySloc, batch: f ? f.CHARG : '', openQty: i.OpenQuantity, unit: i.Unit },
          quants, locationStock);
        // Interim staging (WM-PP), suppressed on a warehouse mismatch exactly as the cycle does.
        let stagingShort = '';
        if (f && f.LGTYP) {
          const bin = f.LGPLA || (f.AUFNR ? strip(f.AUFNR).padStart(10, '0') : '');
          const whMismatch = Boolean(f.LGNUM) && (warehouse ? f.LGNUM !== warehouse : true);
          const s = this._stagingCore({ storageType: f.LGTYP, bin, warehouse: warehouse || f.LGNUM || '', batch: f.CHARG, openQty: i.OpenQuantity, unit: i.Unit }, quants);
          if (s.shortfall > 0 && !whMismatch) stagingShort = s.reason;
        }
        // Reuse blockers() for the order / reservation reasons (released, locked, movement, warehouse mismatch).
        const resbLike = { XLOEK: '', KZEAR: '', XWAOK: i.MovementAllowed ? 'X' : '', LGNUM: f ? f.LGNUM : '', RGEKZ: f ? f.RGEKZ : '' };
        const { resvBlockers, orderBlockers } = blockers(resbLike, i.ProductionOrder ? {} : undefined, st, warehouse);
        const allBlockers = [...resvBlockers, ...orderBlockers];
        let blockReason = '';
        if (i.OpenQuantity <= 0) blockReason = 'No open quantity remaining';
        else if (allBlockers.length) blockReason = allBlockers.join('; ');
        else if (stagingShort) blockReason = stagingShort;
        else if (issuable.blocked) blockReason = issuable.reason;
        i.OrderStatus = st.join(' ');
        i.Warehouse = warehouse;
        i.Backflush = isBackflush(f ? f.RGEKZ : '');
        i.ReadyStorageUnits = issuable.issuableUnits.length;
        i.ReadyQuantity = round(issuable.issuableQty);
        i.ScanPossible = !blockReason;
        i.Blocked = !i.ScanPossible;
        i.BlockReason = blockReason;
        i.PartialCoverage = !blockReason && issuable.partial;
      });
    } catch (e) {
      if (input.scanPossibleOnly) throw e;
      LOG.warn(`Order statuses / stock not read: ${e.message}`);
      Items.forEach((i) => Object.assign(i, {
        OrderStatus: '',
        Warehouse: '',
        Backflush: false,
        ReadyStorageUnits: 0,
        ReadyQuantity: 0,
        ScanPossible: false,
        Blocked: true,
        BlockReason: 'Status/stock check failed',
        PartialCoverage: false
      }));
    }
    if (input.scanPossibleOnly) {
      const scannable = Items.filter((i) => i.ScanPossible);
      return { TotalCount: scannable.length, SapOpenCount: sapCount, Truncated: rows.length < sapCount, Items: scannable };
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
      ['RSNUM', 'RSPOS', 'AUFNR', 'MATNR', 'WERKS', 'LGORT', 'LGNUM', 'LGTYP', 'LGPLA', 'CHARG', 'PRVBE', 'RGEKZ', 'BDTER', 'BDMNG', 'ENMNG', 'MEINS', 'XLOEK', 'KZEAR', 'XWAOK'],
      [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`, "AND BWART = '261'"]);
    if (!resb) throw httpError(404, `Reservation ${strip(rsnum)} item ${strip(rspos)} with movement type 261 not found`);
    this._scopeGuard(resb.WERKS, input.allowedPlants);

    // Production supply area storage location (PVBE by plant+PRVBE; live-verified field LGORT). Its stock
    // is production-related for this order, so the scan list includes it alongside the reservation's LGORT.
    const pvbe = resb.PRVBE ? await read('PVBE', ['LGORT'], [`WERKS = '${resb.WERKS}'`, `AND PRVBE = '${resb.PRVBE}'`]) : [];
    const supplyAreaStorageLocation = pvbe[0] ? pvbe[0].LGORT : '';

    const required = parseSapNumber(resb.BDMNG);
    const withdrawn = parseSapNumber(resb.ENMNG);
    const open = Math.max(0, required - withdrawn);
    const matWhere = [`MATNR = '${resb.MATNR}'`, `AND WERKS = '${resb.WERKS}'`].concat(resb.LGORT ? [`AND LGORT = '${resb.LGORT}'`] : []);

    const [aufk] = resb.AUFNR ? await read('AUFK', ['AUFNR', 'AUART', 'LOEKZ'], [`AUFNR = '${resb.AUFNR}'`]) : [];
    const statuses = resb.AUFNR ? ((await this._orderStatuses([resb.AUFNR]))[strip(resb.AUFNR)] || []).sort() : [];
    const mard = await read('MARD', ['LGORT', 'LABST'], matWhere);
    const mchb = await read('MCHB', ['LGORT', 'CHARG', 'CLABS'], [...matWhere, 'AND CLABS > 0']);
    const t320 = resb.LGORT ? await read('T320', ['LGNUM'], [`WERKS = '${resb.WERKS}'`, `AND LGORT = '${resb.LGORT}'`]) : [];
    const configuredWarehouse = t320[0] ? t320[0].LGNUM : '';
    // Warehouse-wide (material + plant, not restricted to the issue location) so _issuable can see the
    // whole warehouse for a WM reservation, and the production-supply-area location for a non-WM one.
    const lquaRaw = await read('LQUA',
      ['LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'CHARG', 'BESTQ', 'VERME', 'EINME', 'AUSME', 'MEINS', 'LENUM', ...QUANT_BLOCK_FLAGS],
      [`MATNR = '${resb.MATNR}'`, `AND WERKS = '${resb.WERKS}'`, 'AND VERME > 0']);
    const lqua = configuredWarehouse ? lquaRaw.filter((q) => q.LGNUM === configuredWarehouse) : lquaRaw;
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

    const History = docs.map((d) => ({
      MaterialDocument: d.MBLNR, MaterialDocumentYear: d.MJAHR, MaterialDocumentItem: d.ZEILE, MovementType: d.BWART,
      PostingDate: sapDate(d.BUDAT), Quantity: parseSapNumber(d.MENGE), Unit: d.MEINS, Batch: d.CHARG, StorageLocation: d.LGORT,
      Reverses: d.SMBLN ? `${d.SMBLN}/${d.SJAHR}/${d.SMBLP}` : '', IsReversed: d.CANCELLED === 'X', CreatedByUser: d.USNAM
    })).sort((a, b) => `${a.MaterialDocumentYear}${a.MaterialDocument}${a.MaterialDocumentItem}`.localeCompare(`${b.MaterialDocumentYear}${b.MaterialDocument}${b.MaterialDocumentItem}`));
    const effective261 = History.filter((h) => h.MovementType === '261' && !h.IsReversed);

    // One definition of issuable stock (shared with the scan page, the open list and the posting gate).
    const stock = [
      ...mard.map((r) => ({ StorageLocation: r.LGORT, Batch: '', Quantity: parseSapNumber(r.LABST) })),
      ...mchb.map((r) => ({ StorageLocation: r.LGORT, Batch: r.CHARG, Quantity: parseSapNumber(r.CLABS) }))
    ];
    const issuable = this._issuable(
      { warehouse: configuredWarehouse, storageLocation: resb.LGORT, supplyAreaStorageLocation, batch: resb.CHARG, openQty: open, unit: resb.MEINS },
      lqua, stock);

    // Staging evaluation: if the reservation item specifies an interim storage type (WM-PP staging),
    // interim bin must hold sufficient stock, otherwise standard SAP 261 goods issue rejects with shortfall.
    const stagingRequired = Boolean(resb.LGTYP);
    const stagingBin = resb.LGPLA || (resb.AUFNR ? strip(resb.AUFNR).padStart(10, '0') : '');
    const stagingWarehouse = configuredWarehouse || resb.LGNUM || '';
    const staging = this._stagingCore({ storageType: resb.LGTYP, bin: stagingBin, warehouse: stagingWarehouse, batch: resb.CHARG, openQty: open, unit: resb.MEINS }, lqua);
    const stagedStock = staging.stagedStock;
    // A warehouse mismatch (RESB-LGNUM vs T320) is the root blocker; the staging check then runs in the
    // determined warehouse, not the transmitted one, so its shortfall is derivative and misleading -
    // suppress it until the warehouse is aligned, leaving the mismatch as the single actionable reason.
    const warehouseMismatch = Boolean(resb.LGNUM) && (configuredWarehouse ? resb.LGNUM !== configuredWarehouse : true);
    const stagingShortfall = staging.shortfall > 0 && !warehouseMismatch;
    const stagingBlocker = stagingShortfall ? staging.reason : null;

    // Steps: a blocked step carries the reason; nothing here posts or changes data.
    const { resvBlockers, orderBlockers } = blockers(resb, aufk, statuses, configuredWarehouse);
    const step = (Step, Status, Reason = '') => ({ Step, Status, Reason });
    const blockedBefore = [...resvBlockers, ...orderBlockers, ...(stagingBlocker ? [stagingBlocker] : [])];
    // A definite blocker (reservation / order / staging / warehouse mismatch) wins; only when there is
    // none does "nothing issuable" block the goods issue. A partial cover (0 < issuable < open) never
    // blocks - the issue proceeds for what is on hand.
    const giBlockers = blockedBefore.length ? blockedBefore : (open > 0 && issuable.blocked ? [issuable.reason] : []);
    const openTr = TransferRequirements.filter((t) => !t.Completed);
    const openTo = TransferOrders.filter((t) => !t.Confirmed);

    let wmStagingStatus = 'done';
    let wmStagingReason = '';
    if (stagingRequired) {
      if (stagingShortfall) {
        wmStagingStatus = (openTr.length || openTo.length) ? 'open' : 'blocked';
        wmStagingReason = `interim storage bin ${resb.LGTYP}/${stagingBin} has ${stagedStock} ${resb.MEINS} staged, shortfall of ${Math.round((open - stagedStock) * 1000) / 1000} ${resb.MEINS}`;
        if (openTr.length || openTo.length) {
          const pending = [openTr.length && `${openTr.length} transfer requirement item(s) not completed`, openTo.length && `${openTo.length} transfer order(s) not confirmed`].filter(Boolean).join('; ');
          wmStagingReason = `${pending}; ${wmStagingReason}`;
        }
      } else if (openTr.length || openTo.length) {
        wmStagingStatus = 'open';
        wmStagingReason = [openTr.length && `${openTr.length} transfer requirement item(s) not completed`, openTo.length && `${openTo.length} transfer order(s) not confirmed`].filter(Boolean).join('; ');
      }
    } else if (openTr.length || openTo.length) {
      wmStagingStatus = 'open';
      wmStagingReason = openTr.length ? `${openTr.length} transfer requirement item(s) not completed` : `${openTo.length} transfer order(s) not confirmed`;
    } else if (!t320.length && !ltbk.length) {
      wmStagingStatus = 'done';
      wmStagingReason = 'storage location is not WM-managed and no transfer requirement exists';
    }

    const Steps = [
      step('Reservation', resvBlockers.length ? 'blocked' : 'done', resvBlockers.join('; ')),
      step('ProductionOrder', !aufk ? 'blocked' : orderBlockers.length ? 'blocked' : 'done', !aufk ? 'no order on the reservation item' : orderBlockers.join('; ')),
      step('Availability', open === 0 || issuable.issuableQty >= open ? 'done' : 'blocked',
        open > 0 && issuable.issuableQty < open
          ? (issuable.reason || `issuable stock ${issuable.issuableQty} ${resb.MEINS} is less than the open quantity ${open} ${resb.MEINS}`)
          : ''),
      step('WmStaging', wmStagingStatus, wmStagingReason),
      step('GoodsIssue', open === 0 ? 'done' : giBlockers.length ? 'blocked' : 'open', open > 0 ? giBlockers.join('; ') : ''),
      step('DocumentHistory', History.length ? 'done' : 'open', History.length ? '' : 'no 261 or 262 document yet'),
      step('Reversal', effective261.length ? 'open' : 'done', effective261.length ? `${effective261.length} document(s) of movement type 261 can be reversed` : ''),
      step('Closure', open === 0 || resvBlockers.length ? 'done' : 'open', open === 0 ? '' : resvBlockers.length ? resvBlockers.join('; ') : `${open} ${resb.MEINS} still open`)
    ];

    const result = {
      Reservation: strip(resb.RSNUM), ReservationItem: strip(resb.RSPOS), ProductionOrder: strip(resb.AUFNR), OrderType: aufk ? aufk.AUART : '',
      OrderStatus: statuses.join(' '), Material: strip(resb.MATNR), Plant: resb.WERKS, StorageLocation: resb.LGORT, Batch: resb.CHARG,
      SupplyArea: strip(resb.PRVBE || ''), SupplyAreaStorageLocation: supplyAreaStorageLocation,
      RequirementDate: sapDate(resb.BDTER), RequiredQuantity: required, WithdrawnQuantity: withdrawn, OpenQuantity: open, Unit: resb.MEINS,
      IsDeleted: resb.XLOEK === 'X', IsFinalIssue: resb.KZEAR === 'X', MovementAllowed: resb.XWAOK === 'X',
      Backflush: isBackflush(resb.RGEKZ),
      Warehouse: configuredWarehouse,
      ReservationWarehouse: resb.LGNUM || '',
      IssuableQuantity: issuable.issuableQty,
      SupplyAreaStock: issuable.supplyAreaStock,
      PartialCoverage: issuable.partial && giBlockers.length === 0,
      StagingRequired: stagingRequired,
      StagingStorageType: resb.LGTYP || '',
      StagingBin: stagingBin || '',
      StagedQuantity: round(stagedStock),
      StagingShortfall: stagingShortfall ? staging.shortfall : 0,
      Steps,
      Stock: stock,
      Quants: lqua.map((q) => ({ Warehouse: q.LGNUM, StorageType: q.LGTYP, StorageBin: q.LGPLA, StorageLocation: q.LGORT, Batch: q.CHARG, AvailableQuantity: parseSapNumber(q.VERME), StorageUnit: strip(q.LENUM) })),
      TransferRequirements, TransferOrders, History
    };
    // Same-process callers (scanContext, postGoodsIssue, openItems) reuse the raw stock the issuable
    // decision was made from, so the posting gate uses the exact same data. Non-enumerable: the OData
    // layer serializes only the declared Cycle261 fields, so this never leaves the service.
    Object.defineProperty(result, '_raw', { value: { quants: lqua, stock }, enumerable: false });
    return result;
  }

  /** Why a quant cannot be issued (R3 block flags / pending transfer order, R4 not-ready bins): [reason, value1, value2] or null. */
  _quantNotReady(q) {
    const flags = QUANT_BLOCK_FLAGS.filter((f) => q[f]);
    if (flags.length) return ['blocked', flags.map((f) => `${f}=${q[f]}`).join(', ')];
    // Stock category (LQUA-BESTQ, domain BESTQ verified live): Q quality control, S blocked, R returns.
    if (q.BESTQ) return ['stockCategory', q.BESTQ];
    if (parseSapNumber(q.AUSME) > 0) return ['inTransferOrder', `${parseSapNumber(q.AUSME)} ${q.MEINS}`, 'AUSME'];
    if (parseSapNumber(q.EINME) > 0) return ['inTransferOrder', `${parseSapNumber(q.EINME)} ${q.MEINS}`, 'EINME'];
    const bin = this.notReadyBins.find((b) => (!b.storageType || b.storageType === q.LGTYP) && (!b.bin || b.bin === q.LGPLA));
    return bin ? [bin.reason, q.LGTYP, q.LGPLA] : null;
  }

  /**
   * The single definition of "issuable stock" for a reservation item, shared by the cycle, the scan
   * page, the open list and the posting gate. Pure (reads nothing from SAP).
   *  - WM reservation (warehouse set): issuable = ready stock across the whole warehouse (every quant
   *    of the material in that warehouse that passes _quantNotReady), batch-matched. issuableUnits is
   *    the storage-unit (LENUM) subset, for the scan FIFO/suggest list; bulk quants still count toward
   *    the quantity. Supply-area stock is in the warehouse, so it is already issuable (no stranded flag).
   *  - Non-WM reservation: issuable = unrestricted stock in exactly the reservation's storage location
   *    (MARD, or MCHB for the pinned batch). Stock in the production-supply-area location is reported as
   *    supplyAreaStock and never counted - it needs a transfer first.
   * @param {{warehouse,storageLocation,supplyAreaStorageLocation,batch,openQty,unit}} ctx
   * @param {Array} quants       LQUA rows of the material in the plant (VERME > 0)
   * @param {Array} locationStock [{StorageLocation, Batch, Quantity}] from MARD/MCHB
   */
  _issuable(ctx, quants = [], locationStock = []) {
    const batchOk = (v) => !ctx.batch || v === ctx.batch;
    let issuableQty = 0;
    let issuableUnits = [];
    let supplyAreaStock = 0;
    if (ctx.warehouse) {
      const ready = quants.filter((q) => q.LGNUM === ctx.warehouse && batchOk(q.CHARG) && !this._quantNotReady(q));
      issuableQty = ready.reduce((s, q) => s + parseSapNumber(q.VERME), 0);
      issuableUnits = ready.filter((q) => q.LENUM);
    } else {
      const rows = locationStock.filter((st) => st.StorageLocation === ctx.storageLocation && (ctx.batch ? st.Batch === ctx.batch : !st.Batch));
      issuableQty = rows.reduce((s, st) => s + (Number(st.Quantity) || 0), 0);
      if (ctx.supplyAreaStorageLocation && ctx.supplyAreaStorageLocation !== ctx.storageLocation) {
        supplyAreaStock = quants
          .filter((q) => q.LGORT === ctx.supplyAreaStorageLocation && batchOk(q.CHARG))
          .reduce((s, q) => s + parseSapNumber(q.VERME), 0);
      }
    }
    issuableQty = round(issuableQty);
    supplyAreaStock = round(supplyAreaStock);
    const blocked = ctx.openQty > 0 && issuableQty <= 0;
    const partial = issuableQty > 0 && issuableQty < ctx.openQty;
    const reason = !blocked ? ''
      : supplyAreaStock > 0
        ? `${supplyAreaStock} ${ctx.unit} in supply area ${ctx.supplyAreaStorageLocation}; issue location ${ctx.storageLocation} is empty - transfer required`
        : `no unrestricted stock in ${ctx.storageLocation || 'the issue location'}`;
    return { issuableQty, issuableUnits, supplyAreaStock, blocked, partial, reason };
  }

  /**
   * WM-PP interim-staging shortfall: staged stock (LQUA) in the interim storage type/bin of the
   * warehouse, batch-matched, versus openQty. Shared by the cycle, the open list and the posting gate.
   * No storage type -> nothing staged is required. Pure.
   * @param {{storageType,bin,warehouse,batch,openQty,unit}} ctx
   */
  _stagingCore(ctx, quants = []) {
    if (!ctx.storageType) return { stagedStock: 0, shortfall: 0, reason: null };
    const staged = quants.filter((q) =>
      q.LGTYP === ctx.storageType &&
      q.LGPLA === ctx.bin &&
      (!ctx.warehouse || q.LGNUM === ctx.warehouse) &&
      (!ctx.batch || q.CHARG === ctx.batch));
    const stagedStock = round(staged.reduce((s, q) => s + parseSapNumber(q.VERME), 0));
    const shortfall = ctx.openQty > 0 && stagedStock < ctx.openQty ? round(ctx.openQty - stagedStock) : 0;
    return {
      stagedStock,
      shortfall,
      reason: shortfall > 0 ? `available stock shortfall of ${shortfall} ${ctx.unit} in interim storage bin ${ctx.storageType}/${ctx.bin}` : null
    };
  }

  /**
   * All LQUA quants (VERME > 0) of the listed plants, grouped "material|plant", so openItems can run
   * the same _issuable rule per reservation as the scan page. One read per distinct plant.
   * ponytail: reads every quant of the plant; restrict by material or cache it if the list gets slow.
   */
  async _plantQuants(items) {
    const plants = [...new Set(items.map((i) => i.Plant).filter(Boolean))];
    const out = {};
    for (const p of plants) {
      const quants = await this._table('LQUA',
        ['LENUM', 'LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'MATNR', 'WERKS', 'CHARG', 'BESTQ', 'VERME', 'EINME', 'AUSME', 'MEINS', ...QUANT_BLOCK_FLAGS],
        ['VERME > 0', `AND WERKS = '${p}'`], 'Read plant stock quants');
      for (const q of quants) (out[`${strip(q.MATNR)}|${q.WERKS}`] = out[`${strip(q.MATNR)}|${q.WERKS}`] || []).push(q);
    }
    return out;
  }

  /**
   * Per "reservation|item" the open 261 RESB facts the list needs (issue location, warehouse, interim
   * staging type/bin, supply area, batch, movement allowed). One read per distinct plant. Keyed on the
   * stripped reservation/item so it matches the OData list rows.
   */
  async _reservationFacts(items) {
    const plants = [...new Set(items.map((i) => i.Plant).filter(Boolean))];
    const out = {};
    for (const p of plants) {
      const rows = await this._table('RESB',
        ['RSNUM', 'RSPOS', 'AUFNR', 'MATNR', 'LGORT', 'LGNUM', 'LGTYP', 'LGPLA', 'PRVBE', 'CHARG', 'RGEKZ', 'XWAOK'],
        [`WERKS = '${p}'`, "AND BWART = '261'", "AND XLOEK = ''", "AND KZEAR = ''"], 'Read reservation facts');
      for (const r of rows) out[`${strip(r.RSNUM)}|${strip(r.RSPOS)}`] = r;
    }
    return out;
  }

  /** Per "plant|supplyArea" the supply-area storage location (PVBE-LGORT), for the listed items. */
  async _supplyAreaLocations(items, facts) {
    const pairs = [...new Set(items
      .map((i) => { const f = facts[`${strip(i.Reservation)}|${strip(i.ReservationItem)}`]; return f && f.PRVBE ? `${i.Plant}|${f.PRVBE}` : ''; })
      .filter(Boolean))];
    const out = {};
    for (const key of pairs) {
      const [p, prvbe] = key.split('|');
      const rows = await this._table('PVBE', ['PRVBE', 'LGORT'], [`WERKS = '${p}'`, `AND PRVBE = '${prvbe}'`], 'Read supply-area storage location');
      if (rows[0]) out[key] = rows[0].LGORT;
    }
    return out;
  }

  /**
   * Per "material|plant" the unrestricted stock rows (MARD + MCHB) for the non-WM listed items, so the
   * open list uses the same source as the posting gate for those items. One pair of reads per distinct
   * non-WM material. WM items take their quantity from LQUA (_plantQuants) and are skipped here.
   */
  async _nonWmStock(items, facts, warehouses) {
    const nonWm = items.filter((i) => !(warehouses[`${i.Plant}|${i.StorageLocation}`] || ''));
    const mats = [...new Set(nonWm.map((i) => `${i.Material.padStart(18, '0')}|${i.Plant}`))];
    const out = {};
    for (const key of mats) {
      const [m, p] = key.split('|');
      const mard = await this._table('MARD', ['LGORT', 'LABST'], [`MATNR = '${m}'`, `AND WERKS = '${p}'`], 'Read non-WM location stock');
      const mchb = await this._table('MCHB', ['LGORT', 'CHARG', 'CLABS'], [`MATNR = '${m}'`, `AND WERKS = '${p}'`, 'AND CLABS > 0'], 'Read non-WM batch stock');
      out[`${strip(m)}|${p}`] = [
        ...mard.map((r) => ({ StorageLocation: r.LGORT, Batch: '', Quantity: parseSapNumber(r.LABST) })),
        ...mchb.map((r) => ({ StorageLocation: r.LGORT, Batch: r.CHARG, Quantity: parseSapNumber(r.CLABS) }))
      ];
    }
    return out;
  }

  /**
   * Per "plant|storageLocation" the configured warehouse (T320-LGNUM), for the listed items. Same
   * source the cycle/scan screen uses for Warehouse. One T320 read per distinct plant; "" when the
   * storage location is not warehouse-managed.
   */
  async _warehouses(items) {
    const plants = [...new Set(items.map((i) => i.Plant).filter(Boolean))];
    const out = {};
    for (const p of plants) {
      const rows = await this._table('T320', ['LGORT', 'LGNUM'], [`WERKS = '${p}'`], 'Read storage-location warehouses');
      for (const r of rows) out[`${p}|${r.LGORT}`] = r.LGNUM;
    }
    return out;
  }

  /**
   * Scan screen, page load: the cycle's header and block checks plus material text, batch management
   * and whether the material has storage-unit stock in the plant at all. Read-only.
   */
  async scanContext(input = {}) {
    const c = await this.cycle(input);
    const matnr = c.Material.padStart(18, '0');
    const read = (table, fields, where) => this._table(table, fields, where, `Read ${table} for material ${c.Material}`);
    const [makt] = await read('MAKT', ['MAKTX'], [`MATNR = '${matnr}'`, "AND SPRAS = 'E'"]);
    const [marc] = await read('MARC', ['XCHPF'], [`MATNR = '${matnr}'`, `AND WERKS = '${c.Plant}'`]);
    const quants = await read('LQUA',
      ['LENUM', 'LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'CHARG', 'BESTQ', 'VERME', 'EINME', 'AUSME', 'MEINS', 'WDATU', ...QUANT_BLOCK_FLAGS],
      [`MATNR = '${matnr}'`, `AND WERKS = '${c.Plant}'`, 'AND VERME > 0']);
    const gi = c.Steps.find((st) => st.Step === 'GoodsIssue');

    // Production-related stock only: storage units of this component in the reservation's storage location
    // OR the order's production supply area location (PVBE), within the order's warehouse, and - when the
    // reservation item is batch-specific - that batch only. Goods issue is allowed for released orders
    // only, so for a non-released order the list is empty and the UI shows an info message.
    // Oldest goods-receipt date first (LQUA-WDATU), then batch, then storage unit; undated quants go last.
    const released = String(c.OrderStatus || '').split(/\s+/).includes('REL');
    const locations = [...new Set([c.StorageLocation, c.SupplyAreaStorageLocation].filter(Boolean))];
    const here = quants.filter((q) =>
      (!locations.length || locations.includes(q.LGORT)) &&
      (!c.Warehouse || q.LGNUM === c.Warehouse) &&
      (!c.Batch || q.CHARG === c.Batch));
    const key = (q) => `${sapDate(q.WDATU) || '9999-99-99'}|${q.CHARG}|${q.LENUM}`;
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    let toCover = gi.Status === 'open' ? c.OpenQuantity : 0;
    // The 261 posts from the reservation's own storage location. When it is warehouse-managed the
    // warehouse is the gate (stock across its storage locations is issuable); when it is not, only stock
    // in that exact storage location can be issued. Production-supply-area stock in a different storage
    // location of a non-WM reservation is shown but flagged "in supply area" and never suggested, so it
    // is not scanned by mistake and then rejected at posting for having no stock in the issue location.
    const issuable = (q) => c.Warehouse ? true : q.LGORT === c.StorageLocation;
    const Units = (released ? here.filter((q) => q.LENUM) : []).sort((x, y) => key(x).localeCompare(key(y))).map((q, i) => {
      const blocker = this._quantNotReady(q) || (!issuable(q) ? ['inSupplyArea', q.LGORT, c.StorageLocation] : null);
      const date = sapDate(q.WDATU);
      const quantity = parseSapNumber(q.VERME);
      const Suggested = !blocker && toCover > 0;
      if (Suggested) toCover -= quantity;
      return {
        Rank: i + 1, StorageUnit: strip(q.LENUM), Batch: q.CHARG, Quantity: quantity, Unit: q.MEINS, Warehouse: q.LGNUM,
        StorageType: q.LGTYP, StorageBin: q.LGPLA, StorageLocation: q.LGORT, GoodsReceiptDate: date,
        AgeDays: date ? Math.round((today - Date.parse(date)) / 86400000) : null,
        Status: !blocker ? 'Available' : (blocker[0] === 'inSupplyArea' || this.notReadyBins.some((b) => b.reason === blocker[0])) ? 'OnHold' : 'Blocked',
        Reason: blocker ? blocker[0] : '', Value1: blocker ? String(blocker[1] || '') : '', Value2: blocker ? String(blocker[2] || '') : '',
        Suggested
      };
    });
    const noUnit = here.filter((q) => !q.LENUM);
    // SupplyAreaStock (stock stranded in the supply area, non-WM) and the Blocked decision both come from
    // cycle()/_issuable, so the scan page, the open list and the posting gate agree. Nothing recomputed here.
    return {
      Reservation: c.Reservation, ReservationItem: c.ReservationItem, ProductionOrder: c.ProductionOrder, OrderStatus: c.OrderStatus,
      Material: c.Material, MaterialName: makt ? makt.MAKTX : '', BatchManaged: !!marc && marc.XCHPF === 'X',
      Plant: c.Plant, StorageLocation: c.StorageLocation, Warehouse: c.Warehouse, RequiredQuantity: c.RequiredQuantity, WithdrawnQuantity: c.WithdrawnQuantity,
      OpenQuantity: c.OpenQuantity, Unit: c.Unit, Batch: c.Batch || '',
      IssuableQuantity: c.IssuableQuantity, PartialCoverage: c.PartialCoverage, Backflush: c.Backflush,
      SupplyArea: c.SupplyArea || '', SupplyAreaStorageLocation: c.SupplyAreaStorageLocation || '', SupplyAreaStock: c.SupplyAreaStock, OrderReleased: released,
      Blocked: gi.Status !== 'open', BlockReason: gi.Status === 'open' ? '' : (gi.Reason || 'nothing left to issue'),
      QuantCount: quants.length, StorageUnitQuantCount: quants.filter((q) => q.LENUM).length,
      NoUnitQuantCount: noUnit.length, NoUnitQuantity: Math.round(noUnit.reduce((t, q) => t + parseSapNumber(q.VERME), 0) * 1000) / 1000,
      Units
    };
  }

  /**
   * Scan screen, one scan: check a storage unit (LQUA by LENUM) against a reservation item. Read-only.
   * Rejections carry a reason code and the two values to show; session rules (already scanned,
   * quantity caps) live in the UI because scanned rows exist only there.
   */
  async checkStorageUnit(input = {}) {
    const rsnum = clean(input.reservation, 'Reservation', /^\d{1,10}$/, true).padStart(10, '0');
    const rspos = clean(input.item, 'Reservation item', /^\d{1,4}$/, true).padStart(4, '0');
    const su = clean(input.storageUnit, 'Storage unit', /^\d{1,20}$/, true);
    const read = (table, fields, where) => this._table(table, fields, where, `Read ${table} for storage unit ${su}`);
    const reject = (Reason, Value1 = '', Value2 = '') => ({ StorageUnit: strip(su), Accepted: false, Reason, Value1: String(Value1), Value2: String(Value2), Rows: [] });

    const [resb] = await read('RESB', ['AUFNR', 'MATNR', 'WERKS', 'LGORT', 'LGNUM', 'LGTYP', 'LGPLA', 'RGEKZ', 'XLOEK', 'KZEAR', 'XWAOK'], [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`, "AND BWART = '261'"]);
    if (!resb) throw httpError(404, `Reservation ${strip(rsnum)} item ${strip(rspos)} with movement type 261 not found`);
    this._scopeGuard(resb.WERKS, input.allowedPlants);
    const [aufk] = resb.AUFNR ? await read('AUFK', ['AUFNR', 'LOEKZ'], [`AUFNR = '${resb.AUFNR}'`]) : [];
    const statuses = resb.AUFNR ? ((await this._orderStatuses([resb.AUFNR]))[strip(resb.AUFNR)] || []) : [];
    const t320 = resb.LGORT ? await read('T320', ['LGNUM'], [`WERKS = '${resb.WERKS}'`, `AND LGORT = '${resb.LGORT}'`]) : [];
    const configuredWarehouse = t320[0] ? t320[0].LGNUM : '';
    const { resvBlockers, orderBlockers } = blockers(resb, aufk, statuses, configuredWarehouse);
    if (!aufk) orderBlockers.push('no order on the reservation item');
    if (resvBlockers.length || orderBlockers.length) return reject('itemBlocked', [...resvBlockers, ...orderBlockers].join('; '));

    const all = await read('LQUA',
      ['LGNUM', 'LGTYP', 'LGPLA', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BESTQ', 'VERME', 'EINME', 'AUSME', 'MEINS', ...QUANT_BLOCK_FLAGS],
      [`LENUM = '${su.padStart(20, '0')}'`]);
    if (!all.length) return reject('notFound');
    const other = all.find((q) => q.MATNR !== resb.MATNR || q.WERKS !== resb.WERKS);
    const quants = all.filter((q) => q.MATNR === resb.MATNR && q.WERKS === resb.WERKS);
    if (!quants.length) return reject('wrongMaterialOrPlant', `${strip(other.MATNR)} / ${other.WERKS}`, `${strip(resb.MATNR)} / ${resb.WERKS}`);
    if (!quants.some((q) => parseSapNumber(q.VERME) > 0)) return reject('noStock');

    if (configuredWarehouse && quants.every((q) => q.LGNUM !== configuredWarehouse)) {
      return reject('wrongWarehouse', quants[0].LGNUM, configuredWarehouse);
    }
    const whQuants = configuredWarehouse ? quants.filter((q) => q.LGNUM === configuredWarehouse) : quants;
    if (!whQuants.length) return reject('wrongWarehouse', quants[0].LGNUM, configuredWarehouse);

    // Batch-specific reservation item: only the reserved batch may be issued.
    if (resb.CHARG) {
      const wrongBatch = whQuants.find((q) => q.CHARG !== resb.CHARG);
      if (wrongBatch) return reject('wrongBatch', wrongBatch.CHARG, resb.CHARG);
    }

    const orderBin = resb.AUFNR.slice(-10);
    const Rows = [];
    for (const q of whQuants) {
      const notReady = this._quantNotReady(q);
      if (notReady) return reject(...notReady);
      Rows.push({
        Warehouse: q.LGNUM, StorageType: q.LGTYP, StorageBin: q.LGPLA, StorageLocation: q.LGORT, Batch: q.CHARG,
        Quantity: parseSapNumber(q.VERME), Unit: q.MEINS,
        Warnings: [q.LGORT !== resb.LGORT && 'storageLocationDiffers', q.LGPLA !== orderBin && 'notInOrderBin'].filter(Boolean)
      });
    }
    return { StorageUnit: strip(su), Accepted: true, Reason: '', Value1: '', Value2: '', Rows: Rows.filter((r) => r.Quantity > 0) };
  }

  async _post(path, data, context) {
    try {
      const res = await this.client.post(path, { data, csrfPath: `${MATDOC_API}/` });
      return { body: res.data?.d || res.data || {}, sapMessage: res.headers?.['sap-message'] || '', headers: res.headers || {} };
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
    if (c.ReservationWarehouse && c.Warehouse && c.ReservationWarehouse !== c.Warehouse) {
      throw httpError(422, `Goods issue not possible: transmitted warehouse number is ${c.ReservationWarehouse}; determined warehouse number is ${c.Warehouse}`);
    }
    if (c.ReservationWarehouse && !c.Warehouse) {
      throw httpError(422, `Goods issue not possible: transmitted warehouse number is ${c.ReservationWarehouse}; storage location is not warehouse-managed`);
    }
    const effBatch = batch || c.Batch || '';
    if (c.StagingRequired) {
      const s = this._stagingCore(
        { storageType: c.StagingStorageType, bin: c.StagingBin, warehouse: c.Warehouse || c.ReservationWarehouse || '', batch: effBatch, openQty: quantity, unit: c.Unit },
        c._raw.quants);
      if (s.shortfall > 0) throw httpError(422, `Goods issue not possible: ${s.reason}${effBatch ? ` for batch ${effBatch}` : ''}`);
    }
    const batchStock = c.Stock.filter((st) => st.Batch);
    if (batchStock.length && !effBatch) throw httpError(422, 'Goods issue not possible: the material has batch stock, a batch is required');
    // Same issuable-stock rule as the scan page and the open list (warehouse-wide for WM, issue location for non-WM).
    const gate = this._issuable(
      { warehouse: c.Warehouse, storageLocation: c.StorageLocation, supplyAreaStorageLocation: c.SupplyAreaStorageLocation, batch: effBatch, openQty: c.OpenQuantity, unit: c.Unit },
      c._raw.quants, c._raw.stock);
    if (gate.issuableQty < quantity) {
      throw httpError(422, `Goods issue not possible: ${gate.reason || `issuable stock ${gate.issuableQty} ${c.Unit} is less than ${quantity} ${c.Unit}`}`);
    }

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
      referenceDocument: input.referenceDocument,
      item: buildBaseItem({
        Material: c.Material, Unit: unit, IssueQty: quantity, Plant: c.Plant, StorageLocation: c.StorageLocation,
        ReservationNo: c.Reservation, ReservationItem: c.ReservationItem, Batch: batch, OrderNo: c.ProductionOrder
      }, '261')
    });
    const { body, sapMessage, headers } = await this._post(`${MATDOC_API}/A_MaterialDocumentHeader`, payload, `Post goods issue 261 for reservation ${c.Reservation}/${c.ReservationItem}`);
    if (!body.MaterialDocument) {
      // WM-managed location: SAP answers 201 with an empty MaterialDocument and turns the goods
      // movement into an outbound delivery (sap-message L9/514). That is a definite SAP outcome, not a
      // failure - but the stock is issued only when PGI is posted for that delivery in SAP.
      const deliveryNo = GoodsIssuePostingClient.deliveryFromSapMessage(GoodsIssuePostingClient.parseSapMessage(headers));
      if (deliveryNo) {
        LOG.warn(`Goods issue 261 for reservation ${c.Reservation}/${c.ReservationItem}: SAP created outbound delivery ${deliveryNo} (L9/514) instead of a material document; PGI still required.`);
        return {
          MaterialDocument: '', MaterialDocumentYear: '', DeliveryNumber: deliveryNo, Pending: true, SapMessage: sapMessage,
          Message: `WM-managed location: SAP created outbound delivery ${deliveryNo}. No material document yet - the goods issue completes only when PGI is posted for that delivery. Do not post again.`
        };
      }
      throw httpError(502, `SAP did not return a material document for the goods issue. sap-message: ${sapMessage || '(none)'}`);
    }
    return { MaterialDocument: body.MaterialDocument, MaterialDocumentYear: body.MaterialDocumentYear, DeliveryNumber: '', Pending: false, SapMessage: sapMessage };
  }

  /**
   * Reverse ONE item of a material document with the API's CancelItem function import (verified live:
   * params MaterialDocument/Year/Item, PostingDate optional, no reason required; SAP writes the 262 and
   * the ReversedMaterialDocument back-reference). Referencing the exact item (not the whole document via
   * Cancel) matches the single-item 261 postings this app creates. PostingDate is omitted so SAP defaults it.
   */
  async reverse(input = {}) {
    const doc = clean(input.materialDocument, 'Material document', /^\d{10}$/, true);
    const year = clean(input.materialDocumentYear, 'Material document year', /^\d{4}$/, true);
    const item = clean(input.materialDocumentItem, 'Material document item', /^\d{1,4}$/, true).padStart(4, '0');
    const { body, sapMessage } = await this._post(
      `${MATDOC_API}/CancelItem?MaterialDocument='${doc}'&MaterialDocumentYear='${year}'&MaterialDocumentItem='${item}'`,
      {}, `Reverse material document ${doc}/${year} item ${strip(item)}`);
    const rev = body.CancelItem || body;
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
    this._scopeGuard(plant, input.allowedPlants);

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
