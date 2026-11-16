const cds = require('@sap/cds');
const cdsTest = cds.test(__dirname + '/../../');
const { GET, axios } = cdsTest;
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

/**
 * /health is the plain "process answers" check used by Docker, CI and the smoke test.
 * Cloud Foundry's readiness check (mta.yaml) calls /health/ready, also without credentials, and expects HTTP 200.
 */
describe('Integration: /health readiness endpoint', () => {

    it('should answer GET /health with 200 and status UP without authentication', async () => {
        const { status, data, headers } = await GET('/health');

        expect(status).toBe(200);
        expect(data).toEqual({ status: 'UP' });
        expect(headers['cache-control']).toBe('no-store');
    });

    it('should not redirect or challenge for credentials', async () => {
        const response = await axios.get('/health', {
            maxRedirects: 0,
            validateStatus: () => true
        });

        expect(response.status).toBe(200);
        expect(response.headers['www-authenticate']).toBeUndefined();
    });

});

describe('Integration: /health/live, /health/ready and /health/dependencies', () => {
    const open = (path) => axios.get(path, { maxRedirects: 0, validateStatus: () => true });

    it('the Cloud Foundry readiness check in mta.yaml points at /health/ready, which this server serves', async () => {
        const mta = require('fs').readFileSync(require('path').join(__dirname, '../../mta.yaml'), 'utf8');
        const endpoints = [...mta.matchAll(/readiness-health-check-http-endpoint:\s*(\S+)/g)].map((m) => m[1]);
        expect(endpoints).toEqual(['/health/ready']);
        expect((await open(endpoints[0])).status).toBe(200);
    });

    it('answers all three without authentication and without caching', async () => {
        for (const path of ['/health/live', '/health/ready', '/health/dependencies']) {
            const response = await open(path);
            expect(response.status).toBe(200);
            expect(response.headers['www-authenticate']).toBeUndefined();
            expect(response.headers['cache-control']).toBe('no-store');
        }
    });

    it('reports ready when the database answers, and each dependency by a status word only', async () => {
        expect((await open('/health/ready')).data).toEqual({ status: 'UP' });

        const { data } = await open('/health/dependencies');
        expect(Object.keys(data.dependencies).sort()).toEqual(['database', 'rfcSdk', 's4Destination', 'sapOData']);
        expect(data.dependencies.database).toBe('UP');
        expect(data.dependencies.sapOData).toBe('NOT_CHECKED');
        expect(['CONFIGURED', 'NOT_CONFIGURED']).toContain(data.dependencies.s4Destination);
        expect(data.dependencies.rfcSdk).toBe(RfcClient.isAvailable() ? 'UP' : 'DOWN');
        Object.values(data.dependencies).forEach((value) => expect(value).toMatch(/^[A-Z_]+$/));
        expect(['UP', 'DEGRADED']).toContain(data.status);
    });
});

describe('health endpoints with controlled checks', () => {
    const express = require('express');
    const { registerHealth } = require('../../srv/common/health');
    let server;
    let base;
    let state;
    let clock;
    let calls;

    beforeAll((done) => {
        const app = express();
        registerHealth(app, {
            cacheMs: 1000,
            now: () => clock,
            checks: {
                database: async () => { calls++; return state.database; },
                s4Destination: async () => state.s4Destination,
                rfcSdk: () => state.rfcSdk
            }
        });
        server = app.listen(0, '127.0.0.1', () => {
            base = `http://127.0.0.1:${server.address().port}`;
            done();
        });
    });
    afterAll((done) => { server.close(done); });
    beforeEach(() => {
        clock = (clock || 0) + 5000; // past the cache
        calls = 0;
        state = { database: 'UP', s4Destination: 'CONFIGURED', rfcSdk: 'UP' };
    });
    const get = (path) => axios.get(base + path, { validateStatus: () => true });

    it('readiness is 503 when the database is down, while liveness stays 200', async () => {
        state.database = 'DOWN';
        expect((await get('/health/ready')).status).toBe(503);
        expect((await get('/health/live')).status).toBe(200);
    });

    it('SAP-side trouble degrades the dependency report but not readiness', async () => {
        state.s4Destination = 'NOT_CONFIGURED';
        state.rfcSdk = 'DOWN';
        const deps = await get('/health/dependencies');
        expect(deps.status).toBe(200);
        expect(deps.data).toMatchObject({ status: 'DEGRADED', dependencies: { s4Destination: 'NOT_CONFIGURED', rfcSdk: 'DOWN' } });
        expect((await get('/health/ready')).status).toBe(200);
    });

    it('all up reports UP, and repeated calls inside the cache window run the checks once', async () => {
        expect((await get('/health/dependencies')).data.status).toBe('UP');
        await get('/health/ready');
        await get('/health/dependencies');
        expect(calls).toBe(1);
    });
});
