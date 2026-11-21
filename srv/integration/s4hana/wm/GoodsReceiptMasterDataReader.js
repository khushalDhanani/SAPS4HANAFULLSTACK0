const LOG = require('../logger')('goods-receipt-adapter');
const { odataString } = require('../../../common/filterUtils');

class GoodsReceiptMasterDataReader {
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * Retrieves open Inbound Deliveries from SAP MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet
   */
  async getOpenInboundDeliveries(plant = '') {
    let filter = '';
    if (plant) {
      filter = `Plant eq ${odataString(plant)}`;
    }
    // No $top: the set is the open-GR worklist and must not be silently truncated; the CAP handler pages on request.
    const query = `${filter ? `$filter=${encodeURIComponent(filter)}&` : ''}$format=json`;

    try {
      const results = await this.adapter._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet', query);
      const list = Array.isArray(results) ? results : (results ? [results] : []);

      return list.map(r => ({
        StorageUnit: r.DeliveryDocument,
        DeliveryDocument: r.DeliveryDocument,
        DeliveryDocumentItem: r.DeliveryDocumentItem,
        Material: r.Material,
        MaterialName: r.DeliveryDocumentItemText,
        PurchaseOrder: r.PurchaseOrder,
        PurchaseOrderItem: r.PurchaseOrderItem,
        Plant: r.Plant,
        PlantName: r.PlantName,
        Supplier: r.Supplier,
        SupplierName: r.SupplierName,
        SupplierCityName: r.SupplierCityName
      }));
    } catch (err) {
      LOG.error('Error fetching open inbound deliveries:', err.message);
      throw err;
    }
  }

  /**
   * Retrieves authentic plant storage locations from MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp.
   * Replaces dead MMIM_MATERIAL_DATA_SRV (0 rows in SAP) with authentic SAP Storage Location Value Help (696 rows).
   */
  async getMaterialStorageLocations(material, plant) {
    let filter = '';
    if (plant) {
      filter = `Plant eq ${odataString(plant)}`;
    }

    try {
      const queryParam = filter ? `$filter=${encodeURIComponent(filter)}&$format=json` : '$top=50&$format=json';
      const results = await this.adapter._get('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp', queryParam);
      const list = Array.isArray(results) ? results : (results?.results ? results.results : (results ? [results] : []));

      return list.map(r => ({
        Plant: r.Plant || plant || '',
        PlantName: r.PlantName || '',
        StorageLocation: r.StorageLocation,
        StorageLocationName: r.StorageLocationName || '',
        WarehouseStorageBin: r.WarehouseStorageBin || '',
        CurrentStock: (r.CurrentStock !== undefined && r.CurrentStock !== null) ? Number(r.CurrentStock) : null,
        BaseUnit: r.BaseUnit || ''
      }));
    } catch (err) {
      if (this.adapter && typeof this.adapter._isOutage === 'function' && this.adapter._isOutage(err)) {
        LOG.error(`Failed to retrieve storage locations due to S/4HANA outage: ${err.message}`);
        throw err;
      }
      LOG.warn(`Storage location read failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Retrieves authentic batches with SLED status and FEFO sorting from LO_BM_BATCH_SRV/I_Batch
   */
  async getMaterialBatches(material, plant = '', storageLocation = '') {
    if (!material) return [];

    try {
      const filter = `Material eq ${odataString(material)}`;
      const rawBatches = await this.adapter._get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', `$filter=${encodeURIComponent(filter)}&$format=json`);
      const list = Array.isArray(rawBatches) ? rawBatches : (rawBatches ? [rawBatches] : []);

      // Retain requested storageLocation context without dead MMIM_MATERIAL_DATA_SRV calls
      let slocMap = new Map();
      if (storageLocation) {
        slocMap.set(storageLocation, {
          StorageLocation: storageLocation,
          WarehouseStorageBin: '',
          CurrentStock: null
        });
      }

      // Deduplicate client-level (Plant: "") and plant-level records
      const batchMap = new Map();
      list.forEach(b => {
        const batchId = b.Batch;
        if (!batchId) return;

        if (b.BatchIsMarkedForDeletion === 'X' || b.BatchIsMarkedForDeletion === true) return;
        if (b.MatlBatchIsInRstrcdUseStock === 'X' || b.MatlBatchIsInRstrcdUseStock === true) return;

        const existing = batchMap.get(batchId);
        if (!existing) {
          batchMap.set(batchId, { ...b });
        } else {
          if (b.Plant && !existing.Plant) existing.Plant = b.Plant;
          if (b.ShelfLifeExpirationDate && !existing.ShelfLifeExpirationDate) existing.ShelfLifeExpirationDate = b.ShelfLifeExpirationDate;
          if (b.ManufactureDate && !existing.ManufactureDate) existing.ManufactureDate = b.ManufactureDate;
        }
      });

      const processed = [];
      for (const b of batchMap.values()) {
        const expiryFormatted = this.adapter._formatDate(b.ShelfLifeExpirationDate);
        const mfdFormatted = this.adapter._formatDate(b.ManufactureDate);
        const statusInfo = this.adapter._enrichBatchStatus(b.ShelfLifeExpirationDate);

        if (statusInfo.DaysToExpiry < 0) continue; // Exclude expired batches

        const slocObj = slocMap.get(storageLocation) || (slocMap.size > 0 ? slocMap.values().next().value : null);
        const availStock = slocObj ? (Number(slocObj.CurrentStock) || 0) : 0;
        const bin = slocObj?.WarehouseStorageBin || '';
        const sLoc = storageLocation || slocObj?.StorageLocation || '';

        processed.push({
          Material: material,
          Batch: b.Batch,
          Plant: b.Plant || plant || '',
          StorageLocation: sLoc,
          StorageBin: bin,
          AvailableStock: availStock,
          IsSelectable: availStock > 0 && statusInfo.StatusState !== 'Error',
          ExpiryDate: expiryFormatted,
          ManufactureDate: mfdFormatted,
          StatusState: statusInfo.StatusState,
          StatusText: statusInfo.StatusText,
          DaysToExpiry: statusInfo.DaysToExpiry
        });
      }

      // Sort usable batches by earliest expiration date (FEFO)
      processed.sort((a, b) => {
        if (!a.ExpiryDate) return 1;
        if (!b.ExpiryDate) return -1;
        return new Date(a.ExpiryDate) - new Date(b.ExpiryDate);
      });

      return processed;
    } catch (err) {
      if (this.adapter && typeof this.adapter._isOutage === 'function' && this.adapter._isOutage(err)) {
        LOG.error(`Failed to retrieve batches due to S/4HANA outage for material ${material}: ${err.message}`);
        throw err;
      }
      LOG.warn(`Batch read failed for material ${material}: ${err.message}`);
      throw err;
    }
  }
}

module.exports = GoodsReceiptMasterDataReader;
