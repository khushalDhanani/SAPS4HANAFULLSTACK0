const cds = require('@sap/cds');
const LOG = require('../../common/logger')('goods-issue-attempts');

const { INSERT, SELECT, UPDATE } = cds.ql;

/** Persisted entities (db/wm/goods-issue-attempt.cds). */
const ATTEMPT_ENTITY = 'saps4hana.wm.GoodsIssuePostingAttempt';

/** Statuses the re-check job still has to resolve against SAP. */
const OPEN_STATUSES = ['sending', 'unconfirmed'];
/** Statuses that end an attempt. */
// delivery_created ends the attempt: SAP created an outbound delivery (L9/514) instead of a material
// document. Whether that delivery is still open is read live from SAP, not from this log.
const FINAL_STATUSES = ['posted', 'rejected', 'not_posted', 'needs-attention', 'delivery_created'];

function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== '' ? n : fallback;
}

/**
 * GoodsIssueAttemptStore
 * Log of Goods Issue posting attempts. A row is written with status `sending` BEFORE S/4HANA is
 * called, carrying the same ReferenceDocument that goes into the material document header, and is
 * moved to posted / rejected / unconfirmed afterwards. If the process dies mid-call the row
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
    this._memoryStore = new Map();
  }

  get db() {
    return this._dbProvider() || null;
  }

  isAvailable() {
    return Boolean(this.db) || this._memoryStore.size >= 0;
  }

  clearMemoryStore() {
    this._memoryStore.clear();
  }

  /** Age after which a `sending` / `unconfirmed` attempt is re-checked (GI_ATTEMPT_RECHECK_AGE_MS, default 3 min). */
  static recheckAgeMs() { return envMs('GI_ATTEMPT_RECHECK_AGE_MS', 180000); }

  /** Age after which an attempt SAP still does not know is `not_posted` (GI_ATTEMPT_NOT_POSTED_AGE_MS, default 15 min). */
  static notPostedAgeMs() { return envMs('GI_ATTEMPT_NOT_POSTED_AGE_MS', 900000); }

  /** Interval of the background re-check (GI_ATTEMPT_RECHECK_INTERVAL_MS, default 1 min; 0 disables it). */
  static recheckIntervalMs() { return envMs('GI_ATTEMPT_RECHECK_INTERVAL_MS', 60000); }

  /** Maximum age for an unconfirmed attempt before marking needs-attention (GI_UNCONFIRMED_MAX_AGE_MS, default 30 min). */
  static unconfirmedMaxAgeMs() { return envMs('GI_UNCONFIRMED_MAX_AGE_MS', 1800000); }

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
      RequestHash: String(data.RequestHash || '').trim(),
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
      DeliveryNumber: '',
      LastError: '',
      createdAt: new Date().toISOString()
    };
    if (!row.ReferenceDocument) throw new Error('ReferenceDocument is required to record a posting attempt');
    if (this.db) {
      await this._run(INSERT.into(ATTEMPT_ENTITY).entries(row));
    }
    this._memoryStore.set(row.ReferenceDocument, { ...row });
    return row;
  }

  /**
   * Atomically claims a posting reference, returning the prior row when another request already
   * claimed the same idempotency key.
   * @returns {Promise<{ created: boolean, row: Object }>}
   */
  async createOrGet(data) {
    const ref = String(data.ReferenceDocument || '').trim();
    if (!ref) throw new Error('ReferenceDocument is required to claim a posting attempt');

    const assertSameRequest = (row) => {
      if (String(row.RequestHash || '') !== String(data.RequestHash || '')) {
        const err = new Error('Goods Issue idempotency reference collision; posting was not sent to SAP.');
        err.status = 409;
        throw err;
      }
      return { created: false, row };
    };

    if (!this.db) {
      const existing = this._memoryStore.get(ref);
      if (existing) return assertSameRequest(existing);
      const row = await this.create(data);
      return { created: true, row };
    }

    const existing = await this.getByReference(ref);
    if (existing) return assertSameRequest(existing);
    try {
      const row = await this.create(data);
      return { created: true, row };
    } catch (insertErr) {
      const raced = await this.getByReference(ref);
      if (raced) return assertSameRequest(raced);
      throw insertErr;
    }
  }

  /** The attempt for a reference, or null. */
  async getByReference(referenceDocument) {
    const ref = String(referenceDocument || '').trim();
    if (!this.isAvailable() || !ref) return null;
    if (this.db) {
      const row = await this._run(SELECT.one.from(ATTEMPT_ENTITY).where({ ReferenceDocument: ref }));
      if (row) return row;
    }
    return this._memoryStore.get(ref) || null;
  }

  /**
   * Moves an attempt to a new status.
   *
   * @param {string} referenceDocument
   * @param {string} status - sending | posted | rejected | unconfirmed | not_posted
   * @param {{ MaterialDocument?: string, MaterialDocYear?: string, LastError?: string }} [fields]
   */
  async setStatus(referenceDocument, status, fields = {}) {
    const ref = String(referenceDocument).trim();
    const updates = { Status: status, ResolvedAt: FINAL_STATUSES.includes(status) ? new Date().toISOString() : null };
    if (fields.MaterialDocument !== undefined) updates.MaterialDocument = String(fields.MaterialDocument || '');
    if (fields.MaterialDocYear !== undefined) updates.MaterialDocYear = String(fields.MaterialDocYear || '');
    if (fields.DeliveryNumber !== undefined) updates.DeliveryNumber = String(fields.DeliveryNumber || '');
    if (fields.LastError !== undefined) updates.LastError = String(fields.LastError || '').slice(0, 500);

    const mem = this._memoryStore.get(ref);
    if (mem) {
      Object.assign(mem, updates);
    }
    if (this.db) {
      await this._run(UPDATE(ATTEMPT_ENTITY).set(updates).where({ ReferenceDocument: ref }));
    }
  }

  /**
   * Checks whether there is an active (sending or unconfirmed) attempt for a reservation item.
   *
   * @param {string} reservationNo
   * @param {string} [reservationItem]
   * @returns {Promise<boolean>}
   */
  async hasOpenAttemptForReservation(reservationNo, reservationItem) {
    const sRes = String(reservationNo || '').trim();
    if (!sRes) return false;
    const cleanRes = sRes.replace(/^0+/, '');
    const cleanItem = reservationItem !== undefined && reservationItem !== null ? String(reservationItem).trim().replace(/^0+/, '') : '';

    if (!this.isAvailable()) return false;

    for (const attempt of this._memoryStore.values()) {
      if (OPEN_STATUSES.includes(attempt.Status)) {
        const aRes = String(attempt.ReservationNo || '').trim().replace(/^0+/, '');
        if (cleanItem) {
          const aItem = String(attempt.ReservationItem || '').trim().replace(/^0+/, '');
          if (aRes === cleanRes && aItem === cleanItem) return true;
        } else if (aRes === cleanRes) {
          return true;
        }
      }
    }

    if (!this.db) return false;

    try {
      const rows = await this._run(
        SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES } })
      );
      if (!Array.isArray(rows) || rows.length === 0) return false;
      return rows.some((attempt) => {
        const aRes = String(attempt.ReservationNo || '').trim().replace(/^0+/, '');
        if (cleanItem) {
          const aItem = String(attempt.ReservationItem || '').trim().replace(/^0+/, '');
          return aRes === cleanRes && aItem === cleanItem;
        }
        return aRes === cleanRes;
      });
    } catch (err) {
      LOG.warn('Query failed for open attempts by reservation:', err.message || err);
      return false;
    }
  }

  /**
   * Returns a Set of cleaned reservation numbers that currently have open (sending or unconfirmed) attempts.
   *
   * @returns {Promise<Set<string>>}
   */
  async getOpenAttemptReservations() {
    const resvSet = new Set();
    if (!this.isAvailable()) return resvSet;

    for (const attempt of this._memoryStore.values()) {
      if (OPEN_STATUSES.includes(attempt.Status) && attempt.ReservationNo) {
        resvSet.add(String(attempt.ReservationNo).trim().replace(/^0+/, ''));
      }
    }

    if (!this.db) return resvSet;

    try {
      const rows = await this._run(
        SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES } })
      );
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r.ReservationNo) {
            resvSet.add(String(r.ReservationNo).trim().replace(/^0+/, ''));
          }
        }
      }
    } catch (err) {
      LOG.warn('Query failed for open attempt reservations:', err.message || err);
    }
    return resvSet;
  }


  /**
   * Background re-check: resolves attempts left in `sending` (process died mid-call) or
   * `unconfirmed` (SAP did not answer) by looking their reference up in S/4HANA.
   * This is the only place that sets `not_posted`.
   *
   * @param {Object} adapter - GoodsIssueAdapter (findPostedGoodsIssueByReference)
   * @param {number} [now] - current time in ms (tests)
   * @returns {Promise<{ Checked: number, Posted: number, DeliveryCreated: number, NotPosted: number, StillOpen: number, Errors: number }>}
   */
  /**
   * Re-confirm job: retries read-back for unconfirmed documents and clears the flag.
   * Promotes attempt status from 'unconfirmed' to 'posted' when SAP confirms the document,
   * and clears unconfirmed flag on corresponding GoodsIssueIssuedStorageUnit claims.
   *
   * @param {Object} adapter - GoodsIssueAdapter or client
   * @param {number} [now=Date.now()]
   * @returns {Promise<{ Checked: number, Confirmed: number, StillUnconfirmed: number, MarkedNeedsAttention: number, Errors: number }>}
   */
  async reconfirmUnconfirmed(adapter, now = Date.now()) {
    const summary = { Checked: 0, Confirmed: 0, StillUnconfirmed: 0, MarkedNeedsAttention: 0, Errors: 0 };
    if (!this.isAvailable()) return summary;

    let unconfirmedAttempts = [];
    if (this.db) {
      try {
        const rows = await this._run(
          SELECT.from(ATTEMPT_ENTITY).where({ Status: 'unconfirmed' })
        );
        unconfirmedAttempts = (Array.isArray(rows) ? rows : []).filter((a) => Boolean(a.MaterialDocument));
      } catch (err) {
        LOG.warn(`Failed to fetch unconfirmed attempts: ${err.message}`);
        return summary;
      }
    } else {
      unconfirmedAttempts = Array.from(this._memoryStore.values()).filter((a) => a.Status === 'unconfirmed' && Boolean(a.MaterialDocument));
    }

    const client = adapter?.client || adapter?.posting || adapter;
    const readBack = (client && typeof client.readBackDocument === 'function')
      ? client.readBackDocument.bind(client)
      : (adapter && typeof adapter.readBackDocument === 'function')
        ? adapter.readBackDocument.bind(adapter)
        : null;

    if (!readBack) {
      LOG.warn('No readBackDocument function available on adapter/client');
      return summary;
    }

    const suStore = require('./GoodsIssueIssuedSuStore');
    const maxAge = GoodsIssueAttemptStore.unconfirmedMaxAgeMs();

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
          if (suStore && typeof suStore.clearUnconfirmedFlag === 'function') {
            await suStore.clearUnconfirmedFlag(
              verified.MaterialDocument || attempt.MaterialDocument,
              confYear
            );
          }
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

    if (suStore && typeof suStore.reconfirmUnconfirmed === 'function') {
      try {
        await suStore.reconfirmUnconfirmed(adapter, now);
      } catch (suErr) {
        LOG.warn(`SU store reconfirmUnconfirmed error: ${suErr.message}`);
      }
    }

    return summary;
  }

  /**
   * Delivery SAP created for an attempt: exact match on LIKP-LIFEX (= our ReferenceDocument), else
   * the reservation item's deliveries without an external id, same quantity, created on the
   * attempt's posting date. Exactly one such candidate is attributed; several return 'ambiguous'
   * (keeps the attempt open, never not_posted). Null when the adapter cannot look deliveries up.
   */
  async _findDeliveryForAttempt(adapter, attempt) {
    if (!adapter || typeof adapter.findDeliveryByReference !== 'function') return null;
    const byRef = await adapter.findDeliveryByReference(attempt.ReferenceDocument);
    if (byRef) return byRef;
    if (!attempt.ReservationNo || !attempt.ReservationItem || typeof adapter.findDeliveriesForReservationItem !== 'function') return null;
    const day = String(attempt.PostingDate || '').slice(0, 10).replace(/-/g, '');
    const candidates = (await adapter.findDeliveriesForReservationItem(attempt.ReservationNo, attempt.ReservationItem))
      .filter((d) => !d.ExternalId && (!day || d.CreatedOn === day) && Math.abs(Number(d.Quantity) - Number(attempt.IssueQty)) < 0.001);
    if (candidates.length > 1) return 'ambiguous';
    return candidates[0] || null;
  }

  async recheck(adapter, now = Date.now()) {
    const summary = { Checked: 0, Posted: 0, DeliveryCreated: 0, NotPosted: 0, StillOpen: 0, Errors: 0 };
    if (!this.isAvailable()) return summary;
    await this.reconfirmUnconfirmed(adapter, now).catch((err) => LOG.warn(`reconfirmUnconfirmed failed inside recheck: ${err.message}`));
    let open = [];
    if (this.db) {
      open = await this._run(SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES } }));
    } else {
      open = Array.from(this._memoryStore.values()).filter((a) => OPEN_STATUSES.includes(a.Status));
    }
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

      if (doc) {
        await this.setStatus(ref, 'posted', { MaterialDocument: doc.MaterialDocument, MaterialDocYear: doc.MaterialDocumentYear, LastError: '' });
        summary.Posted++;
        continue;
      }

      // No material document: SAP may have created an outbound delivery instead (WM-managed
      // location, L9/514). A delivery is never "not posted"; a failed read keeps the status.
      let delivery;
      try {
        delivery = await this._findDeliveryForAttempt(adapter, attempt);
      } catch (err) {
        LOG.warn(`Delivery lookup for posting attempt ${ref} failed, status ${attempt.Status} kept: ${err.message}`);
        summary.Errors++;
        continue;
      }
      if (delivery === 'ambiguous') {
        summary.StillOpen++;
      } else if (delivery) {
        await this.setStatus(ref, 'delivery_created', {
          DeliveryNumber: delivery.DeliveryNumber,
          LastError: `SAP created outbound delivery ${delivery.DeliveryNumber} instead of a material document; goods issue requires PGI of that delivery.`
        });
        summary.DeliveryCreated++;
      } else if (ageOf(attempt) >= GoodsIssueAttemptStore.notPostedAgeMs()) {
        const finding = `No material document with reference ${ref} exists in S/4HANA ${Math.round(ageOf(attempt) / 60000)} min after the attempt: not posted.`;
        await this.setStatus(ref, 'not_posted', { LastError: finding });
        summary.NotPosted++;
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
