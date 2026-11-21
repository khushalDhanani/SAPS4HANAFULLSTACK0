'use strict';

/**
 * GoodsReceiptDocumentMatcher
 *
 * Matches scanned barcodes against document & unit entities:
 *   - Tier 0: Storage Unit / Handling Unit (VEKP / VEPO / LIPS via RFC)
 *   - Tier 1: Inbound Delivery (HMmimGr4inbdelSet via OData)
 *   - Tier 2: Purchase Order (PoHelpSet + linked delivery check via OData)
 */

const LOG = require('../logger')('goods-receipt-adapter');
const { odataString } = require('../../../common/filterUtils');

function emptyMatch() {
  return {
    scannedType: '',
    scannedTypeLabel: '',
    resolvedDelivery: '',
    resolvedDeliveryItem: '',
    resolvedPO: '',
    resolvedPOItem: '',
    resolvedMaterial: '',
    resolvedMaterialName: '',
    resolvedPlant: '',
    resolvedPlantName: '',
    resolvedSupplier: '',
    resolvedSupplierName: '',
    resolvedSupplierCity: '',
    targetBatch: '',
    targetExpiryDate: '',
    targetBatchStatusState: 'None',
    targetBatchStatusText: 'NO BATCH',
    resolvedUnit: '',
    resolvedPackagingMaterial: '',
    resolvedStorageUnitType: '',
    resolvedWarehouseNumber: '',
    defaultSLoc: '',
    defaultSLocName: '',
    defaultBin: '',
    proposedQuantity: null,
  };
}

async function matchHandlingUnit(adapter, sCleanScan) {
  if (!adapter.rfc || typeof adapter.rfc.readTable !== 'function' || (adapter.rfc.isAvailable && !adapter.rfc.isAvailable())) {
    return null;
  }
  try {
    const sPaddedSU = (/^\d+$/.test(sCleanScan) && sCleanScan.length < 20) ? sCleanScan.padStart(20, '0') : sCleanScan;
    const vekpRows = await adapter.rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHILM', 'STATUS', 'VPOBJ', 'VPOBJKEY'], [
      `EXIDV = '${sPaddedSU}' OR EXIDV = '${sCleanScan}'`,
    ]);
    if (!vekpRows.length) return null;

    const hu = vekpRows[0];
    const match = emptyMatch();
    match.scannedType = 'STORAGE_UNIT';
    match.scannedTypeLabel = 'Storage Unit';
    match.resolvedPackagingMaterial = hu.VHILM ? hu.VHILM.replace(/^0+/, '') : '';

    const vepoRows = await adapter.rfc.readTable('VEPO', ['VENUM', 'VEPOS', 'VBELN', 'POSNR', 'MATNR', 'CHARG', 'VEMNG', 'VEMEH'], [
      `VENUM = '${hu.VENUM}'`,
    ]);
    if (vepoRows.length > 0) {
      const vi = vepoRows[0];
      match.resolvedDelivery = vi.VBELN || (hu.VPOBJKEY || '');
      match.resolvedDeliveryItem = vi.POSNR || '';
      match.resolvedMaterial = vi.MATNR ? vi.MATNR.replace(/^0+/, '') : '';
      match.targetBatch = vi.CHARG || '';
      match.resolvedUnit = vi.VEMEH || '';
      match.proposedQuantity = Number(vi.VEMNG) || null;

      if (match.resolvedDelivery && match.resolvedDeliveryItem) {
        const lipsRows = await adapter.rfc.readTable('LIPS', ['VBELN', 'POSNR', 'WERKS', 'LGORT', 'VGBEL', 'VGPOS', 'ARKTX'], [
          `VBELN = '${match.resolvedDelivery}' AND POSNR = '${match.resolvedDeliveryItem}'`,
        ]);
        if (lipsRows.length > 0) {
          const li = lipsRows[0];
          match.resolvedPlant = li.WERKS || '';
          match.defaultSLoc = li.LGORT || '';
          match.resolvedPO = li.VGBEL || '';
          match.resolvedPOItem = li.VGPOS || '';
          match.resolvedMaterialName = li.ARKTX || '';
        }
      }
    }
    return match;
  } catch (huErr) {
    if (adapter._isOutage(huErr)) throw huErr;
    LOG.warn(`Tier 0 Handling Unit lookup failed for ${sCleanScan}: ${huErr.message}`);
    return null;
  }
}

async function matchInboundDelivery(adapter, sCleanScan) {
  try {
    const filter = `DeliveryDocument eq ${odataString(sCleanScan)}`;
    const delRes = await adapter._get(
      '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
      `$filter=${encodeURIComponent(filter)}&$format=json`
    );
    const delList = Array.isArray(delRes) ? delRes : (delRes ? [delRes] : []);
    if (!delList.length) return null;

    const d = delList[0];
    const match = emptyMatch();
    match.scannedType = 'INBOUND_DELIVERY';
    match.scannedTypeLabel = 'Inbound Delivery';
    match.resolvedDelivery = d.DeliveryDocument;
    match.resolvedDeliveryItem = d.DeliveryDocumentItem || '';
    match.resolvedPO = d.PurchaseOrder || '';
    match.resolvedPOItem = d.PurchaseOrderItem || '';
    match.resolvedMaterial = d.Material;
    match.resolvedMaterialName = d.DeliveryDocumentItemText || '';
    match.resolvedPlant = d.Plant;
    match.resolvedPlantName = d.PlantName || '';
    match.resolvedSupplier = d.Supplier || '';
    match.resolvedSupplierName = d.SupplierName || '';
    match.resolvedSupplierCity = d.SupplierCityName || '';
    if (d.DeliveryQuantityUnit || d.UnitOfMeasure || d.BaseUnit) {
      match.resolvedUnit = d.DeliveryQuantityUnit || d.UnitOfMeasure || d.BaseUnit;
    }
    return match;
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Tier 1 Inbound Delivery lookup failed for ${sCleanScan}: ${err.message}`);
    return null;
  }
}

async function matchPurchaseOrder(adapter, sCleanScan) {
  try {
    const filter = `PurchaseOrder eq ${odataString(sCleanScan)}`;
    const poRes = await adapter._get(
      '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
      `$filter=${encodeURIComponent(filter)}&$top=5&$format=json`
    );
    const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
    if (!poList.length) return null;

    const po = poList[0];
    const match = emptyMatch();
    match.scannedType = 'PURCHASE_ORDER';
    match.scannedTypeLabel = 'Purchase Order';
    match.resolvedPO = po.PurchaseOrder;
    match.resolvedPOItem = po.PurchaseOrderItem || '';
    match.resolvedMaterial = po.Material;
    match.resolvedMaterialName = po.PurchaseOrderItemText || '';
    match.resolvedPlant = po.Plant;
    match.resolvedPlantName = po.PlantName || '';
    match.resolvedSupplier = po.Supplier || '';
    match.resolvedSupplierName = po.SupplierName || '';
    match.resolvedSupplierCity = po.SupplierCityName || '';
    if (po.OrderQuantityUnit || po.PurchaseOrderQuantityUnit || po.BaseUnit || po.UnitOfMeasure) {
      match.resolvedUnit = po.OrderQuantityUnit || po.PurchaseOrderQuantityUnit || po.BaseUnit || po.UnitOfMeasure;
    }

    try {
      const linkedFilter = `PurchaseOrder eq ${odataString(sCleanScan)}`;
      const linkedDelRes = await adapter._get(
        '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
        `$filter=${encodeURIComponent(linkedFilter)}&$top=1&$format=json`
      );
      const linkedDelList = Array.isArray(linkedDelRes) ? linkedDelRes : (linkedDelRes ? [linkedDelRes] : []);
      if (linkedDelList.length > 0) {
        match.resolvedDelivery = linkedDelList[0].DeliveryDocument;
        match.resolvedDeliveryItem = linkedDelList[0].DeliveryDocumentItem || '';
      }
    } catch (linkedErr) {
      if (adapter._isOutage(linkedErr)) throw linkedErr;
      LOG.warn(`Linked delivery check failed for PO ${sCleanScan}: ${linkedErr.message}`);
    }
    return match;
  } catch (err) {
    if (adapter._isOutage(err)) throw err;
    LOG.warn(`Tier 2 PO check failed for ${sCleanScan}: ${err.message}`);
    return null;
  }
}

module.exports = {
  emptyMatch,
  matchHandlingUnit,
  matchInboundDelivery,
  matchPurchaseOrder,
};
