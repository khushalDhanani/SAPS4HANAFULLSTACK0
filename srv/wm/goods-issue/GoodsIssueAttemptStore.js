const cds = require('@sap/cds');
const LOG = require('../../common/logger')('goods-issue-attempts');

const { INSERT, SELECT, UPDATE } = cds.ql;

/** Persisted entities (db/wm/goods-issue-attempt.cds, db/wm/goods-issue-queue.cds). */
const ATTEMPT_ENTITY = 'saps4hana.wm.GoodsIssuePostingAttempt';
const QUEUE_ENTITY = 'saps4hana.wm.GoodsIssueQueue';

/** Statuses the re-check job still has to resolve against SAP. */
const OPEN_STATUSES = ['sending', 'unconfirmed'];
/** Statuses that end an attempt. */
const FINAL_STATUSES = ['posted', 'rejected', 'not_posted'];

function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== '' ? n : fallback;
}

/**
 * GoodsIssueAttemptStore
 * Log of Goods Issue posting attempts. A row is written with status `sending` BEFORE S/4HANA is
 * called, carrying the same ReferenceDocument that goes into the material document header, and is
 * moved to posted / rejected / queued / unconfirmed afterwards. If the process dies mid-call the row
 * stays `sending`, and recheck() resolves it later by looking the reference up in SAP.
 *
 * Every write runs in its own committed transaction, never in the transaction of the calling
 * request: a request that ends in req.error is rolled back, and the attempt must survive that.
 */
class GoodsIssueAttemptStore {
  /**
   * @param {Object} [options]
   * @param {Object|null} [options.db] - Database service to use (tests); default: cds.db at call time
   */
  constructor(options = {}) {
    this._dbProvider = options.db !== undefined ? () => options.db : () => cds.db;
  }

  get db() {
    return this._dbProvider() || null;
  }

  isAvailable() {
    return Boolean(this.db);
  }

  /** Age after which a `sending` / `unconfirmed` attempt is re-checked (GI_ATTEMPT_RECHECK_AGE_MS, default 3 min). */
  static recheckAgeMs() { return envMs('GI_ATTEMPT_RECHECK_AGE_MS', 180000); }

  /** Age after which an attempt SAP still does not know is `not_posted` (GI_ATTEMPT_NOT_POSTED_AGE_MS, default 15 min). */
  static notPostedAgeMs() { return envMs('GI_ATTEMPT_NOT_POSTED_AGE_MS', 900000); }

  /** Interval of the background re-check (GI_ATTEMPT_RECHECK_INTERVAL_MS, default 1 min; 0 disables it). */
  static recheckIntervalMs() { return envMs('GI_ATTEMPT_RECHECK_INTERVAL_MS', 60000); }

  /** Runs one query in its own root transaction (committed independently of the calling request). */
  _run(query) {
    const db = this.db;
    if (!db) {
      const err = new Error('Goods Issue posting-attempt log is not available: no database is bound to this deployment.');
      err.status = 503;
      throw err;
    }
    return db.tx({ user: cds.User.privileged }, (tx) => tx.run(query));
  }

  /**
   * Records an attempt with status `sending`. Must be awaited before S/4HANA is called.
   *
   * @param {Object} data - normalized posting data carrying ReferenceDocument
   * @returns {Promise<Object>} the persisted row
   */
  async create(data) {
    const row = {
      ID: cds.utils.uuid(),
      ReferenceDocument: String(data.ReferenceDocument || '').trim(),
      MovementType: String(data.MovementType || '').trim(),
      ReservationNo: String(data.ReservationNo || '').trim(),
      ReservationItem: String(data.ReservationItem || '').trim(),
      Material: String(data.Material || '').trim(),
      Plant: String(data.Plant || '').trim(),
      StorageLocation: String(data.StorageLocation || '').trim(),
      CostCenter: String(data.CostCenter || '').trim(),
      IssueQty: Number(data.IssueQty) || 0,
      Unit: String(data.Unit || '').trim(),
      PostingUser: String(data.User || '').slice(0, 255),
      PostingDate: data.PostingDate || null,
      Status: 'sending',
      ResolvedAt: null,
      MaterialDocument: '',
      MaterialDocYear: '',
      LastError: ''
    };
    if (!row.ReferenceDocument) throw new Error('ReferenceDocument is required to record a posting attempt');
    await this._run(INSERT.into(ATTEMPT_ENTITY).entries(row));
    return row;
  }

  /** The attempt for a reference, or null. */
  async getByReference(referenceDocument) {
    const ref = String(referenceDocument || '').trim();
    if (!this.isAvailable() || !ref) return null;
    const row = await this._run(SELECT.one.from(ATTEMPT_ENTITY).where({ ReferenceDocument: ref }));
    return row || null;
  }

  /**
   * Moves an attempt to a new status.
   *
   * @param {string} referenceDocument
   * @param {string} status - sending | posted | rejected | queued | unconfirmed | not_posted
   * @param {{ MaterialDocument?: string, MaterialDocYear?: string, LastError?: string }} [fields]
   */
  async setStatus(referenceDocument, status, fields = {}) {
    const updates = { Status: status, ResolvedAt: FINAL_STATUSES.includes(status) ? new Date().toISOString() : null };
    if (fields.MaterialDocument !== undefined) updates.MaterialDocument = String(fields.MaterialDocument || '');
    if (fields.MaterialDocYear !== undefined) updates.MaterialDocYear = String(fields.MaterialDocYear || '');
    if (fields.LastError !== undefined) updates.LastError = String(fields.LastError || '').slice(0, 500);
    await this._run(UPDATE(ATTEMPT_ENTITY).set(updates).where({ ReferenceDocument: String(referenceDocument).trim() }));
  }

  /**
   * Queue-replay guard. A queue record that carries a reference may be replayed only while its
   * attempt is `queued`; records without a reference or without an attempt (older rows, movement
   * types that send no reference) replay as before.
   *
   * @param {Object} queueItem
   * @returns {Promise<{ replay: boolean, attempt: Object|null }>}
   */
  async replayGuard(queueItem) {
    const attempt = await this.getByReference(queueItem && queueItem.ReferenceDocument);
    return { replay: !attempt || attempt.Status === 'queued', attempt };
  }

  /**
   * Background re-check: resolves attempts left in `sending` (process died mid-call) or
   * `unconfirmed` (SAP did not answer) by looking their reference up in S/4HANA.
   * This is the only place that sets `not_posted`.
   *
   * @param {Object} adapter - GoodsIssueAdapter (findPostedGoodsIssueByReference)
   * @param {number} [now] - current time in ms (tests)
   * @returns {Promise<{ Checked: number, Posted: number, NotPosted: number, Requeued: number, StillOpen: number, Errors: number }>}
   */
  async recheck(adapter, now = Date.now()) {
    const summary = { Checked: 0, Posted: 0, NotPosted: 0, Requeued: 0, StillOpen: 0, Errors: 0 };
    if (!this.isAvailable()) return summary;
    const open = await this._run(SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES } }));
    const ageOf = (a) => now - new Date(a.createdAt).getTime();
    const due = (Array.isArray(open) ? open : []).filter((a) => ageOf(a) >= GoodsIssueAttemptStore.recheckAgeMs());

    for (const attempt of due) {
      summary.Checked++;
      const ref = attempt.ReferenceDocument;
      let doc;
      try {
        doc = await adapter.findPostedGoodsIssueByReference(ref, attempt.MovementType, attempt.PostingDate);
      } catch (err) {
        // Cannot tell: leave the status as it is and try again on the next run.
        LOG.warn(`Re-check of posting attempt ${ref} failed, status ${attempt.Status} kept: ${err.message}`);
        summary.Errors++;
        continue;
      }
      const queueRecord = await this._run(SELECT.one.from(QUEUE_ENTITY).where({ ReferenceDocument: ref }));

      if (doc) {
        await this.setStatus(ref, 'posted', { MaterialDocument: doc.MaterialDocument, MaterialDocYear: doc.MaterialDocumentYear, LastError: '' });
        if (queueRecord) {
          await this._run(UPDATE(QUEUE_ENTITY).set({
            SyncStatus: 'POSTED_IN_SAP',
            SapMaterialDocument: doc.MaterialDocument,
            SapMaterialDocYear: doc.MaterialDocumentYear,
            SyncedAt: new Date(now).toISOString()
          }).where({ ID: queueRecord.ID }));
        }
        summary.Posted++;
      } else if (ageOf(attempt) >= GoodsIssueAttemptStore.notPostedAgeMs()) {
        const finding = `No material document with reference ${ref} exists in S/4HANA ${Math.round(ageOf(attempt) / 60000)} min after the attempt: not posted.`;
        await this.setStatus(ref, 'not_posted', { LastError: finding });
        summary.NotPosted++;
        if (queueRecord) {
          // A queued item is replayed again (the replay looks the reference up first).
          await this.setStatus(ref, 'queued', { LastError: `${finding} Returned to the dispatch queue.` });
          summary.Requeued++;
        }
      } else {
        summary.StillOpen++;
      }
    }
    return summary;
  }
}

module.exports = new GoodsIssueAttemptStore();
module.exports.GoodsIssueAttemptStore = GoodsIssueAttemptStore;
module.exports.ATTEMPT_ENTITY = ATTEMPT_ENTITY;
