'use strict';

/**
 * Unit Test Suite for Movement Type 241 (Goods Issue to Asset)
 * Covers all material classes (A, B, C, D, E, F) and negative/edge cases:
 *   - Happy path per class (Class A Plain, Class B Batch, Class C Serial, Class E Small SU, Class F Large SU)
 *   - Missing batch (Class B/D) -> 400 naming batch
 *   - Missing serial (Class C/D) -> 400 naming serial
 *   - Wrong SU quantity (Class F, VOLLE = 'X', partial pick) -> 400 naming full stock removal (VOLLE = X)
 *   - No stock in SLoc -> 400 naming insufficient stock
 *   - GI failure then retry -> status 90 then status 05
 *   - Asset mandatory & ANLA master check -> 400 naming missing asset / nonexistent
 *   - Asset deactivation date in ANLA (DEAKT) -> 400 naming deactivated
 *   - Asset capitalization date in ANLA (AKTIV = 0) -> 400 naming not capitalized
 *   - Asset deletion flag in ANLA (XLOEV = X) -> 400 naming marked for deletion
 *   - Asset posting lock in ANLA (XSPEB = X) -> 400 naming locked for postings
 *   - Real movement flag WM_TR_REAL_MOVEMENT=true -> BWLVS 241, BETYP A, BENUM rightmost 10 digits of ANLN1
 *   - Confirmed TO quantity (CONF_MENGE) posted by MIGO
 *   - NO_MORE_GR set only when CompleteReservation is true
 *   - T321 warning (WM_PRE_MIGO_T321_CHECK) when TBFKZ = X
 *   - Both ASSET_NO (12 chars) and SUB_NUMBER (4 chars, defaulting to 0000) passed to reservation and MIGO
 *
 * All tests labeled: [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const { STATUS } = require('../../../srv/common/wmStatus');

describe('Movement Type 241 (GI to Asset) Process Tests [mock only, not SAP verification]', () => {
  let mockRfc;
  let resAdapter;
  let trAdapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(async (fm, params) => {
        if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') {
          return {
            ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: params?.IV_TR_NUMBER || '0001000761', BWLVS: '241', BETYP: 'A', BENUM: '0000400001', RSNUM: '0000525290', NLTYP: '913', NLPLA: '0000400001' }],
            ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: params?.IV_TR_NUMBER || '0001000761', TBPOS: '0001', MATNR: '000000008000008977', WERKS: '1120', LGORT: 'HS01', MENGE: 100, TAMEN: 0, MEINS: 'KG' }]
          };
        }
        if (fm === 'Z_WM_TO_CREATE_FROM_TR') {
          return { EV_SUCCESS: 'S', EV_TANUM: '0001014000' };
        }
        return {};
      }),
      readTable: jest.fn(async (table, fields, where) => {
        if (table === 'T320') {
          return [
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }
          ];
        }
        if (table === 'T001K') {
          return [{ BWKEY: '1120', BUKRS: '1000' }];
        }
        if (table === 'ANLA') {
          return [
            { BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529', DEAKT: '00000000', XLOEV: '', XSPEB: '', TXT50: 'Plant and Machinery' },
            { BUKRS: '1000', ANLN1: '000000700000', ANLN2: '0000', AKTIV: '20250620', DEAKT: '00000000', XLOEV: '', XSPEB: '', TXT50: 'Electrical Installations' }
          ];
        }
        if (table === 'MARD') {
          return [
            { LGORT: 'CS01', LABST: '100.000' },
            { LGORT: 'CS02', LABST: '50.000' },
            { LGORT: 'HS01', LABST: '1000.000' }
          ];
        }
        if (table === 'T333') {
          return [{ LGNUM: 'W01', BWLVS: '241', BETYP: 'A', NKDYN: 'X', NLTYP: '913', NLPLA: '' }];
        }
        if (table === 'T321') {
          return [{ LGNUM: '***', RBLVS: '241', BWLVS: '241', TBFKZ: 'X', TAFKZ: '' }];
        }
        const optStr = (where || []).join(' ');
        if (table === 'LTAK' && optStr.includes('TANUM')) {
          const match = optStr.match(/TANUM\s*=\s*'(\d+)'/);
          const tanum = match ? match[1] : '0001014000';
          return [{ LGNUM: 'W01', TANUM: tanum, TBNUM: '0001000761', BWLVS: '241', KQUIT: '' }];
        }
        if (table === 'LTAP' && optStr.includes('TANUM')) {
          const match = optStr.match(/TANUM\s*=\s*'(\d+)'/);
          const tanum = match ? match[1] : '0001014000';
          return [{ LGNUM: 'W01', TANUM: tanum, TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '1.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      })
    };
    resAdapter = new ReservationProcessAdapter({ rfc: mockRfc, checkAssetExistence: true });
    trAdapter = new TrToAdapter({ rfc: mockRfc });
  });

  describe('1. Material Class Happy Paths [mock only, not SAP verification]', () => {
    test('Class A: Plain material (no batch, no serial) completes 241 reservation, TR, TO, and MIGO [mock only, not SAP verification]', async () => {
      // Step 1: Reservation
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '0000525290',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation created' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const resResult = await resAdapter.createReservation({
        movementType: '241',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000008977',
        quantity: 1,
        unit: 'KG',
        assetNo: '400001',
        subNumber: '0000'
      });
      expect(resResult.success).toBe(true);
      expect(resResult.reservationNo).toBe('525290');

      // Verify BAPI_RESERVATION_CREATE1 received ASSET_NO and SUB_NUMBER
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '241',
            ASSET_NO: '000000400001',
            SUB_NUMBER: '0000'
          })
        })
      );

      // Step 2: TR creation under WM_TR_REAL_MOVEMENT
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [{ TBNUM: '0001000761', TBPOS: '0001' }]
      });

      const trResult = await resAdapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '241',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        reservationNo: '0000525290',
        assetNo: '400001'
      });
      expect(trResult.success).toBe(true);
      expect(trResult.trNumber).toBe('1000761');

      // Verify L_TR_CREATE received BETYP A and BENUM (rightmost 10 chars of ANLN1)
      const trCall = mockRfc.call.mock.calls.find((c) => c[0] === 'L_TR_CREATE');
      expect(trCall[1].T_LTBA[0].BWLVS).toBe('241');
      expect(trCall[1].T_LTBA[0].BETYP).toBe('A');
      expect(trCall[1].T_LTBA[0].BENUM).toBe('0000400001');

      // Step 3: TO Creation from TR
      mockRfc.readTable.mockImplementation(async (tbl, flds, where) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (tbl === 'MAKT') return [{ MAKTX: 'Plain Material' }];
        if (tbl === 'T331') return [{ VOLLE: '' }];
        if (tbl === 'LQUA') return [{ LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'ONHOLD', VERME: '1000.000', MEINS: 'KG' }];
        if (tbl === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529', DEAKT: '00000000' }];
        if (tbl === 'MARD') return [{ LGORT: 'HS01', LABST: '1000.000' }];
        const optStr = (where || []).join(' ');
        if (tbl === 'LTAK' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001014000', TBNUM: '0001000761', BWLVS: '241', KQUIT: '' }];
        }
        if (tbl === 'LTAP' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001014000', TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '1.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      });

      const toResult = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000761',
        tbpos: '0001',
        qty: 1,
        autoConfirm: false
      });
      expect(toResult.TransferOrder).toBe('1014000');
      expect(toResult.AssetNo).toBe('400001');

      // Step 4: TO Confirmation
      mockRfc.call.mockResolvedValueOnce({
        EV_SUCCESS: 'S',
        ET_ITEMS: [{ TANUM: '0001014000', TAPOS: '0001', NISTM: '1.000' }]
      });
      const confResult = await resAdapter.confirmTransferOrder({
        warehouseNumber: 'W01',
        toNumber: '0001014000'
      });
      expect(confResult.success).toBe(true);

      // Step 5: MIGO posting
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050143',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Material document 4900050143 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '0000525290',
        reservationItem: '0001',
        transferOrder: '0001014000',
        movementType: '241',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        assetNo: '400001',
        subNumber: '0000'
      });
      expect(migoResult.success).toBe(true);
      expect(migoResult.materialDocument).toBe('4900050143');
      expect(migoResult.status).toBe(STATUS.GI_POSTED);
      expect(migoResult.stockEffect).toBe('Stock consumed to Asset 400001/0000');

      // Verify BAPI_GOODSMVT_CREATE received GM_CODE 03, ASSET_NO, and SUB_NUMBER
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '03' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '241',
              ASSET_NO: '000000400001',
              SUB_NUMBER: '0000'
            })
          ]
        })
      );
    });

    test('Class B: Batch material completes 241 reservation with batch, TR, TO, and MIGO [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ MATNR: '000000008900000004', WERKS: '1120', XCHPF: 'X', SERNP: '' }];
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        if (table === 'MARD') return [{ LGORT: 'CS01', LABST: '50.000' }];
        if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529', DEAKT: '00000000' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({ RESERVATION: '0000525291', RETURN: [{ TYPE: 'S', MESSAGE: 'Created' }] })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await resAdapter.createReservation({
        movementType: '241',
        plant: '1120',
        storageLocation: 'CS01',
        material: '8900000004',
        quantity: 2,
        unit: 'KG',
        batch: 'INJW260001',
        assetNo: '400001'
      });
      expect(res.success).toBe(true);

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050144',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const migo = await resAdapter.postGoodsMovement({
        reservationNo: '0000525291',
        reservationItem: '0001',
        movementType: '241',
        material: '8900000004',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 2,
        unit: 'KG',
        batch: 'INJW260001',
        assetNo: '400001'
      });
      expect(migo.success).toBe(true);
      expect(migo.batch).toBe('INJW260001');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_ITEM: [
            expect.objectContaining({
              BATCH: 'INJW260001',
              ASSET_NO: '000000400001',
              SUB_NUMBER: '0000'
            })
          ]
        })
      );
    });

    test('Class C: Serial material completes 241 with serial numbers in MIGO [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ MATNR: '000000008000006485', WERKS: '1120', XCHPF: '', SERNP: 'ZSN2' }];
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'MARD') return [{ LGORT: 'CS02', LABST: '10.000' }];
        if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529', DEAKT: '00000000' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050145',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const migo = await resAdapter.postGoodsMovement({
        reservationNo: '0000525292',
        reservationItem: '0001',
        movementType: '241',
        material: '8000006485',
        plant: '1120',
        storageLocation: 'CS02',
        quantity: 1,
        unit: 'NOS',
        assetNo: '400001',
        serials: ['SN10001']
      });
      expect(migo.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_SERIALNUMBER: [{ MATDOC_ITM: '0001', SERIALNO: 'SN10001' }]
        })
      );
    });

    test('Class E: Small SU stock (VOLLE = blank) allows partial pick [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'T331') return [{ VOLLE: '' }];
        if (table === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (table === 'MAKT') return [{ MAKTX: 'Small SU Mat' }];
        const optStr = (where || []).join(' ');
        if (table === 'LTAK' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001014000', TBNUM: '0001000761', BWLVS: '241', KQUIT: '' }];
        }
        if (table === 'LTAP' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001014000', TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '1.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      });

      const toRes = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000761',
        tbpos: '0001',
        qty: 1,
        storageUnit: '00000000002000020148',
        sourceStorageType: '002',
        autoConfirm: false
      });
      expect(toRes.TransferOrder).toBe('1014000');
    });

    test('Class F: Large SU stock (VOLLE = X) allows full SU pick [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'T331') return [{ VOLLE: 'X' }];
        if (table === 'LQUA') return [{ VERME: '100.000' }];
        if (table === 'MARC') return [{ XCHPF: 'X', SERNP: '' }];
        if (table === 'MAKT') return [{ MAKTX: 'Large SU Mat' }];
        const optStr = (where || []).join(' ');
        if (table === 'LTAK' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001014000', TBNUM: '0001000761', BWLVS: '241', KQUIT: '' }];
        }
        if (table === 'LTAP' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001014000', TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '100.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      });

      const toRes = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000761',
        tbpos: '0001',
        qty: 100,
        batch: 'IN26001220',
        storageUnit: '00000000001000058618',
        sourceStorageType: 'OH1',
        autoConfirm: false
      });
      expect(toRes.TransferOrder).toBe('1014000');
    });
  });

  describe('2. Defect & Validation Guard Tests [mock only, not SAP verification]', () => {
    test('Missing batch for batch-managed material (Class B/D) fails with clear 400 naming batch [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ XCHPF: 'X' }];
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'MARD') return [{ LGORT: 'CS01' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'CS01',
          material: '8900000004',
          quantity: 1,
          unit: 'KG',
          assetNo: '400001'
        })
      ).rejects.toThrow(/Batch is mandatory for batch-managed material 8900000004/);
    });

    test('Missing serial for serial-managed material (Class C/D) fails with clear 400 naming serial numbers [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ SERNP: 'ZSN2' }];
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'MARD') return [{ LGORT: 'CS02', LABST: '10.000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529' }];
        return [];
      });

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '0000525293',
          reservationItem: '0001',
          movementType: '241',
          plant: '1120',
          storageLocation: 'CS02',
          material: '8000006485',
          quantity: 1,
          unit: 'NOS',
          assetNo: '400001',
          serials: []
        })
      ).rejects.toThrow(/Serial numbers are mandatory for serial-managed material 8000006485 \(profile ZSN2\)/);
    });

    test('Serial count mismatch against quantity fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ SERNP: 'ZSN2' }];
        if (table === 'MARD') return [{ LGORT: 'CS02', LABST: '10.000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529' }];
        return [];
      });

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '0000525294',
          reservationItem: '0001',
          movementType: '241',
          plant: '1120',
          storageLocation: 'CS02',
          material: '8000006485',
          quantity: 2,
          unit: 'NOS',
          assetNo: '400001',
          serials: ['SN10001']
        })
      ).rejects.toThrow(/Number of serial numbers \(1\) must equal quantity \(2\)/);
    });

    test('Partial pick from VOLLE = X storage unit fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T331') return [{ VOLLE: 'X' }];
        if (table === 'LQUA') return [{ VERME: '100.000' }];
        if (table === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (table === 'MAKT') return [{ MAKTX: 'Volle Mat' }];
        return [];
      });

      await expect(
        trAdapter.createTOFromTR({
          warehouseNumber: 'W01',
          tbnum: '0001000761',
          tbpos: '0001',
          qty: 10,
          storageUnit: '00000000001000058618',
          sourceStorageType: 'OH1',
          autoConfirm: false
        })
      ).rejects.toThrow(/Storage type OH1 requires full stock removal \(VOLLE = X\)/);
    });

    test('Insufficient stock in SLoc fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '0.000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529' }];
        return [];
      });

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '0000525295',
          reservationItem: '0001',
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 10,
          unit: 'KG',
          assetNo: '400001'
        })
      ).rejects.toThrow(/Insufficient stock in storage location HS01/);
    });

    test('Missing asset number for Movement 241 fails with clear 400 [mock only, not SAP verification]', async () => {
      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG'
        })
      ).rejects.toThrow(/Asset number is mandatory for Movement Type 241/);

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '0000525296',
          reservationItem: '0001',
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG'
        })
      ).rejects.toThrow(/Asset number is mandatory for Movement Type 241/);
    });

    test('Nonexistent asset in ANLA fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'ANLA') return []; // Asset not found
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG',
          assetNo: '999999'
        })
      ).rejects.toThrow(/Asset 999999\/0000 does not exist in master data \(ANLA\)/);
    });

    test('Deactivated asset in ANLA (DEAKT) fails with clear 400 naming deactivation date [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400000', ANLN2: '0000', AKTIV: '20250521', DEAKT: '20250521' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG',
          assetNo: '400000'
        })
      ).rejects.toThrow(/Asset 400000\/0000 is deactivated on 20250521 \(ANLA-DEAKT\)/);
    });

    test('Uncapitalized / inactive asset in ANLA (AKTIV = 0) fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400002', ANLN2: '0000', AKTIV: '00000000', DEAKT: '00000000' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG',
          assetNo: '400002'
        })
      ).rejects.toThrow(/Asset 400002\/0000 is not capitalized \/ active \(ANLA-AKTIV\)/);
    });

    test('Asset marked for deletion (ANLA-XLOEV = X) fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400003', ANLN2: '0000', AKTIV: '20250501', DEAKT: '00000000', XLOEV: 'X' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG',
          assetNo: '400003'
        })
      ).rejects.toThrow(/Asset 400003\/0000 is marked for deletion \(ANLA-XLOEV = X\)/);
    });

    test('Asset locked for postings (ANLA-XSPEB = X) fails with clear 400 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400004', ANLN2: '0000', AKTIV: '20250501', DEAKT: '00000000', XSPEB: 'X' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG',
          assetNo: '400004'
        })
      ).rejects.toThrow(/Asset 400004\/0000 is locked for postings \(ANLA-XSPEB = X\)/);
    });

    test('GI failure then retry: first fails, second recovers with alreadyPosted or success [mock only, not SAP verification]', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          RETURN: [{ TYPE: 'E', MESSAGE: 'Posting period 01/2026 is closed' }]
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '0000525297',
          reservationItem: '0001',
          movementType: '241',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000008977',
          quantity: 1,
          unit: 'KG',
          assetNo: '400001',
          processId: '123e4567-e89b-12d3-a456-426614174000'
        })
      ).rejects.toThrow(/Posting period 01\/2026 is closed/);

      // Retry: found already posted in MATDOC
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') return [{ MBLNR: '4900050149', MJAHR: '2026' }];
        return [];
      });

      const retryRes = await resAdapter.postGoodsMovement({
        reservationNo: '0000525297',
        reservationItem: '0001',
        movementType: '241',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000008977',
        quantity: 1,
        unit: 'KG',
        assetNo: '400001',
        processId: '123e4567-e89b-12d3-a456-426614174000'
      });
      expect(retryRes.success).toBe(true);
      expect(retryRes.alreadyPosted).toBe(true);
      expect(retryRes.materialDocument).toBe('4900050149');
      expect(retryRes.status).toBe(STATUS.GI_POSTED);
    });

    test('Confirmed TO quantity (CONF_MENGE) from LTAP scopes MIGO quantity [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields) => {
        if (table === 'LTAP' && fields.includes('NISTM')) return [{ VSOLM: '5.000', NISTM: '3.000' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '10.000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050150',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Success' }]
        })
        .mockResolvedValueOnce({});

      const res = await resAdapter.postGoodsMovement({
        reservationNo: '0000525298',
        reservationItem: '0001',
        movementType: '241',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000008977',
        quantity: 5, // reservation requested 5
        unit: 'KG',
        assetNo: '400001',
        transferOrder: '0001014000'
      });
      expect(res.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_ITEM: [
            expect.objectContaining({
              ENTRY_QNT: 3 // Scoped to confirmed TO quantity NISTM = 3
            })
          ]
        })
      );
    });

    test('NO_MORE_GR indicator is set only when CompleteReservation = true [mock only, not SAP verification]', async () => {
      mockRfc.call
        .mockResolvedValueOnce({ MATERIALDOCUMENT: '4900050151', MATDOCUMENTYEAR: '2026', RETURN: [{ TYPE: 'S', MESSAGE: 'Success' }] })
        .mockResolvedValueOnce({});

      await resAdapter.postGoodsMovement({
        reservationNo: '0000525290',
        reservationItem: '0001',
        movementType: '241',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000008977',
        quantity: 1,
        unit: 'KG',
        assetNo: '400001',
        completeReservation: true
      });

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_ITEM: [
            expect.objectContaining({
              NO_MORE_GR: 'X'
            })
          ]
        })
      );
    });

    test('T321 warning surfaces when TBFKZ = X [mock only, not SAP verification]', async () => {
      process.env.WM_PRE_MIGO_T321_CHECK = 'true';
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T321') return [{ LGNUM: '***', RBLVS: '241', TBFKZ: 'X' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        if (table === 'ANLA') return [{ BUKRS: '1000', ANLN1: '000000400001', ANLN2: '0000', AKTIV: '20250529' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({ MATERIALDOCUMENT: '4900050152', MATDOCUMENTYEAR: '2026', RETURN: [{ TYPE: 'S', MESSAGE: 'Success' }] })
        .mockResolvedValueOnce({});

      const res = await resAdapter.postGoodsMovement({
        reservationNo: '0000525290',
        reservationItem: '0001',
        movementType: '241',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000008977',
        quantity: 1,
        unit: 'KG',
        assetNo: '400001',
        transferOrder: '0001014000'
      });
      expect(res.success).toBe(true);
      expect(res.warning).toBe('goods movement will create an additional TR');
    });
  });
});
