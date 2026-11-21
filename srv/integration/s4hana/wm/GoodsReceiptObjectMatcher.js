'use strict';

/**
 * GoodsReceiptObjectMatcher
 *
 * Matches scanned barcodes against business objects & fallbacks:
 *   - Tier 3: Batch (LO_BM_BATCH_SRV/I_Batch + linked delivery/PO check)
 *   - Tier 4: Material (HMmimGr4inbdelSet / PoHelpSet)
 *   - Tier 5: Production Order (MMIMProductionOrderVH)
 *   - Tier 6: Fallback (Top 50 active inbound deliveries)
 */

const LOG = require('../logger')('goods-receipt-adapter');
const { odataString } = require('../../../common/filterUtils');
const { emptyMatch } = require('./GoodsReceiptDocumentMatcher');

async function matchBatch(adapter, sCleanScan) {
  try {
    const filter = `Batch eq ${odataString(sCleanScan)}`;
    const batchRes = await adapter._get(
      '/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch',
      `$filter=${encodeURIComponent(filter)}&$top=5&$format=json`
    );
    const batchList = Array.isArray(batchRes) ? batchRes : (batchRes ? [batchRes] : []);
    if (!batchList.length) return null;

    const b = batchList[0];
    const match = emptyMatch();
    match.scannedType = 'BATCH';
    match.scannedTypeLabel = 'Batch';
    match.targetBatch = b.Batch;
    match.targetExpiryDate = adapter._formatDate(b.ShelfLifeExpirationDate);
    const bStatus = adapter._enrichBatchStatus(b.ShelfLifeExpirationDate);
    match.targetBatchStatusState = bStatus.StatusState;
    match.targetBatchStatusText = bStatus.StatusText;
    match.resolvedMaterial = b.Material;
    match.resolvedPlant = b.Plant || '';

    try {
      const matFilter = `Material eq ${odataString(match.resolvedMaterial)}`;
      const matDelRes = await adapter._get(
        '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
        `$filter=${encodeURIComponent(matFilter)}&$top=1&$format=json`
      );
      const matDelList = Array.isArray(matDelRes) ? matDelRes : (matDelRes ? [matDelRes] : []);
      if (matDelList.length > 0) {
        const md = matDelList[0];
        match.resolvedDelivery = md.DeliveryDocument;
        match.resolvedDeliveryItem = md.DeliveryDocumentItem || '';
        match.resolvedPO = md.PurchaseOrder || '';
        match.resolvedPOItem = md.PurchaseOrderItem || '';
        match.resolvedMaterialName = md.DeliveryDocumentItemText || '';
        match.resolvedPlant = md.Plant;
        match.resolvedPlantName = md.PlantName || '';
        match.resolvedSupplier = md.Supplier || '';
        match.resolvedSupplierName = md.SupplierName || '';
        match.resolvedSupplierCity = md.SupplierCityName || '';
      } else {
        const poFilter = `Material eq ${odataString(match.resolvedMaterial)}`;
        const poRes = await adapter._get(
          '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
          `$filter=${encodeURIComponent(poFilter)}&$top=1&$format=json`
        );
        const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
        if (poList.length > 0) {
          const po = poList[0];
          match.resolvedPO = po.PurchaseOrder;
          match.resolvedPOItem = po.PurchaseOrderItem || '';
          match.resolvedMaterialName = po.PurchaseOrderItemText || '';
          match.resolvedPlant = po.Plant;
          match.resolvedPlantName = po.PlantName || '';
          match.resolvedSupplier = po.Supplier || '';
          match.resolvedSupplierName = po.SupplierName || '';
          match.resolvedSupplierCity = po.SupplierCityName || '';
        }
      }
    } catch (innerErr) {
      if (adapter._isOutage(innerErr)) throw innerErr;
      LOG.warn(`Batch material link lookup failed for ${match.resolvedMaterial}: ${innerErr.message}`);
    }
    return match;
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Tier 3 Batch check failed for ${sCleanScan}: ${err.message}`);
    return null;
  }
}

async function matchMaterial(adapter, sCleanScan) {
  try {
    const filter = `Material eq ${odataString(sCleanScan)}`;
    const matDelRes = await adapter._get(
      '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
      `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
    );
    const matDelList = Array.isArray(matDelRes) ? matDelRes : (matDelRes ? [matDelRes] : []);
    if (matDelList.length > 0) {
      const md = matDelList[0];
      const match = emptyMatch();
      match.scannedType = 'MATERIAL';
      match.scannedTypeLabel = 'Material / Product';
      match.resolvedMaterial = md.Material;
      match.resolvedMaterialName = md.DeliveryDocumentItemText || '';
      match.resolvedDelivery = md.DeliveryDocument;
      match.resolvedDeliveryItem = md.DeliveryDocumentItem || '';
      match.resolvedPO = md.PurchaseOrder || '';
      match.resolvedPOItem = md.PurchaseOrderItem || '';
      match.resolvedPlant = md.Plant;
      match.resolvedPlantName = md.PlantName || '';
      match.resolvedSupplier = md.Supplier || '';
      match.resolvedSupplierName = md.SupplierName || '';
      match.resolvedSupplierCity = md.SupplierCityName || '';
      return match;
    }

    const poRes = await adapter._get(
      '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
      `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
    );
    const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
    if (poList.length > 0) {
      const po = poList[0];
      const match = emptyMatch();
      match.scannedType = 'MATERIAL';
      match.scannedTypeLabel = 'Material / Product';
      match.resolvedMaterial = po.Material;
      match.resolvedMaterialName = po.PurchaseOrderItemText || '';
      match.resolvedPO = po.PurchaseOrder;
      match.resolvedPOItem = po.PurchaseOrderItem || '';
      match.resolvedPlant = po.Plant;
      match.resolvedPlantName = po.PlantName || '';
      match.resolvedSupplier = po.Supplier || '';
      match.resolvedSupplierName = po.SupplierName || '';
      match.resolvedSupplierCity = po.SupplierCityName || '';
      return match;
    }
    return null;
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Tier 4 Material check failed for ${sCleanScan}: ${err.message}`);
    return null;
  }
}

async function matchProductionOrder(adapter, sCleanScan) {
  try {
    const filter = `ManufacturingOrder eq ${odataString(sCleanScan)}`;
    const prodRes = await adapter._get(
      '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/MMIMProductionOrderVH',
      `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
    );
    const prodList = Array.isArray(prodRes) ? prodRes : (prodRes ? [prodRes] : []);
    if (prodList.length > 0) {
      const pr = prodList[0];
      const match = emptyMatch();
      match.scannedType = 'PRODUCTION_ORDER';
      match.scannedTypeLabel = 'Production Order';
      match.resolvedMaterial = pr.Material || '';
      match.resolvedPlant = pr.ProductionPlant || '';
      return match;
    }
    return null;
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Tier 5 Production Order check failed for ${sCleanScan}: ${err.message}`);
    return null;
  }
}

async function matchDeliveryFallback(adapter, sCleanScan) {
  try {
    const allRes = await adapter._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet', '$top=50&$format=json');
    const allList = Array.isArray(allRes) ? allRes : (allRes ? [allRes] : []);
    const matched = allList.find((d) =>
      d.DeliveryDocument === sCleanScan ||
      d.PurchaseOrder === sCleanScan ||
      d.Material === sCleanScan
    );
    if (matched) {
      const match = emptyMatch();
      match.scannedType = 'STORAGE_UNIT';
      match.scannedTypeLabel = 'Storage Unit';
      match.resolvedDelivery = matched.DeliveryDocument;
      match.resolvedDeliveryItem = matched.DeliveryDocumentItem || '';
      match.resolvedPO = matched.PurchaseOrder || '';
      match.resolvedPOItem = matched.PurchaseOrderItem || '';
      match.resolvedMaterial = matched.Material;
      match.resolvedMaterialName = matched.DeliveryDocumentItemText || '';
      match.resolvedPlant = matched.Plant;
      match.resolvedPlantName = matched.PlantName || '';
      match.resolvedSupplier = matched.Supplier || '';
      match.resolvedSupplierName = matched.SupplierName || '';
      match.resolvedSupplierCity = matched.SupplierCityName || '';
      return match;
    }
    return null;
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Tier 6 Fallback check failed for ${sCleanScan}: ${err.message}`);
    return null;
  }
}

module.exports = {
  matchBatch,
  matchMaterial,
  matchProductionOrder,
  matchDeliveryFallback,
};
