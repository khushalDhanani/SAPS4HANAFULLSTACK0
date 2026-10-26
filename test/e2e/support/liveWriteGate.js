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

module.exports = { resolveMode, placeholders, DATA_FILE };
