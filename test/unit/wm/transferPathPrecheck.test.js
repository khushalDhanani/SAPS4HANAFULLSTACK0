'use strict';

const { classifyTransferPath, precheckPathA } = require('../../../srv/integration/s4hana/wm/transferPathHelper');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');

describe('transferPathHelper Unit Tests', () => {
  describe('classifyTransferPath', () => {
    test('returns "A" when VSTEL is present in T001L (Shipping-managed, e.g. CS02)', () => {
      const row = { WERKS: '1120', LGORT: 'CS02', VSTEL: '1105', XHUPF: 'X' };
      expect(classifyTransferPath(row)).toBe('A');
    });

    test('returns "A" when VSTEL is present even if XHUPF is blank', () => {
      const row = { WERKS: '1120', LGORT: 'CS03', VSTEL: '1105', XHUPF: '' };
      expect(classifyTransferPath(row)).toBe('A');
    });

    test('returns "B" when XHUPF is "X" and VSTEL is blank (HU-managed, non-shipping)', () => {
      const row = { WERKS: '1120', LGORT: 'HU01', VSTEL: '', XHUPF: 'X' };
      expect(classifyTransferPath(row)).toBe('B');
    });

    test('returns "standard" when both VSTEL and XHUPF are blank (e.g. CIS1, HS01)', () => {
      const row = { WERKS: '1120', LGORT: 'CIS1', VSTEL: '', XHUPF: '' };
      expect(classifyTransferPath(row)).toBe('standard');
    });

    test('returns "standard" when t001lRow is null or undefined', () => {
      expect(classifyTransferPath(null)).toBe('standard');
      expect(classifyTransferPath(undefined)).toBe('standard');
    });

    test('is exposed as a method and static on HuStockTransferAdapter', () => {
      expect(typeof HuStockTransferAdapter.classifyTransferPath).toBe('function');
      const adapter = new HuStockTransferAdapter({ rfcClient: {} });
      expect(typeof adapter.classifyTransferPath).toBe('function');
      expect(adapter.classifyTransferPath({ VSTEL: '1105' })).toBe('A');
    });
  });

  describe('precheckPathA', () => {
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

    test('blocks when HU packaging type has no T319A row in warehouse (e.g. Z007 in W01)', async () => {
      const z007Hu = {
        ...baseHu,
        packagingType: 'Z007'
      };
      const result = await precheckPathA(baseReservation, '1', z007Hu, validContext);
      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBe(1);
      expect(result.blockers[0]).toContain('Packaging type Z007 has no storage unit type in warehouse W01');
      expect(result.blockerDetails[0].code).toBe('NO_T319A_ROW');
      expect(result.blockerDetails[0].key).toBe('blockerNoT319ARow');
      expect(result.blockerDetails[0].params).toEqual(['Z007', 'W01']);
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

    test('accumulates multiple simultaneous blockers', async () => {
      const problematicHu = {
        ...baseHu,
        packagingType: 'Z007',
        inStock: false,
        availableStock: 0,
        serials: []
      };
      const ctx = {
        ...validContext,
        openDelivery: '0080000134'
      };
      const result = await precheckPathA(baseReservation, '1', problematicHu, ctx);
      expect(result.valid).toBe(false);
      expect(result.blockers.length).toBe(4);
      const codes = result.blockerDetails.map(b => b.code);
      expect(codes).toContain('OPEN_DELIVERY_EXISTS');
      expect(codes).toContain('HU_NOT_IN_STOCK');
      expect(codes).toContain('NO_T319A_ROW');
      expect(codes).toContain('SERIAL_REQUIRED_NONE_SELECTABLE');
    });

    test('is exposed as a method and static on HuStockTransferAdapter', async () => {
      expect(typeof HuStockTransferAdapter.precheckPathA).toBe('function');
      const adapter = new HuStockTransferAdapter({ rfcClient: {} });
      expect(typeof adapter.precheckPathA).toBe('function');
      const res = await adapter.precheckPathA(baseReservation, '1', baseHu, validContext);
      expect(res.valid).toBe(true);
    });
  });
});
