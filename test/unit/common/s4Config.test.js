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

  // ─── package.json must NOT contain any business data ──────────────────────

  describe('package.json cds.s4 — no business data committed', () => {
    const pkg = require('../../../package.json');
    const businessKeys = [
      'salesOrganization', 'distributionChannel', 'division', 'currency',
      'inquiryType', 'orderType', 'conditionType', 'shippingPoints',
      'salesMaterialTypes', 'mvt261NotReadyBins'
    ];

    test('package.json cds.s4 contains only env-config keys (client, plant, storageLocation)', () => {
      const allowedKeys = new Set(['client', 'plant', 'storageLocation']);
      const actualKeys = Object.keys(pkg.cds.s4);
      for (const k of actualKeys) {
        expect(allowedKeys).toContain(k);
      }
    });

    businessKeys.forEach(key => {
      test(`package.json cds.s4 must not define ${key}`, () => {
        expect(pkg.cds.s4).not.toHaveProperty(key);
      });
    });

    test('package.json cds.s4.client/plant/storageLocation are empty strings (must come from env)', () => {
      for (const key of ['client', 'plant', 'storageLocation']) {
        expect(pkg.cds.s4[key]).toBe('');
      }
    });
  });

  // ─── Environment-variable resolution ──────────────────────────────────────

  describe('Resolution from environment variables — env-config keys', () => {
    test('getClient() resolves from S4_CLIENT', () => {
      delete cds.env.s4?.client;
      process.env.S4_CLIENT = '220';
      expect(s4Config.getClient()).toBe('220');
    });

    test('getPlant() resolves from S4_PLANT', () => {
      delete cds.env.s4?.plant;
      process.env.S4_PLANT = '1120';
      expect(s4Config.getPlant()).toBe('1120');
    });

    test('getStorageLocation() resolves from S4_STORAGE_LOCATION', () => {
      delete cds.env.s4?.storageLocation;
      process.env.S4_STORAGE_LOCATION = 'CS01';
      expect(s4Config.getStorageLocation()).toBe('CS01');
    });

    test('getStorageLocation() resolves from S4_SLOC as alias', () => {
      delete cds.env.s4?.storageLocation;
      delete process.env.S4_STORAGE_LOCATION;
      process.env.S4_SLOC = 'HS01';
      expect(s4Config.getStorageLocation()).toBe('HS01');
    });
  });

  describe('Resolution from environment variables — business-data keys', () => {
    test('getSalesOrganization() resolves from S4_SALES_ORGANIZATION', () => {
      if (cds.env.s4) delete cds.env.s4.salesOrganization;
      process.env.S4_SALES_ORGANIZATION = '1000';
      expect(s4Config.getSalesOrganization()).toBe('1000');
    });

    test('getDistributionChannel() resolves from S4_DISTRIBUTION_CHANNEL', () => {
      if (cds.env.s4) delete cds.env.s4.distributionChannel;
      process.env.S4_DISTRIBUTION_CHANNEL = '10';
      expect(s4Config.getDistributionChannel()).toBe('10');
    });

    test('getDivision() resolves from S4_DIVISION', () => {
      if (cds.env.s4) delete cds.env.s4.division;
      process.env.S4_DIVISION = '52';
      expect(s4Config.getDivision()).toBe('52');
    });

    test('getCurrency() resolves from S4_CURRENCY', () => {
      if (cds.env.s4) delete cds.env.s4.currency;
      process.env.S4_CURRENCY = 'INR';
      expect(s4Config.getCurrency()).toBe('INR');
    });

    test('getInquiryType() resolves from S4_INQUIRY_TYPE', () => {
      if (cds.env.s4) delete cds.env.s4.inquiryType;
      process.env.S4_INQUIRY_TYPE = 'ZIN';
      expect(s4Config.getInquiryType()).toBe('ZIN');
    });

    test('getOrderType() resolves from S4_ORDER_TYPE', () => {
      if (cds.env.s4) delete cds.env.s4.orderType;
      process.env.S4_ORDER_TYPE = 'ZDOM';
      expect(s4Config.getOrderType()).toBe('ZDOM');
    });

    test('getConditionType() resolves from S4_CONDITION_TYPE', () => {
      if (cds.env.s4) delete cds.env.s4.conditionType;
      process.env.S4_CONDITION_TYPE = 'ZPR1';
      expect(s4Config.getConditionType()).toBe('ZPR1');
    });

    test('getShippingPoints() resolves from S4_SHIPPING_POINTS (comma-separated)', () => {
      if (cds.env.s4) delete cds.env.s4.shippingPoints;
      process.env.S4_SHIPPING_POINTS = '1120, 1112, 1108, 1109';
      expect(s4Config.getShippingPoints()).toEqual(['1120', '1112', '1108', '1109']);
    });

    test('getSalesMaterialTypes() resolves from S4_SALES_MATERIAL_TYPES (comma-separated)', () => {
      if (cds.env.s4) delete cds.env.s4.salesMaterialTypes;
      process.env.S4_SALES_MATERIAL_TYPES = 'ZFRT, FERT';
      expect(s4Config.getSalesMaterialTypes()).toEqual(['ZFRT', 'FERT']);
    });

    test('CDS_S4_* prefix takes priority over S4_* fallback', () => {
      if (cds.env.s4) delete cds.env.s4.currency;
      process.env.CDS_S4_CURRENCY = 'EUR';
      process.env.S4_CURRENCY = 'USD';
      expect(s4Config.getCurrency()).toBe('EUR');
    });
  });

  // ─── Fail-loud tests — env-config keys ────────────────────────────────────

  describe('Fail loudly on missing required env-config values', () => {
    const envConfigKeys = [
      { key: 'client',          getter: () => s4Config.getClient(),          envs: ['CDS_S4_CLIENT', 'S4_CLIENT'] },
      { key: 'plant',           getter: () => s4Config.getPlant(),           envs: ['CDS_S4_PLANT', 'S4_PLANT'] },
      { key: 'storageLocation', getter: () => s4Config.getStorageLocation(), envs: ['CDS_S4_STORAGE_LOCATION', 'S4_STORAGE_LOCATION', 'S4_SLOC'] }
    ];

    envConfigKeys.forEach(({ key, getter, envs }) => {
      test(`throws ConfigurationError when ${key} is absent`, () => {
        if (cds.env.s4) cds.env.s4[key] = '';
        envs.forEach(e => delete process.env[e]);
        expect(() => getter()).toThrow(ConfigurationError);
        expect(() => getter()).toThrow(new RegExp(`s4\\.${key}`));
      });

      test(`throws ConfigurationError when ${key} is whitespace-only`, () => {
        if (cds.env.s4) cds.env.s4[key] = '   ';
        envs.forEach(e => delete process.env[e]);
        expect(() => getter()).toThrow(ConfigurationError);
      });
    });

    test('getAll() returns only client / plant / storageLocation', () => {
      process.env.S4_CLIENT = '220';
      process.env.S4_PLANT = '1120';
      process.env.S4_STORAGE_LOCATION = 'CS01';
      const all = s4Config.getAll();
      expect(Object.keys(all).sort()).toEqual(['client', 'plant', 'storageLocation'].sort());
      expect(all.client).toBe('220');
      expect(all.plant).toBe('1120');
      expect(all.storageLocation).toBe('CS01');
    });

    test('validate() returns the same shape as getAll()', () => {
      process.env.S4_CLIENT = '220';
      process.env.S4_PLANT = '1120';
      process.env.S4_STORAGE_LOCATION = 'CS01';
      expect(s4Config.validate()).toEqual(s4Config.getAll());
    });
  });

  // ─── Fail-loud tests — business-data keys ─────────────────────────────────

  describe('Fail loudly on missing required business-data values', () => {
    const businessKeys = [
      { key: 'salesOrganization',   getter: () => s4Config.getSalesOrganization(),   envs: ['CDS_S4_SALES_ORGANIZATION', 'S4_SALES_ORGANIZATION', 'S4_SALES_ORG'] },
      { key: 'distributionChannel', getter: () => s4Config.getDistributionChannel(), envs: ['CDS_S4_DISTRIBUTION_CHANNEL', 'S4_DISTRIBUTION_CHANNEL', 'S4_CHANNEL'] },
      { key: 'division',            getter: () => s4Config.getDivision(),            envs: ['CDS_S4_DIVISION', 'S4_DIVISION'] },
      { key: 'currency',            getter: () => s4Config.getCurrency(),            envs: ['CDS_S4_CURRENCY', 'S4_CURRENCY'] },
      { key: 'inquiryType',         getter: () => s4Config.getInquiryType(),         envs: ['CDS_S4_INQUIRY_TYPE', 'S4_INQUIRY_TYPE'] },
      { key: 'orderType',           getter: () => s4Config.getOrderType(),           envs: ['CDS_S4_ORDER_TYPE', 'S4_ORDER_TYPE'] },
      { key: 'conditionType',       getter: () => s4Config.getConditionType(),       envs: ['CDS_S4_CONDITION_TYPE', 'S4_CONDITION_TYPE'] }
    ];

    businessKeys.forEach(({ key, getter, envs }) => {
      test(`${key}: throws ConfigurationError when absent from env and cds.env.s4`, () => {
        if (cds.env.s4) delete cds.env.s4[key];
        envs.forEach(e => delete process.env[e]);
        expect(() => getter()).toThrow(ConfigurationError);
        expect(() => getter()).toThrow(new RegExp(`s4\\.${key}`));
      });

      test(`${key}: throws ConfigurationError when set to whitespace`, () => {
        if (!cds.env.s4) cds.env.s4 = {};
        cds.env.s4[key] = '  ';
        envs.forEach(e => delete process.env[e]);
        expect(() => getter()).toThrow(ConfigurationError);
      });
    });

    test('getShippingPoints(): throws ConfigurationError when absent', () => {
      if (cds.env.s4) delete cds.env.s4.shippingPoints;
      delete process.env.CDS_S4_SHIPPING_POINTS;
      delete process.env.S4_SHIPPING_POINTS;
      expect(() => s4Config.getShippingPoints()).toThrow(ConfigurationError);
      expect(() => s4Config.getShippingPoints()).toThrow(/s4\.shippingPoints/);
    });

    test('getShippingPoints(): throws ConfigurationError when set to empty array', () => {
      if (!cds.env.s4) cds.env.s4 = {};
      cds.env.s4.shippingPoints = [];
      delete process.env.CDS_S4_SHIPPING_POINTS;
      delete process.env.S4_SHIPPING_POINTS;
      expect(() => s4Config.getShippingPoints()).toThrow(ConfigurationError);
    });

    test('getSalesMaterialTypes(): throws ConfigurationError when absent', () => {
      if (cds.env.s4) delete cds.env.s4.salesMaterialTypes;
      delete process.env.CDS_S4_SALES_MATERIAL_TYPES;
      delete process.env.S4_SALES_MATERIAL_TYPES;
      expect(() => s4Config.getSalesMaterialTypes()).toThrow(ConfigurationError);
      expect(() => s4Config.getSalesMaterialTypes()).toThrow(/s4\.salesMaterialTypes/);
    });
  });

  // ─── getMvt261NotReadyBins ─────────────────────────────────────────────────

  describe('getMvt261NotReadyBins()', () => {
    beforeEach(() => {
      if (cds.env.s4) delete cds.env.s4.mvt261NotReadyBins;
      delete process.env.S4_MVT261_NOT_READY_BINS;
    });

    test('returns [] when neither cds.env.s4 nor env var is set (feature off)', () => {
      expect(s4Config.getMvt261NotReadyBins()).toEqual([]);
    });

    test('returns the array from cds.env.s4.mvt261NotReadyBins when set', () => {
      const bins = [{ storageType: 'OH1', bin: 'ONHOLD', reason: 'onHold' }];
      if (!cds.env.s4) cds.env.s4 = {};
      cds.env.s4.mvt261NotReadyBins = bins;
      expect(s4Config.getMvt261NotReadyBins()).toEqual(bins);
    });

    test('parses S4_MVT261_NOT_READY_BINS JSON env var', () => {
      const bins = [
        { storageType: 'OH1', bin: 'ONHOLD', reason: 'onHold' },
        { storageType: '901', bin: 'WE-ZONE', reason: 'goodsReceiptZone' }
      ];
      process.env.S4_MVT261_NOT_READY_BINS = JSON.stringify(bins);
      expect(s4Config.getMvt261NotReadyBins()).toEqual(bins);
    });

    test('cds.env.s4 array takes priority over env var JSON', () => {
      const fromCds = [{ storageType: 'A', bin: 'BIN1', reason: 'r1' }];
      const fromEnv = [{ storageType: 'B', bin: 'BIN2', reason: 'r2' }];
      if (!cds.env.s4) cds.env.s4 = {};
      cds.env.s4.mvt261NotReadyBins = fromCds;
      process.env.S4_MVT261_NOT_READY_BINS = JSON.stringify(fromEnv);
      expect(s4Config.getMvt261NotReadyBins()).toEqual(fromCds);
    });

    test('throws ConfigurationError when S4_MVT261_NOT_READY_BINS is malformed JSON', () => {
      process.env.S4_MVT261_NOT_READY_BINS = 'not-json!';
      expect(() => s4Config.getMvt261NotReadyBins()).toThrow(ConfigurationError);
      expect(() => s4Config.getMvt261NotReadyBins()).toThrow(/invalid JSON/);
    });

    test('throws ConfigurationError when S4_MVT261_NOT_READY_BINS is not an array', () => {
      process.env.S4_MVT261_NOT_READY_BINS = '{"storageType":"OH1"}';
      expect(() => s4Config.getMvt261NotReadyBins()).toThrow(ConfigurationError);
      expect(() => s4Config.getMvt261NotReadyBins()).toThrow(/JSON array/);
    });

    test('property getter .mvt261NotReadyBins matches method result', () => {
      const bins = [{ storageType: 'X', bin: 'Y', reason: 'z' }];
      if (!cds.env.s4) cds.env.s4 = {};
      cds.env.s4.mvt261NotReadyBins = bins;
      expect(s4Config.mvt261NotReadyBins).toEqual(s4Config.getMvt261NotReadyBins());
    });
  });

  // ─── Difference Storage Type (WM customizing) ─────────────────────────────

  describe('Difference Storage Type (WM customizing, never defaulted)', () => {
    test('throws ConfigurationError when neither cds.s4 nor env define it', () => {
      delete process.env.S4_DIFFERENCE_STORAGE_TYPE;
      delete process.env.CDS_S4_DIFFERENCE_STORAGE_TYPE;
      if (cds.env.s4) delete cds.env.s4.differenceStorageType;
      expect(() => s4Config.getDifferenceStorageType()).toThrow(ConfigurationError);
      expect(() => s4Config.differenceStorageType).toThrow(/differenceStorageType/);
    });

    test('reads S4_DIFFERENCE_STORAGE_TYPE from the environment (trimmed)', () => {
      if (cds.env.s4) delete cds.env.s4.differenceStorageType;
      process.env.S4_DIFFERENCE_STORAGE_TYPE = ' 999 ';
      expect(s4Config.getDifferenceStorageType()).toBe('999');
    });
  });
});
