const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
 */
class GoodsIssueQueueManager {
  constructor() {
    this.storageFile = path.resolve(process.cwd(), 'data', 'goods-issue-queue.json');
    this._ensureStorageDir();
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
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(items, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[GoodsIssueQueueManager] Failed to write queue storage:', err.message);
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
