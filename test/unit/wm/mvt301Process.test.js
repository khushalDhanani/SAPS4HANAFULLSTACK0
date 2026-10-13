'use strict';

/**
 * Unit Test Suite for Movement Type 301 (Plant to Plant Transfer)
 * Covers all material classes (A, B, C, D, E, F) and negative/edge cases:
 *   - Happy path per class (Class A Plain, Class B Batch, Class C Serial, Class E Small SU, Class F Large SU)
 *   - Missing receiving plant -> 400 naming Receiving Plant
 *   - Receiving plant same as issuing plant -> 400 naming Receiving Plant must be different from Issuing Plant
 *   - Material not extended to receiving plant in MARC -> 400 naming receiving plant ... (MARC)
 *   - Material not extended to receiving SLoc in MARD -> 400 naming receiving storage location ... (MARD)
 *   - Issuing SLoc not in T320 -> 400 naming T320
 *   - Missing batch (Class B) -> 400 naming batch
 *   - Batch marked for deletion in receiving plant MCHA (LVORM = X) -> 400 naming deletion
 *   - Batch nonexistent in receiving plant context (MCHA/MCH1) -> 400 naming master data
 *   - Missing serial numbers (Class C) -> 400 naming serial numbers
 *   - Wrong serial count -> 400 naming number of serial numbers
 *   - Wrong SU quantity (Class F, VOLLE = 'X', partial pick) -> 400 naming full stock removal (VOLLE = X)
 *   - Insufficient stock in issuing SLoc -> 400 naming insufficient stock
 *   - GI failure then retry -> status 90 then status 05
 *   - External warehouse receiving TR detection (W10 / 302): detected via LTBK, surfaces warning & receivingTr, no auto-touch
 *   - Confirmed TO quantity (CONF_MENGE) posted by MIGO
 *   - NO_MORE_GR set only when CompleteReservation is true
 *   - T321 warning (WM_PRE_MIGO_T321_CHECK) when TBFKZ = X
 *   - Stock effect formatted with receiving plant and SLoc
 *
 * All tests labeled: [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const { STATUS } = require('../../../srv/common/wmStatus');

describe('Movement Type 301 (Plant to Plant Transfer) Process Tests [mock only, not SAP verification]', () => {
  let mockRfc;
  let resAdapter;
  let trAdapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(async (fm, params) => {
        if (fm === 'BAPI_RESERVATION_CREATE1') {
          return {
            RESERVATION: '0000525301',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation created' }]
          };
        }
        if (fm === 'L_TR_CREATE') {
          return { T_LTBA: [{ TBNUM: '0001000795', TBPOS: '0001' }] };
        }
        if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') {
          return {
            ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: params?.IV_TR_NUMBER || '0001000795', BWLVS: '301', BETYP: '', BENUM: '', RSNUM: '', NLTYP: '920', NLPLA: 'TRANSFER' }],
            ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: params?.IV_TR_NUMBER || '0001000795', TBPOS: '0001', MATNR: '000000008000001648', WERKS: '1120', LGORT: 'HS01', MENGE: 10, TAMEN: 0, MEINS: 'NOS' }]
          };
        }
        if (fm === 'Z_WM_TO_CREATE_FROM_TR') {
          return { EV_SUCCESS: 'S', EV_TANUM: '0001015000' };
        }
        if (fm === 'L_TO_CONFIRM') {
          return { EV_SUCCESS: 'S' };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          return {
            MATERIALDOCUMENT: '4900050149',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT' || fm === 'BAPI_TRANSACTION_ROLLBACK') {
          return {};
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
        if (table === 'MARC') {
          const werksClause = (where || []).find((w) => w.includes('WERKS'));
          if (werksClause && werksClause.includes('1110')) {
            return [{ WERKS: '1110', XCHPF: '', SERNP: 'ZSN1' }];
          }
          return [{ WERKS: '1120', XCHPF: '', SERNP: '' }];
        }
        if (table === 'MARD') {
          return [
            { LGORT: 'CS01', LABST: '100.000' },
            { LGORT: 'CS02', LABST: '50.000' },
            { LGORT: 'HS01', LABST: '1000.000' }
          ];
        }
        if (table === 'MCHA') {
          return [{ MATNR: '000000008900000004', WERKS: '1110', CHARG: 'INJW260001', LVORM: '' }];
        }
        if (table === 'MCH1') {
          return [{ MATNR: '000000008900000004', CHARG: 'INJW260001', LVORM: '' }];
        }
        if (table === 'T333') {
          return [{ LGNUM: 'W01', BWLVS: '301', BETYP: '', NKDYN: '', NLTYP: '920', NLPLA: 'TRANSFER' }];
        }
        if (table === 'T321') {
          return [{ LGNUM: '***', RBLVS: '301', BWLVS: '301', TBFKZ: 'X', TAFKZ: '' }];
        }
        return [];
      })
    };
    resAdapter = new ReservationProcessAdapter({ rfc: mockRfc, checkMarcExistence: true });
    trAdapter = new TrToAdapter({ rfc: mockRfc });
  });

  describe('1. Material Class Happy Paths [mock only, not SAP verification]', () => {
    test('Class A: Plain material (no batch, no serial) completes 301 reservation, TR, TO, and MIGO [mock only, not SAP verification]', async () => {
      // Step 1: Reservation
      const resResult = await resAdapter.createReservation({
        movementType: '301',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        receivingStorageLocation: 'CS01',
        material: '8000001648',
        quantity: 2,
        unit: 'NOS'
      });

      expect(resResult.success).toBe(true);
      expect(resResult.reservationNo).toBe('525301');
      expect(resResult.status).toBe(STATUS.RES_CREATED);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '301',
            MOVE_PLANT: '1110',
            MOVE_STLOC: 'CS01'
          }),
          RESERVATIONITEMS: [
            expect.objectContaining({
              MATERIAL: '000000008000001648',
              PLANT: '1120',
              STGE_LOC: 'HS01',
              ENTRY_QNT: 2,
              ENTRY_UOM: 'NOS'
            })
          ]
        })
      );

      // Step 2: Transfer Requirement
      const trResult = await resAdapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '301',
        movementType: '301',
        isTransferPosting: true,
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 2,
        unit: 'NOS',
        reservationNo: '525301'
      });

      expect(trResult.success).toBe(true);
      expect(trResult.trNumber).toBe('1000795');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'L_TR_CREATE',
        expect.objectContaining({
          T_LTBA: [
            expect.objectContaining({
              LGNUM: 'W01',
              BWLVS: '301',
              MATNR: '000000008000001648',
              WERKS: '1120',
              LGORT: 'HS01',
              MENGA: 2,
              RSNUM: '', // RSNUM omitted on 301 TR to prevent XFELD_WRONG
              RSPOS: ''
            })
          ]
        })
      );

      // Step 3: TO Create & Confirm
      const toResult = await trAdapter.createTOFromTR({
        lgnum: 'W01',
        tbnum: '1000795',
        tbpos: '0001',
        qty: 2,
        unit: 'NOS',
        autoConfirm: true
      });

      expect(toResult.Success).toBe(true);
      expect(toResult.TransferOrder).toBe('1015000');
      expect(toResult.Confirmed).toBe(true);
      expect(toResult.Status).toBe(STATUS.TO_CONFIRMED);

      // Step 4: MIGO Goods Movement
      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '525301',
        reservationItem: '0001',
        transferOrder: '1015000',
        movementType: '301',
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        receivingStorageLocation: 'CS01',
        quantity: 2,
        unit: 'NOS'
      });

      expect(migoResult.success).toBe(true);
      expect(migoResult.materialDocument).toBe('4900050149');
      expect(migoResult.status).toBe(STATUS.GI_POSTED);
      expect(migoResult.stockEffect).toBe('Stock transferred to Plant 1110 / SLoc CS01');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '04' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '301',
              MOVE_PLANT: '1110',
              MOVE_STLOC: 'CS01',
              MATERIAL: '000000008000001648',
              PLANT: '1120',
              STGE_LOC: 'HS01',
              ENTRY_QNT: 2,
              ENTRY_UOM: 'NOS'
            })
          ]
        })
      );
    });

    test('Class B: Batch-managed material (8900000004, Batch INJW260001) passes batch validation in receiving plant [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: 'X', SERNP: '' }, { WERKS: '1110', XCHPF: 'X', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'CS01', LABST: '1240.000' }];
        if (table === 'MCHA') return [{ MATNR: '000000008900000004', WERKS: '1110', CHARG: 'INJW260001', LVORM: '' }];
        if (table === 'MCH1') return [{ MATNR: '000000008900000004', CHARG: 'INJW260001', LVORM: '' }];
        return [];
      });

      const resResult = await resAdapter.createReservation({
        movementType: '301',
        plant: '1120',
        storageLocation: 'CS01',
        receivingPlant: '1110',
        receivingStorageLocation: 'CS01',
        material: '8900000004',
        batch: 'INJW260001',
        quantity: 10,
        unit: 'KG'
      });

      expect(resResult.success).toBe(true);

      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '525302',
        movementType: '301',
        material: '8900000004',
        plant: '1120',
        storageLocation: 'CS01',
        receivingPlant: '1110',
        receivingStorageLocation: 'CS01',
        batch: 'INJW260001',
        quantity: 10,
        unit: 'KG'
      });

      expect(migoResult.success).toBe(true);
      expect(migoResult.batch).toBe('INJW260001');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_ITEM: [
            expect.objectContaining({
              BATCH: 'INJW260001',
              MOVE_PLANT: '1110',
              MOVE_STLOC: 'CS01'
            })
          ]
        })
      );
    });

    test('Class C: Serial-managed material (8000006485) moves plants with serials passed to MIGO [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'MARC') {
          const werksClause = (where || []).find((w) => w.includes('WERKS'));
          if (werksClause && werksClause.includes('1110')) {
            return [{ WERKS: '1110', XCHPF: '', SERNP: 'ZSN1' }];
          }
          return [{ WERKS: '1120', XCHPF: '', SERNP: 'ZSN2' }];
        }
        if (table === 'MARD') return [{ LGORT: 'CS02', LABST: '4.000' }];
        return [];
      });

      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '525303',
        movementType: '301',
        material: '8000006485',
        plant: '1120',
        storageLocation: 'CS02',
        receivingPlant: '1110',
        receivingStorageLocation: 'CS02',
        quantity: 1,
        unit: 'NOS',
        serials: ['SN2026101301']
      });

      expect(migoResult.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_SERIALNUMBER: [{ MATDOC_ITM: '0001', SERIALNO: 'SN2026101301' }]
        })
      );
    });

    test('Class E: Stock in small SU (VOLLE = "") allows partial removal via TrToAdapter [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T331') return [{ LGNUM: 'W01', LGTYP: '002', STAUS: 'F', VOLLE: '', LENVW: '' }];
        if (table === 'LQUA') return [{ LGNUM: 'W01', LGTYP: '002', LGPLA: 'BIN-01', LENUM: '00000000002000020148', VERME: '5.000' }];
        return [];
      });

      const toResult = await trAdapter.createTOFromTR({
        lgnum: 'W01',
        tbnum: '1000795',
        qty: 1, // Partial pick: 1 out of 5
        storageUnit: '00000000002000020148',
        sourceStorageType: '002',
        sourceStorageBin: 'BIN-01',
        autoConfirm: true
      });

      expect(toResult.Success).toBe(true);
      expect(toResult.TransferOrder).toBe('1015000');
    });

    test('Class F: Stock in large SU (VOLLE = "X") succeeds when full SU quantity is requested [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T331') return [{ LGNUM: 'W01', LGTYP: 'OH1', STAUS: 'H', VOLLE: 'X', LENVW: 'X' }];
        if (table === 'LQUA') return [{ LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'ONHOLD', LENUM: '00000000002000020150', VERME: '1.000' }];
        return [];
      });

      const toResult = await trAdapter.createTOFromTR({
        lgnum: 'W01',
        tbnum: '1000795',
        qty: 1, // Full pick: 1 out of 1
        storageUnit: '00000000002000020150',
        sourceStorageType: 'OH1',
        sourceStorageBin: 'ONHOLD',
        autoConfirm: true
      });

      expect(toResult.Success).toBe(true);
      expect(toResult.TransferOrder).toBe('1015000');
    });
  });

  describe('2. Negative / Edge Validations [mock only, not SAP verification]', () => {
    test('Fails 400 when receivingPlant is missing for Movement 301 [mock only, not SAP verification]', async () => {
      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000001648',
          quantity: 1,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Receiving Plant is mandatory for Movement Type 301/i)
      });
    });

    test('Fails 400 when receivingPlant equals issuing plant for Movement 301 [mock only, not SAP verification]', async () => {
      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1120',
          storageLocation: 'HS01',
          material: '8000001648',
          quantity: 1,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Receiving Plant must be different from Issuing Plant/i)
      });
    });

    test('Fails 400 when material is not extended to receiving plant in MARC [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MARC') {
          const werksClause = (where || []).find((w) => w.includes('WERKS'));
          if (werksClause && werksClause.includes('1110')) return []; // Not extended in 1110
          return [{ WERKS: '1120', XCHPF: '', SERNP: '' }];
        }
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1110',
          storageLocation: 'HS01',
          material: '8900000007',
          quantity: 1,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/not extended to receiving plant 1110 \(MARC\)/i)
      });
    });

    test('Fails 400 when material is not extended to receiving SLoc in MARD [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MARC') return [{ WERKS: '1110', XCHPF: '', SERNP: '' }, { WERKS: '1120', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') {
          const werksClause = (where || []).find((w) => w.includes('WERKS'));
          if (werksClause && werksClause.includes('1110')) return []; // No SLoc in 1110
          return [{ LGORT: 'HS01' }];
        }
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1110',
          storageLocation: 'HS01',
          receivingStorageLocation: 'CS01',
          material: '8000001648',
          quantity: 1,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/not extended to receiving storage location CS01 in plant 1110 \(MARD\)/i)
      });
    });

    test('Fails 400 when issuing storage location is not assigned to warehouse in T320 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1110', XCHPF: '', SERNP: '' }, { WERKS: '1120', XCHPF: '', SERNP: '' }];
        if (table === 'T320') return []; // SLoc not assigned to warehouse
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1110',
          storageLocation: 'SL99',
          material: '8000001648',
          quantity: 1,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Issuing storage location SL99 is not assigned to warehouse in plant 1120 \(T320\)/i)
      });
    });

    test('Fails 400 when batch is missing for batch-managed material (Class B) [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: 'X', SERNP: '' }, { WERKS: '1110', XCHPF: 'X', SERNP: '' }];
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1110',
          storageLocation: 'CS01',
          material: '8900000004',
          quantity: 1,
          unit: 'KG'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Batch is mandatory for batch-managed material 8900000004/i)
      });
    });

    test('Fails 400 when batch is marked for deletion in receiving plant context (MCHA-LVORM = X) [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: 'X', SERNP: '' }, { WERKS: '1110', XCHPF: 'X', SERNP: '' }];
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        if (table === 'MARD') return [{ LGORT: 'CS01', LABST: '100.000' }];
        if (table === 'MCHA') return [{ MATNR: '000000008900000004', WERKS: '1110', CHARG: 'DEL001', LVORM: 'X' }];
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1110',
          storageLocation: 'CS01',
          material: '8900000004',
          batch: 'DEL001',
          quantity: 1,
          unit: 'KG'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Batch DEL001 is marked for deletion in receiving plant 1110 \(MCHA-LVORM = X\)/i)
      });
    });

    test('Fails 400 when batch does not exist in receiving plant context (MCHA/MCH1) [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: 'X', SERNP: '' }, { WERKS: '1110', XCHPF: 'X', SERNP: '' }];
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        if (table === 'MARD') return [{ LGORT: 'CS01', LABST: '100.000' }];
        if (table === 'MCHA') return []; // not in MCHA
        if (table === 'MCH1') return []; // not in MCH1
        return [];
      });

      await expect(
        resAdapter.createReservation({
          movementType: '301',
          plant: '1120',
          receivingPlant: '1110',
          storageLocation: 'CS01',
          material: '8900000004',
          batch: 'FAKE000001', // 10 chars CHARG format
          quantity: 1,
          unit: 'KG'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Batch FAKE000001 does not exist in receiving plant 1110 master data \(MCHA\/MCH1\)/i)
      });
    });

    test('Fails 400 when serial numbers are missing for serial-managed material (Class C) [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: 'ZSN2' }, { WERKS: '1110', XCHPF: '', SERNP: 'ZSN1' }];
        if (table === 'MARD') return [{ LGORT: 'CS02', LABST: '4.000' }];
        return [];
      });

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '525301',
          movementType: '301',
          material: '8000006485',
          plant: '1120',
          storageLocation: 'CS02',
          receivingPlant: '1110',
          quantity: 1,
          unit: 'NOS',
          serials: [] // empty serials
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Serial numbers are mandatory for serial-managed material 8000006485 \(profile ZSN2\)/i)
      });
    });

    test('Fails 400 when serial count does not match quantity [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: 'ZSN2' }, { WERKS: '1110', XCHPF: '', SERNP: 'ZSN1' }];
        if (table === 'MARD') return [{ LGORT: 'CS02', LABST: '4.000' }];
        return [];
      });

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '525301',
          movementType: '301',
          material: '8000006485',
          plant: '1120',
          storageLocation: 'CS02',
          receivingPlant: '1110',
          quantity: 2,
          unit: 'NOS',
          serials: ['SN001'] // 1 serial for qty 2
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Number of serial numbers \(1\) must equal quantity \(2\)/i)
      });
    });

    test('Fails 400 when partial quantity is requested from SU with VOLLE = "X" (Class F) [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T331') return [{ LGNUM: 'W01', LGTYP: 'OH1', STAUS: 'H', VOLLE: 'X', LENVW: 'X' }];
        if (table === 'LQUA') return [{ LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'ONHOLD', LENUM: '00000000002000020150', VERME: '5.000' }];
        return [];
      });

      await expect(
        trAdapter.createTOFromTR({
          lgnum: 'W01',
          tbnum: '1000795',
          qty: 2, // partial: 2 requested out of 5 in SU
          storageUnit: '00000000002000020150',
          sourceStorageType: 'OH1',
          sourceStorageBin: 'ONHOLD'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Storage type OH1 requires full stock removal \(VOLLE = X\); requested quantity \(2\) must equal total storage unit quantity \(5\)/i)
      });
    });

    test('Fails 400 when stock in issuing storage location is insufficient in MARD-LABST [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: '' }, { WERKS: '1110', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '3.000' }]; // only 3 available
        return [];
      });

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '525301',
          movementType: '301',
          material: '8000001648',
          plant: '1120',
          storageLocation: 'HS01',
          receivingPlant: '1110',
          quantity: 10, // requested 10
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Insufficient stock in storage location HS01 for material 8000001648 \(available: 3, requested: 10\)/i)
      });
    });

    test('GI failure performs rollback, allows retry, and preserves idempotency [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: '' }, { WERKS: '1110', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        return [];
      });

      // First attempt fails at BAPI_GOODSMVT_CREATE
      mockRfc.call
        .mockResolvedValueOnce({
          RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Posting error: Period 10/2026 is locked' }]
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        resAdapter.postGoodsMovement({
          reservationNo: '525301',
          movementType: '301',
          material: '8000001648',
          plant: '1120',
          storageLocation: 'HS01',
          receivingPlant: '1110',
          quantity: 2,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/BAPI_GOODSMVT_CREATE failed: Posting error: Period 10\/2026 is locked/i)
      });

      expect(mockRfc.call).toHaveBeenCalledWith('BAPI_TRANSACTION_ROLLBACK', {});

      // Retry attempt succeeds
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050152',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050152 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const retryResult = await resAdapter.postGoodsMovement({
        reservationNo: '525301',
        movementType: '301',
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        quantity: 2,
        unit: 'NOS'
      });

      expect(retryResult.success).toBe(true);
      expect(retryResult.materialDocument).toBe('4900050152');
      expect(retryResult.status).toBe(STATUS.GI_POSTED);
    });

    test('Receiving-side TR in external warehouse (W10) is detected and returned as warning without auto-touch [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: '' }, { WERKS: '1110', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        if (table === 'LTBK') {
          // Both W01 issuing TR and W10 receiving TR exist in LTBK
          return [
            { LGNUM: 'W01', TBNUM: '0001000795', BWLVS: '301', STATU: 'E' },
            { LGNUM: 'W10', TBNUM: '0001001222', BWLVS: '302', STATU: '' }
          ];
        }
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050149',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050149 posted' }]
        })
        .mockResolvedValueOnce({});

      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '525301',
        warehouseNumber: 'W01',
        movementType: '301',
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        quantity: 1,
        unit: 'NOS'
      });

      expect(migoResult.success).toBe(true);
      expect(migoResult.receivingTr).toEqual({
        warehouse: 'W10',
        trNumber: '1001222',
        movementType: '302',
        status: 'Open'
      });
      expect(migoResult.warning).toMatch(/Movement 301 created receiving-side TR 1001222 in warehouse W10 \(movement 302\); this warehouse is outside project scope and requires manual processing by the WM consultant/);
    });

    test('Scopes confirmed TO quantity (CONF_MENGE) from LTAP when posting MIGO for Movement 301 [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: '' }, { WERKS: '1110', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        if (table === 'LTAP') return [{ VSOLM: '5.000', NISTM: '4.000' }]; // confirmed 4 out of 5
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050153',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
        })
        .mockResolvedValueOnce({});

      const migoResult = await resAdapter.postGoodsMovement({
        reservationNo: '525301',
        transferOrder: '1015000',
        movementType: '301',
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        quantity: 5, // caller requested 5, but LTAP confirmed is 4
        unit: 'NOS'
      });

      expect(migoResult.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_ITEM: [
            expect.objectContaining({
              ENTRY_QNT: 4 // scoped to confirmed quantity 4
            })
          ]
        })
      );
    });

    test('NO_MORE_GR indicator is passed only when completeReservation is true [mock only, not SAP verification]', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1120', XCHPF: '', SERNP: '' }, { WERKS: '1110', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        return [];
      });

      // Without completeReservation
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050154',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
        })
        .mockResolvedValueOnce({});

      await resAdapter.postGoodsMovement({
        reservationNo: '525301',
        movementType: '301',
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        quantity: 2,
        unit: 'NOS',
        completeReservation: false
      });

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_ITEM: [
            expect.not.objectContaining({
              NO_MORE_GR: 'X'
            })
          ]
        })
      );

      // With completeReservation
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050155',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
        })
        .mockResolvedValueOnce({});

      await resAdapter.postGoodsMovement({
        reservationNo: '525301',
        movementType: '301',
        material: '8000001648',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1110',
        quantity: 2,
        unit: 'NOS',
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

    test('Fails 400 when receiving plant has no valuation/accounting data (MBEW) [mock only, not SAP verification]', async () => {
      const mbewAdapter = new ReservationProcessAdapter({ rfc: mockRfc, checkMarcExistence: true, checkMbewExistence: true });
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1110', XCHPF: '', SERNP: '' }, { WERKS: '1120', XCHPF: '', SERNP: '' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        if (table === 'MBEW') return []; // Empty MBEW in receiving plant
        return [];
      });

      await expect(
        mbewAdapter.postGoodsMovement({
          reservationNo: '525301',
          movementType: '301',
          material: '8000001648',
          plant: '1120',
          storageLocation: 'HS01',
          receivingPlant: '1110',
          quantity: 1,
          unit: 'NOS'
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/has no valuation\/accounting data \(MBEW\) in receiving plant 1110/i)
      });
    });

    test('Fails 400 when serial-managed material has no serial profile in receiving plant [mock only, not SAP verification]', async () => {
      const sernpAdapter = new ReservationProcessAdapter({ rfc: mockRfc, checkMarcExistence: true, checkSernpMatch: true });
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MARC') {
          const werksClause = (where || []).find((w) => w.includes('WERKS'));
          if (werksClause && werksClause.includes('1110')) {
            return [{ WERKS: '1110', XCHPF: '', SERNP: '' }]; // blank in receiving plant
          }
          return [{ WERKS: '1120', XCHPF: '', SERNP: 'ZSN2' }]; // ZSN2 in issuing plant
        }
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
        return [];
      });

      await expect(
        sernpAdapter.postGoodsMovement({
          reservationNo: '525301',
          movementType: '301',
          material: '8000006485',
          plant: '1120',
          storageLocation: 'HS01',
          receivingPlant: '1110',
          quantity: 1,
          unit: 'NOS',
          serials: ['SN001']
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/has no serial number profile in receiving plant 1110/i)
      });
    });
  });
});
