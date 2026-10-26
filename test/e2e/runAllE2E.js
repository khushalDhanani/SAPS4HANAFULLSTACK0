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
const { verifyShellScreens } = require('./shell/verifyShellScreens.e2e');
const { verifyMmScreens } = require('./mm/verifyMmScreens.e2e');
const { verifySdScreens } = require('./sd/verifySdScreens.e2e');
const { verifyLeScreens } = require('./le/verifyLeScreens.e2e');
const { verifyWmScreens } = require('./wm/verifyWmScreens.e2e');
const { verifyNegativeUi } = require('./negative/verifyNegativeUi.e2e');

const targetUrlArg = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
  || process.argv.find(a => a.startsWith('--target-url='))?.split('=')[1]
  || process.env.TARGET_URL
  || process.env.APP_URL
  || 'http://localhost:4004';

async function checkServerHealth(urlStr) {
  const target = (urlStr || targetUrlArg).replace(/\/+$/, '');
  const checkUrl = `${target}/fiori-app/webapp/index.html`;

  return new Promise((resolve) => {
    try {
      const u = new URL(checkUrl);
      const req = http.get({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        timeout: 5000
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

async function runAll(options = {}) {
  const baseUrl = (options.baseUrl || targetUrlArg).replace(/\/+$/, '');

  console.log('================================================================');
  console.log(' RUNNING PLAYWRIGHT E2E TEST SUITE RUNNER');
  console.log('================================================================');
  console.log(`Target URL:  ${baseUrl}`);
  console.log(`Timestamp:   ${new Date().toISOString()}`);
  console.log('================================================================\n');

  const isServerUp = await checkServerHealth(baseUrl);
  if (!isServerUp) {
    console.error(`ERROR: Server is not running or not responding at ${baseUrl}.`);
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
      fn: async (opts) => {
        const res = await runHardeningE2E(opts);
        const pass = res && res.status === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res?.errors || [], details: res?.details };
      }
    },
    {
      name: 'Movement 201 (GI to Cost Center)',
      file: 'verifyMvt201.e2e.js',
      fn: async (opts) => {
        const res = await verifyMvt201(opts);
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 241 (GI to Asset)',
      file: 'verifyMvt241.e2e.js',
      fn: async (opts) => {
        const res = await verifyMvt241(opts);
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 261 (GI to Internal Order)',
      file: 'verifyMvt261.e2e.js',
      fn: async (opts) => {
        const res = await verifyMvt261(opts);
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 301 (Plant-to-Plant Transfer)',
      file: 'verifyMvt301.e2e.js',
      fn: async (opts) => {
        const res = await verifyMvt301(opts);
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    {
      name: 'Movement 311 (SLoc-to-SLoc Transfer)',
      file: 'verifyMvt311.e2e.js',
      fn: async (opts) => {
        const res = await verifyMvt311(opts);
        const pass = res.ui === 'PASS' && res.playwright === 'PASS' && res.network === 'PASS' && res.console === 'PASS' && (!res.errors || res.errors.length === 0);
        return { status: pass ? 'PASS' : 'FAIL', errors: res.errors || [], details: res.details };
      }
    },
    // Tier A read-only screen suites (write guard on); they already return { status, errors, details }
    { name: 'Shell screens', file: 'shell/verifyShellScreens.e2e.js', fn: verifyShellScreens },
    { name: 'MM screens', file: 'mm/verifyMmScreens.e2e.js', fn: verifyMmScreens },
    { name: 'SD screens', file: 'sd/verifySdScreens.e2e.js', fn: verifySdScreens },
    { name: 'LE screens', file: 'le/verifyLeScreens.e2e.js', fn: verifyLeScreens },
    { name: 'WM screens', file: 'wm/verifyWmScreens.e2e.js', fn: verifyWmScreens },
    // Tier B negative paths (write guard on; list failures use a mocked 500, not SAP)
    { name: 'Negative UI paths', file: 'negative/verifyNegativeUi.e2e.js', fn: verifyNegativeUi }
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    const startTime = Date.now();
    console.log(`\n>>> STARTING: ${suite.name} (${suite.file})`);
    try {
      const outcome = await suite.fn({ baseUrl });
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
    baseUrl,
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

  if (require.main === module) {
    process.exit(totalFailed === 0 ? 0 : 1);
  }

  return summary;
}

if (require.main === module) {
  runAll().catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}

module.exports = { runAll, checkServerHealth };
