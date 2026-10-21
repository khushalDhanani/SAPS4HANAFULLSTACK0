const cds = require('@sap/cds');
const s4Config = require('../../../srv/common/s4Config');
const s4ConfigFromIntegration = require('../../../srv/integration/s4hana/s4Config');
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

  // ─── Re-export wiring ─────────────────────────────────────────────────────

  describe('Integration Re-Export', () => {
    test('srv/integration/s4hana/s4Config re-exports the same instance as srv/common/s4Config', () => {
      expect(s4ConfigFromIntegration).toBe(s4Config);
      expect(s4Config.ConfigurationError).toBe(ConfigurationError);
    });
  });

  // ─── package.json must NOT contain any business data or plant/storageLocation ───

  describe('package.json cds.s4 — environment config only', () => {
    const pkg = require('../../../package.json');
    const forbiddenKeys = [
      'plant', 'storageLocation',
      'salesOrganization', 'distributionChannel', 'division', 'currency',
      'inquiryType', 'orderType', 'conditionType', 'shippingPoints',
      'salesMaterialTypes', 'mvt261NotReadyBins', 'warehouseNumber'
    ];

    test('package.json cds.s4 contains only env-config keys (client)', () => {
      const allowedKeys = new Set(['client']);
      const actualKeys = Object.keys(pkg.cds.s4);
      for (const k of actualKeys) {
        expect(allowedKeys).toContain(k);
      }
    });

    forbiddenKeys.forEach(key => {
      test(`package.json cds.s4 must not define ${key}`, () => {
        expect(pkg.cds.s4).not.toHaveProperty(key);
      });
    });

    test('package.json cds.s4.client is empty string (must come from env or BTP)', () => {
      expect(pkg.cds.s4.client).toBe('');
    });
  });

  // ─── s4Config surface: environment config only ────────────────────────────

  describe('s4Config API surface — business methods removed', () => {
    const removedMethods = [
      'getPlant', 'getStorageLocation',
      'getSalesOrganization', 'getDistributionChannel', 'getDivision', 'getCurrency',
      'getInquiryType', 'getOrderType', 'getConditionType',
      'getShippingPoints', 'getSalesMaterialTypes', 'getDifferenceStorageType',
      'getMvt261NotReadyBins'
    ];

    removedMethods.forEach(method => {
      test(`s4Config.${method} is undefined (business data handled by BusinessConfigResolver)`, () => {
        expect(s4Config[method]).toBeUndefined();
      });
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

  // ─── Feature flags (resLockEnabled) ───────────────────────────────────────

  describe('getResLockEnabled()', () => {
    test('defaults to false when not configured', () => {
      delete process.env.S4_RES_LOCK_ENABLED;
      delete process.env.CDS_S4_RES_LOCK_ENABLED;
      delete cds.env.s4?.resLockEnabled;
      expect(s4Config.getResLockEnabled()).toBe(false);
      expect(s4Config.resLockEnabled).toBe(false);
    });

    test('returns true when S4_RES_LOCK_ENABLED=true', () => {
      process.env.S4_RES_LOCK_ENABLED = 'true';
      expect(s4Config.getResLockEnabled()).toBe(true);
    });

    test('returns true when S4_RES_LOCK_ENABLED=X', () => {
      process.env.S4_RES_LOCK_ENABLED = 'X';
      expect(s4Config.getResLockEnabled()).toBe(true);
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
