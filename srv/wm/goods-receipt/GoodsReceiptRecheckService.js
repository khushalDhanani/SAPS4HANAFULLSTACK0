'use strict';

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
 * Distributed worker leasing: acquires an atomic CAS lease for background recheck.
 */
async function claimAttemptForRecheck(store, referenceDocument, workerId = (process.env.CF_INSTANCE_INDEX || '0'), leaseMs = 60000, now = Date.now()) {
  store._assertDb();
  const ref = String(referenceDocument).trim();
  const expiresAtIso = new Date(now + leaseMs).toISOString();
  const leaseTag = `lease:${workerId}:${expiresAtIso}`;

  const current = await store.getByReference(ref);
  if (!current || !OPEN_STATUSES.includes(current.Status)) {
    return false;
  }
  if (current.LastError && current.LastError.startsWith('lease:')) {
    const match = current.LastError.match(/^lease:([^:]+):(.+)$/);
    if (match) {
      const [, owner, expiresIso] = match;
      const expiresAtMs = new Date(expiresIso).getTime();
      if (owner !== String(workerId) && Number.isFinite(expiresAtMs) && expiresAtMs > now) {
        return false;
      }
    }
  }

  const currentLastError = current.LastError ?? '';
  let query;
  if (currentLastError === '') {
    query = UPDATE(ATTEMPT_ENTITY)
      .set({ LastError: leaseTag, updatedAt: new Date(now).toISOString() })
      .where({ ReferenceDocument: ref, Status: current.Status })
      .and(`(LastError is null or LastError = '')`);
  } else {
    query = UPDATE(ATTEMPT_ENTITY)
      .set({ LastError: leaseTag, updatedAt: new Date(now).toISOString() })
      .where({ ReferenceDocument: ref, Status: current.Status, LastError: currentLastError });
  }

  const updated = await store._run(query);
  return Boolean(updated && (typeof updated === 'number' ? updated > 0 : true));
}

async function releaseAttemptLease(store, referenceDocument, workerId) {
  store._assertDb();
  const ref = String(referenceDocument).trim();
  const expectedOwner = String(workerId ?? process.env.CF_INSTANCE_INDEX ?? '0');
  const current = await store.getByReference(ref);
  if (current && current.LastError && current.LastError.startsWith(`lease:${expectedOwner}:`)) {
    await store._run(
      UPDATE(ATTEMPT_ENTITY)
        .set({ LastError: '', updatedAt: new Date().toISOString() })
        .where({ ReferenceDocument: ref, LastError: current.LastError })
    );
  }
}

/**
 * Background re-check for unresolved Goods Receipt attempts (Movement 101).
 * Protected by distributed worker leases so multiple instances cannot redundantly query SAP.
 */
async function recheckReceipts(store, adapter, now = Date.now(), options = {}) {
  store._assertDb();
  const summary = { Checked: 0, Posted: 0, NotPosted: 0, StillOpen: 0, Errors: 0, SkippedLocked: 0 };
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

    const claimed = await claimAttemptForRecheck(store, ref, workerId, leaseMs, now);
    if (!claimed) {
      summary.SkippedLocked = (summary.SkippedLocked || 0) + 1;
      summary.StillOpen++;
      continue;
    }

    let doc;
    try {
      doc = await adapter.findReceiptForAttempt(attempt);
    } catch (err) {
      LOG.warn(`Re-check of receipt attempt ${ref} failed, status ${attempt.Status} kept: ${err.message}`);
      await releaseAttemptLease(store, ref, workerId);
      summary.Errors++;
      continue;
    }

    if (doc && doc.MaterialDocument) {
      await store.setStatus(ref, 'posted', {
        MaterialDocument: doc.MaterialDocument,
        MaterialDocYear: doc.MaterialDocumentYear || '',
        LastError: '',
      });
      summary.Posted++;
    } else if (ageOf(attempt) >= notPostedAgeMs()) {
      const finding = `Recheck: no goods receipt for delivery ${attempt.ReservationNo} item ${attempt.ReservationItem} in S/4HANA; marked not_posted`;
      await store.setStatus(ref, 'not_posted', { LastError: finding });
      summary.NotPosted++;
    } else {
      await releaseAttemptLease(store, ref, workerId);
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
