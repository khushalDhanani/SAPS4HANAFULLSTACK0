'use strict';

/**
 * E2E runner governance: every Playwright suite file is registered in a runner (no suite can be added and silently
 * never run), and failure evidence is kept only for failed suites.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const evidence = require('../../e2e/support/evidence');

const E2E = path.join(__dirname, '../../e2e');
const RUNNERS = ['runAllE2E.js', 'runSapRoundTrips.js'].map((f) => fs.readFileSync(path.join(E2E, f), 'utf8'));

function suiteFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? suiteFiles(p) : (e.name.endsWith('.e2e.js') ? [p] : []);
    });
}

describe('E2E suite registration', () => {
    it('finds suites to check', () => {
        expect(suiteFiles(E2E).length).toBeGreaterThan(20);
    });

    it('registers every *.e2e.js suite in runAllE2E.js or runSapRoundTrips.js', () => {
        const unregistered = suiteFiles(E2E)
            .map((f) => path.basename(f, '.js'))
            .filter((name) => !RUNNERS.some((src) => src.includes(`/${name}'`)));
        expect(unregistered).toEqual([]);
    });
});

describe('SAP-free browser E2E PR gate', () => {
    const yaml = require('yaml'); // shortcut: transitive via @sap/cds, add as devDependency if cds ever drops it
    const ci = yaml.parse(fs.readFileSync(path.join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8'));
    const job = ci.jobs['browser-e2e-sap-free'];

    it('marks exactly the suites that pass without SAP', () => {
        const sapFree = RUNNERS[0].split('\n').filter((l) => l.includes('sapFree: true')).map((l) => l.match(/file: '([^']+)'/)[1]);
        expect(sapFree).toEqual(['negative/verifyNegativeUi.e2e.js', 'negative/verifyWriteAuthorization.e2e.js', 'wm/verifyQuarantineLabels.e2e.js']);
    });

    it('runs on every push and PR, without SAP environment or secrets', () => {
        expect(Object.keys(ci.on)).toEqual(expect.arrayContaining(['push', 'pull_request']));
        expect(job.if).toBeUndefined();
        expect(job.environment).toBeUndefined();
        expect(JSON.stringify(job)).not.toMatch(/secrets\.|S4_|ALLOW_LIVE_SAP/);
        expect(job.steps.map((s) => s.run)).toContain('npm run test:e2e:sap-free');
    });
});

describe('E2E failure evidence', () => {
    const fakeSession = () => {
        const calls = [];
        return {
            calls,
            context: { tracing: { start: async () => calls.push('start'), stop: async ({ path: p }) => { fs.writeFileSync(p, 'zip'); calls.push('stop'); } } },
            page: { screenshot: async ({ path: p }) => { fs.writeFileSync(p, 'png'); } }
        };
    };
    let results;
    beforeEach(() => { results = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-test-')); });
    afterEach(() => fs.rmSync(results, { recursive: true, force: true }));

    it('records nothing outside a suite', async () => {
        expect(await evidence.startSession(fakeSession().context)).toBeNull();
    });

    it('keeps trace and screenshot of a failed suite', async () => {
        const s = fakeSession();
        evidence.beginSuite('Submit failures (mocked)');
        await (await evidence.startSession(s.context)).capture(s.page);
        const dir = evidence.endSuite(true, results);
        expect(dir).toBe(path.join(results, 'e2e-evidence', 'submit-failures-mocked'));
        expect(fs.readdirSync(dir).sort()).toEqual(['session-1.png', 'session-1.zip']);
    });

    it('drops the evidence of a passed suite', async () => {
        const s = fakeSession();
        evidence.beginSuite('Passing suite');
        await (await evidence.startSession(s.context)).capture(s.page);
        expect(evidence.endSuite(false, results)).toBeNull();
        expect(fs.existsSync(path.join(results, 'e2e-evidence'))).toBe(false);
    });

    it('keeps the evidence of parallel suites apart', async () => {
        const worker = async (name, failed) => {
            for (const i of [1, 2]) {
                if (i === 1) evidence.beginSuite(name);
                const s = fakeSession();
                await new Promise((r) => setTimeout(r, 5));
                await (await evidence.startSession(s.context)).capture(s.page);
            }
            return evidence.endSuite(failed, results);
        };
        const [a, b] = await Promise.all([worker('Suite A', true), worker('Suite B', true)]);
        expect(a).toBe(path.join(results, 'e2e-evidence', 'suite-a'));
        expect(b).toBe(path.join(results, 'e2e-evidence', 'suite-b'));
        expect(fs.readdirSync(a).length).toBe(4);
        expect(fs.readdirSync(b).length).toBe(4);
    });

    it('keeps only the last 8 sessions of a long suite', async () => {
        evidence.beginSuite('Long');
        for (let i = 0; i < 10; i++) {
            const s = fakeSession();
            await (await evidence.startSession(s.context)).capture(s.page);
        }
        expect(fs.readdirSync(evidence.endSuite(true, results)).length).toBe(16);
    });
});
