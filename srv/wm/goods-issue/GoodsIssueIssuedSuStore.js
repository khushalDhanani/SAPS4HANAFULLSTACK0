'use strict';

const cds = require('@sap/cds');
const LOG = require('../../common/logger')('issued-su-store');

const ISSUED_SU_ENTITY = 'saps4hana.wm.GoodsIssueIssuedStorageUnit';

function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== '' ? n : fallback;
}

/**
 * AsyncKeyLock
 * In-memory FIFO lock per StorageUnit key to serialize concurrent claim attempts
 * in Node.js event loop and eliminate race conditions during Promise.all.
 */
class AsyncKeyLock {
  constructor() {
    this._locks = new Map();
  }

  async acquire(keys = []) {
    const sortedKeys = [...new Set(keys.map((k) => String(k || '').trim().toUpperCase()))].filter(Boolean).sort();
    for (const key of sortedKeys) {
      while (this._locks.has(key)) {
        await this._locks.get(key);
      }
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
      if (lock) {
        this._locks.delete(key);
        lock.resolve();
      }
    }
  }
}

class GoodsIssueIssuedSuStore {
  /**
   * @param {Object} [options]
   * @param {Object|null} [options.db] - Database service to use (for testing); defaults to cds.db
   */
  constructor(options = {}) {
    this._dbProvider = options.db !== undefined ? () => options.db : () => cds.db;
    this._memoryStore = new Map(); // ID -> record
    this._keyLock = new AsyncKeyLock();
  }

  get db() {
    return this._dbProvider() || null;
  }

  isAvailable() {
    return Boolean(this.db) || this._memoryStore.size >= 0;
  }

  /** Age after which a `claiming` row with no known outcome is checked against SAP (default 5 min). */
  static staleClaimAgeMs() {
    return envMs('GI_CLAIMING_STALE_AGE_MS', 300000);
  }

  /** Interval of the background SU release / reconciliation job (default 1 min; 0 disables it). */
  static releaseIntervalMs() {
    return envMs('GI_SU_RELEASE_INTERVAL_MS', 60000);
  }

  _run(query) {
    const db = this.db;
    if (!db) {
      const err = new Error('Issued Storage Unit store is not available: no database is bound.');
      err.status = 503;
      throw err;
    }
    return db.tx({ user: cds.User.privileged }, (tx) => tx.run(query));
  }

  /** Clear all rows (useful in test suites). */
  async clear() {
    this._memoryStore.clear();
    if (this.db) {
      try {
        await this._run(DELETE.from(ISSUED_SU_ENTITY));
      } catch (e) {
        // Table might not exist in unit test in-memory mock
      }
    }
  }

  /**
   * Calculates the effective claim against current LQUA stock:
   * effectiveClaim = max(0, claimed - (preIssueStock - currentStock))
   *
   * @param {Object} claim - Claim record { IssuedQty, PreIssueStock }
   * @param {number|null} [currentStock] - Current stock in LQUA
   * @returns {number}
   */
  static calculateEffectiveClaim(claim, currentStock = null) {
    const claimed = Math.round(Number(claim.IssuedQty || 0) * 1000) / 1000;
    if (currentStock === null || currentStock === undefined) {
      return claimed;
    }
    const preStock = Number(claim.PreIssueStock != null ? claim.PreIssueStock : currentStock);
    const toDeducted = Math.max(0, preStock - Number(currentStock));
    const effective = Math.max(0, claimed - toDeducted);
    return Math.round(effective * 1000) / 1000;
  }

  /**
   * Quantity-based concurrent claims check:
   * claimed + requested <= current LQUA stock for that SU.
   * A partial residual stays claimable. Active claims are rows with status 'claiming' or 'issued'.
   *
   * @param {Array<string|{ storageUnit: string, requestedQty?: number, currentStock?: number, preIssueStock?: number }>} itemsOrUnits
   * @returns {Promise<{ hasClaim: boolean, claimedSu?: string, currentStock?: number, totalClaimed?: number, requestedQty?: number, availableStock?: number, record?: Object }>}
   */
  async checkConcurrentClaims(itemsOrUnits = []) {
    if (!Array.isArray(itemsOrUnits) || itemsOrUnits.length === 0) {
      return { hasClaim: false };
    }

    const items = itemsOrUnits.map((item) => {
      if (typeof item === 'string') {
        return {
          storageUnit: String(item).trim().toUpperCase(),
          requestedQty: null,
          currentStock: null
        };
      }
      return {
        storageUnit: String(item.storageUnit || item.StorageUnit || '').trim().toUpperCase(),
        requestedQty: item.requestedQty != null ? Number(item.requestedQty) : (item.issuedQty != null ? Number(item.issuedQty) : null),
        currentStock: item.currentStock != null ? Number(item.currentStock) : (item.preIssueStock != null ? Number(item.preIssueStock) : null)
      };
    }).filter((i) => Boolean(i.storageUnit));

    if (items.length === 0) return { hasClaim: false };

    const suList = items.map((i) => i.storageUnit);

    // Retrieve all active claims (status 'claiming' or 'issued') for these SUs
    let activeRows = [];
    if (this.db) {
      try {
        const rows = await this._run(
          SELECT.from(ISSUED_SU_ENTITY).where({
            Status: { in: ['claiming', 'issued'] },
            StorageUnit: { in: suList }
          })
        );
        if (Array.isArray(rows)) activeRows = rows;
      } catch (err) {
        LOG.warn('DB query failed for concurrent claims, falling back to memory store:', err.message || err);
      }
    }

    // Merge in-memory active claims
    const memoryActive = Array.from(this._memoryStore.values()).filter(
      (r) => ['claiming', 'issued'].includes(r.Status) && suList.includes(r.StorageUnit)
    );
    const rowMap = new Map();
    for (const r of [...activeRows, ...memoryActive]) {
      rowMap.set(r.ID, r);
    }
    const allActive = Array.from(rowMap.values());

    for (const item of items) {
      const su = item.storageUnit;
      const suClaims = allActive.filter((r) => r.StorageUnit === su);

      if (suClaims.length === 0) {
        continue;
      }

      // Determine current stock for this SU
      let curStock = item.currentStock;
      if (curStock === null || curStock === undefined) {
        // Fallback to highest PreIssueStock known
        curStock = Math.max(...suClaims.map((c) => Number(c.PreIssueStock || 0)), 0);
      }

      // Sum effective claims using TO-adjusted formula
      let totalClaimed = 0;
      for (const claim of suClaims) {
        totalClaimed += GoodsIssueIssuedSuStore.calculateEffectiveClaim(claim, curStock);
      }
      totalClaimed = Math.round(totalClaimed * 1000) / 1000;

      const reqQty = item.requestedQty !== null && item.requestedQty !== undefined
        ? Math.round(Number(item.requestedQty) * 1000) / 1000
        : Math.round(Number(curStock) * 1000) / 1000;

      // Condition: claimed + requested <= current LQUA stock
      if (totalClaimed + reqQty > curStock + 0.001) {
        const availableStock = Math.max(0, Math.round((curStock - totalClaimed) * 1000) / 1000);
        return {
          hasClaim: true,
          claimedSu: su,
          currentStock: curStock,
          totalClaimed,
          requestedQty: reqQty,
          availableStock,
          record: suClaims[0]
        };
      }
    }

    return { hasClaim: false };
  }

  /**
   * Atomic 2-Phase Claim: Step 1 (Acquire)
   * Writes `claiming` rows BEFORE the SAP call under a key mutex.
   * Parallel requests for the same drum cannot both succeed.
   *
   * @param {Object} params
   * @param {string} [params.reservationNo]
   * @param {string} [params.reservationItem]
   * @param {string} [params.material]
   * @param {string} [params.plant]
   * @param {string} [params.storageLocation]
   * @param {string} [params.referenceDocument]
   * @param {Array<{ storageUnit: string, issuedQty: number, preIssueStock: number }>} params.items
   * @returns {Promise<string[]>} Created claim IDs
   */
  async acquireClaims({
    reservationNo = '',
    reservationItem = '',
    material = '',
    plant = '',
    storageLocation = '',
    referenceDocument = '',
    items = []
  }) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const suKeys = items.map((i) => String(i.storageUnit || i.StorageUnit || '').trim().toUpperCase()).filter(Boolean);
    await this._keyLock.acquire(suKeys);

    try {
      // 1. Check quantity-based concurrent claims under lock
      const checkResult = await this.checkConcurrentClaims(items);
      if (checkResult.hasClaim) {
        const err = new Error(
          `Storage Unit ${checkResult.claimedSu} is currently claimed in an active Goods Issue (available: ${checkResult.availableStock || 0}, requested: ${checkResult.requestedQty || 0}, already claimed: ${checkResult.totalClaimed || 0}). Goods Issue was NOT posted.`
        );
        err.status = 400;
        throw err;
      }

      // 2. Persist `claiming` rows
      const nowIso = new Date().toISOString();
      const rows = items.map((item) => {
        const id = (cds.utils && cds.utils.uuid) ? cds.utils.uuid() : `SU-CLAIM-${Date.now()}-${Math.random()}`;
        return {
          ID: id,
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
          createdAt: nowIso,
          CreatedAt: nowIso,
          ReleasedAt: null,
          ReleaseReason: ''
        };
      });

      for (const r of rows) {
        this._memoryStore.set(r.ID, r);
      }

      if (this.db) {
        try {
          await this._run(INSERT.into(ISSUED_SU_ENTITY).entries(rows));
          LOG.info(`Acquired ${rows.length} 'claiming' Storage Unit rows before SAP call`);
        } catch (dbErr) {
          LOG.warn('DB insert failed for claiming rows, kept in memory store:', dbErr.message || dbErr);
        }
      }

      return rows.map((r) => r.ID);
    } finally {
      this._keyLock.release(suKeys);
    }
  }

  /**
   * Atomic 2-Phase Claim: Step 2a (Promote on Success)
   * Promotes `claiming` rows to `issued` with the material document.
   *
   * @param {string[]} claimIds
   * @param {Object} outcome
   * @param {string} outcome.materialDocument
   * @param {string} [outcome.materialDocYear]
   * @returns {Promise<void>}
   */
  async promoteClaims(claimIds = [], { materialDocument, materialDocYear = '' }) {
    if (!Array.isArray(claimIds) || claimIds.length === 0 || !materialDocument) return;

    const sDoc = String(materialDocument).trim();
    const sYear = String(materialDocYear || new Date().getFullYear()).trim();

    for (const id of claimIds) {
      const rec = this._memoryStore.get(id);
      if (rec) {
        rec.Status = 'issued';
        rec.MaterialDocument = sDoc;
        rec.MaterialDocYear = sYear;
        this._memoryStore.set(id, rec);
      }
    }

    if (this.db) {
      try {
        await this._run(
          UPDATE(ISSUED_SU_ENTITY)
            .set({
              Status: 'issued',
              MaterialDocument: sDoc,
              MaterialDocYear: sYear
            })
            .where({ ID: { in: claimIds } })
        );
        LOG.info(`Promoted ${claimIds.length} claiming rows to 'issued' for Material Document ${sDoc}/${sYear}`);
      } catch (err) {
        LOG.warn('DB update failed to promote claiming rows:', err.message || err);
      }
    }
  }

  /**
   * Atomic 2-Phase Claim: Step 2b (Delete on Failure / Rejection)
   * Deletes `claiming` rows when SAP rejects or fails the transaction.
   *
   * @param {string[]} claimIds
   * @returns {Promise<void>}
   */
  async deleteClaims(claimIds = []) {
    if (!Array.isArray(claimIds) || claimIds.length === 0) return;

    for (const id of claimIds) {
      this._memoryStore.delete(id);
    }

    if (this.db) {
      try {
        await this._run(DELETE.from(ISSUED_SU_ENTITY).where({ ID: { in: claimIds } }));
        LOG.info(`Deleted ${claimIds.length} claiming rows after post failure/rejection`);
      } catch (err) {
        LOG.warn('DB delete failed for claiming rows:', err.message || err);
      }
    }
  }

  /**
   * Writes issued SU records directly (used by queue replay or direct recording).
   *
   * @param {Object} params
   * @returns {Promise<Object[]>}
   */
  async recordIssuedSUs({
    materialDocument,
    materialDocYear,
    reservationNo,
    reservationItem,
    referenceDocument = '',
    material,
    plant,
    storageLocation,
    items = []
  }) {
    if (!materialDocument) {
      throw new Error('MaterialDocument is required to record issued Storage Units.');
    }

    const nowIso = new Date().toISOString();
    const rows = items.map((item) => ({
      ID: (cds.utils && cds.utils.uuid) ? cds.utils.uuid() : `SU-CLAIM-${Date.now()}-${Math.random()}`,
      MaterialDocument: String(materialDocument || '').trim(),
      MaterialDocYear: String(materialDocYear || new Date().getFullYear()).trim(),
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
      createdAt: nowIso,
      CreatedAt: nowIso,
      ReleasedAt: null,
      ReleaseReason: ''
    }));

    if (rows.length === 0) return [];

    for (const r of rows) {
      this._memoryStore.set(r.ID, r);
    }

    if (this.db) {
      try {
        await this._run(INSERT.into(ISSUED_SU_ENTITY).entries(rows));
        LOG.info(`Recorded ${rows.length} issued Storage Units in DB for Material Document ${materialDocument}/${materialDocYear}`);
      } catch (err) {
        LOG.warn(`DB insert failed for issued SUs, maintained in memory store: ${err.message}`);
      }
    }

    return rows;
  }

  /**
   * Retrieves active ('issued' or 'claiming') records for material/plant/sloc.
   *
   * @param {string} [material]
   * @param {string} [plant]
   * @param {string} [storageLocation]
   * @returns {Promise<Object[]>}
   */
  async getActiveIssuedSUs(material, plant, storageLocation) {
    const sMat = material ? String(material).trim().toUpperCase() : null;
    const sPlt = plant ? String(plant).trim().toUpperCase() : null;
    const sLoc = storageLocation ? String(storageLocation).trim().toUpperCase() : null;

    let dbRows = [];
    if (this.db) {
      try {
        const where = { Status: { in: ['issued', 'claiming'] } };
        if (sMat) where.Material = sMat;
        if (sPlt) where.Plant = sPlt;
        if (sLoc) where.StorageLocation = sLoc;
        const rows = await this._run(SELECT.from(ISSUED_SU_ENTITY).where(where));
        if (Array.isArray(rows)) dbRows = rows;
      } catch (err) {
        LOG.warn('DB select failed for active issued SUs, falling back to memory store:', err.message || err);
      }
    }

    const rowMap = new Map();
    for (const r of dbRows) {
      rowMap.set(r.ID, r);
    }

    for (const record of this._memoryStore.values()) {
      if (!['issued', 'claiming'].includes(record.Status)) continue;
      if (sMat && record.Material !== sMat) continue;
      if (sPlt && record.Plant !== sPlt) continue;
      if (sLoc && record.StorageLocation !== sLoc) continue;
      rowMap.set(record.ID, record);
    }

    return Array.from(rowMap.values());
  }

  /**
   * Releases an issued SU record.
   *
   * @param {string} id
   * @param {string} reason
   * @returns {Promise<void>}
   */
  async release(id, reason = '') {
    if (!id) return;

    for (const [key, rec] of this._memoryStore.entries()) {
      if (rec.ID === id || rec.StorageUnit === id) {
        rec.Status = 'released';
        rec.ReleasedAt = new Date().toISOString();
        rec.ReleaseReason = String(reason || 'MANUAL_RELEASE').slice(0, 50);
        this._memoryStore.set(key, rec);
      }
    }

    if (this.db) {
      try {
        await this._run(
          UPDATE(ISSUED_SU_ENTITY)
            .set({
              Status: 'released',
              ReleasedAt: new Date().toISOString(),
              ReleaseReason: String(reason || 'MANUAL_RELEASE').slice(0, 50)
            })
            .where({ ID: id })
        );
      } catch (err) {
        LOG.warn(`DB update failed to release claim ${id}: ${err.message}`);
      }
    }
  }

  /**
   * Reconciliation / Release Job:
   *  1. Resolves stale `claiming` rows older than staleClaimAgeMs:
   *     checks SAP for material document; found -> promote to 'issued', not found -> delete.
   *  2. Resolves active `issued` rows:
   *     - When LQUA stock <= preIssueStock - issuedQty (TO confirmed). Missing quant in LQUA counts as released.
   *     - When Material Document was reversed in SAP (e.g. movement 262 in MSEG).
   *
   * Lookup errors leave status unchanged and log a warning.
   *
   * @param {Object} adapter - GoodsIssueAdapter with RFC / table-reading capability
   * @param {Object} [options]
   * @param {number} [options.now] - Current timestamp (tests)
   * @param {number} [options.staleClaimAgeMs] - Override stale age threshold
   * @returns {Promise<{ inspected: number, released: number, resolvedClaiming: number, errors: number }>}
   */
  async releaseByLquaDropOrReversal(adapter, options = {}) {
    const now = options.now || Date.now();
    const staleAgeThreshold = options.staleClaimAgeMs !== undefined
      ? options.staleClaimAgeMs
      : GoodsIssueIssuedSuStore.staleClaimAgeMs();

    const activeRows = await this.getActiveIssuedSUs();

    if (!Array.isArray(activeRows) || activeRows.length === 0) {
      return { inspected: 0, released: 0, resolvedClaiming: 0, errors: 0 };
    }

    let releasedCount = 0;
    let resolvedClaimingCount = 0;
    let errorCount = 0;

    for (const row of activeRows) {
      try {
        // --- 1. Stale claiming row resolution ---
        if (row.Status === 'claiming') {
          const rowAge = now - new Date(row.createdAt || row.CreatedAt || now).getTime();
          if (rowAge >= staleAgeThreshold) {
            let foundDoc = null;
            let lookupFailed = false;

            // Check if adapter can look up material document by reference
            if (row.ReferenceDocument && adapter && typeof adapter.findPostedGoodsIssueByReference === 'function') {
              try {
                foundDoc = await adapter.findPostedGoodsIssueByReference(row.ReferenceDocument, '261');
              } catch (lookupErr) {
                lookupFailed = true;
                LOG.warn(`Lookup error finding material document for reference ${row.ReferenceDocument}: ${lookupErr.message}`);
              }
            } else if (row.MaterialDocument) {
              foundDoc = { MaterialDocument: row.MaterialDocument, MaterialDocumentYear: row.MaterialDocYear };
            }

            if (lookupFailed) {
              // Lookup error: leave status unchanged and log warning
              errorCount++;
              continue;
            }

            if (foundDoc && foundDoc.MaterialDocument) {
              // Found -> promote to issued
              await this.promoteClaims([row.ID], {
                materialDocument: foundDoc.MaterialDocument,
                materialDocYear: foundDoc.MaterialDocumentYear || foundDoc.MaterialDocYear
              });
              resolvedClaimingCount++;
              LOG.info(`Resolved stale claiming row ${row.ID} to 'issued' with Material Document ${foundDoc.MaterialDocument}`);
            } else {
              // Not found after threshold -> delete
              await this.deleteClaims([row.ID]);
              resolvedClaimingCount++;
              LOG.info(`Resolved stale claiming row ${row.ID}: not found in SAP after ${Math.round(rowAge / 1000)}s -> deleted`);
            }
          }
          continue;
        }

        // --- 2. Active 'issued' row resolution ---
        let shouldRelease = false;
        let releaseReason = '';

        const readTable = (adapter && typeof adapter.readTable === 'function')
          ? (t, f, w) => adapter.readTable(t, f, w)
          : (adapter && adapter.client && typeof adapter.client.readTable === 'function')
            ? (t, f, w) => adapter.client.readTable(t, f, w)
            : null;

        if (readTable) {
          // Check Condition 2A: LQUA stock drop (Transfer Order confirmed)
          const suPadded = /^\d+$/.test(row.StorageUnit) ? row.StorageUnit.padStart(20, '0') : row.StorageUnit;
          const lquaWhere = [`LENUM = '${suPadded}'`];
          if (row.Plant) lquaWhere.push(`AND WERKS = '${row.Plant}'`);

          try {
            const lquaRows = await readTable('LQUA', ['LENUM', 'VERME', 'LGTYP'], lquaWhere);
            const quants = Array.isArray(lquaRows) ? lquaRows : [];
            const nonInterim = quants.filter((q) => !/^9/.test(q.LGTYP || ''));

            if (nonInterim.length === 0) {
              // Quant missing from LQUA counts as released, not as a lookup error
              shouldRelease = true;
              releaseReason = 'LQUA_QUANT_DELETED';
            } else {
              const currentStock = nonInterim.reduce((sum, q) => sum + (Number(q.VERME) || 0), 0);
              const expectedMaxStock = Math.round((Number(row.PreIssueStock) - Number(row.IssuedQty)) * 1000) / 1000;

              if (currentStock <= expectedMaxStock + 0.001) {
                shouldRelease = true;
                releaseReason = 'LQUA_STOCK_REDUCED';
              }
            }
          } catch (lquaErr) {
            // Actual RFC / network error: leave status unchanged and log warning
            LOG.warn(`Lookup error reading LQUA for Storage Unit ${row.StorageUnit}: ${lquaErr.message}`);
          }

          // Check Condition 2B: Check if material document was reversed in SAP (MSEG reversal)
          if (!shouldRelease && row.MaterialDocument) {
            try {
              const msegWhere = [
                `SMBLN = '${row.MaterialDocument}'`,
                `AND SJAHR = '${row.MaterialDocYear || new Date().getFullYear()}'`
              ];
              const msegRows = await readTable('MSEG', ['MBLNR', 'BWART'], msegWhere);
              if (Array.isArray(msegRows) && msegRows.length > 0) {
                shouldRelease = true;
                releaseReason = 'MATERIAL_DOCUMENT_REVERSED';
              }
            } catch (msegErr) {
              LOG.warn(`Lookup error reading MSEG for reversal of Material Document ${row.MaterialDocument}: ${msegErr.message}`);
            }
          }
        }

        if (shouldRelease) {
          await this.release(row.ID, releaseReason);
          releasedCount++;
          LOG.info(`Released Storage Unit ${row.StorageUnit} (Claim ID: ${row.ID}) due to ${releaseReason}`);
        }
      } catch (rowErr) {
        errorCount++;
        LOG.warn(`Lookup error during release evaluation for claim ${row.ID}: ${rowErr.message}. Status left unchanged.`);
      }
    }

    return {
      inspected: activeRows.length,
      released: releasedCount,
      resolvedClaiming: resolvedClaimingCount,
      errors: errorCount
    };
  }
}

const defaultInstance = new GoodsIssueIssuedSuStore();
defaultInstance.GoodsIssueIssuedSuStore = GoodsIssueIssuedSuStore;
defaultInstance.AsyncKeyLock = AsyncKeyLock;
module.exports = defaultInstance;
