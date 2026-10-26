'use strict';

/**
 * Business E2E coverage governance (AGENTS.md): docs/e2e-coverage-matrix.md must have exactly one row per
 * manifest route, valid statuses, a reason for every N/A or partial status, and cite an existing Playwright
 * suite for every covered/partial status. Every browser suite must appear in the matrix, and Jest test files
 * must not live under test/e2e (Playwright is the only browser E2E framework).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const STATUSES = ['🟢', '🟡', '🔴', 'N/A'];

function matrixRows() {
    const md = fs.readFileSync(path.join(ROOT, 'docs/e2e-coverage-matrix.md'), 'utf8');
    const section = md.slice(md.indexOf('## Route coverage'), md.indexOf('## Required negative'));
    return section.split('\n')
        .filter((l) => /^\| `[^`]+` \|/.test(l))
        .map((l) => {
            const cells = l.split('|').slice(1, -1).map((c) => c.trim());
            return { route: cells[0].replace(/`/g, ''), browser: cells[4], sap: cells[5], notes: cells[6] || '', cells: cells.length };
        });
}

function e2eSuites(dir = path.join(ROOT, 'test/e2e')) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e2eSuites(p);
        return [path.relative(ROOT, p).split(path.sep).join('/')];
    });
}

describe('business E2E coverage matrix', () => {
    const rows = matrixRows();
    const manifest = require(path.join(ROOT, 'app/fiori-app/webapp/manifest.json'));
    const routes = manifest['sap.ui5'].routing.routes.map((r) => r.name);

    it('has exactly one row per manifest route and no rows for removed routes', () => {
        const names = rows.map((r) => r.route);
        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort()).toEqual([...routes].sort());
    });

    it('uses valid statuses with the expected columns', () => {
        rows.forEach((r) => {
            expect([r.route, r.cells]).toEqual([r.route, 7]);
            expect([r.route, STATUSES.includes(r.browser), STATUSES.includes(r.sap)]).toEqual([r.route, true, true]);
        });
    });

    it('gives a reason for every N/A or partial status', () => {
        rows.filter((r) => [r.browser, r.sap].some((s) => s === 'N/A' || s === '🟡'))
            .forEach((r) => expect([r.route, r.notes.length > 10]).toEqual([r.route, true]));
    });

    it('cites an existing Playwright suite for every covered or partial status', () => {
        rows.filter((r) => [r.browser, r.sap].some((s) => s === '🟢' || s === '🟡')).forEach((r) => {
            const cited = [...r.notes.matchAll(/`(test\/e2e\/[^`]+\.e2e\.js)`/g)].map((m) => m[1]);
            expect([r.route, cited.length > 0]).toEqual([r.route, true]);
            cited.forEach((f) => expect([r.route, f, fs.existsSync(path.join(ROOT, f))]).toEqual([r.route, f, true]));
        });
    });

    it('lists every Playwright suite in the matrix', () => {
        const md = fs.readFileSync(path.join(ROOT, 'docs/e2e-coverage-matrix.md'), 'utf8');
        e2eSuites().filter((f) => f.endsWith('.e2e.js')).forEach((f) => expect([f, md.includes(f)]).toEqual([f, true]));
    });

    it('keeps Jest tests out of test/e2e', () => {
        expect(e2eSuites().filter((f) => f.endsWith('.test.js'))).toEqual([]);
    });
});
