'use strict';

/**
 * GoodsReceiptItemEnricher
 *
 * Post-resolution enricher for Goods Receipt storage units:
 *   - Material storage locations & warehouse bins
 *   - Available batches & shelf life expiration dates (SLED)
 *   - Open / ordered quantities from MMIM_GR4PO_DL_SRV/GR4PO_DL_Items
 */

const LOG = require('../logger')('goods-receipt-adapter');

/**
 * Enriches resolved barcode match with storage locations, batches, and item details.
 * @param {object} adapter
 * @param {string} sCleanScan
 * @param {object} scanData
 * @returns {Promise<object>}
 */
async function enrichStorageUnitItem(adapter, sCleanScan, scanData) {
  const {
    scannedType,
    scannedTypeLabel,
    resolvedPackagingMaterial,
    resolvedStorageUnitType,
    resolvedSupplier,
    resolvedSupplierName,
    resolvedSupplierCity,
    targetBatch,
    targetExpiryDate,
    targetBatchStatusState,
    targetBatchStatusText,
  } = scanData;

  let {
    resolvedDelivery,
    resolvedDeliveryItem,
    resolvedPO,
    resolvedPOItem,
    resolvedMaterial,
    resolvedMaterialName,
    resolvedPlant,
    resolvedPlantName,
    resolvedUnit,
    resolvedWarehouseNumber,
    defaultSLoc,
    defaultSLocName,
    defaultBin,
    proposedQuantity,
  } = scanData;

  const lookupWarnings = [];

  // Retrieve authentic Storage Locations & Bins (pick list only; nothing is pre-selected from it)
  let storageLocations = [];
  try {
    storageLocations = await adapter.getMaterialStorageLocations(resolvedMaterial, resolvedPlant);
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Material storage locations lookup failed for ${resolvedMaterial}: ${err.message}`);
    lookupWarnings.push(`Storage locations could not be read from SAP: ${err.message}`);
  }

  // Retrieve authentic Batches & SLED (pick list only; the batch comes from the scan or the document, never batches[0])
  let batches = [];
  try {
    batches = await adapter.getMaterialBatches(resolvedMaterial, resolvedPlant, defaultSLoc);
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Material batches lookup failed for ${resolvedMaterial}: ${err.message}`);
    lookupWarnings.push(`Batches could not be read from SAP: ${err.message}`);
  }
  let selectedBatch = targetBatch;
  let expiryDate = targetExpiryDate;
  let batchStatusState = targetBatchStatusState;
  let batchStatusText = targetBatchStatusText;

  // Retrieve authentic Goods Receipt item details (OpenQuantity, OrderedQuantity, Unit) from MMIM_GR4PO_DL_SRV/GR4PO_DL_Items
  let grItem = null;
  try {
    grItem = await adapter.getGoodsReceiptItem(resolvedDelivery, resolvedDeliveryItem, resolvedPO, resolvedPOItem);
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Goods receipt item lookup failed: ${err.message}`);
    lookupWarnings.push(`Open quantity could not be read from SAP: ${err.message}`);
  }
  let authenticOpenQuantity = null;
  let authenticOrderedQuantity = null;
  let authenticQuantityInEntryUnit = null;
  let deliveryQuantity = null;
  let deliveryDate = '';
  let goodsMovementStatus = '';

  if (grItem) {
    authenticOpenQuantity = (grItem.OpenQuantity !== undefined && grItem.OpenQuantity !== null && !isNaN(grItem.OpenQuantity)) ? grItem.OpenQuantity : null;
    authenticOrderedQuantity = (grItem.OrderedQuantity !== undefined && grItem.OrderedQuantity !== null && !isNaN(grItem.OrderedQuantity)) ? grItem.OrderedQuantity : null;
    authenticQuantityInEntryUnit = (grItem.QuantityInEntryUnit !== undefined && grItem.QuantityInEntryUnit !== null && !isNaN(grItem.QuantityInEntryUnit)) ? grItem.QuantityInEntryUnit : null;
    // Proposed quantity is SAP's open quantity and nothing else: an item with 0 open must not propose the ordered quantity again.
    if (proposedQuantity === null) {
      proposedQuantity = authenticOpenQuantity;
    }
    if (grItem.Unit && !resolvedUnit) resolvedUnit = grItem.Unit;
    if (grItem.StorageLocation) {
      defaultSLoc = grItem.StorageLocation;
      if (grItem.StorageLocationName) defaultSLocName = grItem.StorageLocationName;
    }
    if (grItem.WarehouseStorageBin && !defaultBin) defaultBin = grItem.WarehouseStorageBin;
    if (grItem.WarehouseNumber && !resolvedWarehouseNumber) resolvedWarehouseNumber = grItem.WarehouseNumber;
    deliveryQuantity = (grItem.DeliveryQuantity !== undefined && grItem.DeliveryQuantity !== null && !isNaN(grItem.DeliveryQuantity)) ? grItem.DeliveryQuantity : null;
    deliveryDate = grItem.DeliveryDate || '';
    goodsMovementStatus = grItem.GoodsMovementStatus || '';
    if (grItem.Batch && !selectedBatch) {
      selectedBatch = grItem.Batch;
      const docBatch = batches.find((b) => b.Batch === grItem.Batch);
      if (docBatch) {
        expiryDate = docBatch.ExpiryDate;
        batchStatusState = docBatch.StatusState;
        batchStatusText = docBatch.StatusText;
      }
    }
    if (grItem.DeliveryDocumentItem && !resolvedPOItem && grItem.SourceOfGR === 'PURORD') {
      resolvedPOItem = grItem.DeliveryDocumentItem;
    }
  }

  // Ensure defaultSLoc has a matching name and is guaranteed in the availableStorageLocations picker list
  if (defaultSLoc) {
    const match = storageLocations.find((s) => s.StorageLocation === defaultSLoc);
    if (match && !defaultSLocName) {
      defaultSLocName = match.StorageLocationName;
    }
    if (!match) {
      storageLocations.unshift({
        Plant: resolvedPlant || '',
        PlantName: resolvedPlantName || '',
        StorageLocation: defaultSLoc,
        StorageLocationName: defaultSLocName || '',
        WarehouseStorageBin: defaultBin || '',
        CurrentStock: null,
        BaseUnit: '',
      });
    }
  }

  // Unit only from the scanned object or the document item; a first storage location's or batch's unit is not this item's unit.
  const effectiveUnit = resolvedUnit || (grItem && grItem.Unit) || '';

  return {
    StorageUnit: resolvedDelivery || sCleanScan,
    ScannedBarcode: sCleanScan,
    ScannedType: scannedType,
    ScannedTypeLabel: scannedTypeLabel,
    DeliveryDocument: resolvedDelivery,
    DeliveryDocumentItem: resolvedDeliveryItem,
    PurchaseOrder: resolvedPO,
    PurchaseOrderItem: resolvedPOItem,
    Material: resolvedMaterial,
    MaterialName: resolvedMaterialName || '',
    Plant: resolvedPlant,
    PlantName: resolvedPlantName || '',
    StorageLocation: defaultSLoc,
    StorageLocationName: defaultSLocName,
    WarehouseStorageBin: defaultBin,
    Batch: selectedBatch,
    ExpiryDate: expiryDate,
    BatchStatusState: batchStatusState,
    BatchStatusText: batchStatusText,
    Quantity: proposedQuantity,
    OpenQuantity: authenticOpenQuantity,
    OrderedQuantity: authenticOrderedQuantity,
    QuantityInEntryUnit: authenticQuantityInEntryUnit,
    Unit: effectiveUnit,
    Supplier: resolvedSupplier,
    SupplierName: resolvedSupplierName,
    SupplierCityName: resolvedSupplierCity,
    PackagingMaterial: resolvedPackagingMaterial,
    StorageUnitType: resolvedStorageUnitType,
    WarehouseNumber: resolvedWarehouseNumber,
    DeliveryQuantity: deliveryQuantity,
    DeliveryDate: deliveryDate,
    GoodsMovementStatus: goodsMovementStatus,
    AvailableStorageLocations: storageLocations,
    AvailableBatches: batches,
    LookupWarnings: lookupWarnings,
  };
}

module.exports = {
  enrichStorageUnitItem,
};
