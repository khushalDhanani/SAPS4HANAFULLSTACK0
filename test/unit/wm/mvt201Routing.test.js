'use strict';

/**
 * Item 16 — Verification of Movement Type 201 WM Routing
 *
 * Pins the application's movement configuration (values copied from T333, see docs/archive/WORKSTATUS-archive-2026-10-22.md:619) for:
 *   - 201 → Real WM Movement (BWLVS 201, BETYP K, NLTYP 911, dynamic bin BENUM = Cost Center)
 *   - 201 → Staging/311 Fallback (BWLVS 311, BETYP '', NLTYP 921, fixed bin TRANSFER)
 *
 * Verifies exact agreement with application's WM_REAL_MOVEMENT and WM_TR_REAL_MOVEMENT behavior.
 * [mock only, not SAP verification]
 */

const { getMovementConfig, resolveWmMovement } = require('../../../srv/common/movementConfig');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

describe('Item 16: Movement Type 201 WM Routing Verification [mock only, not SAP verification]', () => {
  const origRealMvt = process.env.WM_REAL_MOVEMENT;
  const origTrRealMvt = process.env.WM_TR_REAL_MOVEMENT;

  afterEach(() => {
    if (origRealMvt !== undefined) process.env.WM_REAL_MOVEMENT = origRealMvt;
    else delete process.env.WM_REAL_MOVEMENT;

    if (origTrRealMvt !== undefined) process.env.WM_TR_REAL_MOVEMENT = origTrRealMvt;
    else delete process.env.WM_TR_REAL_MOVEMENT;
  });

  describe('1. Movement configuration constants (nothing here reads SAP)', () => {
    test('config pin: movement 201 uses WM movement 201, requirement type K and interim type 911', () => {
      const cfg = getMovementConfig('201');
      expect(cfg.movementType).toBe('201');
      expect(cfg.configuredWmMovement).toBe('201');
      expect(cfg.requirementType).toBe('K');
      expect(cfg.interimStorageType).toBe('911');
      expect(cfg.requiresCostCenter).toBe(true);
      expect(cfg.preserveReservationOnTr).toBe(true);
    });

    test('config pin: movement 311 uses WM movement 311, no requirement type and interim bin 921/TRANSFER', () => {
      const cfg311 = getMovementConfig('311');
      expect(cfg311.configuredWmMovement).toBe('311');
      expect(cfg311.requirementType).toBe('');
      expect(cfg311.interimStorageType).toBe('921');
      expect(cfg311.interimStorageBin).toBe('TRANSFER');
    });
  });

  describe('2. Application Routing Resolution (WM_REAL_MOVEMENT / WM_TR_REAL_MOVEMENT)', () => {
    test('D21: default (flags unset) resolves to the real WM movement 201 from config', () => {
      delete process.env.WM_REAL_MOVEMENT;
      delete process.env.WM_TR_REAL_MOVEMENT;

      expect(resolveWmMovement('201')).toBe('201');
      const cfg = getMovementConfig('201');
      expect(cfg.useRealWmMovement).toBe(true);
      expect(cfg.wmMovement).toBe('201');
      expect(cfg.wmMovement).toBe('201');
    });

    test('env flags no longer change the routing (true or false): still 201', () => {
      process.env.WM_REAL_MOVEMENT = 'true';
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      expect(resolveWmMovement('201')).toBe('201');
      process.env.WM_REAL_MOVEMENT = 'false';
      process.env.WM_TR_REAL_MOVEMENT = 'false';
      expect(resolveWmMovement('201')).toBe('201');
      delete process.env.WM_REAL_MOVEMENT;
      delete process.env.WM_TR_REAL_MOVEMENT;
    });
  });

  describe('3. Transfer Requirement (TR) Generation Under Real WM Movement (201)', () => {
    let mockRfc;
    let adapter;

    beforeEach(() => {
      mockRfc = {
        session: jest.fn(async (fn) => fn(mockRfc.call)),
        call: jest.fn(),
        readTable: jest.fn()
      };
      adapter = new ReservationProcessAdapter({ rfc: mockRfc });
    });

    test('Real WM 201 pads short numeric Cost Center to 10 digits', async () => {
      process.env.WM_REAL_MOVEMENT = 'true';

      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [{ TBNUM: '0001000835', TBPOS: '0001', MATNR: '000000001000000928', MENGA: 1 }]
      });

      await adapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '201',
        movementType: '201',
        material: '1000000928',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 1,
        unit: 'KG',
        reservationNo: '525280',
        reservationItem: '0001',
        costCenter: '1011201' // 7 digits
      });

      const trCall = mockRfc.call.mock.calls.find((c) => c[0] === 'L_TR_CREATE');
      expect(trCall[1].T_LTBA[0].BENUM).toBe('0001011201');
    });

    test('Real WM 201 fails closed with 400 when Cost Center is missing (precludes SAP L2 438 dump)', async () => {
      process.env.WM_REAL_MOVEMENT = 'true';

      await expect(
        adapter.createTransferRequirement({
          warehouseNumber: 'W01',
          wmMovementType: '201',
          movementType: '201',
          material: '1000000928',
          plant: '1120',
          storageLocation: 'CS01',
          quantity: 1,
          unit: 'KG',
          reservationNo: '525280',
          reservationItem: '0001'
          // costCenter omitted
        })
      ).rejects.toThrow(/Movement 201 requires Cost Center \(BENUM\) for dynamic coordinates/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('L_TR_CREATE', expect.anything());
    });
  });

  describe('4. Transfer Requirement (TR) Generation for 201 with flags unset (D21: no staging fallback)', () => {
    let mockRfc;
    let adapter;

    beforeEach(() => {
      mockRfc = {
        session: jest.fn(async (fn) => fn(mockRfc.call)),
        call: jest.fn(),
        readTable: jest.fn()
      };
      adapter = new ReservationProcessAdapter({ rfc: mockRfc });
    });

    test('Flags unset: passes BWLVS 201, BETYP K, 10-char cost centre BENUM, preserves RSNUM (never 311)', async () => {
      delete process.env.WM_REAL_MOVEMENT;
      delete process.env.WM_TR_REAL_MOVEMENT;

      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [{ TBNUM: '0001000836', TBPOS: '0001', MATNR: '000000001000000928', MENGA: 1 }]
      });

      const res = await adapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '201',
        movementType: '201',
        material: '1000000928',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 1,
        unit: 'KG',
        reservationNo: '525280',
        reservationItem: '0001',
        costCenter: '1011201301'
      });

      expect(res.success).toBe(true);
      expect(res.trNumber).toBe('1000836');

      const trCall = mockRfc.call.mock.calls.find((c) => c[0] === 'L_TR_CREATE');
      expect(trCall).toBeDefined();
      const ltbaItem = trCall[1].T_LTBA[0];
      expect(ltbaItem.BWLVS).toBe('201');
      expect(ltbaItem.BETYP).toBe('K');
      expect(ltbaItem.BENUM).toBe('1011201301');
      expect(ltbaItem.RSNUM).toBe('0000525280');
    });
  });
});
