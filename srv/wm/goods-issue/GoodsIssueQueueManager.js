const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR_NAME = '.saps4hana';
const STORAGE_FILE_NAME = 'goods-issue-queue.json';
const USER_HOME = os.homedir() || os.tmpdir();

/**
 * GoodsIssueQueueManager
 * Persistent Dispatch Queue manager for offline-first warehouse Goods Issue operations.
 * Allows warehouse clerks to queue Goods Issue 261 transactions when SAP posting services
 * are restricted or unavailable, generating verifiable Queue Reference IDs and supporting
 * automated / on-demand retry sync to S/4HANA.
 *
 * In accordance with AGENTS.md, items in this queue are explicitly marked as:
 * SyncStatus: 'QUEUED' / 'QUEUED_PENDING_SAP_SYNC'
 * and never claim fake SAP persistence.
 *
 * Storage location contract:
 * The queue store MUST live OUTSIDE the project tree. Writing the queue inside the
 * repository directory (e.g. ./data) makes `cds watch` treat every enqueue as a source
 * change and restart the dev server, which drops the connection for in-flight UI requests
 * (the "localhost refused to connect" failure on the Goods Issue last step). The default
 * store is therefore resolved under the user's home directory and can be overridden via
 * the GI_QUEUE_STORAGE_FILE environment variable (used by deployments and tests).
 */
class GoodsIssueQueueManager {
  constructor(options = {}) {
    this.storageFile = options.storageFile || GoodsIssueQueueManager.resolveStorageFile();
    this.legacyStorageFile = GoodsIssueQueueManager.resolveLegacyStorageFile();
    this._ensureStorageDir();
    // Only migrate the legacy in-tree store for the default/production store. Instances
    // constructed with an explicit storageFile (e.g. isolated unit-test stores) are
    // intentionally not migrated so they never absorb unrelated production records.
    if (!options.storageFile) {
      this._migrateLegacyStore();
    }
  }

  static resolveStorageFile() {
    const override = process.env.GI_QUEUE_STORAGE_FILE;
    if (override && override.trim()) {
      return path.resolve(override.trim());
    }
    return path.join(USER_HOME, STORAGE_DIR_NAME, STORAGE_FILE_NAME);
  }

  static resolveLegacyStorageFile() {
    return path.resolve(process.cwd(), 'data', 'goods-issue-queue.json');
  }

  _ensureStorageDir() {
    const dir = path.dirname(this.storageFile);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {
        // Ignore
      }
    }
    if (!fs.existsSync(this.storageFile)) {
      try {
        fs.writeFileSync(this.storageFile, JSON.stringify([], null, 2), 'utf8');
      } catch (_) {
        // Ignore
      }
    }
  }

  /**
   * One-time, idempotent migration of records previously persisted in the legacy
   * ./data/goods-issue-queue.json (inside the watched project tree). Existing records
   * are merged by QueueReference/ID so no queued transaction is lost and nothing is
   * duplicated if the migration runs more than once. The legacy file itself is left
   * untouched so no live session data is disturbed.
   */
  _migrateLegacyStore() {
    if (this.legacyStorageFile === this.storageFile) return;
    if (!fs.existsSync(this.legacyStorageFile)) return;

    let legacyItems = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.legacyStorageFile, 'utf8'));
      legacyItems = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      legacyItems = [];
    }
    if (legacyItems.length === 0) return;

    const current = this._readAll();
    const known = new Set(current.map(i => i && (i.QueueReference || i.ID)));
    const missing = legacyItems.filter(i => i && !known.has(i.QueueReference || i.ID));
    if (missing.length === 0) return;

    this._writeAll(missing.concat(current));
    console.info(
      `[GoodsIssueQueueManager] Migrated ${missing.length} queued transaction(s) from legacy store to ${this.storageFile}`
    );
  }

  _readAll() {
    this._ensureStorageDir();
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        return JSON.parse(raw) || [];
      }
    } catch (_) {
      // Fallback
    }
    return [];
  }

  _writeAll(items) {
    this._ensureStorageDir();
    const tmpFile = `${this.storageFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(items, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.storageFile);
      return true;
    } catch (err) {
      console.error('[GoodsIssueQueueManager] Failed to write queue storage:', err.message);
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch (_) {
        // Ignore
      }
      return false;
    }
  }

  /**
   * Enqueue a validated goods issue transaction
   */
  enqueue(data) {
    const items = this._readAll();
    const id = crypto.randomUUID();
    const sReserv = String(data.ReservationNo || '').trim();
    const sItem = String(data.ReservationItem || '').trim().padStart(4, '0');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const queueRef = `GI-QUEUE-${sReserv}-${sItem}-${randSuffix}`;

    const record = {
      ID: id,
      QueueReference: queueRef,
      ReservationNo: sReserv,
      ReservationItem: sItem,
      OrderNo: String(data.OrderNo || '').trim(),
      Material: String(data.Material || '').trim(),
      MaterialDesc: String(data.MaterialDesc || '').trim(),
      Plant: String(data.Plant || '1120').trim(),
      StorageLocation: String(data.StorageLocation || 'CS01').trim(),
      StorageBin: String(data.StorageBin || '').trim(),
      Batch: String(data.Batch || '').trim(),
      ExpiryDate: data.ExpiryDate || null,
      IssueQty: Number(data.IssueQty) || 0,
      Unit: String(data.Unit || 'KG').trim(),
      DifferenceQty: Number(data.DifferenceQty) || 0,
      DifferenceReason: String(data.DifferenceReason || '').trim(),
      DifferenceStorageType: String(data.DifferenceStorageType || '999').trim(),
      FinalIssue: Boolean(data.FinalIssue),
      SyncStatus: 'QUEUED',
      SyncAttempts: 1,
      LastSyncError: String(data.LastSyncError || 'SAP Gateway posting service unavailable on Client 220').slice(0, 500),
      SapMaterialDocument: '',
      SapMaterialDocYear: '',
      QueuedAt: new Date().toISOString(),
      SyncedAt: null
    };

    items.unshift(record);
    this._writeAll(items);
    return record;
  }

  /**
   * Get all queued items
   */
  getAll() {
    return this._readAll();
  }

  /**
   * Get specific item by QueueReference or ID
   */
  get(queueRefOrId) {
    const items = this._readAll();
    return items.find(i => i.QueueReference === queueRefOrId || i.ID === queueRefOrId) || null;
  }

  /**
   * Update queued item status and SAP document reference
   */
  update(queueRefOrId, updates) {
    const items = this._readAll();
    const idx = items.findIndex(i => i.QueueReference === queueRefOrId || i.ID === queueRefOrId);
    if (idx === -1) return null;

    items[idx] = Object.assign({}, items[idx], updates);
    this._writeAll(items);
    return items[idx];
  }

  /**
   * Remove item from queue
   */
  remove(queueRefOrId) {
    const items = this._readAll();
    const filtered = items.filter(i => i.QueueReference !== queueRefOrId && i.ID !== queueRefOrId);
    this._writeAll(filtered);
    return filtered.length < items.length;
  }

  /**
   * Get summary for UI tray
   */
  getSummary() {
    const items = this._readAll();
    const pending = items.filter(i => i.SyncStatus === 'QUEUED' || i.SyncStatus === 'FAILED');
    return {
      QueuedCount: pending.length,
      TotalCount: items.length,
      Items: items
    };
  }

  /**
   * Clear all items (for testing)
   */
  clear() {
    this._writeAll([]);
  }
}

module.exports = new GoodsIssueQueueManager();
module.exports.GoodsIssueQueueManager = GoodsIssueQueueManager;