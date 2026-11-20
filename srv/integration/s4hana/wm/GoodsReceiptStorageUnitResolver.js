const LOG = require('../logger')('goods-receipt-adapter');
const s4Config = require('../s4Config');
const { odataString } = require('../../../common/filterUtils');

async function resolveStorageUnit(adapter, suNumber) {
    if (!suNumber || typeof suNumber !== 'string') {
      throw new Error('Storage Unit Number is required.');
    }

    const sCleanScan = suNumber.trim();
    if (!sCleanScan) {
      throw new Error('Storage Unit Number is required.');
    }

    let scannedType = '';
    let scannedTypeLabel = '';
    let resolvedDelivery = '';
    let resolvedDeliveryItem = '';
    let resolvedPO = '';
    let resolvedPOItem = '';
    let resolvedMaterial = '';
    let resolvedMaterialName = '';
    let resolvedPlant = '';
    let resolvedPlantName = '';
    let resolvedSupplier = '';
    let resolvedSupplierName = '';
    let resolvedSupplierCity = '';
    let targetBatch = '';
    let targetExpiryDate = '';
    let targetBatchStatusState = 'None';
    let targetBatchStatusText = 'NO BATCH';
    let resolvedUnit = '';
    let resolvedPackagingMaterial = '';
    let resolvedStorageUnitType = '';
    let resolvedWarehouseNumber = '';
    let defaultSLoc = '';
    let defaultSLocName = '';
    let defaultBin = '';
    let proposedQuantity = null;

    // --- TIER 0: Storage Unit / Handling Unit check (VEKP / VEPO) via RFC ---
    if (adapter.rfc && typeof adapter.rfc.readTable === 'function' && (!adapter.rfc.isAvailable || adapter.rfc.isAvailable())) {
      try {
        const sPaddedSU = (/^\d+$/.test(sCleanScan) && sCleanScan.length < 20) ? sCleanScan.padStart(20, '0') : sCleanScan;
        const vekpRows = await adapter.rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHILM', 'STATUS', 'VPOBJ', 'VPOBJKEY'], [
          `EXIDV = '${sPaddedSU}' OR EXIDV = '${sCleanScan}'`
        ]);
        if (vekpRows.length > 0) {
          const hu = vekpRows[0];
          scannedType = 'STORAGE_UNIT';
          scannedTypeLabel = 'Storage Unit';
          resolvedPackagingMaterial = hu.VHILM ? hu.VHILM.replace(/^0+/, '') : '';

          const vepoRows = await adapter.rfc.readTable('VEPO', ['VENUM', 'VEPOS', 'VBELN', 'POSNR', 'MATNR', 'CHARG', 'VEMNG', 'VEMEH'], [
            `VENUM = '${hu.VENUM}'`
          ]);
          if (vepoRows.length > 0) {
            const vi = vepoRows[0];
            resolvedDelivery = vi.VBELN || (hu.VPOBJKEY || '');
            resolvedDeliveryItem = vi.POSNR || '';
            resolvedMaterial = vi.MATNR ? vi.MATNR.replace(/^0+/, '') : '';
            targetBatch = vi.CHARG || '';
            resolvedUnit = vi.VEMEH || '';
            proposedQuantity = Number(vi.VEMNG) || null;

            if (resolvedDelivery && resolvedDeliveryItem) {
              const lipsRows = await adapter.rfc.readTable('LIPS', ['VBELN', 'POSNR', 'WERKS', 'LGORT', 'VGBEL', 'VGPOS', 'ARKTX'], [
                `VBELN = '${resolvedDelivery}' AND POSNR = '${resolvedDeliveryItem}'`
              ]);
              if (lipsRows.length > 0) {
                const li = lipsRows[0];
                resolvedPlant = li.WERKS || '';
                defaultSLoc = li.LGORT || '';
                resolvedPO = li.VGBEL || '';
                resolvedPOItem = li.VGPOS || '';
                resolvedMaterialName = li.ARKTX || '';
              }
            }
          }
        }
      } catch (huErr) {
        if (adapter._isOutage(huErr)) throw huErr;
        LOG.warn(`Tier 0 Handling Unit lookup failed for ${sCleanScan}: ${huErr.message}`);
      }
    }

    // --- TIER 1: Inbound Delivery check (HMmimGr4inbdelSet) ---
    try {
      const filter = `DeliveryDocument eq ${odataString(sCleanScan)}`;
      const delRes = await adapter._get(
        '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
        `$filter=${encodeURIComponent(filter)}&$format=json`
      );
      const delList = Array.isArray(delRes) ? delRes : (delRes ? [delRes] : []);
      if (delList.length > 0) {
        const d = delList[0];
        scannedType = 'INBOUND_DELIVERY';
        scannedTypeLabel = 'Inbound Delivery';
        resolvedDelivery = d.DeliveryDocument;
        resolvedDeliveryItem = d.DeliveryDocumentItem || '';
        resolvedPO = d.PurchaseOrder || '';
        resolvedPOItem = d.PurchaseOrderItem || '';
        resolvedMaterial = d.Material;
        resolvedMaterialName = d.DeliveryDocumentItemText || '';
        resolvedPlant = d.Plant;
        resolvedPlantName = d.PlantName || '';
        resolvedSupplier = d.Supplier || '';
        resolvedSupplierName = d.SupplierName || '';
        resolvedSupplierCity = d.SupplierCityName || '';
        if (d.DeliveryQuantityUnit || d.UnitOfMeasure || d.BaseUnit) {
          resolvedUnit = d.DeliveryQuantityUnit || d.UnitOfMeasure || d.BaseUnit;
        }
      }
    } catch (err) {
      if (adapter._isOutage(err)) throw err;
      LOG.warn(`Tier 1 Inbound Delivery lookup failed for ${sCleanScan}: ${err.message}`);
    }

    // --- TIER 2: Purchase Order check (PoHelpSet) ---
    if (!scannedType) {
      try {
        const filter = `PurchaseOrder eq ${odataString(sCleanScan)}`;
        const poRes = await adapter._get(
          '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
          `$filter=${encodeURIComponent(filter)}&$top=5&$format=json`
        );
        const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
        if (poList.length > 0) {
          const po = poList[0];
          scannedType = 'PURCHASE_ORDER';
          scannedTypeLabel = 'Purchase Order';
          resolvedPO = po.PurchaseOrder;
          resolvedPOItem = po.PurchaseOrderItem || '';
          resolvedMaterial = po.Material;
          resolvedMaterialName = po.PurchaseOrderItemText || '';
          resolvedPlant = po.Plant;
          resolvedPlantName = po.PlantName || '';
          resolvedSupplier = po.Supplier || '';
          resolvedSupplierName = po.SupplierName || '';
          resolvedSupplierCity = po.SupplierCityName || '';
          if (po.OrderQuantityUnit || po.PurchaseOrderQuantityUnit || po.BaseUnit || po.UnitOfMeasure) {
            resolvedUnit = po.OrderQuantityUnit || po.PurchaseOrderQuantityUnit || po.BaseUnit || po.UnitOfMeasure;
          }

          // Look for an open Inbound Delivery for this PO
          try {
            const linkedFilter = `PurchaseOrder eq ${odataString(sCleanScan)}`;
            const linkedDelRes = await adapter._get(
              '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
              `$filter=${encodeURIComponent(linkedFilter)}&$top=1&$format=json`
            );
            const linkedDelList = Array.isArray(linkedDelRes) ? linkedDelRes : (linkedDelRes ? [linkedDelRes] : []);
            if (linkedDelList.length > 0) {
              resolvedDelivery = linkedDelList[0].DeliveryDocument;
              resolvedDeliveryItem = linkedDelList[0].DeliveryDocumentItem || '';
            }
          } catch (linkedErr) {
            if (adapter._isOutage(linkedErr)) throw linkedErr;
            LOG.warn(`Linked delivery check failed for PO ${sCleanScan}: ${linkedErr.message}`);
          }
        }
      } catch (err) {
        if (adapter._isOutage(err)) throw err;
        LOG.warn(`Tier 2 PO check failed for ${sCleanScan}: ${err.message}`);
      }
    }

    // --- TIER 3: Batch check (LO_BM_BATCH_SRV/I_Batch) ---
    if (!scannedType) {
      try {
        const filter = `Batch eq ${odataString(sCleanScan)}`;
        const batchRes = await adapter._get(
          '/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch',
          `$filter=${encodeURIComponent(filter)}&$top=5&$format=json`
        );
        const batchList = Array.isArray(batchRes) ? batchRes : (batchRes ? [batchRes] : []);
        if (batchList.length > 0) {
          const b = batchList[0];
          scannedType = 'BATCH';
          scannedTypeLabel = 'Batch';
          targetBatch = b.Batch;
          targetExpiryDate = adapter._formatDate(b.ShelfLifeExpirationDate);
          const bStatus = adapter._enrichBatchStatus(b.ShelfLifeExpirationDate);
          targetBatchStatusState = bStatus.StatusState;
          targetBatchStatusText = bStatus.StatusText;
          resolvedMaterial = b.Material;
          resolvedPlant = b.Plant || '';

          // Search open deliveries for this batch's material
          try {
            const matFilter = `Material eq ${odataString(resolvedMaterial)}`;
            const matDelRes = await adapter._get(
              '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
              `$filter=${encodeURIComponent(matFilter)}&$top=1&$format=json`
            );
            const matDelList = Array.isArray(matDelRes) ? matDelRes : (matDelRes ? [matDelRes] : []);
            if (matDelList.length > 0) {
              const md = matDelList[0];
              resolvedDelivery = md.DeliveryDocument;
              resolvedDeliveryItem = md.DeliveryDocumentItem || '';
              resolvedPO = md.PurchaseOrder || '';
              resolvedPOItem = md.PurchaseOrderItem || '';
              resolvedMaterialName = md.DeliveryDocumentItemText || '';
              resolvedPlant = md.Plant;
              resolvedPlantName = md.PlantName || '';
              resolvedSupplier = md.Supplier || '';
              resolvedSupplierName = md.SupplierName || '';
              resolvedSupplierCity = md.SupplierCityName || '';
            } else {
              // Search POs for this batch's material
              const poFilter = `Material eq ${odataString(resolvedMaterial)}`;
              const poRes = await adapter._get(
                '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
                `$filter=${encodeURIComponent(poFilter)}&$top=1&$format=json`
              );
              const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
              if (poList.length > 0) {
                const po = poList[0];
                resolvedPO = po.PurchaseOrder;
                resolvedPOItem = po.PurchaseOrderItem || '';
                resolvedMaterialName = po.PurchaseOrderItemText || '';
                resolvedPlant = po.Plant;
                resolvedPlantName = po.PlantName || '';
                resolvedSupplier = po.Supplier || '';
                resolvedSupplierName = po.SupplierName || '';
                resolvedSupplierCity = po.SupplierCityName || '';
              }
            }
          } catch (innerErr) {
            if (adapter._isOutage(innerErr)) throw innerErr;
            LOG.warn(`Batch material link lookup failed for ${resolvedMaterial}: ${innerErr.message}`);
          }
        }
      } catch (err) {
        if (adapter._isOutage(err)) throw err;
        LOG.warn(`Tier 3 Batch check failed for ${sCleanScan}: ${err.message}`);
      }
    }

    // --- TIER 4: Material check (HMmimGr4inbdelSet / PoHelpSet / MaterialHeaders) ---
    if (!scannedType) {
      try {
        const filter = `Material eq ${odataString(sCleanScan)}`;
        const matDelRes = await adapter._get(
          '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
          `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
        );
        const matDelList = Array.isArray(matDelRes) ? matDelRes : (matDelRes ? [matDelRes] : []);
        if (matDelList.length > 0) {
          const md = matDelList[0];
          scannedType = 'MATERIAL';
          scannedTypeLabel = 'Material / Product';
          resolvedMaterial = md.Material;
          resolvedMaterialName = md.DeliveryDocumentItemText || '';
          resolvedDelivery = md.DeliveryDocument;
          resolvedDeliveryItem = md.DeliveryDocumentItem || '';
          resolvedPO = md.PurchaseOrder || '';
          resolvedPOItem = md.PurchaseOrderItem || '';
          resolvedPlant = md.Plant;
          resolvedPlantName = md.PlantName || '';
          resolvedSupplier = md.Supplier || '';
          resolvedSupplierName = md.SupplierName || '';
          resolvedSupplierCity = md.SupplierCityName || '';
        } else {
          // Check PoHelpSet by Material
          const filter = `Material eq ${odataString(sCleanScan)}`;
          const poRes = await adapter._get(
            '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
            `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
          );
          const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
          if (poList.length > 0) {
            const po = poList[0];
            scannedType = 'MATERIAL';
            scannedTypeLabel = 'Material / Product';
            resolvedMaterial = po.Material;
            resolvedMaterialName = po.PurchaseOrderItemText || '';
            resolvedPO = po.PurchaseOrder;
            resolvedPOItem = po.PurchaseOrderItem || '';
            resolvedPlant = po.Plant;
            resolvedPlantName = po.PlantName || '';
            resolvedSupplier = po.Supplier || '';
            resolvedSupplierName = po.SupplierName || '';
            resolvedSupplierCity = po.SupplierCityName || '';
          }
        }
      } catch (err) {
        if (adapter._isOutage(err)) throw err;
        LOG.warn(`Tier 4 Material check failed for ${sCleanScan}: ${err.message}`);
      }
    }

    // --- TIER 5: Production Order check (MMIMProductionOrderVH) ---
    if (!scannedType) {
      try {
        const filter = `ManufacturingOrder eq ${odataString(sCleanScan)}`;
        const prodRes = await adapter._get(
          '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/MMIMProductionOrderVH',
          `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
        );
        const prodList = Array.isArray(prodRes) ? prodRes : (prodRes ? [prodRes] : []);
        if (prodList.length > 0) {
          const pr = prodList[0];
          scannedType = 'PRODUCTION_ORDER';
          scannedTypeLabel = 'Production Order';
          resolvedMaterial = pr.Material || '';
          resolvedPlant = pr.ProductionPlant || '';
        }
      } catch (err) {
        if (adapter._isOutage(err)) throw err;
        LOG.warn(`Tier 5 Production Order check failed for ${sCleanScan}: ${err.message}`);
      }
    }

    // --- TIER 6: Storage Unit / General Delivery Fallback (query top 50 deliveries) ---
    if (!scannedType) {
      try {
        const allRes = await adapter._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet', `$top=50&$format=json`);
        const allList = Array.isArray(allRes) ? allRes : (allRes ? [allRes] : []);
        const matched = allList.find(d =>
          d.DeliveryDocument === sCleanScan ||
          d.PurchaseOrder === sCleanScan ||
          d.Material === sCleanScan
        );
        if (matched) {
          scannedType = 'STORAGE_UNIT';
          scannedTypeLabel = 'Storage Unit';
          resolvedDelivery = matched.DeliveryDocument;
          resolvedDeliveryItem = matched.DeliveryDocumentItem || '';
          resolvedPO = matched.PurchaseOrder || '';
          resolvedPOItem = matched.PurchaseOrderItem || '';
          resolvedMaterial = matched.Material;
          resolvedMaterialName = matched.DeliveryDocumentItemText || '';
          resolvedPlant = matched.Plant;
          resolvedPlantName = matched.PlantName || '';
          resolvedSupplier = matched.Supplier || '';
          resolvedSupplierName = matched.SupplierName || '';
          resolvedSupplierCity = matched.SupplierCityName || '';
        }
      } catch (err) {
        if (adapter._isOutage(err)) throw err;
        LOG.warn(`Tier 6 Fallback check failed for ${sCleanScan}: ${err.message}`);
      }
    }

    // --- TIER 7: Genuine Non-Existent Object / Validation Error ---
    if (!scannedType) {
      const err = new Error(
        `Validation Error: Scanned barcode '${sCleanScan}' was evaluated across active Inbound Deliveries, Purchase Orders, Materials, Batches, and Storage Units in SAP S/4HANA (Client ${s4Config.getClient()}) and does not exist in any active record. Please scan a valid SAP barcode or use Value Help to select an open inbound record.`
      );
      err.statusCode = 404;
      throw err;
    }

    // Lookups that fail (non-outage) are reported to the caller, never silently emptied.
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
        const docBatch = batches.find(b => b.Batch === grItem.Batch);
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
      const match = storageLocations.find(s => s.StorageLocation === defaultSLoc);
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
          BaseUnit: ''
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
      LookupWarnings: lookupWarnings
    };
  }


module.exports = {
  resolveStorageUnit
};
