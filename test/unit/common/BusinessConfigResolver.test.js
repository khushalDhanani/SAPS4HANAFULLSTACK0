'use strict';

const businessConfigResolver = require('../../../srv/common/BusinessConfigResolver');
const { BusinessConfigResolver, BusinessConfigError } = businessConfigResolver;

describe('Unit: BusinessConfigResolver', () => {

  // ─── Test Fixtures ─────────────────────────────────────────────────────────

  const rowW01 = {
    Plant: '1120',
    WarehouseNumber: 'W01',
    SalesOrganization: '1000',
    DistributionChannel: '10',
    Division: '52',
    Currency: 'INR',
    InquiryType: 'ZIN',
    OrderType: 'ZDOM',
    ConditionType: 'ZPR1',
    ShippingPoints: '1120, 1112, 1108',
    SalesMaterialTypes: 'ZFRT, FERT',
    DifferenceStorageType: '999',
    Mvt261NotReadyBinsJson: JSON.stringify([
      { storageType: 'OH1', bin: 'ONHOLD', reason: 'onHold' }
    ]),
    Active: true
  };

  const rowW02 = {
    Plant: '1120',
    WarehouseNumber: 'W02',
    SalesOrganization: '2000',
    DistributionChannel: '20',
    Division: '10',
    Currency: 'EUR',
    InquiryType: 'INQ2',
    OrderType: 'ORD2',
    ConditionType: 'PR00',
    ShippingPoints: '2201, 2202',
    SalesMaterialTypes: 'HAWA, FERT',
    DifferenceStorageType: '998',
    Mvt261NotReadyBinsJson: JSON.stringify([
      { storageType: 'QA1', bin: 'INSP', reason: 'qualityInspection' }
    ]),
    Active: true
  };

  const rowPlantLevel = {
    Plant: '1130',
    WarehouseNumber: '',
    SalesOrganization: '3000',
    DistributionChannel: '30',
    Division: '00',
    Currency: 'USD',
    InquiryType: 'AF',
    OrderType: 'TA',
    ConditionType: 'PR00',
    ShippingPoints: '1130',
    SalesMaterialTypes: 'FERT',
    Active: true
  };

  // ─── Resolution Path 1: Request context / overrides ────────────────────────

  describe('Path 1: Request context & overrides (highest priority)', () => {
    test('resolves entirely from explicit request overrides without DB or customizing query', async () => {
      const dbSpy = jest.fn();
      const sapSpy = jest.fn();
      const resolver = new BusinessConfigResolver({
        dbQuery: dbSpy,
        sapCustomizing: sapSpy
      });

      const res = await resolver.resolve({
        plant: '1120',
        warehouse: 'W01',
        overrides: {
          salesOrganization: '9999',
          distributionChannel: '99',
          division: '99',
          currency: 'GBP',
          inquiryType: 'ZREQ',
          orderType: 'ZEXP',
          conditionType: 'ZPR9',
          shippingPoints: ['9901'],
          salesMaterialTypes: ['ZEXP']
        }
      });

      expect(dbSpy).not.toHaveBeenCalled();
      expect(sapSpy).not.toHaveBeenCalled();
      expect(res.salesOrganization).toBe('9999');
      expect(res.salesOrg).toBe('9999');
      expect(res.distributionChannel).toBe('99');
      expect(res.distChannel).toBe('99');
      expect(res.division).toBe('99');
      expect(res.currency).toBe('GBP');
      expect(res.orderType).toBe('ZEXP');
      expect(res.shippingPoints).toEqual(['9901']);
      expect(res.salesMaterialTypes).toEqual(['ZEXP']);
      expect(res.materialTypes).toEqual(['ZEXP']);
      expect(res.mvt261NotReadyBins).toEqual([]);
    });

    test('accepts direct top-level context properties as overrides', async () => {
      const resolver = new BusinessConfigResolver();

      const res = await resolver.resolve({
        plant: '1120',
        warehouse: 'W01',
        salesOrg: '1000',
        distChannel: '10',
        division: '52',
        currency: 'USD',
        orderType: 'OR',
        inquiryType: 'IN',
        conditionType: 'PR00',
        shippingPoints: '1120, 1108',
        materialTypes: 'FERT, ROH'
      });

      expect(res.salesOrg).toBe('1000');
      expect(res.salesOrganization).toBe('1000');
      expect(res.distChannel).toBe('10');
      expect(res.distributionChannel).toBe('10');
      expect(res.shippingPoints).toEqual(['1120', '1108']);
      expect(res.materialTypes).toEqual(['FERT', 'ROH']);
      expect(res.salesMaterialTypes).toEqual(['FERT', 'ROH']);
    });
  });

  // ─── Resolution Path 2: SAP Customizing ────────────────────────────────────

  describe('Path 2: SAP Customizing provider', () => {
    test('resolves missing fields from SAP customizing when request overrides are partial', async () => {
      const dbSpy = jest.fn();
      const sapCustomizing = jest.fn().mockResolvedValue({
        salesOrganization: '1000',
        distributionChannel: '10',
        division: '52',
        currency: 'INR',
        inquiryType: 'ZIN',
        orderType: 'ZDOM',
        conditionType: 'ZPR1',
        shippingPoints: '1120, 1112',
        salesMaterialTypes: 'ZFRT'
      });

      const resolver = new BusinessConfigResolver({
        dbQuery: dbSpy,
        sapCustomizing
      });

      const res = await resolver.resolve({
        plant: '1120',
        storageLocation: 'CS01',
        overrides: {
          currency: 'EUR' // Request override takes priority
        }
      });

      expect(sapCustomizing).toHaveBeenCalledWith(expect.objectContaining({
        plant: '1120',
        storageLocation: 'CS01'
      }));
      expect(dbSpy).not.toHaveBeenCalled();
      expect(res.currency).toBe('EUR'); // Override preserved
      expect(res.salesOrg).toBe('1000');
      expect(res.distChannel).toBe('10');
      expect(res.division).toBe('52');
      expect(res.shippingPoints).toEqual(['1120', '1112']);
    });

    test('resolves from RFC table queries (T001L and T320)', async () => {
      const mockRfc = {
        readTable: jest.fn().mockImplementation((table, _fields, _where) => {
          if (table === 'T001L') {
            return [{ WERKS: '1120', LGORT: 'CS02', VKORG: '1000', VTWEG: '14', SPART: '00' }];
          }
          if (table === 'T320') {
            return [{ LGNUM: 'W01' }];
          }
          return [];
        })
      };

      const mockDb = jest.fn().mockResolvedValue(rowW01);
      const resolver = new BusinessConfigResolver({
        rfc: mockRfc,
        dbQuery: mockDb
      });

      const res = await resolver.resolve({
        plant: '1120',
        storageLocation: 'CS02'
      });

      expect(mockRfc.readTable).toHaveBeenCalledWith('T001L', expect.any(Array), expect.any(Array));
      expect(mockRfc.readTable).toHaveBeenCalledWith('T320', expect.any(Array), expect.any(Array));
      expect(res.salesOrganization).toBe('1000');
      expect(res.distributionChannel).toBe('14'); // from T001L
      expect(res.division).toBe('00');            // from T001L
      expect(res.warehouseNumber).toBe('W01');     // from T320
    });
  });

  // ─── Resolution Path 3: Admin Config Table (BusinessConfig) ────────────────

  describe('Path 3: Admin config table (BusinessConfig)', () => {
    test('resolves from exact Plant + WarehouseNumber row in BusinessConfig', async () => {
      const mockDb = jest.fn().mockImplementation((plant, wh) => {
        if (plant === '1120' && wh === 'W01') return rowW01;
        return null;
      });

      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      const res = await resolver.resolve({
        plant: '1120',
        warehouseNumber: 'W01'
      });

      expect(mockDb).toHaveBeenCalledWith('1120', 'W01');
      expect(res.salesOrganization).toBe('1000');
      expect(res.distributionChannel).toBe('10');
      expect(res.division).toBe('52');
      expect(res.currency).toBe('INR');
      expect(res.orderType).toBe('ZDOM');
      expect(res.inquiryType).toBe('ZIN');
      expect(res.conditionType).toBe('ZPR1');
      expect(res.shippingPoints).toEqual(['1120', '1112', '1108']);
      expect(res.salesMaterialTypes).toEqual(['ZFRT', 'FERT']);
      expect(res.differenceStorageType).toBe('999');
      expect(res.mvt261NotReadyBins).toEqual([
        { storageType: 'OH1', bin: 'ONHOLD', reason: 'onHold' }
      ]);
    });

    test('resolves when keyed by warehouse alone (no plant specified)', async () => {
      const mockDb = jest.fn().mockImplementation((plant, wh) => {
        if (wh === 'W01') return rowW01;
        return null;
      });

      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      const res = await resolver.resolve({ warehouse: 'W01' });

      expect(res.plant).toBe('1120');
      expect(res.warehouse).toBe('W01');
      expect(res.salesOrg).toBe('1000');
      expect(res.orderType).toBe('ZDOM');
    });

    test('resolves plant-level row when warehouse has no specific row', async () => {
      const mockDb = jest.fn().mockImplementation((plant, _wh) => {
        if (plant === '1130') return rowPlantLevel;
        return null;
      });

      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      const res = await resolver.resolve({ plant: '1130' });

      expect(res.plant).toBe('1130');
      expect(res.salesOrg).toBe('3000');
      expect(res.shippingPoints).toEqual(['1130']);
      expect(res.mvt261NotReadyBins).toEqual([]);
    });
  });

  // ─── Two different warehouses in the same runtime ─────────────────────────

  describe('Two different warehouses in the same runtime', () => {
    test('resolves W01 and W02 independently with distinct configuration in the same process', async () => {
      const mockDb = jest.fn().mockImplementation((plant, wh) => {
        if (wh === 'W01') return rowW01;
        if (wh === 'W02') return rowW02;
        return null;
      });

      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      // First call for warehouse W01
      const resW01 = await resolver.resolve({ plant: '1120', warehouse: 'W01' });

      // Second call for warehouse W02 in the same runtime instance
      const resW02 = await resolver.resolve({ plant: '1120', warehouse: 'W02' });

      // Verify W01 values
      expect(resW01.warehouse).toBe('W01');
      expect(resW01.salesOrg).toBe('1000');
      expect(resW01.distChannel).toBe('10');
      expect(resW01.division).toBe('52');
      expect(resW01.currency).toBe('INR');
      expect(resW01.orderType).toBe('ZDOM');
      expect(resW01.shippingPoints).toEqual(['1120', '1112', '1108']);
      expect(resW01.differenceStorageType).toBe('999');
      expect(resW01.mvt261NotReadyBins[0].storageType).toBe('OH1');

      // Verify W02 values
      expect(resW02.warehouse).toBe('W02');
      expect(resW02.salesOrg).toBe('2000');
      expect(resW02.distChannel).toBe('20');
      expect(resW02.division).toBe('10');
      expect(resW02.currency).toBe('EUR');
      expect(resW02.orderType).toBe('ORD2');
      expect(resW02.shippingPoints).toEqual(['2201', '2202']);
      expect(resW02.differenceStorageType).toBe('998');
      expect(resW02.mvt261NotReadyBins[0].storageType).toBe('QA1');

      // Verify distinctness across both results
      expect(resW01.salesOrg).not.toBe(resW02.salesOrg);
      expect(resW01.currency).not.toBe(resW02.currency);
      expect(resW01.orderType).not.toBe(resW02.orderType);
      expect(resW01.shippingPoints).not.toEqual(resW02.shippingPoints);
      expect(resW01.mvt261NotReadyBins).not.toEqual(resW02.mvt261NotReadyBins);
    });
  });

  // ─── Unresolved case & strict fail-closed errors ──────────────────────────

  describe('Unresolved case: strict fail-closed and no fallback to defaults', () => {
    test('throws BusinessConfigError when config cannot be resolved for an unknown plant/warehouse', async () => {
      const mockDb = jest.fn().mockResolvedValue(null);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      await expect(resolver.resolve({ plant: '9999', warehouse: 'W99' }))
        .rejects.toThrow(BusinessConfigError);

      await expect(resolver.resolve({ plant: '9999', warehouse: 'W99' }))
        .rejects.toThrow(/could not resolve required business config fields/);
    });

    test('never falls back to process.env or package.json when resolving', async () => {
      process.env.S4_SALES_ORGANIZATION = 'FAKE_ORG';
      process.env.S4_PLANT = 'FAKE_PLANT';

      const mockDb = jest.fn().mockResolvedValue(null);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(BusinessConfigError);

      delete process.env.S4_SALES_ORGANIZATION;
      delete process.env.S4_PLANT;
    });

    test('throws when DB row has invalid JSON in Mvt261NotReadyBinsJson', async () => {
      const corruptRow = {
        ...rowW01,
        Mvt261NotReadyBinsJson: 'invalid-json{'
      };
      const mockDb = jest.fn().mockResolvedValue(corruptRow);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(/contains invalid JSON/);
    });

    test('throws when DB row Mvt261NotReadyBinsJson is not an array', async () => {
      const corruptRow = {
        ...rowW01,
        Mvt261NotReadyBinsJson: '{"storageType":"OH1"}'
      };
      const mockDb = jest.fn().mockResolvedValue(corruptRow);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(/must be a JSON array/);
    });
  });

  // ─── Filtered fields (subset resolution) ───────────────────────────────────

  describe('Subset fields resolution (used by specific adapters)', () => {
    test('resolves only mvt261NotReadyBins for Mvt261Adapter without requiring SD fields', async () => {
      const row = {
        Plant: '1120',
        WarehouseNumber: 'W01',
        Mvt261NotReadyBinsJson: JSON.stringify([{ storageType: 'OH1', bin: 'BIN1', reason: 'onHold' }])
      };
      const mockDb = jest.fn().mockResolvedValue(row);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      const res = await resolver.resolve({
        plant: '1120',
        warehouse: 'W01',
        fields: ['mvt261NotReadyBins']
      });

      expect(res.mvt261NotReadyBins).toEqual([{ storageType: 'OH1', bin: 'BIN1', reason: 'onHold' }]);
    });

    test('resolves only SD org fields for DeliveryNoRefAdapter', async () => {
      const row = {
        Plant: '1110',
        WarehouseNumber: '',
        SalesOrganization: '1000',
        DistributionChannel: '10',
        Division: '52'
      };
      const mockDb = jest.fn().mockResolvedValue(row);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      const res = await resolver.resolve({
        plant: '1110',
        fields: ['salesOrganization', 'distributionChannel', 'division']
      });

      expect(res.salesOrganization).toBe('1000');
      expect(res.distributionChannel).toBe('10');
      expect(res.division).toBe('52');
    });
  });
});
