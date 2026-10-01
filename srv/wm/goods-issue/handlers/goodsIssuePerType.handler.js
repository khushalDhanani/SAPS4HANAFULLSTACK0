/**
 * goodsIssuePerType.handler.js
 * ISOLATED CAP action handlers, one per movement type (Phase 1). Each handler wires ONLY its own
 * type's validation + the type's isolated adapter posting method. No MovementType branching inside
 * a handler. The pre-check and queue-fallback helpers below are shared TRANSPORT/infra (not
 * movement-type business logic).
 */

const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueQueueManager = require('../GoodsIssueQueueManager');
const GoodsIssueAttemptStore = require('../GoodsIssueAttemptStore');
const { normalizeGoodsIssue201Payload } = require('../mapping/goodsIssue201.normalize');
const { normalizeGoodsIssue261Payload } = require('../mapping/goodsIssue261.normalize');
const { normalizeGoodsIssue301Payload } = require('../mapping/goodsIssue301.normalize');
const { normalizeGoodsIssue311Payload } = require('../mapping/goodsIssue311.normalize');
const { validateGoodsIssue201Payload } = require('../validation/goodsIssue201.validation');
const { validateGoodsIssue261Payload } = require('../validation/goodsIssue261.validation');
const { validateGoodsIssue301Payload } = require('../validation/goodsIssue301.validation');
const { validateGoodsIssue311Payload } = require('../validation/goodsIssue311.validation');
const LOG = require('../../../common/logger')('goods-issue-pertype-handler');
const crypto = require('crypto');

/** Unique per posting attempt, <=16 chars (SAP header ReferenceDocument); reused unchanged on queue replay. */
const newPostingReference = () => `GI${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`.toUpperCase();

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

/**
 * Reservation reconciliation for reservation-based movements (261/301/311). The Fiori UI derives
 * Material/Plant/StorageLocation from the resolved reservation item, but the CAP action can be
 * called directly, so we reconcile server-side against SAP before posting: submitted master data
 * must match the reservation item, and IssueQty must not exceed its open quantity. Skips cleanly
 * when there is no reservation (e.g. 261 unplanned direct-to-order). Returns the reservation item
 * (or true when there was nothing to reconcile) to continue, or sends req.error and returns false.
 * Fails CLOSED when the reservation cannot be read. A storage location the reservation does not
 * carry cannot be reconciled, so a submitted one is accepted in that case.
 */
async function reservationReconcileCheck(req, normalized) {
  const sResv = String(normalized.ReservationNo || '').trim();
  const sItem = String(normalized.ReservationItem || '').trim();
  if (!sResv || !sItem) return true; // no reservation to reconcile against (unplanned path)
  if (typeof GoodsIssueAdapter.getReservationItemAuthoritative !== 'function') return true;

  let item;
  try {
    item = await GoodsIssueAdapter.getReservationItemAuthoritative(sResv, sItem);
  } catch (resErr) {
    // 404 (not open / not found) or 502 (read failure) -> block; never post against an unverifiable reservation.
    req.error(resErr.status || 502, resErr.message || `Reservation ${sResv} item ${sItem} could not be verified before posting; Goods Issue was NOT posted.`);
    return false;
  }

  const normMat = (s) => String(s || '').trim().replace(/^0+/, '').toUpperCase();
  const norm = (s) => String(s || '').trim().toUpperCase();
  const mismatches = [];
  if (normalized.Material && normMat(normalized.Material) !== normMat(item.Material)) {
    mismatches.push(`Material (submitted ${normalized.Material}, reservation ${item.Material})`);
  }
  if (normalized.Plant && norm(normalized.Plant) !== norm(item.Plant)) {
    mismatches.push(`Plant (submitted ${normalized.Plant}, reservation ${item.Plant})`);
  }
  if (normalized.StorageLocation && item.StorageLocation && norm(normalized.StorageLocation) !== norm(item.StorageLocation)) {
    mismatches.push(`Storage Location (submitted ${normalized.StorageLocation}, reservation ${item.StorageLocation})`);
  }
  if (mismatches.length > 0) {
    req.error(409, `Submitted values do not match reservation ${sResv} item ${sItem}: ${mismatches.join('; ')}. Goods Issue was NOT posted.`);
    return false;
  }

  const issueQty = Number(normalized.IssueQty);
  if (!isNaN(issueQty) && issueQty > 0 && item.OpenQty > 0 && issueQty > item.OpenQty + 1e-9) {
    req.error(422, `Issue quantity ${issueQty} exceeds the open reservation quantity ${item.OpenQty} for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
    return false;
  }
  return item;
}

/**
 * Serial-managed materials need exactly one serial number per unit. Checked against SAP master data
 * (not a client flag) before posting. Returns true to continue, or sends req.error(400) and returns
 * false. An unreadable serial profile does not block: SAP enforces the same rule on the posting.
 */
async function serialCountCheck(req, normalized) {
  if (typeof GoodsIssueAdapter.isSerialManaged !== 'function') return true;
  let serialManaged;
  try {
    serialManaged = await GoodsIssueAdapter.isSerialManaged(normalized.Material, normalized.Plant);
  } catch (err) {
    LOG.warn(`Serial number profile of material ${normalized.Material} could not be read; SAP will enforce serials:`, err.message || err);
    return true;
  }
  if (!serialManaged) return true;
  const qty = Number(normalized.IssueQty);
  const count = (normalized.SerialNumbers || []).length;
  if (count === qty) return true;
  req.error(400, `Material ${normalized.Material} is serial-managed: ${count} serial number(s) supplied for quantity ${qty}. Scan one serial number per unit. Goods Issue was NOT posted.`);
  return false;
}

/** Posting-attempt status for an error the adapter raised: SAP did not answer vs. SAP said no. */
const UNCONFIRMED_CODES = ['GI_POSTING_OUTCOME_UNKNOWN', 'GI_POSTING_UNCONFIRMED'];

/**
 * Posts via the type's isolated adapter method; on capability-unavailable, records the dispatch queue.
 * `onOutcome(status, fields)` (optional) is told how the attempt ended: posted / queued /
 * unconfirmed / rejected.
 */
async function postWithQueueFallback(req, normalized, postFn, onOutcome = async () => {}) {
  try {
    const result = await postFn(normalized);
    await onOutcome('posted', { MaterialDocument: result && result.MaterialDocument, MaterialDocYear: result && result.MaterialDocYear });
    return Object.assign({ Queued: false, QueueReference: '', SyncStatus: 'POSTED_IN_SAP' }, result);
  } catch (err) {
    if (err.status === 400 || err.status === 422) {
      await onOutcome('rejected', { LastError: err.message });
      const message = err.message || 'Validation failed for Goods Issue';
      // Keep the original SAP text (e.g. closed posting period) available to the client.
      return Array.isArray(err.details) && err.details.length > 0
        ? req.error({ code: err.code || String(err.status), status: err.status, message, details: err.details.map((d) => ({ code: String(d.code || ''), message: String(d.message || '') })) })
        : req.error(err.status, message);
    }
    // A plain 403 is an authorization/CSRF refusal, not an availability problem: it is surfaced below, not queued.
    if (err.status === 501 || err.status === 404 || (err.message && err.message.includes('Unavailable'))) {
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
          ReferenceDocument: normalized.ReferenceDocument,
          LastSyncError: err.message
        });
      } catch (queueErr) {
        await onOutcome('rejected', { LastError: `${err.message} Not recorded in the dispatch queue: ${queueErr.message}` });
        return req.error(err.status || 503, `${err.message || 'Failed to post Goods Issue in S/4HANA'} The transaction could not be recorded in the dispatch queue either: ${queueErr.message}`);
      }
      await onOutcome('queued', { LastError: err.message });
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
    await onOutcome(UNCONFIRMED_CODES.includes(err.code) ? 'unconfirmed' : 'rejected', { LastError: err.message });
    return req.error(err.status || 400, err.message || 'Failed to post Goods Issue in S/4HANA');
  }
}

const PerTypeGoodsIssueHandler = {
  init(srv) {
    srv.on('postGoodsIssue201', async (req) => {
      const v = validateGoodsIssue201Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue201Payload(req.data, { user: req.user?.id });
      // The attempt is persisted (own committed transaction) BEFORE anything is sent to SAP, with the
      // reference that goes into the document header. No attempt row -> no posting.
      normalized.ReferenceDocument = newPostingReference();
      try {
        await GoodsIssueAttemptStore.create(normalized);
      } catch (attemptErr) {
        LOG.error('Posting attempt could not be recorded; posting blocked:', attemptErr.message || attemptErr);
        return req.error(503, `Goods Issue was NOT sent to SAP: the posting attempt could not be recorded (${attemptErr.message || 'database unavailable'}).`);
      }
      const settle = (status, fields) => GoodsIssueAttemptStore.setStatus(normalized.ReferenceDocument, status, fields)
        .catch((e) => LOG.error(`Posting attempt ${normalized.ReferenceDocument} could not be set to ${status}; the re-check job will resolve it:`, e.message || e));

      if (!(await stockPreCheck201(req, normalized)) || !(await serialPreCheck(req, normalized))) {
        await settle('rejected', { LastError: 'Rejected by the stock or serial pre-check; not sent to SAP.' });
        return;
      }
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue201(d), settle);
    });

    srv.on('postGoodsIssue261', async (req) => {
      const v = validateGoodsIssue261Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue261Payload(req.data, { user: req.user?.id });
      if (!(await reservationReconcileCheck(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue261(d));
    });

    srv.on('postGoodsIssue301', async (req) => {
      const v = validateGoodsIssue301Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue301Payload(req.data, { user: req.user?.id });
      const resvItem = await reservationReconcileCheck(req, normalized);
      if (!resvItem) return;
      // A plant-to-plant transfer needs a destination: from the request, or from the reservation.
      if (!normalized.ReceivingPlant && !resvItem.ReceivingPlant) {
        return req.error(400, `ReceivingPlant is required for Movement 301: reservation ${normalized.ReservationNo} item ${normalized.ReservationItem} carries no receiving plant. Goods Issue was NOT posted.`);
      }
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue301(d));
    });

    srv.on('postGoodsIssue311', async (req) => {
      const v = validateGoodsIssue311Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue311Payload(req.data, { user: req.user?.id });
      if (!(await reservationReconcileCheck(req, normalized))) return;
      if (!(await serialCountCheck(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue311(d));
    });
  }
};

module.exports = PerTypeGoodsIssueHandler;
