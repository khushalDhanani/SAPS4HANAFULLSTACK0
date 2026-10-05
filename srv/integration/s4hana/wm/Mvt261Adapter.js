'use strict';

const LOG = require('../logger')('mvt261-adapter');
const { S4HttpClient } = require('../S4HttpClient');
const { formatDateToYMD } = require('../../../common/dateUtils');

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

    return { TotalCount: Items.length, SapOpenCount: sapCount, Truncated: rows.length < sapCount, Items };
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
