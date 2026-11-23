'use strict';

const { formatDateToYMD } = require('../../../common/dateUtils');
const { strip, num, httpError, inPlantScope, clean, RE } = require('./handlingUnitUtils');

const DETAIL = '/sap/opu/odata/sap/API_HANDLING_UNIT/HandlingUnit';
const MONITOR = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/HandlingUnit';

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

class HandlingUnitDetailReader {
  constructor(options = {}) {
    this.results = options.results;
  }

  /** Header, weights, dimensions and packed items of one handling unit. Read-only. */
  async detail(input = {}) {
    const hu = clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true);
    const warehouse = clean(input.warehouse, 'Warehouse', RE.warehouse);
    const key = `HandlingUnitExternalID='${hu}',Warehouse='${warehouse}'`;

    const notFound = () => httpError(404, `Handling unit ${hu} was not found in SAP (it may have been deleted)`);
    const h = await this.results(`${DETAIL}(${key})`, { $format: 'json' }, `Read handling unit ${hu}`)
      .catch((e) => { if (e.status === 404) throw notFound(); throw e; });
    if (!h.HandlingUnitExternalID) throw notFound();

    let itemRows = [];
    try {
      const monItems = await this.results(`${MONITOR}(${key})/to_HandlingUnitItem`, {
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
      const apiItems = await this.results(`${DETAIL}(${key})/to_HandlingUnitItem`, { $format: 'json' }, `Read items of handling unit ${hu}`);
      itemRows = apiItems.results || [];
    }

    let monitor = {};
    try {
      const m = await this.results(MONITOR, {
        $filter: `HandlingUnitExternalID eq '${hu}'`,
        $select: DETAIL_MONITOR_SELECT,
        $top: 1,
        $format: 'json'
      }, `Resolve metadata of handling unit ${hu}`);
      monitor = (m.results || [])[0] || {};
    } catch {
      // Keep monitor as {} if query fails
    }

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
}

module.exports = HandlingUnitDetailReader;
