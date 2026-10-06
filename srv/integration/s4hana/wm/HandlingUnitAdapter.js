'use strict';

const LOG = require('../logger')('handling-unit-adapter');
const { S4HttpClient } = require('../S4HttpClient');
const { formatDateToYMD } = require('../../../common/dateUtils');

/**
 * Read-only Handling Unit cockpit. GET only — proven live 2026-10-06 against client 220:
 *  - C_HANDLINGUNITMONITOR_CDS/HandlingUnit : list / KPIs (17,440 HUs). Plain entity set, $filter/$top.
 *  - API_HANDLING_UNIT/HandlingUnit(HandlingUnitExternalID,Warehouse) + to_HandlingUnitItem : header, weights,
 *    dimensions, reference document and the packed items. Metadata: both entity sets sap:creatable/updatable/
 *    deletable = false and there are zero FunctionImports, so this service has NO write capability here.
 *  - UI_HANDLINGUNITHIERNODE/C_HandlingUnitHierarchyNode(P_HandlingUnitOrigin,P_HandlingUnitIDChar32)/Set :
 *    recursive packing tree (Node / ParentNode / HierarchyLevel).
 * SAP applies the plant / warehouse authorizations of the calling user in every service.
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

const RE = {
  plant: /^[A-Z0-9]{1,4}$/,
  warehouse: /^[A-Z0-9]{1,4}$/,
  material: /^[A-Z0-9][A-Z0-9_./-]{0,39}$/,
  hu: /^[A-Z0-9]{1,20}$/,
  char32: /^[0-9A-F]{32}$/,
  origin: /^[A-Z]{1,10}$/,
  status: /^[A-Z0-9]$/,
  vhKind: /^[A-Z]+$/i
};

/** Filter-bar value helps: the monitor value-help set and its key/text fields. kind is the only input. */
const VALUE_HELP = {
  plant: { set: 'C_PlantVH', key: 'Plant', text: 'PlantName' },
  packaging: { set: 'C_PackagingMaterialVH', key: 'PackagingMaterial', text: 'PackagingMaterialName' },
  status: { set: 'C_HandlingUnitStatusVH', key: 'HandlingUnitStat', text: 'HandlingUnitStatusName' },
  shippingpoint: { set: 'C_ShippingPointVH', key: 'ShippingPoint', text: 'ShippingPointName' }
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

class HandlingUnitAdapter {
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
    const i = await this._results(`${DETAIL}(${key})/to_HandlingUnitItem`, { $format: 'json' }, `Read items of handling unit ${hu}`);

    // API_HANDLING_UNIT does not return the Char32 id the packing tree needs; resolve it from the monitor so
    // the detail page (and a deep link / refresh) can always load the hierarchy without a URL query param.
    const m = await this._results(MONITOR, {
      $filter: `HandlingUnitExternalID eq '${hu}'`,
      $select: 'HandlingUnitIDChar32,HandlingUnitOrigin',
      $top: 1,
      $format: 'json'
    }, `Resolve id of handling unit ${hu}`);
    const monitor = (m.results || [])[0] || {};

    const Items = (i.results || []).map((it) => ({
      HandlingUnitItem: strip(it.HandlingUnitItem),
      Material: strip(it.Material),
      Quantity: num(it.HandlingUnitQuantity),
      Unit: it.HandlingUnitQuantityUnit || '',
      ReferenceDocument: strip(it.HandlingUnitReferenceDocument),
      ReferenceDocumentItem: strip(it.HandlingUnitRefDocumentItem),
      ShelfLifeExpirationDate: formatDateToYMD(it.ShelfLifeExpirationDate),
      GoodsReceiptDate: formatDateToYMD(it.HandlingUnitGoodsReceiptDate)
    }));

    return {
      HandlingUnitExternalID: strip(h.HandlingUnitExternalID),
      HandlingUnitIDChar32: monitor.HandlingUnitIDChar32 || '',
      HandlingUnitOrigin: monitor.HandlingUnitOrigin || '',
      Warehouse: h.Warehouse || '',
      PackagingMaterial: strip(h.PackagingMaterial),
      PackagingMaterialType: h.PackagingMaterialType || '',
      Plant: h.Plant || '',
      StorageLocation: h.StorageLocation || '',
      StorageType: h.StorageType || '',
      StorageBin: strip(h.StorageBin),
      ShippingPoint: h.ShippingPoint || '',
      ParentHandlingUnit: strip(h.ParentHandlingUnitNumber),
      GrossWeight: num(h.GrossWeight),
      NetWeight: num(h.NetWeight),
      TareWeight: num(h.HandlingUnitTareWeight),
      MaxWeight: num(h.HandlingUnitMaxWeight),
      WeightUnit: h.WeightUnit || '',
      GrossVolume: num(h.GrossVolume),
      NetVolume: num(h.HandlingUnitNetVolume),
      TareVolume: num(h.HandlingUnitTareVolume),
      MaxVolume: num(h.HandlingUnitMaxVolume),
      VolumeUnit: h.VolumeUnit || '',
      Length: num(h.HandlingUnitLength),
      Width: num(h.HandlingUnitWidth),
      Height: num(h.HandlingUnitHeight),
      DimensionUnit: h.UnitOfMeasureDimension || '',
      PackingObjectKey: h.HandlingUnitPackingObjectKey || '',
      ReferenceDocument: strip(h.HandlingUnitReferenceDocument),
      Status: h.HandlingUnitProcessStatus || '',
      CreatedByUser: h.CreatedByUser || '',
      CreationDateTime: formatDateToYMD(h.CreationDateTime),
      LastChangedByUser: h.LastChangedByUser || '',
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
    return {
      // Keys go straight into a $filter eq, so keep SAP's stored format (e.g. plant '0001') — do not strip.
      Items: (d.results || []).map((r) => ({ key: r[vh.key] || '', text: r[vh.text] || '' })).filter((x) => x.key)
    };
  }
}

module.exports = HandlingUnitAdapter;
