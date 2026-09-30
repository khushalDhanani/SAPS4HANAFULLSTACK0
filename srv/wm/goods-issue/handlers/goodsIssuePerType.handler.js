/**
 * goodsIssuePerType.handler.js
 * ISOLATED CAP action handlers, one per movement type (Phase 1). Each handler wires ONLY its own
 * type's validation + the type's isolated adapter posting method. No MovementType branching inside
 * a handler. The pre-check and queue-fallback helpers below are shared TRANSPORT/infra (not
 * movement-type business logic).
 */

const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueQueueManager = require('../GoodsIssueQueueManager');
const { normalizeGoodsIssue201Payload } = require('../mapping/goodsIssue201.normalize');
const { normalizeGoodsIssue261Payload } = require('../mapping/goodsIssue261.normalize');
const { normalizeGoodsIssue301Payload } = require('../mapping/goodsIssue301.normalize');
const { normalizeGoodsIssue311Payload } = require('../mapping/goodsIssue311.normalize');
const { validateGoodsIssue201Payload } = require('../validation/goodsIssue201.validation');
const { validateGoodsIssue261Payload } = require('../validation/goodsIssue261.validation');
const { validateGoodsIssue301Payload } = require('../validation/goodsIssue301.validation');
const { validateGoodsIssue311Payload } = require('../validation/goodsIssue311.validation');
const LOG = require('../../../common/logger')('goods-issue-pertype-handler');

/** Serial-status pre-check (ESTO). Returns true to continue, or sends req.error and returns false. */
async function serialPreCheck(req, normalized) {
  if (!(normalized.SerialNumbers && normalized.SerialNumbers.length > 0)) return true;
  if (typeof GoodsIssueAdapter.validateSerialStatus !== 'function') return true;
  try {
    await GoodsIssueAdapter.validateSerialStatus(
      normalized.Material, normalized.Plant, normalized.StorageLocation, normalized.SerialNumbers
    );
    return true;
  } catch (serErr) {
    if (serErr.status === 422 || serErr.status === 409) {
      req.error(serErr.status, serErr.message);
      return false;
    }
    LOG.error('Serial status pre-check failed unexpectedly; blocking posting:', serErr.message || serErr);
    req.error(serErr.status || 502, `Serial status pre-check could not be completed before posting: ${serErr.message || 'unexpected error'}. Goods Issue was NOT posted.`);
    return false;
  }
}

/** 201-only stock pre-check. Returns true to continue, or sends req.error and returns false. */
async function stockPreCheck201(req, normalized) {
  if (typeof GoodsIssueAdapter.revalidateStockBeforePosting !== 'function') return true;
  try {
    const stockCheck = await GoodsIssueAdapter.revalidateStockBeforePosting(
      normalized.Material, normalized.Plant, normalized.StorageLocation, normalized.Batch, normalized.IssueQty
    );
    if (stockCheck && stockCheck.StockReadSuccess === true && stockCheck.StockSufficient === false) {
      req.error(422, stockCheck.Message || `Insufficient stock for material ${normalized.Material} in plant ${normalized.Plant} storage location ${normalized.StorageLocation}`);
      return false;
    }
    return true;
  } catch (stockErr) {
    if (stockErr.status === 422) {
      req.error(422, stockErr.message);
      return false;
    }
    LOG.error('Stock pre-check failed unexpectedly; blocking posting:', stockErr.message || stockErr);
    req.error(stockErr.status || 502, `Stock pre-check could not be completed before posting: ${stockErr.message || 'unexpected error'}. Goods Issue was NOT posted.`);
    return false;
  }
}

/** Posts via the type's isolated adapter method; on capability-unavailable, records the dispatch queue. */
async function postWithQueueFallback(req, normalized, postFn) {
  try {
    const result = await postFn(normalized);
    return Object.assign({ Queued: false, QueueReference: '', SyncStatus: 'POSTED_IN_SAP' }, result);
  } catch (err) {
    if (err.status === 400 || err.status === 422) {
      return req.error(err.status, err.message || 'Validation failed for Goods Issue');
    }
    if (err.status === 501 || err.status === 403 || err.status === 404 || (err.message && err.message.includes('Unavailable'))) {
      let queueRecord;
      try {
        queueRecord = await GoodsIssueQueueManager.enqueue({
          ReservationNo: normalized.ReservationNo,
          ReservationItem: normalized.ReservationItem,
          OrderNo: normalized.OrderNo,
          Material: normalized.Material,
          MaterialDesc: normalized.MaterialDesc,
          Plant: normalized.Plant,
          StorageLocation: normalized.StorageLocation,
          IssueQty: normalized.IssueQty,
          Unit: normalized.Unit,
          Batch: normalized.Batch,
          DifferenceQty: normalized.DifferenceQty,
          DifferenceReason: normalized.DifferenceReason,
          DifferenceStorageType: normalized.DifferenceStorageType,
          FinalIssue: normalized.FinalIssue,
          MovementType: normalized.MovementType,
          ReceivingPlant: normalized.ReceivingPlant,
          ReceivingStorageLocation: normalized.ReceivingStorageLocation,
          CostCenter: normalized.CostCenter,
          GLAccount: normalized.GLAccount,
          PostingDate: normalized.PostingDate,
          DocumentDate: normalized.DocumentDate,
          SerialNumber: normalized.SerialNumber,
          LastSyncError: err.message
        });
      } catch (queueErr) {
        return req.error(err.status || 503, `${err.message || 'Failed to post Goods Issue in S/4HANA'} The transaction could not be recorded in the dispatch queue either: ${queueErr.message}`);
      }
      return {
        ReservationNo: String(normalized.ReservationNo || ''),
        ReservationItem: String(normalized.ReservationItem || ''),
        MaterialDocument: '',
        MaterialDocYear: '',
        TransferOrder: '',
        DifferenceCleared: false,
        DifferenceQty: Number(normalized.DifferenceQty) || 0,
        SerialNumber: normalized.SerialNumber,
        SerialNumbers: normalized.SerialNumbers,
        // Queued != posted: SAP did NOT persist the document, so this is not a success (AGENTS.md rule 6).
        // Matches the legacy handler's honest queued result (goodsIssue.handler.js).
        Success: false,
        Queued: true,
        QueueReference: queueRecord.QueueReference,
        SyncStatus: 'QUEUED',
        Message: `Transaction recorded in the dispatch queue (${queueRecord.QueueReference}), not yet posted in SAP. Pending SAP S/4HANA Gateway service activation.`
      };
    }
    return req.error(err.status || 400, err.message || 'Failed to post Goods Issue in S/4HANA');
  }
}

const PerTypeGoodsIssueHandler = {
  init(srv) {
    srv.on('postGoodsIssue201', async (req) => {
      const v = validateGoodsIssue201Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue201Payload(req.data, { user: req.user?.id });
      if (!(await stockPreCheck201(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue201(d));
    });

    srv.on('postGoodsIssue261', async (req) => {
      const v = validateGoodsIssue261Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue261Payload(req.data, { user: req.user?.id });
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue261(d));
    });

    srv.on('postGoodsIssue301', async (req) => {
      const v = validateGoodsIssue301Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue301Payload(req.data, { user: req.user?.id });
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue301(d));
    });

    srv.on('postGoodsIssue311', async (req) => {
      const v = validateGoodsIssue311Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue311Payload(req.data, { user: req.user?.id });
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue311(d));
    });
  }
};

module.exports = PerTypeGoodsIssueHandler;
