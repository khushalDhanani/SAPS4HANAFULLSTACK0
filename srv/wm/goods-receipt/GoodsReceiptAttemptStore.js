'use strict';

/**
 * srv/wm/goods-receipt/GoodsReceiptAttemptStore.js
 *
 * Goods receipt (101) double-posting protection: attempt log, unknown outcomes,
 * document read-back, background recheck, and distributed multi-instance leasing.
 *
 * Requires persistent DB entity `saps4hana.wm.GoodsReceiptPostingAttempt`.
 * Fails closed with HTTP 503 DB_UNAVAILABLE if the persistent database is unavailable.
 */

const cds = require('@sap/cds');
const LOG = require('../../common/logger')('goods-receipt-attempts');

const { INSERT, SELECT, UPDATE } = cds.ql;

const ATTEMPT_ENTITY = 'saps4hana.wm.GoodsReceiptPostingAttempt';
const RECEIPT_MOVEMENT = '101';
const OPEN_STATUSES = ['sending', 'unconfirmed'];
const FINAL_STATUSES = ['posted', 'rejected', 'not_posted'];

class GoodsReceiptAttemptStore {
  /**
   * @param {Object} [options]
   * @param {Object} [options.db] - CAP database service (defaults to cds.db)
   */
  constructor(options = {}) {
    this.options = options;
    this._explicitDb = options.db !== undefined ? options.db : undefined;
  }

  get db() {
    if (this._explicitDb !== undefined) {
      return this._explicitDb;
    }
    return cds.db || null;
  }

  isAvailable() {
    return Boolean(this.db);
  }

  _assertDb() {
    if (!this.db) {
      const err = new Error('Database service is unavailable for GoodsReceiptAttemptStore.');
      err.status = 503;
      err.statusCode = 503;
      err.code = 'DB_UNAVAILABLE';
      throw err;
    }
  }

  async _run(query) {
    this._assertDb();
    return this.db.run(query);
  }

  /**
   * Inserts an attempt row. Rejects if ReferenceDocument already exists.
   */
  async create(data) {
    this._assertDb();
    const row = {
      ReferenceDocument: String(data.ReferenceDocument || '').trim(),
      RequestHash: String(data.RequestHash || '').trim(),
      MovementType: String(data.MovementType || RECEIPT_MOVEMENT).trim(),
      Status: data.Status || 'sending',
      PostingUser: String(data.User || data.PostingUser || '').slice(0, 255),
      PostingDate: data.PostingDate || null,
      ReservationNo: String(data.ReservationNo || '').trim(),
      ReservationItem: String(data.ReservationItem || '').trim(),
      Material: String(data.Material || '').trim(),
      Plant: String(data.Plant || '').trim(),
      StorageLocation: String(data.StorageLocation || '').trim(),
      IssueQty: data.IssueQty != null ? Number(data.IssueQty) : null,
      Unit: String(data.Unit || '').trim(),
      MaterialDocument: data.MaterialDocument || '',
      MaterialDocYear: data.MaterialDocYear || '',
      DeliveryNumber: data.DeliveryNumber || '',
      LastError: data.LastError || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!row.ReferenceDocument) {
      throw new Error('ReferenceDocument is required to record a posting attempt');
    }
    await this._run(INSERT.into(ATTEMPT_ENTITY).entries(row));
    return row;
  }

  /**
   * All attempts sharing a RequestHash, oldest first.
   */
  async _attemptsByRequestHash(requestHash) {
    this._assertDb();
    const hash = String(requestHash || '').trim();
    if (!hash) return [];
    const rows = await this._run(
      SELECT.from(ATTEMPT_ENTITY)
        .where({ RequestHash: hash })
        .orderBy('createdAt asc')
    );
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Atomically claims a posting reference with generation re-claim support.
   *
   * @param {Object} data - carries ReferenceDocument and RequestHash
   * @param {{reclaimableStatuses: string[], isReclaimable?: function(Object): boolean}} [reclaim]
   * @returns {Promise<{ created: boolean, row: Object }>}
   */
  async createOrGet(data, reclaim = null) {
    this._assertDb();
    const ref = String(data.ReferenceDocument || '').trim();
    if (!ref) throw new Error('ReferenceDocument is required to claim a posting attempt');

    const assertSameRequest = (row) => {
      if (String(row.RequestHash || '') !== String(data.RequestHash || '')) {
        const err = new Error('Goods receipt idempotency reference collision; posting was not sent to SAP.');
        err.status = 409;
        err.statusCode = 409;
        throw err;
      }
      return { created: false, row };
    };

    if (reclaim && Array.isArray(reclaim.reclaimableStatuses)) {
      const priors = await this._attemptsByRequestHash(data.RequestHash);
      if (priors.length) {
        const latest = priors[priors.length - 1];
        if (!reclaim.reclaimableStatuses.includes(String(latest.Status || '')) && !reclaim.isReclaimable?.(latest)) {
          return { created: false, row: latest };
        }
      }
      const generation = priors.length;
      const newRef = `${ref}${generation}`;
      try {
        const row = await this.create({ ...data, ReferenceDocument: newRef, Status: 'sending' });
        const rival = (await this._attemptsByRequestHash(data.RequestHash)).find(
          (a) => a.ReferenceDocument !== newRef && (OPEN_STATUSES.includes(a.Status) || !priors.some((prior) => prior.ID === a.ID))
        );
        if (rival) {
          await this.setStatus(newRef, 'rejected', {
            LastError: `Stepped back for open attempt ${rival.ReferenceDocument}; not sent to SAP.`
          });
          return { created: false, row: rival };
        }
        return { created: true, row };
      } catch (insertErr) {
        const raced = await this.getByReference(newRef);
        if (raced) return assertSameRequest(raced);
        throw insertErr;
      }
    }

    try {
      const row = await this.create({ ...data, Status: 'sending' });
      return { created: true, row };
    } catch (insertErr) {
      const existing = await this.getByReference(ref);
      if (existing) return assertSameRequest(existing);
      throw insertErr;
    }
  }

  async getByReference(referenceDocument) {
    this._assertDb();
    const ref = String(referenceDocument || '').trim();
    const rows = await this._run(
      SELECT.from(ATTEMPT_ENTITY).where({ ReferenceDocument: ref })
    );
    return rows && rows[0] ? rows[0] : null;
  }

  async setStatus(referenceDocument, status, fields = {}) {
    this._assertDb();
    const ref = String(referenceDocument || '').trim();
    const updateData = {
      Status: status,
      updatedAt: new Date().toISOString()
    };

    if (FINAL_STATUSES.includes(status)) {
      updateData.ResolvedAt = new Date().toISOString();
    }
    if (fields.MaterialDocument !== undefined) updateData.MaterialDocument = fields.MaterialDocument;
    if (fields.MaterialDocYear !== undefined) updateData.MaterialDocYear = fields.MaterialDocYear;
    if (fields.DeliveryNumber !== undefined) updateData.DeliveryNumber = fields.DeliveryNumber;
    if (fields.LastError !== undefined) updateData.LastError = fields.LastError;

    await this._run(
      UPDATE(ATTEMPT_ENTITY)
        .set(updateData)
        .where({ ReferenceDocument: ref })
    );

    return this.getByReference(ref);
  }

  /**
   * Distributed worker leasing: acquires an atomic CAS lease for background recheck.
   *
   * @param {string} referenceDocument
   * @param {string} [workerId]
   * @param {number} [leaseMs=60000]
   * @param {number} [now=Date.now()]
   * @returns {Promise<boolean>}
   */
  async claimAttemptForRecheck(referenceDocument, workerId = (process.env.CF_INSTANCE_INDEX || '0'), leaseMs = 60000, now = Date.now()) {
    this._assertDb();
    const ref = String(referenceDocument).trim();
    const expiresAtIso = new Date(now + leaseMs).toISOString();
    const leaseTag = `lease:${workerId}:${expiresAtIso}`;

    const current = await this.getByReference(ref);
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

    const updated = await this._run(query);
    return Boolean(updated && (typeof updated === 'number' ? updated > 0 : true));
  }

  async releaseAttemptLease(referenceDocument, workerId) {
    this._assertDb();
    const ref = String(referenceDocument).trim();
    const expectedOwner = String(workerId ?? process.env.CF_INSTANCE_INDEX ?? '0');
    const current = await this.getByReference(ref);
    if (current && current.LastError && current.LastError.startsWith(`lease:${expectedOwner}:`)) {
      await this._run(
        UPDATE(ATTEMPT_ENTITY)
          .set({ LastError: '', updatedAt: new Date().toISOString() })
          .where({ ReferenceDocument: ref, LastError: current.LastError })
      );
    }
  }

  /**
   * Background re-check for unresolved Goods Receipt attempts (Movement 101).
   * Protected by distributed worker leases so multiple instances cannot redundantly query SAP.
   *
   * @param {Object} adapter - GoodsReceiptAdapter (findReceiptForAttempt)
   * @param {number} [now]
   * @param {Object} [options]
   * @returns {Promise<{ Checked: number, Posted: number, NotPosted: number, StillOpen: number, Errors: number, SkippedLocked: number }>}
   */
  async recheckReceipts(adapter, now = Date.now(), options = {}) {
    this._assertDb();
    const summary = { Checked: 0, Posted: 0, NotPosted: 0, StillOpen: 0, Errors: 0, SkippedLocked: 0 };
    if (!adapter || typeof adapter.findReceiptForAttempt !== 'function') return summary;

    const workerId = String(options.workerId ?? process.env.CF_INSTANCE_INDEX ?? '0');
    const leaseMs = options.leaseMs || 60000;
    const open = await this._run(
      SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES }, MovementType: RECEIPT_MOVEMENT })
    );

    const ageOf = (a) => now - new Date(a.createdAt || now).getTime();

    for (const attempt of (open || []).filter((a) => ageOf(a) >= GoodsReceiptAttemptStore.recheckAgeMs())) {
      summary.Checked++;
      const ref = attempt.ReferenceDocument;

      const claimed = await this.claimAttemptForRecheck(ref, workerId, leaseMs, now);
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
        await this.releaseAttemptLease(ref, workerId);
        summary.Errors++;
        continue;
      }

      if (doc && doc.MaterialDocument) {
        await this.setStatus(ref, 'posted', {
          MaterialDocument: doc.MaterialDocument,
          MaterialDocYear: doc.MaterialDocumentYear || '',
          LastError: ''
        });
        summary.Posted++;
      } else if (ageOf(attempt) >= GoodsReceiptAttemptStore.notPostedAgeMs()) {
        const finding = `Recheck: no goods receipt for delivery ${attempt.ReservationNo} item ${attempt.ReservationItem} in S/4HANA; marked not_posted`;
        await this.setStatus(ref, 'not_posted', { LastError: finding });
        summary.NotPosted++;
      } else {
        await this.releaseAttemptLease(ref, workerId);
        summary.StillOpen++;
      }
    }

    return summary;
  }

  /**
   * Promotes stale unconfirmed attempts to needs-attention or posted via read-back.
   */
  async reconfirmUnconfirmed(adapter, now = Date.now(), _options = {}) {
    this._assertDb();
    const summary = { Checked: 0, Confirmed: 0, StillUnconfirmed: 0, Errors: 0, MarkedNeedsAttention: 0 };
    const unconfirmedAttempts = await this._run(
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

    const maxAge = GoodsReceiptAttemptStore.unconfirmedMaxAgeMs();

    for (const attempt of unconfirmedAttempts) {
      summary.Checked++;
      const age = now - new Date(attempt.createdAt || now).getTime();

      try {
        const verified = await readBack(attempt.MaterialDocument, attempt.MaterialDocYear);
        if (verified && verified.Confirmed) {
          const confYear = verified.MaterialDocYear || attempt.MaterialDocYear || '';
          await this.setStatus(attempt.ReferenceDocument, 'posted', {
            MaterialDocument: verified.MaterialDocument || attempt.MaterialDocument,
            MaterialDocYear: confYear,
            LastError: ''
          });
          summary.Confirmed++;
        } else if (age >= maxAge) {
          const finding = `Document unconfirmed after maximum age (${Math.round(age / 60000)} min); marked needs-attention`;
          await this.setStatus(attempt.ReferenceDocument, 'needs-attention', {
            LastError: finding
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

  static recheckIntervalMs() {
    const v = parseInt(process.env.RECEIPT_RECHECK_INTERVAL_MS || process.env.ATTEMPT_RECHECK_INTERVAL_MS || '60000', 10);
    return isNaN(v) ? 60000 : v;
  }

  static recheckAgeMs() {
    const v = parseInt(process.env.RECEIPT_RECHECK_AGE_MS || '180000', 10);
    return isNaN(v) ? 180000 : v;
  }

  static notPostedAgeMs() {
    const v = parseInt(process.env.RECEIPT_NOT_POSTED_AGE_MS || '900000', 10);
    return isNaN(v) ? 900000 : v;
  }

  static unconfirmedMaxAgeMs() {
    const v = parseInt(process.env.RECEIPT_UNCONFIRMED_MAX_AGE_MS || '1800000', 10);
    return isNaN(v) ? 1800000 : v;
  }

  static distributedLeaseDurationMs() {
    const v = parseInt(process.env.RECEIPT_RECHECK_LEASE_MS || '30000', 10);
    return isNaN(v) ? 30000 : v;
  }
}

const defaultInstance = new GoodsReceiptAttemptStore();

module.exports = defaultInstance;
module.exports.GoodsReceiptAttemptStore = GoodsReceiptAttemptStore;
module.exports.ATTEMPT_ENTITY = ATTEMPT_ENTITY;
module.exports.RECEIPT_MOVEMENT = RECEIPT_MOVEMENT;
module.exports.OPEN_STATUSES = OPEN_STATUSES;
module.exports.FINAL_STATUSES = FINAL_STATUSES;
