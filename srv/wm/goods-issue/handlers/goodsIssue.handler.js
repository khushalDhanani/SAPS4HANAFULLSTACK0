const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const { extractFilterParam, applyPaging } = require('../../../common/filterUtils');
const { validateReversalPayload } = require('../validation/goodsIssue.validation');
const { normalizeReversalPayload } = require('../mapping/goodsIssue.mapper');
const LOG = require('../../../common/logger')('goods-issue-handler');
const GoodsIssueAttemptStore = require('../GoodsIssueAttemptStore');
const GoodsIssueIssuedSuStore = require('../GoodsIssueIssuedSuStore');
const { classifyPostingError } = require('./goodsIssuePerType.handler');

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

        // Enrich reservations with unconfirmed attempt status
        if (Array.isArray(reservations) && GoodsIssueAttemptStore && typeof GoodsIssueAttemptStore.getOpenAttemptReservations === 'function') {
          try {
            const openResvs = await GoodsIssueAttemptStore.getOpenAttemptReservations();
            if (openResvs && openResvs.size > 0) {
              for (const r of reservations) {
                const cleanNo = String(r.ReservationNo || '').trim().replace(/^0+/, '');
                if (openResvs.has(cleanNo)) {
                  r.Status = 'pending confirmation';
                  r.StatusText = 'pending confirmation';
                  r.StatusState = 'Warning';
                  r.PendingConfirmation = true;
                  if (r.DisplayText && !r.DisplayText.includes('pending confirmation')) {
                    r.DisplayText += ' (pending confirmation)';
                  }
                }
              }
            }
          } catch (attErr) {
            LOG.warn('Could not enrich open reservations with attempt status:', attErr.message || attErr);
          }
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
      let matDoc = String(req.data?.MaterialDocument || '').trim();
      let matYear = String(req.data?.MaterialDocYear || '').trim();

      if (matDoc && !matYear) {
        try {
          const verified = await GoodsIssueAdapter.readBackDocument(matDoc);
          if (verified && verified.MaterialDocYear && verified.Confirmed) {
            req.data.MaterialDocYear = verified.MaterialDocYear;
          } else {
            return req.error(400, `Material document ${matDoc} year could not be found in SAP; cannot reverse without a valid document year.`);
          }
        } catch (readErr) {
          return req.error(400, `Failed to look up material document ${matDoc} in SAP: ${readErr.message}`);
        }
      }

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

    // ACTION: submitGoodsIssueRequest (Batch scan-then-submit multi-line direct posting)
    srv.on('submitGoodsIssueRequest', async (req) => {
      const { ReservationNo, OrderNo, Items } = req.data;

      if (!ReservationNo && !OrderNo) {
        return req.error(400, 'Either ReservationNo or OrderNo must be provided for submission');
      }

      if (!Array.isArray(Items) || Items.length === 0) {
        return req.error(400, 'At least one item must be specified for submission');
      }

      if (ReservationNo) {
        try {
          const staging = await GoodsIssueAdapter.checkStagingForReservation(ReservationNo);
          if (staging && !staging.isStaged) {
            return req.error(400, staging.error || 'Staged stock is insufficient for Goods Issue.');
          }
        } catch (err) {
          LOG.warn(`submitGoodsIssueRequest staging check failed: ${err.message || err}`);
        }
      }

      try {
        const batchResult = await GoodsIssueAdapter.submitGoodsIssueRequest(
          ReservationNo,
          OrderNo,
          Items
        );
        return batchResult;
      } catch (err) {
        const classified = classifyPostingError(err);
        return req.error(classified.status, classified.message);
      }
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

