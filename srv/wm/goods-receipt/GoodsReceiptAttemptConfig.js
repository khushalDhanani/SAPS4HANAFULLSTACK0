'use strict';

/**
 * GoodsReceiptAttemptConfig.js
 *
 * Entity names, status classifications, and timing configurations for Goods Receipt attempt tracking.
 */

const ATTEMPT_ENTITY = 'saps4hana.wm.GoodsReceiptPostingAttempt';
const RECEIPT_MOVEMENT = '101';
const OPEN_STATUSES = ['sending', 'unconfirmed'];
const FINAL_STATUSES = ['posted', 'rejected', 'not_posted'];

function recheckIntervalMs() {
  const v = parseInt(process.env.RECEIPT_RECHECK_INTERVAL_MS || process.env.ATTEMPT_RECHECK_INTERVAL_MS || '60000', 10);
  return isNaN(v) ? 60000 : v;
}

function recheckAgeMs() {
  const v = parseInt(process.env.RECEIPT_RECHECK_AGE_MS || '180000', 10);
  return isNaN(v) ? 180000 : v;
}

function notPostedAgeMs() {
  const v = parseInt(process.env.RECEIPT_NOT_POSTED_AGE_MS || '900000', 10);
  return isNaN(v) ? 900000 : v;
}

function unconfirmedMaxAgeMs() {
  const v = parseInt(process.env.RECEIPT_UNCONFIRMED_MAX_AGE_MS || '1800000', 10);
  return isNaN(v) ? 1800000 : v;
}

function distributedLeaseDurationMs() {
  const v = parseInt(process.env.RECEIPT_RECHECK_LEASE_MS || '30000', 10);
  return isNaN(v) ? 30000 : v;
}

module.exports = {
  ATTEMPT_ENTITY,
  RECEIPT_MOVEMENT,
  OPEN_STATUSES,
  FINAL_STATUSES,
  recheckIntervalMs,
  recheckAgeMs,
  notPostedAgeMs,
  unconfirmedMaxAgeMs,
  distributedLeaseDurationMs,
};
