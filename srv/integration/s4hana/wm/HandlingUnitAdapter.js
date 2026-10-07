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
const ITEM_COMBINED = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/I_HandlingUnitItemCombined';
const DETAIL = '/sap/opu/odata/sap/API_HANDLING_UNIT/HandlingUnit';
const HIERNODE = '/sap/opu/odata/sap/UI_HANDLINGUNITHIERNODE/C_HandlingUnitHierarchyNode';
const PAGE = 200;
const MAX_LIST = 1000;
// Batched label join: HU ids per combined-item $filter (URL-length safe), OR terms per RFC_READ_TABLE.
const LABEL_HU_CHUNK = 50;
const SERIAL_RFC_CHUNK = 40;
const MAX_LABEL_IDS = 2000; // cap per labels() call: the UI sends <=200/POST, so this only blocks direct-API abuse/enumeration
const LABEL_ITEM_SELECT = 'HandlingUnitExternalID,HandlingUnitItem,Material,MaterialName,HandlingUnitNumberOfSerialNumb,HandlingUnitInternalID,Plant';
// Plant/SLoc live on the HU item (stock), not always on the monitor header; used to fill blank list rows.
const LIST_ITEM_PLANT_SELECT = 'HandlingUnitExternalID,HandlingUnitItem,Plant,StorageLocation';

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

/**
 * Plant authorization (server-side; never trust a plant from the browser).
 * allowed === null  -> Admin / unrestricted (all plants)
 * allowed === []    -> no plants (sees nothing)
 * allowed === [..]  -> only those plant codes (upper-cased).
 */
const inPlantScope = (allowed, plant) => !Array.isArray(allowed) || allowed.includes(String(plant ?? '').trim().toUpperCase());
/** OData $filter sub-clause for a plant list, or '' when unrestricted. An empty list yields a never-match clause. */
const plantClause = (allowed, field = 'Plant') => {
  if (!Array.isArray(allowed)) return '';
  if (!allowed.length) return `${field} eq '~none~'`;
  return '(' + allowed.map((p) => `${field} eq '${p}'`).join(' or ') + ')';
};

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

    // Plant authorization: intersect the (untrusted) browser plant with the user's allowed plants.
    const allowed = input.allowedPlants;
    let plantFilter = '';
    if (Array.isArray(allowed)) {
      const eff = plant ? (allowed.includes(plant) ? [plant] : []) : allowed;
      if (!eff.length) return { TotalCount: 0, SapCount: 0, Truncated: false, Items: [] };
      plantFilter = plantClause(eff);
    } else if (plant) {
      plantFilter = `Plant eq '${plant}'`;
    }

    const filter = [];
    if (plantFilter) filter.push(plantFilter);
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

    // The monitor header carries Plant/StorageLocation only for HUs assigned at header level; for the rest
    // (e.g. freshly created HUs) those fields are blank there but set on the HU item (stock). Fill the blanks
    // from the first item via the same combined-item view labels() uses, so the list shows Plant / SLoc.
    const needItem = Items.filter((i) => !i.Plant || !i.StorageLocation).map((i) => i.HandlingUnitExternalID);
    if (needItem.length) {
      const byHu = await this._firstItemPlantSloc(needItem);
      for (const it of Items) {
        const m = byHu[it.HandlingUnitExternalID];
        if (!m) continue;
        if (!it.Plant) it.Plant = m.Plant;
        if (!it.StorageLocation) it.StorageLocation = m.StorageLocation;
      }
    }

    return { TotalCount: Items.length, SapCount: sapCount, Truncated: rows.length < sapCount, Items };
  }

  /**
   * First item's Plant/StorageLocation per HU external id, from I_HandlingUnitItemCombined (OR-batched, first
   * = lowest HandlingUnitItem). Used to fill list rows whose monitor header has no Plant/SLoc. Read failures are
   * swallowed (the list still renders, just with "-" for those rows). @returns {Promise<Object<string,{Plant,StorageLocation}>>}
   */
  async _firstItemPlantSloc(ids) {
    const grouped = {};
    for (let i = 0; i < ids.length; i += LABEL_HU_CHUNK) {
      const slice = ids.slice(i, i + LABEL_HU_CHUNK);
      const filter = '(' + slice.map((id) => `HandlingUnitExternalID eq '${id}'`).join(' or ') + ')';
      let d;
      try {
        d = await this._results(ITEM_COMBINED, { $filter: filter, $select: LIST_ITEM_PLANT_SELECT, $top: 5000, $format: 'json' }, 'Read handling unit items for plant/sloc');
      } catch (_e) { continue; } // best-effort enrichment; keep the list usable on a per-chunk failure
      for (const r of d.results || []) {
        const h = strip(r.HandlingUnitExternalID);
        (grouped[h] = grouped[h] || []).push(r);
      }
    }
    const out = {};
    for (const h of Object.keys(grouped)) {
      grouped[h].sort((a, b) => strip(a.HandlingUnitItem).localeCompare(strip(b.HandlingUnitItem)));
      const first = grouped[h][0];
      out[h] = { Plant: first.Plant || '', StorageLocation: first.StorageLocation || '' };
    }
    return out;
  }

  /** Header, weights, dimensions and packed items of one handling unit. Read-only. */
  async detail(input = {}) {
    const hu = clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true);
    const warehouse = clean(input.warehouse, 'Warehouse', RE.warehouse);
    const key = `HandlingUnitExternalID='${hu}',Warehouse='${warehouse}'`;

    // SAP answers a missing key with HTTP 404 and a technical text ("Resource not found for segment
    // 'HandlingUnitType'"); say what it means instead — the HU does not exist (any more), e.g. after a delete.
    const notFound = () => httpError(404, `Handling unit ${hu} was not found in SAP (it may have been deleted)`);
    const h = await this._results(`${DETAIL}(${key})`, { $format: 'json' }, `Read handling unit ${hu}`)
      .catch((e) => { if (e.status === 404) throw notFound(); throw e; });
    if (!h.HandlingUnitExternalID) throw notFound();

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

    // Plant authorization: reject an HU outside the user's plants (looks the same as "not found").
    const huPlant = h.Plant || monitor.Plant || (itemRows[0] && itemRows[0].Plant) || '';
    if (!inPlantScope(input.allowedPlants, huPlant)) {
      throw httpError(403, `Not authorized to view handling unit ${hu}`);
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

    // Plant authorization: resolve this HU's plant (by Char32) from the monitor and reject if outside the user's scope.
    if (Array.isArray(input.allowedPlants)) {
      const m = await this._results(MONITOR, {
        $filter: `HandlingUnitIDChar32 eq '${char32}'`, $select: 'Plant', $top: 1, $format: 'json'
      }, 'Resolve plant for packing tree').catch(() => ({}));
      const row = (m.results || [])[0];
      if (!inPlantScope(input.allowedPlants, row && row.Plant)) {
        throw httpError(403, 'Not authorized to view this handling unit');
      }
    }

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
    let Items = (d.results || []).map((r) => ({ key: r[vh.key] || '', text: r[vh.text] || '' }))
      .filter((x) => x.key && !seen.has(x.key) && seen.add(x.key));
    // Plant authorization: the plant value help only offers the user's own plants (other VHs are generic master data).
    if (kind === 'plant' && Array.isArray(input.allowedPlants)) {
      const set = new Set(input.allowedPlants);
      Items = Items.filter((x) => set.has(String(x.key).trim().toUpperCase()));
    }
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
  async statusKpis(input = {}) {
    const { Items: statuses } = await this.valueHelp({ kind: 'status' });
    const sPlant = plantClause(input.allowedPlants); // '' when unrestricted; scopes counts to the user's plants
    const withPlant = (f) => [sPlant, f].filter(Boolean).join(' and ');
    const Total = await this._count(withPlant(''));
    const Items = [];
    for (const s of statuses) {
      const code = clean(s.key, 'Status', RE.status);
      if (!code) continue;
      Items.push({ code, name: s.text, count: await this._count(withPlant(`HandlingUnitProcessStatus eq '${code}'`)) });
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
    // Plant authorization: the HU's plant is VEKP.WERKS for this VENUM; outside the user's plants -> no serials.
    if (Array.isArray(input.allowedPlants)) {
      const [vekp] = await this.rfc.readTable('VEKP', ['WERKS'], [`VENUM = '${venum}'`]).catch(() => []);
      if (!inPlantScope(input.allowedPlants, vekp && vekp.WERKS)) { return { Items: [] }; }
    }
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

  /**
   * Label fields (first item's material name + first serial number) for a set of HUs in one batched join -
   * the bulk equivalent of calling detail() + serials() per HU, used by label printing. Material comes from the
   * monitor's I_HandlingUnitItemCombined (filterable by HU external id); the serial value comes from the proven
   * SER06 -> OBJK RFC chain, read only for HUs whose item rows report a serial (HandlingUnitNumberOfSerialNumb > 0).
   * Proven live 2026-10-07 (client 220): material + serial parity with detail()/serials(); 100 HUs in ~2.2s / 6
   * SAP calls vs ~79s / 200 calls the per-HU way. Read-only.
   */
  async labels(input = {}) {
    const aInput = [].concat(input.handlingUnitExternalIDs || []);
    if (aInput.length > MAX_LABEL_IDS) {
      throw httpError(400, `Too many handling units requested (${aInput.length}); the maximum is ${MAX_LABEL_IDS} per call`);
    }
    const ids = [...new Set(aInput.map((h) => clean(h, 'Handling unit', RE.hu)).filter(Boolean))];
    if (!ids.length) return { Items: [] };

    // 1. First material name per HU (+ item count, serial count, internal number) from the combined item view.
    const byHu = {};
    for (let i = 0; i < ids.length; i += LABEL_HU_CHUNK) {
      const slice = ids.slice(i, i + LABEL_HU_CHUNK);
      const filter = '(' + slice.map((id) => `HandlingUnitExternalID eq '${id}'`).join(' or ') + ')';
      const d = await this._results(ITEM_COMBINED, {
        $filter: filter, $select: LABEL_ITEM_SELECT, $top: 5000, $format: 'json'
      }, 'Read handling unit items for labels');
      for (const r of d.results || []) {
        const h = strip(r.HandlingUnitExternalID);
        (byHu[h] = byHu[h] || []).push(r);
      }
    }
    // First item = lowest HandlingUnitItem; gather VENUMs of in-scope HUs that actually carry serials.
    // Plant authorization: an HU whose plant is outside the user's scope is treated as having no data.
    const allowed = input.allowedPlants;
    const venums = new Set();
    for (const h of Object.keys(byHu)) {
      byHu[h].sort((a, b) => strip(a.HandlingUnitItem).localeCompare(strip(b.HandlingUnitItem)));
      const serialCount = byHu[h].reduce((s, r) => s + (Number(r.HandlingUnitNumberOfSerialNumb) || 0), 0);
      if (serialCount > 0 && inPlantScope(allowed, byHu[h][0].Plant)) venums.add(strip(byHu[h][0].HandlingUnitInternalID));
    }

    // 2. First serial per HU (only for HUs with serials) via SER06 -> OBJK.
    const serialByVenum = await this._bulkFirstSerial([...venums].filter(Boolean));

    const Items = ids.map((id) => {
      const g = byHu[id] || [];
      const first = g[0] || {};
      const ok = g.length && inPlantScope(allowed, first.Plant); // blank for HUs outside the user's plants
      const name = (first.MaterialName || strip(first.Material) || '') + (g.length > 1 ? ` +${g.length - 1} more` : '');
      return {
        HandlingUnitExternalID: id,
        MaterialName: ok ? name : '',
        SerialNumber: ok ? (serialByVenum[strip(first.HandlingUnitInternalID)] || '') : ''
      };
    });
    return { Items };
  }

  /** First serial number per HU internal number (VENUM) via SER06 -> OBJK, OR-batched. {} when none. */
  async _bulkFirstSerial(venums) {
    const out = {};
    if (!venums.length) return out;
    const padded = venums.map((v) => String(v).padStart(10, '0'));
    const obknrToVenum = {};
    for (let i = 0; i < padded.length; i += SERIAL_RFC_CHUNK) {
      const or = padded.slice(i, i + SERIAL_RFC_CHUNK).map((v, n) => `${n ? 'OR ' : '( '}VENUM = '${v}'`);
      const rows = await this.rfc.readTable('SER06', ['OBKNR', 'VENUM'], [...or, ')']);
      for (const r of rows) if (r.OBKNR) obknrToVenum[r.OBKNR] = r.VENUM;
    }
    const obknrs = Object.keys(obknrToVenum);
    for (let i = 0; i < obknrs.length; i += SERIAL_RFC_CHUNK) {
      const or = obknrs.slice(i, i + SERIAL_RFC_CHUNK).map((o, n) => `${n ? 'OR ' : '( '}OBKNR = '${o}'`);
      const rows = await this.rfc.readTable('OBJK', ['OBKNR', 'SERNR'], [...or, ')']);
      for (const r of rows) { if (!r.SERNR) continue; const v = strip(obknrToVenum[r.OBKNR]); if (!out[v]) out[v] = r.SERNR; }
    }
    return out;
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

  /** Reject a target plant outside the user's scope (create). No-op for Admin (allowed === null). */
  _assertPlantAllowed(plant, allowed) {
    if (Array.isArray(allowed) && !inPlantScope(allowed, plant)) {
      throw httpError(403, `Not authorized for plant ${plant}`);
    }
  }

  /** Reject a write against an HU whose plant (VEKP.WERKS by EXIDV) is outside the user's scope (pack/unpack/remove). */
  async _assertHuInScope(key, allowed) {
    if (!Array.isArray(allowed)) return; // Admin: unrestricted
    const [vekp] = await this.rfc.readTable('VEKP', ['WERKS'], [`EXIDV = '${key}'`]).catch(() => []);
    if (!inPlantScope(allowed, vekp && vekp.WERKS)) {
      throw httpError(403, `Not authorized to change handling unit ${strip(key)}`);
    }
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
    const plant = clean(input.plant, 'Plant', RE.plant, true);
    this._assertPlantAllowed(plant, input.allowedPlants); // cannot create in a plant outside the user's scope
    const header = {
      PACK_MAT: pad18(clean(input.packagingMaterial, 'Packaging material', RE.material, true)),
      PLANT: plant,
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
    await this._assertHuInScope(key, input.allowedPlants); // cannot pack into an HU outside the user's plants
    const item = { HU_ITEM_TYPE: '1', ...this._itemFields(input) };
    return this._bapi('Pack handling unit item', (call) => call('BAPI_HU_PACK', { HUKEY: key, ITEMPROPOSAL: item }), key);
  }

  /** Unpack one material item (by HU item number) from the handling unit. */
  async unpack(input = {}) {
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    await this._assertHuInScope(key, input.allowedPlants); // cannot unpack from an HU outside the user's plants
    const item = { HU_ITEM_TYPE: '1', HU_ITEM_NUMBER: clean(input.item, 'Item', RE.item, true).padStart(6, '0'), ...this._itemFields(input) };
    return this._bapi('Unpack handling unit item', (call) => call('BAPI_HU_UNPACK', { HUKEY: key, ITEMUNPACK: item }), key);
  }

  /** Delete a handling unit (SAP removes the VEKP row; packed items make SAP refuse). */
  async remove(input = {}) {
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    await this._assertHuInScope(key, input.allowedPlants); // cannot delete an HU outside the user's plants
    const r = await this._bapi('Delete handling unit', (call) => call('BAPI_HU_DELETE', { HUKEY: key }), key);
    if (!r.Deleted) throw httpError(502, 'Delete handling unit: SAP did not delete the handling unit');
    return r;
  }
}

module.exports = HandlingUnitAdapter;
