'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const evidence = require('./support/evidence');
const { closeBrowser } = require('./support/screenCheck');
const { startIsolatedServer, assertSapUnreachable } = require('./support/isolatedServer');

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
const { verifyPlantIsolation } = require('./negative/verifyPlantIsolation.e2e');
const { verifyWriteAuthorization } = require('./negative/verifyWriteAuthorization.e2e');
const { verifySubmitFailures, SHARDS: SUBMIT_SHARDS } = require('./negative/verifySubmitFailures.e2e');
const { verifyQuarantineLabels } = require('./wm/verifyQuarantineLabels.e2e');
const { verifyActionFailures, SHARDS: ACTION_SHARDS } = require('./negative/verifyActionFailures.e2e');
const { verifyA11yScreens } = require('./a11y/verifyA11yScreens.e2e');
const { verifyScreenPerformance } = require('./performance/verifyScreenPerformance.e2e');

const targetUrlArg = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
  || process.argv.find(a => a.startsWith('--target-url='))?.split('=')[1]
  || process.env.TARGET_URL
  || process.env.APP_URL
  || 'http://localhost:4004';

// Parallel suites: --workers=N or E2E_WORKERS (default 2). 1 restores strictly sequential runs.
const workersArg = Number(process.argv.find(a => a.startsWith('--workers='))?.split('=')[1] || process.env.E2E_WORKERS) || 2;

// --sap-free: only the suites marked sapFree, against a private test-profile server that cannot reach SAP (the PR gate in CI).
const sapFreeArg = process.argv.includes('--sap-free');

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

async function runSuitesAndSummarize(options) {
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
    { name: 'Negative UI paths', file: 'negative/verifyNegativeUi.e2e.js', fn: verifyNegativeUi, sapFree: true },
    // Authorization: plant isolation as a plant-scoped Viewer (READ-ONLY) and write denial on an isolated server without SAP
    { name: 'Plant isolation', file: 'negative/verifyPlantIsolation.e2e.js', fn: verifyPlantIsolation },
    { name: 'Write authorization (isolated server)', file: 'negative/verifyWriteAuthorization.e2e.js', fn: verifyWriteAuthorization, sapFree: true },
    // Submit-time failures on PO create with the write action mocked per case (UI handling, not SAP)
    ...SUBMIT_SHARDS.map((s) => ({ name: s.name, file: 'negative/verifySubmitFailures.e2e.js', fn: (o) => verifySubmitFailures({ ...o, only: s.only }) })),
    // Quarantine labels screen; the label action is mocked in every case (SAP wrapper not yet activated)
    { name: 'Quarantine labels (mocked)', file: 'wm/verifyQuarantineLabels.e2e.js', fn: verifyQuarantineLabels, sapFree: true },
    // Submit failures on action-style write screens (customer invoice so far); action MOCKED per case
    ...ACTION_SHARDS.map((s) => ({ name: s.name, file: 'negative/verifyActionFailures.e2e.js', fn: (o) => verifyActionFailures({ ...o, only: s.only }) })),
    // P1: axe-core on every parameterless route (new serious/critical violations fail) and screen-load timings vs baseline
    { name: 'Accessibility (axe-core)', file: 'a11y/verifyA11yScreens.e2e.js', fn: verifyA11yScreens },
    // Timing suite: runs alone after the pool drains, so parallel load cannot distort its measurements
    { name: 'Screen performance baseline', file: 'performance/verifyScreenPerformance.e2e.js', fn: verifyScreenPerformance, serial: true }
  ].filter((s) => !options.sapFree || s.sapFree);

  let totalPassed = 0;
  let totalFailed = 0;
  const results = new Array(suites.length);

  async function runSuite(suite, index) {
    const startTime = Date.now();
    console.log(`\n>>> STARTING: ${suite.name} (${suite.file})`);
    evidence.beginSuite(suite.name);
    try {
      const outcome = await suite.fn({ baseUrl });
      const durationMs = Date.now() - startTime;
      const evidenceDir = evidence.endSuite(outcome.status !== 'PASS', testResultsDir);
      if (evidenceDir) console.error(`    evidence (trace + screenshots): ${evidenceDir}`);
      if (outcome.status === 'PASS') {
        totalPassed++;
        console.log(`<<< PASSED: ${suite.name} in ${durationMs}ms`);
      } else {
        totalFailed++;
        console.error(`<<< FAILED: ${suite.name} in ${durationMs}ms — Errors: ${outcome.errors.join('; ')}`);
      }
      results[index] = {
        suite: suite.name,
        file: suite.file,
        status: outcome.status,
        durationMs,
        errors: outcome.errors || [],
        ...(evidenceDir ? { evidence: path.relative(path.resolve(__dirname, '../..'), evidenceDir) } : {})
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const evidenceDir = evidence.endSuite(true, testResultsDir);
      totalFailed++;
      console.error(`<<< EXCEPTION in ${suite.name} (${durationMs}ms):`, err.message);
      results[index] = {
        suite: suite.name,
        file: suite.file,
        status: 'FAIL',
        durationMs,
        errors: [err.message],
        ...(evidenceDir ? { evidence: path.relative(path.resolve(__dirname, '../..'), evidenceDir) } : {})
      };
    }
  }

  // Bounded pool: `workers` suites at a time, each in its own async chain (evidence is per chain). All suites here
  // are read-only or mock their write action; live SAP writes live in runSapRoundTrips.js and are never parallel.
  const workers = Math.max(1, Math.min(options.workers || workersArg, suites.length));
  const queue = suites.map((suite, index) => ({ suite, index })).filter((e) => !e.suite.serial);
  console.log(`Workers:     ${workers}`);
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await runSuite(next.suite, next.index);
  }));
  for (const [index, suite] of suites.entries()) if (suite.serial) await runSuite(suite, index);

  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl,
    ...(options.sapFree ? { mode: 'sap-free' } : {}),
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

  return summary;
}

// Sole owner of the shared Chromium shutdown: suites close only their contexts, never the browser.
async function runAll(options = {}) {
  let server = null;
  try {
    if (options.sapFree) {
      server = await startIsolatedServer();
      await assertSapUnreachable(server);
      options = { ...options, baseUrl: server.baseUrl };
    }
    return await runSuitesAndSummarize(options);
  } finally {
    await closeBrowser();
    if (server) await server.stop();
  }
}

if (require.main === module) {
  runAll({ sapFree: sapFreeArg }).then(summary => process.exit(summary.failed === 0 ? 0 : 1)).catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}

module.exports = { runAll, checkServerHealth };
