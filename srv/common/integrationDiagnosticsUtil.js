'use strict';

/**
 * integrationDiagnosticsUtil.js
 *
 * Helper utilities, stage measurement, and URL redaction for integration diagnostics.
 */

const NEVER_SENT_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET',
]);

function redactUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return String(url).split('?')[0];
  }
}

async function measureStage(stageName, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    return {
      stage: stageName,
      status: 'PASSED',
      details: typeof details === 'string' ? details : `${stageName} verified successfully.`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      stage: stageName,
      status: 'FAILED',
      details: String(err && err.message ? err.message : err).split('\n')[0],
      latencyMs: Date.now() - start,
      _err: err,
    };
  }
}

function skippedStage(stageName, reason) {
  return {
    stage: stageName,
    status: 'SKIPPED',
    details: `Prerequisite stage failed: ${reason}`,
    latencyMs: 0,
  };
}

module.exports = {
  NEVER_SENT_CODES,
  redactUrl,
  measureStage,
  skippedStage,
};
