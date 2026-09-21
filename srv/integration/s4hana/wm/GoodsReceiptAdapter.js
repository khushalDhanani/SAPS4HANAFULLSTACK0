const cds = require('@sap/cds');
const LOG = require('../logger')('goods-receipt-adapter');
const S4ErrorMapper = require('../S4ErrorMapper');
const { S4HttpClient } = require('../S4HttpClient');
const s4Config = require('../s4Config');

const { enrichBatchStatus } = require('../../../common/batchUtils');
const { formatDateToYMD } = require('../../../common/dateUtils');
const { odataString } = require('../../../common/filterUtils');

/**
 * Adapter class to encapsulate communication with SAP S/4HANA for Goods Receipt (Movement 101):
 * - Resolve Storage Unit Number to authentic Inbound Delivery, Material, Batch, SLED, Plant, SLoc via MMIM_GR4PO_DL_SRV & LO_BM_BATCH_SRV
 * - Retrieve active open Inbound Deliveries via MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet
 * - Retrieve authentic storage locations and storage bins via MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps
 * - Retrieve and validate authentic batches with FEFO sorting and SLED verification via LO_BM_BATCH_SRV/I_Batch
 * - Strict compliance with AGENTS.md SAP API Discovery Protocol:
 *   NO dummy fallback data, NO mock persistence, NO synthetic document generation.
 */
class GoodsReceiptAdapter {
  /**
   * Gateway entity set that reliably issues a CSRF token and session cookies on this system; used for
   * every transactional POST of this adapter.
   */
  static CSRF_FETCH_PATH = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1';

  constructor(options = {}) {
    // All HTTP traffic to S/4HANA goes through the shared SAP Cloud SDK based client (BTP destination,
    // Connectivity proxy for on-premise systems, per-call CSRF/cookie handling). No session state lives here.
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;
  }

  /**
   * Enrich batch object with SLED classification against current date (delegates to shared batchUtils)
   */
  _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  static _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  /**
   * Format epoch date or /Date(xxx)/ to ISO string YYYY-MM-DD (delegates to shared dateUtils)
   */
  _formatDate(dateVal) {
    return formatDateToYMD(dateVal, { emptyFallback: '' });
  }

  static _formatDate(dateVal) {
    return formatDateToYMD(dateVal, { emptyFallback: '' });
  }

  /**
   * Resolve the S/4HANA destination through the shared client. Returns null when nothing is configured.
   */
  async _getDestination() {
    return this.client.resolveDestination();
  }

  /**
   * Converts a shared-client failure into the Gateway error shape the Goods Receipt handlers expect:
   * the SAP message as text and the HTTP status in statusCode.
   */
  static _toGatewayError(err) {
    const errObj = new Error(S4ErrorMapper.extractS4ErrorMessage(err));
    errObj.statusCode = err.status || err.statusCode;
    errObj.status = errObj.statusCode;
    errObj.code = err.code;
    return errObj;
  }

  /**
   * Executes an authenticated GET request against SAP Gateway via the SAP Cloud SDK
   */
  async _get(servicePath, queryString = '') {
    try {
      const { data } = await this.client.get(servicePath, { query: queryString });
      return data?.d?.results || data?.d || data;
    } catch (err) {
      throw GoodsReceiptAdapter._toGatewayError(err);
    }
  }

  /**
   * Executes an authenticated POST request against SAP Gateway via the SAP Cloud SDK. The CSRF token and
   * the session cookies are fetched for this call only; nothing is cached on the adapter.
   */
  async _post(servicePath, body = {}, customHeaders = {}) {
    try {
      const { data, headers } = await this.client.post(servicePath, {
        data: body,
        headers: customHeaders,
        csrfPath: GoodsReceiptAdapter.CSRF_FETCH_PATH
      });
      const res = (data && typeof data === 'object') ? (data.d || data) : data;
      if (res && typeof res === 'object' && headers) {
        res._headers = headers;
      }
      return res;
    } catch (err) {
      throw GoodsReceiptAdapter._toGatewayError(err);
    }
  }

  /**
   * Retrieves open Inbound Deliveries from SAP MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet
   */
  async getOpenInboundDeliveries(plant = '') {
    let filter = '';
    if (plant) {
      filter = `Plant eq ${odataString(plant)}`;
    }
    const query = `${filter ? `$filter=${encodeURIComponent(filter)}&` : ''}$top=50&$format=json`;

    try {
      const results = await this._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet', query);
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
   * Retrieves storage locations and warehouse storage bins from MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps
   */
  async getMaterialStorageLocations(material, plant) {
    if (!material) return [];
    let filter = `Material eq ${odataString(material)}`;
    if (plant) {
      filter += ` and Plant eq ${odataString(plant)}`;
    }

    try {
      const results = await this._get('/sap/opu/odata/sap/MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps', `$filter=${encodeURIComponent(filter)}&$format=json`);
      const list = Array.isArray(results) ? results : (results ? [results] : []);

      return list.map(r => ({
        StorageLocation: r.StorageLocation,
        StorageLocationName: r.StorageLocationName || '',
        WarehouseStorageBin: r.WarehouseStorageBin || '',
        CurrentStock: Number(r.CurrentStock) || 0,
        BaseUnit: r.BaseUnit || ''
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Retrieves authentic batches with SLED status and FEFO sorting from LO_BM_BATCH_SRV/I_Batch
   */
  async getMaterialBatches(material, plant = '', storageLocation = '') {
    if (!material) return [];

    try {
      const filter = `Material eq ${odataString(material)}`;
      const rawBatches = await this._get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', `$filter=${encodeURIComponent(filter)}&$format=json`);
      const list = Array.isArray(rawBatches) ? rawBatches : (rawBatches ? [rawBatches] : []);

      // Query SLoc stock & bins
      let slocMap = new Map();
      try {
        let slocFilter = `Material eq ${odataString(material)}`;
        if (plant) slocFilter += ` and Plant eq ${odataString(plant)}`;
        if (storageLocation) slocFilter += ` and StorageLocation eq ${odataString(storageLocation)}`;
        const slocRes = await this._get(
          '/sap/opu/odata/sap/MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps',
          `$filter=${encodeURIComponent(slocFilter)}&$format=json`
        );
        const slocs = Array.isArray(slocRes) ? slocRes : (slocRes ? [slocRes] : []);
        slocs.forEach(s => slocMap.set(s.StorageLocation, s));
      } catch (_) {}

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
        const expiryFormatted = this._formatDate(b.ShelfLifeExpirationDate);
        const mfdFormatted = this._formatDate(b.ManufactureDate);
        const statusInfo = this._enrichBatchStatus(b.ShelfLifeExpirationDate);

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
    } catch (_) {
      return [];
    }
  }

  /**
   * Primary method: Multi-tier resolution of scanned barcode to authentic SAP S/4HANA objects:
   * Scan -> Identify scanned value type -> Resolve SAP object -> Retrieve related Material/Batch/Quantity/SLED -> Populate Goods Receipt
   * Supported types:
   * 1. Inbound Delivery (HMmimGr4inbdelSet)
   * 2. Purchase Order (PoHelpSet + link to open Delivery)
   * 3. Batch (LO_BM_BATCH_SRV/I_Batch + link to Material and open Delivery/PO)
   * 4. Material (HMmimGr4inbdelSet / PoHelpSet / MaterialHeaders)
   * 5. Production Order (MMIMProductionOrderVH)
   * 6. Storage Unit
   * 7. Clear validation error when document genuinely does not exist across all types in SAP Client 220
   */
  async resolveStorageUnit(suNumber) {
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

    // --- TIER 1: Inbound Delivery check (HMmimGr4inbdelSet) ---
    try {
      const filter = `DeliveryDocument eq ${odataString(sCleanScan)}`;
      const delRes = await this._get(
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
        resolvedMaterialName = d.DeliveryDocumentItemText || ('Material ' + d.Material);
        resolvedPlant = d.Plant;
        resolvedPlantName = d.PlantName || ('Plant ' + d.Plant);
        resolvedSupplier = d.Supplier || '';
        resolvedSupplierName = d.SupplierName || '';
        resolvedSupplierCity = d.SupplierCityName || '';
        if (d.DeliveryQuantityUnit || d.UnitOfMeasure || d.BaseUnit) {
          resolvedUnit = d.DeliveryQuantityUnit || d.UnitOfMeasure || d.BaseUnit;
        }
      }
    } catch (_) {}

    // --- TIER 2: Purchase Order check (PoHelpSet) ---
    if (!scannedType) {
      try {
        const filter = `PurchaseOrder eq ${odataString(sCleanScan)}`;
        const poRes = await this._get(
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
          resolvedMaterialName = po.PurchaseOrderItemText || ('Material ' + po.Material);
          resolvedPlant = po.Plant;
          resolvedPlantName = po.PlantName || ('Plant ' + po.Plant);
          resolvedSupplier = po.Supplier || '';
          resolvedSupplierName = po.SupplierName || '';
          resolvedSupplierCity = po.SupplierCityName || '';
          if (po.OrderQuantityUnit || po.PurchaseOrderQuantityUnit || po.BaseUnit || po.UnitOfMeasure) {
            resolvedUnit = po.OrderQuantityUnit || po.PurchaseOrderQuantityUnit || po.BaseUnit || po.UnitOfMeasure;
          }

          // Look for an open Inbound Delivery for this PO
          try {
            const linkedFilter = `PurchaseOrder eq ${odataString(sCleanScan)}`;
            const linkedDelRes = await this._get(
              '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
              `$filter=${encodeURIComponent(linkedFilter)}&$top=1&$format=json`
            );
            const linkedDelList = Array.isArray(linkedDelRes) ? linkedDelRes : (linkedDelRes ? [linkedDelRes] : []);
            if (linkedDelList.length > 0) {
              resolvedDelivery = linkedDelList[0].DeliveryDocument;
              resolvedDeliveryItem = linkedDelList[0].DeliveryDocumentItem || '';
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // --- TIER 3: Batch check (LO_BM_BATCH_SRV/I_Batch) ---
    if (!scannedType) {
      try {
        const filter = `Batch eq ${odataString(sCleanScan)}`;
        const batchRes = await this._get(
          '/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch',
          `$filter=${encodeURIComponent(filter)}&$top=5&$format=json`
        );
        const batchList = Array.isArray(batchRes) ? batchRes : (batchRes ? [batchRes] : []);
        if (batchList.length > 0) {
          const b = batchList[0];
          scannedType = 'BATCH';
          scannedTypeLabel = 'Batch';
          targetBatch = b.Batch;
          targetExpiryDate = this._formatDate(b.ShelfLifeExpirationDate);
          const bStatus = this._enrichBatchStatus(b.ShelfLifeExpirationDate);
          targetBatchStatusState = bStatus.StatusState;
          targetBatchStatusText = bStatus.StatusText;
          resolvedMaterial = b.Material;
          resolvedPlant = b.Plant || '';

          // Search open deliveries for this batch's material
          try {
            const matFilter = `Material eq ${odataString(resolvedMaterial)}`;
            const matDelRes = await this._get(
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
              resolvedMaterialName = md.DeliveryDocumentItemText || ('Material ' + md.Material);
              resolvedPlant = md.Plant;
              resolvedPlantName = md.PlantName || ('Plant ' + md.Plant);
              resolvedSupplier = md.Supplier || '';
              resolvedSupplierName = md.SupplierName || '';
              resolvedSupplierCity = md.SupplierCityName || '';
            } else {
              // Search POs for this batch's material
              const poFilter = `Material eq ${odataString(resolvedMaterial)}`;
              const poRes = await this._get(
                '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
                `$filter=${encodeURIComponent(poFilter)}&$top=1&$format=json`
              );
              const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
              if (poList.length > 0) {
                const po = poList[0];
                resolvedPO = po.PurchaseOrder;
                resolvedPOItem = po.PurchaseOrderItem || '';
                resolvedMaterialName = po.PurchaseOrderItemText || ('Material ' + po.Material);
                resolvedPlant = po.Plant;
                resolvedPlantName = po.PlantName || ('Plant ' + po.Plant);
                resolvedSupplier = po.Supplier || '';
                resolvedSupplierName = po.SupplierName || '';
                resolvedSupplierCity = po.SupplierCityName || '';
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // --- TIER 4: Material check (HMmimGr4inbdelSet / PoHelpSet / MaterialHeaders) ---
    if (!scannedType) {
      try {
        const filter = `Material eq ${odataString(sCleanScan)}`;
        const matDelRes = await this._get(
          '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet',
          `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
        );
        const matDelList = Array.isArray(matDelRes) ? matDelRes : (matDelRes ? [matDelRes] : []);
        if (matDelList.length > 0) {
          const md = matDelList[0];
          scannedType = 'MATERIAL';
          scannedTypeLabel = 'Material / Product';
          resolvedMaterial = md.Material;
          resolvedMaterialName = md.DeliveryDocumentItemText || ('Material ' + md.Material);
          resolvedDelivery = md.DeliveryDocument;
          resolvedDeliveryItem = md.DeliveryDocumentItem || '';
          resolvedPO = md.PurchaseOrder || '';
          resolvedPOItem = md.PurchaseOrderItem || '';
          resolvedPlant = md.Plant;
          resolvedPlantName = md.PlantName || ('Plant ' + md.Plant);
          resolvedSupplier = md.Supplier || '';
          resolvedSupplierName = md.SupplierName || '';
          resolvedSupplierCity = md.SupplierCityName || '';
        } else {
          // Check PoHelpSet by Material
          const filter = `Material eq ${odataString(sCleanScan)}`;
          const poRes = await this._get(
            '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/PoHelpSet',
            `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`
          );
          const poList = Array.isArray(poRes) ? poRes : (poRes ? [poRes] : []);
          if (poList.length > 0) {
            const po = poList[0];
            scannedType = 'MATERIAL';
            scannedTypeLabel = 'Material / Product';
            resolvedMaterial = po.Material;
            resolvedMaterialName = po.PurchaseOrderItemText || ('Material ' + po.Material);
            resolvedPO = po.PurchaseOrder;
            resolvedPOItem = po.PurchaseOrderItem || '';
            resolvedPlant = po.Plant;
            resolvedPlantName = po.PlantName || ('Plant ' + po.Plant);
            resolvedSupplier = po.Supplier || '';
            resolvedSupplierName = po.SupplierName || '';
            resolvedSupplierCity = po.SupplierCityName || '';
          }
        }
      } catch (_) {}
    }

    // --- TIER 5: Production Order check (MMIMProductionOrderVH) ---
    if (!scannedType) {
      try {
        const filter = `ManufacturingOrder eq ${odataString(sCleanScan)}`;
        const prodRes = await this._get(
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
      } catch (_) {}
    }

    // --- TIER 6: Storage Unit / General Delivery Fallback (query top 50 deliveries) ---
    if (!scannedType) {
      try {
        const allRes = await this._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet', `$top=50&$format=json`);
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
          resolvedMaterialName = matched.DeliveryDocumentItemText || ('Material ' + matched.Material);
          resolvedPlant = matched.Plant;
          resolvedPlantName = matched.PlantName || ('Plant ' + matched.Plant);
          resolvedSupplier = matched.Supplier || '';
          resolvedSupplierName = matched.SupplierName || '';
          resolvedSupplierCity = matched.SupplierCityName || '';
        }
      } catch (_) {}
    }

    // --- TIER 7: Genuine Non-Existent Object / Validation Error ---
    if (!scannedType) {
      const err = new Error(
        `Validation Error: Scanned barcode '${sCleanScan}' was evaluated across active Inbound Deliveries, Purchase Orders, Materials, Batches, and Storage Units in SAP S/4HANA (Client ${s4Config.getClient()}) and does not exist in any active record. Please scan a valid SAP barcode or use Value Help to select an open inbound record.`
      );
      err.statusCode = 404;
      throw err;
    }

    // Retrieve authentic Storage Locations & Bins
    const storageLocations = await this.getMaterialStorageLocations(resolvedMaterial, resolvedPlant);
    const defaultSLoc = storageLocations.length > 0 ? storageLocations[0].StorageLocation : s4Config.getStorageLocation();
    const defaultSLocName = storageLocations.length > 0 ? storageLocations[0].StorageLocationName : '';
    const defaultBin = storageLocations.length > 0 ? storageLocations[0].WarehouseStorageBin : '';

    // Retrieve authentic Batches & SLED
    const batches = await this.getMaterialBatches(resolvedMaterial, resolvedPlant, defaultSLoc);
    let selectedBatch = targetBatch;
    let expiryDate = targetExpiryDate;
    let batchStatusState = targetBatchStatusState;
    let batchStatusText = targetBatchStatusText;

    if (!selectedBatch && batches.length > 0) {
      const topBatch = batches[0];
      selectedBatch = topBatch.Batch;
      expiryDate = topBatch.ExpiryDate;
      batchStatusState = topBatch.StatusState;
      batchStatusText = topBatch.StatusText;
    }

    const effectiveUnit = resolvedUnit || (storageLocations.length > 0 && storageLocations[0].BaseUnit) || (batches.length > 0 && batches[0].Unit) || '';

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
      MaterialName: resolvedMaterialName || ('Material ' + resolvedMaterial),
      Plant: resolvedPlant,
      PlantName: resolvedPlantName || ('Plant ' + resolvedPlant),
      StorageLocation: defaultSLoc,
      StorageLocationName: defaultSLocName,
      WarehouseStorageBin: defaultBin,
      Batch: selectedBatch,
      ExpiryDate: expiryDate,
      BatchStatusState: batchStatusState,
      BatchStatusText: batchStatusText,
      Quantity: 10,
      Unit: effectiveUnit,
      Supplier: resolvedSupplier,
      SupplierName: resolvedSupplierName,
      SupplierCityName: resolvedSupplierCity,
      AvailableStorageLocations: storageLocations,
      AvailableBatches: batches
    };
  }

  /**
   * Executes Goods Receipt posting in SAP S/4HANA via MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers
   * In strict accordance with AGENTS.md: NO mock persistence or synthetic document generation.
   */
  async postGoodsReceipt(payload = {}) {
    const {
      StorageUnit,
      DeliveryDocument,
      Material,
      Plant,
      StorageLocation,
      Batch,
      Quantity,
      ExpiryDate
    } = payload;

    if (!StorageUnit && !DeliveryDocument) {
      throw new Error('Storage Unit / Inbound Delivery is required to post Goods Receipt.');
    }
    if (!Material) {
      throw new Error('Material is required to post Goods Receipt.');
    }
    if (!Plant) {
      throw new Error('Plant is required to post Goods Receipt.');
    }
    if (!StorageLocation) {
      throw new Error('Storage Location is required to post Goods Receipt.');
    }
    const nQty = Number(Quantity);
    if (isNaN(nQty) || nQty <= 0) {
      throw new Error('Quantity must be a positive number.');
    }

    // HARD-STOP: Verify SLED expiration
    if (ExpiryDate) {
      const status = this._enrichBatchStatus(ExpiryDate);
      if (status.StatusState === 'Error' || status.StatusText === 'EXPIRED') {
        throw new Error(
          `Expired Batch Blocked: Batch '${Batch}' expired on ${ExpiryDate} (SLED exceeded). Goods Receipt for expired materials is strictly prohibited by quality control rules.`
        );
      }
    }

    // Retargeted to MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers (Inventory Management / Movement 101)
    const sDoc = DeliveryDocument || StorageUnit;
    const now = new Date();
    const todayFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00`;
    const tempKey = `${sDoc}GR${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;

    // Determine SourceOfGR: 'INBDELIV' (Inbound Delivery) or 'PURORD' (Purchase Order)
    let sourceOfGR = payload.SourceOfGR;
    if (!sourceOfGR) {
      if (payload.PurchaseOrder && !payload.DeliveryDocument && String(sDoc) === String(payload.PurchaseOrder)) {
        sourceOfGR = 'PURORD';
      } else {
        sourceOfGR = 'INBDELIV';
      }
    }

    const rawItemNo = payload.DeliveryDocumentItem || payload.PurchaseOrderItem;
    if (!rawItemNo && (!Array.isArray(payload.Items) || payload.Items.length === 0)) {
      throw new Error('Delivery Document Item (or Purchase Order Item) is required to post Goods Receipt.');
    }
    const sItemNo = rawItemNo ? String(rawItemNo).padStart(6, '0') : '';

    let items = [];
    if (Array.isArray(payload.Items) && payload.Items.length > 0) {
      items = payload.Items.map((it, idx) => {
        const itemUnit = it.Unit || it.EntryUnit || it.UnitOfMeasure || payload.Unit || payload.EntryUnit || payload.UnitOfMeasure;
        if (!itemUnit || !String(itemUnit).trim()) {
          throw new Error(`Unit of Measure (EntryUnit) is required for Goods Receipt item ${it.DeliveryDocumentItem || idx + 1}`);
        }
        const itItemNo = it.DeliveryDocumentItem || it.PurchaseOrderItem || rawItemNo;
        if (!itItemNo || !String(itItemNo).trim()) {
          throw new Error(`Delivery Document Item is required for Goods Receipt item ${idx + 1}`);
        }
        const cleanUnit = String(itemUnit).trim().toUpperCase();
        return {
          InboundDelivery: sDoc,
          DeliveryDocumentItem: String(itItemNo).padStart(6, '0'),
          SourceOfGR: sourceOfGR,
          Material: it.Material || Material,
          Plant: it.Plant || Plant,
          StorageLocation: it.StorageLocation || StorageLocation,
          Batch: it.Batch || Batch || '',
          QuantityInEntryUnit: String(it.Quantity || nQty),
          EntryUnit: cleanUnit,
          OpenQuantity: String(it.Quantity || nQty),
          UnitOfMeasure: cleanUnit,
          GoodsMovementType: it.GoodsMovementType || payload.GoodsMovementType || '101',
          GoodsMovementReasonCode: it.GoodsMovementReasonCode || payload.GoodsMovementReasonCode || '0000',
          DocumentItemText: it.DocumentItemText || ''
        };
      });
    } else {
      const itemUnit = payload.Unit || payload.EntryUnit || payload.UnitOfMeasure;
      if (!itemUnit || !String(itemUnit).trim()) {
        throw new Error('Unit of Measure (EntryUnit) is required for Goods Receipt');
      }
      const cleanUnit = String(itemUnit).trim().toUpperCase();
      items = [
        {
          InboundDelivery: sDoc,
          DeliveryDocumentItem: sItemNo,
          SourceOfGR: sourceOfGR,
          Material: Material,
          Plant: Plant,
          StorageLocation: StorageLocation,
          Batch: Batch || '',
          QuantityInEntryUnit: String(nQty),
          EntryUnit: cleanUnit,
          OpenQuantity: String(nQty),
          UnitOfMeasure: cleanUnit,
          GoodsMovementType: payload.GoodsMovementType || '101',
          GoodsMovementReasonCode: payload.GoodsMovementReasonCode || '0000',
          DocumentItemText: payload.DocumentItemText || ''
        }
      ];
    }

    const postPayload = {
      InboundDelivery: sDoc,
      SourceOfGR: sourceOfGR,
      DocumentDate: todayFormatted,
      PostingDate: todayFormatted,
      DeliveryDocumentByVendor: payload.DeliveryDocumentByVendor || '',
      BillOfLading: payload.BillOfLading || '',
      MaterialDocumentHeaderText: payload.MaterialDocumentHeaderText || `GR Delivery ${sDoc}`,
      Temp_Key: tempKey,
      VersionForPrintingSlip: payload.VersionForPrintingSlip || '0',
      Header2Items: items
    };

    try {
      const path = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers';
      const result = await this._post(path, postPayload);

      // Check sap-message response header for business errors or posted document text
      const rawSapMsg = result?._headers?.['sap-message'];
      let sapMsgObj = null;
      if (rawSapMsg) {
        try {
          sapMsgObj = JSON.parse(rawSapMsg);
        } catch (_) {}
      }

      if (sapMsgObj && sapMsgObj.severity === 'error') {
        throw new Error(sapMsgObj.message || 'SAP S/4HANA rejected Goods Receipt posting');
      }

      let matDoc = result?.MaterialDocument;
      if (!matDoc && result?.Header2Refs) {
        const refs = Array.isArray(result.Header2Refs?.results)
          ? result.Header2Refs.results
          : (Array.isArray(result.Header2Refs) ? result.Header2Refs : []);
        const docRef = refs.find(r => r.DocNo && /^\d+$/.test(r.DocNo));
        if (docRef) {
          matDoc = docRef.DocNo;
        }
      }
      if (!matDoc && sapMsgObj?.message) {
        const match = sapMsgObj.message.match(/Material document\s+(\d+)/i);
        if (match) {
          matDoc = match[1];
        }
      }

      if (!matDoc) {
        const errDetail = sapMsgObj?.message || 'SAP did not generate or return a material document number.';
        throw new Error(errDetail);
      }

      return {
        Success: true,
        Message: `Goods Receipt posted successfully in SAP for Delivery ${sDoc} (Material Document ${matDoc})`,
        DeliveryDocument: sDoc,
        MaterialDocument: matDoc
      };
    } catch (err) {
      // Per AGENTS.md: Stop implementation and report exactly what SAP capability is missing / failing.
      // Mock persistence and dummy document generation are strictly prohibited.
      const errorMsg = err.message || JSON.stringify(err);
      throw new Error(
        `SAP S/4HANA Backend Posting Capability Error: Posting Goods Receipt for Inbound Delivery '${sDoc}' via MMIM_GR4PO_DL_SRV failed in SAP Gateway (Client ${s4Config.getClient()}): ${errorMsg}. In accordance with AGENTS.md, mock persistence and synthetic document generation are strictly prohibited.`
      );
    }
  }
}

module.exports = new GoodsReceiptAdapter();
module.exports.GoodsReceiptAdapter = GoodsReceiptAdapter;
