'use strict';

/**
 * Failure evidence for the browser E2E runner (runAllE2E.js). While a suite runs, every session records a Playwright
 * trace (screenshots + DOM snapshots) and a final screenshot into a temp dir; when the suite fails the dir is kept
 * under test-results/e2e-evidence/<suite>/, otherwise it is deleted. Outside the runner no suite is active and
 * nothing is recorded. View a trace with: npx playwright show-trace <file>.zip
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_SESSIONS = 8; // a suite with many sessions (e.g. submit failures) keeps only the last ones
let current = null;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function beginSuite(name) {
    current = { name, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-evidence-')), n: 0 };
}

/** Keeps the evidence of a failed suite under `${resultsDir}/e2e-evidence/<suite>`; returns that path or null. */
function endSuite(failed, resultsDir) {
    if (!current) return null;
    const { name, dir } = current;
    current = null;
    if (!failed || fs.readdirSync(dir).length === 0) {
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
    }
    const target = path.join(resultsDir, 'e2e-evidence', slug(name));
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(dir, target, { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    return target;
}

/** Starts tracing for one session; returns { capture(page) } or null when no suite is active. */
async function startSession(context) {
    if (!current) return null;
    const suite = current;
    await context.tracing.start({ screenshots: true, snapshots: true });
    return {
        async capture(page) {
            const n = ++suite.n;
            await page.screenshot({ path: path.join(suite.dir, `session-${n}.png`) }).catch(() => {});
            await context.tracing.stop({ path: path.join(suite.dir, `session-${n}.zip`) }).catch(() => {});
            const old = n - KEEP_SESSIONS;
            if (old > 0) ['png', 'zip'].forEach((ext) => fs.rmSync(path.join(suite.dir, `session-${old}.${ext}`), { force: true }));
        }
    };
}

module.exports = { beginSuite, endSuite, startSession };
