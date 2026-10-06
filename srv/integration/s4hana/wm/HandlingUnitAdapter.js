'use strict';

const LOG = require('../logger')('handling-unit-adapter');
const { S4HttpClient } = require('../S4HttpClient');
const { RfcClient } = require('../RfcClient');
const { formatDateToYMD } = require('../../../common/dateUtils');

/**
 * Handling Unit cockpit. Reads are OData V2 GETs — proven live 2026-10-06 against client 220:
 *  - C_HANDLINGUNITMONITOR_CDS/HandlingUnit : list / KPIs (17,440 HUs). Plain entity set, $filter/$top.
 *  - API_HANDLING_UNIT/HandlingUnit(HandlingUnitExternalID,Warehouse) + to_HandlingUnitItem : header, weights,
 *    dimensions, reference document and the packed items. Metadata: both entity sets sap:creatable/updatable/
 *    deletable = false and there are zero FunctionImports, so this service has NO write capability here.
 *  - UI_HANDLINGUNITHIERNODE/C_HandlingUnitHierarchyNode(P_HandlingUnitOrigin,P_HandlingUnitIDChar32)/Set :
 *    recursive packing tree (Node / ParentNode / HierarchyLevel).
 * SAP applies the plant / warehouse authorizations of the calling user in every service.
 *
 * Writes go over RFC (API_HANDLING_UNIT is read-only here): BAPI_HU_CREATE / BAPI_HU_PACK / BAPI_HU_UNPACK /
 * BAPI_HU_DELETE followed by BAPI_TRANSACTION_COMMIT on the SAME connection (one LUW, RfcClient.session), then a
 * read-back from VEKP / VEPO. Proven live 2026-10-06 (client 220, test HU 2000020166: create -> pack -> unpack ->
 * delete). Contract: HUKEY is a bare 20-char zero-padded string, materials 18-char zero-padded, quantities as
 * decimal strings, RETURN TYPE E/A = failure (no commit). BAPI_HU_GETLIST's full read returns empty headers on this
 * system, so VEKP/VEPO are the read-back.
 * ponytail: material items pack only into HUs in non-HU-managed storage locations (an HU-managed SLoc needs a goods
 * movement; HU_CREATE_GOODS_MOVEMENT is not RFC-enabled here) — SAP's rejection surfaces as 422. SERIALNUMBERS are
 * not sent. No explicit BAPI_TRANSACTION_ROLLBACK: closing the connection discards an uncommitted LUW.
 */
const MONITOR = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/HandlingUnit';
const DETAIL = '/sap/opu/odata/sap/API_HANDLING_UNIT/HandlingUnit';
const HIERNODE = '/sap/opu/odata/sap/UI_HANDLINGUNITHIERNODE/C_HandlingUnitHierarchyNode';
const PAGE = 200;
const MAX_LIST = 1000;

const LIST_SELECT = [
  'HandlingUnitExternalID', 'Warehouse', 'WarehouseName', 'HandlingUnitIDChar32', 'HandlingUnitOrigin',
  'PackagingMaterial', 'PackagingMaterialName', 'Plant', 'PlantName', 'StorageLocation', 'StorageLocationName',
  'StorageType', 'StorageBin', 'ParentHandlingUnitNumber', 'GrossWeight', 'NetWeight', 'WeightUnit',
  'GrossVolume', 'VolumeUnit', 'HandlingUnitProcessStatus', 'HandlingUnitProcessStatusText',
  'HandlingUnitReferenceDocument', 'CreatedByUser', 'CreationDateTime'
].join(',');

const DETAIL_MONITOR_SELECT = [
  'HandlingUnitExternalID', 'HandlingUnitIDChar32', 'HandlingUnitOrigin', 'Warehouse', 'WarehouseName',
  'PackagingMaterial', 'PackagingMaterialName', 'PackagingMaterialType', 'PackagingMaterialTypeName',
  'Plant', 'PlantName', 'StorageLocation', 'StorageLocationName', 'StorageType', 'StorageBin', 'ShippingPoint',
  'ParentHandlingUnitNumber', 'HandlingUnitProcessStatus', 'HandlingUnitProcessStatusText',
  'HandlingUnitReferenceDocument', 'HandlingUnitReferenceDocName', 'DeliveryDocument',
  'CreatedByUser', 'CreationDateTime', 'LastChangedByUser', 'LastChangeDateTime',
  'PackingInstructionNumber', 'HandlingUnitProductName', 'HandlingUnitInternalOrig'
].join(',');

const DETAIL_ITEM_SELECT = [
  'HandlingUnitItem', 'Material', 'MaterialName', 'Batch', 'Plant', 'StorageLocation',
  'HandlingUnitQuantity', 'HandlingUnitQuantityUnit', 'HandlingUnitReferenceDocument',
  'HandlingUnitRefDocumentItem', 'ShelfLifeExpirationDate', 'HandlingUnitGoodsReceiptDate'
].join(',');

const RE = {
  plant: /^[A-Z0-9]{1,4}$/,
  warehouse: /^[A-Z0-9]{1,4}$/,
  material: /^[A-Z0-9][A-Z0-9_./-]{0,39}$/,
  hu: /^[A-Z0-9]{1,20}$/,
  char32: /^[0-9A-F]{32}$/,
  origin: /^[A-Z]{1,10}$/,
  status: /^[A-Z0-9]$/,
  vhKind: /^[A-Z]+$/i,
  venum: /^\d{1,10}$/,
  sloc: /^[A-Z0-9]{1,4}$/,
  unit: /^[A-Z0-9]{1,3}$/,
  batch: /^[A-Z0-9_./-]{1,10}$/,
  item: /^\d{1,6}$/
};

/** Filter-bar value helps: the monitor value-help set and its key/text fields. kind is the only input. */
const VALUE_HELP = {
  plant: { set: 'C_PlantVH', key: 'Plant', text: 'PlantName' },
  packaging: { set: 'C_PackagingMaterialVH', key: 'PackagingMaterial', text: 'PackagingMaterialName' },
  status: { set: 'C_HandlingUnitStatusVH', key: 'HandlingUnitStat', text: 'HandlingUnitStatusName' },
  shippingpoint: { set: 'C_ShippingPointVH', key: 'ShippingPoint', text: 'ShippingPointName' },
  storagelocation: { set: 'I_StorageLocationStdVH', key: 'StorageLocation', text: 'StorageLocationName' }
};
const VH_BASE = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS';
const VH_TOP = 500;

const strip = (v) => String(v ?? '').replace(/^0+(?=.)/, '');
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Trust-boundary check: values go into an OData $filter or key, so only the listed characters pass. */
function clean(value, label, re, mandatory) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s && !mandatory) return '';
  if (!re.test(s)) throw httpError(400, `${label} is missing or invalid`);
  return s;
}

/** Free text for SAP (kept as typed, no upper-casing); length-capped and without quoting characters. */
function text(value, label, max) {
  const s = String(value ?? '').trim();
  if (s.length > max || /['"<>&]/.test(s)) throw httpError(400, `${label} is invalid`);
  return s;
}

// RFC key formats proven live 2026-10-06: numeric material -> 18 chars, numeric HU external id -> 20 chars.
const pad18 = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);
const huKey = (h) => (/^\d+$/.test(h) ? h.padStart(20, '0') : h);
// BAPIRET2: the BAPIs return a table, BAPI_TRANSACTION_COMMIT a structure; S/I/W are not failures.
const bapiError = (ret) => [].concat(ret || []).find((r) => r && (r.TYPE === 'E' || r.TYPE === 'A'));

class HandlingUnitAdapter {
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

  /** List of handling units for the filter, newest first. Read-only. */
  async list(input = {}) {
    const plant = clean(input.plant, 'Plant', RE.plant);
    const storageLocation = clean(input.storageLocation, 'Storage location', RE.plant);
    const warehouse = clean(input.warehouse, 'Warehouse', RE.warehouse);
    const material = clean(input.packagingMaterial, 'Packaging material', RE.material);
    const hu = clean(input.handlingUnitExternalID, 'Handling unit', RE.hu);
    const status = clean(input.status, 'Status', RE.status);
    const shippingPoint = clean(input.shippingPoint, 'Shipping point', RE.plant);

    const filter = [];
    if (plant) filter.push(`Plant eq '${plant}'`);
    if (storageLocation) filter.push(`StorageLocation eq '${storageLocation}'`);
    if (warehouse) filter.push(`Warehouse eq '${warehouse}'`);
    if (material) filter.push(`PackagingMaterial eq '${material}'`);
    if (hu) filter.push(`HandlingUnitExternalID eq '${hu}'`);
    if (status) filter.push(`HandlingUnitProcessStatus eq '${status}'`);
    if (shippingPoint) filter.push(`ShippingPoint eq '${shippingPoint}'`);

    const params = {
      $orderby: 'CreationDateTime desc,HandlingUnitExternalID desc',
      $top: PAGE,
      $inlinecount: 'allpages',
      $select: LIST_SELECT,
      $format: 'json'
    };
    if (filter.length) params.$filter = filter.join(' and ');

    const rows = [];
    let sapCount = 0;
    do {
      const d = await this._results(MONITOR, { ...params, $skip: rows.length }, 'Read handling units');
      sapCount = Number(d.__count || 0);
      if (!(d.results || []).length) break;
      rows.push(...d.results);
    } while (rows.length < sapCount && rows.length < MAX_LIST);

    const Items = rows.map((r) => ({
      HandlingUnitExternalID: strip(r.HandlingUnitExternalID),
      HandlingUnitIDChar32: r.HandlingUnitIDChar32 || '',
      HandlingUnitOrigin: r.HandlingUnitOrigin || '',
      Warehouse: r.Warehouse || '',
      WarehouseName: r.WarehouseName || '',
      PackagingMaterial: strip(r.PackagingMaterial),
      PackagingMaterialName: r.PackagingMaterialName || '',
      Plant: r.Plant || '',
      PlantName: r.PlantName || '',
      StorageLocation: r.StorageLocation || '',
      StorageLocationName: r.StorageLocationName || '',
      StorageType: r.StorageType || '',
      StorageBin: strip(r.StorageBin),
      ParentHandlingUnit: strip(r.ParentHandlingUnitNumber),
      GrossWeight: num(r.GrossWeight),
      NetWeight: num(r.NetWeight),
      WeightUnit: r.WeightUnit || '',
      GrossVolume: num(r.GrossVolume),
      VolumeUnit: r.VolumeUnit || '',
      Status: r.HandlingUnitProcessStatus || '',
      StatusText: r.HandlingUnitProcessStatusText || '',
      ReferenceDocument: strip(r.HandlingUnitReferenceDocument),
      CreatedByUser: r.CreatedByUser || '',
      CreationDateTime: formatDateToYMD(r.CreationDateTime)
    }));
    return { TotalCount: Items.length, SapCount: sapCount, Truncated: rows.length < sapCount, Items };
  }

  /** Header, weights, dimensions and packed items of one handling unit. Read-only. */
  async detail(input = {}) {
    const hu = clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true);
    const warehouse = clean(input.warehouse, 'Warehouse', RE.warehouse);
    const key = `HandlingUnitExternalID='${hu}',Warehouse='${warehouse}'`;

    const h = await this._results(`${DETAIL}(${key})`, { $format: 'json' }, `Read handling unit ${hu}`);
    if (!h.HandlingUnitExternalID) throw httpError(404, `Handling unit ${hu} not found`);

    // Fetch items with enrichment (MaterialName, Batch, Plant, SLoc) from MONITOR combined items.
    // Fall back to API_HANDLING_UNIT to_HandlingUnitItem if MONITOR items query is empty or fails.
    let itemRows = [];
    try {
      const monItems = await this._results(`${MONITOR}(${key})/to_HandlingUnitItem`, {
        $select: DETAIL_ITEM_SELECT,
        $format: 'json'
      }, `Read monitor items of handling unit ${hu}`);
      if (Array.isArray(monItems.results) && monItems.results.length) {
        itemRows = monItems.results;
      }
    } catch {
      // Fallback below
    }

    if (!itemRows.length) {
      const apiItems = await this._results(`${DETAIL}(${key})/to_HandlingUnitItem`, { $format: 'json' }, `Read items of handling unit ${hu}`);
      itemRows = apiItems.results || [];
    }

    // Resolve enriched metadata from C_HANDLINGUNITMONITOR_CDS (PackagingMaterialName, StatusText, RefDocName, Char32, etc.)
    let monitor = {};
    try {
      const m = await this._results(MONITOR, {
        $filter: `HandlingUnitExternalID eq '${hu}'`,
        $select: DETAIL_MONITOR_SELECT,
        $top: 1,
        $format: 'json'
      }, `Resolve metadata of handling unit ${hu}`);
      monitor = (m.results || [])[0] || {};
    } catch {
      // Keep monitor as {} if query fails
    }

    const Items = itemRows.map((it) => ({
      HandlingUnitItem: strip(it.HandlingUnitItem),
      Material: strip(it.Material),
      MaterialName: it.MaterialName || '',
      Plant: it.Plant || '',
      StorageLocation: it.StorageLocation || '',
      Batch: it.Batch || '',
      Quantity: num(it.HandlingUnitQuantity),
      Unit: it.HandlingUnitQuantityUnit || '',
      ReferenceDocument: strip(it.HandlingUnitReferenceDocument),
      ReferenceDocumentItem: strip(it.HandlingUnitRefDocumentItem),
      ShelfLifeExpirationDate: formatDateToYMD(it.ShelfLifeExpirationDate),
      GoodsReceiptDate: formatDateToYMD(it.HandlingUnitGoodsReceiptDate)
    }));

    return {
      HandlingUnitExternalID: strip(h.HandlingUnitExternalID || monitor.HandlingUnitExternalID),
      HandlingUnitIDChar32: monitor.HandlingUnitIDChar32 || '',
      HandlingUnitOrigin: monitor.HandlingUnitOrigin || '',
      HandlingUnitInternalNumber: monitor.HandlingUnitInternalOrig || '',
      Warehouse: h.Warehouse || monitor.Warehouse || '',
      WarehouseName: monitor.WarehouseName || '',
      PackagingMaterial: strip(h.PackagingMaterial || monitor.PackagingMaterial),
      PackagingMaterialName: monitor.PackagingMaterialName || '',
      PackagingMaterialType: h.PackagingMaterialType || monitor.PackagingMaterialType || '',
      PackagingMaterialTypeName: monitor.PackagingMaterialTypeName || '',
      Plant: h.Plant || monitor.Plant || (Items[0] && Items[0].Plant) || '',
      PlantName: monitor.PlantName || '',
      StorageLocation: h.StorageLocation || monitor.StorageLocation || (Items[0] && Items[0].StorageLocation) || '',
      StorageLocationName: monitor.StorageLocationName || '',
      StorageType: h.StorageType || monitor.StorageType || '',
      StorageBin: strip(h.StorageBin || monitor.StorageBin),
      ShippingPoint: h.ShippingPoint || monitor.ShippingPoint || '',
      ParentHandlingUnit: strip(h.ParentHandlingUnitNumber || monitor.ParentHandlingUnitNumber),
      GrossWeight: num(h.GrossWeight ?? monitor.GrossWeight),
      NetWeight: num(h.NetWeight ?? monitor.NetWeight),
      TareWeight: num(h.HandlingUnitTareWeight ?? monitor.HandlingUnitTareWeight),
      MaxWeight: num(h.HandlingUnitMaxWeight ?? monitor.HandlingUnitMaxWeight),
      WeightUnit: h.WeightUnit || monitor.WeightUnit || '',
      GrossVolume: num(h.GrossVolume ?? monitor.GrossVolume),
      NetVolume: num(h.HandlingUnitNetVolume ?? monitor.HandlingUnitNetVolume),
      TareVolume: num(h.HandlingUnitTareVolume ?? monitor.HandlingUnitTareVolume),
      MaxVolume: num(h.HandlingUnitMaxVolume ?? monitor.HandlingUnitMaxVolume),
      VolumeUnit: h.VolumeUnit || monitor.VolumeUnit || '',
      Length: num(h.HandlingUnitLength ?? monitor.HandlingUnitLength),
      Width: num(h.HandlingUnitWidth ?? monitor.HandlingUnitWidth),
      Height: num(h.HandlingUnitHeight ?? monitor.HandlingUnitHeight),
      DimensionUnit: h.UnitOfMeasureDimension || monitor.UnitOfMeasureDimension || '',
      PackingObjectKey: h.HandlingUnitPackingObjectKey || '',
      ReferenceDocument: strip(h.HandlingUnitReferenceDocument || monitor.HandlingUnitReferenceDocument),
      ReferenceDocumentType: monitor.HandlingUnitReferenceDocName || '',
      DeliveryDocument: strip(monitor.DeliveryDocument),
      Status: h.HandlingUnitProcessStatus || monitor.HandlingUnitProcessStatus || '',
      StatusText: monitor.HandlingUnitProcessStatusText || '',
      CreatedByUser: h.CreatedByUser || monitor.CreatedByUser || '',
      CreationDateTime: formatDateToYMD(monitor.CreationDateTime) || formatDateToYMD(h.CreationDateTime),
      LastChangedByUser: h.LastChangedByUser || monitor.LastChangedByUser || '',
      Items
    };
  }

  /** Recursive packing tree of one handling unit (flat rows with Node / ParentNode / level). Read-only. */
  async hierarchy(input = {}) {
    const char32 = clean(input.handlingUnitIDChar32, 'Handling unit id', RE.char32, true);
    const origin = clean(input.handlingUnitOrigin || 'ERP', 'Handling unit origin', RE.origin, true);
    const path = `${HIERNODE}(P_HandlingUnitOrigin='${origin}',P_HandlingUnitIDChar32='${char32}')/Set`;
    const d = await this._results(path, { $format: 'json' }, `Read packing tree of ${char32}`);

    const Nodes = (d.results || []).map((r) => ({
      Node: r.Node || '',
      ParentNode: r.ParentNode || '',
      HierarchyLevel: Number(r.HierarchyLevel) || 0,
      DrillState: r.HierarchyDrillState || '',
      Name: strip(r.HandlingUnitOrProductName),
      Product: strip(r.Product),
      ProductName: r.ProductName || '',
      PackagingMaterial: strip(r.PackagingMaterial),
      PackagingMaterialName: r.PackagingMaterialName || '',
      Quantity: num(r.HandlingUnitQuantity),
      Unit: r.HandlingUnitQuantityUnit || '',
      Batch: r.Batch || '',
      ReferenceDocument: strip(r.HandlingUnitReferenceDocument)
    }));
    return { TotalCount: Nodes.length, Nodes };
  }

  /** Filter-bar value help: distinct key/text pairs from the monitor's value-help set for `kind`. Read-only. */
  async valueHelp(input = {}) {
    const kind = clean(input.kind, 'Value help kind', RE.vhKind).toLowerCase();
    const vh = VALUE_HELP[kind];
    if (!vh) throw httpError(400, `Unknown value help '${input.kind}'`);
    const d = await this._results(`${VH_BASE}/${vh.set}`, {
      $select: `${vh.key},${vh.text}`,
      $top: VH_TOP,
      $format: 'json'
    }, `Read ${kind} value help`);
    // Keys go straight into a $filter eq, so keep SAP's stored format (e.g. plant '0001') — do not strip.
    // Dedupe by key: some sets (storage location) repeat a code across plants.
    const seen = new Set();
    const Items = (d.results || []).map((r) => ({ key: r[vh.key] || '', text: r[vh.text] || '' }))
      .filter((x) => x.key && !seen.has(x.key) && seen.add(x.key));
    return { Items };
  }

  /** HandlingUnit/$count for a $filter (or all when none). Returns a number. */
  async _count(filter) {
    const query = filter ? `$filter=${encodeURIComponent(filter)}` : '';
    try {
      const text = await this.client.getText(`${MONITOR}/$count`, { query, accept: 'text/plain' });
      const n = Number(String(text).trim());
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      LOG.error(`Count handling units: ${e.message}`);
      throw httpError(e.status || 502, `Count handling units: ${e.message}`);
    }
  }

  /** Status-distribution KPIs for the cards above the filter bar: total + one count per status code. Read-only. */
  async statusKpis() {
    const { Items: statuses } = await this.valueHelp({ kind: 'status' });
    const Total = await this._count('');
    const Items = [];
    for (const s of statuses) {
      const code = clean(s.key, 'Status', RE.status);
      if (!code) continue;
      Items.push({ code, name: s.text, count: await this._count(`HandlingUnitProcessStatus eq '${code}'`) });
    }
    return { Total, Items };
  }

  /**
   * Serial numbers assigned to one handling unit, via RFC (no OData path exists: C_MaterialSerialNumber is
   * material/stock-level, API_HANDLING_UNIT has no serial). Chain proven live 2026-10-06 (client 220):
   * SER06 (VENUM = HU internal number) -> OBKNR -> OBJK (SERNR, MATNR, EQUNR). Most HUs have none -> [].
   * ponytail: one RFC read of SER06 plus (when serials exist) one of OBJK; the detail page tolerates an RFC
   * outage (it catches and shows no serials) rather than failing the whole page.
   */
  async serials(input = {}) {
    const venum = clean(input.handlingUnitInternalNumber, 'Handling unit internal number', RE.venum, true).padStart(10, '0');
    const read = (table, fields, where) => this.rfc.readTable(table, fields, where).catch((e) => {
      LOG.error(`Read ${table} serials for HU ${venum}: ${e.message}`);
      throw httpError(e.status || 502, `Read ${table} serials for HU ${venum}: ${e.message}`);
    });

    const ser06 = await read('SER06', ['OBKNR', 'VENUM'], [`VENUM = '${venum}'`]);
    const obknrs = [...new Set(ser06.map((r) => r.OBKNR).filter(Boolean))];
    if (!obknrs.length) return { Items: [] };

    const Items = [];
    for (let i = 0; i < obknrs.length; i += 40) {
      const or = obknrs.slice(i, i + 40).map((o, n) => `${n ? 'OR ' : '( '}OBKNR = '${o}'`);
      const rows = await read('OBJK', ['OBKNR', 'SERNR', 'MATNR', 'EQUNR'], [...or, ')']);
      for (const r of rows) {
        if (!r.SERNR) continue;
        Items.push({ SerialNumber: r.SERNR, Material: strip(r.MATNR), Equipment: strip(r.EQUNR) });
      }
    }
    return { Items };
  }

  /** One BAPI + BAPI_TRANSACTION_COMMIT on one connection; on RETURN E/A nothing is committed (422). */
  async _bapi(context, fn, keyAfter) {
    let key;
    try {
      await this.rfc.session(async (call) => {
        const res = await fn(call);
        const err = bapiError(res.RETURN);
        if (err) throw httpError(422, `${context}: ${err.MESSAGE || `${err.ID} ${err.NUMBER}`}`);
        key = (typeof res.HUKEY === 'string' && res.HUKEY) || keyAfter;
        const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
        const cerr = bapiError(commit.RETURN);
        if (cerr) throw httpError(502, `${context}: commit failed: ${cerr.MESSAGE}`);
      });
      return await this._readBack(key);
    } catch (e) {
      if (e.status) throw e;
      LOG.error(`${context}: ${e.message}`);
      throw httpError(502, `${context}: ${e.message}`);
    }
  }

  /** Committed state from VEKP / VEPO (what SAP persisted). Deleted = no VEKP row for the key. */
  async _readBack(key) {
    const [vekp] = await this.rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHILM', 'WERKS', 'LGORT', 'STATUS', 'INHALT'], [`EXIDV = '${key}'`]);
    if (!vekp) return { HandlingUnitExternalID: strip(key), Deleted: true, Items: [] };
    const vepo = await this.rfc.readTable('VEPO', ['VEPOS', 'VELIN', 'MATNR', 'CHARG', 'VEMNG', 'VEMEH', 'WERKS', 'LGORT'], [`VENUM = '${vekp.VENUM}'`]);
    return {
      HandlingUnitExternalID: strip(vekp.EXIDV),
      HandlingUnitInternalNumber: vekp.VENUM,
      PackagingMaterial: strip(vekp.VHILM),
      Plant: vekp.WERKS,
      StorageLocation: vekp.LGORT,
      Status: vekp.STATUS,
      Content: vekp.INHALT,
      Deleted: false,
      Items: vepo.map((r) => ({
        HandlingUnitItem: strip(r.VEPOS), Material: strip(r.MATNR), Batch: r.CHARG, Quantity: num(r.VEMNG),
        Unit: r.VEMEH, Plant: r.WERKS, StorageLocation: r.LGORT
      }))
    };
  }

  /** Material item fields shared by pack / unpack (BAPIHUITMPROPOSAL / BAPIHUITMUNPACK). */
  _itemFields(input) {
    const material = clean(input.material, 'Material', RE.material, true);
    const quantity = Number(input.quantity);
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');
    const batch = clean(input.batch, 'Batch', RE.batch, false);
    return {
      MATERIAL: pad18(material),
      PACK_QTY: quantity.toFixed(3),
      BASE_UNIT_QTY: clean(input.unit, 'Unit', RE.unit, true),
      PLANT: clean(input.plant, 'Plant', RE.plant, true),
      STGE_LOC: clean(input.storageLocation, 'Storage location', RE.sloc, true),
      ...(batch ? { BATCH: batch } : {})
    };
  }

  /** Create an empty handling unit; SAP assigns the external number. */
  async create(input = {}) {
    const header = {
      PACK_MAT: pad18(clean(input.packagingMaterial, 'Packaging material', RE.material, true)),
      PLANT: clean(input.plant, 'Plant', RE.plant, true),
      STGE_LOC: clean(input.storageLocation, 'Storage location', RE.sloc, true)
    };
    const content = text(input.content, 'Content', 40);
    if (content) header.CONTENT = content;
    const r = await this._bapi('Create handling unit', (call) => call('BAPI_HU_CREATE', { HEADERPROPOSAL: header }));
    if (r.Deleted) throw httpError(502, 'Create handling unit: SAP committed but the handling unit could not be read back');
    return r;
  }

  /** Pack one material item (loose stock of the HU's plant / storage location) into the handling unit. */
  async pack(input = {}) {
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    const item = { HU_ITEM_TYPE: '1', ...this._itemFields(input) };
    return this._bapi('Pack handling unit item', (call) => call('BAPI_HU_PACK', { HUKEY: key, ITEMPROPOSAL: item }), key);
  }

  /** Unpack one material item (by HU item number) from the handling unit. */
  async unpack(input = {}) {
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    const item = { HU_ITEM_TYPE: '1', HU_ITEM_NUMBER: clean(input.item, 'Item', RE.item, true).padStart(6, '0'), ...this._itemFields(input) };
    return this._bapi('Unpack handling unit item', (call) => call('BAPI_HU_UNPACK', { HUKEY: key, ITEMUNPACK: item }), key);
  }

  /** Delete a handling unit (SAP removes the VEKP row; packed items make SAP refuse). */
  async remove(input = {}) {
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    const r = await this._bapi('Delete handling unit', (call) => call('BAPI_HU_DELETE', { HUKEY: key }), key);
    if (!r.Deleted) throw httpError(502, 'Delete handling unit: SAP did not delete the handling unit');
    return r;
  }
}

module.exports = HandlingUnitAdapter;
