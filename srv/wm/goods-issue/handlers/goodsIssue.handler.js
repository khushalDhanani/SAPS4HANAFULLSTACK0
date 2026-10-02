const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueQueueManager = require('../GoodsIssueQueueManager');
const { extractFilterParam, applyPaging } = require('../../../common/filterUtils');
const { validateReversalPayload } = require('../validation/goodsIssue.validation');
const { normalizeReversalPayload } = require('../mapping/goodsIssue.mapper');
const LOG = require('../../../common/logger')('goods-issue-handler');
const GoodsIssueAttemptStore = require('../GoodsIssueAttemptStore');
const GoodsIssueIssuedSuStore = require('../GoodsIssueIssuedSuStore');

const _extractFilterParam = extractFilterParam;
// Movement type this app is built for (GI for order). App parameter, not SAP-sourced data.
const GI_MOVEMENT_TYPE = '261';
const LIST_MOVEMENT_TYPES = ['201', '261', '301', '311'];

class GoodsIssueHandler {
  static init(srv) {
    // READ GIItems: query open items by Order or Reservation number
    srv.on('READ', 'GIItems', async (req) => {
      const orderNo = _extractFilterParam(req, 'OrderNo');
      const reservNo = _extractFilterParam(req, 'ReservationNo');

      try {
        const items = await GoodsIssueAdapter.getOpenItems(orderNo, reservNo);
        return applyPaging(items, req);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read Goods Issue items');
      }
    });

    // READ OpenReservations: query distinct open reservations for Goods Issue
    srv.on('READ', 'OpenReservations', async (req) => {
      const plant = _extractFilterParam(req, 'Plant') || '';
      // '261' (goods issue block) or '301,311' (transfer block); anything else falls back to 261.
      const mvtParam = _extractFilterParam(req, 'MovementType') || GI_MOVEMENT_TYPE;
      const mvtType = mvtParam.split(',').every((m) => LIST_MOVEMENT_TYPES.includes(m.trim())) ? mvtParam : GI_MOVEMENT_TYPE;
      const reservNo = _extractFilterParam(req, 'ReservationNo');
      const orderNo = _extractFilterParam(req, 'OrderNo');

      try {
        let reservations = await GoodsIssueAdapter.getOpenReservations(mvtType, plant, {
          reservationNo: reservNo,
          orderNo: orderNo
        });
        if (reservNo && Array.isArray(reservations)) {
          const sResClean = reservNo.replace(/^0+/, '');
          reservations = reservations.filter(r => r.ReservationNo === reservNo || r.ReservationNo === sResClean);
        }
        if (orderNo && Array.isArray(reservations)) {
          const sOrderClean = orderNo.replace(/^0+/, '');
          reservations = reservations.filter(r => r.OrderNo === orderNo || r.OrderNo === sOrderClean);
        }
        return applyPaging(reservations, req);
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
        return applyPaging(batches, req);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read material batches');
      }
    });

    // READ GoodsIssueQueue: dispatch queue records from the CAP database (generic handler); empty when no
    // database is bound to this deployment.
    srv.on('READ', 'GoodsIssueQueue', async (req, next) => {
      if (!GoodsIssueQueueManager.isAvailable()) return [];
      return typeof next === 'function' ? next() : GoodsIssueQueueManager.getAll();
    });

    // READ GoodsIssueIssuedStorageUnit: active/released issued SUs held pending TO confirmation
    srv.on('READ', 'GoodsIssueIssuedStorageUnit', async (req, next) => {
      if (GoodsIssueIssuedSuStore.db) return typeof next === 'function' ? next() : [];
      return GoodsIssueIssuedSuStore.getActiveIssuedSUs();
    });

    // ACTION: resolveClaimManual: Operator action to resolve a needs-attention claim ('posted' | 'not-posted')
    srv.on('resolveClaimManual', async (req) => {
      const { claimId, action, materialDocument, materialDocYear } = req.data || {};
      if (!claimId || !action) {
        return req.error(400, 'claimId and action ("posted" or "not-posted") are required');
      }
      try {
        const resolved = await GoodsIssueIssuedSuStore.resolveClaimManual(claimId, action, {
          materialDocument,
          materialDocYear,
          adapter: GoodsIssueAdapter,
          user: req.user ? req.user.id : 'OPERATOR'
        });
        return resolved;
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });

    // ACTION: resolveQueueItemManual: Operator action to resolve a NEEDS_ATTENTION queue item ('posted' | 'not-posted')
    srv.on('resolveQueueItemManual', async (req) => {
      const { queueId, action, materialDocument, materialDocYear, reason } = req.data || {};
      if (!queueId || !action) {
        return req.error(400, 'queueId and action ("posted" or "not-posted") are required');
      }
      try {
        const resolved = await GoodsIssueQueueManager.resolveQueueItemManual(queueId, action, {
          materialDocument,
          materialDocYear,
          reason,
          adapter: GoodsIssueAdapter,
          user: req.user ? req.user.id : 'OPERATOR'
        });
        return resolved;
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });

    // FUNCTION: getQueueSummary: pending count, items and whether a queue store is bound at all
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


    // ACTION: reverseGoodsIssue (Material Document Reversal via CancelHeader FunctionImport)
    srv.on('reverseGoodsIssue', async (req) => {
      const valResult = validateReversalPayload(req.data);
      if (!valResult.isValid) {
        return req.error(400, valResult.message);
      }

      const normalized = normalizeReversalPayload(req.data, { user: req.user?.id });

      try {
        const result = await GoodsIssueAdapter.reverseGoodsIssue(
          normalized.MaterialDocument,
          normalized.MaterialDocYear,
          normalized.PostingDate,
          normalized.DocumentDate,
          normalized.ReversalReason
        );
        return result;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to reverse Material Document in S/4HANA');
      }
    });

    // ACTION: submitGoodsIssueRequest (Batch scan-then-submit multi-line posting with Dispatch Queue fallback)
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
        if (err.status === 400) {
          return req.error(400, err.message || 'Batch Goods Issue submission failed');
        }

        // If backend posting capability is unavailable (501 / 404), route all items to Dispatch Queue.
        // A plain 403 is an authorization/CSRF refusal and is surfaced, not queued.
        if (err.status === 501 || err.status === 404 || (err.message && err.message.includes('Unavailable'))) {
          const lineResults = [];
          for (const it of Items) {
            try {
              const qRecord = await GoodsIssueQueueManager.enqueue({
                ReservationNo,
                ReservationItem: it.ReservationItem,
                OrderNo,
                Material: it.Material,
                IssueQty: Number(it.IssueQty) || 0,
                Unit: it.Unit || it.EntryUnit || it.BaseUnit || '',
                Batch: it.Batch,
                DifferenceQty: Number(it.DifferenceQty) || 0,
                DifferenceReason: it.DifferenceReason,
                DifferenceStorageType: it.DifferenceStorageType || '',
                FinalIssue: it.FinalIssue,
                LastSyncError: err.message
              });
              lineResults.push({
                ReservationItem: String(it.ReservationItem).padStart(4, '0'),
                MaterialDocument: '',
                MaterialDocYear: '',
                TransferOrder: '',
                DifferenceCleared: false,
                DifferenceQty: Number(it.DifferenceQty) || 0,
                Message: `Not posted to SAP. Waiting in queue. Queue ID (internal, not an SAP document): ${qRecord.ID || qRecord.QueueReference}`,
                Success: false,
                Queued: true,
                QueueReference: qRecord.ID || qRecord.QueueReference,
                QueueId: qRecord.ID || qRecord.QueueReference
              });
            } catch (qErr) {
              lineResults.push({
                ReservationItem: String(it.ReservationItem).padStart(4, '0'),
                MaterialDocument: '',
                MaterialDocYear: '',
                TransferOrder: '',
                DifferenceCleared: false,
                DifferenceQty: 0,
                Message: `Queue error: ${qErr.message}`,
                Success: false,
                Queued: false,
                QueueReference: '',
                QueueId: ''
              });
            }
          }
          return {
            AllPosted: false,
            Results: lineResults,
            Messages: [`Batch recorded in dispatch queue: Not posted to SAP. Waiting in queue. (${err.message})`]
          };
        }

        return req.error(err.status || 400, err.message || 'Batch Goods Issue submission failed');
      }
    });

    // ACTION: retryQueuedGoodsIssue (Retry posting a queued item against live SAP)
    srv.on('retryQueuedGoodsIssue', async (req) => {
      const { QueueReference } = req.data;
      if (!QueueReference) {
        return req.error(400, 'QueueReference parameter is required');
      }

      if (!GoodsIssueQueueManager.isAvailable()) {
        return req.error(503, 'Goods Issue dispatch queue is not available: no database is bound to this deployment');
      }

      const item = await GoodsIssueQueueManager.get(QueueReference);
      if (!item) {
        return req.error(404, `Queued transaction ${QueueReference} not found`);
      }

      // Same guard as the bulk drain: only an attempt in `queued` status may be replayed.
      const guard = await GoodsIssueAttemptStore.replayGuard(item);
      if (!guard.replay) {
        return req.error(409, `Queued transaction ${QueueReference} cannot be retried: its last posting attempt is '${guard.attempt.Status}' (reference ${item.ReferenceDocument}) and is being confirmed in SAP.`);
      }
      const settle = (status, fields) => (guard.attempt ? GoodsIssueAttemptStore.setStatus(item.ReferenceDocument, status, fields) : Promise.resolve());

      try {
        // Replay through the isolated per-type dispatcher (routes by the stored MovementType).
        const result = await GoodsIssueAdapter.postGoodsIssueByType(item);

        // Update queue item
        await GoodsIssueQueueManager.update(QueueReference, {
          SyncStatus: 'POSTED_IN_SAP',
          SapMaterialDocument: result.MaterialDocument || '',
          SapMaterialDocYear: result.MaterialDocYear || '',
          SyncedAt: new Date().toISOString()
        });
        await settle('posted', { MaterialDocument: result.MaterialDocument, MaterialDocYear: result.MaterialDocYear });

        // Record issued SUs on retry success too
        if (result.MaterialDocument && item.StorageUnits) {
          try {
            const suStore = require('../GoodsIssueIssuedSuStore');
            let parsedItems = [];
            try {
              const parsed = JSON.parse(item.StorageUnits);
              parsedItems = Array.isArray(parsed) ? parsed : [];
            } catch (_) {
              parsedItems = [item.StorageUnits];
            }
            const suAllocations = parsedItems.map((su) => {
              if (typeof su === 'string') {
                return { storageUnit: su, issuedQty: item.IssueQty, preIssueStock: item.IssueQty };
              }
              return {
                storageUnit: su.storageUnit || su.StorageUnit,
                issuedQty: su.issuedQty != null ? su.issuedQty : (su.IssuedQty || item.IssueQty),
                preIssueStock: su.preIssueStock != null ? su.preIssueStock : (su.PreIssueStock || item.IssueQty)
              };
            }).filter((s) => Boolean(s.storageUnit));

            if (suAllocations.length > 0) {
              await suStore.recordIssuedSUs({
                materialDocument: result.MaterialDocument,
                materialDocYear: result.MaterialDocYear || '',
                reservationNo: item.ReservationNo,
                reservationItem: item.ReservationItem,
                referenceDocument: item.ReferenceDocument,
                material: item.Material,
                plant: item.Plant,
                storageLocation: item.StorageLocation,
                items: suAllocations
              });
            }
          } catch (suErr) {
            // Keep retry result successful
          }
        }

        return Object.assign({
          Success: true,
          Queued: false,
          QueueReference: item.QueueReference,
          QueueId: item.ID || item.QueueReference,
          SyncStatus: 'POSTED_IN_SAP'
        }, result);
      } catch (err) {
        // Record retry attempt
        await GoodsIssueQueueManager.update(QueueReference, {
          SyncAttempts: (item.SyncAttempts || 1) + 1,
          LastSyncError: err.message || 'Posting rejected by Gateway'
        });
        if (GoodsIssueQueueManager.GoodsIssueQueueManager.UNCONFIRMED_CODES.includes(err.code)) {
          await settle('unconfirmed', { LastError: err.message });
        }

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
          QueueId: item.ID || item.QueueReference,
          SyncStatus: 'FAILED',
          Message: `SAP Gateway retry rejected: ${err.message}. Queue ID (internal, not an SAP document): ${item.ID || item.QueueReference}`
        };
      }
    });

    // ACTION: clearQueuedGoodsIssue (Remove item from dispatch queue)
    srv.on('clearQueuedGoodsIssue', async (req) => {
      const { QueueReference } = req.data;
      if (!QueueReference) {
        return req.error(400, 'QueueReference parameter is required');
      }
      if (!GoodsIssueQueueManager.isAvailable()) {
        return req.error(503, 'Goods Issue dispatch queue is not available: no database is bound to this deployment');
      }
      return GoodsIssueQueueManager.remove(QueueReference);
    });

    // ACTION: drainQueue (Batch retry all pending queued transactions against S/4HANA)
    srv.on('drainQueue', async () => {
      if (!GoodsIssueQueueManager.isAvailable()) {
        return {
          TotalQueued: 0,
          Attempted: 0,
          SyncedToSap: 0,
          Failed: 0,
          RemainingQueued: 0,
          Message: 'Goods Issue dispatch queue is not available: no database is bound to this deployment',
          Items: []
        };
      }
      // Resolve attempts SAP has answered in the meantime before deciding what may be replayed.
      await GoodsIssueAttemptStore.recheck(GoodsIssueAdapter);
      return GoodsIssueQueueManager.drainQueue(GoodsIssueAdapter);
    });

    // ACTION: recheckPostingAttempts (resolve `sending` / `unconfirmed` attempts against S/4HANA)
    srv.on('recheckPostingAttempts', async () => GoodsIssueAttemptStore.recheck(GoodsIssueAdapter));

    // FUNCTION: verifySerialNumber — live SAP status of one scanned serial for one reservation item.
    // Always answers with a Status (UNVERIFIED when SAP could not be read); never a default.
    srv.on('verifySerialNumber', async (req) => {
      const { serialNumber, reservationNo, reservationItem, storageLocation } = req.data || {};
      if (!serialNumber || !reservationNo || !reservationItem) {
        return req.error(400, 'serialNumber, reservationNo and reservationItem parameters are required');
      }
      return GoodsIssueAdapter.verifySerialForReservation(serialNumber, reservationNo, reservationItem, storageLocation || '');
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
            CurrentStock: err.details?.currentStock ?? null,
            SuStockQty: err.details?.currentStock ?? null,
            BaseUnit: err.details?.baseUnit || '',
            Batches: err.details?.availableBatches || [],
            DeterminedBatch: '',
            DeterminedBatchExpiry: null,
            DeterminedBatchStatusState: 'None',
            DeterminedBatchStatusText: 'NOT_FOUND',
            DeterminedBatchDaysToExpiry: null,
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
    // FUNCTION: getStockUnitsForItem — only the SUs valid for one reservation line
    // ──────────────────────────────────────────────────────────
    srv.on('getStockUnitsForItem', async (req) => {
      const reservationNo = req.data?.reservationNo || '';
      const reservationItem = req.data?.reservationItem || '';
      if (!reservationNo || !reservationItem) {
        return req.error(400, 'reservationNo and reservationItem parameters are required');
      }
      try {
        return await GoodsIssueAdapter.listStockUnitsForReservationItem(reservationNo, reservationItem);
      } catch (err) {
        return req.error(err.status || err.statusCode || 500, err.message || 'Failed to list Storage Units from S/4HANA');
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

    // ──────────────────────────────────────────────────────────
    // FUNCTION: getDashboardData — Server-side aggregation for Goods Issue Dashboard
    // ──────────────────────────────────────────────────────────
    srv.on('getDashboardData', async (req) => {
      const days = req.data?.days !== undefined ? Number(req.data.days) : 30;
      const plant = req.data?.plant || _extractFilterParam(req, 'plant') || '';
      const forceRefresh = Boolean(req.data?.forceRefresh);
      const movementType = req.data?.movementType || '';

      try {
        return await GoodsIssueAdapter.getDashboardData({
          days,
          plant,
          forceRefresh,
          movementType
        });
      } catch (err) {
        return req.error(
          err.status || err.statusCode || 500,
          err.message || 'Failed to retrieve Goods Issue dashboard data from S/4HANA'
        );
      }
    });
  }
}

module.exports = GoodsIssueHandler;

