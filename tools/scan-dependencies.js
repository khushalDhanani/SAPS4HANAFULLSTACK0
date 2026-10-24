#!/usr/bin/env node
'use strict';

/**
 * tools/scan-dependencies.js
 *
 * Dependency Vulnerability Scanner for Release Automation.
 * Audits production dependencies, parses advisories, and asserts zero critical/unhandled vulnerabilities.
 */

const { execSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function auditDependencies() {
  console.log('[DEPENDENCY SCAN] Running npm audit on production dependencies...');
  try {
    const raw = execSync('npm audit --omit=dev --json', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const parsed = JSON.parse(raw);
    return analyzeAuditReport(parsed);
  } catch (err) {
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        return analyzeAuditReport(parsed);
      } catch (_) {
        // fall through
      }
    }
    return { ok: false, error: err.message };
  }
}

function analyzeAuditReport(report) {
  const metadata = report.metadata || {};
  const vulnerabilities = metadata.vulnerabilities || {};
  const total = vulnerabilities.total || 0;
  const critical = vulnerabilities.critical || 0;
  const high = vulnerabilities.high || 0;
  const moderate = vulnerabilities.moderate || 0;
  const low = vulnerabilities.low || 0;

  console.log(`[DEPENDENCY SCAN] Audit Summary: Total: ${total} (Critical: ${critical}, High: ${high}, Moderate: ${moderate}, Low: ${low})`);

  // Release gate: critical vulnerabilities in production dependencies fail the release
  if (critical > 0) {
    return {
      ok: false,
      error: `Blocked by release gate: ${critical} critical vulnerability/vulnerabilities detected in production dependencies.`
    };
  }

  return {
    ok: true,
    total,
    critical,
    high,
    moderate,
    low,
    message: 'Production dependency audit passed critical severity release gate.'
  };
}

function run() {
  const result = auditDependencies();
  if (!result.ok) {
    console.error(`[DEPENDENCY SCAN] FAILED: ${result.error}`);
    process.exit(1);
  }
  console.log(`[DEPENDENCY SCAN] SUCCESS: ${result.message}\n`);
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = { auditDependencies, analyzeAuditReport };
