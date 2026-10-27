'use strict';
/* global window */

/**
 * Performance baseline E2E (P1 item 15), READ-ONLY behind the write guard. For every parameterless route it measures
 * the time from navigation until the screen has settled (no request in flight for 800 ms, busy indicators gone), takes
 * the median of 3 fresh-browser runs and compares it with baseline.json: fail when median > baseline * 1.5 + 1000 ms.
 * The 800 ms quiet window is part of every figure (fixed offset, same in baseline and check). The limits are
 * agent-chosen (baseline + 50 %), NOT business-approved. Record the baseline on purpose with E2E_UPDATE_BASELINE=1
 * (median of 5 runs); it reflects this machine and the live SAP data of that moment, so refresh it when either changes.
 */

const fs = require('fs');
const path = require('path');
const { openSession, inspectScreen } = require('../support/screenCheck');

const ROOT = path.join(__dirname, '../../..');
const BASELINE = path.join(__dirname, 'baseline.json');
const MARGIN = { factor: 1.5, floorMs: 1000 };

function routes() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/fiori-app/webapp/manifest.json'), 'utf8'));
    return manifest['sap.ui5'].routing.routes
        .filter((r) => r.pattern && !r.pattern.includes('{') && r.name !== 'default')
        .map((r) => ({ name: r.name, hash: r.pattern, signedOut: r.name === 'login' }));
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timeRoute(baseUrl, r) {
    const session = await openSession({ baseUrl, user: r.signedOut ? null : 'alice' });
    try {
        const t0 = Date.now();
        await session.page.goto(`${baseUrl}/fiori-app/webapp/index.html#/${r.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
        await session.settle();
        const ms = Date.now() - t0;
        const screen = await inspectScreen(session.page);
        if (screen.route !== r.name) throw new Error(`expected route ${r.name}, got ${screen.route}`);
        return ms;
    } finally {
        await session.close();
    }
}

async function verifyScreenPerformance(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const update = process.env.E2E_UPDATE_BASELINE === '1';
    const runs = update ? 5 : 3;
    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
    const current = {};
    const errors = [];
    console.log(`\n=== Screen performance (median of ${runs} runs, READ-ONLY, write guard on; limit = baseline x${MARGIN.factor} + ${MARGIN.floorMs} ms) ===`);
    for (const r of routes()) {
        try {
            const times = [];
            for (let i = 0; i < runs; i++) times.push(await timeRoute(baseUrl, r));
            current[r.name] = median(times);
            const base = baseline && baseline[r.name];
            const limit = base ? Math.round(base * MARGIN.factor + MARGIN.floorMs) : null;
            const slow = !update && limit !== null && current[r.name] > limit;
            console.log(`  [${slow ? 'FAIL' : 'PASS'}] ${r.name}: ${current[r.name]} ms (runs ${times.join('/')})${base ? `, baseline ${base}, limit ${limit}` : ''}`);
            if (slow) errors.push(`${r.name}: ${current[r.name]} ms exceeds limit ${limit} ms (baseline ${base} ms)`);
            if (!update && baseline && !base) errors.push(`${r.name}: no baseline entry`);
        } catch (err) {
            errors.push(`${r.name}: ${err.name}: ${err.message.split('\n')[0]}`);
            console.log(`  [FAIL] ${r.name}: ${err.message.split('\n')[0]}`);
        }
    }
    if (update && !errors.length) {
        fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
        console.log(`  baseline written: ${path.relative(ROOT, BASELINE)}`);
        return { status: 'PASS', errors: [], details: current };
    }
    if (!baseline && !update) errors.push('no baseline.json: run once with E2E_UPDATE_BASELINE=1');
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: current };
}

if (require.main === module) {
    verifyScreenPerformance().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyScreenPerformance };
