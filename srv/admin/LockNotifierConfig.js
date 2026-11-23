'use strict';

/**
 * LockNotifierConfig
 *
 * Configuration, profile resolution, and timing constants for the SAP user lock monitor.
 */

const mailer = require('../common/mailer');

const DEFAULT_INTERVAL_SEC = 5;
const DEFAULT_MAX_PER_EMAIL = 50;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_LEASE_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 30;
const STALE_AFTER_INTERVALS = 3;
const MAX_CURSOR_STALL_CYCLES = 5;
const CURSOR_STALL_ERROR = `USH02 cursor did not advance for ${MAX_CURSOR_STALL_CYCLES} consecutive polls`;

// The local Docker dev profile runs NODE_ENV=test; LOCK_MONITOR_IN_TEST=1 lets the monitor run there like a real server.
const isTestProfile = (env = process.env) => env.NODE_ENV === 'test' && String(env.LOCK_MONITOR_IN_TEST || '').trim() !== '1';
const defaultRetryDelays = () => (isTestProfile() ? [0, 0, 0] : RETRY_DELAYS_MS);

const recipients = (env = process.env) => String(env.LOCK_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
// Email only. Detection and storage of locks run without it; see startJob and pollOnce.
const isEnabled = () => mailer.isConfigured() && recipients().length > 0;

function positiveInt(value, fallback, { allowZero = false } = {}) {
  const n = Number(value);
  const valid = value !== undefined && value !== '' && Number.isInteger(n) && (allowZero ? n >= 0 : n > 0);
  return valid ? n : fallback;
}
const pollIntervalSec = (env = process.env) => positiveInt(env.LOCK_POLL_INTERVAL_SEC, DEFAULT_INTERVAL_SEC, { allowZero: true });
const maxPerEmail = (env = process.env) => positiveInt(env.LOCK_MAX_PER_EMAIL, DEFAULT_MAX_PER_EMAIL);

module.exports = {
  DEFAULT_INTERVAL_SEC,
  DEFAULT_MAX_PER_EMAIL,
  RETRY_DELAYS_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  STALE_AFTER_INTERVALS,
  MAX_CURSOR_STALL_CYCLES,
  CURSOR_STALL_ERROR,
  isTestProfile,
  defaultRetryDelays,
  recipients,
  isEnabled,
  positiveInt,
  pollIntervalSec,
  maxPerEmail,
};
