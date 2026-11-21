'use strict';

const crypto = require('crypto');
const cds = require('@sap/cds');
const LOG = require('../../common/logger')('goods-receipt-attempts');
const {
  ATTEMPT_ENTITY,
  RECEIPT_MOVEMENT,
  OPEN_STATUSES,
  recheckAgeMs,
  notPostedAgeMs,
  unconfirmedMaxAgeMs,
} = require('./GoodsReceiptAttemptConfig');

const { SELECT, UPDATE } = cds.ql;

/**
 * Recheck lease. Held in the attempt's own LeaseOwner / LeaseExpiresAt columns, never in LastError.
 * Every claim gets a unique token, so two runs with the same worker id (overlapping deployments, a restart,
 * or an overlapping timer tick) exclude each other like any two workers do.
 *
 * @returns {Promise<string|false>} the lease token, or false when the attempt is not open or is leased
 */
async function claimAttemptForRecheck(store, referenceDocument, workerId = (process.env.CF_INSTANCE_INDEX || '0'), leaseMs = 60000, now = Date.now()) {
  store._assertDb();
  const ref = String(referenceDocument).trim();
  const nowIso = new Date(now).toISOString();
  const token = `${workerId}:${crypto.randomUUID()}`;

  // One statement: the database decides which of several simultaneous claims wins.
  const updated = await store._run(
    UPDATE(ATTEMPT_ENTITY)
      .set({ LeaseOwner: token, LeaseExpiresAt: new Date(now + leaseMs).toISOString(), updatedAt: nowIso })
      .where`ReferenceDocument = ${ref} and Status in ${OPEN_STATUSES} and (LeaseExpiresAt is null or LeaseExpiresAt <= ${nowIso})`
  );
  return Number(updated) > 0 ? token : false;
}

/** Gives the lease back; a no-op unless `leaseToken` still holds it. */
async function releaseAttemptLease(store, referenceDocument, leaseToken) {
  store._assertDb();
  if (!leaseToken) return;
  await store._run(
    UPDATE(ATTEMPT_ENTITY)
      .set({ LeaseOwner: null, LeaseExpiresAt: null, updatedAt: new Date().toISOString() })
      .where({ ReferenceDocument: String(referenceDocument).trim(), LeaseOwner: leaseToken })
  );
}

/**
 * Background re-check for unresolved Goods Receipt attempts (Movement 101).
 * An attempt is resolved only on reliable evidence from SAP: exactly one 101 document that did not exist
 * before the post means posted; no document at all means not posted. Anything else stays open and blocked.
 */
async function recheckReceipts(store, adapter, now = Date.now(), options = {}) {
  store._assertDb();
  const summary = { Checked: 0, Posted: 0, NotPosted: 0, StillOpen: 0, Errors: 0, SkippedLocked: 0, Ambiguous: 0 };
  if (!adapter || typeof adapter.findReceiptForAttempt !== 'function') return summary;

  const workerId = String(options.workerId ?? process.env.CF_INSTANCE_INDEX ?? '0');
  const leaseMs = options.leaseMs || 60000;
  const open = await store._run(
    SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES }, MovementType: RECEIPT_MOVEMENT })
  );

  const ageOf = (a) => now - new Date(a.createdAt || now).getTime();

  for (const attempt of (open || []).filter((a) => ageOf(a) >= recheckAgeMs())) {
    summary.Checked++;
    const ref = attempt.ReferenceDocument;

    const lease = await claimAttemptForRecheck(store, ref, workerId, leaseMs, now);
    if (!lease) {
      summary.SkippedLocked++;
      summary.StillOpen++;
      continue;
    }

    let doc;
    try {
      doc = await adapter.findReceiptForAttempt(attempt);
    } catch (err) {
      LOG.warn(`Re-check of receipt attempt ${ref} failed, status ${attempt.Status} kept: ${err.message}`);
      await releaseAttemptLease(store, ref, lease);
      summary.Errors++;
      continue;
    }

    // A result is written only while this run still holds the lease and the attempt is still open.
    const resolve = async (status, fields, counter) => {
      const row = await store.setStatus(ref, status, fields, { leaseOwner: lease });
      if (row) summary[counter]++;
      else { summary.SkippedLocked++; summary.StillOpen++; }
    };

    if (doc && doc.MaterialDocument) {
      await resolve('posted', { MaterialDocument: doc.MaterialDocument, MaterialDocYear: doc.MaterialDocumentYear || '', LastError: '' }, 'Posted');
    } else if (doc && doc.ambiguous) {
      LOG.warn(`Receipt attempt ${ref} (delivery ${attempt.ReservationNo} item ${attempt.ReservationItem}) stays blocked: ${doc.reason}`);
      await releaseAttemptLease(store, ref, lease);
      summary.Ambiguous++;
      summary.StillOpen++;
    } else if (ageOf(attempt) >= notPostedAgeMs()) {
      const finding = `Recheck: no goods receipt for delivery ${attempt.ReservationNo} item ${attempt.ReservationItem} in S/4HANA; marked not_posted`;
      await resolve('not_posted', { LastError: finding }, 'NotPosted');
    } else {
      await releaseAttemptLease(store, ref, lease);
      summary.StillOpen++;
    }
  }

  return summary;
}

/**
 * Promotes stale unconfirmed attempts to needs-attention or posted via read-back.
 */
async function reconfirmUnconfirmed(store, adapter, now = Date.now(), _options = {}) {
  store._assertDb();
  const summary = { Checked: 0, Confirmed: 0, StillUnconfirmed: 0, Errors: 0, MarkedNeedsAttention: 0 };
  const unconfirmedAttempts = await store._run(
    SELECT.from(ATTEMPT_ENTITY).where({ Status: 'unconfirmed' })
  );

  if (!unconfirmedAttempts || unconfirmedAttempts.length === 0) {
    return summary;
  }

  const readBack = (adapter && typeof adapter.readBackDocument === 'function')
    ? adapter.readBackDocument.bind(adapter)
    : null;

  if (!readBack) {
    LOG.warn('No readBackDocument function available on adapter');
    return summary;
  }

  const maxAge = unconfirmedMaxAgeMs();

  for (const attempt of unconfirmedAttempts) {
    summary.Checked++;
    const age = now - new Date(attempt.createdAt || now).getTime();

    try {
      const verified = await readBack(attempt.MaterialDocument, attempt.MaterialDocYear);
      if (verified && verified.Confirmed) {
        const confYear = verified.MaterialDocYear || attempt.MaterialDocYear || '';
        await store.setStatus(attempt.ReferenceDocument, 'posted', {
          MaterialDocument: verified.MaterialDocument || attempt.MaterialDocument,
          MaterialDocYear: confYear,
          LastError: '',
        });
        summary.Confirmed++;
      } else if (age >= maxAge) {
        const finding = `Document unconfirmed after maximum age (${Math.round(age / 60000)} min); marked needs-attention`;
        await store.setStatus(attempt.ReferenceDocument, 'needs-attention', {
          LastError: finding,
        });
        summary.MarkedNeedsAttention = (summary.MarkedNeedsAttention || 0) + 1;
      } else {
        summary.StillUnconfirmed++;
      }
    } catch (err) {
      LOG.warn(`Re-confirm job failed for attempt ${attempt.ReferenceDocument} (${attempt.MaterialDocument}): ${err.message}`);
      summary.Errors++;
    }
  }

  return summary;
}

module.exports = {
  claimAttemptForRecheck,
  releaseAttemptLease,
  recheckReceipts,
  reconfirmUnconfirmed,
};
