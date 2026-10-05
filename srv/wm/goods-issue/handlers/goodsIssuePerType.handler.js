/**
 * goodsIssuePerType.handler.js
 * ISOLATED CAP action handlers, one per movement type (Phase 1). Each handler wires ONLY its own
 * type's validation + the type's isolated adapter posting method. No MovementType branching inside
 * a handler. The pre-check and queue-fallback helpers below are shared TRANSPORT/infra (not
 * movement-type business logic).
 */

const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueAttemptStore = require('../GoodsIssueAttemptStore');
const { normalizeGoodsIssue201Payload } = require('../mapping/goodsIssue201.normalize');
const { normalizeGoodsIssue301Payload } = require('../mapping/goodsIssue301.normalize');
const { normalizeGoodsIssue311Payload } = require('../mapping/goodsIssue311.normalize');
const { validateGoodsIssue201Payload } = require('../validation/goodsIssue201.validation');
const { validateGoodsIssue301Payload } = require('../validation/goodsIssue301.validation');
const { validateGoodsIssue311Payload } = require('../validation/goodsIssue311.validation');
const LOG = require('../../../common/logger')('goods-issue-pertype-handler');
const crypto = require('crypto');

/** Unique per posting attempt, <=16 chars (SAP header ReferenceDocument); reused unchanged on queue replay. */
const newPostingReference = () => `GI${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`.toUpperCase();

function assignIdempotencyKey(normalized) {
  const request = {
    CostCenter: normalized.CostCenter,
    ReceivingPlant: normalized.ReceivingPlant,
    ReceivingStorageLocation: normalized.ReceivingStorageLocation,
    MovementType: normalized.MovementType,
    ReservationNo: normalized.ReservationNo,
    ReservationItem: normalized.ReservationItem,
    Material: normalized.Material,
    Plant: normalized.Plant,
    StorageLocation: normalized.StorageLocation,
    IssueQty: normalized.IssueQty,
    Unit: normalized.Unit,
    Batch: normalized.Batch,
    OrderNo: normalized.OrderNo,
    GLAccount: normalized.GLAccount,
    PostingDate: normalized.PostingDate,
    DocumentDate: normalized.DocumentDate,
    SerialNumbers: normalized.SerialNumbers,
    StorageUnits: normalized.StorageUnits,
    LastStorageUnitQty: normalized.LastStorageUnitQty,
    // Distinguishes two deliberate postings of the same item/qty/day; '' keeps the
    // field-only key for clients that do not send one.
    ClientAttemptId: normalized.ClientAttemptId || ''
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const suffix = BigInt(`0x${hash}`).toString(36).toUpperCase().slice(0, 14);
  normalized.RequestHash = hash;
  normalized.ReferenceDocument = `GI${suffix}`;
}

/**
 * 201/301/311: when the client sends a ClientAttemptId, the reference is derived from the request,
 * so a resent request replays its attempt instead of posting again.
 * Without one, the previous per-request random reference is kept.
 */
function ensureIdempotencyKey(normalized) {
  if (normalized && normalized.ClientAttemptId && !normalized.RequestHash) assignIdempotencyKey(normalized);
}

function attemptResponse(attempt) {
  const status = String(attempt.Status || '').toLowerCase();
  if (status === 'delivery_created') {
    return {
      ReservationNo: attempt.ReservationNo || '',
      ReservationItem: attempt.ReservationItem || '',
      MaterialDocument: '',
      MaterialDocYear: '',
      DeliveryNumber: attempt.DeliveryNumber || '',
      PostingStatus: 'DELIVERY_CREATED',
      Success: false,
      Confirmed: false,
      ConfirmationStatus: 'DELIVERY_CREATED',
      Message: `SAP created outbound delivery ${attempt.DeliveryNumber || ''} for this request instead of a material document. Stock is issued only when goods issue is posted for that delivery in SAP. Do not post again.`
    };
  }
  const postingStatus = status === 'posted'
    ? 'POSTED'
    : status === 'queued'
      ? 'QUEUED'
      : status === 'rejected' || status === 'not_posted'
        ? 'FAILED'
        : 'UNKNOWN';
  const posted = postingStatus === 'POSTED';
  const processing = status === 'sending' || status === 'unconfirmed';
  return {
    ReservationNo: attempt.ReservationNo || '',
    ReservationItem: attempt.ReservationItem || '',
    MaterialDocument: status === 'queued' ? '' : (attempt.MaterialDocument || ''),
    MaterialDocYear: attempt.MaterialDocYear || '',
    PostingStatus: postingStatus,
    Success: posted,
    Confirmed: posted,
    ConfirmationStatus: posted ? 'CONFIRMED' : (processing ? 'POSTING' : status.toUpperCase()),
    Message: posted
      ? `Goods Issue already posted in SAP (Material Document: ${attempt.MaterialDocument || ''}${attempt.MaterialDocYear ? `/${attempt.MaterialDocYear}` : ''}).`
      : postingStatus === 'QUEUED'
        ? 'Goods Issue request is safely queued. SAP has not yet created a material document.'
        : postingStatus === 'UNKNOWN'
          ? (attempt.MaterialDocument
            ? `SAP returned material document ${attempt.MaterialDocument}${attempt.MaterialDocYear ? `/${attempt.MaterialDocYear}` : ''}, but posting confirmation is pending. Do not post again until verified.`
            : 'The SAP posting outcome cannot currently be verified. Do not post again until the attempt is reconciled.')
          : (attempt.LastError || `The identical Goods Issue request definitively ended without an SAP material document (status ${status}).`)
  };
}

async function getIdempotentAttempt(normalized) {
  const attempt = await GoodsIssueAttemptStore.getByReference(normalized.ReferenceDocument);
  if (!attempt) return null;
  if (String(attempt.RequestHash || '') !== String(normalized.RequestHash || '')) {
    const err = new Error('Goods Issue idempotency reference collision; posting was not sent to SAP.');
    err.status = 409;
    throw err;
  }
  return attempt;
}

/** Serial-status pre-check (ESTO). Returns true to continue, or sends req.error and returns false. */
async function serialPreCheck(req, normalized, { required = false } = {}) {
  if (!(normalized.SerialNumbers && normalized.SerialNumbers.length > 0)) return true;
  if (typeof GoodsIssueAdapter.validateSerialStatus !== 'function') {
    if (!required) return true;
    req.error(503, `SAP serial status verification is unavailable for material ${normalized.Material}. Goods Issue was NOT posted.`);
    return false;
  }
  try {
    const result = await GoodsIssueAdapter.validateSerialStatus(
      normalized.Material, normalized.Plant, normalized.StorageLocation, normalized.SerialNumbers
    );
    if (!result || result.valid !== true) {
      req.error(
        result?.status || 422,
        result?.reason || `SAP did not confirm that every serial number is available for material ${normalized.Material}. Goods Issue was NOT posted.`
      );
      return false;
    }
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
 * Reservation reconciliation for reservation-based movements (301/311). The Fiori UI derives
 * Material/Plant/StorageLocation from the resolved reservation item, but the CAP action can be
 * called directly, so we reconcile server-side against SAP before posting: submitted master data
 * must match the reservation item, and IssueQty must not exceed its open quantity. Skips cleanly
 * when there is no reservation. Returns the reservation item
 * (or true when there was nothing to reconcile) to continue, or sends req.error and returns false.
 * Fails CLOSED when the reservation cannot be read. A storage location the reservation does not
 * carry cannot be reconciled, so a submitted one is accepted in that case.
 * On success the reservation's own Material / Plant / Storage Location / Batch replace the submitted
 * ones, so what is posted never comes from the client. With `receiving` (311) the receiving plant /
 * storage location of the reservation header are reconciled and applied the same way.
 */
async function reservationReconcileCheck(req, normalized, { receiving = false, batch = false, expectedMovementType = '' } = {}) {
  const sResv = String(normalized.ReservationNo || '').trim();
  const sItem = String(normalized.ReservationItem || '').trim();
  if (!sResv || !sItem) return true; // no reservation to reconcile against (unplanned path)
  if (typeof GoodsIssueAdapter.getReservationItemAuthoritative !== 'function') {
    req.error(500, `Reservation item verification service is unavailable for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
    return false;
  }

  let item;
  try {
    item = await GoodsIssueAdapter.getReservationItemAuthoritative(sResv, sItem);
  } catch (resErr) {
    // 404 (not open / not found) or 502 (read failure) -> block; never post against an unverifiable reservation.
    req.error(resErr.status || 502, resErr.message || `Reservation ${sResv} item ${sItem} could not be verified before posting; Goods Issue was NOT posted.`);
    return false;
  }

  if (expectedMovementType && item.MovementType && String(item.MovementType).trim() !== expectedMovementType) {
    req.error(422, `Reservation ${sResv} item ${sItem} is not an open Movement Type ${expectedMovementType} item in SAP. Goods Issue was NOT posted.`);
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
  if (batch && normalized.Batch && item.Batch && norm(normalized.Batch) !== norm(item.Batch)) {
    mismatches.push(`Batch (submitted ${normalized.Batch}, reservation ${item.Batch})`);
  }
  if (normalized.OrderNo && item.OrderNo && normMat(normalized.OrderNo) !== normMat(item.OrderNo)) {
    mismatches.push(`Order (submitted ${normalized.OrderNo}, reservation ${item.OrderNo})`);
  }
  if (receiving) {
    if (normalized.ReceivingPlant && item.ReceivingPlant && norm(normalized.ReceivingPlant) !== norm(item.ReceivingPlant)) {
      mismatches.push(`Receiving Plant (submitted ${normalized.ReceivingPlant}, reservation ${item.ReceivingPlant})`);
    }
    if (normalized.ReceivingStorageLocation && item.ReceivingStorageLocation && norm(normalized.ReceivingStorageLocation) !== norm(item.ReceivingStorageLocation)) {
      mismatches.push(`Receiving Storage Location (submitted ${normalized.ReceivingStorageLocation}, reservation ${item.ReceivingStorageLocation})`);
    }
  }
  if (mismatches.length > 0) {
    req.error(400, `Submitted values do not match reservation ${sResv} item ${sItem}: ${mismatches.join('; ')}. Goods Issue was NOT posted.`);
    return false;
  }

  const reqQty = Number(item.RequiredQty != null ? item.RequiredQty : (item.ResvnItmRequiredQtyInBaseUnit || 0));
  const wdnQty = Number(item.WithdrawnQty != null ? item.WithdrawnQty : (item.ResvnItmWithdrawnQtyInBaseUnit || 0));
  const isFinal = Boolean(item.ReservationItemIsFinallyIssued || item.IsFinallyIssued || item.FinalIssue);
  const isDeleted = Boolean(item.ReservationItmIsMarkedForDeltn || item.IsDeleted);

  // Authoritative open quantity calculated strictly from SAP:
  // (RequiredQty - WithdrawnQty, subject to actual SAP status/flags). Never trust client/UI OpenQty.
  let authoritativeOpenQty = 0;
  if (!isFinal && !isDeleted) {
    if (item.OpenQty !== undefined && item.OpenQty !== null) {
      authoritativeOpenQty = Number(item.OpenQty);
    } else {
      authoritativeOpenQty = Math.max(0, reqQty - wdnQty);
    }
  }

  const issueQty = Number(normalized.IssueQty);
  if (!isNaN(issueQty) && issueQty > 0) {
    if (isDeleted) {
      req.error(422, `Reservation ${sResv} item ${sItem} is marked for deletion in SAP. Goods Issue was NOT posted.`);
      return false;
    }
    if (isFinal) {
      req.error(422, `Reservation ${sResv} item ${sItem} is marked as finally issued in SAP. Goods Issue was NOT posted.`);
      return false;
    }
    if (authoritativeOpenQty <= 0) {
      req.error(422, `Reservation ${sResv} item ${sItem} has no open quantity remaining (open quantity is 0, required: ${reqQty}, withdrawn: ${wdnQty}). Goods Issue was NOT posted.`);
      return false;
    }
    if (issueQty > authoritativeOpenQty + 1e-9) {
      req.error(422, `Issue quantity ${issueQty} exceeds the open reservation quantity ${authoritativeOpenQty} for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
      return false;
    }
  }

  const fromReservation = ['Material', 'Plant', 'StorageLocation', 'Batch', 'OrderNo'].concat(receiving ? ['ReceivingPlant', 'ReceivingStorageLocation'] : []);
  fromReservation.forEach((f) => { if (item[f]) normalized[f] = item[f]; });
  item.OpenQty = authoritativeOpenQty;
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
 * Returns true when the error code/status represents a DEFINITIVE SAP rejection
 * (document was NOT posted). Returns false for unknown outcomes (timeout, reset,
 * 504, 2xx without document, etc.) — those must keep the `claiming` row alive.
 */
function isDefinitiveRejection(err) {
  const s = err && (err.status || err.statusCode);
  if (s === 400 || s === 409 || s === 422 || s === 403) return true;
  if (/deficit|consumed|storage unit|insufficient stock/i.test(err && err.message || '')) return true;
  return false;
}

/**
 * Classifies an error from posting directly to SAP S/4HANA into one of 4 non-queue categories:
 * 1. never_reached: 404, 503, 403 with /IWFND/MED/170, connection refused, DNS resolution failure.
 *    -> HTTP 503, "The posting was not made and can be tried again." Definitive failure (claims deleted).
 * 2. auth_error: Plain HTTP 403 (no /IWFND/MED/170).
 *    -> HTTP 403, pointing to SU53. Definitive failure (claims deleted).
 * 3. unknown_outcome: Timeout, connection reset, socket hang up, 502/504, or UNCONFIRMED_CODES.
 *    -> HTTP 504/500, unconfirmed outcome; do NOT tell the user to post again. Claims kept for recheck.
 * 4. rejected_by_sap: 400, 409, 422, sap-message business error.
 *    -> Original HTTP status (default 400), showing the real SAP message. Definitive failure (claims deleted).
 */
function classifyPostingError(err) {
  const status = Number(err?.status || err?.statusCode || err?.response?.status || 0);
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  const msg = String(err?.message || '');
  const details = Array.isArray(err?.details) ? err.details : [];
  const hasMed170 = msg.includes('/IWFND/MED/170') ||
    details.some((d) => String(d?.code || d?.message || '').includes('/IWFND/MED/170'));

  // 1. Never reached SAP (404, 503, 501, 403 with /IWFND/MED/170, connection refused, DNS, capability unavailable)
  const isConnRefused = code === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(msg);
  const isDns = ['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg);
  const isCapabilityUnavailable = status === 501 || /capability unavailable|service unavailable/i.test(msg);
  if (status === 404 || status === 503 || isCapabilityUnavailable || (status === 403 && hasMed170) || isConnRefused || isDns) {
    const detailMsg = msg ? ` (${msg})` : '';
    return {
      category: 'never_reached',
      status: 503,
      message: `SAP S/4HANA service unreachable or posting capability unavailable${detailMsg}. The posting was not made and can be tried again.`,
      definitive: true,
      details
    };
  }

  // 2. Plain 403 (authorization error pointing to SU53)
  if (status === 403) {
    const detailMsg = msg ? ` (${msg})` : '';
    return {
      category: 'auth_error',
      status: 403,
      message: `Authorization failed for SAP Goods Issue posting${detailMsg}. Please check your SAP authorizations in transaction SU53.`,
      definitive: true,
      details
    };
  }

  // 3. Unknown outcome (timeout, reset, socket hang up, 502/504, 2xx without document)
  const isTimeout = ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code) || /timeout|timed? ?out/i.test(msg);
  const isReset = code === 'ECONNRESET' || /connection reset|socket hang up/i.test(msg);
  const isUnknownCode = UNCONFIRMED_CODES.includes(err?.code);
  if (status === 502 || status === 504 || isTimeout || isReset || isUnknownCode) {
    let unconfirmedMsg;
    if (msg && (/may or may not have been posted|may still appear|may have been posted/i.test(msg)) && /do not post again/i.test(msg)) {
      unconfirmedMsg = msg;
    } else {
      const detailMsg = msg ? ` (${msg})` : '';
      unconfirmedMsg = `Posting outcome unconfirmed in SAP S/4HANA${detailMsg}. The goods issue may have been posted in SAP. Please do not post again.`;
    }
    return {
      category: 'unknown_outcome',
      status: status || 504,
      message: unconfirmedMsg,
      definitive: false,
      details
    };
  }

  // 4. Only an explicit SAP 4xx answer is a definitive rejection. A 500 or a status-less error
  //    does not prove that nothing was committed in SAP, so it stays an unknown outcome.
  if (!(status >= 400 && status < 500)) {
    const detailMsg = msg ? ` (${msg})` : '';
    return {
      category: 'unknown_outcome',
      status: status || 500,
      message: `Posting outcome unconfirmed in SAP S/4HANA${detailMsg}. The goods issue may have been posted in SAP. Please do not post again.`,
      definitive: false,
      details
    };
  }

  // 5. Rejected by SAP (400, 409, 422, sap-message error)
  return {
    category: 'rejected_by_sap',
    status,
    message: msg || 'Validation failed for Goods Issue in SAP S/4HANA',
    definitive: true,
    details
  };
}

/**
 * Checks whether the reservation item currently has an unconfirmed or sending attempt,
 * or an active SU claim. Rejects duplicate submissions while unconfirmed.
 *
 * @param {Object} req - CAP request
 * @param {Object} normalized - Normalized payload
 * @returns {Promise<boolean>}
 */
async function checkPendingConfirmation(req, normalized) {
  ensureIdempotencyKey(normalized);
  const sResv = String(normalized.ReservationNo || '').trim();
  const sItem = String(normalized.ReservationItem || '').trim();
  if (!sResv) return true;

  let hasAttempt;
  try {
    hasAttempt = GoodsIssueAttemptStore && typeof GoodsIssueAttemptStore.hasOpenAttemptForReservation === 'function'
      ? await GoodsIssueAttemptStore.hasOpenAttemptForReservation(sResv, sItem)
      : false;
  } catch (err) {
    req.error(err.status || 503, err.message || 'Pending posting attempts could not be verified. Goods Issue was NOT posted.');
    return false;
  }

  if (hasAttempt) {
    if (normalized.ReferenceDocument && normalized.RequestHash) {
      const existing = await getIdempotentAttempt(normalized);
      if (existing) {
        normalized._existingAttemptResult = attemptResponse(existing);
        return false;
      }
    }
    req.error(409, `Reservation ${sResv} item ${sItem} has a Goods Issue posting attempt pending confirmation, do not post again until the outcome is verified in SAP.`);
    return false;
  }
  return true;
}

/**
 * Posts directly to SAP S/4HANA via API_MATERIAL_DOCUMENT_SRV.
 * No queue, no stored transaction for later replay.
 *
 * Settle status:
 *   - 'posted': confirmed document returned from SAP.
 *   - 'rejected': definitive rejection or unreachable before SAP (claims deleted).
 *   - 'unconfirmed': unknown outcome (claims kept for recheck).
 *
 * @param {Object} req - CAP request
 * @param {Object} normalized - Normalized payload
 * @param {Function} postFn - Adapter posting method
 * @param {Function} [onOutcome] - Outcome callback (status, fields)
 * @returns {Promise<Object>}
 */
async function postDirect(req, normalized, postFn, onOutcome = async () => {}) {
  try {
    const result = await postFn(normalized);
    if (result && result.PostingStatus === 'DELIVERY_CREATED') {
      // Definite SAP outcome, but no stock moved yet: record the delivery; SU claims stay held.
      await onOutcome('delivery_created', { DeliveryNumber: result.DeliveryNumber || '', LastError: result.Message || '' });
      return Object.assign({ _definitiveRejection: false }, result);
    }
    const hasDoc = Boolean(result && result.MaterialDocument);
    const isConfirmed = hasDoc && result?.Confirmed !== false;
    const outcomeStatus = isConfirmed ? 'posted' : 'unconfirmed';

    await onOutcome(outcomeStatus, {
      MaterialDocument: result?.MaterialDocument || '',
      MaterialDocYear: result?.MaterialDocYear || ''
    });

    return Object.assign({ _definitiveRejection: false }, result, {
      PostingStatus: isConfirmed ? 'POSTED' : 'UNKNOWN'
    });
  } catch (err) {
    const classified = classifyPostingError(err);
    const outcomeStatus = classified.definitive ? 'rejected' : 'unconfirmed';
    await onOutcome(outcomeStatus, { LastError: classified.message });

    const errResult = Array.isArray(classified.details) && classified.details.length > 0
      ? req.error({
          code: err.code || String(classified.status),
          status: classified.status,
          message: classified.message,
          details: classified.details.map((d) => ({ code: String(d.code || ''), message: String(d.message || '') }))
        })
      : req.error(classified.status, classified.message);

    const ret = (errResult && typeof errResult === 'object') ? errResult : { _definitiveRejection: classified.definitive, isError: true };
    ret._definitiveRejection = classified.definitive;
    return ret;
  }
}

/**
 * Executes a Goods Issue posting with atomic attempt tracking and 2-phase SU claims.
 *
 * @param {Object} req
 * @param {Object} normalized
 * @param {Function} postFn
 * @param {Function|null} [preCheckFn]
 * @returns {Promise<Object>}
 */
async function executeMovementPost(req, normalized, postFn, preCheckFn = null) {
  ensureIdempotencyKey(normalized);
  normalized.ReferenceDocument = normalized.ReferenceDocument || newPostingReference();
  try {
    const claim = await GoodsIssueAttemptStore.createOrGet(normalized);
    if (!claim.created) return attemptResponse(claim.row);
    if (claim.row?.ReferenceDocument) normalized.ReferenceDocument = claim.row.ReferenceDocument;
    if (claim.row?.RequestHash !== undefined) normalized.RequestHash = claim.row.RequestHash;
  } catch (attemptErr) {
    LOG.error('Posting attempt could not be recorded; posting blocked:', attemptErr.message || attemptErr);
    return req.error(attemptErr.status || 503, `Goods Issue was NOT sent to SAP: the posting attempt could not be recorded (${attemptErr.message || 'database unavailable'}).`);
  }
  const settle = (status, fields) => GoodsIssueAttemptStore.setStatus(normalized.ReferenceDocument, status, fields)
    .catch((e) => LOG.error(`Posting attempt ${normalized.ReferenceDocument} could not be set to ${status}; the re-check job will resolve it:`, e.message || e));

  if (typeof preCheckFn === 'function') {
    const preOk = await preCheckFn();
    if (!preOk) {
      await settle('rejected', { LastError: 'Rejected by pre-check; not sent to SAP.' });
      return;
    }
  }

  return postDirect(req, normalized, postFn, settle);
}

const PerTypeGoodsIssueHandler = {
  init(srv) {
    srv.on('postGoodsIssue201', async (req) => {
      const v = validateGoodsIssue201Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue201Payload(req.data, { user: req.user?.id });
      if (!(await reservationReconcileCheck(req, normalized))) return;
      if (!(await checkPendingConfirmation(req, normalized))) return;

      const preCheck = async () => (await stockPreCheck201(req, normalized)) && (await serialPreCheck(req, normalized));
      return executeMovementPost(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue201(d), preCheck);
    });

    srv.on('postGoodsIssue301', async (req) => {
      const v = validateGoodsIssue301Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue301Payload(req.data, { user: req.user?.id });
      const resvItem = await reservationReconcileCheck(req, normalized);
      if (!resvItem) return;
      if (!(await checkPendingConfirmation(req, normalized))) return;
      if (!normalized.ReceivingPlant && !resvItem.ReceivingPlant) {
        return req.error(400, `ReceivingPlant is required for Movement 301: reservation ${normalized.ReservationNo} item ${normalized.ReservationItem} carries no receiving plant. Goods Issue was NOT posted.`);
      }
      if (!(await serialCountCheck(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;

      return executeMovementPost(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue301(d));
    });

    srv.on('postGoodsIssue311', async (req) => {
      const v = validateGoodsIssue311Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue311Payload(req.data, { user: req.user?.id });
      if (!(await reservationReconcileCheck(req, normalized, { receiving: true }))) return;
      if (!(await checkPendingConfirmation(req, normalized))) return;
      if (!(await serialCountCheck(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;

      return executeMovementPost(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue311(d));
    });
  }
};

PerTypeGoodsIssueHandler.classifyPostingError = classifyPostingError;
PerTypeGoodsIssueHandler.postDirect = postDirect;
PerTypeGoodsIssueHandler.attemptResponse = attemptResponse;

module.exports = PerTypeGoodsIssueHandler;
