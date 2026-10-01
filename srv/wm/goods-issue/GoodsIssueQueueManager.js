const cds = require('@sap/cds');
const crypto = require('crypto');
const GoodsIssueAttemptStore = require('./GoodsIssueAttemptStore');

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
    const randSuffix = Math.floor(1000 + Math.random() * 9000);

    return {
      ID: crypto.randomUUID(),
      QueueReference: `GI-QUEUE-${sReserv || 'UNPLANNED'}-${sItem || '0000'}-${randSuffix}`,
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
      PostingDate: data.PostingDate || null,
      DocumentDate: data.DocumentDate || null,
      ReferenceDocument: String(data.ReferenceDocument || '').trim(),
      SyncStatus: 'QUEUED',
      SyncAttempts: 1,
      LastSyncError: String(data.LastSyncError || 'SAP Gateway posting service unavailable').slice(0, 500),
      SapMaterialDocument: '',
      SapMaterialDocYear: '',
      QueuedAt: new Date().toISOString(),
      SyncedAt: null
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

      try {
        // Replay through the isolated per-type dispatcher (routes by the stored MovementType).
        const result = await adapter.postGoodsIssueByType(item);

        if (result && result.MaterialDocument) {
          await this.update(item.QueueReference, {
            SyncStatus: 'POSTED_IN_SAP',
            SapMaterialDocument: result.MaterialDocument,
            SapMaterialDocYear: result.MaterialDocYear || String(new Date().getFullYear()),
            SyncedAt: new Date().toISOString()
          });
          await settle('posted', { MaterialDocument: result.MaterialDocument, MaterialDocYear: result.MaterialDocYear });
          syncedCount++;
        } else {
          await this.update(item.QueueReference, {
            SyncAttempts: (item.SyncAttempts || 1) + 1,
            LastSyncError: (result && result.Message) || 'Posting completed without material document',
            SyncStatus: 'FAILED'
          });
          failedCount++;
        }
      } catch (err) {
        await this.update(item.QueueReference, {
          SyncAttempts: (item.SyncAttempts || 1) + 1,
          LastSyncError: String(err.message || 'Posting rejected by SAP Gateway').slice(0, 500),
          SyncStatus: 'FAILED'
        });
        if (GoodsIssueQueueManager.UNCONFIRMED_CODES.includes(err.code)) {
          await settle('unconfirmed', { LastError: err.message });
        }
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
