'use strict';

const path = require('path');
const cds = require('@sap/cds');
const express = require('express');
const { Readable } = require('stream');

describe('MaintenanceOrderService (CAP OData V4 integration without TCP port)', () => {
    let app;
    let mockList;
    let mockGetMetrics;

    beforeAll(async () => {
        mockList = jest.fn();
        mockGetMetrics = jest.fn();

        jest.doMock('../../../srv/integration/s4hana/pm/maintenance-order/MaintenanceOrderAdapter', () => {
            return class MockAdapter {
                list(params) { return mockList(params); }
                getMetrics() { return mockGetMetrics(); }
            };
        });

        const serviceCds = path.resolve(__dirname, '../../../srv/pm/maintenance-order/service.cds');
        const serviceJs = path.resolve(__dirname, '../../../srv/pm/maintenance-order/service.js');
        const csn = await cds.load(serviceCds);
        cds.model = cds.linked(csn);
        app = express();
        await cds.serve('MaintenanceOrderService').from(csn).with(serviceJs).in(app);
    });

    afterAll(() => {
        jest.dontMock('../../../srv/integration/s4hana/pm/maintenance-order/MaintenanceOrderAdapter');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    function callApp(url, authHeader) {
        return new Promise((resolve) => {
            const req = new Readable({ read() { this.push(null); } });
            req.url = url;
            req.method = 'GET';
            req.headers = { host: 'localhost' };
            if (authHeader) req.headers.authorization = authHeader;
            const chunks = [];
            const res = {
                statusCode: 200,
                headers: {},
                setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
                getHeader(k) { return this.headers[k.toLowerCase()]; },
                writeHeader(code) { this.statusCode = code; },
                writeHead(code) { this.statusCode = code; },
                write(c) { chunks.push(Buffer.from(c)); },
                end(c) {
                    if (c) chunks.push(Buffer.from(c));
                    const body = Buffer.concat(chunks).toString();
                    let json = null;
                    try { json = JSON.parse(body); } catch (_) { /* ignore */ }
                    resolve({ status: this.statusCode, body, json });
                }
            };
            app(req, res, () => resolve({ status: 404, body: 'not handled', json: null }));
        });
    }

    const viewerAuth = 'Basic ' + Buffer.from('khushal:').toString('base64');

    test('GET list(top=25,skip=0,searchQuery=...) routes through OData V4 to adapter.list', async () => {
        mockList.mockResolvedValue({
            totalCount: 1,
            items: [{ maintenanceOrder: '4000054724', maintenanceOrderDesc: 'Pump Inspection' }]
        });

        const res = await callApp("/odata/v4/maintenance-order/list(top=25,skip=0,searchQuery='pump')", viewerAuth);
        expect(res.status).toBe(200);
        expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
            top: 25,
            skip: 0,
            searchQuery: 'pump'
        }));
        expect(res.json.totalCount).toBe(1);
        expect(res.json.items[0].maintenanceOrder).toBe('4000054724');
    });

    test('GET getMetrics() returns totalCount', async () => {
        mockGetMetrics.mockResolvedValue({ totalCount: 54391 });
        const res = await callApp('/odata/v4/maintenance-order/getMetrics()', viewerAuth);
        expect(res.status).toBe(200);
        expect(res.json.totalCount).toBe(54391);
    });

    test('propagates adapter error status and message', async () => {
        const err = new Error('SAP destination unavailable');
        err.status = 503;
        mockList.mockRejectedValue(err);
        const res = await callApp('/odata/v4/maintenance-order/list(top=25,skip=0)', viewerAuth);
        expect(res.status).toBe(503);
        expect(res.json.error.message).toContain('SAP destination unavailable');
    });

    test('rejects unauthenticated requests with 401', async () => {
        const res = await callApp('/odata/v4/maintenance-order/getMetrics()');
        expect(res.status).toBe(401);
        expect(mockGetMetrics).not.toHaveBeenCalled();
    });
});
