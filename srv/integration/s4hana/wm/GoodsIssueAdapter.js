const LOG = require('../logger')('goods-issue-adapter');
const S4ErrorMapper = require('../S4ErrorMapper');
const { S4HttpClient, DESTINATION_NOT_CONFIGURED } = require('../S4HttpClient');
const s4Config = require('../s4Config');
const { enrichBatchStatus } = require('../../../common/batchUtils');
const { formatDateToYMD } = require('../../../common/dateUtils');
const {
  GoodsIssueReservationsClient,
  GoodsIssueBatchesClient,
  GoodsIssueStockUnitClient,
  GoodsIssuePostingClient
} = require('./goods-issue');

/**
 * Orchestrator and Facade for SAP S/4HANA Goods Issue (Movement 261).
 * Decomposed into dedicated domain clients:
 * - GoodsIssueReservationsClient: Reservation queries & open items
 * - GoodsIssueBatchesClient: Batch master data, FEFO sort, SLED checks, MARM packaging units, stock revalidation
 * - GoodsIssueStockUnitClient: SCWM Handling Unit / Stock Unit discovery, lookup & resolution
 * - GoodsIssuePostingClient: Multi-tier Goods Issue posting & batch submission
 *
 * Strict compliance with AGENTS.md SAP API Discovery Protocol:
 * NO dummy data, NO mock persistence, NO synthetic document generation.
 */
class GoodsIssueAdapter {
  /**
   * Gateway entity set that reliably issues a CSRF token and session cookies on this system; used for
   * every transactional POST of this adapter.
   */
  static CSRF_FETCH_PATH = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1';

  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;

    // Instantiate domain clients
    this.batches = new GoodsIssueBatchesClient({ adapter: this, client: this.client });
    this.reservations = new GoodsIssueReservationsClient({ adapter: this, client: this.client, batchesClient: this.batches });
    this.stockUnits = new GoodsIssueStockUnitClient({ adapter: this, client: this.client, batchesClient: this.batches });
    this.posting = new GoodsIssuePostingClient({ adapter: this, client: this.client, batchesClient: this.batches });
  }

  /**
   * Determine if an error represents an S/4HANA backend outage, network timeout,
   * unconfigured destination, or authentication failure.
   */
  _isOutage(err) {
    if (!err) return false;
    if (err.code === DESTINATION_NOT_CONFIGURED || err.code === 'DESTINATION_NOT_CONFIGURED' || err.code === 'S4_DESTINATION_NOT_CONFIGURED') return true;
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
   * Enrich batch object with SLED classification against current date (delegates to shared batchUtils)
   */
  _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  static _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  /**
   * Format OData date string to ISO YYYY-MM-DD (delegates to shared dateUtils)
   */
  _formatDate(dateVal) {
    return formatDateToYMD(dateVal);
  }

  static _formatDate(dateVal) {
    return formatDateToYMD(dateVal);
  }

  /**
   * Resolve the S/4HANA destination through the shared client.
   */
  async _getDestination() {
    return this.client.resolveDestination();
  }

  /**
   * HTTP GET against an S/4HANA OData service via the SAP Cloud SDK.
   * Returns the unwrapped OData V2 result set (d.results / d) or the OData V4 value array.
   */
  async _get(servicePath, queryParams = '') {
    try {
      const { data } = await this.client.get(servicePath, { query: queryParams });
      return data?.d?.results || data?.d || data?.value || [];
    } catch (err) {
      if (err.code === DESTINATION_NOT_CONFIGURED) throw err;
      throw S4ErrorMapper.mapS4Error(err);
    }
  }

  /**
   * HTTP POST against an S/4HANA OData service via the SAP Cloud SDK. The CSRF token and the SAP session
   * cookies are fetched for this call only and sent with it; nothing is cached on the adapter.
   */
  async _post(servicePath, payload = {}, customHeaders = {}) {
    const { data } = await this.client.post(servicePath, {
      data: payload,
      headers: customHeaders,
      csrfPath: GoodsIssueAdapter.CSRF_FETCH_PATH
    });
    if (data && typeof data === 'object') {
      return data.d || data;
    }
    return true;
  }

  /**
   * Fetch an OData service $metadata document as raw XML text.
   * Delegated to stockUnits domain client; provides spy target for tests.
   */
  async _getMetadataXml(servicePath) {
    return this.stockUnits._fetchMetadataXml(servicePath);
  }

  /**
   * Reset the cached SU/HU metadata model.
   */
  _resetHuModelCache() {
    this.stockUnits._resetHuModelCache();
  }

  // ──────────────────────────────────────────────────────────
  // Primary multi-tier barcode / identifier resolution
  // ──────────────────────────────────────────────────────────

  /**
   * Primary discovery engine: Multi-tier resolution of scanned barcode to authentic SAP S/4HANA objects
   * Flow: Scan -> Identify scanned value type -> Resolve SAP object -> Retrieve related Component/Batch/Stock/SLED
   * Supported types:
   * 1. Reservation Number (UI_RESERVATION_ITM_MNG_V2)
   * 2. Production / Manufacturing Order (UI_RESERVATION_ITM_MNG_V2 / MMIMProductionOrderVH)
   * 3. Batch Barcode (LO_BM_BATCH_SRV/I_Batch + auto-link to open reservation)
   * 4. Material Barcode (UI_RESERVATION_ITM_MNG_V2)
   * 5. Storage Unit / Delivery Barcode (MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet)
   * 6. Clear HTTP 404 validation error when identifier does not exist in SAP Client 220
   */
  async resolveIdentifier(barcode) {
    if (!barcode || typeof barcode !== 'string') {
      const err = new Error('Barcode or SAP identifier is required.');
      err.status = 400;
      throw err;
    }

    const sClean = barcode.trim();
    if (!sClean) {
      const err = new Error('Barcode or SAP identifier is required.');
      err.status = 400;
      throw err;
    }

    let scannedType = '';
    let scannedTypeLabel = '';
    let resolvedResv = '';
    let resolvedOrder = '';
    let targetBatch = '';
    let targetMaterial = '';

    // TIER 1: Check Reservation Number directly via UI_RESERVATION_ITM_MNG_V2
    try {
      const resvClean = sClean.replace(/^0+/, '');
      const resvPadded = sClean.padStart(10, '0');
      const filter = `(Reservation eq '${resvClean}' or Reservation eq '${resvPadded}') and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
      const res = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$top=50&$format=json`);
      if (Array.isArray(res) && res.length > 0) {
        scannedType = 'RESERVATION';
        scannedTypeLabel = 'Reservation';
        resolvedResv = res[0].Reservation;
        resolvedOrder = res[0].OrderID || '';
      }
    } catch (err) {
      if (this._isOutage(err)) {
        LOG.error(`resolveBarcode tier 1 failed due to S/4HANA outage: ${err.message}`, err);
        const outageErr = new Error(`S/4HANA unavailable during barcode resolution: ${err.message}`);
        outageErr.status = err.status || 502;
        throw outageErr;
      }
      LOG.warn(`resolveBarcode tier 1 (Reservation) non-outage warning: ${err.message}`);
    }

    // TIER 2: Check Production / Manufacturing Order Number
    if (!scannedType) {
      try {
        const orderClean = sClean.replace(/^0+/, '');
        const orderPadded = sClean.padStart(12, '0');
        const filter = `(OrderID eq '${orderClean}' or OrderID eq '${orderPadded}') and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
        const res = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$top=50&$format=json`);
        if (Array.isArray(res) && res.length > 0) {
          scannedType = 'PRODUCTION_ORDER';
          scannedTypeLabel = 'Production Order';
          resolvedResv = res[0].Reservation;
          resolvedOrder = res[0].OrderID;
        } else {
          // Check MMIMProductionOrderVH
          const prodRes = await this._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/MMIMProductionOrderVH', `$filter=ManufacturingOrder eq '${sClean}'&$top=1&$format=json`);
          if (Array.isArray(prodRes) && prodRes.length > 0) {
            scannedType = 'PRODUCTION_ORDER';
            scannedTypeLabel = 'Production Order';
            resolvedOrder = prodRes[0].ManufacturingOrder;
            const itemsByOrder = await this.getOpenItems(resolvedOrder, '');
            if (itemsByOrder.length > 0) {
              resolvedResv = itemsByOrder[0].ReservationNo;
            }
          }
        }
      } catch (err) {
        if (this._isOutage(err)) {
          LOG.error(`resolveBarcode tier 2 failed due to S/4HANA outage: ${err.message}`, err);
          const outageErr = new Error(`S/4HANA unavailable during barcode resolution: ${err.message}`);
          outageErr.status = err.status || 502;
          throw outageErr;
        }
        LOG.warn(`resolveBarcode tier 2 (Production Order) non-outage warning: ${err.message}`);
      }
    }

    // TIER 3: Check Batch via LO_BM_BATCH_SRV/I_Batch
    if (!scannedType) {
      try {
        const batchRes = await this._get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', `$filter=Batch eq '${encodeURIComponent(sClean)}'&$top=5&$format=json`);
        if (Array.isArray(batchRes) && batchRes.length > 0) {
          const b = batchRes[0];
          scannedType = 'BATCH';
          scannedTypeLabel = 'Batch';
          targetBatch = b.Batch;
          targetMaterial = b.Material;

          // Search open reservations requiring this material
          const filter = `Product eq '${encodeURIComponent(targetMaterial)}' and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
          const resvItems = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$top=20&$format=json`);
          if (Array.isArray(resvItems) && resvItems.length > 0) {
            const batchMatch = resvItems.find(it => it.Batch === targetBatch) || resvItems[0];
            resolvedResv = batchMatch.Reservation;
            resolvedOrder = batchMatch.OrderID || '';
          }
        }
      } catch (err) {
        if (this._isOutage(err)) {
          LOG.error(`resolveBarcode tier 3 failed due to S/4HANA outage: ${err.message}`, err);
          const outageErr = new Error(`S/4HANA unavailable during barcode resolution: ${err.message}`);
          outageErr.status = err.status || 502;
          throw outageErr;
        }
        LOG.warn(`resolveBarcode tier 3 (Batch) non-outage warning: ${err.message}`);
      }
    }

    // TIER 4: Check Material via UI_RESERVATION_ITM_MNG_V2
    if (!scannedType) {
      try {
        const matClean = sClean.replace(/^0+/, '');
        const filter = `(Product eq '${encodeURIComponent(sClean)}' or Product eq '${encodeURIComponent(matClean)}') and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
        const resvItems = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$top=20&$format=json`);
        if (Array.isArray(resvItems) && resvItems.length > 0) {
          scannedType = 'MATERIAL';
          scannedTypeLabel = 'Material / Component';
          targetMaterial = resvItems[0].Product;
          resolvedResv = resvItems[0].Reservation;
          resolvedOrder = resvItems[0].OrderID || '';
        }
      } catch (err) {
        if (this._isOutage(err)) {
          LOG.error(`resolveBarcode tier 4 failed due to S/4HANA outage: ${err.message}`, err);
          const outageErr = new Error(`S/4HANA unavailable during barcode resolution: ${err.message}`);
          outageErr.status = err.status || 502;
          throw outageErr;
        }
        LOG.warn(`resolveBarcode tier 4 (Material) non-outage warning: ${err.message}`);
      }
    }

    // TIER 5: Check Storage Unit / Inbound Delivery via HMmimGr4inbdelSet
    if (!scannedType) {
      try {
        const delRes = await this._get('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet', `$filter=DeliveryDocument eq '${encodeURIComponent(sClean)}'&$top=1&$format=json`);
        if (Array.isArray(delRes) && delRes.length > 0) {
          const d = delRes[0];
          scannedType = 'STORAGE_UNIT';
          scannedTypeLabel = 'Storage Unit / Delivery';
          targetMaterial = d.Material;
          const filter = `Product eq '${encodeURIComponent(targetMaterial)}' and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`;
          const resvItems = await this._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$top=1&$format=json`);
          if (Array.isArray(resvItems) && resvItems.length > 0) {
            resolvedResv = resvItems[0].Reservation;
            resolvedOrder = resvItems[0].OrderID || '';
          }
        }
      } catch (err) {
        if (this._isOutage(err)) {
          LOG.error(`resolveBarcode tier 5 failed due to S/4HANA outage: ${err.message}`, err);
          const outageErr = new Error(`S/4HANA unavailable during barcode resolution: ${err.message}`);
          outageErr.status = err.status || 502;
          throw outageErr;
        }
        LOG.warn(`resolveBarcode tier 5 (Storage Unit) non-outage warning: ${err.message}`);
      }
    }

    // TIER 6: Error if not found across all tiers in SAP Client 220
    if (!scannedType || !resolvedResv) {
      const err = new Error(
        `Validation Error: Scanned barcode '${sClean}' was evaluated across active Reservations, Production Orders, Materials, Batches, and Storage Units in SAP S/4HANA (Client ${s4Config.getClient()}) and does not match any open Goods Issue requirement. Please scan a valid SAP identifier or use Value Help to select an open reservation.`
      );
      err.status = 404;
      throw err;
    }

    // Load full open component items for resolved reservation
    const openItems = await this.getOpenItems(resolvedOrder, resolvedResv);
    if (!openItems || openItems.length === 0) {
      const err = new Error(`Reservation ${resolvedResv} has no open requirement items remaining to issue in SAP.`);
      err.status = 404;
      throw err;
    }

    // Determine active item (prefer matching targetMaterial or targetBatch, or first item)
    let activeItem = Object.assign({}, openItems[0]);
    if (targetMaterial) {
      const matched = openItems.find(it => it.Material === targetMaterial);
      if (matched) activeItem = Object.assign({}, matched);
    }
    if (targetBatch) {
      const matchedBatch = openItems.find(it => it.Batch === targetBatch);
      if (matchedBatch) {
        activeItem = Object.assign({}, matchedBatch);
      } else {
        activeItem.Batch = targetBatch;
      }
    }

    // Retrieve batches for active item's material and plant
    const availableBatches = await this.getMaterialBatches(activeItem.Material, activeItem.Plant, activeItem.StorageLocation);

    // If active item has no batch assigned, pick top FEFO unexpired batch if available
    if (!activeItem.Batch && availableBatches.length > 0) {
      const topBatch = availableBatches[0];
      activeItem.Batch = topBatch.Batch;
      activeItem.ExpiryDate = topBatch.ExpiryDate;
      activeItem.BatchStatusState = topBatch.StatusState;
      activeItem.BatchStatusText = topBatch.StatusText;
    }

    // Determine confirmed stock from batches or storage location
    let availableStock = 0;
    if (availableBatches.length > 0) {
      const selBatchObj = availableBatches.find(b => b.Batch === activeItem.Batch);
      availableStock = selBatchObj && selBatchObj.AvailableStock !== null && selBatchObj.AvailableStock !== undefined
        ? selBatchObj.AvailableStock
        : availableBatches.reduce((acc, b) => acc + (Number(b.AvailableStock) || 0), 0);
    } else {
      availableStock = activeItem.OpenQty;
    }

    return {
      ScannedBarcode: sClean,
      ScannedType: scannedType,
      ScannedTypeLabel: scannedTypeLabel,
      ReservationNo: resolvedResv,
      OrderNo: resolvedOrder || activeItem.OrderNo || '',
      Plant: activeItem.Plant,
      PlantName: `Plant ${activeItem.Plant}`,
      MovementType: activeItem.MovementType || '261',
      MovementTypeName: activeItem.MovementTypeName || 'GI for order',
      ActiveItem: activeItem,
      Items: openItems,
      AvailableBatches: availableBatches,
      AvailableStock: availableStock,
      DefaultStorageLocation: activeItem.StorageLocation || s4Config.getStorageLocation(),
      DefaultStorageLocationName: activeItem.StorageBin || 'Raw Material',
      DefaultStorageBin: activeItem.StorageBin || s4Config.getStorageBin()
    };
  }

  // ──────────────────────────────────────────────────────────
  // Delegated domain methods
  // ──────────────────────────────────────────────────────────

  /**
   * Fetch alternative packaging units (MARM) for a material via MMIM_MATERIAL_DATA_SRV
   */
  async getMaterialPackagingUnits(material) {
    return this.batches.getMaterialPackagingUnits(material);
  }

  /**
   * Fetch available batches for a material with real SLED information, FEFO sort, and storage location stock
   */
  async getMaterialBatches(material, plant, storageLocation) {
    return this.batches.getMaterialBatches(material, plant, storageLocation);
  }

  /**
   * Validate that a batch is authentic, unexpired, non-deleted, and unrestricted in SAP S/4HANA
   */
  async validateBatch(material, batch, plant) {
    return this.batches.validateBatch(material, batch, plant);
  }

  /**
   * Revalidate SAP stock immediately before Goods Issue posting
   */
  async revalidateStockBeforePosting(material, plant, storageLocation, batch, requiredQty) {
    return this.batches.revalidateStockBeforePosting(material, plant, storageLocation, batch, requiredQty);
  }

  /**
   * Fetch distinct open reservations for Goods Issue directly from UI_RESERVATION_ITM_MNG_V2
   */
  async getOpenReservations(movementType = '261', plant = '') {
    return this.reservations.getOpenReservations(movementType, plant);
  }

  /**
   * Fetch open reservation component items for scanned Order or Reservation number via UI_RESERVATION_ITM_MNG_V2
   */
  async getOpenItems(orderNo, reservNo) {
    return this.reservations.getOpenItems(orderNo, reservNo);
  }

  /**
   * Authoritative SU -> Stock -> Batch resolution for Goods Issue
   */
  async resolveStockUnitForGoodsIssue(suBarcode, reservationNo, reservationItem) {
    return this.stockUnits.resolveStockUnitForGoodsIssue(suBarcode, reservationNo, reservationItem);
  }

  /**
   * Post goods issue for a single reservation component line (Bound Action)
   */
  async postGoodsIssue(reservationNo, reservationItem, material, issueQty, unit, batch, differenceQty, differenceReason, differenceStorageType, finalIssue) {
    return this.posting.postGoodsIssue(reservationNo, reservationItem, material, issueQty, unit, batch, differenceQty, differenceReason, differenceStorageType, finalIssue);
  }

  /**
   * Submit Goods Issue batch in a single LUW
   */
  async submitGoodsIssueRequest(reservationNo, orderNo, items) {
    return this.posting.submitGoodsIssueRequest(reservationNo, orderNo, items);
  }
}

module.exports = new GoodsIssueAdapter();
