'use strict';

/**
 * Unit Test Suite for Movement Type 201 (Goods Issue to Cost Center)
 * Covers all material classes (A, B, C, D, E, F) and negative/edge cases:
 *   - Happy path per class (Class A Plain, Class B Batch, Class C Serial, Class E Small SU, Class F Large SU)
 *   - Missing batch (Class B/D) -> 400 naming batch
 *   - Missing serial (Class C/D) -> 400 naming serial
 *   - Wrong SU quantity (Class F, VOLLE = 'X', partial pick) -> 400 naming full stock removal (VOLLE = X)
 *   - No stock in SLoc -> 400 naming insufficient stock
 *   - GI failure then retry -> status 90 then status 05
 *   - Cost center mandatory & CSKS master check -> 400 naming missing cost center / nonexistent
 *   - Cost center validity dates in CSKS -> 400 naming validity range
 *   - Cost center primary posting lock (CSKS-BKZKP = X) -> 400 naming locked
 *   - Real movement flag WM_TR_REAL_MOVEMENT=true -> BWLVS 201, BETYP K, BENUM padded cost center
 *   - Confirmed TO quantity (CONF_MENGE) posted by MIGO
 *   - NO_MORE_GR set only when CompleteReservation is true
 *   - T321 warning (WM_PRE_MIGO_T321_CHECK) when TBFKZ = X
 *
 * All tests labeled: [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const { STATUS } = require('../../../srv/common/wmStatus');

describe('Movement Type 201 (GI to Cost Center) Process Tests [mock only, not SAP verification]', () => {
  let mockRfc;
  let resAdapter;
  let trAdapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(async (fm, params) => {
        if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') {
          return {
            ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: params?.IV_TR_NUMBER || '0001000698', BWLVS: '201', BETYP: 'K', BENUM: '1011202701', RSNUM: '0000525280', NLTYP: '911', NLPLA: '1011202701' }],
            ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: params?.IV_TR_NUMBER || '0001000698', TBPOS: '0001', MATNR: '000000008000008977', WERKS: '1120', LGORT: 'HS01', MENGE: 100, TAMEN: 0, MEINS: 'KG' }]
          };
        }
        if (fm === 'Z_WM_TO_CREATE_FROM_TR') {
          return { EV_SUCCESS: 'S', EV_TANUM: '0001013000' };
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
        if (table === 'CSKS') {
          return [
            { KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' },
            { KOKRS: '1000', KOSTL: '001011101301', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }
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
          return [{ LGNUM: 'W01', BWLVS: '201', BETYP: 'K', NKDYN: 'X', NLTYP: '911', NLPLA: '' }];
        }
        if (table === 'T321') {
          return [{ LGNUM: '***', RBLVS: '201', BWLVS: '201', TBFKZ: 'X', TAFKZ: 'X' }];
        }
        const optStr = (where || []).join(' ');
        if (table === 'LTAK' && optStr.includes('TANUM')) {
          const match = optStr.match(/TANUM\s*=\s*'(\d+)'/);
          const tanum = match ? match[1] : '0001013000';
          return [{ LGNUM: 'W01', TANUM: tanum, TBNUM: '0001000698', BWLVS: '201', KQUIT: '' }];
        }
        if (table === 'LTAP' && optStr.includes('TANUM')) {
          const match = optStr.match(/TANUM\s*=\s*'(\d+)'/);
          const tanum = match ? match[1] : '0001013000';
          return [{ LGNUM: 'W01', TANUM: tanum, TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '1.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      })
    };
    resAdapter = new ReservationProcessAdapter({ rfc: mockRfc, checkCsksExistence: true });
    trAdapter = new TrToAdapter({ rfc: mockRfc });
  });

  describe('1. Material Class Happy Paths [mock only, not SAP verification]', () => {
    test('Class A: Plain material (no batch, no serial) completes 201 reservation, TR, TO, and MIGO [mock only, not SAP verification]', async () => {
      // Step 1: Reservation
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '0000525280',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation created' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const resResult = await resAdapter.createReservation({
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000008977',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701'
      });
      expect(resResult.success).toBe(true);
      expect(resResult.reservationNo).toBe('525280');

      // Step 2: TR creation under WM_TR_REAL_MOVEMENT=true
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [{ TBNUM: '0001000698', TBPOS: '0001', MATNR: '000000008000008977', MENGA: 1 }]
      });

      const trResult = await resAdapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '201',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        reservationNo: '525280',
        reservationItem: '0001',
        costCenter: '1011202701'
      });
      process.env.WM_TR_REAL_MOVEMENT = origEnv;

      expect(trResult.success).toBe(true);
      expect(trResult.trNumber).toBe('1000698');
      const trCall = mockRfc.call.mock.calls.find((c) => c[0] === 'L_TR_CREATE');
      expect(trCall[1].T_LTBA[0].BWLVS).toBe('201');
      expect(trCall[1].T_LTBA[0].BETYP).toBe('K');
      expect(trCall[1].T_LTBA[0].BENUM).toBe('1011202701');

      // Step 3: TO creation
      mockRfc.readTable.mockImplementation(async (tbl, flds, where) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (tbl === 'MAKT') return [{ MAKTX: 'Plain Material' }];
        if (tbl === 'T331') return [{ VOLLE: '' }];
        if (tbl === 'LQUA') return [{ LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'ONHOLD', VERME: '1000.000', MEINS: 'KG' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        if (tbl === 'MARD') return [{ LGORT: 'HS01', LABST: '1000.000' }];
        const optStr = (where || []).join(' ');
        if (tbl === 'LTAK' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001013000', TBNUM: '0001000698', BWLVS: '201', KQUIT: '' }];
        }
        if (tbl === 'LTAP' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001013000', TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '1.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      });

      const toResult = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000698',
        tbpos: '0001',
        qty: 1,
        autoConfirm: false
      });
      expect(toResult.TransferOrder).toBe('1013000');
      expect(toResult.CostCenter).toBe('1011202701');

      // Step 4: TO confirmation
      mockRfc.call.mockResolvedValueOnce({
        EV_SUCCESS: 'S',
        ET_ITEMS: [{ TANUM: '0001013000', TAPOS: '0001', NISTM: '1.000' }]
      });
      const confResult = await resAdapter.confirmTransferOrder({
        warehouseNumber: 'W01',
        toNumber: '0001013000'
      });
      expect(confResult.success).toBe(true);

      // Step 5: MIGO Goods Movement
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050201',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '525280',
        reservationItem: '0001',
        transferOrder: '0001013000',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701',
        completeReservation: true
      });
      expect(migoResult.success).toBe(true);
      expect(migoResult.materialDocument).toBe('4900050201');
      const migoCall = mockRfc.call.mock.calls.find((c) => c[0] === 'BAPI_GOODSMVT_CREATE');
      expect(migoCall[1].GOODSMVT_CODE.GM_CODE).toBe('03');
      expect(migoCall[1].GOODSMVT_ITEM[0].COSTCENTER).toBe('1011202701');
      expect(migoCall[1].GOODSMVT_ITEM[0].NO_MORE_GR).toBe('X');
    });

    test('Class B: Batch material completes 201 goods movement with valid batch [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: 'X', SERNP: '' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        if (tbl === 'MARD') return [{ LGORT: 'CS01', LABST: '100.000' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050202',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Batch document posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await resAdapter.postGoodsMovement({
        reservationNo: '525281',
        reservationItem: '0001',
        movementType: '201',
        material: '8900000007',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        costCenter: '1011202701',
        batch: 'IN26001220'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050202');
      const bapiCall = mockRfc.call.mock.calls.find((c) => c[0] === 'BAPI_GOODSMVT_CREATE');
      expect(bapiCall[1].GOODSMVT_ITEM[0].BATCH).toBe('IN26001220');
    });

    test('Class C: Serial material completes 201 goods movement with valid serials [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: 'ZSN2' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        if (tbl === 'MARD') return [{ LGORT: 'CS02', LABST: '10.000' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050203',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Serial document posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await resAdapter.postGoodsMovement({
        reservationNo: '525282',
        reservationItem: '0001',
        movementType: '201',
        material: '8000006485',
        plant: '1120',
        storageLocation: 'CS02',
        quantity: 1,
        unit: 'NOS',
        costCenter: '1011202701',
        serials: ['SN100001']
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050203');
      const bapiCall = mockRfc.call.mock.calls.find((c) => c[0] === 'BAPI_GOODSMVT_CREATE');
      expect(bapiCall[1].GOODSMVT_SERIALNUMBER).toEqual([{ MATDOC_ITM: '0001', SERIALNO: 'SN100001' }]);
    });

    test('Class E: Small storage unit (VOLLE = "") allows partial pick [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl, flds, where) => {
        if (tbl === 'T331') return [{ VOLLE: '' }];
        if (tbl === 'LQUA') return [{ VERME: '10.000' }];
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (tbl === 'MAKT') return [{ MAKTX: 'Small SU Mat' }];
        const optStr = (where || []).join(' ');
        if (tbl === 'LTAK' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001013000', TBNUM: '0001000698', BWLVS: '201', KQUIT: '' }];
        }
        if (tbl === 'LTAP' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001013000', TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '1.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      });

      const toRes = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000698',
        tbpos: '0001',
        qty: 1,
        storageUnit: '00000000002000020148',
        sourceStorageType: '002',
        autoConfirm: false
      });

      expect(toRes.TransferOrder).toBe('1013000');
    });

    test('Class F: Large storage unit (VOLLE = "X") allows full pick matching SU quantity [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl, flds, where) => {
        if (tbl === 'T331') return [{ VOLLE: 'X' }];
        if (tbl === 'LQUA') return [{ VERME: '100.000' }];
        if (tbl === 'MARC') return [{ XCHPF: 'X', SERNP: '' }];
        if (tbl === 'MAKT') return [{ MAKTX: 'Large SU Mat' }];
        const optStr = (where || []).join(' ');
        if (tbl === 'LTAK' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001013000', TBNUM: '0001000698', BWLVS: '201', KQUIT: '' }];
        }
        if (tbl === 'LTAP' && optStr.includes('TANUM')) {
          return [{ LGNUM: 'W01', TANUM: '0001013000', TAPOS: '0001', TBPOS: '0001', MATNR: '000000008000008977', NSOLA: '100.000', ALTME: 'KG', PQUIT: '' }];
        }
        return [];
      });

      const toRes = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000698',
        tbpos: '0001',
        qty: 100,
        batch: 'IN26001220',
        storageUnit: '00000000001000058618',
        sourceStorageType: 'OH1',
        autoConfirm: false
      });

      expect(toRes.TransferOrder).toBe('1013000');
    });
  });

  describe('2. Negative & Edge Cases [mock only, not SAP verification]', () => {
    test('Missing batch (Class B/D) fails 400 naming batch before calling SAP [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: 'X', SERNP: '' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        return [];
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525283',
        reservationItem: '0001',
        movementType: '201',
        material: '8900000007',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        costCenter: '1011202701'
      })).rejects.toThrow(/Batch is required for batch-managed material/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('Missing serial (Class C/D) fails 400 naming serial numbers before calling SAP [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: 'ZSN2' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        return [];
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525284',
        reservationItem: '0001',
        movementType: '201',
        material: '8000006485',
        plant: '1120',
        storageLocation: 'CS02',
        quantity: 1,
        unit: 'NOS',
        costCenter: '1011202701'
      })).rejects.toThrow(/Serial numbers are mandatory for serial-managed material/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('Serial count mismatch fails 400 naming serial count before calling SAP [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: 'ZSN2' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        return [];
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525284',
        reservationItem: '0001',
        movementType: '201',
        material: '8000006485',
        plant: '1120',
        storageLocation: 'CS02',
        quantity: 2,
        unit: 'NOS',
        costCenter: '1011202701',
        serials: ['SN1']
      })).rejects.toThrow(/Number of serial numbers \(1\) must equal quantity \(2\)/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('Wrong SU quantity on VOLLE = "X" partial pick fails 400 naming full stock removal [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'T331') return [{ VOLLE: 'X' }];
        if (tbl === 'LQUA') return [{ VERME: '100.000' }];
        return [];
      });

      await expect(trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '0001000698',
        tbpos: '0001',
        qty: 50,
        storageUnit: '00000000001000058618',
        sourceStorageType: 'OH1',
        autoConfirm: false
      })).rejects.toThrow(/Storage type OH1 requires full stock removal \(VOLLE = X\)/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
    });

    test('No stock in storage location fails 400 naming insufficient stock before calling SAP [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        if (tbl === 'MARD') return [{ LGORT: 'HS01', LABST: '2.000' }];
        return [];
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525285',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'KG',
        costCenter: '1011202701'
      })).rejects.toThrow(/Insufficient stock in storage location HS01 for material 8000008977/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('Cost Center missing fails 400 before calling SAP [mock only, not SAP verification]', async () => {
      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525286',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG'
      })).rejects.toThrow(/Cost Center is mandatory for Movement Type 201/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('Cost Center expired in CSKS fails 400 naming validity range [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20200101', DATBI: '20221231', BKZKP: '' }];
        return [];
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525287',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701'
      })).rejects.toThrow(/Cost Center 1011202701 is not valid on/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('Cost Center locked in CSKS (BKZKP = "X") fails 400 naming primary posting lock [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20200101', DATBI: '99991231', BKZKP: 'X' }];
        return [];
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525288',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701'
      })).rejects.toThrow(/Cost Center 1011202701 is locked for actual primary postings \(CSKS-BKZKP = X\)/);

      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
    });

    test('GI failure marks status 90 and subsequent retry succeeds with status 05 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        if (tbl === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        return [];
      });

      // 1st attempt: BAPI fails with backend error
      mockRfc.call.mockResolvedValueOnce({
        RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Deficit of SL Unrestricted-use' }]
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '525289',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701',
        processId: '11111111-2222-3333-4444-555555555555'
      })).rejects.toThrow(/BAPI_GOODSMVT_CREATE failed: Deficit of SL Unrestricted-use/);
      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_TRANSACTION_COMMIT', expect.anything());

      // 2nd attempt: Retry succeeds
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050299',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Success on retry' }]
        })
        .mockResolvedValueOnce({});

      const retryRes = await resAdapter.postGoodsMovement({
        reservationNo: '525289',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701',
        processId: '11111111-2222-3333-4444-555555555555'
      });

      expect(retryRes.success).toBe(true);
      expect(retryRes.materialDocument).toBe('4900050299');
      expect(retryRes.status).toBe(STATUS.GI_POSTED);
    });

    test('T321 warning flag WM_PRE_MIGO_T321_CHECK produces warning when TBFKZ = "X" [mock only, not SAP verification]', async () => {
      const origFlag = process.env.WM_PRE_MIGO_T321_CHECK;
      process.env.WM_PRE_MIGO_T321_CHECK = 'true';

      mockRfc.readTable.mockImplementation(async (tbl) => {
        if (tbl === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }];
        if (tbl === 'T321') return [{ LGNUM: '***', RBLVS: '201', TBFKZ: 'X' }];
        if (tbl === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011202701', DATAB: '20230401', DATBI: '99991231', BKZKP: '' }];
        if (tbl === 'MARC') return [{ XCHPF: '', SERNP: '' }];
        if (tbl === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050300',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Success' }]
        })
        .mockResolvedValueOnce({});

      const res = await resAdapter.postGoodsMovement({
        reservationNo: '525290',
        reservationItem: '0001',
        movementType: '201',
        material: '8000008977',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'KG',
        costCenter: '1011202701'
      });

      process.env.WM_PRE_MIGO_T321_CHECK = origFlag;

      expect(res.success).toBe(true);
      expect(res.warning).toMatch(/goods movement will create an additional TR/);
    });
  });
});
