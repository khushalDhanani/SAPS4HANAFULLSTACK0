'use strict';

/**
 * LockNotifierStatus
 *
 * Status and health reporter for the SAP user lock monitor.
 */

const store = require('./lockEventStore');
const LOG = require('../common/logger')('lock-monitor');

const {
  STALE_AFTER_INTERVALS,
  recipients,
  isEnabled,
  pollIntervalSec,
  maxPerEmail,
} = require('./LockNotifierConfig');

/** What the SU01 header shows. Read from the database, because the instance answering may not run the job. */
async function monitorStatus(now = new Date()) {
  const settings = {
    recipient: recipients().join(', '),
    pollIntervalSec: pollIntervalSec(),
    maxPerEmail: maxPerEmail(),
    emailEnabled: isEnabled(),
  };
  const baseHealth = {
    lastSuccessfulPollAt: null,
    lastFailedPollAt: null,
    pollDurationMs: null,
    lastNotificationDispatchedAt: null,
    pendingNotificationCount: 0,
    failedNotificationCount: 0,
  };
  if (settings.pollIntervalSec <= 0) {
    return { state: 'off', lastCheckedAt: null, pendingEmails: 0, ...settings, ...baseHealth };
  }
  try {
    const monitor = await store.readMonitor();
    const pending = await store.pendingEvents();
    const failed = await store.failedEvents();
    const lastSent = monitor?.lastNotificationDispatchedAt || (await store.lastDispatchedAt()) || null;
    const healthInfo = {
      lastSuccessfulPollAt: monitor ? monitor.lastSuccessfulPollAt || null : null,
      lastFailedPollAt: monitor ? monitor.lastFailedPollAt || null : null,
      pollDurationMs: monitor?.pollDurationMs ?? null,
      lastNotificationDispatchedAt: lastSent,
      pendingNotificationCount: pending.length,
      failedNotificationCount: failed.length,
    };
    const base = {
      lastCheckedAt: monitor ? monitor.lastCheckedAt : null,
      pendingEmails: pending.length,
      ...settings,
      ...healthInfo,
    };
    if (!monitor) return { state: 'starting', ...base };
    if (monitor.lastStatus !== 'ok') return { state: 'failed', errorMessage: monitor.errorMessage || '', ...base };
    const age = now.getTime() - new Date(monitor.lastCheckedAt).getTime();
    return {
      state: age > settings.pollIntervalSec * 1000 * STALE_AFTER_INTERVALS ? 'stale' : 'ok',
      errorMessage: monitor.errorMessage || '',
      ...base,
    };
  } catch (e) {
    LOG.error('Could not read the lock monitor state:', e.message);
    return {
      state: 'failed',
      errorMessage: 'Lock monitor status could not be read',
      lastCheckedAt: null,
      pendingEmails: 0,
      ...settings,
      ...baseHealth,
    };
  }
}

/** queued until the monitor has reported the run; retrying if its email has failed and stays queued. */
async function bulkEmailStatus(bulkRunId) {
  if (!isEnabled()) return { status: 'not_configured' };
  const events = await store.eventsOfRun(bulkRunId);
  if (!events.length) return { status: 'queued' };
  if (events.every((event) => event.status === 'sent')) return { status: 'sent' };
  return { status: events.some((event) => event.attempts > 0) ? 'retrying' : 'queued' };
}

module.exports = {
  monitorStatus,
  bulkEmailStatus,
};
