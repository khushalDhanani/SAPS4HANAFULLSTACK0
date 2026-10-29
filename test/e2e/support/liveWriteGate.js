'use strict';

/**
 * Tier C SAP round-trip suites run in one of two modes:
 * - dry-run (default): write guard fully on; the flow's single write action is answered by a stub, so the UI flow
 *   (fill → submit → result shown) is exercised with no SAP write. Proves UI wiring only, never SAP persistence.
 * - live: a real SAP write. Allowed only when ALL hold: ALLOW_LIVE_SAP_TOOLS=1, the --allow-live-sap flag,
 *   the flow listed in E2E_SAP_WRITE_FLOWS (comma-separated), and test/e2e/live/testData.json provides that flow's
 *   data with no placeholders. Per AGENTS.md this still needs the user's written go for that specific run.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../live/testData.json');
const PLACEHOLDER = /^(|NOT PROVIDED|TODO|x+|_+|<.*>)$/i;

function placeholders(obj, prefix = '') {
    return Object.entries(obj || {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v))
        ? placeholders(v, `${prefix}${k}.`)
        : (PLACEHOLDER.test(String(v).trim()) ? [`${prefix}${k}`] : []));
}

/** Returns { mode: 'dry-run' } or { mode: 'live', data }; throws when live is requested but not fully authorized. */
function resolveMode(flow, { argv = process.argv, env = process.env, dataFile = DATA_FILE } = {}) {
    const wantsLive = argv.includes('--allow-live-sap') || env.ALLOW_LIVE_SAP_TOOLS === '1'
        || String(env.E2E_SAP_WRITE_FLOWS || '').trim() !== '';
    if (!wantsLive) return { mode: 'dry-run' };

    const flows = String(env.E2E_SAP_WRITE_FLOWS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const missing = [];
    if (env.ALLOW_LIVE_SAP_TOOLS !== '1') missing.push('ALLOW_LIVE_SAP_TOOLS=1');
    if (!argv.includes('--allow-live-sap')) missing.push('--allow-live-sap');
    if (!flows.includes(flow)) missing.push(`E2E_SAP_WRITE_FLOWS containing "${flow}"`);
    if (!fs.existsSync(dataFile)) missing.push(`${path.relative(process.cwd(), dataFile)}`);
    if (missing.length) throw new Error(`Blocked: live SAP write for flow "${flow}" requires ${missing.join(', ')}`);

    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))[flow];
    if (!data) throw new Error(`Blocked: no "${flow}" section in ${dataFile}`);
    const open = placeholders(data);
    if (open.length) throw new Error(`Blocked: placeholder test data for "${flow}": ${open.join(', ')}`);
    return { mode: 'live', data };
}

/**
 * A live write may only reach the SAP target the person running it named: E2E_SAP_LIVE_TARGET must equal the system
 * label the CAP server reports for its S/4 connection (auth getUserInfo().system). Nothing is assumed about which
 * target is non-production; that is the named target's owner's statement, not this code's.
 */
function assertTarget(reportedSystem, env = process.env) {
    const named = String(env.E2E_SAP_LIVE_TARGET || '').trim();
    if (!named) throw new Error('Blocked: live SAP write needs E2E_SAP_LIVE_TARGET=<the SAP system label you authorize>');
    const reported = String(reportedSystem || '').trim();
    if (!reported) throw new Error('Blocked: the CAP server did not report which SAP system it is connected to');
    if (reported !== named) throw new Error(`Blocked: server is connected to "${reported}", but E2E_SAP_LIVE_TARGET authorizes "${named}"`);
}

/**
 * Route handler for the one write action of a live run: logs the exact payload before it is sent, lets the first call
 * through (the guard's own allowlist still applies) and aborts any further call, so one run can never write twice.
 * `seen` collects every payload for the report.
 */
function singleWriteHandler(log, seen = []) {
    return (route) => {
        const payload = route.request().postData();
        if (seen.length >= 1) {
            seen.push({ aborted: true, payload });
            log(`  WRITE ABORTED (a second write in one run): ${payload}`);
            return route.abort('blockedbyclient');
        }
        seen.push({ aborted: false, payload });
        log(`  WRITE about to be sent to SAP: ${payload}`);
        return route.fallback();
    };
}

module.exports = { resolveMode, placeholders, assertTarget, singleWriteHandler, DATA_FILE };
