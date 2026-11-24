'use strict';

// Loads the real server.js. Every case throws on the guard lines at its top, before any server is created.
jest.mock('dotenv', () => ({ config: jest.fn() }));

const KEYS = ['NODE_ENV', 'WM_ALLOW_MISMATCHED_TR', 'SAP_SYSTEM_TYPE', 'ENABLE_DEV_TOKEN_ISSUER', 'LOCAL_AUTH_SECRET', 'S4_CLIENT', 'VCAP_SERVICES'];

/** Loads server.js in a fresh module registry with the given auth kind in the CAP environment. */
function loadServer(authKind) {
    jest.isolateModules(() => {
        const cds = require('@sap/cds');
        const saved = cds.env.requires.auth;
        cds.env.requires.auth = { ...saved, kind: authKind };
        try {
            require('../../server');
        } finally {
            cds.env.requires.auth = saved;
        }
    });
}

describe('server.js startup guards', () => {
    const saved = {};
    beforeEach(() => {
        KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    });
    afterEach(() => {
        KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    });

    it('refuses to load when the WM mismatch override is on outside a sandbox', () => {
        Object.assign(process.env, { NODE_ENV: 'test', WM_ALLOW_MISMATCHED_TR: 'true', SAP_SYSTEM_TYPE: 'dev' });
        expect(() => loadServer('mocked')).toThrow('WM_ALLOW_MISMATCHED_TR=true requires SAP_SYSTEM_TYPE=sandbox');
    });

    it('refuses to load in production with mocked authentication', () => {
        process.env.NODE_ENV = 'production';
        expect(() => loadServer('mocked')).toThrow("Authentication kind 'mocked' is not allowed in production");
    });

    it('refuses to load in production with the dev token issuer on', () => {
        Object.assign(process.env, { NODE_ENV: 'production', ENABLE_DEV_TOKEN_ISSUER: 'true' });
        expect(() => loadServer('xsuaa')).toThrow('ENABLE_DEV_TOKEN_ISSUER=true is not allowed in production');
    });

    it('refuses to load outside the test profile with the signing secret of the example files', () => {
        const example = (/^LOCAL_AUTH_SECRET=(.*)$/m.exec(require('fs').readFileSync(require('path').resolve(__dirname, '../../.env.example'), 'utf8')) || [])[1].trim();
        Object.assign(process.env, { NODE_ENV: 'development', ENABLE_DEV_TOKEN_ISSUER: 'true', LOCAL_AUTH_SECRET: example });
        expect(() => loadServer('mocked')).toThrow('LOCAL_AUTH_SECRET is a value from .env.example');
    });

    it('refuses to load outside the test profile with a signing secret under 32 bytes', () => {
        Object.assign(process.env, { NODE_ENV: 'development', ENABLE_DEV_TOKEN_ISSUER: 'true', LOCAL_AUTH_SECRET: 'x'.repeat(31) });
        expect(() => loadServer('mocked')).toThrow('LOCAL_AUTH_SECRET must be at least 32 bytes');
    });

    it('refuses to load in production without the Destination service binding', () => {
        process.env.NODE_ENV = 'production';
        expect(() => loadServer('xsuaa')).toThrow('missing: Destination service binding (VCAP_SERVICES.destination)');
    });
});
