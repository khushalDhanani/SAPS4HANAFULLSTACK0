'use strict';

const { formatDateToYMD } = require('../../../common/dateUtils');
const { strip, num, plantClause, clean, RE } = require('./handlingUnitUtils');

const MONITOR = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/HandlingUnit';
const ITEM_COMBINED = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/I_HandlingUnitItemCombined';
const PAGE = 1000;
const MAX_LIST = 1000;
const LABEL_HU_CHUNK = 50;

const LIST_ITEM_PLANT_SELECT = 'HandlingUnitExternalID,HandlingUnitItem,Plant,StorageLocation';
const LIST_SELECT = [
  'HandlingUnitExternalID', 'Warehouse', 'WarehouseName', 'HandlingUnitIDChar32', 'HandlingUnitOrigin',
  'PackagingMaterial', 'PackagingMaterialName', 'Plant', 'PlantName', 'StorageLocation', 'StorageLocationName',
  'StorageType', 'StorageBin', 'ParentHandlingUnitNumber', 'GrossWeight', 'NetWeight', 'WeightUnit',
  'GrossVolume', 'VolumeUnit', 'HandlingUnitProcessStatus', 'HandlingUnitProcessStatusText',
  'HandlingUnitReferenceDocument', 'CreatedByUser', 'CreationDateTime'
].join(',');

class HandlingUnitListReader {
  constructor(options = {}) {
    this.results = options.results;
    this.huPlantSlocCache = options.huPlantSlocCache;
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

    const cap = Math.min(MAX_LIST, Math.max(1, Math.floor(Number(input.limit)) || MAX_LIST));
    const rows = [];
    let sapCount = 0;
    do {
      const top = Math.min(PAGE, cap - rows.length);
      const d = await this.results(MONITOR, { ...params, $top: top, $skip: rows.length }, 'Read handling units');
      sapCount = Number(d.__count || 0);
      if (!(d.results || []).length) break;
      rows.push(...d.results);
    } while (rows.length < sapCount && rows.length < cap);

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

    // Fill blank plant / storage location from first HU item
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
   * First item's Plant/StorageLocation per HU external id from I_HandlingUnitItemCombined.
   */
  async _firstItemPlantSloc(ids) {
    const out = {};
    const missing = [];
    for (const rawId of ids) {
      const h = strip(rawId);
      const cached = this.huPlantSlocCache ? this.huPlantSlocCache.get(h) : null;
      if (cached) {
        out[h] = cached;
      } else {
        missing.push(h);
      }
    }
    if (!missing.length) return out;

    const grouped = {};
    const slices = [];
    for (let i = 0; i < missing.length; i += LABEL_HU_CHUNK) {
      slices.push(missing.slice(i, i + LABEL_HU_CHUNK));
    }

    const fetchChunk = async (slice) => {
      const filter = '(' + slice.map((id) => `HandlingUnitExternalID eq '${id}'`).join(' or ') + ')';
      try {
        const d = await this.results(ITEM_COMBINED, { $filter: filter, $select: LIST_ITEM_PLANT_SELECT, $top: 5000, $format: 'json' }, 'Read handling unit items for plant/sloc');
        for (const r of d.results || []) {
          const h = strip(r.HandlingUnitExternalID);
          (grouped[h] = grouped[h] || []).push(r);
        }
      } catch (_e) { /* best-effort enrichment */ }
    };

    const concurrency = 6;
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, slices.length) }, async () => {
      while (idx < slices.length) {
        const slice = slices[idx++];
        await fetchChunk(slice);
      }
    });
    await Promise.all(workers);

    for (const h of Object.keys(grouped)) {
      grouped[h].sort((a, b) => strip(a.HandlingUnitItem).localeCompare(strip(b.HandlingUnitItem)));
      const first = grouped[h][0];
      const val = { Plant: first.Plant || '', StorageLocation: first.StorageLocation || '' };
      out[h] = val;
      if (this.huPlantSlocCache) this.huPlantSlocCache.set(h, val);
    }
    return out;
  }
}

module.exports = HandlingUnitListReader;
