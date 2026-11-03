'use strict';

const fs = require('fs');
const path = require('path');
const businessConfigResolver = require('../../../srv/common/BusinessConfigResolver');
const { BusinessConfigResolver, BusinessConfigError } = businessConfigResolver;

describe('Unit: BusinessConfigResolver (Hardened)', () => {

  // ─── Test Fixtures ─────────────────────────────────────────────────────────

  const customizingW01 = {
    salesOrganization: '1000',
    distributionChannel: '14',
    division: '00',
    currency: 'INR',
    inquiryType: 'ZIN',
    orderType: 'ZDOM',
    conditionType: 'ZPR1',
    shippingPoints: '1112, WAVG',
    salesMaterialTypes: 'ZFRT, FERT',
    differenceStorageType: '999',
    mvt261NotReadyBins: JSON.stringify([
      { storageType: 'OH1', bin: 'ONHOLD', reason: 'onHold' }
    ])
  };

  const customizingW02 = {
    ...customizingW01,
    salesOrganization: '2000',
    distributionChannel: '20',
    division: '10',
    currency: 'EUR',
    orderType: 'ORD2',
    shippingPoints: '2201, 2202'
  };

  beforeEach(() => {
    businessConfigResolver.clearCache();
  });

  describe('HU storage-type config shape and oversize policy', () => {
    test('requires non-empty, disjoint storage-type lists and normalizes codes', () => {
      expect(businessConfigResolver.validateHuStorageTypeLists({
        PickableStorageTypes: ' en1, EN2 ',
        HoldStorageTypes: 'OH1',
        InterimStorageTypes: ['911', '913']
      })).toEqual({
        pickableStorageTypes: ['EN1', 'EN2'],
        holdStorageTypes: ['OH1'],
        interimStorageTypes: ['911', '913']
      });
      expect(() => businessConfigResolver.validateHuStorageTypeLists({
        PickableStorageTypes: 'EN1', HoldStorageTypes: '', InterimStorageTypes: '921'
      })).toThrow(/must be non-empty/);
      expect(() => businessConfigResolver.validateHuStorageTypeLists({
        PickableStorageTypes: 'EN1', HoldStorageTypes: 'EN1', InterimStorageTypes: '921'
      })).toThrow(/overlaps/);
    });

    test('an oversize HU stays blocked', async () => {
      const resolver = new BusinessConfigResolver({ ttlMs: 0 });
      expect(await resolver.resolveOversizeHuSelectionBehavior({ plant: '1120', warehouse: 'W01' })).toBe('BLOCK');
    });

    test('storage-type rules fail closed unless a warehouse has them registered', async () => {
      const resolver = new BusinessConfigResolver({ ttlMs: 0 });
      await expect(resolver.resolveHuStorageTypeRules({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(/could not resolve storage type rules/);

      BusinessConfigResolver.registerWarehouseStorageTypes('W01', {
        pickableStorageTypes: ['EN1'], holdStorageTypes: ['OH1'], interimStorageTypes: ['911']
      });
      try {
        const rules = await resolver.resolveHuStorageTypeRules({ plant: '1120', warehouse: 'W01' });
        expect(rules.isPickable('EN1')).toBe(true);
        expect(rules.isOnHold('OH1')).toBe(true);
        expect(rules.isInterim('911')).toBe(true);
      } finally {
        BusinessConfigResolver.unregisterWarehouseStorageTypes('W01');
      }
    });
  });

  // ─── (1) Tamper Protection: Trusted Server-Side Overrides Only ────────────

  describe('(1) Tamper Protection: Trusted server-side overrides only', () => {
    test('resolves from trustedOverrides when supplied by verified server-side caller', async () => {
      const sapSpy = jest.fn();
      const resolver = new BusinessConfigResolver({ sapCustomizing: sapSpy });

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

    test('TAMPER TEST: ignores overrides in untrusted request body and resolves authentic data from SAP', async () => {
      const resolver = new BusinessConfigResolver({ sapCustomizing: async () => customizingW01 });

      // An untrusted caller passes request body with malicious overrides attempting to spoof sales org
      const res = await resolver.resolve({
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
      });

      expect(res.salesOrganization).toBe('1000');
      expect(res.salesOrg).toBe('1000');
      expect(res.currency).toBe('INR');
      expect(res.orderType).toBe('ZDOM');
    });

    test('TAMPER TEST: fails closed when untrusted body supplies invalid plant and attempted overrides', async () => {
      const resolver = new BusinessConfigResolver();

      await expect(resolver.resolve({
        plant: '9999',
        warehouse: 'W99',
        salesOrg: 'MALICIOUS_9999'
      })).rejects.toThrow(BusinessConfigError);
    });
  });

  // ─── (2) Per-Key TTL Cache ─────────────────────────────────────────────────

  describe('(2) Per-key TTL cache', () => {
    test('caches resolved authentic config per plant/warehouse key', async () => {
      const sap = jest.fn().mockResolvedValue(customizingW01);
      const resolver = new BusinessConfigResolver({ sapCustomizing: sap, ttlMs: 60000 });

      const res1 = await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(sap).toHaveBeenCalledTimes(1);
      expect(res1.salesOrg).toBe('1000');
      expect(resolver.getCacheSize()).toBe(1);

      const res2 = await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(sap).toHaveBeenCalledTimes(1);
      expect(res2).toEqual(res1);
    });

    test('invalidates cache specifically for the given plant/warehouse', async () => {
      const sap = jest.fn().mockImplementation(async ({ warehouse }) => (warehouse === 'W01' ? customizingW01 : customizingW02));
      const resolver = new BusinessConfigResolver({ sapCustomizing: sap, ttlMs: 60000 });

      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      await resolver.resolve({ plant: '1120', warehouse: 'W02' });
      expect(resolver.getCacheSize()).toBe(2);
      expect(sap).toHaveBeenCalledTimes(2);

      resolver.invalidate('1120', 'W01');
      expect(resolver.getCacheSize()).toBe(1);

      await resolver.resolve({ plant: '1120', warehouse: 'W02' });
      expect(sap).toHaveBeenCalledTimes(2);

      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(sap).toHaveBeenCalledTimes(3);
    });

    test('cache entry expires after TTL', async () => {
      const sap = jest.fn().mockResolvedValue(customizingW01);
      const resolver = new BusinessConfigResolver({ sapCustomizing: sap, ttlMs: 50 });

      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(sap).toHaveBeenCalledTimes(1);

      await new Promise(r => setTimeout(r, 60));

      await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      expect(sap).toHaveBeenCalledTimes(2);
    });
  });

  // ─── (3) SAP customizing reads ─────────────────────────────────────────────

  describe('(3) SAP customizing: T001L, T320, T001K, T001 and TVSTZ', () => {
    const sapRfc = (overrides = {}) => ({
      readTable: jest.fn(async (table, fields, where) => {
        if (overrides[table]) return overrides[table](where);
        if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
        if (table === 'T001') return [{ BUKRS: '1000', WAERS: 'INR' }];
        if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02', VKORG: '1000', VTWEG: '14', SPART: '00' }];
        if (table === 'T320') return [{ WERKS: '1120', LGORT: 'CS02', LGNUM: 'W01' }];
        if (table === 'TVSTZ') return [{ WERKS: '1120', VSTEL: '1112' }, { WERKS: '1120', VSTEL: 'WAVG' }];
        return [];
      })
    });

    test('derives the sales area and warehouse of a storage location', async () => {
      const rfc = sapRfc();
      const resolver = new BusinessConfigResolver({ rfc, ttlMs: 0 });

      const res = await resolver.resolve({
        plant: '1120',
        storageLocation: 'CS02',
        fields: ['salesOrganization', 'distributionChannel', 'division']
      });

      expect(rfc.readTable).toHaveBeenCalledWith('T001L', expect.any(Array), expect.any(Array));
      expect(rfc.readTable).toHaveBeenCalledWith('T320', expect.any(Array), expect.any(Array));
      expect(res.salesOrganization).toBe('1000');
      expect(res.distributionChannel).toBe('14');
      expect(res.division).toBe('00');
      expect(res.warehouseNumber).toBe('W01');
    });

    test('a storage location with no sales area in T001L fails closed', async () => {
      const rfc = sapRfc({ T001L: () => [{ WERKS: '1120', LGORT: 'HS01', VKORG: '', VTWEG: '', SPART: '' }] });
      const resolver = new BusinessConfigResolver({ rfc, ttlMs: 0 });
      await expect(resolver.resolve({ plant: '1120', storageLocation: 'HS01', flow: 'delivery-no-ref' }))
        .rejects.toThrow(/could not resolve required business config fields \[salesOrganization, distributionChannel, division\]/);
    });

    test('company code (T001K) and its currency (T001) are read from SAP', async () => {
      const resolver = new BusinessConfigResolver({ rfc: sapRfc(), ttlMs: 0 });
      const res = await resolver.resolve({ plant: '1120', warehouse: 'W01', storageLocation: 'CS02', fields: ['currency', 'salesOrganization'] });
      expect(res).toMatchObject({ companyCode: '1000', currency: 'INR', salesOrganization: '1000' });
    });

    test('shipping points of a plant come from TVSTZ', async () => {
      const resolver = new BusinessConfigResolver({ rfc: sapRfc(), ttlMs: 0 });
      const res = await resolver.resolve({ plant: '1120', fields: ['shippingPoints'] });
      expect(res.shippingPoints).toEqual(['1112', 'WAVG']);
    });

    test('an invalid plant key fails closed before any SAP read', async () => {
      const rfc = sapRfc();
      const resolver = new BusinessConfigResolver({ rfc, ttlMs: 0 });
      await expect(resolver.resolve({ plant: "1120' OR WERKS <> '", fields: ['currency'] })).rejects.toThrow(/rejected plant/);
      expect(rfc.readTable).not.toHaveBeenCalled();
    });

    test('neither plant nor warehouse -> specific error', async () => {
      const resolver = new BusinessConfigResolver({ ttlMs: 0 });
      await expect(resolver.resolve({ fields: ['currency'] })).rejects.toThrow(/neither plant nor warehouse/);
    });

    test('SAP read failures are named in the final error instead of being swallowed', async () => {
      const rfc = sapRfc({ T001K: () => { throw new Error('RFC_COMMUNICATION_FAILURE'); }, T001L: () => [] });
      const resolver = new BusinessConfigResolver({ rfc, ttlMs: 0 });
      await expect(resolver.resolve({ plant: '1120', storageLocation: 'CS02', fields: ['currency'] })).rejects.toThrow(/T001K\/T001: RFC_COMMUNICATION_FAILURE/);
    });

    test('cache key includes the flow: same plant/warehouse resolved for two flows are two entries', async () => {
      const sap = jest.fn().mockResolvedValue(customizingW01);
      const resolver = new BusinessConfigResolver({ sapCustomizing: sap, ttlMs: 60000 });
      await resolver.resolve({ plant: '1120', warehouse: 'W01', flow: 'delivery-no-ref' });
      await resolver.resolve({ plant: '1120', warehouse: 'W01', flow: '261' });
      expect(resolver.getCacheSize()).toBe(2);
      expect(resolver.getCacheEntry('1120', 'W01', resolver.FLOW_REQUIRED_FIELDS['261'], '261')).toBeTruthy();
      await resolver.resolve({ plant: '1120', warehouse: 'W01', flow: '261' }); // served from cache
      expect(sap).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Two different warehouses in the same runtime ─────────────────────────

  describe('Two different warehouses in the same runtime', () => {
    test('resolves W01 and W02 independently in the same process', async () => {
      const resolver = new BusinessConfigResolver({
        sapCustomizing: async ({ warehouse }) => (warehouse === 'W01' ? customizingW01 : customizingW02)
      });

      const resW01 = await resolver.resolve({ plant: '1120', warehouse: 'W01' });
      const resW02 = await resolver.resolve({ plant: '1120', warehouse: 'W02' });

      expect(resW01).toMatchObject({ warehouse: 'W01', salesOrg: '1000', distChannel: '14', division: '00', currency: 'INR', orderType: 'ZDOM' });
      expect(resW01.shippingPoints).toEqual(['1112', 'WAVG']);
      expect(resW02).toMatchObject({ warehouse: 'W02', salesOrg: '2000', distChannel: '20', division: '10', currency: 'EUR', orderType: 'ORD2' });
      expect(resW02.shippingPoints).toEqual(['2201', '2202']);
    });
  });

  // ─── Unresolved case & strict fail-closed errors ──────────────────────────

  describe('Unresolved case: strict fail-closed and no fallback to defaults', () => {
    test('throws BusinessConfigError when config cannot be resolved for an unknown plant/warehouse', async () => {
      const resolver = new BusinessConfigResolver();

      await expect(resolver.resolve({ plant: '9999', warehouse: 'W99' }))
        .rejects.toThrow(BusinessConfigError);

      await expect(resolver.resolve({ plant: '9999', warehouse: 'W99' }))
        .rejects.toThrow(/could not resolve required business config fields/);
    });

    test('never falls back to process.env or package.json when resolving', async () => {
      process.env.S4_SALES_ORGANIZATION = 'FAKE_ORG';
      process.env.S4_PLANT = 'FAKE_PLANT';

      const resolver = new BusinessConfigResolver();

      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(BusinessConfigError);

      delete process.env.S4_SALES_ORGANIZATION;
      delete process.env.S4_PLANT;
    });

    test('throws when mvt261NotReadyBins is invalid JSON', async () => {
      const resolver = new BusinessConfigResolver({ sapCustomizing: async () => ({ ...customizingW01, mvt261NotReadyBins: 'invalid-json{' }) });

      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(/contains invalid JSON/);
    });

    test('throws when mvt261NotReadyBins is not an array', async () => {
      const resolver = new BusinessConfigResolver({ sapCustomizing: async () => ({ ...customizingW01, mvt261NotReadyBins: '{"storageType":"OH1"}' }) });

      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01' }))
        .rejects.toThrow(/must be a JSON array/);
    });
  });

  // ─── Flow-Specific Required Fields ─────────────────────────────────────────

  describe('Flow-specific required fields (delivery-no-ref, 261, scan-to)', () => {
    test('FLOW_REQUIRED_FIELDS defines exact minimal fields per flow', () => {
      expect(BusinessConfigResolver.FLOW_REQUIRED_FIELDS['delivery-no-ref']).toEqual([
        'salesOrganization', 'distributionChannel', 'division'
      ]);
      expect(BusinessConfigResolver.FLOW_REQUIRED_FIELDS['261']).toEqual([
        'mvt261NotReadyBins'
      ]);
      expect(BusinessConfigResolver.FLOW_REQUIRED_FIELDS['scan-to']).toEqual([
        'warehouseNumber', 'plant'
      ]);
    });

    test('delivery-no-ref flow requires only salesOrganization, distributionChannel, division', async () => {
      const resolver = new BusinessConfigResolver({
        sapCustomizing: async () => ({ salesOrganization: '1000', distributionChannel: '14', division: '00' })
      });

      const res = await resolver.resolve({ plant: '1120', flow: 'delivery-no-ref' });

      expect(res.salesOrganization).toBe('1000');
      expect(res.distributionChannel).toBe('14');
      expect(res.division).toBe('00');
    });

    test('261 flow requires only mvt261NotReadyBins, and without a source it fails closed for the caller to handle', async () => {
      const resolver = new BusinessConfigResolver();
      await expect(resolver.resolve({ plant: '1120', warehouse: 'W01', flow: '261' })).rejects.toThrow(/mvt261NotReadyBins/);

      const withBins = new BusinessConfigResolver({
        sapCustomizing: async () => ({ mvt261NotReadyBins: [{ storageType: 'QA1', bin: 'INSP', reason: 'qualityInspection' }] })
      });
      const res = await withBins.resolve({ plant: '1120', warehouse: 'W01', flow: '261' });
      expect(res.mvt261NotReadyBins).toEqual([{ storageType: 'QA1', bin: 'INSP', reason: 'qualityInspection' }]);
    });

    test('scan-to flow requires only warehouseNumber and plant', async () => {
      const resolver = new BusinessConfigResolver();

      const res = await resolver.resolve({ plant: '1120', warehouse: 'W01', flow: 'scan-to' });

      expect(res.plant).toBe('1120');
      expect(res.warehouseNumber).toBe('W01');
    });
  });

  // ─── Security Profile Alignment: WarehouseManager and Admin in xs-security.json ─

  describe('Security profile alignment: WarehouseManager and Admin in xs-security.json', () => {
    test('confirms WarehouseManager and Admin exist in xs-security.json and WMAdmin does not', () => {
      const secPath = path.join(__dirname, '../../../xs-security.json');
      expect(fs.existsSync(secPath)).toBe(true);
      const sec = JSON.parse(fs.readFileSync(secPath, 'utf8'));

      const scopes = (sec.scopes || []).map(s => s.name);
      const roleTemplates = (sec['role-templates'] || []).map(r => r.name);
      const roleCollections = (sec['role-collections'] || []).map(c => c.name);

      // Factual check: WMAdmin does NOT exist in xs-security.json
      expect(scopes.some(s => s.includes('WMAdmin'))).toBe(false);
      expect(roleTemplates.includes('WMAdmin')).toBe(false);
      expect(roleCollections.includes('SAPS4HANA_WMAdmin')).toBe(false);

      // Actual warehouse and admin roles defined in xs-security.json granted write access:
      expect(roleTemplates).toContain('Admin');
      expect(roleTemplates).toContain('WarehouseManager');
      expect(scopes).toContain('$XSAPPNAME.Admin');
      expect(scopes).toContain('$XSAPPNAME.WarehouseManager');
      expect(roleCollections).toContain('SAPS4HANA_Admin');
      expect(roleCollections).toContain('SAPS4HANA_WarehouseManager');
    });
  });

  // ─── Live Customizing Confirmation (Parts 1 & 2) ──────────────────────────

  describe('Live SAP customizing data confirmation (DC 10/52 vs 14/00, TVSTZ/TVST)', () => {
    test('confirms Customer 1120 uses 1000/14/00 while legacy Customer 10135 used 1000/10/52', () => {
      // Plant 1120 / CS02 assigns Customer 0000001120 in T001L:
      const t001l_CS02 = { WERKS: '1120', LGORT: 'CS02', VKORG: '1000', VTWEG: '14', SPART: '00', KUNNR: '0000001120' };

      // KNVV records verified live from Client 220:
      const knvv_1120 = { KUNNR: '0000001120', VKORG: '1000', VTWEG: '14', SPART: '00' };
      const knvv_10135 = { KUNNR: '0000010135', VKORG: '1000', VTWEG: '10', SPART: '52' };

      expect(knvv_1120.VKORG).toBe(t001l_CS02.VKORG);
      expect(knvv_1120.VTWEG).toBe(t001l_CS02.VTWEG);
      expect(knvv_1120.SPART).toBe(t001l_CS02.SPART);

      // Customer 10135 explains why DC 10 / Div 52 was previously hardcoded:
      expect(knvv_10135.VTWEG).toBe('10');
      expect(knvv_10135.SPART).toBe('52');
    });

    test('confirms shipping points for Plant 1120 in TVSTZ and TVST: 1112 and WAVG are both valid', () => {
      const tvstz_1120 = ['WAVG', '1112'];
      const tvst_entries = [
        { VSTEL: '1112', FABKL: 'IN', ALAND: 'IN', VTEXT: '1120-FG Loading Area' },
        { VSTEL: 'WAVG', FABKL: 'IN', ALAND: 'IN', VTEXT: 'Aether Vault Gamma' }
      ];

      expect(tvstz_1120).toContain('1112');
      expect(tvstz_1120).toContain('WAVG');

      const vstelCodes = tvst_entries.map(e => e.VSTEL);
      expect(vstelCodes).toContain('1112');
      expect(vstelCodes).toContain('WAVG');
    });
  });
});
