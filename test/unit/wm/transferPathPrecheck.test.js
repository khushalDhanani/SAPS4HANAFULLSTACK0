'use strict';

const {
  classifyTransferPath,
  isShippingManaged,
  precheckPathA,
  defaultReservationComparator,
  assignHuToCompetingReservations,
  rankCompetingReservations,
  resolveHuStorageTypeRules
} = require('../../../srv/integration/s4hana/wm/transferPathHelper');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const businessConfigResolver = require('../../../srv/common/BusinessConfigResolver');
const { BusinessConfigError } = businessConfigResolver;

describe('transferPathHelper Unit Tests', () => {
  describe('classifyTransferPath and isShippingManaged (shared pure-T001L rule)', () => {
    test('returns "A" and isShippingManaged=true when VSTEL is present in T001L (Shipping-managed, e.g. CS02)', () => {
      const row = { WERKS: '1120', LGORT: 'CS02', VSTEL: '1105', XHUPF: 'X' };
      expect(classifyTransferPath(row)).toBe('A');
      expect(isShippingManaged(row)).toBe(true);
    });

    test('returns "A" and isShippingManaged=true when VKORG or KUNNR is present', () => {
      expect(isShippingManaged({ VKORG: '1000' })).toBe(true);
      expect(isShippingManaged({ KUNNR: '0000001120' })).toBe(true);
      expect(classifyTransferPath({ VKORG: '1000' })).toBe('A');
    });

    test('returns "B" and isShippingManaged=false when XHUPF is "X" and VSTEL is blank (HU-managed, non-shipping)', () => {
      const row = { WERKS: '1120', LGORT: 'HU01', VSTEL: '', XHUPF: 'X' };
      expect(classifyTransferPath(row)).toBe('B');
      expect(isShippingManaged(row)).toBe(false);
    });

    test('returns "standard" and isShippingManaged=false when both VSTEL and XHUPF are blank (e.g. CIS1, HS01)', () => {
      const row = { WERKS: '1120', LGORT: 'CIS1', VSTEL: '', XHUPF: '' };
      expect(classifyTransferPath(row)).toBe('standard');
      expect(isShippingManaged(row)).toBe(false);
    });

    test('returns "standard" and isShippingManaged=false when t001lRow is null or undefined', () => {
      expect(classifyTransferPath(null)).toBe('standard');
      expect(classifyTransferPath(undefined)).toBe('standard');
      expect(isShippingManaged(null)).toBe(false);
    });

    test('is exposed as a method and static on HuStockTransferAdapter and tools', () => {
      expect(typeof HuStockTransferAdapter.classifyTransferPath).toBe('function');
      expect(typeof HuStockTransferAdapter.isShippingManaged).toBe('function');
      const adapter = new HuStockTransferAdapter({ rfcClient: {} });
      expect(typeof adapter.classifyTransferPath).toBe('function');
      expect(typeof adapter.isShippingManaged).toBe('function');
      expect(adapter.classifyTransferPath({ VSTEL: '1105' })).toBe('A');
      expect(adapter.isShippingManaged({ VSTEL: '1105' })).toBe(true);
    });
  });

  describe('precheckPathA: blockers vs warnings (NO_T319A_ROW as warning)', () => {
    const baseReservation = {
      RSNUM: '0000529960',
      ReservationNo: '529960',
      MATNR: '8000009754',
      WERKS: '1120',
      LGORT: 'CS02',
      UMLGO: 'CIS1',
      warehouse: 'W01'
    };

    const baseHu = {
      unitNumber: '2000019372',
      inStock: true,
      availableStock: 1.0,
      packagingType: '0001',
      warehouse: 'W01',
      serials: ['MBP00001']
    };

    const validContext = {
      openDelivery: null,
      t319aRows: [
        { LGNUM: 'W01', VHART: '0001', LETYP: 'E1' },
        { LGNUM: 'W01', VHART: 'Z003', LETYP: 'E1' }
      ],
      marc: { SERNP: 'ZSN2' },
      t377Rows: [{ BELEG: 'SDLS', SERPFLICHT: '03' }]
    };

    test('passes with valid: true when no blockers exist', async () => {
      const result = await precheckPathA(baseReservation, '1', baseHu, validContext);
      expect(result.valid).toBe(true);
      expect(result.path).toBe('A');
      expect(result.blockers).toEqual([]);
      expect(result.blockerDetails).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.warningDetails).toEqual([]);
    });

    test('blocks when open outbound delivery already exists for reservation item', async () => {
      const ctx = {
        ...validContext,
        openDelivery: '0080000134'
      };
      const result = await precheckPathA(baseReservation, '1', baseHu, ctx);
      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBe(1);
      expect(result.blockers[0]).toContain('0080000134');
      expect(result.blockerDetails[0].code).toBe('OPEN_DELIVERY_EXISTS');
      expect(result.blockerDetails[0].key).toBe('blockerOpenDeliveryExists');
      expect(result.blockerDetails[0].params).toEqual(['0080000134', '529960', '1']);
    });

    test('blocks when HU is not in stock (availableStock <= 0 or inStock false)', async () => {
      const outOfStockHu = {
        ...baseHu,
        inStock: false,
        availableStock: 0
      };
      const result = await precheckPathA(baseReservation, '1', outOfStockHu, validContext);
      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBe(1);
      expect(result.blockers[0]).toContain('not in stock');
      expect(result.blockerDetails[0].code).toBe('HU_NOT_IN_STOCK');
      expect(result.blockerDetails[0].key).toBe('blockerHuNotInStock');
      expect(result.blockerDetails[0].params).toEqual(['2000019372', '1120', 'CS02']);
    });

    test('NO_T319A_ROW becomes a warning (not a blocker) and keeps valid: true', async () => {
      const z007Hu = {
        ...baseHu,
        packagingType: 'Z007'
      };
      const result = await precheckPathA(baseReservation, '1', z007Hu, validContext);
      expect(result.valid).toBe(true); // NOT blocked!
      expect(result.blockers.length).toBe(0);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('Packaging type Z007 has no storage unit type in warehouse W01');
      expect(result.warningDetails[0].code).toBe('NO_T319A_ROW');
      expect(result.warningDetails[0].severity).toBe('warning');
      expect(result.warningDetails[0].key).toBe('warningNoT319ARow');
      expect(result.warningDetails[0].params).toEqual(['Z007', 'W01']);
    });

    test('blocks when serial numbers are required by profile (ZSN2) but none selectable on HU', async () => {
      const noSerialHu = {
        ...baseHu,
        serials: []
      };
      const result = await precheckPathA(baseReservation, '1', noSerialHu, validContext);
      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBe(1);
      expect(result.blockers[0]).toContain('Serial numbers are required for material 8000009754');
      expect(result.blockerDetails[0].code).toBe('SERIAL_REQUIRED_NONE_SELECTABLE');
      expect(result.blockerDetails[0].key).toBe('blockerSerialRequired');
      expect(result.blockerDetails[0].params).toEqual(['8000009754']);
    });

    test('separates blockers from warnings when multiple conditions trigger simultaneously', async () => {
      const problematicHu = {
        ...baseHu,
        packagingType: 'Z007', // warning
        inStock: false,        // blocker
        availableStock: 0,
        serials: []            // blocker
      };
      const ctx = {
        ...validContext,
        openDelivery: '0080000134' // blocker
      };
      const result = await precheckPathA(baseReservation, '1', problematicHu, ctx);
      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBe(3); // openDelivery, not in stock, serial required
      expect(result.warnings.length).toBe(1); // NO_T319A_ROW
      const blockerCodes = result.blockerDetails.map(b => b.code);
      expect(blockerCodes).toContain('OPEN_DELIVERY_EXISTS');
      expect(blockerCodes).toContain('HU_NOT_IN_STOCK');
      expect(blockerCodes).toContain('SERIAL_REQUIRED_NONE_SELECTABLE');
      expect(result.warningDetails[0].code).toBe('NO_T319A_ROW');
    });

    test('is exposed as a method and static on HuStockTransferAdapter', async () => {
      expect(typeof HuStockTransferAdapter.precheckPathA).toBe('function');
      const adapter = new HuStockTransferAdapter({ rfcClient: {} });
      expect(typeof adapter.precheckPathA).toBe('function');
      const res = await adapter.precheckPathA(baseReservation, '1', baseHu, validContext);
      expect(res.valid).toBe(true);
    });
  });

  describe('Storage type rules via BusinessConfigResolver (fail closed, no literals)', () => {
    test('fails closed for W01 when storage types have not been supplied by business customizing', async () => {
      await expect(
        resolveHuStorageTypeRules({ warehouse: 'W01', plant: '1120' })
      ).rejects.toThrow(/Storage types must be supplied by business configuration; fail-closed without hardcoded defaults/);
    });

    test('resolves storage type rules when business configuration is explicitly registered', async () => {
      businessConfigResolver.registerWarehouseStorageTypes('W01', {
        pickableStorageTypes: ['EN1'],
        holdStorageTypes: ['QUARANTINE'],
        interimStorageTypes: ['911', '913', '921', '902']
      });

      const rules = await resolveHuStorageTypeRules({ warehouse: 'W01', plant: '1120' });
      expect(rules).toBeDefined();
      expect(rules.pickableStorageTypes).toContain('EN1');
      expect(rules.holdStorageTypes).toContain('QUARANTINE');
      expect(rules.interimStorageTypes).toContain('913');

      expect(rules.isPickable('EN1')).toBe(true);
      expect(rules.isPickable('OH1')).toBe(false);
      expect(rules.isOnHold('QUARANTINE')).toBe(true);
      expect(rules.isInterim('913')).toBe(true);

      // Clean up
      businessConfigResolver.unregisterWarehouseStorageTypes('W01');
    });

    test('does not classify OH1 or bin ONHOLD as hold without system/business evidence', async () => {
      const customRules = await resolveHuStorageTypeRules({
        warehouse: 'W01',
        plant: '1120',
        trustedOverrides: {
          pickableStorageTypes: ['EN1'],
          holdStorageTypes: ['QUARANTINE'], // Business defined QUARANTINE as hold, not OH1
          interimStorageTypes: ['913']
        }
      });

      expect(customRules.isOnHold('OH1')).toBe(false);
      expect(customRules.isOnHold('EN1', 'ONHOLD')).toBe(false);
      expect(customRules.isOnHold('QUARANTINE')).toBe(true);
    });

    test('fails closed when storage types are unconfigured for an unknown warehouse', async () => {
      await expect(
        resolveHuStorageTypeRules({ warehouse: 'W99', plant: '9999' })
      ).rejects.toThrow(BusinessConfigError);
    });

    test('accepts trustedOverrides for dynamic testing without modifying persistent config', async () => {
      const customRules = await resolveHuStorageTypeRules({
        warehouse: 'W88',
        plant: '8888',
        trustedOverrides: {
          pickableStorageTypes: ['HIGH_BAY'],
          holdStorageTypes: ['QUARANTINE'],
          interimStorageTypes: ['STAGING']
        }
      });

      expect(customRules.isPickable('HIGH_BAY')).toBe(true);
      expect(customRules.isOnHold('QUARANTINE')).toBe(true);
      expect(customRules.isInterim('STAGING')).toBe(true);
      expect(customRules.isOnHold('HIGH_BAY')).toBe(false);
    });

    test('fails closed if any storage type list is empty in the resolved config', async () => {
      await expect(
        resolveHuStorageTypeRules({
          warehouse: 'W77',
          trustedOverrides: {
            pickableStorageTypes: ['HIGH_BAY'],
            holdStorageTypes: [], // empty -> invalid
            interimStorageTypes: ['STAGING']
          }
        })
      ).rejects.toThrow(/fail-closed without hardcoded defaults/);
    });
  });

  describe('HU assignment among competing reservations (earliest BDTER, then reservation number)', () => {
    const resA = {
      RSNUM: '0000529960',
      ReservationNo: '529960',
      BDTER: '20261018',
      RSPOS: '0001'
    };

    const resB = {
      RSNUM: '0000529959',
      ReservationNo: '529959',
      BDTER: '20261018',
      RSPOS: '0001'
    };

    const resC = {
      RSNUM: '0000523654',
      ReservationNo: '523654',
      BDTER: '20261007',
      RSPOS: '0001'
    };

    test('defaultReservationComparator prioritizes earliest BDTER (Requirement Date)', () => {
      // resC (20261007) is earlier than resA (20261018)
      expect(defaultReservationComparator(resC, resA)).toBeLessThan(0);
      expect(defaultReservationComparator(resA, resC)).toBeGreaterThan(0);
    });

    test('defaultReservationComparator breaks BDTER ties by ascending Reservation Number (RSNUM)', () => {
      // resA and resB both have BDTER '20261018', but resB (529959) is earlier than resA (529960)
      expect(defaultReservationComparator(resB, resA)).toBeLessThan(0);
      expect(defaultReservationComparator(resA, resB)).toBeGreaterThan(0);
    });

    test('assignHuToCompetingReservations correctly assigns HU 2000019372 to winning reservation', () => {
      const candidates = [resA, resB, resC];
      const assignment = assignHuToCompetingReservations('2000019372', candidates);

      expect(assignment).toBeDefined();
      expect(assignment.huId).toBe('2000019372');
      // resC (523654) has the earliest requirement date (20261007) so it wins!
      expect(assignment.assignedReservation.RSNUM).toBe('0000523654');
      // Full ranked list order: resC (20261007), resB (529959/20261018), resA (529960/20261018)
      expect(assignment.rankedCandidates.map(r => r.ReservationNo)).toEqual(['523654', '529959', '529960']);
    });

    test('rankCompetingReservations returns sorted list without mutating input', () => {
      const candidates = [resA, resB];
      const ranked = rankCompetingReservations(candidates);
      expect(ranked[0].ReservationNo).toBe('529959');
      expect(ranked[1].ReservationNo).toBe('529960');
      expect(candidates[0].ReservationNo).toBe('529960'); // original order unchanged
    });

    test('supports custom injected comparator rule', () => {
      // Custom rule: latest BDTER first (reverse date priority)
      const reverseDateComparator = (a, b) => b.BDTER.localeCompare(a.BDTER);
      const assignment = assignHuToCompetingReservations('2000019372', [resA, resC], reverseDateComparator);
      expect(assignment.assignedReservation.ReservationNo).toBe('529960');
    });

    test('returns null when reservations array is empty or invalid', () => {
      expect(assignHuToCompetingReservations('2000019372', [])).toBeNull();
      expect(assignHuToCompetingReservations('2000019372', null)).toBeNull();
    });
  });
});
