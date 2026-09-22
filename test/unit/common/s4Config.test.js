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

  describe('Integration Re-Export', () => {
    test('srv/integration/s4hana/s4Config should re-export srv/common/s4Config instance', () => {
      expect(s4ConfigFromIntegration).toBe(s4Config);
      expect(s4Config.ConfigurationError).toBe(ConfigurationError);
    });
  });

  describe('Standard Configuration Resolution from cds.env.s4', () => {
    test('should load all standard defaults from package.json cds.s4 configuration', () => {
      expect(s4Config.getClient()).toBe('220');
      expect(s4Config.getPlant()).toBe('1120');
      expect(s4Config.getStorageLocation()).toBe('CS01');
      expect(s4Config.getSalesOrganization()).toBe('1000');
      expect(s4Config.getDistributionChannel()).toBe('10');
      expect(s4Config.getDivision()).toBe('52');
      expect(s4Config.getCurrency()).toBe('INR');
      expect(s4Config.getInquiryType()).toBe('ZIN');
      expect(s4Config.getOrderType()).toBe('ZDOM');
      expect(s4Config.getConditionType()).toBe('ZPR1');
      expect(s4Config.getShippingPoints()).toEqual(['1120', '1112', '1108', '1109']);
    });

    test('property getters should match method results', () => {
      expect(s4Config.client).toBe(s4Config.getClient());
      expect(s4Config.plant).toBe(s4Config.getPlant());
      expect(s4Config.storageLocation).toBe(s4Config.getStorageLocation());
      expect(s4Config.salesOrganization).toBe(s4Config.getSalesOrganization());
      expect(s4Config.distributionChannel).toBe(s4Config.getDistributionChannel());
      expect(s4Config.division).toBe(s4Config.getDivision());
      expect(s4Config.currency).toBe(s4Config.getCurrency());
      expect(s4Config.inquiryType).toBe(s4Config.getInquiryType());
      expect(s4Config.orderType).toBe(s4Config.getOrderType());
      expect(s4Config.conditionType).toBe(s4Config.getConditionType());
      expect(s4Config.shippingPoints).toEqual(s4Config.getShippingPoints());
    });

    test('getAll() and validate() should return the full configuration dictionary', () => {
      const all = s4Config.getAll();
      expect(all).toEqual({
        client: '220',
        plant: '1120',
        storageLocation: 'CS01',
        salesOrganization: '1000',
        distributionChannel: '10',
        division: '52',
        currency: 'INR',
        inquiryType: 'ZIN',
        orderType: 'ZDOM',
        conditionType: 'ZPR1',
        shippingPoints: ['1120', '1112', '1108', '1109']
      });
      expect(s4Config.validate()).toEqual(all);
    });
  });

  describe('Environment Variable Fallbacks and Overrides', () => {
    test('should use environment variables when cds.env.s4 key is missing', () => {
      delete cds.env.s4.client;
      delete cds.env.s4.plant;
      delete cds.env.s4.shippingPoints;

      process.env.S4_CLIENT = '100';
      process.env.S4_PLANT = '2000';
      process.env.S4_SHIPPING_POINTS = '2000, 2001, 2002';

      expect(s4Config.getClient()).toBe('100');
      expect(s4Config.getPlant()).toBe('2000');
      expect(s4Config.getShippingPoints()).toEqual(['2000', '2001', '2002']);
    });

    test('should prefer CDS_S4_* prefix if provided', () => {
      delete cds.env.s4.currency;
      process.env.CDS_S4_CURRENCY = 'EUR';
      process.env.S4_CURRENCY = 'USD';

      expect(s4Config.getCurrency()).toBe('EUR');
    });
  });

  describe('Fail Loudly on Missing Required Configuration', () => {
    const requiredKeys = [
      { key: 'client', getter: () => s4Config.getClient(), envs: ['CDS_S4_CLIENT', 'S4_CLIENT'] },
      { key: 'plant', getter: () => s4Config.getPlant(), envs: ['CDS_S4_PLANT', 'S4_PLANT'] },
      { key: 'storageLocation', getter: () => s4Config.getStorageLocation(), envs: ['CDS_S4_STORAGE_LOCATION', 'S4_STORAGE_LOCATION', 'S4_SLOC'] },
      { key: 'salesOrganization', getter: () => s4Config.getSalesOrganization(), envs: ['CDS_S4_SALES_ORGANIZATION', 'S4_SALES_ORGANIZATION', 'S4_SALES_ORG'] },
      { key: 'distributionChannel', getter: () => s4Config.getDistributionChannel(), envs: ['CDS_S4_DISTRIBUTION_CHANNEL', 'S4_DISTRIBUTION_CHANNEL', 'S4_CHANNEL'] },
      { key: 'division', getter: () => s4Config.getDivision(), envs: ['CDS_S4_DIVISION', 'S4_DIVISION'] },
      { key: 'currency', getter: () => s4Config.getCurrency(), envs: ['CDS_S4_CURRENCY', 'S4_CURRENCY'] },
      { key: 'inquiryType', getter: () => s4Config.getInquiryType(), envs: ['CDS_S4_INQUIRY_TYPE', 'S4_INQUIRY_TYPE'] },
      { key: 'conditionType', getter: () => s4Config.getConditionType(), envs: ['CDS_S4_CONDITION_TYPE', 'S4_CONDITION_TYPE'] },
      { key: 'shippingPoints', getter: () => s4Config.getShippingPoints(), envs: ['CDS_S4_SHIPPING_POINTS', 'S4_SHIPPING_POINTS'] }
    ];

    requiredKeys.forEach(({ key, getter, envs }) => {
      test(`should throw ConfigurationError when ${key} is missing`, () => {
        delete cds.env.s4[key];
        envs.forEach(env => delete process.env[env]);

        expect(() => getter()).toThrow(ConfigurationError);
        expect(() => getter()).toThrow(new RegExp(`Missing required S/4HANA configuration: s4\\.${key}`));
      });

      test(`should throw ConfigurationError when ${key} is empty string`, () => {
        cds.env.s4[key] = '   ';
        envs.forEach(env => delete process.env[env]);

        expect(() => getter()).toThrow(ConfigurationError);
        expect(() => getter()).toThrow(new RegExp(`Missing required S/4HANA configuration: s4\\.${key}`));
      });
    });

    test('should throw ConfigurationError when shippingPoints is empty array', () => {
      cds.env.s4.shippingPoints = [];
      delete process.env.CDS_S4_SHIPPING_POINTS;
      delete process.env.S4_SHIPPING_POINTS;

      expect(() => s4Config.getShippingPoints()).toThrow(ConfigurationError);
      expect(() => s4Config.getShippingPoints()).toThrow(/Missing required S\/4HANA configuration: s4\.shippingPoints/);
    });

    test('validate() should fail loudly when any required key is missing', () => {
      delete cds.env.s4.division;
      delete process.env.CDS_S4_DIVISION;
      delete process.env.S4_DIVISION;

      expect(() => s4Config.validate()).toThrow(ConfigurationError);
      expect(() => s4Config.validate()).toThrow(/Missing required S\/4HANA configuration: s4\.division/);
    });
  });

  describe('Difference Storage Type (WM customizing, never defaulted)', () => {
    test('throws ConfigurationError when neither cds.s4 nor env define it', () => {
      delete process.env.S4_DIFFERENCE_STORAGE_TYPE;
      delete process.env.CDS_S4_DIFFERENCE_STORAGE_TYPE;
      if (cds.env.s4) delete cds.env.s4.differenceStorageType;
      expect(() => s4Config.getDifferenceStorageType()).toThrow(ConfigurationError);
      expect(() => s4Config.differenceStorageType).toThrow(/differenceStorageType/);
    });

    test('reads S4_DIFFERENCE_STORAGE_TYPE from the environment', () => {
      if (cds.env.s4) delete cds.env.s4.differenceStorageType;
      process.env.S4_DIFFERENCE_STORAGE_TYPE = ' 999 ';
      expect(s4Config.getDifferenceStorageType()).toBe('999');
    });
  });
});
