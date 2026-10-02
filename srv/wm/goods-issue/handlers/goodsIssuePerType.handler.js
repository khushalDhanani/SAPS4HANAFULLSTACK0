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
 * On success the reservation's own Material / Plant / Storage Location / Batch replace the submitted
 * ones, so what is posted never comes from the client. With `receiving` (311) the receiving plant /
 * storage location of the reservation header are reconciled and applied the same way.
 */
async function reservationReconcileCheck(req, normalized, { receiving = false } = {}) {
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

  const issueQty = Number(normalized.IssueQty);
  if (!isNaN(issueQty) && issueQty > 0 && item.OpenQty > 0 && issueQty > item.OpenQty + 1e-9) {
    req.error(422, `Issue quantity ${issueQty} exceeds the open reservation quantity ${item.OpenQty} for reservation ${sResv} item ${sItem}. Goods Issue was NOT posted.`);
    return false;
  }
  const fromReservation = ['Material', 'Plant', 'StorageLocation', 'Batch'].concat(receiving ? ['ReceivingPlant', 'ReceivingStorageLocation'] : []);
  fromReservation.forEach((f) => { if (item[f]) normalized[f] = item[f]; });
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

/**
 * Storage Unit reconciliation for Movement 261 reservation-based issue.
 * Re-reads the real SUs for the reservation item from SAP stock (listStockUnitsForReservationItem).
 * When SU data exists in SAP, validates:
 *  - Client supplied StorageUnits
 *  - No duplicate SUs
 *  - Each SU exists in SAP stock for that reservation item (matching material, plant, sloc)
 *  - Real sum of SU stock matches normalized.IssueQty (rejects tampered payloads with 400)
 *  - Real sum of SU stock does not exceed reservation open quantity (blocks over-issue with 400)
 *  - Real sum of SU stock matches reservation open quantity (complete issue with 400 on under/over)
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

  // Server chooses which SU takes the partial, never the client's order (Requirement 2).
  // Order submitted SUs according to SAP's authoritative sequence (FEFO / FIFO / StorageUnit).
  const targetTotal = (openQty !== null && openQty > 0) ? openQty : Math.round(Number(normalized.IssueQty) * 1000) / 1000;

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
      req.error(400, `Storage Unit ${suId} is in excess of required quantity (${targetTotal}). Goods Issue was NOT posted.`);
      return false;
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
      if (i < authoritativeSUs.length - 1) {
        const excessSu = String(authoritativeSUs[i + 1]).trim().toUpperCase();
        req.error(400, `Storage Unit ${excessSu} is in excess of required quantity (${targetTotal}). Over-issue blocked. Goods Issue was NOT posted.`);
        return false;
      }
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

    // Server rule: accept any valid SU set whose sum equals open qty; server picks which SU takes the partial
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
    // No partial SU: all SUs must be full
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
  const issueQty = Math.round(Number(normalized.IssueQty) * 1000) / 1000;

  // Tampered payload check: submitted IssueQty must equal real sum of SUs from SAP
  if (Math.abs(realSum - issueQty) > 0.001) {
    req.error(400, `Submitted IssueQty (${issueQty}) does not match real sum of Storage Units (${realSum}). Tampered payload detected. Goods Issue was NOT posted.`);
    return false;
  }

  // Reservation open quantity comparison from live SAP (Requirement 2)
  if (openQty !== null && openQty > 0) {
    if (realSum > openQty + 1e-9) {
      req.error(400, `Storage Units total quantity (${realSum}) exceeds open reservation quantity (${openQty}). Over-issue blocked. Goods Issue was NOT posted.`);
      return false;
    }
    if (Math.abs(realSum - openQty) > 0.001) {
      req.error(400, `Storage Units total quantity (${realSum}) does not match required reservation quantity (${openQty}). Scanned quantity is ${realSum < openQty ? 'under' : 'over'}. Goods Issue was NOT posted.`);
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
  if (s === 400 || s === 409 || s === 422) return true;
  if (/deficit|consumed|storage unit|insufficient stock/i.test(err && err.message || '')) return true;
  return false;
}

/**
 * Posts via the type's isolated adapter method; on capability-unavailable, records the dispatch queue.
 * `onOutcome(status, fields)` (optional) is told how the attempt ended: posted / queued /
 * unconfirmed / rejected.
 * Returns the result augmented with `_definitiveRejection: boolean` so callers can decide
 * whether to delete (definitive) or keep (unknown) claiming rows.
 */
async function postWithQueueFallback(req, normalized, postFn, onOutcome = async () => {}) {
  try {
    const result = await postFn(normalized);
    const isConfirmed = result?.Confirmed !== false;
    const outcomeStatus = isConfirmed ? 'posted' : 'unconfirmed';
    await onOutcome(outcomeStatus, { MaterialDocument: result && result.MaterialDocument, MaterialDocYear: result && result.MaterialDocYear });
    return Object.assign({ Queued: false, QueueReference: '', QueueId: '', SyncStatus: 'POSTED_IN_SAP', _definitiveRejection: false }, result);
  } catch (err) {
    if (isDefinitiveRejection(err)) {
      await onOutcome('rejected', { LastError: err.message });
      const message = err.message || 'Validation failed for Goods Issue';
      const errResult = Array.isArray(err.details) && err.details.length > 0
        ? req.error({ code: err.code || String(err.status || 400), status: err.status || 400, message, details: err.details.map((d) => ({ code: String(d.code || ''), message: String(d.message || '') })) })
        : req.error(err.status || 400, message);
      const ret = (errResult && typeof errResult === 'object') ? errResult : { _definitiveRejection: true, isError: true };
      ret._definitiveRejection = true;
      return ret;
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
          StorageUnits: normalized._allocatedSuItems || normalized.StorageUnits,
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
        Success: false,
        Queued: true,
        QueueReference: queueRecord.ID || queueRecord.QueueReference,
        QueueId: queueRecord.ID || queueRecord.QueueReference,
        SyncStatus: 'QUEUED',
        _definitiveRejection: false, // outcome is unknown until replay
        Message: `Not posted to SAP. Waiting in queue. Queue ID (internal, not an SAP document): ${queueRecord.ID || queueRecord.QueueReference}`
      };
    }
    await onOutcome(UNCONFIRMED_CODES.includes(err.code) ? 'unconfirmed' : 'rejected', { LastError: err.message });
    // Unknown outcome (timeout, 504, reset, etc.) — _definitiveRejection = false
    const unknownResult = req.error(err.status || 400, err.message || 'Failed to post Goods Issue in S/4HANA');
    const ret = (unknownResult && typeof unknownResult === 'object') ? unknownResult : { _definitiveRejection: false, isError: true };
    ret._definitiveRejection = false;
    return ret;
  }
}

const PerTypeGoodsIssueHandler = {
  init(srv) {
    srv.on('postGoodsIssue201', async (req) => {
      const v = validateGoodsIssue201Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue201Payload(req.data, { user: req.user?.id });
      if (!(await reservationReconcileCheck(req, normalized))) return;
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
      const resvItem = await reservationReconcileCheck(req, normalized);
      if (!resvItem) return;
      if (!(await storageUnitReconcileCheck261(req, normalized, resvItem))) return;
      if (!(await serialPreCheck(req, normalized))) return;

      // Make claims atomic (Requirement 2): write 'claiming' rows BEFORE the SAP call
      let claimIds = [];
      if (Array.isArray(normalized._allocatedSuItems) && normalized._allocatedSuItems.length > 0) {
        try {
          claimIds = await GoodsIssueIssuedSuStore.acquireClaims({
            reservationNo: normalized.ReservationNo,
            reservationItem: normalized.ReservationItem,
            material: normalized.Material,
            plant: normalized.Plant,
            storageLocation: normalized.StorageLocation,
            referenceDocument: normalized.ReferenceDocument,
            items: normalized._allocatedSuItems
          });
        } catch (claimErr) {
          return req.error(claimErr.status || 400, claimErr.message);
        }
      }

      let res;
      try {
        res = await postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue261(d));
      } catch (err) {
        if (claimIds.length > 0) {
          const isDef = GoodsIssueIssuedSuStore.isDefinitiveRejection(err);
          await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive: isDef });
        }
        throw err;
      }

      if (res && res.MaterialDocument && res.Queued !== true) {
        // Promote claiming rows to issued on success (unconfirmed documents still promote SU claims to issued)
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
      } else if (res && res.Queued === true) {
        // Queued: outcome unknown until replay — keep 'claiming' rows for release-job resolution
        if (claimIds.length > 0) {
          await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive: false });
        }
      } else {
        // Delete claiming rows ONLY on explicit definitive rejection; unknown outcomes default to keep
        const definitive = Boolean(res && res._definitiveRejection === true);
        if (claimIds.length > 0) {
          await GoodsIssueIssuedSuStore.deleteClaims(claimIds, { definitive });
        }
      }
      return res;
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
      if (!(await serialCountCheck(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue301(d));
    });

    srv.on('postGoodsIssue311', async (req) => {
      const v = validateGoodsIssue311Payload(req.data);
      if (!v.isValid) return req.error(400, v.message);
      const normalized = normalizeGoodsIssue311Payload(req.data, { user: req.user?.id });
      if (!(await reservationReconcileCheck(req, normalized, { receiving: true }))) return;
      if (!(await serialCountCheck(req, normalized))) return;
      if (!(await serialPreCheck(req, normalized))) return;
      return postWithQueueFallback(req, normalized, (d) => GoodsIssueAdapter.postGoodsIssue311(d));
    });
  }
};

module.exports = PerTypeGoodsIssueHandler;
