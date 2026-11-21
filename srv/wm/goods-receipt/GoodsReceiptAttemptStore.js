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
const { INSERT, SELECT, UPDATE } = cds.ql;

const {
  ATTEMPT_ENTITY,
  RECEIPT_MOVEMENT,
  OPEN_STATUSES,
  FINAL_STATUSES,
  recheckIntervalMs,
  recheckAgeMs,
  notPostedAgeMs,
  unconfirmedMaxAgeMs,
  distributedLeaseDurationMs,
} = require('./GoodsReceiptAttemptConfig');

const {
  claimAttemptForRecheck,
  releaseAttemptLease,
  recheckReceipts,
  reconfirmUnconfirmed,
} = require('./GoodsReceiptRecheckService');

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
      updatedAt: new Date().toISOString(),
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
            LastError: `Stepped back for open attempt ${rival.ReferenceDocument}; not sent to SAP.`,
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
      updatedAt: new Date().toISOString(),
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

  async claimAttemptForRecheck(referenceDocument, workerId, leaseMs, now) {
    return claimAttemptForRecheck(this, referenceDocument, workerId, leaseMs, now);
  }

  async releaseAttemptLease(referenceDocument, workerId) {
    return releaseAttemptLease(this, referenceDocument, workerId);
  }

  async recheckReceipts(adapter, now = Date.now(), options = {}) {
    return recheckReceipts(this, adapter, now, options);
  }

  async reconfirmUnconfirmed(adapter, now = Date.now(), options = {}) {
    return reconfirmUnconfirmed(this, adapter, now, options);
  }

  static recheckIntervalMs() {
    return recheckIntervalMs();
  }

  static recheckAgeMs() {
    return recheckAgeMs();
  }

  static notPostedAgeMs() {
    return notPostedAgeMs();
  }

  static unconfirmedMaxAgeMs() {
    return unconfirmedMaxAgeMs();
  }

  static distributedLeaseDurationMs() {
    return distributedLeaseDurationMs();
  }
}

const defaultInstance = new GoodsReceiptAttemptStore();

module.exports = defaultInstance;
module.exports.GoodsReceiptAttemptStore = GoodsReceiptAttemptStore;
module.exports.ATTEMPT_ENTITY = ATTEMPT_ENTITY;
module.exports.RECEIPT_MOVEMENT = RECEIPT_MOVEMENT;
module.exports.OPEN_STATUSES = OPEN_STATUSES;
module.exports.FINAL_STATUSES = FINAL_STATUSES;
