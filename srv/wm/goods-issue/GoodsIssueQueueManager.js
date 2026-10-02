const cds = require('@sap/cds');
const LOG = cds.log('goods-issue-queue');
const crypto = require('crypto');
const GoodsIssueAttemptStore = require('./GoodsIssueAttemptStore');
const GoodsIssueIssuedSuStore = require('./GoodsIssueIssuedSuStore');

const { INSERT, SELECT, UPDATE, DELETE } = cds.ql;

/** Persisted entity (db/wm/goods-issue-queue.cds). */
const QUEUE_ENTITY = 'saps4hana.wm.GoodsIssueQueue';

/** Sync states that still need an SAP posting. */
const PENDING_STATUSES = ['QUEUED', 'FAILED'];

/**
 * Raised when a queue write is attempted and no database is bound to this deployment.
 * The Goods Issue handlers turn this into a transparent failure: the SAP error is returned to the
 * user and nothing pretends to have been recorded.
 */
class QueueStoreUnavailableError extends Error {
  constructor() {
    super('Goods Issue dispatch queue is not available: no database is bound to this deployment, so the transaction was NOT recorded.');
    this.name = 'QueueStoreUnavailableError';
    this.status = 503;
    this.code = 'GI_QUEUE_STORE_UNAVAILABLE';
  }
}

/**
 * GoodsIssueQueueManager
 * Dispatch queue for Goods Issue (movement 261) transactions that SAP could not accept at posting time
 * (posting service not activated / not authorised). Queued items are retried against S/4HANA on demand.
 *
 * Storage contract:
 * Records live in the CAP database (entity saps4hana.wm.GoodsIssueQueue) and nowhere else. This is what
 * makes the queue durable across restarts and shared between application instances. Locally CAP binds
 * the in-memory SQLite database of the development/test profile; a deployed environment must bind a real
 * database. Without one, isAvailable() is false, reads return empty results and writes fail with
 * QueueStoreUnavailableError. In line with AGENTS.md, queued items are always marked QUEUED / FAILED and
 * never claim SAP persistence.
 */
class GoodsIssueQueueManager {
  /** Adapter error codes meaning SAP did not confirm the outcome of a posting. */
  static UNCONFIRMED_CODES = ['GI_POSTING_OUTCOME_UNKNOWN', 'GI_POSTING_UNCONFIRMED'];

  /**
   * @param {Object} [options]
   * @param {Object|null} [options.db] - Database service to use (tests); default: cds.db at call time
   */
  constructor(options = {}) {
    this._dbProvider = options.db !== undefined ? () => options.db : () => cds.db;
  }

  /** The bound CAP database service, or null when none is available. */
  get db() {
    return this._dbProvider() || null;
  }

  /** True when queue records can be read and written. */
  isAvailable() {
    return Boolean(this.db);
  }

  _requireDb() {
    const db = this.db;
    if (!db) throw new QueueStoreUnavailableError();
    return db;
  }

  /** Where clause matching a record by QueueReference or technical ID. */
  static _keyMatch(queueRefOrId) {
    const val = String(queueRefOrId);
    return [{ ref: ['QueueReference'] }, '=', { val }, 'or', { ref: ['ID'] }, '=', { val }];
  }

  /**
   * Builds a queue record from a validated goods issue request.
   *
   * @param {Object} data
   * @returns {Object}
   */
  /** Movement-type options for re-posting a queued record (older rows have no MovementType -> 261). */
  postOptions(item) {
    return {
      movementType: item.MovementType || '261',
      receivingPlant: item.ReceivingPlant || '',
      receivingStorageLocation: item.ReceivingStorageLocation || '',
      costCenter: item.CostCenter || '',
      glAccount: item.GLAccount || '',
      postingDate: item.PostingDate || '',
      documentDate: item.DocumentDate || '',
      serialNumber: item.SerialNumber || '',
      serialNumbers: item.SerialNumber ? [item.SerialNumber] : []
    };
  }

  static buildRecord(data) {
    const sReserv = String(data.ReservationNo || '').trim();
    const sItem = String(data.ReservationItem || '').trim().padStart(4, '0');
    const id = data.ID || crypto.randomUUID();

    return {
      ID: id,
      QueueReference: String(data.QueueReference || id),
      ReservationNo: sReserv,
      ReservationItem: sItem,
      OrderNo: String(data.OrderNo || '').trim(),
      Material: String(data.Material || '').trim(),
      MaterialDesc: String(data.MaterialDesc || '').trim(),
      Plant: String(data.Plant || '').trim(),
      StorageLocation: String(data.StorageLocation || '').trim(),
      Batch: String(data.Batch || '').trim(),
      ExpiryDate: data.ExpiryDate || null,
      IssueQty: Number(data.IssueQty) || 0,
      Unit: String(data.Unit || '').trim(),
      DifferenceQty: Number(data.DifferenceQty) || 0,
      DifferenceReason: String(data.DifferenceReason || '').trim(),
      DifferenceStorageType: String(data.DifferenceStorageType || '').trim(),
      FinalIssue: Boolean(data.FinalIssue),
      MovementType: String(data.MovementType || '261').trim(),
      ReceivingPlant: String(data.ReceivingPlant || '').trim(),
      ReceivingStorageLocation: String(data.ReceivingStorageLocation || '').trim(),
      CostCenter: String(data.CostCenter || '').trim(),
      GLAccount: String(data.GLAccount || '').trim(),
      SerialNumber: String(data.SerialNumber || (Array.isArray(data.SerialNumbers) ? data.SerialNumbers[0] : '') || '').trim(),
      StorageUnits: data.StorageUnits
        ? (typeof data.StorageUnits === 'string' ? data.StorageUnits : JSON.stringify(data.StorageUnits))
        : (data.AllocatedSuItems ? JSON.stringify(data.AllocatedSuItems) : null),
      PostingDate: data.PostingDate || null,
      DocumentDate: data.DocumentDate || null,
      ReferenceDocument: String(data.ReferenceDocument || '').trim(),
      SyncStatus: 'QUEUED',
      SyncAttempts: 1,
      LastSyncError: String(data.LastSyncError || 'SAP Gateway posting service unavailable').slice(0, 500),
      SapMaterialDocument: '',
      SapMaterialDocYear: '',
      QueuedAt: new Date().toISOString(),
      SyncedAt: null,
      LegacyReference: Boolean(data.LegacyReference)
    };
  }

  /**
   * Enqueues a validated goods issue transaction.
   *
   * @param {Object} data
   * @returns {Promise<Object>} The persisted record
   * @throws {QueueStoreUnavailableError} when no database is bound
   */
  async enqueue(data) {
    const db = this._requireDb();
    const record = GoodsIssueQueueManager.buildRecord(data);
    await db.run(INSERT.into(QUEUE_ENTITY).entries(record));
    return record;
  }

  /**
   * All queue records, newest first. Empty when no database is bound.
   *
   * @returns {Promise<Array<Object>>}
   */
  async getAll() {
    if (!this.isAvailable()) return [];
    const rows = await this.db.run(SELECT.from(QUEUE_ENTITY).orderBy('QueuedAt desc', 'createdAt desc'));
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * One record by QueueReference or ID, or null.
   *
   * @param {string} queueRefOrId
   * @returns {Promise<Object|null>}
   */
  async get(queueRefOrId) {
    if (!this.isAvailable() || !queueRefOrId) return null;
    const row = await this.db.run(SELECT.one.from(QUEUE_ENTITY).where(GoodsIssueQueueManager._keyMatch(queueRefOrId)));
    return row || null;
  }

  /**
   * Updates sync status and SAP document references of a queued record.
   *
   * @param {string} queueRefOrId
   * @param {Object} updates
   * @returns {Promise<Object|null>} The updated record, or null when it does not exist
   */
  async update(queueRefOrId, updates) {
    const db = this._requireDb();
    const existing = await this.get(queueRefOrId);
    if (!existing) return null;
    await db.run(UPDATE(QUEUE_ENTITY).set(updates).where({ ID: existing.ID }));
    return this.get(existing.ID);
  }

  /**
   * Removes a record from the queue.
   *
   * @param {string} queueRefOrId
   * @returns {Promise<boolean>} true when a record was removed
   */
  async remove(queueRefOrId) {
    const db = this._requireDb();
    const affected = await db.run(DELETE.from(QUEUE_ENTITY).where(GoodsIssueQueueManager._keyMatch(queueRefOrId)));
    return Number(affected) > 0;
  }

  /**
   * Summary for the UI tray.
   *
   * @returns {Promise<{ QueuedCount: number, TotalCount: number, Items: Array<Object>, StoreAvailable: boolean }>}
   */
  async getSummary() {
    if (!this.isAvailable()) {
      return { QueuedCount: 0, TotalCount: 0, Items: [], StoreAvailable: false };
    }
    const items = await this.getAll();
    const pending = items.filter(i => PENDING_STATUSES.includes(i.SyncStatus));
    return {
      QueuedCount: pending.length,
      TotalCount: items.length,
      Items: items,
      StoreAvailable: true
    };
  }

  /**
   * Retrieves pending items whose Goods Issue has not yet been confirmed in SAP.
   *
   * @param {string} [reservationNo]
   * @returns {Promise<Array<Object>>}
   */
  async getPendingItems(reservationNo) {
    if (!this.isAvailable()) return [];
    const all = await this.getAll();
    const pending = all.filter(i => i.SyncStatus !== 'POSTED_IN_SAP');
    if (!reservationNo) return pending;
    const sClean = String(reservationNo).trim().replace(/^0+/, '');
    return pending.filter(i => {
      const itemRes = String(i.ReservationNo || '').trim().replace(/^0+/, '');
      return itemRes === sClean;
    });
  }

  /**
   * Builds a Map of pending queued quantities keyed by `${cleanResv}:${cleanItem}`.
   * Also tracks whether FinalIssue has been queued for that item.
   *
   * @param {string} [reservationNo]
   * @returns {Promise<Map<string, { queuedQty: number, finalIssue: boolean }>>}
   */
  async getPendingQueueMap(reservationNo) {
    const map = new Map();
    if (!this.isAvailable()) return map;
    const pending = await this.getPendingItems(reservationNo);
    for (const item of pending) {
      const sRes = String(item.ReservationNo || '').trim().replace(/^0+/, '');
      const sItem = String(item.ReservationItem || '').trim().replace(/^0+/, '');
      if (!sRes || !sItem) continue;
      const key = `${sRes}:${sItem}`;
      const issueQty = Number(item.IssueQty) || 0;
      const finalIssue = Boolean(item.FinalIssue);

      if (!map.has(key)) {
        map.set(key, { queuedQty: issueQty, finalIssue });
      } else {
        const entry = map.get(key);
        entry.queuedQty += issueQty;
        if (finalIssue) entry.finalIssue = true;
      }
    }
    return map;
  }

  /**
   * Retrieves pending queued quantity and final-issue flag for a specific reservation item.
   *
   * @param {string} reservationNo
   * @param {string} reservationItem
   * @returns {Promise<{ queuedQty: number, finalIssue: boolean }>}
   */
  async getPendingQueuedQty(reservationNo, reservationItem) {
    if (!this.isAvailable() || !reservationNo || !reservationItem) {
      return { queuedQty: 0, finalIssue: false };
    }
    const map = await this.getPendingQueueMap(reservationNo);
    const sRes = String(reservationNo).trim().replace(/^0+/, '');
    const sItem = String(reservationItem).trim().replace(/^0+/, '');
    return map.get(`${sRes}:${sItem}`) || { queuedQty: 0, finalIssue: false };
  }

  /**
   * Drain the queue by attempting to post all pending (QUEUED / FAILED) items against SAP S/4HANA.
   *
   * @param {Object} adapter - GoodsIssueAdapter instance
   * @returns {Promise<{
   *   TotalQueued: number,
   *   Attempted: number,
   *   SyncedToSap: number,
   *   Failed: number,
   *   RemainingQueued: number,
   *   Message: string,
   *   Items: Array<Object>
   * }>}
   */
  async drainQueue(adapter) {
    if (!this.isAvailable()) {
      return {
        TotalQueued: 0,
        Attempted: 0,
        SyncedToSap: 0,
        Failed: 0,
        RemainingQueued: 0,
        Message: 'Dispatch queue is unavailable: no database is bound.',
        Items: []
      };
    }

    if (!adapter || typeof adapter.postGoodsIssueByType !== 'function') {
      throw new Error('Valid GoodsIssueAdapter is required to drain the queue.');
    }

    const allItems = await this.getAll();
    const pendingItems = allItems.filter(i => PENDING_STATUSES.includes(i.SyncStatus));

    if (pendingItems.length === 0) {
      return {
        TotalQueued: 0,
        Attempted: 0,
        SyncedToSap: 0,
        Failed: 0,
        RemainingQueued: 0,
        Message: 'No pending items in the dispatch queue to synchronize.',
        Items: allItems
      };
    }

    let syncedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const item of pendingItems) {
      // A record whose posting attempt is not `queued` (e.g. unconfirmed after a timed-out replay)
      // must not be replayed; the attempt re-check job resolves it.
      const guard = await GoodsIssueAttemptStore.replayGuard(item);
      if (!guard.replay) {
        if (guard.attempt.Status === 'posted') {
          await this.update(item.QueueReference, {
            SyncStatus: 'POSTED_IN_SAP',
            SapMaterialDocument: guard.attempt.MaterialDocument,
            SapMaterialDocYear: guard.attempt.MaterialDocYear,
            SyncedAt: new Date().toISOString()
          });
          syncedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }
      const settle = (status, fields) => (guard.attempt ? GoodsIssueAttemptStore.setStatus(item.ReferenceDocument, status, fields) : Promise.resolve());

      // Legacy row pre-replay MATDOC guard (enabled via LegacyReference schema flag):
      // Check MATDOC by reservation+item+user+date+qty, created after the queue time.
      // Match or ambiguous -> needs-attention, no replay.
      const isLegacy = Boolean(item.LegacyReference);
      const matdocChecker = (adapter && typeof adapter.checkLegacyMatdocMatches === 'function')
        ? adapter.checkLegacyMatdocMatches.bind(adapter)
        : (adapter && adapter.posting && typeof adapter.posting.checkLegacyMatdocMatches === 'function')
          ? adapter.posting.checkLegacyMatdocMatches.bind(adapter.posting)
          : null;

      if (isLegacy && matdocChecker) {
        let checkResult = null;
        let checkError = null;
        try {
          checkResult = await matdocChecker(item);
        } catch (chkErr) {
          LOG.warn ? LOG.warn(`Pre-replay MATDOC check failed for legacy queue row ${item.QueueReference}: ${chkErr.message}`) : undefined;
          checkError = chkErr;
        }
        if (checkError) {
          const finding = `Pre-replay SAP MATDOC check error: ${checkError.message}; operator attention required before replay`;
          await this.update(item.QueueReference, {
            SyncAttempts: (item.SyncAttempts || 0) + 1,
            LastSyncError: finding,
            SyncStatus: 'NEEDS_ATTENTION'
          });
          failedCount++;
          continue;
        }
        if (checkResult && checkResult.count > 0) {
          const isAmbiguous = checkResult.count > 1;
          const finding = isAmbiguous
            ? `Ambiguous documents found in SAP MATDOC (${checkResult.count} matches); operator attention required before replay`
            : `Document already found in SAP MATDOC (${checkResult.match.MBLNR}/${checkResult.match.MJAHR || ''}); operator attention required before replay`;
          await this.update(item.QueueReference, {
            SyncAttempts: (item.SyncAttempts || 0) + 1,
            LastSyncError: finding,
            SyncStatus: 'NEEDS_ATTENTION'
          });
          failedCount++;
          continue;
        }
      }

      try {
        // --- Parse StorageUnits for SU claim management ---
        let suAllocations = [];
        if (item.StorageUnits) {
          try {
            const parsed = JSON.parse(item.StorageUnits);
            const arr = Array.isArray(parsed) ? parsed : [];
            suAllocations = arr.map((su) => {
              if (typeof su === 'string') return { storageUnit: su, issuedQty: item.IssueQty, preIssueStock: item.IssueQty };
              return {
                storageUnit: su.storageUnit || su.StorageUnit,
                issuedQty: su.issuedQty != null ? su.issuedQty : (su.IssuedQty || item.IssueQty),
                preIssueStock: su.preIssueStock != null ? su.preIssueStock : (su.PreIssueStock || item.IssueQty)
              };
            }).filter((s) => Boolean(s.storageUnit));
          } catch (_) { /* ignore parse error */ }
        }

        // --- Acquire SU claims BEFORE posting (replay conflict detection) ---
        let replayClaimIds = [];
        if (suAllocations.length > 0) {
          try {
            replayClaimIds = await GoodsIssueIssuedSuStore.acquireClaims({
              reservationNo: item.ReservationNo,
              reservationItem: item.ReservationItem,
              material: item.Material,
              plant: item.Plant,
              storageLocation: item.StorageLocation,
              referenceDocument: item.ReferenceDocument,
              items: suAllocations
            });
          } catch (claimErr) {
            if (claimErr.status === 400) {
              // Another live claim exists for this SU: mark needs-attention and skip posting
              await this.update(item.QueueReference, {
                SyncAttempts: (item.SyncAttempts || 1) + 1,
                LastSyncError: `Replay conflict: ${claimErr.message}`,
                SyncStatus: 'NEEDS_ATTENTION'
              });
              failedCount++;
              continue;
            }
            // Non-conflict error: log and continue to attempt posting anyway
            LOG.warn ? LOG.warn(`SU claim acquire failed for queue item ${item.QueueReference}: ${claimErr.message}`) : undefined;
          }
        }

        // Replay through the isolated per-type dispatcher (routes by the stored MovementType).
        let result;
        try {
          result = await adapter.postGoodsIssueByType(item);
        } catch (postErr) {
          const isNeverReached = GoodsIssueIssuedSuStore.isNeverReachedError ? GoodsIssueIssuedSuStore.isNeverReachedError(postErr) : false;
          const definitive = postErr.status === 400 || postErr.status === 409 || postErr.status === 422 || isNeverReached;
          const isUnknown = !definitive || GoodsIssueQueueManager.UNCONFIRMED_CODES.includes(postErr.code);

          if (replayClaimIds.length > 0) {
            await GoodsIssueIssuedSuStore.deleteClaims(replayClaimIds, { definitive });
          }

          // Unknown-outcome queue items must NOT be replayable: mark them NEEDS_ATTENTION.
          // Definitive rejections (400/409/422 or never-reached) can be marked FAILED.
          const syncStatus = isUnknown ? 'NEEDS_ATTENTION' : 'FAILED';
          await this.update(item.QueueReference, {
            SyncAttempts: (item.SyncAttempts || 1) + 1,
            LastSyncError: String(postErr.message || (isUnknown ? 'Unknown posting outcome; operator attention required' : 'Posting rejected by SAP Gateway')).slice(0, 500),
            SyncStatus: syncStatus
          });
          if (GoodsIssueQueueManager.UNCONFIRMED_CODES.includes(postErr.code)) {
            await settle('unconfirmed', { LastError: postErr.message });
          }
          failedCount++;
          continue;
        }

        if (result && result.MaterialDocument) {
          await this.update(item.QueueReference, {
            SyncStatus: 'POSTED_IN_SAP',
            SapMaterialDocument: result.MaterialDocument,
            SapMaterialDocYear: result.MaterialDocYear || '',
            SyncedAt: new Date().toISOString()
          });
          await settle('posted', { MaterialDocument: result.MaterialDocument, MaterialDocYear: result.MaterialDocYear });

          // Promote SU claims to 'issued'
          if (replayClaimIds.length > 0) {
            await GoodsIssueIssuedSuStore.promoteClaims(replayClaimIds, {
              materialDocument: result.MaterialDocument,
              materialDocYear: result.MaterialDocYear || ''
            });
          } else if (suAllocations.length > 0) {
            // Fallback: acquireClaims was skipped (e.g. no-DB); record directly
            try {
              await GoodsIssueIssuedSuStore.recordIssuedSUs({
                materialDocument: result.MaterialDocument,
                materialDocYear: result.MaterialDocYear || '',
                reservationNo: item.ReservationNo,
                reservationItem: item.ReservationItem,
                referenceDocument: item.ReferenceDocument,
                material: item.Material,
                plant: item.Plant,
                storageLocation: item.StorageLocation,
                items: suAllocations
              });
            } catch (suErr) { /* non-fatal */ }
          }

          syncedCount++;
        } else {
          // Success response but no material document: unknown outcome -> NEEDS_ATTENTION (not replayable)
          if (replayClaimIds.length > 0) {
            await GoodsIssueIssuedSuStore.deleteClaims(replayClaimIds, { definitive: false });
          }
          await this.update(item.QueueReference, {
            SyncAttempts: (item.SyncAttempts || 1) + 1,
            LastSyncError: (result && result.Message) || 'Posting completed without material document; operator attention required',
            SyncStatus: 'NEEDS_ATTENTION'
          });
          failedCount++;
        }
      } catch (outerErr) {
        // Unexpected error for this queue item: log and mark as failed
        try {
          await this.update(item.QueueReference, {
            SyncAttempts: (item.SyncAttempts || 1) + 1,
            LastSyncError: String(outerErr.message || 'Unexpected error during queue drain').slice(0, 500),
            SyncStatus: 'FAILED'
          });
        } catch (_) { /* best effort */ }
        failedCount++;
      }
    }

    const updatedAll = await this.getAll();
    const remainingPending = updatedAll.filter(i => PENDING_STATUSES.includes(i.SyncStatus)).length;

    let message;
    if (syncedCount === pendingItems.length) {
      message = `Successfully synchronized all ${syncedCount} queued item(s) to SAP S/4HANA.`;
    } else if (syncedCount > 0) {
      message = `Partial synchronization: ${syncedCount} posted to SAP, ${failedCount} failed and remain in queue.`;
    } else {
      message = `Sync attempted for ${pendingItems.length} item(s). 0 posted to SAP (Gateway posting service unavailable); ${failedCount} item(s) remain in queue.`;
    }

    if (skippedCount > 0) {
      message += ` ${skippedCount} item(s) were not replayed because their last posting attempt is still being confirmed in SAP.`;
    }

    return {
      TotalQueued: pendingItems.length,
      Attempted: pendingItems.length - skippedCount,
      SyncedToSap: syncedCount,
      Failed: failedCount,
      RemainingQueued: remainingPending,
      Message: message,
      Items: updatedAll
    };
  }

  /**
   * Manual resolution of a queue item in NEEDS_ATTENTION (or FAILED) status by an operator.
   * On 'posted': verifies the document in MATDOC (261, same reservation/item, not linked to another queue item)
   *             and updates SyncStatus to 'POSTED_IN_SAP'.
   * On 'not-posted': updates SyncStatus to 'DISCARDED' with reason/user/time and releases any SU claims.
   *
   * @param {string} queueId
   * @param {'posted'|'not-posted'} action
   * @param {Object} [options]
   * @param {string} [options.materialDocument]
   * @param {string} [options.materialDocYear]
   * @param {string} [options.reason]
   * @param {string} [options.user]
   * @param {Object} [options.adapter]
   * @returns {Promise<Object>} The updated queue record
   */
  async resolveQueueItemManual(queueId, action, options = {}) {
    if (!queueId) {
      const err = new Error('queueId is required');
      err.status = 400;
      throw err;
    }
    const act = String(action || '').trim().toLowerCase();
    if (act !== 'posted' && act !== 'not-posted') {
      const err = new Error(`Invalid resolve action "${action}". Must be "posted" or "not-posted".`);
      err.status = 400;
      throw err;
    }

    const db = this._requireDb();
    const rows = await db.run(
      SELECT.from(QUEUE_ENTITY).where({ ID: queueId })
    );
    const item = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!item) {
      const err = new Error(`Queue item ${queueId} not found`);
      err.status = 404;
      throw err;
    }

    const nowIso = new Date().toISOString();
    const user = options.user ? String(options.user).trim() : 'OPERATOR';

    if (act === 'posted') {
      const matDoc = String(options.materialDocument || item.SapMaterialDocument || '').trim();
      const matYear = String(options.materialDocYear || item.SapMaterialDocYear || '').trim();
      if (!matDoc) {
        const err = new Error('materialDocument is required for action "posted"');
        err.status = 400;
        throw err;
      }

      // 1. Verify not linked to another queue item
      const dupRows = await db.run(
        SELECT.from(QUEUE_ENTITY).where({
          SapMaterialDocument: matDoc,
          SapMaterialDocYear: matYear,
          ID: { '!=': queueId },
          SyncStatus: 'POSTED_IN_SAP'
        })
      );
      if (Array.isArray(dupRows) && dupRows.length > 0) {
        const err = new Error(`Material document ${matDoc}/${matYear} is already linked to queue item ${dupRows[0].ID}`);
        err.status = 422;
        throw err;
      }

      // 2. Verify the document in MATDOC (261, same reservation/item)
      const adapter = options.adapter;
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

        const expectedMvt = String(item.MovementType || '261').trim();
        const hasMvt = docRows.some((r) => String(r.BWART).trim() === expectedMvt);
        if (!hasMvt) {
          const err = new Error(`Material document ${matDoc}/${matYear} has movement type ${docRows[0].BWART}, expected ${expectedMvt}`);
          err.status = 422;
          throw err;
        }

        if (item.ReservationNo && item.ReservationItem) {
          const sResv = String(item.ReservationNo).trim().padStart(10, '0');
          const sItem = String(item.ReservationItem).trim().padStart(4, '0');
          const matchesResv = docRows.some((r) => {
            const rResv = String(r.RSNUM || '').trim().padStart(10, '0');
            const rItem = String(r.RSPOS || '').trim().padStart(4, '0');
            return rResv === sResv && rItem === sItem;
          });
          if (!matchesResv) {
            const err = new Error(`Material document ${matDoc}/${matYear} does not match queue item reservation ${item.ReservationNo} item ${item.ReservationItem}`);
            err.status = 422;
            throw err;
          }
        }
      }

      await this.update(item.QueueReference, {
        SyncStatus: 'POSTED_IN_SAP',
        SapMaterialDocument: matDoc,
        SapMaterialDocYear: matYear,
        SyncedAt: nowIso,
        LastSyncError: options.reason || `MANUALLY_RESOLVED_POSTED by ${user}`
      });

      // Promote any SU claims if StorageUnits is present
      if (item.StorageUnits && GoodsIssueIssuedSuStore) {
        try {
          const parsed = JSON.parse(item.StorageUnits);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const suKeys = parsed.map((p) => p.storageUnit || p.StorageUnit).filter(Boolean);
            const activeClaims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs(item.Material, item.Plant, item.StorageLocation);
            const matchingClaims = (Array.isArray(activeClaims) ? activeClaims : []).filter(
              (c) => suKeys.includes(c.StorageUnit) && c.ReservationNo === item.ReservationNo
            );
            if (matchingClaims.length > 0) {
              await GoodsIssueIssuedSuStore.promoteClaims(matchingClaims.map((c) => c.ID), {
                materialDocument: matDoc,
                materialDocYear: matYear
              });
            }
          }
        } catch (_) {}
      }

      return (await db.run(SELECT.from(QUEUE_ENTITY).where({ ID: queueId })))[0];
    } else {
      // 'not-posted': mark DISCARDED and release SU claims
      const reason = options.reason || `MANUALLY_RESOLVED_NOT_POSTED by ${user}`;
      await this.update(item.QueueReference, {
        SyncStatus: 'DISCARDED',
        SyncedAt: nowIso,
        LastSyncError: reason
      });

      // Release any active SU claims to free drums immediately
      if (item.StorageUnits && GoodsIssueIssuedSuStore) {
        try {
          const parsed = JSON.parse(item.StorageUnits);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const suKeys = parsed.map((p) => p.storageUnit || p.StorageUnit).filter(Boolean);
            const activeClaims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs(item.Material, item.Plant, item.StorageLocation);
            const matchingClaims = (Array.isArray(activeClaims) ? activeClaims : []).filter(
              (c) => suKeys.includes(c.StorageUnit) && c.ReservationNo === item.ReservationNo
            );
            for (const c of matchingClaims) {
              await GoodsIssueIssuedSuStore.release(c.ID, reason);
            }
          }
        } catch (_) {}
      }

      return (await db.run(SELECT.from(QUEUE_ENTITY).where({ ID: queueId })))[0];
    }
  }

  /**
   * Removes every record (tests).
   */
  async clear() {
    const db = this._requireDb();
    await db.run(DELETE.from(QUEUE_ENTITY));
  }
}

module.exports = new GoodsIssueQueueManager();
module.exports.GoodsIssueQueueManager = GoodsIssueQueueManager;
module.exports.QueueStoreUnavailableError = QueueStoreUnavailableError;
module.exports.QUEUE_ENTITY = QUEUE_ENTITY;
