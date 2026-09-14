const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueQueueManager = require('../GoodsIssueQueueManager');

function _extractFilterParam(req, fieldName) {
  if (req.data?.[fieldName]) return req.data[fieldName];
  if (req.params && req.params.length > 0 && req.params[0][fieldName]) return req.params[0][fieldName];

  const where = req.query?.SELECT?.where;
  if (Array.isArray(where)) {
    for (let i = 0; i < where.length; i++) {
      const item = where[i];
      if (item === fieldName && where[i + 1] === '=' && where[i + 2] !== undefined) {
        const val = where[i + 2];
        return typeof val === 'object' ? (val.val || val) : String(val).replace(/['"]/g, '');
      }
      if (item && typeof item === 'object' && item.ref && item.ref[0] === fieldName) {
        if (where[i + 1] === '=' && where[i + 2] !== undefined) {
          const val = where[i + 2];
          return typeof val === 'object' ? (val.val || val) : String(val).replace(/['"]/g, '');
        }
      }
    }
  }

  // Fallback to raw query string or query options
  const rawFilter = req._queryOptions?.$filter || (req.req && req.req.url ? decodeURIComponent(req.req.url) : '');
  if (rawFilter) {
    const re = new RegExp(`${fieldName}\\s+eq\\s+['"]?([^'"&\\s)]+)['"]?`, 'i');
    const m = rawFilter.match(re);
    if (m && m[1]) return m[1];
  }

  return null;
}

class GoodsIssueHandler {
  static init(srv) {
    // READ GIItems: query open items by Order or Reservation number
    srv.on('READ', 'GIItems', async (req) => {
      const orderNo = _extractFilterParam(req, 'OrderNo');
      const reservNo = _extractFilterParam(req, 'ReservationNo');

      try {
        const items = await GoodsIssueAdapter.getOpenItems(orderNo, reservNo);
        return items;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read Goods Issue items');
      }
    });

    // READ OpenReservations: query distinct open reservations for Goods Issue
    srv.on('READ', 'OpenReservations', async (req) => {
      const plant = _extractFilterParam(req, 'Plant') || '';
      const mvtType = _extractFilterParam(req, 'MovementType') || '261';

      try {
        const reservations = await GoodsIssueAdapter.getOpenReservations(mvtType, plant);
        return reservations;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read open reservations from S/4HANA');
      }
    });

    // READ MaterialBatches: query batches for a material with SLED information
    srv.on('READ', 'MaterialBatches', async (req) => {
      const material = _extractFilterParam(req, 'Material');
      const plant = _extractFilterParam(req, 'Plant') || '';
      const storageLoc = _extractFilterParam(req, 'StorageLocation') || '';

      if (!material) {
        return req.error(400, 'Material filter parameter is required to query batches');
      }

      try {
        const batches = await GoodsIssueAdapter.getMaterialBatches(material, plant, storageLoc);
        return batches;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read material batches');
      }
    });

    // READ GoodsIssueQueue: query offline dispatch queue
    srv.on('READ', 'GoodsIssueQueue', async () => {
      return GoodsIssueQueueManager.getAll();
    });

    // FUNCTION: getQueueSummary: return pending count and items
    srv.on('getQueueSummary', async () => {
      return GoodsIssueQueueManager.getSummary();
    });

    // FUNCTION: resolveIdentifier (Multi-tier scan resolution for Goods Issue)
    srv.on('resolveIdentifier', async (req) => {
      const barcode = req.data?.barcode || (req.params && req.params[0]?.barcode);
      if (!barcode) {
        return req.error(400, 'Barcode parameter is required');
      }

      try {
        const result = await GoodsIssueAdapter.resolveIdentifier(barcode);
        return result;
      } catch (err) {
        return req.error(err.status || err.statusCode || 404, err.message || 'Failed to resolve scanned identifier in S/4HANA');
      }
    });

    // ACTION: postGoodsIssue (Single-line posting with automated Dispatch Queue fallback)
    srv.on('postGoodsIssue', async (req) => {
      const {
        ReservationNo,
        ReservationItem,
        Material,
        IssueQty,
        Unit,
        Batch,
        DifferenceQty,
        DifferenceReason,
        DifferenceStorageType,
        FinalIssue
      } = req.data;

      if (!ReservationNo || !ReservationItem) {
        return req.error(400, 'ReservationNo and ReservationItem are required');
      }

      const nQty = Number(IssueQty);
      if (isNaN(nQty) || nQty <= 0) {
        return req.error(400, 'IssueQty must be a positive decimal number');
      }

      try {
        const result = await GoodsIssueAdapter.postGoodsIssue(
          ReservationNo,
          ReservationItem,
          Material,
          nQty,
          Unit,
          Batch,
          DifferenceQty,
          DifferenceReason,
          DifferenceStorageType,
          FinalIssue
        );
        return Object.assign({
          Queued: false,
          QueueReference: '',
          SyncStatus: 'POSTED_IN_SAP'
        }, result);
      } catch (err) {
        // If client validation error (400) or SLED block, fail immediately
        if (err.status === 400) {
          return req.error(400, err.message || 'Validation failed for Goods Issue');
        }

        // If backend posting capability is unavailable (501 / 403 / 404), route to Dispatch Queue
        if (err.status === 501 || err.status === 403 || err.status === 404 || (err.message && err.message.includes('Unavailable'))) {
          const queueRecord = GoodsIssueQueueManager.enqueue({
            ReservationNo,
            ReservationItem,
            Material,
            IssueQty: nQty,
            Unit,
            Batch,
            DifferenceQty,
            DifferenceReason,
            DifferenceStorageType,
            FinalIssue,
            LastSyncError: err.message
          });

          return {
            ReservationNo: String(ReservationNo),
            ReservationItem: String(ReservationItem).padStart(4, '0'),
            MaterialDocument: '',
            MaterialDocYear: '',
            TransferOrder: '',
            DifferenceCleared: Number(DifferenceQty) > 0,
            DifferenceQty: Number(DifferenceQty) || 0,
            Success: true,
            Queued: true,
            QueueReference: queueRecord.QueueReference,
            SyncStatus: 'QUEUED',
            Message: `Transaction safely recorded in CAP Dispatch Queue (${queueRecord.QueueReference}). Pending SAP S/4HANA Gateway service activation.`
          };
        }

        return req.error(err.status || 400, err.message || 'Failed to post Goods Issue in S/4HANA');
      }
    });

    // ACTION: submitGoodsIssueRequest (Batch scan-then-submit multi-line posting)
    srv.on('submitGoodsIssueRequest', async (req) => {
      const { ReservationNo, OrderNo, Items } = req.data;

      if (!ReservationNo && !OrderNo) {
        return req.error(400, 'Either ReservationNo or OrderNo must be provided for submission');
      }

      if (!Array.isArray(Items) || Items.length === 0) {
        return req.error(400, 'At least one item must be specified for submission');
      }

      try {
        const batchResult = await GoodsIssueAdapter.submitGoodsIssueRequest(
          ReservationNo,
          OrderNo,
          Items
        );
        return batchResult;
      } catch (err) {
        return req.error(err.status || 400, err.message || 'Batch Goods Issue submission failed');
      }
    });

    // ACTION: retryQueuedGoodsIssue (Retry posting a queued item against live SAP)
    srv.on('retryQueuedGoodsIssue', async (req) => {
      const { QueueReference } = req.data;
      if (!QueueReference) {
        return req.error(400, 'QueueReference parameter is required');
      }

      const item = GoodsIssueQueueManager.get(QueueReference);
      if (!item) {
        return req.error(404, `Queued transaction ${QueueReference} not found`);
      }

      try {
        const result = await GoodsIssueAdapter.postGoodsIssue(
          item.ReservationNo,
          item.ReservationItem,
          item.Material,
          item.IssueQty,
          item.Unit,
          item.Batch,
          item.DifferenceQty,
          item.DifferenceReason,
          item.DifferenceStorageType,
          item.FinalIssue
        );

        // Update queue item
        GoodsIssueQueueManager.update(QueueReference, {
          SyncStatus: 'POSTED_IN_SAP',
          SapMaterialDocument: result.MaterialDocument || '',
          SapMaterialDocYear: result.MaterialDocYear || String(new Date().getFullYear()),
          SyncedAt: new Date().toISOString()
        });

        return Object.assign({
          Success: true,
          Queued: false,
          QueueReference: item.QueueReference,
          SyncStatus: 'POSTED_IN_SAP'
        }, result);
      } catch (err) {
        // Record retry attempt
        GoodsIssueQueueManager.update(QueueReference, {
          SyncAttempts: (item.SyncAttempts || 1) + 1,
          LastSyncError: err.message || 'Posting rejected by Gateway'
        });

        return {
          ReservationNo: item.ReservationNo,
          ReservationItem: item.ReservationItem,
          MaterialDocument: '',
          MaterialDocYear: '',
          TransferOrder: '',
          DifferenceCleared: false,
          DifferenceQty: item.DifferenceQty || 0,
          Success: false,
          Queued: true,
          QueueReference: item.QueueReference,
          SyncStatus: 'FAILED',
          Message: `SAP Gateway retry rejected: ${err.message}`
        };
      }
    });

    // ACTION: clearQueuedGoodsIssue (Remove item from dispatch queue)
    srv.on('clearQueuedGoodsIssue', async (req) => {
      const { QueueReference } = req.data;
      if (!QueueReference) {
        return req.error(400, 'QueueReference parameter is required');
      }
      return GoodsIssueQueueManager.remove(QueueReference);
    });

    // ──────────────────────────────────────────────────────────
    // FUNCTION: resolveStockUnit — SU Barcode → Stock → Batch
    // Returns StockUnitResolution with SuExists:false for business-level
    // "not found" instead of HTTP 404, so the OData endpoint itself never
    // returns 404 for a valid barcode query.
    // ──────────────────────────────────────────────────────────
    srv.on('resolveStockUnit', async (req) => {
      const suBarcode = req.data?.suBarcode || '';
      const reservationNo = req.data?.reservationNo || '';
      const reservationItem = req.data?.reservationItem || '';

      if (!suBarcode) {
        return req.error(400, 'suBarcode parameter is required');
      }
      if (!reservationNo || !reservationItem) {
        return req.error(400, 'reservationNo and reservationItem parameters are required');
      }

      try {
        const result = await GoodsIssueAdapter.resolveStockUnitForGoodsIssue(
          suBarcode,
          reservationNo,
          reservationItem
        );
        return result;
      } catch (err) {
        // Business-level "not found in SAP" — return a valid StockUnitResolution
        // with SuExists:false so the OData function always returns 200 with a
        // typed response. Only true infrastructure errors (502, 500) become HTTP errors.
        const httpStatus = err.status || err.statusCode || 500;
        if (httpStatus === 404 || httpStatus === 422 || httpStatus === 409) {
          return {
            SuBarcode: suBarcode,
            SuExists: false,
            SuNotFoundReason: err.message || 'Stock Unit not found in SAP',
            ResolvedType: '',
            HuService: '',
            HuInternalNumber: '',
            HuExternalId: '',
            DeliveryDocument: '',
            DeliveryDocumentItem: '',
            Material: err.details?.material || '',
            MaterialDesc: err.details?.materialDesc || '',
            Plant: err.details?.plant || '',
            StorageLocation: err.details?.storageLocation || '',
            StorageBin: '',
            CurrentStock: err.details?.currentStock || 0,
            SuStockQty: err.details?.currentStock || 0,
            BaseUnit: err.details?.baseUnit || '',
            Batches: err.details?.availableBatches || [],
            DeterminedBatch: '',
            DeterminedBatchExpiry: null,
            DeterminedBatchStatusState: 'None',
            DeterminedBatchStatusText: 'NOT_FOUND',
            DeterminedBatchDaysToExpiry: 0,
            MultipleBatches: false,
            NoBatchAvailable: Array.isArray(err.details?.availableBatches) && err.details.availableBatches.length === 0,
            ReservationNo: reservationNo,
            ReservationItem: reservationItem,
            OrderNo: '',
            MaterialMatch: false,
            PlantMatch: false,
            SLocMatch: false,
            ReservationRemainingQty: 0,
            ReservationRequiredQty: 0,
            ReservationWithdrawnQty: 0,
            MaxIssueQty: 0,
            Unit: err.details?.baseUnit || ''
          };
        }
        return req.error(
          httpStatus,
          err.message || 'Failed to resolve Stock Unit in S/4HANA'
        );
      }
    });

    // ──────────────────────────────────────────────────────────
    // FUNCTION: revalidateStock — Pre-posting SAP stock check
    // ──────────────────────────────────────────────────────────
    srv.on('revalidateStock', async (req) => {
      const material = req.data?.material || '';
      const plant = req.data?.plant || '';
      const storageLocation = req.data?.storageLocation || '';
      const batch = req.data?.batch || '';
      const requiredQty = req.data?.requiredQty || 0;

      if (!material) {
        return req.error(400, 'material parameter is required');
      }

      try {
        const result = await GoodsIssueAdapter.revalidateStockBeforePosting(
          material,
          plant,
          storageLocation,
          batch,
          requiredQty
        );
        return result;
      } catch (err) {
        return req.error(
          err.status || err.statusCode || 500,
          err.message || 'Failed to revalidate stock in S/4HANA'
        );
      }
    });
  }
}

module.exports = GoodsIssueHandler;

