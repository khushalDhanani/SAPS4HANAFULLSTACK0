const cds = require('@sap/cds');
const s4Config = require('../../../srv/common/s4Config');
const { ConfigurationError } = s4Config;

describe('Unit: S/4HANA Configuration Module (s4Config)', () => {
  let savedCdsS4;
  let savedEnv;

  beforeEach(() => {
    savedCdsS4 = cds.env.s4 ? JSON.parse(JSON.stringify(cds.env.s4)) : undefined;
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    if (savedCdsS4 !== undefined) {
      cds.env.s4 = JSON.parse(JSON.stringify(savedCdsS4));
    } else {
      delete cds.env.s4;
    }
    process.env = { ...savedEnv };
  });

  // ─── package.json must NOT contain any business data or plant/storageLocation ───

  describe('package.json cds.s4 — environment config only', () => {
    const pkg = require('../../../package.json');

    test('package.json cds.s4 contains only env-config keys (client)', () => {
      const allowedKeys = new Set(['client']);
      const actualKeys = Object.keys(pkg.cds.s4);
      for (const k of actualKeys) {
        expect(allowedKeys).toContain(k);
      }
    });

    test('package.json cds.s4 carries no client placeholder (client comes from env locally or from the BTP destination)', () => {
      expect(pkg.cds.s4).not.toHaveProperty('client');
    });
  });

  // ─── Environment-variable resolution — connectivity keys ──────────────────

  describe('Resolution from environment variables — client and system', () => {
    test('getClient() resolves from S4_CLIENT', () => {
      delete cds.env.s4?.client;
      delete process.env.CDS_S4_CLIENT;
      process.env.S4_CLIENT = '220';
      expect(s4Config.getClient()).toBe('220');
      expect(s4Config.client).toBe('220');
    });

    test('getClient() resolves from CDS_S4_CLIENT', () => {
      delete cds.env.s4?.client;
      delete process.env.S4_CLIENT;
      process.env.CDS_S4_CLIENT = '300';
      expect(s4Config.getClient()).toBe('300');
    });

    test('getClient() throws ConfigurationError when client is not configured', () => {
      delete cds.env.s4?.client;
      delete process.env.S4_CLIENT;
      delete process.env.CDS_S4_CLIENT;
      expect(() => s4Config.getClient()).toThrow(ConfigurationError);
    });

    test('getSystemName() returns DEV by default in non-production and PRD in production', () => {
      delete process.env.S4_SYSTEM_NAME;
      delete process.env.CDS_S4_SYSTEM_NAME;
      delete cds.env.s4?.systemName;
      expect(s4Config.getSystemName()).toBe('DEV');
      process.env.NODE_ENV = 'production';
      expect(s4Config.getSystemName()).toBe('PRD');
    });

    test('getSystemLabel() formats label with client', () => {
      process.env.S4_CLIENT = '220';
      process.env.S4_SYSTEM_NAME = 'DS4';
      expect(s4Config.getSystemLabel()).toBe('DS4 - Client 220');
    });
  });

  // ─── getAll() and validate() ──────────────────────────────────────────────

  describe('getAll() and validate()', () => {
    test('getAll() returns client and systemName snapshot', () => {
      process.env.S4_CLIENT = '220';
      process.env.S4_SYSTEM_NAME = 'DS4';
      const all = s4Config.getAll();
      expect(all).toEqual({
        systemName: 'DS4',
        client: '220'
      });
    });

    test('validate() throws ConfigurationError if client is missing', () => {
      delete cds.env.s4?.client;
      delete process.env.S4_CLIENT;
      delete process.env.CDS_S4_CLIENT;
      expect(() => s4Config.validate()).toThrow(ConfigurationError);
    });
  });
});
