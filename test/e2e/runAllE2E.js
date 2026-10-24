'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const { runHardeningE2E } = require('./wm/verifyHardeningUI.e2e');
const { verifyMvt201 } = require('./wm/verifyMvt201.e2e');
const { verifyMvt241 } = require('./wm/verifyMvt241.e2e');
const { verifyMvt261 } = require('./wm/verifyMvt261.e2e');
const { verifyMvt301 } = require('./wm/verifyMvt301.e2e');
const { verifyMvt311 } = require('./wm/verifyMvt311.e2e');

async function checkServerHealth(urlStr = 'http://localhost:4004/fiori-app/webapp/index.html') {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const req = http.get({
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        timeout: 3000
      }, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

async function runAll() {
  console.log('================================================================');
  console.log(' RUNNING PLAYWRIGHT E2E TEST SUITE RUNNER');
  console.log('================================================================\n');

  const isServerUp = await checkServerHealth();
  if (!isServerUp) {
    console.error('ERROR: Local development server is not running or not responding at http://localhost:4004.');
    console.error('Please start the server before running Playwright E2E tests (e.g. npm start or cds watch).');
    process.exit(1);
  }

  const results = [];
  const testResultsDir = path.resolve(__dirname, '../../test-results');
  if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, { recursive: true });
  }

  const suites = [
    {
      name: 'UI Hardening & Rapid Submission',
      file: 'verifyHardeningUI.e2e.js',
      fn: async () => {
        await runHardeningE2E();
        return { status: 'PASS', errors: [] };
      }
    },
    {
      name: 'Movement 201 (GI to Cost Center)',
      file: 'verifyMvt201.e2e.js',
      fn: async () => {
        const res = await verifyMvt201();
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 241 (GI to Asset)',
      file: 'verifyMvt241.e2e.js',
      fn: async () => {
        const res = await verifyMvt241();
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 261 (GI to Internal Order)',
      file: 'verifyMvt261.e2e.js',
      fn: async () => {
        const res = await verifyMvt261();
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 301 (Plant-to-Plant Transfer)',
      file: 'verifyMvt301.e2e.js',
      fn: async () => {
        const res = await verifyMvt301();
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 311 (SLoc-to-SLoc Transfer)',
      file: 'verifyMvt311.e2e.js',
      fn: async () => {
        const res = await verifyMvt311();
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    }
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    const startTime = Date.now();
    console.log(`\n>>> STARTING: ${suite.name} (${suite.file})`);
    try {
      const outcome = await suite.fn();
      const durationMs = Date.now() - startTime;
      if (outcome.status === 'PASS') {
        totalPassed++;
        console.log(`<<< PASSED: ${suite.name} in ${durationMs}ms`);
      } else {
        totalFailed++;
        console.error(`<<< FAILED: ${suite.name} in ${durationMs}ms — Errors: ${outcome.errors.join('; ')}`);
      }
      results.push({
        suite: suite.name,
        file: suite.file,
        status: outcome.status,
        durationMs,
        errors: outcome.errors || []
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      totalFailed++;
      console.error(`<<< EXCEPTION in ${suite.name} (${durationMs}ms):`, err.message);
      results.push({
        suite: suite.name,
        file: suite.file,
        status: 'FAIL',
        durationMs,
        errors: [err.message]
      });
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totalSuites: suites.length,
    passed: totalPassed,
    failed: totalFailed,
    status: totalFailed === 0 ? 'PASS' : 'FAIL',
    results
  };

  const summaryPath = path.join(testResultsDir, 'e2e-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log(' E2E PLAYWRIGHT SUITE SUMMARY');
  console.log('================================================================');
  console.log(`Total: ${suites.length} | Passed: ${totalPassed} | Failed: ${totalFailed}`);
  console.log(`Report written to: ${summaryPath}`);
  console.log('================================================================\n');

  process.exit(totalFailed === 0 ? 0 : 1);
}

if (require.main === module) {
  runAll().catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}

module.exports = { runAll, checkServerHealth };
