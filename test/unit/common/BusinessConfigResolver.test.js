'use strict';

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');
const businessConfigResolver = require('../../../srv/common/BusinessConfigResolver');
const { BusinessConfigResolver, BusinessConfigError } = businessConfigResolver;

describe('Unit: BusinessConfigResolver (Hardened)', () => {

  // ─── Test Fixtures ─────────────────────────────────────────────────────────

  const rowW01 = {
    Plant: '1120',
    WarehouseNumber: 'W01',
    SalesOrganization: '1000',
    DistributionChannel: '14',
    Division: '00',
    Currency: 'INR',
    InquiryType: 'ZIN',
    OrderType: 'ZDOM',
    ConditionType: 'ZPR1',
    ShippingPoints: '1112, WAVG',
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

  beforeEach(() => {
    businessConfigResolver.clearCache();
  });

  // ─── (1) Tamper Protection: Trusted Server-Side Overrides Only ────────────

  describe('(1) Tamper Protection: Trusted server-side overrides only', () => {
    test('resolves from trustedOverrides when supplied by verified server-side caller', async () => {
      const dbSpy = jest.fn();
      const sapSpy = jest.fn();
      const resolver = new BusinessConfigResolver({
        dbQuery: dbSpy,
        sapCustomizing: sapSpy
      });

      const res = await resolver.resolve({
        plant: '1120',
        warehouse: 'W01',
        trustedOverrides: {
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
      expect(res.currency).toBe('GBP');
      expect(res.orderType).toBe('ZEXP');
      expect(res.shippingPoints).toEqual(['9901']);
    });

    test('accepts direct overrides when isTrusted=true is explicitly set by server context', async () => {
      const resolver = new BusinessConfigResolver();

      const res = await resolver.resolve({
        plant: '1120',
        warehouse: 'W01',
        isTrusted: true,
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
      expect(res.currency).toBe('USD');
      expect(res.shippingPoints).toEqual(['1120', '1108']);
    });

    test('TAMPER TEST: ignores overrides in untrusted request body and resolves authentic data from DB', async () => {
      const mockDb = jest.fn().mockResolvedValue(rowW01);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      // An untrusted caller passes request body with malicious overrides attempting to spoof sales org
      const untrustedRequestBody = {
        plant: '1120',
        warehouse: 'W01',
        salesOrg: 'MALICIOUS_9999',
        salesOrganization: 'MALICIOUS_9999',
        currency: 'HACKED_CURRENCY',
        orderType: 'SPOOFED',
        overrides: {
          salesOrganization: 'MALICIOUS_9999',
          currency: 'HACKED_CURRENCY'
        }
      };

      const res = await resolver.resolve(untrustedRequestBody);

      // Verify tamper protection: untrusted overrides were ignored, DB was queried, and authentic values were returned
      expect(mockDb).toHaveBeenCalledWith('1120', 'W01');
      expect(res.salesOrganization).toBe('1000');  // authentic value from DB, NOT MALICIOUS_9999
      expect(res.salesOrg).toBe('1000');
      expect(res.currency).toBe('INR');           // authentic value from DB, NOT HACKED_CURRENCY
      expect(res.orderType).toBe('ZDOM');         // authentic value from DB, NOT SPOOFED
    });

    test('TAMPER TEST: fails closed when untrusted body supplies invalid plant and attempted overrides', async () => {
      const mockDb = jest.fn().mockResolvedValue(null);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      // Untrusted body provides fake plant and fake salesOrg
      await expect(resolver.resolve({
        plant: '9999',
        warehouse: 'W99',
        salesOrg: 'MALICIOUS_9999'
      })).rejects.toThrow(BusinessConfigError);
    });
  });

  // ─── (2) Write Restrictions: @requires: 'WMAdmin' ──────────────────────────

  describe('(2) Write restrictions: @requires: WMAdmin, read-only otherwise', () => {
    test('db/wm/business-config.cds annotates BusinessConfig entity with WMAdmin write restrictions', async () => {
      const csn = await cds.load('db/wm/business-config.cds');
      const entity = csn.definitions['saps4hana.wm.BusinessConfig'];
      expect(entity).toBeDefined();

      const restrict = entity['@restrict'];
      expect(Array.isArray(restrict)).toBe(true);

      const readRule = restrict.find(r => r.grant === 'READ');
      expect(readRule).toBeDefined();
      expect(readRule.to).toBe('authenticated-user');

      const writeRule = restrict.find(r => Array.isArray(r.grant) && r.grant.includes('CREATE'));
      expect(writeRule).toBeDefined();
      expect(writeRule.grant).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE', 'WRITE']));
      expect(writeRule.to).toBe('WMAdmin');
    });

    test('srv/wm/business-config/service.cds annotates BusinessConfigs projection with WMAdmin write restrictions', async () => {
      const csn = await cds.load('srv/wm/business-config/service.cds');
      const srv = csn.definitions['saps4hana.wm.BusinessConfigService'];
      expect(srv).toBeDefined();
      expect(srv['@requires']).toBe('authenticated-user');

      const entity = csn.definitions['saps4hana.wm.BusinessConfigService.BusinessConfigs'];
      expect(entity).toBeDefined();

      const restrict = entity['@restrict'];
      expect(Array.isArray(restrict)).toBe(true);

      const readRule = restrict.find(r => r.grant === 'READ');
      expect(readRule).toBeDefined();
      expect(readRule.to).toBe('authenticated-user');

      const writeRule = restrict.find(r => Array.isArray(r.grant) && r.grant.includes('CREATE'));
      expect(writeRule).toBeDefined();
      expect(writeRule.to).toBe('WMAdmin');
    });
  });

  // ─── (3) Seed CSV for W01 / Plant 1120 ──────────────────────────────────────

  describe('(3) Seed CSV for W01 / plant 1120 (confirmed customizing values only)', () => {
    test('seed CSV exists in db/data/saps4hana.wm-BusinessConfig.csv and contains only confirmed values', () => {
      const csvPath = path.resolve(__dirname, '../../../db/data/saps4hana.wm-BusinessConfig.csv');
      expect(fs.existsSync(csvPath)).toBe(true);

      const content = fs.readFileSync(csvPath, 'utf8').trim();
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
      expect(lines.length).toBe(2);

      const headers = lines[0].split(';');
      const values = lines[1].split(';');

      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });

      // Confirmed SAP customizing values:
      expect(row.Plant).toBe('1120');
      expect(row.WarehouseNumber).toBe('W01');
      expect(row.SalesOrganization).toBe('1000');
      expect(row.DistributionChannel).toBe('14');
      expect(row.Division).toBe('00');
      expect(row.Currency).toBe('INR');
      expect(row.ShippingPoints).toBe('1112,WAVG');
      expect(row.Active).toBe('true');

      // Unverified / unconfirmed fields MUST BE EMPTY (no guessed values):
      expect(row.InquiryType).toBe('');
      expect(row.OrderType).toBe('');
      expect(row.ConditionType).toBe('');
      expect(row.SalesMaterialTypes).toBe('');
      expect(row.DifferenceStorageType).toBe('');
      expect(row.Mvt261NotReadyBinsJson).toBe('');
    });
  });

  // ─── (4) Per-Key TTL Cache with Invalidation on Admin Writes ───────────────

  describe('(4) Per-key TTL cache with invalidation on admin writes', () => {
    test('caches resolved authentic config per plant/warehouse key', async () => {
      const mockDb = jest.fn().mockResolvedValue(rowW01);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb, ttlMs: 60000 });

      // First call queries DB
      const res1 = await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(mockDb).toHaveBeenCalledTimes(1);
      expect(res1.salesOrg).toBe('1000');
      expect(resolver.getCacheSize()).toBe(1);

      // Second call returns cached value without calling DB again
      const res2 = await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(mockDb).toHaveBeenCalledTimes(1); // Still 1!
      expect(res2).toEqual(res1);
    });

    test('invalidates cache specifically for updated plant/warehouse', async () => {
      const mockDb = jest.fn().mockImplementation((plant, wh) => {
        if (wh === 'W01') return rowW01;
        if (wh === 'W02') return rowW02;
        return null;
      });

      const resolver = new BusinessConfigResolver({ dbQuery: mockDb, ttlMs: 60000 });

      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      await resolver.resolve({ plant: '1120', warehouse: 'W02' });
      expect(resolver.getCacheSize()).toBe(2);
      expect(mockDb).toHaveBeenCalledTimes(2);

      // Invalidate only W01
      resolver.invalidate('1120', 'W01');
      expect(resolver.getCacheSize()).toBe(1);

      // W02 is still cached
      await resolver.resolve({ plant: '1120', warehouse: 'W02' });
      expect(mockDb).toHaveBeenCalledTimes(2); // No new DB call for W02

      // W01 must re-query DB
      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(mockDb).toHaveBeenCalledTimes(3); // New DB call for W01
    });

    test('cache entry expires after TTL', async () => {
      const mockDb = jest.fn().mockResolvedValue(rowW01);
      // Short TTL of 50ms
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb, ttlMs: 50 });

      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(mockDb).toHaveBeenCalledTimes(1);

      // Before expiry: hits cache
      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(mockDb).toHaveBeenCalledTimes(1);

      // Wait 60ms for TTL to expire
      await new Promise(r => setTimeout(r, 60));

      // After expiry: re-queries DB
      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(mockDb).toHaveBeenCalledTimes(2);
    });

    test('BusinessConfigService handler invalidates resolver cache on admin writes', async () => {
      const BusinessConfigService = require('../../../srv/wm/business-config/service');
      const service = new BusinessConfigService();

      let afterHandler = null;
      service.after = jest.fn().mockImplementation((events, entity, fn) => {
        if (events.includes('UPDATE')) afterHandler = fn;
      });
      Object.defineProperty(service, 'entities', {
        value: { BusinessConfigs: 'BusinessConfigs' },
        configurable: true
      });
      jest.spyOn(cds.ApplicationService.prototype, 'init').mockResolvedValue(service);

      await service.init();
      expect(service.after).toHaveBeenCalledWith(
        ['CREATE', 'UPDATE', 'DELETE'],
        'BusinessConfigs',
        expect.any(Function)
      );

      // Seed cache
      const mockDb = jest.fn().mockResolvedValue(rowW01);
      businessConfigResolver._dbQuery = mockDb;
      businessConfigResolver.clearCache();

      await businessConfigResolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(businessConfigResolver.getCacheSize()).toBe(1);

      // Admin executes an update
      afterHandler({ Plant: '1120', WarehouseNumber: 'W01' });
      expect(businessConfigResolver.getCacheSize()).toBe(0);
    });
  });

  // ─── (5) Read-Only Live Check Validation (T001L, T320, TVKO) ────────────────

  describe('(5) Live check logic: T001L, T320 and TVKO querying and mapping', () => {
    test('queries T001L, T320, TVKO and correctly derives confirmed customizing values', async () => {
      const mockRfc = {
        readTable: jest.fn().mockImplementation((table, _fields, _where) => {
          if (table === 'T001L') {
            return [{
              WERKS: '1120',
              LGORT: 'CS02',
              LGOBE: 'Raw Material',
              VKORG: '1000',
              VTWEG: '14',
              SPART: '00',
              KUNNR: '0000001120',
              XHUPF: 'X'
            }];
          }
          if (table === 'T320') {
            return [{ WERKS: '1120', LGORT: 'CS02', LGNUM: 'W01' }];
          }
          if (table === 'TVKO') {
            return [{ VKORG: '1000', BUKRS: '1000', WAERS: 'INR' }];
          }
          return [];
        })
      };

      const mockDb = jest.fn().mockResolvedValue(rowW01);
      const resolver = new BusinessConfigResolver({ rfc: mockRfc, dbQuery: mockDb });

      const res = await resolver.resolve({
        plant: '1120',
        storageLocation: 'CS02'
      });

      expect(mockRfc.readTable).toHaveBeenCalledWith('T001L', expect.any(Array), expect.any(Array));
      expect(mockRfc.readTable).toHaveBeenCalledWith('T320', expect.any(Array), expect.any(Array));

      expect(res.salesOrganization).toBe('1000');
      expect(res.distributionChannel).toBe('14');
      expect(res.division).toBe('00');
      expect(res.warehouseNumber).toBe('W01');
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
      expect(resW01.distChannel).toBe('14');
      expect(resW01.division).toBe('00');
      expect(resW01.currency).toBe('INR');
      expect(resW01.orderType).toBe('ZDOM');
      expect(resW01.shippingPoints).toEqual(['1112', 'WAVG']);

      // Verify W02 values
      expect(resW02.warehouse).toBe('W02');
      expect(resW02.salesOrg).toBe('2000');
      expect(resW02.distChannel).toBe('20');
      expect(resW02.division).toBe('10');
      expect(resW02.currency).toBe('EUR');
      expect(resW02.orderType).toBe('ORD2');
      expect(resW02.shippingPoints).toEqual(['2201', '2202']);

      // Verify distinctness across both results
      expect(resW01.salesOrg).not.toBe(resW02.salesOrg);
      expect(resW01.currency).not.toBe(resW02.currency);
      expect(resW01.shippingPoints).not.toEqual(resW02.shippingPoints);
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

    test('resolves plant-level configuration when warehouse is unspecified', async () => {
      const mockDb = jest.fn().mockResolvedValue(rowPlantLevel);
      const resolver = new BusinessConfigResolver({ dbQuery: mockDb });

      const res = await resolver.resolve({
        plant: '1130'
      });

      expect(res.salesOrganization).toBe('3000');
      expect(res.distributionChannel).toBe('30');
      expect(res.currency).toBe('USD');
    });
  });
});
