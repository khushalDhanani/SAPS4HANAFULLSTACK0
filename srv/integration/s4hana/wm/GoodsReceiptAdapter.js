const cds = require('@sap/cds');
const LOG = require('../logger')('goods-receipt-adapter');
const S4ErrorMapper = require('../S4ErrorMapper');
const { S4HttpClient } = require('../S4HttpClient');
const { RfcClient } = require('../RfcClient');
const { sapKey } = require('../sapKey');

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
const toNum = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);

const suResolver = require('./GoodsReceiptStorageUnitResolver');
const postingHelper = require('./GoodsReceiptPostingHelper');

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
    this.rfc = options.rfc || new RfcClient();
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
   * Determine if an error represents an S/4HANA backend outage, network timeout,
   * unconfigured destination, or connection failure.
   */
  _isOutage(err) {
    return GoodsReceiptAdapter._isOutage(err);
  }

  static _isOutage(err) {
    if (!err) return false;
    if (String(err.message || '').includes('node-rfc is not available')) return false;
    if (err.code === 'DESTINATION_NOT_CONFIGURED' || err.code === 'S4_DESTINATION_NOT_CONFIGURED') return true;
    const status = err.status || err.statusCode || err.response?.status;
    if (status && (status === 502 || status === 503 || status === 504 || status === 500 || status === 401 || status === 403)) {
      return true;
    }
    const code = String(err.code || err.cause?.code || '').toUpperCase();
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return true;
    }
    const msg = String(err.message || '').toLowerCase();
    if (
      msg.includes('destination') ||
      msg.includes('network error') ||
      msg.includes('connection refused') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound')
    ) {
      return true;
    }
    return false;
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
    const mapped = S4ErrorMapper.mapS4Error ? S4ErrorMapper.mapS4Error(err) : null;
    if (mapped && (mapped.status === 409 || mapped.code === 'STALE_DATA' || mapped.status === 412)) {
      mapped.statusCode = mapped.status || 409;
      return mapped;
    }
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
    // No $top: the set is the open-GR worklist and must not be silently truncated; the CAP handler pages on request.
    const query = `${filter ? `$filter=${encodeURIComponent(filter)}&` : ''}$format=json`;

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
      const results = await this._get('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp', queryParam);
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
      if (this._isOutage(err)) {
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
      const rawBatches = await this._get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', `$filter=${encodeURIComponent(filter)}&$format=json`);
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
    } catch (err) {
      if (this._isOutage(err)) {
        LOG.error(`Failed to retrieve batches due to S/4HANA outage for material ${material}: ${err.message}`);
        throw err;
      }
      LOG.warn(`Batch read failed for material ${material}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Retrieves authentic Goods Receipt item data (OpenQuantity, OrderedQuantity, UnitOfMeasure, EntryUnit, etc.)
   * from MMIM_GR4PO_DL_SRV/GR4PO_DL_Items and GR4PO_DL_Headers.
   * Eliminates hardcoded quantities in strict compliance with AGENTS.md.
   */
  /**
   * Delivery item facts from LIPS/LIKP (read-only RFC_READ_TABLE): the authoritative quantity, unit, storage
   * location, batch, warehouse number/bin, goods movement status and delivery date of an inbound delivery item.
   * Returns null when RFC is unavailable or the item does not exist.
   */
  async _readDeliveryItemFacts(deliveryDocument, deliveryItem) {
    if (!this.rfc || typeof this.rfc.readTable !== 'function') return null;
    const vbeln = sapKey(deliveryDocument, 'vbeln').padStart(10, '0');
    const posnr = sapKey(deliveryItem, 'posnr').padStart(6, '0');
    try {
      const rows = await this.rfc.readTable('LIPS', ['VBELN', 'POSNR', 'WERKS', 'LGORT', 'CHARG', 'LFIMG', 'MEINS', 'VRKME', 'UMVKZ', 'UMVKN', 'LGNUM', 'LGPLA', 'WBSTA'], [
        `VBELN = '${vbeln}' AND POSNR = '${posnr}'`
      ]);
      if (!rows.length) return null;
      const li = rows[0];
      const likp = await this.rfc.readTable('LIKP', ['VBELN', 'LFDAT'], [`VBELN = '${vbeln}'`]);
      const lfdat = (likp[0] && likp[0].LFDAT) || '';
      return {
        Plant: li.WERKS || '',
        StorageLocation: li.LGORT || '',
        Batch: li.CHARG || '',
        DeliveryQuantity: toNum(li.LFIMG),
        Unit: li.VRKME || li.MEINS || '',
        BaseUnit: li.MEINS || '',
        FactorNumerator: toNum(li.UMVKZ),
        FactorDenominator: toNum(li.UMVKN),
        WarehouseNumber: li.LGNUM || '',
        WarehouseStorageBin: li.LGPLA || '',
        GoodsMovementStatus: li.WBSTA || '',
        DeliveryDate: /^\d{8}$/.test(lfdat) && lfdat !== '00000000' ? `${lfdat.slice(0, 4)}-${lfdat.slice(4, 6)}-${lfdat.slice(6, 8)}` : ''
      };
    } catch (err) {
      if (this._isOutage(err)) throw err;
      LOG.warn(`Delivery item read (LIPS/LIKP) failed for ${vbeln}/${deliveryItem}: ${err.message}`);
      return null;
    }
  }

  /** The plant SAP holds for an inbound delivery item; '' when it cannot be read. */
  async readDeliveryPlant(deliveryDocument, deliveryItem) {
    const facts = await this._readDeliveryItemFacts(deliveryDocument, deliveryItem);
    return facts ? facts.Plant : '';
  }

  /**
   * Retrieves authentic Goods Receipt item data (OpenQuantity, OrderedQuantity, UnitOfMeasure, EntryUnit, etc.)
   * from MMIM_GR4PO_DL_SRV/GR4PO_DL_Items and GR4PO_DL_Headers, completed with the delivery item itself (LIPS/LIKP).
   * Eliminates hardcoded quantities in strict compliance with AGENTS.md.
   */
  async getGoodsReceiptItem(deliveryDocument = '', deliveryItem = '', purchaseOrder = '', purchaseOrderItem = '') {
    // 1. Inbound Delivery: GR4PO_DL_Items key lookup (SourceOfGR='INBDELIV') + LIPS/LIKP facts.
    //    Live finding (180000006): the OData item comes back as an empty shell (no material, no unit, 0.000 quantities),
    //    so the delivery item in LIPS is the source for SLoc, batch, quantity, unit and WM data.
    if (deliveryDocument) {
      const delivDoc = String(deliveryDocument).trim();
      const sItem = deliveryItem ? String(deliveryItem).padStart(6, '0') : '000010';
      let odata = null;
      try {
        const itemKey = `InboundDelivery='${delivDoc}',DeliveryDocumentItem='${sItem}',SourceOfGR='INBDELIV',AccountAssignmentNumber='',ReferenceLineID=''`;
        const res = await this._get(
          `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Items(${itemKey})`,
          '$format=json'
        );
        odata = (Array.isArray(res) ? res[0] : res) || null;
      } catch (err) {
        if (this._isOutage(err)) {
          throw err;
        }
        LOG.warn(`Goods receipt item lookup failed for delivery ${delivDoc}: ${err.message}`);
      }
      const facts = await this._readDeliveryItemFacts(delivDoc, sItem);
      const it = odata || {};
      const openQty = toNum(it.OpenQuantity);
      const ordQty = toNum(it.OrderedQuantity);
      const entryQty = toNum(it.QuantityInEntryUnit);
      const odataUnit = it.UnitOfMeasure || it.EntryUnit || it.OrderedQuantityUnit || '';
      const hasODataItem = (openQty !== null && openQty > 0) || (ordQty !== null && ordQty > 0) || !!(odataUnit && odataUnit.trim());
      if (hasODataItem || facts) {
        const unit = odataUnit || (facts && facts.Unit) || '';
        // ponytail: a partially received item (status B) is not netted against EKBE; open = delivery quantity until status C.
        let open = openQty;
        if (!(openQty !== null && openQty > 0) && facts) {
          open = facts.GoodsMovementStatus === 'C' ? 0 : facts.DeliveryQuantity;
        }
        return {
          SourceOfGR: 'INBDELIV',
          InboundDelivery: it.InboundDelivery || delivDoc,
          DeliveryDocumentItem: it.DeliveryDocumentItem || sItem,
          OpenQuantity: open,
          OrderedQuantity: ordQty,
          QuantityInEntryUnit: entryQty,
          Unit: unit ? unit.trim().toUpperCase() : '',
          StorageLocation: it.StorageLocation || (facts && facts.StorageLocation) || '',
          StorageLocationName: it.StorageLocationName || '',
          WarehouseStorageBin: it.WarehouseStorageBin || (facts && facts.WarehouseStorageBin) || '',
          WarehouseNumber: (facts && facts.WarehouseNumber) || '',
          Batch: it.Batch || (facts && facts.Batch) || '',
          DeliveryQuantity: facts ? facts.DeliveryQuantity : null,
          DeliveryDate: (facts && facts.DeliveryDate) || '',
          GoodsMovementStatus: (facts && facts.GoodsMovementStatus) || '',
          Material: it.Material || '',
          MaterialName: it.MaterialName || it.PurchaseOrderItemText || '',
          Plant: it.Plant || '',
          PlantName: it.PlantName || ''
        };
      }
    }

    // 2. Try Purchase Order via Header2Items navigation and GR4PO_DL_Items key lookup (SourceOfGR='PURORD')
    if (purchaseOrder) {
      const poDoc = String(purchaseOrder).trim();
      const sPoItem = purchaseOrderItem ? String(purchaseOrderItem).trim() : '';

      // 2a. Query GR4PO_DL_Headers(...)/Header2Items which returns all open PO items
      try {
        const headerNav = `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers(InboundDelivery='${poDoc}',SourceOfGR='PURORD')/Header2Items`;
        const resNav = await this._get(headerNav, '$format=json');
        const items = Array.isArray(resNav) ? resNav : (resNav?.results ? resNav.results : (resNav ? [resNav] : []));
        if (items.length > 0) {
          let matched = null;
          if (sPoItem) {
            matched = items.find(i =>
              i.DeliveryDocumentItem === sPoItem ||
              i.DeliveryDocumentItem === sPoItem.padStart(5, '0') ||
              i.DeliveryDocumentItem === sPoItem.padStart(6, '0')
            );
          }
          if (!matched) {
            matched = items.find(i => Number(i.OpenQuantity) > 0) || items[0];
          }
          if (matched) {
            const openQty = (matched.OpenQuantity !== undefined && matched.OpenQuantity !== null && matched.OpenQuantity !== '') ? Number(matched.OpenQuantity) : null;
            const ordQty = (matched.OrderedQuantity !== undefined && matched.OrderedQuantity !== null && matched.OrderedQuantity !== '') ? Number(matched.OrderedQuantity) : null;
            const entryQty = (matched.QuantityInEntryUnit !== undefined && matched.QuantityInEntryUnit !== null && matched.QuantityInEntryUnit !== '') ? Number(matched.QuantityInEntryUnit) : null;
            const unit = matched.UnitOfMeasure || matched.EntryUnit || matched.OrderedQuantityUnit || '';
            return {
              SourceOfGR: 'PURORD',
              InboundDelivery: matched.InboundDelivery || poDoc,
              DeliveryDocumentItem: matched.DeliveryDocumentItem || sPoItem,
              OpenQuantity: openQty !== null && !isNaN(openQty) ? openQty : null,
              OrderedQuantity: ordQty !== null && !isNaN(ordQty) ? ordQty : null,
              QuantityInEntryUnit: entryQty !== null && !isNaN(entryQty) ? entryQty : null,
              Unit: unit ? unit.trim().toUpperCase() : '',
              StorageLocation: matched.StorageLocation || '',
              StorageLocationName: matched.StorageLocationName || '',
              WarehouseStorageBin: matched.WarehouseStorageBin || '',
              Batch: matched.Batch || '',
              Material: matched.Material || '',
              MaterialName: matched.MaterialName || matched.PurchaseOrderItemText || '',
              Plant: matched.Plant || '',
              PlantName: matched.PlantName || ''
            };
          }
        }
      } catch (err) {
        if (this._isOutage(err)) {
          throw err;
        }
        LOG.warn(`Header2Items query failed for PO ${poDoc}: ${err.message}`);
      }

      // 2b. Query GR4PO_DL_Items by key for PO
      const candItems = sPoItem ? [sPoItem.padStart(5, '0'), sPoItem.padStart(6, '0')] : ['00010', '000010'];
      for (const cand of candItems) {
        try {
          const itemKey = `InboundDelivery='${poDoc}',DeliveryDocumentItem='${cand}',SourceOfGR='PURORD',AccountAssignmentNumber='',ReferenceLineID=''`;
          const res = await this._get(
            `/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Items(${itemKey})`,
            '$format=json'
          );
          const it = Array.isArray(res) ? res[0] : res;
          if (it) {
            const openQty = (it.OpenQuantity !== undefined && it.OpenQuantity !== null && it.OpenQuantity !== '') ? Number(it.OpenQuantity) : null;
            const ordQty = (it.OrderedQuantity !== undefined && it.OrderedQuantity !== null && it.OrderedQuantity !== '') ? Number(it.OrderedQuantity) : null;
            const entryQty = (it.QuantityInEntryUnit !== undefined && it.QuantityInEntryUnit !== null && it.QuantityInEntryUnit !== '') ? Number(it.QuantityInEntryUnit) : null;
            const unit = it.UnitOfMeasure || it.EntryUnit || it.OrderedQuantityUnit || '';
            if ((openQty !== null && openQty > 0) || (ordQty !== null && ordQty > 0) || (unit && unit.trim())) {
              return {
                SourceOfGR: 'PURORD',
                InboundDelivery: it.InboundDelivery || poDoc,
                DeliveryDocumentItem: it.DeliveryDocumentItem || cand,
                OpenQuantity: openQty !== null && !isNaN(openQty) ? openQty : null,
                OrderedQuantity: ordQty !== null && !isNaN(ordQty) ? ordQty : null,
                QuantityInEntryUnit: entryQty !== null && !isNaN(entryQty) ? entryQty : null,
                Unit: unit ? unit.trim().toUpperCase() : '',
                StorageLocation: it.StorageLocation || '',
                StorageLocationName: it.StorageLocationName || '',
                WarehouseStorageBin: it.WarehouseStorageBin || '',
                Batch: it.Batch || '',
                Material: it.Material || '',
                MaterialName: it.MaterialName || it.PurchaseOrderItemText || '',
                Plant: it.Plant || '',
                PlantName: it.PlantName || ''
              };
            }
          }
        } catch (err) {
          if (this._isOutage(err)) {
            throw err;
          }
          LOG.warn(`GR4PO_DL_Items query failed for PO ${poDoc} item ${cand}: ${err.message}`);
        }
      }
    }

    return null;
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
  /**
   * Resolves Storage Unit / Inbound Delivery via GoodsReceiptStorageUnitResolver.
   */
  async resolveStorageUnit(suNumber) {
    return suResolver.resolveStorageUnit(this, suNumber);
  }

  /**
   * Executes Goods Receipt posting in SAP S/4HANA via GoodsReceiptPostingHelper.
   */
  async postGoodsReceipt(payload = {}, options = {}) {
    return postingHelper.postGoodsReceipt(this, payload, options);
  }

  /**
   * 101 documents of a delivery item, newest first (delegated to GoodsReceiptPostingHelper).
   */
  async _read101Docs(delivery, item, extraWhere = []) {
    return postingHelper._read101Docs(this, delivery, item, extraWhere);
  }

  /**
   * The 101 document that may belong to a receipt attempt (delegated to GoodsReceiptPostingHelper).
   */
  async findReceiptForAttempt(attempt) {
    return postingHelper.findReceiptForAttempt(this, attempt);
  }

  /**
   * Executes Goods Receipt posting against Storage Unit / Inbound Delivery via GoodsReceiptPostingHelper.
   */
  async postGoodsReceiptWithStorageUnit(payload = {}) {
    return postingHelper.postGoodsReceiptWithStorageUnit(this, payload);
  }
}

module.exports = new GoodsReceiptAdapter();
module.exports.GoodsReceiptAdapter = GoodsReceiptAdapter;
