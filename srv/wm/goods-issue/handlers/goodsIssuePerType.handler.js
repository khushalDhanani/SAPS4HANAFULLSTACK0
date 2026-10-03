/**
 * goodsIssuePerType.handler.js
 * ISOLATED CAP action handlers, one per movement type (Phase 1). Each handler wires ONLY its own
 * type's validation + the type's isolated adapter posting method. No MovementType branching inside
 * a handler. The pre-check and queue-fallback helpers below are shared TRANSPORT/infra (not
 * movement-type business logic).
 */

const GoodsIssueAdapter = require('../../../integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueAttemptStore = require('../GoodsIssueAttemptStore');
const GoodsIssueIssuedSuStore = require('../GoodsIssueIssuedSuStore');
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

function assign261IdempotencyKey(normalized) {
  const request = {
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
    LastStorageUnitQty: normalized.LastStorageUnitQty
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const suffix = BigInt(`0x${hash}`).toString(36).toUpperCase().slice(0, 14);
  normalized.RequestHash = hash;
  normalized.ReferenceDocument = `GI${suffix}`;
}

function attemptResponse(attempt) {
  const status = String(attempt.Status || '').toLowerCase();
  const posted = status === 'posted';
  const processing = status === 'sending' || status === 'unconfirmed';
  return {
    ReservationNo: attempt.ReservationNo || '',
    ReservationItem: attempt.ReservationItem || '',
    MaterialDocument: attempt.MaterialDocument || '',
    MaterialDocYear: attempt.MaterialDocYear || '',
    Success: posted,
    Confirmed: posted,
    ConfirmationStatus: posted ? 'CONFIRMED' : (processing ? 'POSTING' : status.toUpperCase()),
    Message: posted
      ? `Goods Issue already posted in SAP (Material Document: ${attempt.MaterialDocument || ''}${attempt.MaterialDocYear ? `/${attempt.MaterialDocYear}` : ''}).`
      : (processing
        ? 'An identical Goods Issue request is already processing or awaiting SAP confirmation.'
        : (attempt.LastError || `The identical Goods Issue request already ended with status ${status}.`))
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

/** SAP-derived serial profile/count gate for direct Movement 261; returns true/false or null on error. */
async function serialCountCheck261(req, normalized) {
  if (typeof GoodsIssueAdapter.isSerialManaged !== 'function') {
    req.error(503, `SAP serial-management verification is unavailable for material ${normalized.Material} at plant ${normalized.Plant}. Goods Issue was NOT posted.`);
    return null;
  }

  let serialManaged;
  try {
    serialManaged = await GoodsIssueAdapter.isSerialManaged(normalized.Material, normalized.Plant);
  } catch (err) {
    LOG.error('SAP serial-management verification failed; blocking 261 posting:', err.message || err);
    req.error(err.status || 502, `SAP serial-management requirement could not be verified for material ${normalized.Material} at plant ${normalized.Plant}: ${err.message || 'unexpected error'}. Goods Issue was NOT posted.`);
    return null;
  }
  if (typeof serialManaged !== 'boolean') {
    req.error(502, `SAP returned no valid serial-management status for material ${normalized.Material} at plant ${normalized.Plant}. Goods Issue was NOT posted.`);
    return null;
  }
  if (!serialManaged) return false;

  const quantity = Number(normalized.IssueQty);
  const serialCount = Array.isArray(normalized.SerialNumbers) ? normalized.SerialNumbers.length : 0;
  if (!Number.isInteger(quantity) || serialCount !== quantity) {
    req.error(400, `Material ${normalized.Material} is serial-managed: ${serialCount} serial number(s) supplied for quantity ${quantity}. Supply exactly one valid serial number per unit. Goods Issue was NOT posted.`);
    return null;
  }
  return true;
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
 * On success the reservation's own Material / Plant / Storage Location / Batch replace the submitted
 * ones, so what is posted never comes from the client. With `receiving` (311) the receiving plant /
 * storage location of the reservation header are reconciled and applied the same way.
 */
async function reservationReconcileCheck(req, normalized, { receiving = false, batch = false } = {}) {
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

  const fromReservation = ['Material', 'Plant', 'StorageLocation', 'Batch'].concat(receiving ? ['ReceivingPlant', 'ReceivingStorageLocation'] : []);
  fromReservation.forEach((f) => { if (item[f]) normalized[f] = item[f]; });
  item.OpenQty = authoritativeOpenQty;
  return item;
}

/** SAP batch-management, reservation assignment, SLED, and storage-location stock pre-check for 261. */
async function batchPreCheck261(req, normalized, resvItem) {
  const assignedBatch = resvItem && typeof resvItem === 'object'
    ? String(resvItem.Batch || '').trim()
    : '';
  const submittedBatch = String(normalized.Batch || '').trim();
  const norm = (value) => String(value || '').trim().toUpperCase();

  if (assignedBatch && submittedBatch && norm(assignedBatch) !== norm(submittedBatch)) {
    req.error(400, `Submitted batch ${submittedBatch} does not match SAP reservation batch ${assignedBatch}. Goods Issue was NOT posted.`);
    return false;
  }
  if (assignedBatch) normalized.Batch = assignedBatch;

  let batchManaged = Boolean(assignedBatch);
  if (!batchManaged && !submittedBatch) {
    if (typeof GoodsIssueAdapter.isBatchManaged !== 'function') {
      req.error(500, `SAP batch-management verification is unavailable for material ${normalized.Material} at plant ${normalized.Plant}. Goods Issue was NOT posted.`);
      return false;
    }
    try {
      batchManaged = await GoodsIssueAdapter.isBatchManaged(normalized.Material, normalized.Plant);
    } catch (err) {
      LOG.error('SAP batch-management verification failed; blocking 261 posting:', err.message || err);
      req.error(err.status || 502, `SAP batch-management requirement could not be verified for material ${normalized.Material} at plant ${normalized.Plant}: ${err.message || 'unexpected error'}. Goods Issue was NOT posted.`);
      return false;
    }
  }

  if (batchManaged && !normalized.Batch) {
    req.error(400, `Material ${normalized.Material} is batch-managed in plant ${normalized.Plant}; Batch is required. Goods Issue was NOT posted.`);
    return false;
  }
  if (!normalized.Batch) return true;

  if (typeof GoodsIssueAdapter.validateBatchForPosting !== 'function') {
    req.error(500, `SAP batch and stock validation is unavailable for batch ${normalized.Batch}. Goods Issue was NOT posted.`);
    return false;
  }
  try {
    const result = await GoodsIssueAdapter.validateBatchForPosting(
      normalized.Material,
      normalized.Plant,
      normalized.StorageLocation,
      normalized.Batch,
      normalized.IssueQty,
      normalized.Unit
    );
    if (!result || result.valid !== true) {
      req.error(result?.status || 422, result?.reason || `SAP could not verify batch ${normalized.Batch} before posting. Goods Issue was NOT posted.`);
      return false;
    }
  } catch (err) {
    LOG.error('SAP batch stock verification failed; blocking 261 posting:', err.message || err);
    req.error(err.status || 502, `${err.message || 'SAP batch stock could not be verified'}. Goods Issue was NOT posted.`);
    return false;
  }
  return true;
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

/**
 * Storage Unit reconciliation for Movement 261 reservation-based issue.
 * Re-reads the real SUs for the reservation item from SAP stock (listStockUnitsForReservationItem).
 * When SU data exists in SAP, validates:
 *  - Client-scanned StorageUnits are unique and exist in the SAP reservation stock
 *  - SAP stock for the scanned units covers normalized.IssueQty without exceeding open reservation quantity
 *  - Server-owned per-SU allocations use full quantities where possible and a server-calculated partial for the last unit
 * Returns true to continue, or calls req.error(400, ...) and returns false (no queueing).
 */
async function storageUnitReconcileCheck261(req, normalized, resvItem) {
  const sResv = String(normalized.ReservationNo || '').trim();
  const sItem = String(normalized.ReservationItem || '').trim();
  if (!sResv || !sItem) return true; // unplanned path (no reservation)
  const submittedSUs = Array.isArray(normalized.StorageUnits) ? normalized.StorageUnits : [];
  if (submittedSUs.length === 0) return true; // Non-SU goods issue or standard order flow

  let stockResult;
  try {
    stockResult = await GoodsIssueAdapter.listStockUnitsForReservationItem(sResv, sItem);
  } catch (err) {
    LOG.warn(`Could not read stock units for reservation ${sResv} item ${sItem}:`, err.message || err);
    req.error(400, `Failed to verify Storage Units from SAP: ${err.message || 'unexpected error'}. Goods Issue was NOT posted.`);
    return false;
  }

  const sapStockUnits = (stockResult && Array.isArray(stockResult.StockUnits)) ? stockResult.StockUnits : [];

  // If no SU data exists in SAP for this item:
  if (sapStockUnits.length === 0) {
    req.error(400, `No Storage Units exist in SAP for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
    return false;
  }

  // Duplicate scan check
  const seen = new Set();
  for (const suId of submittedSUs) {
    const cleanId = String(suId).trim().toUpperCase();
    if (seen.has(cleanId)) {
      req.error(400, `Duplicate Storage Unit ${cleanId} in submission. Goods Issue was NOT posted.`);
      return false;
    }
    seen.add(cleanId);
  }

  // Build lookup map and authoritative SAP order index
  const validSuMap = new Map();
  const sapOrderMap = new Map();
  sapStockUnits.forEach((su, idx) => {
    const suKey = String(su.StorageUnit).trim().toUpperCase();
    validSuMap.set(suKey, su);
    sapOrderMap.set(suKey, idx);
  });

  // Authoritative open quantity from SAP reservation item (Requirement 2)
  let openQty = resvItem && (resvItem.OpenQty !== undefined && resvItem.OpenQty !== null)
    ? Math.round(Number(resvItem.OpenQty) * 1000) / 1000
    : null;
  if (openQty === null && typeof GoodsIssueAdapter.getReservationItemAuthoritative === 'function') {
    try {
      const freshResv = await GoodsIssueAdapter.getReservationItemAuthoritative(sResv, sItem);
      if (freshResv && freshResv.OpenQty != null) {
        openQty = Math.round(Number(freshResv.OpenQty) * 1000) / 1000;
      }
    } catch (e) {
      LOG.warn(`Could not re-verify reservation open quantity for ${sResv} item ${sItem}:`, e.message || e);
    }
  }
  const issueQty = Math.round(Number(normalized.IssueQty) * 1000) / 1000;
  if (!Number.isFinite(openQty) || openQty < 0) {
    req.error(502, `SAP open reservation quantity could not be verified for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
    return false;
  }
  if (!Number.isFinite(issueQty) || issueQty <= 0 || issueQty > openQty + 1e-9) {
    req.error(422, `Requested issue quantity ${issueQty} is invalid or exceeds SAP open reservation quantity ${openQty} for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
    return false;
  }

  // Verify all submitted SUs exist in SAP stock and have available stock > 0
  const numSUs = submittedSUs.length;
  for (let i = 0; i < numSUs; i++) {
    const cleanId = String(submittedSUs[i]).trim().toUpperCase();
    const sapSu = validSuMap.get(cleanId);
    if (!sapSu) {
      req.error(400, `Storage Unit ${cleanId} is not valid for material ${normalized.Material} or was consumed in SAP. Goods Issue was NOT posted.`);
      return false;
    }
    const suAvailStock = Number(sapSu.AvailableStock != null ? sapSu.AvailableStock : (sapSu.CurrentStock != null ? sapSu.CurrentStock : 0));
    if (suAvailStock <= 0) {
      req.error(400, `Storage Unit ${cleanId} has no available stock or was consumed in SAP. Goods Issue was NOT posted.`);
      return false;
    }
  }

  // Allocate only the requested quantity; SAP stock and ordering determine each SU contribution.
  const targetTotal = issueQty;

  const authoritativeSUs = [...submittedSUs].sort((a, b) => {
    const keyA = String(a).trim().toUpperCase();
    const keyB = String(b).trim().toUpperCase();
    const idxA = sapOrderMap.has(keyA) ? sapOrderMap.get(keyA) : Number.MAX_SAFE_INTEGER;
    const idxB = sapOrderMap.has(keyB) ? sapOrderMap.get(keyB) : Number.MAX_SAFE_INTEGER;
    return idxA - idxB;
  });

  let runningSum = 0;
  let precedingSum = 0;
  let serverPartialSu = null;
  let serverPartialQty = 0;
  const allocatedSuItems = [];

  for (let i = 0; i < authoritativeSUs.length; i++) {
    const suId = String(authoritativeSUs[i]).trim().toUpperCase();
    const su = validSuMap.get(suId);
    const avail = Number(su.AvailableStock != null ? su.AvailableStock : (su.CurrentStock != null ? su.CurrentStock : 0));
    const fullStock = Number(su.PreIssueStock != null ? su.PreIssueStock : avail);
    const needed = Math.round((targetTotal - runningSum) * 1000) / 1000;

    if (needed <= 0) {
      break;
    }

    if (avail <= needed) {
      precedingSum = runningSum;
      runningSum = Math.round((runningSum + avail) * 1000) / 1000;
      allocatedSuItems.push({
        storageUnit: suId,
        issuedQty: avail,
        preIssueStock: fullStock
      });
    } else {
      // avail > needed: this SU is chosen by the server to take the partial
      serverPartialSu = su;
      serverPartialQty = needed;
      precedingSum = runningSum;
      runningSum = Math.round((runningSum + needed) * 1000) / 1000;
      allocatedSuItems.push({
        storageUnit: suId,
        issuedQty: needed,
        preIssueStock: fullStock
      });
      break;
    }
  }

  const explicitLastQty = normalized.LastStorageUnitQty != null ? Number(normalized.LastStorageUnitQty) : null;

  if (serverPartialSu) {
    const partialSuId = String(serverPartialSu.StorageUnit).trim().toUpperCase();
    const fullStock = Number(serverPartialSu.AvailableStock != null ? serverPartialSu.AvailableStock : (serverPartialSu.CurrentStock != null ? serverPartialSu.CurrentStock : 0));

    // Reject partial <= 0 or >= that SU's full stock (Requirement 2)
    if (serverPartialQty <= 0) {
      req.error(400, `Partial quantity (${serverPartialQty}) for Storage Unit ${partialSuId} must be greater than zero. Goods Issue was NOT posted.`);
      return false;
    }
    if (serverPartialQty >= fullStock) {
      req.error(400, `Partial quantity (${serverPartialQty}) for Storage Unit ${partialSuId} cannot equal or exceed full stock (${fullStock}). Goods Issue was NOT posted.`);
      return false;
    }

    // The optional client hint must agree with the server-calculated quantity; it never drives allocation.
    if (explicitLastQty !== null) {
      if (isNaN(explicitLastQty) || explicitLastQty <= 0) {
        req.error(400, `Partial quantity (${explicitLastQty}) for Storage Unit ${partialSuId} must be greater than zero. Goods Issue was NOT posted.`);
        return false;
      }
      if (explicitLastQty >= fullStock) {
        req.error(400, `Partial quantity (${explicitLastQty}) cannot equal or exceed full stock (${fullStock}) of Storage Unit ${partialSuId}. Goods Issue was NOT posted.`);
        return false;
      }
      if (openQty !== null && openQty > 0 && precedingSum + explicitLastQty > openQty + 1e-9) {
        req.error(400, `Partial quantity (${explicitLastQty}) for Storage Unit ${partialSuId} causes total (${precedingSum + explicitLastQty}) to exceed open reservation quantity (${openQty}). Partial above open qty rejected. Goods Issue was NOT posted.`);
        return false;
      }
      if (Math.abs(explicitLastQty - serverPartialQty) > 0.001) {
        req.error(400, `Partial quantity (${explicitLastQty}) does not match server-calculated partial quantity (${serverPartialQty}) for Storage Unit ${partialSuId}. Goods Issue was NOT posted.`);
        return false;
      }
    }
  } else {
    // No partial SU was needed in the server allocation.
    if (explicitLastQty !== null) {
      const clientLastSu = validSuMap.get(String(submittedSUs[numSUs - 1]).trim().toUpperCase());
      const clientLastStock = clientLastSu ? Number(clientLastSu.AvailableStock || clientLastSu.CurrentStock || 0) : 0;
      if (explicitLastQty < clientLastStock) {
        req.error(400, `Partial quantity specified for Storage Unit ${submittedSUs[numSUs - 1]} but reservation requires full issue. Goods Issue was NOT posted.`);
        return false;
      }
    }
  }

  const realSum = runningSum;
  // Server allocation must exactly cover the requested issue quantity from SAP stock.
  if (Math.abs(realSum - issueQty) > 0.001) {
    req.error(400, `Requested IssueQty (${issueQty}) exceeds the scanned SAP Storage Unit stock allocated by the server (${realSum}). Goods Issue was NOT posted.`);
    return false;
  }

  // Reservation open quantity comparison from live SAP (Requirement 2)
  if (openQty !== null && openQty > 0) {
    if (realSum > openQty + 1e-9) {
      req.error(400, `Storage Units total quantity (${realSum}) exceeds open reservation quantity (${openQty}). Over-issue blocked. Goods Issue was NOT posted.`);
      return false;
    }
  }

  // Quantity-based concurrent claims check (Requirement 1):
  // claimed + requested <= current LQUA stock for that SU. A partial residual stays claimable.
  const claimCheck = await GoodsIssueIssuedSuStore.checkConcurrentClaims(allocatedSuItems);
  if (claimCheck && claimCheck.hasClaim) {
    req.error(400, `Storage Unit ${claimCheck.claimedSu} is currently claimed in an active Goods Issue (available: ${claimCheck.availableStock || 0}, requested: ${claimCheck.requestedQty || 0}, already claimed: ${claimCheck.totalClaimed || 0}). Goods Issue was NOT posted.`);
    return false;
  }

  normalized._allocatedSuItems = allocatedSuItems;
  return true;
}

/**
 * Re-reads SAP reservation and WM stock after this attempt's SU claims are acquired.
 * The stock client excludes this attempt's own claim but still accounts for other claims.
 */
async function storageUnitFinalReconcileCheck261(req, normalized) {
  const allocatedItems = Array.isArray(normalized._allocatedSuItems) ? normalized._allocatedSuItems : [];
  if (allocatedItems.length === 0) return true;

  const reservationNo = String(normalized.ReservationNo || '').trim();
  const reservationItem = String(normalized.ReservationItem || '').trim();
  let reservation;
  let stockResult;
  try {
    reservation = await GoodsIssueAdapter.getReservationItemAuthoritative(reservationNo, reservationItem);
    stockResult = await GoodsIssueAdapter.listStockUnitsForReservationItem(reservationNo, reservationItem, {
      excludeReferenceDocument: normalized.ReferenceDocument
    });
  } catch (err) {
    LOG.warn(`Final SAP Storage Unit revalidation failed for reservation ${reservationNo} item ${reservationItem}:`, err.message || err);
    req.error(502, `Could not revalidate SAP reservation and Storage Units immediately before posting: ${err.message || 'SAP data unavailable'}. Goods Issue was NOT posted.`);
    return false;
  }

  const sameMaterial = (left, right) => {
    const normalize = (value) => String(value || '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
    return normalize(left) === normalize(right);
  };
  const sameCode = (left, right) => String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
  const contextMatches = reservation &&
    sameMaterial(reservation.Material, normalized.Material) &&
    sameCode(reservation.Plant, normalized.Plant) &&
    sameCode(reservation.StorageLocation, normalized.StorageLocation);
  if (!contextMatches) {
    req.error(409, `SAP reservation material, plant, or storage location changed for reservation ${reservationNo} item ${reservationItem}. Goods Issue was NOT posted.`);
    return false;
  }

  const issueQty = Number(normalized.IssueQty);
  const openQty = Number(reservation.OpenQty);
  if (!Number.isFinite(openQty) || openQty < issueQty) {
    req.error(422, `SAP open reservation quantity changed to ${Number.isFinite(openQty) ? openQty : 'unknown'}; it no longer covers issue quantity ${issueQty}. Goods Issue was NOT posted.`);
    return false;
  }
  if (reservation.ReservationItemIsFinallyIssued || reservation.IsFinallyIssued ||
      reservation.ReservationItmIsMarkedForDeltn || reservation.IsDeleted) {
    req.error(409, `SAP reservation ${reservationNo} item ${reservationItem} is finally issued or deleted. Goods Issue was NOT posted.`);
    return false;
  }
  if (reservation.Batch && normalized.Batch && !sameCode(reservation.Batch, normalized.Batch)) {
    req.error(409, `SAP reservation batch changed from ${normalized.Batch} to ${reservation.Batch} before posting. Goods Issue was NOT posted.`);
    return false;
  }

  const stockUnits = Array.isArray(stockResult?.StockUnits) ? stockResult.StockUnits : [];
  const stockContextMatches = stockResult &&
    sameMaterial(stockResult.Material, reservation.Material) &&
    sameCode(stockResult.Plant, reservation.Plant) &&
    sameCode(stockResult.StorageLocation, reservation.StorageLocation);
  if (!stockContextMatches) {
    req.error(502, `SAP did not return verifiable Storage Unit context for reservation ${reservationNo} item ${reservationItem}. Goods Issue was NOT posted.`);
    return false;
  }
  if (stockResult.IsStagingRequired === true &&
      (stockResult.IsFullyStaged !== true || !stockResult.TargetStorageType || !stockResult.TargetStorageBin)) {
    req.error(422, stockResult.Message || `SAP staging is no longer confirmed for reservation ${reservationNo} item ${reservationItem}. Goods Issue was NOT posted.`);
    return false;
  }

  const stockBySu = new Map(stockUnits.map((su) => [String(su.StorageUnit || '').trim().toUpperCase(), su]));
  for (const allocation of allocatedItems) {
    const storageUnit = String(allocation.storageUnit || allocation.StorageUnit || '').trim().toUpperCase();
    const current = stockBySu.get(storageUnit);
    if (!current) {
      req.error(409, `Storage Unit ${storageUnit} is no longer valid and issuable for reservation ${reservationNo} item ${reservationItem}. Goods Issue was NOT posted.`);
      return false;
    }

    const currentQty = Number(current.AvailableStock != null ? current.AvailableStock : current.CurrentStock);
    const allocatedQty = Number(allocation.issuedQty != null ? allocation.issuedQty : allocation.IssuedQty);
    if (!Number.isFinite(currentQty) || !Number.isFinite(allocatedQty) || currentQty + 1e-9 < allocatedQty) {
      req.error(409, `Storage Unit ${storageUnit} now has ${Number.isFinite(currentQty) ? currentQty : 'unknown'} issuable quantity; ${allocatedQty} is required. Goods Issue was NOT posted.`);
      return false;
    }
    if (!sameMaterial(current.Material, reservation.Material) ||
        !sameCode(current.Plant, reservation.Plant) ||
        !sameCode(current.StorageLocation, reservation.StorageLocation)) {
      req.error(409, `Storage Unit ${storageUnit} material, plant, or storage location changed in SAP. Goods Issue was NOT posted.`);
      return false;
    }
    const expectedBatch = reservation.Batch || normalized.Batch;
    if (current.MultipleBatches || (expectedBatch && !sameCode(current.Batch, expectedBatch))) {
      req.error(409, `Storage Unit ${storageUnit} batch assignment changed or is ambiguous in SAP. Goods Issue was NOT posted.`);
      return false;
    }
    if (current.StatusState === 'Error') {
      req.error(409, `Storage Unit ${storageUnit} batch is no longer issuable in SAP. Goods Issue was NOT posted.`);
      return false;
    }
    if (stockResult.IsStagingRequired === true &&
        (!sameCode(current.StorageType, stockResult.TargetStorageType) ||
         !sameCode(current.StorageBin, stockResult.TargetStorageBin))) {
      req.error(409, `Storage Unit ${storageUnit} is no longer in the confirmed staging location ${stockResult.TargetStorageType}/${stockResult.TargetStorageBin}. Goods Issue was NOT posted.`);
      return false;
    }
    if (stockResult.Warehouse && current.Warehouse &&
        !sameCode(current.Warehouse, stockResult.Warehouse)) {
      req.error(409, `Storage Unit ${storageUnit} warehouse changed in SAP. Goods Issue was NOT posted.`);
      return false;
    }
  }
  return true;
}

/** Posting-attempt status for an error the adapter raised: SAP did not answer vs. SAP said no. */
const UNCONFIRMED_CODES = ['GI_POSTING_OUTCOME_UNKNOWN', 'GI_POSTING_UNCONFIRMED'];

/**
 * Returns true when the error code/status represents a DEFINITIVE SAP rejection
 * (document was NOT posted). Returns false for unknown outcomes (timeout, reset,
 * 504, 2xx without document, etc.) — those must keep the `claiming` row alive.
 */
function isDefinitiveRejection(err) {
  if (GoodsIssueIssuedSuStore && typeof GoodsIssueIssuedSuStore.isDefinitiveRejection === 'function') {
    return GoodsIssueIssuedSuStore.isDefinitiveRejection(err);
  }
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

  // 4. Rejected by SAP (400, 409, 422, sap-message error)
  return {
    category: 'rejected_by_sap',
    status: status || 400,
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
  const sResv = String(normalized.ReservationNo || '').trim();
  const sItem = String(normalized.ReservationItem || '').trim();
  if (!sResv) return true;

  const hasAttempt = GoodsIssueAttemptStore && typeof GoodsIssueAttemptStore.hasOpenAttemptForReservation === 'function'
    ? await GoodsIssueAttemptStore.hasOpenAttemptForReservation(sResv, sItem)
    : false;

  const hasClaim = GoodsIssueIssuedSuStore && typeof GoodsIssueIssuedSuStore.hasActiveClaimForReservation === 'function'
    ? await GoodsIssueIssuedSuStore.hasActiveClaimForReservation(sResv, sItem)
    : false;

  if (hasAttempt || hasClaim) {
    if (normalized.MovementType === '261' && normalized.ReferenceDocument && normalized.RequestHash) {
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

async function stagingCheck(req, normalized) {
  const sResv = String(normalized?.ReservationNo || '').trim();
  const sItem = String(normalized?.ReservationItem || '').trim();
  if (!sResv || !sItem) return true;
  try {
    const staging = await GoodsIssueAdapter.checkStagingForReservation(sResv, sItem, {
      issueQty: normalized.IssueQty,
      issueUnit: normalized.Unit
    });
    if (!staging || staging.isVerified !== true) {
      req.error(502, staging?.error || `SAP WM staging requirement could not be verified for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
      return false;
    }
    if (!staging.isStaged) {
      req.error(422, staging.error || 'Available SAP staging stock is insufficient for goods issue.');
      return false;
    }
    return true;
  } catch (err) {
    LOG.error(`SAP staging check failed for reservation ${sResv} item ${sItem}; blocking 261 posting:`, err.message || err);
    req.error(err.status || 502, `${err.message || 'SAP WM staging could not be verified'}. Goods Issue was NOT posted.`);
    return false;
  }
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
    const hasDoc = Boolean(result && result.MaterialDocument);
    const isConfirmed = hasDoc && result?.Confirmed !== false;
    const outcomeStatus = isConfirmed ? 'posted' : 'unconfirmed';

    await onOutcome(outcomeStatus, {
      MaterialDocument: result?.MaterialDocument || '',
      MaterialDocYear: result?.MaterialDocYear || ''
    });

    const res = Object.assign({ _definitiveRejection: false }, result);
    return res;
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
async function executeMovementPost(req, normalized, postFn, preCheckFn = null, beforePostFn = null) {
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

  // Atomic SU claims: acquire 'claiming' rows BEFORE the SAP call
  let claimIds = [];
  const suItemsToClaim = Array.isArray(normalized._allocatedSuItems) && normalized._allocatedSuItems.length > 0
    ? normalized._allocatedSuItems
    : (Array.isArray(normalized.StorageUnits) && normalized.StorageUnits.length > 0
      ? normalized.StorageUnits.map(su => typeof su === 'string' ? { storageUnit: su, issuedQty: normalized.IssueQty, preIssueStock: normalized.IssueQty } : su)
      : []);

  if (suItemsToClaim.length > 0) {
    try {
      claimIds = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: normalized.ReservationNo,
        reservationItem: normalized.ReservationItem,
        material: normalized.Material,
        plant: normalized.Plant,
        storageLocation: normalized.StorageLocation,
        referenceDocument: normalized.ReferenceDocument,
        items: suItemsToClaim
      });
    } catch (claimErr) {
      await settle('rejected', { LastError: claimErr.message });
      return req.error(claimErr.status || 400, claimErr.message);
    }
  }

  if (typeof beforePostFn === 'function') {
    let readyToPost;
    try {
      readyToPost = await beforePostFn();
    } catch (err) {
      LOG.error('Final Goods Issue validation failed; SAP posting blocked:', err.message || err);
      await settle('rejected', { LastError: `Final validation failed: ${err.message || 'SAP data unavailable'}` });
      if (claimIds.length > 0) await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive: true });
      return req.error(err.status || 502, `Goods Issue was NOT sent to SAP: final validation failed (${err.message || 'SAP data unavailable'}).`);
    }
    if (!readyToPost) {
      await settle('rejected', { LastError: 'Rejected by final SAP revalidation; not sent to SAP.' });
      if (claimIds.length > 0) await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive: true });
      return;
    }
  }

  let res;
  try {
    res = await postDirect(req, normalized, postFn, settle);
  } catch (err) {
    if (claimIds.length > 0) {
      const isDef = GoodsIssueIssuedSuStore.isDefinitiveRejection(err);
      await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive: isDef });
    }
    throw err;
  }

  if (res && res.MaterialDocument) {
    if (claimIds.length > 0) {
      try {
        await GoodsIssueIssuedSuStore.promoteClaims(claimIds, {
          materialDocument: res.MaterialDocument,
          materialDocYear: res.MaterialDocYear || '',
          confirmed: res.Confirmed !== false
        });
      } catch (suErr) {
        LOG.warn('Could not promote claiming Storage Units after successful IM post:', suErr.message || suErr);
      }
    }
  } else {
    const definitive = Boolean(res && res._definitiveRejection === true);
    if (claimIds.length > 0) {
      await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive });
    }
  }
  return res;
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

    srv.on('postGoodsIssue261', async (req) => {
      const v = validateGoodsIssue261Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue261Payload(req.data, { user: req.user?.id });
      try {
        assign261IdempotencyKey(normalized);
        const existing = await getIdempotentAttempt(normalized);
        if (existing) return attemptResponse(existing);
      } catch (err) {
        return req.error(err.status || 503, `Goods Issue idempotency could not be verified; posting was not sent to SAP: ${err.message || 'attempt store unavailable'}.`);
      }
      const resvItem = await reservationReconcileCheck(req, normalized, { batch: true });
      if (!resvItem) return;
      if (!(await checkPendingConfirmation(req, normalized))) return normalized._existingAttemptResult;
      if (!(await batchPreCheck261(req, normalized, resvItem))) return;
      if (!(await stagingCheck(req, normalized))) return;
      if (!(await storageUnitReconcileCheck261(req, normalized, resvItem))) return;
      const serialManaged = await serialCountCheck261(req, normalized);
      if (serialManaged === null) return;
      if (!(await serialPreCheck(req, normalized, { required: true }))) return;

      return executeMovementPost(
        req,
        normalized,
        (d) => GoodsIssueAdapter.postGoodsIssue261(d),
        null,
        () => storageUnitFinalReconcileCheck261(req, normalized)
      );
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

module.exports = PerTypeGoodsIssueHandler;
