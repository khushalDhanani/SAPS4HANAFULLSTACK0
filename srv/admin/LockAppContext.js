'use strict';

/**
 * LockAppContext
 *
 * Records and dispatches application-initiated user lock contexts and immediate notifications.
 */

const store = require('./lockEventStore');
const { formatLockTimestamp } = require('./lockEmail');
const LOG = require('../common/logger')('lock-monitor');

const {
  pollIntervalSec,
  isEnabled,
  defaultRetryDelays,
} = require('./LockNotifierConfig');

const {
  SOURCE_APP,
  lockLabel,
} = require('./LockDiffEngine');

const { sendPending } = require('./LockNotificationSender');

/** The app is about to lock this user. Never throws: a note must not stop the lock. */
async function recordAppLock({ username, actor, reason, bulkRunId }) {
  if (pollIntervalSec() <= 0) return;
  try {
    await store.writeContext({ username, actor, reason, bulkRunId, at: new Date().toISOString(), historyKey: '' });
  } catch (e) {
    LOG.warn('Could not note the app lock of', username, e.message);
  }
}

async function recordAppLockHistory(username, historyKey) {
  if (pollIntervalSec() <= 0 || !historyKey) return;
  try {
    await store.setContextHistoryKey(username, historyKey);
  } catch (e) {
    LOG.warn('Could not link the app lock history for', username, e.message);
  }
}

/** A failed app lock must not leave a note that can explain a later lock by someone else. */
async function discardAppLock(username) {
  if (pollIntervalSec() <= 0) return;
  try {
    await store.discardContext(username);
  } catch (e) {
    LOG.warn('Could not clear the app lock note of', username, e.message);
  }
}

/**
 * Immediately queues a durable notification event and dispatches it for an individual Fiori lock.
 * Never throws: notification errors must never fail the completed SAP lock operation.
 */
async function notifyAppLock({
  username,
  actor,
  reason = '',
  fullName = '',
  change = null,
  now = new Date(),
  retryDelays = defaultRetryDelays(),
} = {}) {
  if (!isEnabled()) return 'off';

  const nowIso = now.toISOString();
  const detected = nowIso.replace(/\D/g, '').slice(0, 14);
  const previousLockedAt = await store.lastLockedAt(username);
  const lockedAt = change && change.lockedAt
    ? change.lockedAt
    : (detected > previousLockedAt ? detected : String(Number(previousLockedAt) + 1));
  const historyKey = change?.historyKey || '';

  const event = {
    username,
    uflag: 64,
    lockedAt,
    lockType: lockLabel(64),
    lockedBy: actor,
    fullName: fullName || '',
    source: SOURCE_APP,
    reason: reason || '',
    bulkRunId: '',
    lockTimestamp: formatLockTimestamp(lockedAt),
    detectedAt: nowIso,
    historyKey,
  };

  try {
    await store.recordAppLockEvent(event);
  } catch (e) {
    LOG.error('Could not persist app lock notification event for', username, e.message);
    return 'failed';
  }

  try {
    await store.discardContext(username);
  } catch (e) {
    LOG.warn('Could not clear the app lock note of', username, e.message);
  }

  try {
    return await sendPending({ retryDelays, now });
  } catch (e) {
    LOG.error('Immediate lock notification dispatch failed for', username, e.message);
    return 'queued';
  }
}

module.exports = {
  recordAppLock,
  recordAppLockHistory,
  discardAppLock,
  notifyAppLock,
};
