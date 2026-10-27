'use strict';
/* global window, document */

/**
 * Accessibility E2E (P1 item 14): axe-core (WCAG 2.0/2.1 A and AA) runs on every parameterless route of the UI5 app
 * in a real browser, READ-ONLY behind the write guard. Only serious/critical violations count. Existing violations are
 * recorded in baseline.json (route -> rule ids) so the suite fails only on NEW ones; refresh the baseline on purpose
 * with E2E_UPDATE_BASELINE=1 (it never removes the reviewer's attention: the diff of baseline.json shows what changed).
 * Routes with a path parameter (detail screens) are not covered here.
 */

const fs = require('fs');
const path = require('path');
const { openSession, inspectScreen } = require('../support/screenCheck');
const rt = require('../support/actionRoundTrip');

const ROOT = path.join(__dirname, '../../..');
const BASELINE = path.join(__dirname, 'baseline.json');
const AXE = require.resolve('axe-core/axe.min.js', { paths: [ROOT] });
const IMPACTS = new Set(['serious', 'critical']);

function routes() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/fiori-app/webapp/manifest.json'), 'utf8'));
    return manifest['sap.ui5'].routing.routes
        .filter((r) => r.pattern && !r.pattern.includes('{') && r.name !== 'default')
        .map((r) => ({ name: r.name, hash: r.pattern, signedOut: r.name === 'login' }));
}

/** { ruleId: affectedNodeCount } of serious/critical violations on the displayed screen. */
async function scan(page) {
    await page.addScriptTag({ path: AXE });
    const found = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
        .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))));
    return Object.fromEntries(found.filter((v) => IMPACTS.has(v.impact)).map((v) => [v.id, v.nodes]));
}

async function verifyA11yScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const update = process.env.E2E_UPDATE_BASELINE === '1';
    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
    const current = {};
    const errors = [];
    console.log('\n=== Accessibility (axe-core, serious/critical; READ-ONLY, write guard on) ===');
    for (const r of routes()) {
        const session = await openSession({ baseUrl, user: r.signedOut ? null : 'alice' });
        try {
            await rt.openHash(session, r.hash);
            const screen = await inspectScreen(session.page);
            if (screen.route !== r.name) throw new Error(`expected route ${r.name}, got ${screen.route}`);
            current[r.name] = await scan(session.page);
            const fresh = baseline ? Object.keys(current[r.name]).filter((id) => !(baseline[r.name] || {})[id]) : [];
            const line = Object.entries(current[r.name]).map(([id, n]) => `${id}×${n}`).join(', ') || 'no serious/critical violations';
            console.log(`  [${fresh.length ? 'FAIL' : 'PASS'}] ${r.name}: ${line}`);
            fresh.forEach((id) => errors.push(`${r.name}: new violation ${id} (${current[r.name][id]} nodes) not in baseline`));
        } catch (err) {
            errors.push(`${r.name}: ${err.name}: ${err.message.split('\n')[0]}`);
            console.log(`  [FAIL] ${r.name}: ${err.message.split('\n')[0]}`);
        } finally {
            await session.close();
        }
    }
    if (update && !errors.some((e) => !e.includes('not in baseline'))) {
        fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
        console.log(`  baseline written: ${path.relative(ROOT, BASELINE)}`);
        return { status: 'PASS', errors: [], details: current };
    }
    if (!baseline) errors.push('no baseline.json: run once with E2E_UPDATE_BASELINE=1 and review the result');
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: current };
}

if (require.main === module) {
    verifyA11yScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyA11yScreens };
