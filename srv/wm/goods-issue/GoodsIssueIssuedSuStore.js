'use strict';

const cds = require('@sap/cds');
const LOG = require('../../common/logger')('issued-su-store');

const ISSUED_SU_ENTITY = 'saps4hana.wm.GoodsIssueIssuedStorageUnit';
const SU_LOCK_ENTITY = 'saps4hana.wm.GoodsIssueSuLock';

function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== '' ? n : fallback;
}

/**
 * AsyncKeyLock
 * In-memory FIFO lock per StorageUnit key to serialize concurrent claim attempts
 * in Node.js event loop. Retained as an in-process optimization layer; the authoritative
 * multi-instance concurrency guarantee is the DB-level row lock on GoodsIssueSuLock
 * under READ COMMITTED in acquireClaims.
 */
class AsyncKeyLock {
  constructor() { this._locks = new Map(); }

  async acquire(keys = []) {
    const sortedKeys = [...new Set(keys.map((k) => String(k || '').trim().toUpperCase()))].filter(Boolean).sort();
    for (const key of sortedKeys) {
      while (this._locks.has(key)) { await this._locks.get(key); }
      let resolveLock;
      const p = new Promise((resolve) => { resolveLock = resolve; });
      p.resolve = resolveLock;
      this._locks.set(key, p);
    }
  }

  release(keys = []) {
    const sortedKeys = [...new Set(keys.map((k) => String(k || '').trim().toUpperCase()))].filter(Boolean).sort();
    for (const key of sortedKeys) {
      const lock = this._locks.get(key);
      if (lock) { this._locks.delete(key); lock.resolve(); }
    }
  }
}

class GoodsIssueIssuedSuStore {
  constructor(options = {}) {
    this._dbProvider = options.db !== undefined ? () => options.db : () => cds.db;
    this._memoryStore = new Map();
    this._keyLock = new AsyncKeyLock();
  }

  get db() { return this._dbProvider() || null; }
  isAvailable() { return Boolean(this.db) || this._memoryStore.size >= 0; }

  static staleClaimAgeMs() { return envMs('GI_CLAIMING_STALE_AGE_MS', 300000); }
  static needsAttentionAgeMs() { return envMs('GI_CLAIMING_NEEDS_ATTENTION_MS', 1800000); }
  static releaseIntervalMs() { return envMs('GI_SU_RELEASE_INTERVAL_MS', 60000); }

  /**
   * Returns true when an error indicates that the request NEVER reached SAP
   * or failed at the HTTP/network boundary before SAP business logic processed it:
   *   - 404 (Gateway service not found / not activated)
   *   - 503 (Service Unavailable)
   *   - ECONNREFUSED (connection refused)
   *   - DNS resolution failures (ENOTFOUND, EAI_AGAIN, getaddrinfo)
   * In all these cases, SAP definitely did NOT create or post any material document,
   * so claiming rows can be deleted definitively.
   *
   * @param {Error|Object} err
   * @returns {boolean}
   */
  static isNeverReachedError(err) {
    if (!err) return false;
    const s = Number(err.status || (err.response && err.response.status) || err.statusCode);
    const code = String(err.code || '');
    const msg = String(err.message || '');

    if (s === 404 || s === 503) return true;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return true;
    return false;
  }

  /**
   * Returns true when an error represents a DEFINITIVE rejection (document was NOT posted):
   *   1. SAP business/validation rejection: HTTP 400, 409, 422 or deficit/insufficient stock messages.
   *   2. Never-reached error: HTTP 404, 503, ECONNREFUSED, DNS failures.
   *
   * Returns false for UNKNOWN outcomes:
   *   - 502 Bad Gateway
   *   - 504 Gateway Timeout
   *   - ETIMEDOUT / timeout
   *   - ECONNRESET / reset (socket hang up)
   *   - 2xx without document number
   *   - UNCONFIRMED_CODES
   *
   * @param {Error|Object} err
   * @returns {boolean}
   */
  static isDefinitiveRejection(err) {
    if (!err) return false;
    const s = Number(err.status || (err.response && err.response.status) || err.statusCode);
    const code = String(err.code || '');
    const msg = String(err.message || '');

    // 1. Explicitly NOT definitive: 502, 504, network timeouts, connection resets
    if (s === 502 || s === 504) return false;
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET') return false;
    if (/gateway timeout|timed? ?out|socket hang up|connection reset|econnreset|etimedout/i.test(msg)) return false;

    // 2. Plain 403 Forbidden (authorization denial) is DEFINITIVE (SAP definitely did not post)
    if (s === 403) return true;

    // 3. Business / validation rejections
    if (s === 400 || s === 409 || s === 422) return true;
    if (/deficit|consumed|storage unit|insufficient stock/i.test(msg)) return true;

    // 4. Never-reached errors (404, 503, ECONNREFUSED, DNS failures)
    if (GoodsIssueIssuedSuStore.isNeverReachedError(err)) return true;

    return false;
  }

  _run(query) {
    const db = this.db;
    if (!db) { const err = new Error('Issued SU store unavailable: no database bound.'); err.status = 503; throw err; }
    return db.tx({ user: cds.User.privileged }, (tx) => tx.run(query));
  }

  async _runInTx(fn) {
    const db = this.db;
    if (!db) { const err = new Error('Issued SU store unavailable: no database bound.'); err.status = 503; throw err; }
    return db.tx({ user: cds.User.privileged }, fn);
  }

  async clear() {
    this._memoryStore.clear();
    if (this.db) {
      try {
        await this._run(DELETE.from(ISSUED_SU_ENTITY));
        await this._run(DELETE.from(SU_LOCK_ENTITY));
      } catch (e) { /* in-mem test ok */ }
    }
  }

  /**
   * Effective claim for one row using oldest-first LQUA-drop allocation.
   * The total drop (preIssueStock - currentStock) is attributed oldest-first.
   * Pass toDeductedAlreadyAllocated = cumulative drop used by older claims.
   *
   * @param {Object} claim - { IssuedQty, PreIssueStock }
   * @param {number|null} currentStock
   * @param {number} toDeductedAlreadyAllocated
   * @returns {{ effectiveClaim: number, toDeductedUsed: number }}
   */
  static calculateEffectiveClaimWithAllocation(claim, currentStock = null, toDeductedAlreadyAllocated = 0) {
    const claimed = Math.round(Number(claim.IssuedQty || 0) * 1000) / 1000;
    if (currentStock === null || currentStock === undefined) return { effectiveClaim: claimed, toDeductedUsed: 0 };
    const preStock = Number(claim.PreIssueStock != null ? claim.PreIssueStock : currentStock);
    const totalDrop = Math.max(0, preStock - Number(currentStock));
    const remainingDrop = Math.max(0, totalDrop - toDeductedAlreadyAllocated);
    const toDeductedUsed = Math.min(remainingDrop, claimed);
    return {
      effectiveClaim: Math.round(Math.max(0, claimed - toDeductedUsed) * 1000) / 1000,
      toDeductedUsed: Math.round(toDeductedUsed * 1000) / 1000
    };
  }

  /**
   * Single-claim effective claim (backwards-compatible).
   * effectiveClaim = max(0, claimed - (preIssueStock - currentStock))
   */
  static calculateEffectiveClaim(claim, currentStock = null) {
    const { effectiveClaim } = GoodsIssueIssuedSuStore.calculateEffectiveClaimWithAllocation(claim, currentStock, 0);
    return effectiveClaim;
  }

  /**
   * Quantity-based concurrent claims check.
   * totalEffectiveClaimed (oldest-first) + requested <= currentStock.
   * 'claiming', 'issued', and 'needs-attention' rows are included in the claimed sum.
   *
   * @param {Array} itemsOrUnits
   * @returns {Promise<{ hasClaim: boolean, ... }>}
   */
  async checkConcurrentClaims(itemsOrUnits = []) {
    if (!Array.isArray(itemsOrUnits) || itemsOrUnits.length === 0) return { hasClaim: false };

    const items = itemsOrUnits.map((item) => {
      if (typeof item === 'string') return { storageUnit: String(item).trim().toUpperCase(), requestedQty: null, currentStock: null };
      return {
        storageUnit: String(item.storageUnit || item.StorageUnit || '').trim().toUpperCase(),
        requestedQty: item.requestedQty != null ? Number(item.requestedQty) : (item.issuedQty != null ? Number(item.issuedQty) : null),
        currentStock: item.currentStock != null ? Number(item.currentStock) : (item.preIssueStock != null ? Number(item.preIssueStock) : null)
      };
    }).filter((i) => Boolean(i.storageUnit));

    if (items.length === 0) return { hasClaim: false };
    const suList = items.map((i) => i.storageUnit);

    let activeRows = [];
    if (this.db) {
      try {
        const rows = await this._run(
          SELECT.from(ISSUED_SU_ENTITY).where({ Status: { in: ['claiming', 'issued', 'needs-attention'] }, StorageUnit: { in: suList } })
        );
        if (Array.isArray(rows)) activeRows = rows;
      } catch (err) { LOG.warn('DB query failed for concurrent claims, falling back to memory:', err.message || err); }
    }

    const memActive = Array.from(this._memoryStore.values()).filter(
      (r) => ['claiming', 'issued', 'needs-attention'].includes(r.Status) && suList.includes(r.StorageUnit)
    );
    const rowMap = new Map();
    for (const r of [...activeRows, ...memActive]) rowMap.set(r.ID, r);
    const allActive = Array.from(rowMap.values());

    for (const item of items) {
      const su = item.storageUnit;
      const suClaims = allActive.filter((r) => r.StorageUnit === su);
      if (suClaims.length === 0) continue;

      let curStock = item.currentStock;
      if (curStock === null || curStock === undefined) curStock = Math.max(...suClaims.map((c) => Number(c.PreIssueStock || 0)), 0);

      // Oldest-first allocation
      const sortedClaims = [...suClaims].sort((a, b) =>
        new Date(a.createdAt || a.CreatedAt || 0).getTime() - new Date(b.createdAt || b.CreatedAt || 0).getTime()
      );

      let toDeductedAllocated = 0;
      let totalClaimed = 0;
      for (const claim of sortedClaims) {
        const { effectiveClaim, toDeductedUsed } = GoodsIssueIssuedSuStore.calculateEffectiveClaimWithAllocation(claim, curStock, toDeductedAllocated);
        toDeductedAllocated = Math.round((toDeductedAllocated + toDeductedUsed) * 1000) / 1000;
        totalClaimed = Math.round((totalClaimed + effectiveClaim) * 1000) / 1000;
      }

      const reqQty = item.requestedQty != null ? Math.round(Number(item.requestedQty) * 1000) / 1000 : Math.round(Number(curStock) * 1000) / 1000;

      if (totalClaimed + reqQty > curStock + 0.001) {
        return {
          hasClaim: true, claimedSu: su, currentStock: curStock, totalClaimed, requestedQty: reqQty,
          availableStock: Math.max(0, Math.round((curStock - totalClaimed) * 1000) / 1000),
          record: suClaims[0]
        };
      }
    }

    return { hasClaim: false };
  }

  /**
   * Atomic 2-Phase Claim: Step 1 (Acquire)
   *
   * Multi-instance safe DB-level check under READ COMMITTED:
   * 1. Acquire in-memory keyLock (serializes within this process).
   * 2. In DB transaction (READ COMMITTED isolation):
   *    - Exclusive row lock on GoodsIssueSuLock per Storage Unit (in sorted order).
   *      Under READ COMMITTED, another concurrent tx's uncommitted rows are invisible;
   *      by holding an exclusive row lock on GoodsIssueSuLock, concurrent transactions for
   *      the same SU block until this tx commits, ensuring the waiting tx's re-sum sees
   *      the committed claiming rows.
   *    - Insert own `claiming` rows.
   *    - Re-read all active rows ('claiming', 'issued', 'needs-attention') for these SUs inside the same tx.
   *    - Re-sum effective claimed quantity oldest-first.
   *    - If sum > preIssueStock, delete own rows atomically inside the tx and throw HTTP 400.
   * 3. Falls back to memory-only when no DB is bound.
   *
   * @param {Object} params
   * @returns {Promise<string[]>} Created claim IDs
   */
  async acquireClaims({ reservationNo = '', reservationItem = '', material = '', plant = '', storageLocation = '', referenceDocument = '', items = [] }) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const suKeys = items.map((i) => String(i.storageUnit || i.StorageUnit || '').trim().toUpperCase()).filter(Boolean);
    await this._keyLock.acquire(suKeys);

    try {
      const nowIso = new Date().toISOString();
      const rows = items.map((item) => ({
        ID: (cds.utils && cds.utils.uuid) ? cds.utils.uuid() : `SU-CLAIM-${Date.now()}-${Math.random()}`,
        MaterialDocument: '',
        MaterialDocYear: '',
        ReservationNo: String(reservationNo || '').trim(),
        ReservationItem: String(reservationItem || '').trim(),
        ReferenceDocument: String(referenceDocument || '').trim(),
        StorageUnit: String(item.storageUnit || item.StorageUnit || '').trim().toUpperCase(),
        Material: String(material || '').trim().toUpperCase(),
        Plant: String(plant || '').trim().toUpperCase(),
        StorageLocation: String(storageLocation || '').trim().toUpperCase(),
        IssuedQty: Math.round(Number(item.issuedQty != null ? item.issuedQty : item.IssuedQty || 0) * 1000) / 1000,
        PreIssueStock: Math.round(Number(item.preIssueStock != null ? item.preIssueStock : item.PreIssueStock || 0) * 1000) / 1000,
        Status: 'claiming',
        createdAt: nowIso, CreatedAt: nowIso, ReleasedAt: null, ReleaseReason: '',
        NeedsAttention: false, ManualResolveAction: ''
      }));

      const ownIds = rows.map((r) => r.ID);
      const claimedSuList = rows.map((r) => r.StorageUnit);
      const sortedSuKeys = [...new Set(claimedSuList)].sort();

      if (this.db) {
        let conflictInfo = null;

        try {
          await this._runInTx(async (tx) => {
            // STEP 0: Lock a per-SU row in GoodsIssueSuLock before the re-sum.
            // Transaction Isolation Level: READ COMMITTED (CAP default for HANA, SQLite, Postgres).
            // Under READ COMMITTED, concurrent transactions cannot see each other's uncommitted rows.
            // Acquiring an exclusive row lock on GoodsIssueSuLock (in alphabetical StorageUnit order
            // to prevent deadlocks) serializes claim evaluation for the same SU. A concurrent
            // transaction will block attempting to lock the same row. When this transaction commits,
            // the second transaction unblocks and its re-sum immediately sees the newly-committed
            // claiming rows.
            for (const su of sortedSuKeys) {
              try {
                await tx.run(INSERT.into(SU_LOCK_ENTITY).entries({ StorageUnit: su, LockVersion: 1, updatedAt: nowIso }));
              } catch (insertErr) {
                // Unique-key violation on concurrent first claim: retry as UPDATE
                await tx.run(UPDATE(SU_LOCK_ENTITY).set('LockVersion = LockVersion + 1', { updatedAt: nowIso }).where({ StorageUnit: su }));
              }
            }

            // Step 1: Insert own claiming rows
            await tx.run(INSERT.into(ISSUED_SU_ENTITY).entries(rows));

            // Step 2: Re-read all active rows for these SUs inside the same tx
            const allActive = await tx.run(
              SELECT.from(ISSUED_SU_ENTITY).where({ Status: { in: ['claiming', 'issued', 'needs-attention'] }, StorageUnit: { in: claimedSuList } })
            );

            // Step 3: Verify total claimed qty does not exceed preIssueStock per SU
            for (const row of rows) {
              const su = row.StorageUnit;
              const suRows = (Array.isArray(allActive) ? allActive : []).filter((r) => r.StorageUnit === su);
              const sortedClaims = [...suRows].sort((a, b) =>
                new Date(a.createdAt || a.CreatedAt || 0).getTime() - new Date(b.createdAt || b.CreatedAt || 0).getTime()
              );

              let toDeductedAllocated = 0;
              let totalClaimed = 0;
              for (const claim of sortedClaims) {
                const { effectiveClaim, toDeductedUsed } = GoodsIssueIssuedSuStore.calculateEffectiveClaimWithAllocation(claim, row.PreIssueStock, toDeductedAllocated);
                toDeductedAllocated = Math.round((toDeductedAllocated + toDeductedUsed) * 1000) / 1000;
                totalClaimed = Math.round((totalClaimed + effectiveClaim) * 1000) / 1000;
              }

              if (totalClaimed > row.PreIssueStock + 0.001) {
                // Atomically delete own rows inside tx
                await tx.run(DELETE.from(ISSUED_SU_ENTITY).where({ ID: { in: ownIds } }));

                const ownQty = rows.filter((r) => r.StorageUnit === su).reduce((s, r) => s + r.IssuedQty, 0);
                const otherClaimed = Math.round((totalClaimed - ownQty) * 1000) / 1000;
                conflictInfo = {
                  claimedSu: su,
                  currentStock: row.PreIssueStock,
                  totalClaimed: otherClaimed,
                  requestedQty: ownQty,
                  availableStock: Math.max(0, Math.round((row.PreIssueStock - otherClaimed) * 1000) / 1000)
                };
                break;
              }
            }
          });
        } catch (dbErr) {
          if (!conflictInfo) {
            // Real DB error: fallback to memory-only
            LOG.warn('DB tx failed for claiming rows, falling back to memory:', dbErr.message || dbErr);
            const memConflict = await this.checkConcurrentClaims(items);
            if (memConflict.hasClaim) {
              const e = new Error(`Storage Unit ${memConflict.claimedSu} is currently claimed in an active Goods Issue (available: ${memConflict.availableStock || 0}, requested: ${memConflict.requestedQty || 0}, already claimed: ${memConflict.totalClaimed || 0}). Goods Issue was NOT posted.`);
              e.status = 400;
              throw e;
            }
            for (const r of rows) this._memoryStore.set(r.ID, r);
            return ownIds;
          }
        }

        if (conflictInfo) {
          const err = new Error(`Storage Unit ${conflictInfo.claimedSu} is currently claimed in an active Goods Issue (available: ${conflictInfo.availableStock}, requested: ${conflictInfo.requestedQty}, already claimed: ${conflictInfo.totalClaimed}). Goods Issue was NOT posted.`);
          err.status = 400;
          throw err;
        }

        for (const r of rows) this._memoryStore.set(r.ID, r);
        LOG.info(`Acquired ${rows.length} 'claiming' row(s) before SAP call`);
        return ownIds;
      }

      // No DB: memory-only with in-process mutex
      const memConflict = await this.checkConcurrentClaims(items);
      if (memConflict.hasClaim) {
        const err = new Error(`Storage Unit ${memConflict.claimedSu} is currently claimed in an active Goods Issue (available: ${memConflict.availableStock || 0}, requested: ${memConflict.requestedQty || 0}, already claimed: ${memConflict.totalClaimed || 0}). Goods Issue was NOT posted.`);
        err.status = 400;
        throw err;
      }
      for (const r of rows) this._memoryStore.set(r.ID, r);
      return ownIds;
    } finally {
      this._keyLock.release(suKeys);
    }
  }

  /**
   * Atomic 2-Phase Claim: Step 2a (Promote on Success)
   * Promotes `claiming` rows to `issued` with the material document.
   */
  async promoteClaims(claimIds = [], { materialDocument, materialDocYear = '' }) {
    if (!Array.isArray(claimIds) || claimIds.length === 0 || !materialDocument) return;
    const sDoc = String(materialDocument).trim();
    const sYear = String(materialDocYear || '').trim();

    for (const id of claimIds) {
      const rec = this._memoryStore.get(id);
      if (rec) {
        rec.Status = 'issued';
        rec.MaterialDocument = sDoc;
        rec.MaterialDocYear = sYear;
        rec.NeedsAttention = false;
        this._memoryStore.set(id, rec);
      }
    }

    if (this.db) {
      try {
        await this._run(UPDATE(ISSUED_SU_ENTITY).set({ Status: 'issued', MaterialDocument: sDoc, MaterialDocYear: sYear, NeedsAttention: false }).where({ ID: { in: claimIds } }));
        LOG.info(`Promoted ${claimIds.length} row(s) to 'issued' for MatDoc ${sDoc}/${sYear}`);
      } catch (err) { LOG.warn('DB update failed to promote claiming rows:', err.message || err); }
    }
  }

  /**
   * Atomic 2-Phase Claim: Step 2b (Delete on DEFINITIVE rejection only)
   *
   * DEFAULT is "keep" (definitive: false). Deletion requires explicit { definitive: true }.
   * Call with { definitive: true } ONLY when SAP returned a definitive rejection
   * (HTTP 400/409/422 or never-reached 404/503/ECONNREFUSED/DNS — document was NOT posted).
   * For UNKNOWN outcomes (504, timeout, network reset, 2xx without document number),
   * the `claiming` row is kept for the release job to resolve.
   *
   * @param {string[]} claimIds
   * @param {Object} [options]
   * @param {boolean} [options.definitive=false] Default is FALSE ("keep"). Deletion requires explicit true.
   */
  async deleteClaims(claimIds = [], { definitive = false } = {}) {
    if (!Array.isArray(claimIds) || claimIds.length === 0) return;
    if (definitive !== true) {
      LOG.info(`Leaving ${claimIds.length} 'claiming' row(s) intact — default keep; release job will resolve`);
      return;
    }

    for (const id of claimIds) this._memoryStore.delete(id);

    if (this.db) {
      try {
        await this._run(DELETE.from(ISSUED_SU_ENTITY).where({ ID: { in: claimIds } }));
        LOG.info(`Deleted ${claimIds.length} claiming row(s) after definitive rejection`);
      } catch (err) { LOG.warn('DB delete failed for claiming rows:', err.message || err); }
    }
  }

  /**
   * Writes issued SU records directly (queue replay or direct recording).
   */
  async recordIssuedSUs({ materialDocument, materialDocYear, reservationNo, reservationItem, referenceDocument = '', material, plant, storageLocation, items = [] }) {
    if (!materialDocument) throw new Error('MaterialDocument is required to record issued Storage Units.');

    const nowIso = new Date().toISOString();
    const rows = items.map((item) => ({
      ID: (cds.utils && cds.utils.uuid) ? cds.utils.uuid() : `SU-CLAIM-${Date.now()}-${Math.random()}`,
      MaterialDocument: String(materialDocument || '').trim(),
      MaterialDocYear: String(materialDocYear || '').trim(),
      ReservationNo: String(reservationNo || '').trim(),
      ReservationItem: String(reservationItem || '').trim(),
      ReferenceDocument: String(referenceDocument || '').trim(),
      StorageUnit: String(item.storageUnit || item.StorageUnit || '').trim().toUpperCase(),
      Material: String(material || '').trim().toUpperCase(),
      Plant: String(plant || '').trim().toUpperCase(),
      StorageLocation: String(storageLocation || '').trim().toUpperCase(),
      IssuedQty: Math.round(Number(item.issuedQty != null ? item.issuedQty : item.IssuedQty || 0) * 1000) / 1000,
      PreIssueStock: Math.round(Number(item.preIssueStock != null ? item.preIssueStock : item.PreIssueStock || 0) * 1000) / 1000,
      Status: 'issued',
      createdAt: nowIso, CreatedAt: nowIso, ReleasedAt: null, ReleaseReason: '',
      NeedsAttention: false, ManualResolveAction: ''
    }));

    if (rows.length === 0) return [];
    for (const r of rows) this._memoryStore.set(r.ID, r);

    if (this.db) {
      try {
        await this._run(INSERT.into(ISSUED_SU_ENTITY).entries(rows));
        LOG.info(`Recorded ${rows.length} issued SUs for MatDoc ${materialDocument}/${materialDocYear}`);
      } catch (err) { LOG.warn(`DB insert failed for issued SUs, kept in memory: ${err.message}`); }
    }

    return rows;
  }

  /**
   * Retrieves active ('issued', 'claiming', or 'needs-attention') records for material/plant/sloc.
   */
  async getActiveIssuedSUs(material, plant, storageLocation) {
    const sMat = material ? String(material).trim().toUpperCase() : null;
    const sPlt = plant ? String(plant).trim().toUpperCase() : null;
    const sLoc = storageLocation ? String(storageLocation).trim().toUpperCase() : null;

    let dbRows = [];
    if (this.db) {
      try {
        const where = { Status: { in: ['issued', 'claiming', 'needs-attention'] } };
        if (sMat) where.Material = sMat;
        if (sPlt) where.Plant = sPlt;
        if (sLoc) where.StorageLocation = sLoc;
        const rows = await this._run(SELECT.from(ISSUED_SU_ENTITY).where(where));
        if (Array.isArray(rows)) dbRows = rows;
      } catch (err) { LOG.warn('DB select failed for active SUs, falling back to memory:', err.message || err); }
    }

    const rowMap = new Map();
    for (const r of dbRows) rowMap.set(r.ID, r);
    for (const record of this._memoryStore.values()) {
      if (!['issued', 'claiming', 'needs-attention'].includes(record.Status)) continue;
      if (sMat && record.Material !== sMat) continue;
      if (sPlt && record.Plant !== sPlt) continue;
      if (sLoc && record.StorageLocation !== sLoc) continue;
      rowMap.set(record.ID, record);
    }

    return Array.from(rowMap.values());
  }

  /**
   * Releases an issued SU record by ID.
   */
  async release(id, reason = '') {
    if (!id) return;

    for (const [key, rec] of this._memoryStore.entries()) {
      if (rec.ID === id || rec.StorageUnit === id) {
        rec.Status = 'released'; rec.ReleasedAt = new Date().toISOString();
        rec.ReleaseReason = String(reason || 'MANUAL_RELEASE').slice(0, 50);
        rec.NeedsAttention = false;
        this._memoryStore.set(key, rec);
      }
    }

    if (this.db) {
      try {
        await this._run(UPDATE(ISSUED_SU_ENTITY).set({ Status: 'released', ReleasedAt: new Date().toISOString(), ReleaseReason: String(reason || 'MANUAL_RELEASE').slice(0, 50), NeedsAttention: false }).where({ ID: id }));
      } catch (err) { LOG.warn(`DB update failed to release claim ${id}: ${err.message}`); }
    }
  }

  /**
   * Purges stale advisory lock rows from GoodsIssueSuLock.
   * A lock row is considered stale if:
   *   1. The StorageUnit has no active claims in GoodsIssueIssuedStorageUnit ('claiming', 'issued', 'needs-attention').
   *   2. AND its updatedAt timestamp is older than maxAgeMs (default: 24h = 86,400,000 ms, or caller specified).
   *
   * @param {Object} [options]
   * @param {number} [options.maxAgeMs]
   * @returns {Promise<number>} Number of purged lock rows
   */
  async purgeStaleLocks(options = {}) {
    const maxAgeMs = options.maxAgeMs !== undefined ? options.maxAgeMs : envMs('GI_SU_LOCK_PURGE_MAX_AGE_MS', 86400000);
    const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();

    if (!this.db) {
      return 0;
    }

    try {
      return await this._runInTx(async (tx) => {
        const activeClaims = await tx.run(
          SELECT.from(ISSUED_SU_ENTITY).columns('StorageUnit').where({ Status: { in: ['claiming', 'issued', 'needs-attention'] } })
        );
        const activeSus = new Set(
          (Array.isArray(activeClaims) ? activeClaims : [])
            .map((c) => String(c.StorageUnit || '').trim().toUpperCase())
            .filter(Boolean)
        );

        const candidateLocks = await tx.run(
          SELECT.from(SU_LOCK_ENTITY).where({ updatedAt: { '<': cutoffIso } })
        );
        const locksToPurge = (Array.isArray(candidateLocks) ? candidateLocks : []).filter(
          (l) => !activeSus.has(String(l.StorageUnit || '').trim().toUpperCase())
        );

        if (locksToPurge.length === 0) return 0;

        const susToDelete = locksToPurge.map((l) => l.StorageUnit);
        await tx.run(DELETE.from(SU_LOCK_ENTITY).where({ StorageUnit: { in: susToDelete } }));
        LOG.info(`Purged ${susToDelete.length} stale lock row(s) from GoodsIssueSuLock`);
        return susToDelete.length;
      });
    } catch (err) {
      LOG.warn(`purgeStaleLocks error: ${err.message}`);
      return 0;
    }
  }

  /**
   * Manual resolution of a claim in needs-attention status by an operator.
   * On 'posted': verifies the document in MATDOC (261, same reservation/item, not linked to another claim).
   * On 'not-posted': sets status released with reason/user/time instead of deleting.
   *
   * @param {string} claimId
   * @param {'posted'|'not-posted'} action
   * @param {Object} [options]
   * @param {string} [options.materialDocument]
   * @param {string} [options.materialDocYear]
   * @param {string} [options.reason]
   * @param {string} [options.user]
   * @param {Object} [options.adapter]
   * @returns {Promise<Object>} The resolved record
   */
  async resolveClaimManual(claimId, action, options = {}) {
    if (!claimId) {
      const err = new Error('claimId is required');
      err.status = 400;
      throw err;
    }
    const act = String(action || '').trim().toLowerCase();
    if (act !== 'posted' && act !== 'not-posted') {
      const err = new Error(`Invalid resolve action "${action}". Must be "posted" or "not-posted".`);
      err.status = 400;
      throw err;
    }

    let existing = this._memoryStore.get(claimId);
    if (!existing && this.db) {
      try {
        const rows = await this._run(SELECT.from(ISSUED_SU_ENTITY).where({ ID: claimId }));
        if (Array.isArray(rows) && rows.length > 0) existing = rows[0];
      } catch (e) { /* ignore */ }
    }
    if (!existing) {
      const err = new Error(`Claim ${claimId} not found`);
      err.status = 404;
      throw err;
    }

    if (act === 'posted') {
      const matDoc = String(options.materialDocument || existing.MaterialDocument || '').trim();
      const matYear = String(options.materialDocYear || existing.MaterialDocYear || '').trim();
      if (!matDoc) {
        const err = new Error('materialDocument is required for action "posted"');
        err.status = 400;
        throw err;
      }

      // 1. Verify not linked to another claim
      let duplicateClaim = null;
      if (this.db) {
        try {
          const other = await this._run(
            SELECT.from(ISSUED_SU_ENTITY).where({
              MaterialDocument: matDoc,
              MaterialDocYear: matYear,
              ID: { '!=': claimId },
              Status: { in: ['issued', 'needs-attention'] }
            })
          );
          if (Array.isArray(other) && other.length > 0) duplicateClaim = other[0];
        } catch (_) { /* ignore */ }
      }
      if (!duplicateClaim) {
        for (const [id, r] of this._memoryStore.entries()) {
          if (id !== claimId && r.MaterialDocument === matDoc && String(r.MaterialDocYear) === String(matYear) && ['issued', 'needs-attention'].includes(r.Status)) {
            duplicateClaim = r;
            break;
          }
        }
      }
      if (duplicateClaim) {
        const err = new Error(`Material document ${matDoc}/${matYear} is already linked to claim ${duplicateClaim.ID}`);
        err.status = 422;
        throw err;
      }

      // 2. Verify the document in MATDOC (261, same reservation/item)
      const adapter = options.adapter || this.adapter;
      const readTable = (adapter && typeof adapter.readTable === 'function')
        ? (t, f, w) => adapter.readTable(t, f, w)
        : (adapter && adapter.client && typeof adapter.client.readTable === 'function')
          ? (t, f, w) => adapter.client.readTable(t, f, w)
          : null;

      if (readTable) {
        const docFields = ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'RSNUM', 'RSPOS'];
        const docWhere = [`MBLNR = '${matDoc}'`, `AND MJAHR = '${matYear}'`];
        let docRows = [];
        try {
          docRows = await readTable('MATDOC', docFields, docWhere);
        } catch (matErr) {
          try {
            docRows = await readTable('MSEG', docFields, docWhere);
          } catch (msegErr) {
            const err = new Error(`Failed to verify document ${matDoc} in SAP: ${matErr.message}`);
            err.status = 502;
            throw err;
          }
        }

        if (!Array.isArray(docRows) || docRows.length === 0) {
          const err = new Error(`Material document ${matDoc}/${matYear} not found in SAP MATDOC/MSEG`);
          err.status = 422;
          throw err;
        }

        const has261 = docRows.some((r) => String(r.BWART).trim() === '261');
        if (!has261) {
          const err = new Error(`Material document ${matDoc}/${matYear} has movement type ${docRows[0].BWART}, expected 261`);
          err.status = 422;
          throw err;
        }

        const sResv = String(existing.ReservationNo || '').trim().padStart(10, '0');
        const sItem = String(existing.ReservationItem || '').trim().padStart(4, '0');
        const matchesResvItem = docRows.some((r) => {
          const rResv = String(r.RSNUM || '').trim().padStart(10, '0');
          const rItem = String(r.RSPOS || '').trim().padStart(4, '0');
          return rResv === sResv && rItem === sItem && String(r.BWART).trim() === '261';
        });

        if (!matchesResvItem) {
          const err = new Error(`Material document ${matDoc}/${matYear} does not match claim reservation ${existing.ReservationNo} item ${existing.ReservationItem}`);
          err.status = 422;
          throw err;
        }
      }

      const updates = {
        Status: 'issued',
        NeedsAttention: false,
        ManualResolveAction: 'posted',
        MaterialDocument: matDoc,
        MaterialDocYear: matYear
      };
      Object.assign(existing, updates);
      this._memoryStore.set(claimId, existing);
      if (this.db) {
        await this._run(UPDATE(ISSUED_SU_ENTITY).set(updates).where({ ID: claimId }));
      }
      LOG.info(`Claim ${claimId} manually resolved as 'posted' (MatDoc: ${matDoc}/${matYear})`);
      return existing;
    } else {
      // 'not-posted': set status released with reason/user/time instead of deleting
      const nowIso = new Date().toISOString();
      const user = options.user ? String(options.user).trim() : '';
      const reason = options.reason || (user ? `MANUAL_NOT_POSTED by ${user}` : 'MANUAL_NOT_POSTED');
      const updates = {
        Status: 'released',
        NeedsAttention: false,
        ManualResolveAction: 'not-posted',
        ReleaseReason: String(reason).slice(0, 50),
        ReleasedAt: nowIso
      };
      Object.assign(existing, updates);
      this._memoryStore.set(claimId, existing);
      if (this.db) {
        await this._run(UPDATE(ISSUED_SU_ENTITY).set(updates).where({ ID: claimId }));
      }
      LOG.info(`Claim ${claimId} manually resolved as 'not-posted' — status set to 'released' (reason=${reason})`);
      return existing;
    }
  }

  /**
   * Reconciliation / Release Job.
   *
   * 1. Stale `claiming` or `needs-attention` rows:
   *    - Step 1: ReferenceDocument lookup in SAP:
   *        found   -> promote to 'issued'
   *    - Step 2: MATDOC fallback lookup for 261 (reservation + item + user + date + quantity + createdAt):
   *        found   -> promote to 'issued'
   *    - Step 3: If lookup threw network error -> leave intact (cannot prove not-posted)
   *    - Step 4: If past needsAttentionThreshold without conclusive proof -> mark 'needs-attention'
   *              with visible flag for manual operator resolution (posted / not posted).
   *    - For claims already in `needs-attention`: keeps re-checking on every cycle and auto-resolves
   *      to 'issued' as soon as the document appears in SAP.
   *
   * 2. Active `issued` rows:
   *    - LQUA stock <= preIssueStock - issuedQty -> release (LQUA_STOCK_REDUCED)
   *    - Quant missing from LQUA                 -> release (LQUA_QUANT_DELETED)
   *    - MSEG reversal document                  -> release (MATERIAL_DOCUMENT_REVERSED)
   *    - RFC/network error                       -> leave unchanged (logged)
   *
   * 3. Stale locks cleanup:
   *    - Calls purgeStaleLocks to delete advisory lock rows for SUs that have no active claims.
   *
   * @param {Object} adapter
   * @param {Object} [options]
   * @param {number} [options.now]
   * @param {number} [options.staleClaimAgeMs]
   * @param {number} [options.needsAttentionAgeMs]
   * @returns {Promise<{ inspected: number, released: number, resolvedClaiming: number, errors: number }>}
   */
  async releaseByLquaDropOrReversal(adapter, options = {}) {
    const now = options.now || Date.now();
    const staleAgeThreshold = options.staleClaimAgeMs !== undefined ? options.staleClaimAgeMs : GoodsIssueIssuedSuStore.staleClaimAgeMs();
    const needsAttentionThreshold = options.needsAttentionAgeMs !== undefined ? options.needsAttentionAgeMs : GoodsIssueIssuedSuStore.needsAttentionAgeMs();

    const activeRows = await this.getActiveIssuedSUs();
    if (!Array.isArray(activeRows) || activeRows.length === 0) {
      await this.purgeStaleLocks();
      return { inspected: 0, released: 0, resolvedClaiming: 0, errors: 0 };
    }

    let releasedCount = 0, resolvedClaimingCount = 0, errorCount = 0;

    for (const row of activeRows) {
      try {
        // --- 1. Stale claiming or needs-attention row ---
        if (row.Status === 'claiming' || row.Status === 'needs-attention') {
          const rowAge = now - new Date(row.createdAt || row.CreatedAt || now).getTime();
          // Always re-check needs-attention claims; for claiming, check when age >= staleAgeThreshold
          if (row.Status === 'needs-attention' || rowAge >= staleAgeThreshold) {
            let foundDoc = null;
            let lookupFailed = false;

            // Step 1: Idempotency reference lookup
            if (row.ReferenceDocument && adapter && typeof adapter.findPostedGoodsIssueByReference === 'function') {
              try { foundDoc = await adapter.findPostedGoodsIssueByReference(row.ReferenceDocument, '261'); }
              catch (lookupErr) { lookupFailed = true; LOG.warn(`Lookup error for ref ${row.ReferenceDocument}: ${lookupErr.message}. Row left intact.`); }
            } else if (row.MaterialDocument) {
              foundDoc = { MaterialDocument: row.MaterialDocument, MaterialDocYear: row.MaterialDocYear };
            }

            // Step 2: MATDOC fallback lookup for 261 (reservation + item + user + date + quantity + createdAt)
            if (!foundDoc && !lookupFailed && row.ReservationNo && row.ReservationItem && adapter) {
              const matdocLookup = adapter.findPosted261ByMatdoc || adapter.findPostedGoodsIssueByMatdoc;
              if (typeof matdocLookup === 'function') {
                try {
                  foundDoc = await matdocLookup.call(adapter, {
                    reservationNo: row.ReservationNo,
                    reservationItem: row.ReservationItem,
                    user: row.createdBy || row.CreatedBy || '',
                    date: row.createdAt || row.CreatedAt || now,
                    createdAt: row.createdAt || row.CreatedAt || now,
                    quantity: row.IssuedQty
                  });
                } catch (matdocErr) {
                  lookupFailed = true;
                  LOG.warn(`MATDOC 261 fallback lookup error for claim ${row.ID}: ${matdocErr.message}. Row left intact.`);
                }
              }
            }

            if (lookupFailed) { errorCount++; continue; }

            if (foundDoc && foundDoc.MaterialDocument) {
              // Document appeared! Auto-resolve to 'issued':
              await this.promoteClaims([row.ID], {
                materialDocument: foundDoc.MaterialDocument,
                materialDocYear: foundDoc.MaterialDocumentYear || foundDoc.MaterialDocYear
              });
              if (row.NeedsAttention || row.Status === 'needs-attention') {
                row.NeedsAttention = false;
                row.Status = 'issued';
                if (this.db) {
                  try {
                    await this._run(UPDATE(ISSUED_SU_ENTITY).set({ NeedsAttention: false, Status: 'issued', ManualResolveAction: 'auto-resolved' }).where({ ID: row.ID }));
                  } catch (_) {}
                }
              }
              resolvedClaimingCount++;
              LOG.info(`Claim ${row.ID} (${row.Status}) auto-resolved as 'issued' with MatDoc ${foundDoc.MaterialDocument}`);
            } else if (row.Status === 'needs-attention') {
              // Still not found: keep re-checking on next run; leave in needs-attention
              LOG.debug && LOG.debug(`Needs-attention claim ${row.ID} re-checked; document not yet in SAP. Remaining needs-attention.`);
            } else if (row.ReferenceDocument && !lookupFailed) {
              // Conclusively not found in SAP by reference
              await this.deleteClaims([row.ID], { definitive: true });
              resolvedClaimingCount++;
              LOG.info(`Stale claiming row ${row.ID} deleted: not found in SAP after ${Math.round(rowAge / 1000)}s`);
            } else {
              // No ReferenceDocument or unprovable:
              // Claims past the threshold become needs-attention with visible flag and manual resolve action.
              if (rowAge >= needsAttentionThreshold) {
                row.Status = 'needs-attention';
                row.NeedsAttention = true;
                this._memoryStore.set(row.ID, row);
                if (this.db) {
                  try {
                    await this._run(UPDATE(ISSUED_SU_ENTITY).set({ Status: 'needs-attention', NeedsAttention: true }).where({ ID: row.ID }));
                  } catch (upErr) {
                    LOG.warn(`DB update to needs-attention failed for claim ${row.ID}: ${upErr.message}`);
                  }
                }
                LOG.info(`Stale claiming row ${row.ID} marked needs-attention (unconfirmed outcome after ${Math.round(rowAge / 1000)}s)`);
                resolvedClaimingCount++;
              } else {
                LOG.warn(`Stale claiming row ${row.ID}: no ReferenceDocument or MaterialDocument — cannot prove not-posted; left intact.`);
                errorCount++;
              }
            }
          }
          continue;
        }

        // --- 2. Active 'issued' row ---
        if (row.Status === 'issued') {
          let shouldRelease = false, releaseReason = '';

          const readTable = (adapter && typeof adapter.readTable === 'function')
            ? (t, f, w) => adapter.readTable(t, f, w)
            : (adapter && adapter.client && typeof adapter.client.readTable === 'function')
              ? (t, f, w) => adapter.client.readTable(t, f, w)
              : null;

          if (readTable) {
            const suPadded = /^\d+$/.test(row.StorageUnit) ? row.StorageUnit.padStart(20, '0') : row.StorageUnit;
            const lquaWhere = [`LENUM = '${suPadded}'`];
            if (row.Plant) lquaWhere.push(`AND WERKS = '${row.Plant}'`);

            try {
              const lquaRows = await readTable('LQUA', ['LENUM', 'VERME', 'LGTYP'], lquaWhere);
              const nonInterim = (Array.isArray(lquaRows) ? lquaRows : []).filter((q) => !/^9/.test(q.LGTYP || ''));
              if (nonInterim.length === 0) { shouldRelease = true; releaseReason = 'LQUA_QUANT_DELETED'; }
              else {
                const currentStock = nonInterim.reduce((sum, q) => sum + (Number(q.VERME) || 0), 0);
                const expectedMax = Math.round((Number(row.PreIssueStock) - Number(row.IssuedQty)) * 1000) / 1000;
                if (currentStock <= expectedMax + 0.001) { shouldRelease = true; releaseReason = 'LQUA_STOCK_REDUCED'; }
              }
            } catch (lquaErr) { LOG.warn(`LQUA lookup error for SU ${row.StorageUnit}: ${lquaErr.message}`); }

            if (!shouldRelease && row.MaterialDocument) {
              try {
                const msegWhere = [`SMBLN = '${row.MaterialDocument}'`];
                if (row.MaterialDocYear) {
                  msegWhere.push(`AND SJAHR = '${row.MaterialDocYear}'`);
                }
                const msegRows = await readTable('MSEG', ['MBLNR', 'BWART'], msegWhere);
                if (Array.isArray(msegRows) && msegRows.length > 0) { shouldRelease = true; releaseReason = 'MATERIAL_DOCUMENT_REVERSED'; }
              } catch (msegErr) { LOG.warn(`MSEG reversal lookup error for MatDoc ${row.MaterialDocument}: ${msegErr.message}`); }
            }
          }

          if (shouldRelease) {
            await this.release(row.ID, releaseReason);
            releasedCount++;
            LOG.info(`Released SU ${row.StorageUnit} (Claim ${row.ID}) reason=${releaseReason}`);
          }
        }
      } catch (rowErr) {
        errorCount++;
        LOG.warn(`Release evaluation error for claim ${row.ID}: ${rowErr.message}. Status left unchanged.`);
      }
    }

    return { inspected: activeRows.length, released: releasedCount, resolvedClaiming: resolvedClaimingCount, errors: errorCount };
  }
}

const defaultInstance = new GoodsIssueIssuedSuStore();
defaultInstance.GoodsIssueIssuedSuStore = GoodsIssueIssuedSuStore;
defaultInstance.AsyncKeyLock = AsyncKeyLock;
defaultInstance.isNeverReachedError = GoodsIssueIssuedSuStore.isNeverReachedError;
defaultInstance.isDefinitiveRejection = GoodsIssueIssuedSuStore.isDefinitiveRejection;
defaultInstance.calculateEffectiveClaimWithAllocation = GoodsIssueIssuedSuStore.calculateEffectiveClaimWithAllocation;
defaultInstance.calculateEffectiveClaim = GoodsIssueIssuedSuStore.calculateEffectiveClaim;
module.exports = defaultInstance;
