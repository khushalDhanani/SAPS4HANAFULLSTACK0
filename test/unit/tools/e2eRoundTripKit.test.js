'use strict';

/**
 * Status logic of the Tier C runners, with no browser and no SAP: the mode resolves to dry-run from a cleared
 * environment, dryRun/live and every suite are stubs, /health is a loopback stub, and the results file is not written.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { runSuite } = require('../../e2e/wm/wmRoundTripKit');
const { runSapRoundTrips, SUITES } = require('../../e2e/runSapRoundTrips');
const { skippedSteps } = require('../../e2e/runAllE2E');

const LIVE_KEYS = ['ALLOW_LIVE_SAP_TOOLS', 'E2E_SAP_WRITE_FLOWS', 'E2E_SAP_FLOWS', 'TARGET_URL'];
const RESULTS_FILE = path.join(__dirname, '../../../test-results/e2e-sap-round-trips.json');

const savedEnv = {};
beforeEach(() => {
    LIVE_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    LIVE_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
    jest.restoreAllMocks();
});

describe('wmRoundTripKit.runSuite status', () => {
    let health;
    let baseUrl;
    beforeAll((done) => {
        health = http.createServer((_req, res) => res.end('{"status":"UP"}'));
        health.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${health.address().port}`; done(); });
    });
    afterAll((done) => { health.close(done); });

    const run = async (dryRunResult) => {
        const live = jest.fn();
        const dryRun = jest.fn(async () => dryRunResult);
        const result = await runSuite({ flow: 'kitTest', title: 'kit test', dryRun, live }, { baseUrl });
        expect(dryRun).toHaveBeenCalledWith(baseUrl);
        expect(live).not.toHaveBeenCalled();
        expect(result.mode).toBe('dry-run');
        return result;
    };

    it('is PARTIAL when every sub-case is SKIPPED', async () => {
        const { status } = await run({ errors: [], details: { subcases: { a: { status: 'SKIPPED' }, b: { status: 'SKIPPED' } } } });
        expect(status).toBe('PARTIAL');
    });

    it('is PARTIAL when subcases is empty', async () => {
        const { status } = await run({ errors: [], details: { subcases: {} } });
        expect(status).toBe('PARTIAL');
    });

    it('is PASS when one sub-case ran and one was skipped', async () => {
        const { status } = await run({ errors: [], details: { subcases: { a: { status: 'PASS' }, b: { status: 'SKIPPED' } } } });
        expect(status).toBe('PASS');
    });

    it('is PASS when a sub-case carries no status', async () => {
        const { status } = await run({ errors: [], details: { subcases: { a: { document: '1' } } } });
        expect(status).toBe('PASS');
    });

    it('is PASS when the suite reports no subcases', async () => {
        const { status } = await run({ errors: [], details: {} });
        expect(status).toBe('PASS');
    });

    it('is FAIL with the errors when the suite reports errors, even if every sub-case is SKIPPED', async () => {
        const result = await run({ errors: ['screen did not open'], details: { subcases: { a: { status: 'SKIPPED' } } } });
        expect(result.status).toBe('FAIL');
        expect(result.errors).toEqual(['screen did not open']);
    });
});

describe('runSapRoundTrips with E2E_SAP_FLOWS', () => {
    let suiteStubs;
    let written;
    const realFns = SUITES.map((s) => s.fn);

    beforeEach(() => {
        suiteStubs = SUITES.map((s) => { s.fn = jest.fn(async () => ({ status: 'PASS', mode: 'dry-run', errors: [] })); return s.fn; });
        written = [];
        const realWrite = fs.writeFileSync;
        const realMkdir = fs.mkdirSync;
        jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...rest) => {
            if (file === RESULTS_FILE) { written.push(JSON.parse(rest[0])); return undefined; }
            return realWrite(file, ...rest);
        });
        jest.spyOn(fs, 'mkdirSync').mockImplementation((dir, ...rest) => (dir === path.dirname(RESULTS_FILE) ? undefined : realMkdir(dir, ...rest)));
    });
    afterEach(() => {
        SUITES.forEach((s, i) => { s.fn = realFns[i]; });
    });

    const ran = () => suiteStubs.filter((fn) => fn.mock.calls.length > 0).length;

    it('returns one FAIL result naming an unknown flow and runs no suite', async () => {
        process.env.E2E_SAP_FLOWS = 'notAFlow';
        const results = await runSapRoundTrips({ baseUrl: 'http://127.0.0.1:1' });
        expect(results).toEqual([{ flow: '*', suite: 'E2E_SAP_FLOWS', status: 'FAIL', mode: 'none', errors: ['unknown flow(s): notAFlow'] }]);
        expect(ran()).toBe(0);
    });

    it('runs no suite when a known flow is listed next to an unknown one', async () => {
        process.env.E2E_SAP_FLOWS = 'po,notAFlow';
        const results = await runSapRoundTrips({ baseUrl: 'http://127.0.0.1:1' });
        expect(results.map((r) => r.status)).toEqual(['FAIL']);
        expect(ran()).toBe(0);
    });

    it('runs exactly the listed suite when the flow is known', async () => {
        process.env.E2E_SAP_FLOWS = 'po';
        const results = await runSapRoundTrips({ baseUrl: 'http://127.0.0.1:1' });
        expect(results.map((r) => [r.flow, r.status])).toEqual([['po', 'PASS']]);
        expect(ran()).toBe(1);
    });

    it('records the FAIL result in the results file content', async () => {
        process.env.E2E_SAP_FLOWS = 'notAFlow';
        await runSapRoundTrips({ baseUrl: 'http://127.0.0.1:1' });
        expect(written).toHaveLength(1);
        expect(written[0].results[0].errors).toEqual(['unknown flow(s): notAFlow']);
    });
});

describe('runAllE2E.skippedSteps', () => {
    it('names a skipped step by its step', () => {
        expect(skippedSteps({ details: [{ step: 'open list', status: 'SKIPPED' }] })).toEqual(['open list']);
    });

    it('names a skipped case as flow: case', () => {
        expect(skippedSteps({ details: [{ flow: 'po', case: 'create', status: 'SKIPPED' }] })).toEqual(['po: create']);
    });

    it('leaves out steps that were not skipped', () => {
        expect(skippedSteps({ details: [{ step: 'a', status: 'PASS' }, { step: 'b', status: 'SKIPPED' }] })).toEqual(['b']);
    });

    it.each([[undefined], [{ subcases: {} }], ['text']])('gives [] for non-array details %j', (details) => {
        expect(skippedSteps({ details })).toEqual([]);
    });
});
