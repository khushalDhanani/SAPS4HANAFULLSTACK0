'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveMode, assertTarget, singleWriteHandler } = require('../../e2e/support/liveWriteGate');
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

describe('Tier C live-write gate: target and single write', () => {
    it('blocks when no target is named', () => {
        expect(() => assertTarget('S4HANA_DEV - Client 220', {})).toThrow(/E2E_SAP_LIVE_TARGET/);
    });

    it('blocks when the server reports nothing, or a different system', () => {
        expect(() => assertTarget('', { E2E_SAP_LIVE_TARGET: 'A' })).toThrow(/did not report/);
        expect(() => assertTarget('B', { E2E_SAP_LIVE_TARGET: 'A' })).toThrow(/connected to "B".*authorizes "A"/);
    });

    it('passes only when the named target equals the reported one', () => {
        expect(() => assertTarget(' S4 - Client 220 ', { E2E_SAP_LIVE_TARGET: 'S4 - Client 220' })).not.toThrow();
    });

    it('logs and lets the first write through, aborts every further one', () => {
        const logs = []; const seen = [];
        const handler = singleWriteHandler((m) => logs.push(m), seen);
        const route = (body) => ({ request: () => ({ postData: () => body }), fallback: jest.fn(), abort: jest.fn() });
        const first = route('{"a":1}'); const second = route('{"a":2}');
        handler(first); handler(second);
        expect(first.fallback).toHaveBeenCalled();
        expect(first.abort).not.toHaveBeenCalled();
        expect(second.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(second.fallback).not.toHaveBeenCalled();
        expect(logs[0]).toContain('WRITE about to be sent to SAP: {"a":1}');
        expect(logs[1]).toContain('WRITE ABORTED');
        expect(seen.map((x) => x.aborted)).toEqual([false, true]);
    });
});
