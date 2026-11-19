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
/** Goods receipt attempts share this log: ReservationNo/ReservationItem hold the inbound delivery and its item. */
const RECEIPT_MOVEMENT = '101';

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
   * @param {boolean} [options.useMemoryStore=false] - Explicit opt-in for isolated unit tests without a DB
   * @param {boolean} [options.allowMemoryFallback=false] - Backward-compatible opt-in for isolated unit tests
   */
  constructor(options = {}) {
    this._dbProvider = options.db !== undefined ? () => options.db : () => cds.db;
    // Memory store is strictly restricted to explicitly isolated test instances in non-production.
    // In production (NODE_ENV=production), memory store is NEVER permitted under any circumstances.
    const isExplicitTestOptIn = Boolean(
      options.useMemoryStore ||
      options.allowMemoryFallback ||
      (options.db === null && process.env.NODE_ENV === 'test') ||
      (options.db === undefined && process.env.NODE_ENV === 'test' && !cds.db)
    );
    this._useMemoryStore = isExplicitTestOptIn && process.env.NODE_ENV !== 'production';
    this._memoryStore = new Map();
  }

  get db() {
    return this._dbProvider() || null;
  }

  isAvailable() {
    if (this.db) {
      return true;
    }
    // Memory fallback is strictly restricted to non-production isolated unit tests that explicitly enabled it
    return Boolean(this._useMemoryStore && process.env.NODE_ENV !== 'production');
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
      const err = new Error('Goods Issue posting-attempt log is not available: durable database persistence (SAP HANA) is required for transactional posting guarantees.');
      err.status = 503;
      err.statusCode = 503;
      err.code = 'DB_UNAVAILABLE';
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

    if (!this.db) {
      if (this._useMemoryStore && process.env.NODE_ENV !== 'production') {
        this._memoryStore.set(row.ReferenceDocument, { ...row });
        return row;
      }
      const err = new Error('Goods Issue posting-attempt log is unavailable: durable database persistence (SAP HANA) is required for transactional posting guarantees.');
      err.status = 503;
      err.statusCode = 503;
      err.code = 'DB_UNAVAILABLE';
      throw err;
    }

    await this._run(INSERT.into(ATTEMPT_ENTITY).entries(row));
    return row;
  }

  /**
   * All attempts sharing a RequestHash (one identity, across re-claim generations), oldest first.
   * The re-claim path groups generations by this stable identity hash (ReferenceDocument carries
   * a generation suffix; RequestHash does not).
   */
  async _attemptsByRequestHash(requestHash) {
    const hash = String(requestHash || '').trim();
    if (!hash) return [];
    let rows = [];
    if (this.db) {
      rows = await this._run(SELECT.from(ATTEMPT_ENTITY).where({ RequestHash: hash }));
    } else if (this._useMemoryStore && process.env.NODE_ENV !== 'production') {
      rows = Array.from(this._memoryStore.values()).filter((r) => String(r.RequestHash || '') === hash);
    } else {
      const err = new Error('Goods Issue posting-attempt log is unavailable: durable database persistence (SAP HANA) is required for transactional posting guarantees.');
      err.status = 503;
      err.statusCode = 503;
      err.code = 'DB_UNAVAILABLE';
      throw err;
    }
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  /**
   * Atomically claims a posting reference, returning the prior row when another request already
   * claimed the same idempotency key.
   *
   * @param {Object} data - carries ReferenceDocument (the base key) and RequestHash (the identity)
   * @param {{reclaimableStatuses: string[], isReclaimable?: function(Object): boolean}} [reclaim] - OPT-IN re-claim policy (a caller
   *   that passes nothing keeps the plain idempotent-replay behaviour below). When set, a
   *   new claim is allowed only if the latest attempt for this identity is in a status that proves
   *   nothing is posted (e.g. 'rejected', or 'not_posted' for posts); any other status (sending /
   *   unconfirmed / posted / delivery_created / needs-attention) still returns {created:false} (409).
   *   Re-claim preserves the audit trail: the old row is kept and a NEW row is created with the next
   *   generation suffixed to the base ReferenceDocument. Atomicity is the unique constraint on
   *   ReferenceDocument (two concurrent re-claims compute the same next reference; one wins).
   * @returns {Promise<{ created: boolean, row: Object }>}
   */
  async createOrGet(data, reclaim = null) {
    const ref = String(data.ReferenceDocument || '').trim();
    if (!ref) throw new Error('ReferenceDocument is required to claim a posting attempt');

    if (!this.db && !(this._useMemoryStore && process.env.NODE_ENV !== 'production')) {
      const err = new Error('Goods Issue posting-attempt log is unavailable: durable database persistence (SAP HANA) is required for transactional posting guarantees.');
      err.status = 503;
      err.statusCode = 503;
      err.code = 'DB_UNAVAILABLE';
      throw err;
    }

    const assertSameRequest = (row) => {
      if (String(row.RequestHash || '') !== String(data.RequestHash || '')) {
        const err = new Error('Goods Issue idempotency reference collision; posting was not sent to SAP.');
        err.status = 409;
        throw err;
      }
      return { created: false, row };
    };

    if (reclaim && Array.isArray(reclaim.reclaimableStatuses)) {
      const priors = await this._attemptsByRequestHash(data.RequestHash);
      if (priors.length) {
        const latest = priors[priors.length - 1];
        // Latest attempt is live or proves something happened -> block a blind re-claim.
        if (!reclaim.reclaimableStatuses.includes(String(latest.Status || '')) && !reclaim.isReclaimable?.(latest)) {
          return { created: false, row: latest };
        }
      }
      // First attempt (generation 0) or a re-claim of a dead attempt: new row, next generation suffix.
      const generation = priors.length;
      const newRef = `${ref}${generation}`;
      try {
        const row = await this.create({ ...data, ReferenceDocument: newRef });
        // Different client IDs give different references, so the unique key cannot stop two claims at once.
        // Written first, then read: if both see each other both step back, and neither can post.
        // A row newer than the check above counts even if already finished, because that claim ran at the same time.
        const rival = (await this._attemptsByRequestHash(data.RequestHash)).find((a) => a.ReferenceDocument !== newRef
          && (OPEN_STATUSES.includes(a.Status) || !priors.some((prior) => prior.ID === a.ID)));
        if (rival) {
          await this.setStatus(newRef, 'rejected', { LastError: `Stepped back for open attempt ${rival.ReferenceDocument}; not sent to SAP.` });
          return { created: false, row: rival };
        }
        return { created: true, row };
      } catch (insertErr) {
        const raced = await this.getByReference(newRef); // concurrent re-claim took this generation
        if (raced) return assertSameRequest(raced);
        throw insertErr;
      }
    }

    if (!this.db) {
      if (this._useMemoryStore && process.env.NODE_ENV !== 'production') {
        const existing = this._memoryStore.get(ref);
        if (existing) return assertSameRequest(existing);
        const row = await this.create(data);
        return { created: true, row };
      }
      const err = new Error('Goods Issue posting-attempt log is unavailable: durable database persistence (SAP HANA) is required for transactional posting guarantees.');
      err.status = 503;
      err.statusCode = 503;
      err.code = 'DB_UNAVAILABLE';
      throw err;
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
      return (await this._run(SELECT.one.from(ATTEMPT_ENTITY).where({ ReferenceDocument: ref }))) || null;
    }
    if (this._useMemoryStore && process.env.NODE_ENV !== 'production') {
      return this._memoryStore.get(ref) || null;
    }
    return null;
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

    if (this.db) {
      await this._run(UPDATE(ATTEMPT_ENTITY).set(updates).where({ ReferenceDocument: ref }));
      return;
    }
    if (this._useMemoryStore && process.env.NODE_ENV !== 'production') {
      const mem = this._memoryStore.get(ref);
      if (mem) {
        Object.assign(mem, updates);
      }
      return;
    }
    const err = new Error('Goods Issue posting-attempt log is unavailable: durable database persistence (SAP HANA) is required for transactional posting guarantees.');
    err.status = 503;
    err.statusCode = 503;
    err.code = 'DB_UNAVAILABLE';
    throw err;
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
    // Receipts (101) carry no ReferenceDocument in SAP: a lookup by reference would wrongly say not_posted.
    const due = (Array.isArray(open) ? open : [])
      .filter((a) => a.MovementType !== RECEIPT_MOVEMENT && ageOf(a) >= GoodsIssueAttemptStore.recheckAgeMs());

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
      } else if (!attempt.MaterialDocument && ageOf(attempt) >= GoodsIssueAttemptStore.notPostedAgeMs()) {
        // A row holding a document number is never "not posted": SAP gave that number. reconfirmUnconfirmed resolves it.
        const finding = `No material document with reference ${ref} exists in S/4HANA ${Math.round(ageOf(attempt) / 60000)} min after the attempt: not posted.`;
        await this.setStatus(ref, 'not_posted', { LastError: finding });
        summary.NotPosted++;
      } else {
        summary.StillOpen++;
      }
    }
    return summary;
  }

  /**
   * Distributed worker lease for an attempt during background re-check.
   * Ensures that two Cloud Foundry instances cannot independently process the same unresolved attempt.
   *
   * @param {string} referenceDocument
   * @param {string} [workerId] - Worker / instance identifier (e.g. CF_INSTANCE_INDEX)
   * @param {number} [leaseMs=60000] - Lease duration in milliseconds
   * @param {number} [now=Date.now()]
   * @returns {Promise<boolean>} true if the worker acquired the lease; false if locked or already resolved
   */
  async claimAttemptForRecheck(referenceDocument, workerId = (process.env.CF_INSTANCE_INDEX || '0'), leaseMs = 60000, now = Date.now()) {
    const ref = String(referenceDocument).trim();
    const expiresAtIso = new Date(now + leaseMs).toISOString();
    const leaseTag = `lease:${workerId}:${expiresAtIso}`;

    if (this.db) {
      const current = await this.getByReference(ref);
      if (!current || !OPEN_STATUSES.includes(current.Status)) {
        return false;
      }
      if (current.LastError && current.LastError.startsWith('lease:')) {
        const match = current.LastError.match(/^lease:([^:]+):(.+)$/);
        if (match) {
          const [, owner, expiresIso] = match;
          const expiresAtMs = new Date(expiresIso).getTime();
          // If leased to another instance and lease has not expired, cannot claim
          if (owner !== String(workerId) && Number.isFinite(expiresAtMs) && expiresAtMs > now) {
            return false;
          }
        }
      }

      const currentLastError = current.LastError ?? '';
      let query;
      if (currentLastError === '') {
        query = UPDATE(ATTEMPT_ENTITY)
          .set({ LastError: leaseTag })
          .where({ ReferenceDocument: ref, Status: current.Status })
          .and(`(LastError is null or LastError = '')`);
      } else {
        query = UPDATE(ATTEMPT_ENTITY)
          .set({ LastError: leaseTag })
          .where({ ReferenceDocument: ref, Status: current.Status, LastError: currentLastError });
      }

      const updated = await this._run(query);
      return Boolean(updated && (typeof updated === 'number' ? updated > 0 : true));
    }

    if (this._useMemoryStore && process.env.NODE_ENV !== 'production') {
      const mem = this._memoryStore.get(ref);
      if (!mem || !OPEN_STATUSES.includes(mem.Status)) return false;
      if (mem.LastError && mem.LastError.startsWith('lease:')) {
        const match = mem.LastError.match(/^lease:([^:]+):(.+)$/);
        if (match) {
          const [, owner, expiresIso] = match;
          const expiresAtMs = new Date(expiresIso).getTime();
          if (owner !== String(workerId) && Number.isFinite(expiresAtMs) && expiresAtMs > now) {
            return false;
          }
        }
      }
      mem.LastError = leaseTag;
      return true;
    }

    return false;
  }

  async releaseAttemptLease(referenceDocument, workerId) {
    const ref = String(referenceDocument).trim();
    const expectedOwner = String(workerId ?? process.env.CF_INSTANCE_INDEX ?? '0');
    if (this.db) {
      const current = await this.getByReference(ref);
      if (current && current.LastError && current.LastError.startsWith(`lease:${expectedOwner}:`)) {
        await this._run(
          UPDATE(ATTEMPT_ENTITY)
            .set({ LastError: '' })
            .where({ ReferenceDocument: ref, LastError: current.LastError })
        );
      }
      return;
    }
    if (this._useMemoryStore) {
      const mem = this._memoryStore.get(ref);
      if (mem && mem.LastError && mem.LastError.startsWith(`lease:${expectedOwner}:`)) {
        mem.LastError = '';
      }
    }
  }

  /**
   * Background re-check of goods receipt attempts: looks for a 101 document of the delivery item in SAP.
   * Protected by distributed worker leases so multiple instances cannot redundantly query SAP.
   *
   * @param {Object} adapter - GoodsReceiptAdapter (findReceiptForAttempt)
   * @param {number} [now] - current time in ms (tests)
   * @param {Object} [options] - workerId and leaseMs options
   * @returns {Promise<{ Checked: number, Posted: number, NotPosted: number, StillOpen: number, Errors: number, SkippedLocked: number }>}
   */
  async recheckReceipts(adapter, now = Date.now(), options = {}) {
    const summary = { Checked: 0, Posted: 0, NotPosted: 0, StillOpen: 0, Errors: 0, SkippedLocked: 0 };
    const workerId = String(options.workerId ?? process.env.CF_INSTANCE_INDEX ?? '0');
    const leaseMs = options.leaseMs || 60000;
    const open = this.db
      ? await this._run(SELECT.from(ATTEMPT_ENTITY).where({ Status: { in: OPEN_STATUSES }, MovementType: RECEIPT_MOVEMENT }))
      : Array.from(this._memoryStore.values()).filter((a) => OPEN_STATUSES.includes(a.Status) && a.MovementType === RECEIPT_MOVEMENT);
    const ageOf = (a) => now - new Date(a.createdAt).getTime();

    for (const attempt of (open || []).filter((a) => ageOf(a) >= GoodsIssueAttemptStore.recheckAgeMs())) {
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
      if (doc) {
        await this.setStatus(ref, 'posted', { MaterialDocument: doc.MaterialDocument, MaterialDocYear: doc.MaterialDocumentYear, LastError: '' });
        summary.Posted++;
      } else if (ageOf(attempt) >= GoodsIssueAttemptStore.notPostedAgeMs()) {
        const finding = `No 101 material document exists for this delivery item in S/4HANA ${Math.round(ageOf(attempt) / 60000)} min after the attempt: not posted.`;
        await this.setStatus(ref, 'not_posted', { LastError: finding });
        summary.NotPosted++;
      } else {
        await this.releaseAttemptLease(ref, workerId);
        summary.StillOpen++;
      }
    }
    return summary;
  }
}

module.exports = new GoodsIssueAttemptStore();
module.exports.GoodsIssueAttemptStore = GoodsIssueAttemptStore;
module.exports.ATTEMPT_ENTITY = ATTEMPT_ENTITY;
