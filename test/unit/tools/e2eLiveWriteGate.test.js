'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveMode } = require('../../e2e/support/liveWriteGate');
const { classifyRequest } = require('../../e2e/support/writeGuard');

describe('Tier C live-write gate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-gate-'));
    const dataFile = path.join(dir, 'testData.json');
    const live = { ALLOW_LIVE_SAP_TOOLS: '1', E2E_SAP_WRITE_FLOWS: 'po, salesOrder' };
    const argv = ['node', 'suite.js', '--allow-live-sap'];

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('defaults to dry-run when nothing asks for live', () => {
        expect(resolveMode('po', { argv: ['node', 'x'], env: {}, dataFile })).toEqual({ mode: 'dry-run' });
    });

    it.each([
        ['missing env opt-in', ['node', 'x', '--allow-live-sap'], { E2E_SAP_WRITE_FLOWS: 'po' }, /ALLOW_LIVE_SAP_TOOLS=1/],
        ['missing flag', ['node', 'x'], { ALLOW_LIVE_SAP_TOOLS: '1', E2E_SAP_WRITE_FLOWS: 'po' }, /--allow-live-sap/],
        ['flow not listed', argv, { ALLOW_LIVE_SAP_TOOLS: '1', E2E_SAP_WRITE_FLOWS: 'salesOrder' }, /E2E_SAP_WRITE_FLOWS containing "po"/],
        ['no data file', argv, live, /testData\.json/]
    ])('blocks live on %s (never silently falls back to dry-run)', (_l, a, env, msg) => {
        expect(() => resolveMode('po', { argv: a, env, dataFile })).toThrow(msg);
    });

    it('blocks live when the flow data still has placeholders', () => {
        fs.writeFileSync(dataFile, JSON.stringify({ po: { supplier: 'NOT PROVIDED', items: { material: '' }, plant: '1120' } }));
        expect(() => resolveMode('po', { argv, env: live, dataFile })).toThrow(/placeholder test data for "po": supplier, items\.material/);
    });

    it('returns live mode with the flow data when everything is provided', () => {
        fs.writeFileSync(dataFile, JSON.stringify({ po: { supplier: '10135', plant: '1120' } }));
        expect(resolveMode('po', { argv, env: live, dataFile })).toEqual({ mode: 'live', data: { supplier: '10135', plant: '1120' } });
    });
});

describe('write guard live allowlist', () => {
    const url = 'http://localhost:4004/odata/v4/purchase-order/createPurchaseOrder';
    it('allows only POSTs whose path matches an allowlisted pattern', () => {
        expect(classifyRequest({ method: 'POST', url }, [/\/purchase-order\/createPurchaseOrder$/]).allow).toBe(true);
        expect(classifyRequest({ method: 'POST', url }).allow).toBe(false);
        expect(classifyRequest({ method: 'PATCH', url }, [/createPurchaseOrder$/]).allow).toBe(false);
        expect(classifyRequest({ method: 'POST', url: 'http://localhost:4004/odata/v4/sales-order/createSalesOrder' }, [/createPurchaseOrder$/]).allow).toBe(false);
    });
});
