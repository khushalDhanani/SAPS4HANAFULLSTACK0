'use strict';

/**
 * Unit Test Suite for Chunk 5: Step 3 Auto MIGO Posting & Retry
 * Validates:
 * 1. Movement type to GM_CODE and item fields mapping:
 *    - 201: GM_CODE '03' COSTCENTER -> "Stock consumed to Cost Center <cc>"
 *    - 241: GM_CODE '03' ASSET_NO/SUB_NUMBER -> "Stock consumed to Asset <asset>"
 *    - 311: GM_CODE '04' MOVE_STLOC -> "Stock transferred to Storage Location <sloc>"
 *    - 301: GM_CODE '04' MOVE_PLANT -> "Stock transferred to Plant <plant>"
 * 2. Reservation closure indicator:
 *    - NO_MORE_GR = 'X' only when completeReservation is true; RESERV_NO and RES_ITEM always when a reservation exists
 * 3. Rollback & ERROR status on failure:
 *    - BAPI_TRANSACTION_ROLLBACK called when BAPI_GOODSMVT_CREATE returns error
 * 4. Chained Auto-MIGO trigger after TO confirmation (createTOFromTR with autoPostMigo: true)
 * 5. Standalone MIGO Posting and Retry capability (Status 90 -> 05)
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');
const { PROCESS_STATUS } = require('../../../srv/common/wmStatus');

describe('Chunk 5: Step 3 Auto MIGO Posting & Retry', () => {
  let mockRfc;
  let adapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(),
      readTable: jest.fn(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        if (table === 'MARD') return [{ LGORT: 'CS01' }, { LGORT: 'HS01' }];
        return [];
      }) // RESB / LTAP / MARC reads: nothing found, material not batch-managed
    };
    adapter = new ReservationProcessAdapter({ rfc: mockRfc });
  });

  const setupDefaultReadTable = (overrides = {}) => {
    mockRfc.readTable.mockImplementation(async (table, fields, where = []) => {
      const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
      if (overrides[table]) return overrides[table](fields, where, whereStr);
      if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }];
      if (table === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011201301', DATAB: '20200101', DATBI: '99991231', BKZKP: '' }];
      if (table === 'MARC') return [{ XCHPF: '' }];
      if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '100.000' }];
      if (table === 'LTBK') {
        return [{
          LGNUM: 'W01',
          TBNUM: '0001000850',
          BWLVS: '311',
          BETYP: 'K',
          BENUM: '001011201301',
          RSNUM: '0000520235',
          STATU: 'O',
          BDATU: '20261014'
        }];
      }
      if (table === 'LTAK') {
        return [{
          LGNUM: 'W01',
          TANUM: '0001037299',
          TBNUM: '0001000850',
          BWLVS: '311',
          KQUIT: ' ',
          BDATU: '20261014'
        }];
      }
      if (table === 'LTAP') {
        return [{
          LGNUM: 'W01',
          TANUM: '0001037299',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '10.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }];
      }
      if (table === 'MATDOC' && whereStr.includes("MBLNR = '5000999999'")) {
        return [{
          MBLNR: '5000999999',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '201',
          MATNR: '000000008000000023',
          MENGE: '10.000',
          WERKS: '1120',
          LGORT: 'HS01',
          RSNUM: '0000520235',
          RSPOS: '0001',
          KOSTL: '001011201301',
          SHKZG: 'H'
        }];
      }
      if (table === 'MATDOC') return [];
      if (table === 'RESB') {
        return [{
          RSNUM: '0000520235',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'NOS',
          KZEAR: 'X',
          XLOEK: ''
        }];
      }
      return [];
    });
  };

  const setupDefaultFmCalls = (overrides = {}) => {
    mockRfc.call.mockImplementation(async (fm, params) => {
      if (overrides[fm]) return overrides[fm](params);
      if (fm === 'BAPI_RESERVATION_CREATE1') return { RESERVATION: '0000520235', RETURN: [] };
      if (fm === 'L_TR_CREATE') {
        return {
          T_LTBA: [{
            TBNUM: '0001000850',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: 10,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: '311'
          }]
        };
      }
      if (fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
        return {
          EV_TBNUM: '0001000850',
          EV_TBPOS: '0001',
          MATNR: '000000008000000023',
          MENGA: 10,
          WERKS: '1120',
          LGORT: 'HS01',
          LGNUM: 'W01',
          BWLVS: '311'
        };
      }
      if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR') return { E_TANUM: '0001037299' };
      if (fm === 'L_TO_CONFIRM') return {};
      if (fm === 'BAPI_GOODSMVT_CREATE') {
        return {
          MATERIALDOCUMENT: '5000999999',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
        };
      }
      if (fm === 'BAPI_TRANSACTION_COMMIT') return {};
      return {};
    });
  };

  describe('1. Movement Type to GM_CODE and Item Field Mappings', () => {
    test('Movement 201: maps GM_CODE 03, COSTCENTER, and closes reservation with NO_MORE_GR = X', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050201',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050201 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await adapter.postGoodsMovement({
        reservationNo: '524980',
        reservationItem: '0001',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 5,
        unit: 'NOS',
        costCenter: '1011201301',
        completeReservation: true // operator ticked "complete reservation" -> NO_MORE_GR
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050201');
      expect(res.materialDocYear).toBe('2026');
      expect(res.status).toBe('05');
      expect(res.stockEffect).toBe('Stock consumed to Cost Center 1011201301');

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '03' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '201',
              COSTCENTER: '1011201301',
              RESERV_NO: '0000524980',
              RES_ITEM: '0001',
              NO_MORE_GR: 'X'
            })
          ]
        })
      );
    });

    test('Movement 241: maps GM_CODE 03, ASSET_NO, SUB_NUMBER, without NO_MORE_GR unless completeReservation is set', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050241',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050241 posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await adapter.postGoodsMovement({
        reservationNo: '524981',
        reservationItem: '0001',
        movementType: '241',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'NOS',
        assetNo: '000000400092',
        subNumber: '0000',
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050241');
      expect(res.stockEffect).toBe('Stock consumed to Asset 000000400092/0000');

      expect(mockRfc.call.mock.calls[0][1].GOODSMVT_ITEM[0].NO_MORE_GR).toBeUndefined();
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '03' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '241',
              ASSET_NO: '000000400092',
              SUB_NUMBER: '0000',
              RESERV_NO: '0000524981',
              RES_ITEM: '0001'
            })
          ]
        })
      );
    });

    test('Movement 311: maps GM_CODE 04, MOVE_STLOC, without NO_MORE_GR unless completeReservation is set', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050311',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050311 posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await adapter.postGoodsMovement({
        reservationNo: '524979',
        reservationItem: '0001',
        movementType: '311',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        receivingStorageLocation: 'CS01',
        quantity: 2,
        unit: 'NOS',
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050311');
      expect(res.stockEffect).toBe('Stock transferred to Storage Location CS01');

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '04' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '311',
              MOVE_STLOC: 'CS01',
              RESERV_NO: '0000524979',
              RES_ITEM: '0001'
            })
          ]
        })
      );
    });

    test('Movement 301: maps GM_CODE 04, MOVE_PLANT, without NO_MORE_GR unless completeReservation is set', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050301',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050301 posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await adapter.postGoodsMovement({
        reservationNo: '524982',
        reservationItem: '0001',
        movementType: '301',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1130',
        quantity: 4,
        unit: 'NOS',
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050301');
      expect(res.stockEffect).toBe('Stock transferred to Plant 1130');

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '04' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '301',
              MOVE_PLANT: '1130',
              RESERV_NO: '0000524982',
              RES_ITEM: '0001'
            })
          ]
        })
      );
    });

    test('Direct TO Movement: allows posting without reservation when transferOrder is provided', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050999',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050999 posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await adapter.postGoodsMovement({
        transferOrder: '1037284',
        movementType: '301',
        material: '8900000004',
        plant: '1120',
        storageLocation: 'CS01',
        receivingPlant: '1110',
        receivingStorageLocation: 'CS01',
        quantity: 1,
        unit: 'KG',
        batch: 'INJW260001',
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900050999');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_HEADER: expect.objectContaining({
            REF_DOC_NO: 'TO 1037284'
          }),
          GOODSMVT_CODE: { GM_CODE: '04' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '301',
              MOVE_PLANT: '1110',
              BATCH: 'INJW260001'
            })
          ]
        })
      );
      // Ensure RESERV_NO is NOT set when no reservation exists
      const lastCallItem = mockRfc.call.mock.calls[0][1].GOODSMVT_ITEM[0];
      expect(lastCallItem.RESERV_NO).toBeUndefined();
    });

    test('Batch Resolution: auto-resolves batch from LTAP when batch is omitted', async () => {
      mockRfc.readTable = jest.fn((table) => {
        if (table === 'LTAP') return Promise.resolve([{ CHARG: 'INJW260001' }]);
        return Promise.resolve([]);
      });
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050998',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050998 posted' }]
        })
        .mockResolvedValueOnce({});

      const res = await adapter.postGoodsMovement({
        transferOrder: '1037284',
        movementType: '301',
        material: '8900000004',
        plant: '1120',
        storageLocation: 'CS01',
        receivingPlant: '1110',
        quantity: 1,
        unit: 'KG',
      });

      expect(res.success).toBe(true);
      expect(res.batch).toBe('INJW260001');
      expect(mockRfc.readTable).toHaveBeenCalledWith(
        'LTAP',
        ['CHARG'],
        expect.arrayContaining(["TANUM = '0001037284'", "AND CHARG <> ''"]),
        1
      );
      const lastCallItem = mockRfc.call.mock.calls[0][1].GOODSMVT_ITEM[0];
      expect(lastCallItem.BATCH).toBe('INJW260001');
    });
  });

  describe('2. Rollback on Failure', () => {
    test('calls BAPI_TRANSACTION_ROLLBACK and throws error on BAPI failure', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '',
          RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Deficit of BA Unrestricted-use stock 5 EA' }]
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        adapter.postGoodsMovement({
          reservationNo: '524979',
          reservationItem: '0001',
          movementType: '311',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          receivingStorageLocation: 'CS01',
          quantity: 5,
          unit: 'NOS',
          })
      ).rejects.toThrow('Deficit of BA Unrestricted-use stock 5 EA');

      expect(mockRfc.call).toHaveBeenCalledWith('BAPI_TRANSACTION_ROLLBACK', {});
    });
  });

  describe('3. Chained Auto-MIGO Trigger after TO Confirmation (TrToHandler)', () => {
    let mockSrv;
    let handlers;
    let mockTrAdapter;
    let mockResAdapter;

    beforeEach(() => {
      handlers = {};
      mockSrv = {
        on: jest.fn((event, fn) => {
          handlers[event] = fn;
        })
      };

      mockTrAdapter = {
        createTOFromTR: jest.fn()
      };

      mockResAdapter = {
        postGoodsMovement: jest.fn(),
        checkAuthorization: jest.fn().mockResolvedValue(true)
      };

      TrToHandler.init(mockSrv, {
        adapter: mockTrAdapter,
        resProcessAdapter: mockResAdapter
      });
    });

    test('Chains MIGO posting when autoPostMigo=true and TO is confirmed', async () => {
      // 1. Mock TO creation and confirmation
      mockTrAdapter.createTOFromTR.mockResolvedValueOnce({
        TransferOrder: '1012975',
        TransferRequirement: '1001839',
        ReservationNo: '0000524979',
        ReservationItem: '0001',
        Status: '04',
        StatusText: 'TO Confirmed',
        Confirmed: true,
        Quantity: 5,
        Unit: 'EA',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Batch: 'INJW260001'
      });

      // 2. Mock MIGO success
      mockResAdapter.postGoodsMovement.mockResolvedValueOnce({
        materialDocument: '4900050355',
        materialDocYear: '2026',
        status: '05',
        stockEffect: 'Stock transferred to Storage Location CS01'
      });

      const req = {
        data: {
          tbnum: '0001001839',
          qty: 5,
          batch: 'INJW260001',
          autoConfirm: true,
          autoPostMigo: true
        },
        error: jest.fn()
      };

      const result = await handlers.createTOFromTR(req);

      expect(result.Status).toBe('05');
      expect(result.StatusText).toBe('Goods Issue Posted');
      expect(result.MaterialDocument).toBe('4900050355');
      expect(result.MaterialDocYear).toBe('2026');
      expect(result.StockEffect).toBe('Stock transferred to Storage Location CS01');
      expect(mockResAdapter.postGoodsMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationNo: '0000524979',
          batch: 'INJW260001',
          })
      );
    });

    test('Handles MIGO failure in chain by marking status 90 (GI error) while preserving confirmed TO', async () => {
      mockTrAdapter.createTOFromTR.mockResolvedValueOnce({
        TransferOrder: '1012976',
        TransferRequirement: '1001839',
        ReservationNo: '0000524979',
        ReservationItem: '0001',
        Status: '04',
        StatusText: 'TO Confirmed',
        Confirmed: true,
        Quantity: 5,
        Unit: 'EA',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023'
      });

      mockResAdapter.postGoodsMovement.mockRejectedValueOnce(
        new Error('Posting period 10/2026 closed')
      );

      const req = {
        data: {
          tbnum: '0001001839',
          qty: 5,
          autoConfirm: true,
          autoPostMigo: true
        },
        error: jest.fn()
      };

      const result = await handlers.createTOFromTR(req);

      expect(result.TransferOrder).toBe('1012976');
      expect(result.Status).toBe('90');
      expect(result.StatusText).toBe('Goods Issue Error');
      expect(result.ErrorMessage).toBe('Posting period 10/2026 closed');
    });

    test('Standalone postMigoGoodsMovement action successfully recovers status to 05', async () => {
      mockResAdapter.postGoodsMovement.mockResolvedValueOnce({
        materialDocument: '4900050356',
        materialDocYear: '2026',
        status: '05',
        stockEffect: 'Stock consumed to Cost Center 1011201301'
      });

      const req = {
        data: {
          ReservationNo: '0000524980',
          ReservationItem: '0001',
          TransferOrder: '1012976',
          MovementType: '201',
          CostCenter: '1011201301',
          Material: '8000000023',
          Plant: '1120',
          Quantity: 5,
          Unit: 'EA',
          Batch: 'INJW260001'
        },
        error: jest.fn()
      };

      const res = await handlers.postMigoGoodsMovement(req);

      expect(res.Success).toBe(true);
      expect(res.Status).toBe('05');
      expect(res.MaterialDocument).toBe('4900050356');
      expect(res.StockEffect).toBe('Stock consumed to Cost Center 1011201301');
      expect(mockResAdapter.postGoodsMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          reservationNo: '0000524980',
          batch: 'INJW260001'
        })
      );
    });
  });

  describe('6. Dedicated Standalone MIGO Final Stage with Clear Request Shapes (Step 9)', () => {
    test('Movement 201 clear request: postGoodsMovement() with reservationNumber and cost center auto-resolution', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'RKPF') return [{ KOSTL: '1011201301' }];
        if (table === 'CSKS') return [{ KOSTL: '1011201301', DATAB: '20200101', DATBI: '99991231' }];
        if (table === 'RESB') return [{ MEINS: 'EA' }];
        if (table === 'MARC') return [{ XCHPF: '' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900060201',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900060201 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await adapter.postGoodsMovement({
        movementType: '201',
        reservationNumber: '520235',
        reservationItem: '0001',
        material: 'ABC123',
        quantity: '10',
        plant: '1000',
        storageLocation: '0001'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900060201');
      expect(res.materialDocYear).toBe('2026');
      expect(res.status).toBe('05');
      expect(res.stockEffect).toBe('Stock consumed to Cost Center 1011201301');

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '03' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '201',
              COSTCENTER: '1011201301',
              RESERV_NO: '0000520235',
              RES_ITEM: '0001',
              PLANT: '1000',
              STGE_LOC: '0001',
              ENTRY_QNT: 10,
              ENTRY_UOM: 'EA'
            })
          ]
        })
      );
    });

    test('Movement 311 clear request: postGoodsMovement() with plant, sourceStorageLocation, destinationStorageLocation', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1000', LGORT: '0002' }];
        if (table === 'MARD') return [{ LGORT: '0002', MATNR: 'MAT-311' }];
        if (table === 'MARC') return [{ XCHPF: '' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900060311',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900060311 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await adapter.postGoodsMovement({
        movementType: '311',
        plant: '1000',
        sourceStorageLocation: '0001',
        destinationStorageLocation: '0002'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900060311');
      expect(res.status).toBe('05');
      expect(res.stockEffect).toBe('Stock transferred to Storage Location 0002');

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '04' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '311',
              PLANT: '1000',
              STGE_LOC: '0001',
              MOVE_STLOC: '0002'
            })
          ]
        })
      );
    });

    test('Movement 301 clear request: postGoodsMovement() with sourcePlant, sourceStorageLocation, destinationPlant, destinationStorageLocation', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1000', LGORT: '0001' }];
        if (table === 'MARC') return [{ WERKS: '2000', MATNR: 'MAT-301', XCHPF: '' }];
        if (table === 'MBEW') return [{ BWKEY: '2000' }];
        if (table === 'MARD') return [{ LGORT: '0001', MATNR: 'MAT-301' }];
        return [];
      });

      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900060301',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900060301 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const res = await adapter.postGoodsMovement({
        movementType: '301',
        sourcePlant: '1000',
        sourceStorageLocation: '0001',
        destinationPlant: '2000',
        destinationStorageLocation: '0001'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('4900060301');
      expect(res.status).toBe('05');
      expect(res.stockEffect).toBe('Stock transferred to Plant 2000 / SLoc 0001');

      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '04' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '301',
              PLANT: '1000',
              STGE_LOC: '0001',
              MOVE_PLANT: '2000',
              MOVE_STLOC: '0001'
            })
          ]
        })
      );
    });

    test('TrToHandler postMigoGoodsMovement supports clear request shape directly without prior TO coupling', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        checkAuthorization: jest.fn().mockResolvedValue(true),
        postGoodsMovement: jest.fn().mockResolvedValue({
          success: true,
          materialDocument: '4900070311',
          materialDocYear: '2026',
          status: '05',
          stockEffect: 'Stock transferred to Storage Location 0002'
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          movementType: '311',
          plant: '1000',
          sourceStorageLocation: '0001',
          destinationStorageLocation: '0002'
        },
        error: jest.fn()
      };

      const res = await handlers.postMigoGoodsMovement(req);

      expect(res.Success).toBe(true);
      expect(res.MaterialDocument).toBe('4900070311');
      expect(res.Status).toBe('05');
      expect(mockRes.postGoodsMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movementType: '311',
          plant: '1000',
          storageLocation: '0001',
          receivingStorageLocation: '0002'
        })
      );
    });
  });

  describe('7. Step 10: Verify the Material Document (Verification Pipeline & Return Contract)', () => {
    test('Standardized MIGO return payload: contains success, stage, materialDocument, materialDocumentYear, movementType', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '5000123456',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000123456 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC' || table === 'MSEG') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '5.000',
            MEINS: 'NOS',
            RSNUM: '0000524980',
            RSPOS: '0001'
          }];
        }
        return [];
      });

      const res = await adapter.postGoodsMovement({
        reservationNo: '524980',
        reservationItem: '0001',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 5,
        unit: 'NOS',
        costCenter: '1011201301'
      });

      // Strict Step 10 contract assertion:
      expect(res).toMatchObject({
        success: true,
        stage: 'MIGO',
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201'
      });
      // Ensure it is not merely { success: true }
      expect(res.stage).toBe('MIGO');
      expect(res.materialDocument).toBe('5000123456');
      expect(res.materialDocumentYear).toBe('2026');
      expect(res.movementType).toBe('201');
    });

    test('Pipeline Check 1: Fails if Material document number is missing or empty', async () => {
      await expect(adapter.verifyMaterialDocument({
        materialDocument: '',
        materialDocumentYear: '2026'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Material document number exists: missing or empty')
      });
    });

    test('Pipeline Check 2: Fails if Material document year is missing or empty', async () => {
      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: ''
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Material document year exists: missing or empty')
      });
    });

    test('Pipeline Check 3: Fails if Movement type does not match SAP document', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '311', // SAP has 311, but caller expected 201
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '5.000'
          }];
        }
        return [];
      });

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Movement type mismatch (SAP: 311, expected: 201)')
      });
    });

    test('Pipeline Check 4: Fails if Material does not match SAP document', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '201',
            MATNR: '000000008000000999', // SAP has different material
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '5.000'
          }];
        }
        return [];
      });

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        material: '8000000023'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Material mismatch')
      });
    });

    test('Pipeline Check 5: Fails if Quantity does not match SAP document', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '10.000' // SAP has 10, expected 5
          }];
        }
        return [];
      });

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        material: '8000000023',
        quantity: 5
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Quantity mismatch (SAP: 10, expected: 5)')
      });
    });

    test('Pipeline Check 6: Fails if Plant or Storage Location does not match SAP document', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '2000', // Plant mismatch: SAP has 2000, expected 1120
            LGORT: 'HS01',
            MENGE: '5.000'
          }];
        }
        return [];
      });

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Plant mismatch (SAP: 2000, expected: 1120)')
      });

      // Storage location mismatch
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: '0002', // SLoc mismatch: SAP has 0002, expected HS01
            MENGE: '5.000'
          }];
        }
        return [];
      });

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Storage Location mismatch (SAP: 0002, expected: HS01)')
      });
    });

    test('Pipeline Check 7: Fails if Reservation reference does not match SAP document', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '5.000',
            RSNUM: '0000999999' // SAP has reservation 999999, expected 524980
          }];
        }
        return [];
      });

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        reservationNumber: '524980'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'MIGO',
        message: expect.stringContaining('Reservation reference mismatch (SAP: 0000999999, expected: 0000524980)')
      });
    });

    test('Persistence Check: Fails with 500 when document cannot be found in MATDOC/MSEG and check is enabled', async () => {
      adapter._checkMatdocPersistence = true;
      mockRfc.readTable.mockResolvedValue([]); // not found

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201'
      })).rejects.toMatchObject({
        status: 500,
        stage: 'MIGO',
        message: expect.stringContaining('persistence check failed')
      });
    });

    test('TrToHandler verifyMaterialDocument action calls resProcessAdapter.verifyMaterialDocument and returns Step 10 contract', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        verifyMaterialDocument: jest.fn().mockResolvedValue({
          success: true,
          stage: 'MIGO',
          materialDocument: '5000123456',
          materialDocumentYear: '2026',
          movementType: '201'
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          materialDocument: '5000123456',
          materialDocumentYear: '2026',
          movementType: '201',
          material: 'ABC123',
          quantity: 10,
          plant: '1000',
          storageLocation: '0001',
          reservationNumber: '520235'
        },
        error: jest.fn()
      };

      const result = await handlers.verifyMaterialDocument(req);
      expect(result).toEqual({
        success: true,
        stage: 'MIGO',
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201'
      });
      expect(mockRes.verifyMaterialDocument).toHaveBeenCalledWith(req.data);
    });
  });

  describe('8. Step 11: Add Final Stock Verification (Expected vs Actual per Movement Type)', () => {
    test('Movement 201: Verifies source stock decreases and consumed quantity equals posted quantity', async () => {
      mockRfc.readTable.mockImplementation(async (table, _fields, _where) => {
        if (table === 'MATDOC' || table === 'MSEG') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '5.000',
            SHKZG: 'H',
            KOSTL: '1011201301'
          }];
        }
        if (table === 'MARD') {
          return [{ LGORT: 'HS01', LABST: '95.000' }];
        }
        return [];
      });

      const res = await adapter.verifyStock({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        material: '8000000023',
        quantity: 5,
        plant: '1120',
        storageLocation: 'HS01',
        costCenter: '1011201301',
        initialSourceStock: 100
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('STOCK_VERIFICATION');
      expect(res.movementType).toBe('201');
      expect(res.sourceStockDecreased).toBe(true);
      expect(res.consumedQuantity).toBe(5);
      expect(res.costCenter).toBe('1011201301');
      expect(res.sourceStock.initial).toBe(100);
      expect(res.sourceStock.resulting).toBe(95);
      expect(res.sourceStock.delta).toBe(-5);
      expect(res.comparison.expected).toMatchObject({
        movementType: '201',
        sourceStockDecreases: true,
        consumedQuantity: 5,
        costCenter: '1011201301'
      });
      expect(res.comparison.actual).toMatchObject({
        movementType: '201',
        sourceStockDecreased: true,
        consumedQuantity: 5,
        costCenter: '1011201301'
      });
      expect(res.comparison.matches).toBe(true);
    });

    test('Movement 201: Fails verification if source stock did not decrease', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123456',
            MJAHR: '2026',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '5.000',
            SHKZG: 'H',
            KOSTL: '1011201301'
          }];
        }
        if (table === 'MARD') {
          return [{ LGORT: 'HS01', LABST: '105.000' }]; // Increased from 100 to 105!
        }
        return [];
      });

      await expect(adapter.verifyStock({
        materialDocument: '5000123456',
        materialDocumentYear: '2026',
        movementType: '201',
        material: '8000000023',
        quantity: 5,
        plant: '1120',
        storageLocation: 'HS01',
        costCenter: '1011201301',
        initialSourceStock: 100
      })).rejects.toMatchObject({
        status: 400,
        stage: 'STOCK_VERIFICATION',
        message: expect.stringContaining('Source stock did not decrease')
      });
    });

    test('Movement 241: Verifies stock decreases and asset-related consumption posted', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC' || table === 'MSEG') {
          return [{
            MBLNR: '5000123457',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '241',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '3.000',
            SHKZG: 'H',
            ANLN1: '000000400001',
            ANLN2: '0000'
          }];
        }
        if (table === 'MARD') {
          return [{ LGORT: 'HS01', LABST: '47.000' }]; // Decreased from 50 to 47
        }
        return [];
      });

      const res = await adapter.verifyStock({
        materialDocument: '5000123457',
        materialDocumentYear: '2026',
        movementType: '241',
        material: '8000000023',
        quantity: 3,
        plant: '1120',
        storageLocation: 'HS01',
        assetNo: '000000400001',
        subNumber: '0000',
        initialSourceStock: 50
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('STOCK_VERIFICATION');
      expect(res.movementType).toBe('241');
      expect(res.sourceStockDecreased).toBe(true);
      expect(res.assetConsumptionPosted).toBe(true);
      expect(res.consumedQuantity).toBe(3);
      expect(res.assetNo).toBe('000000400001');
      expect(res.comparison.expected.stockDecreases).toBe(true);
      expect(res.comparison.expected.assetConsumptionPosted).toBe(true);
      expect(res.comparison.matches).toBe(true);
    });

    test('Movement 241: Fails verification if asset consumption reference is missing', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123457',
            MJAHR: '2026',
            BWART: '241',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGE: '3.000',
            SHKZG: 'H',
            ANLN1: '', // Missing asset reference
            ANLN2: ''
          }];
        }
        if (table === 'MARD') {
          return [{ LGORT: 'HS01', LABST: '47.000' }];
        }
        return [];
      });

      await expect(adapter.verifyStock({
        materialDocument: '5000123457',
        materialDocumentYear: '2026',
        movementType: '241',
        material: '8000000023',
        quantity: 3,
        plant: '1120',
        storageLocation: 'HS01',
        assetNo: '',
        initialSourceStock: 50
      })).rejects.toMatchObject({
        status: 400,
        stage: 'STOCK_VERIFICATION',
        message: expect.stringContaining('Asset-related consumption not posted')
      });
    });

    test('Movement 311: Verifies source SLoc decreases and destination SLoc increases', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MATDOC' || table === 'MSEG') {
          return [{
            MBLNR: '5000123458',
            MJAHR: '2026',
            BWART: '311',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            UMWRK: '1120',
            UMLGO: 'CS01',
            MENGE: '10.000'
          }];
        }
        if (table === 'MARD') {
          const wStr = where.join(' ');
          if (wStr.includes('HS01')) {
            return [{ LGORT: 'HS01', LABST: '90.000' }]; // Decreased from 100 to 90
          }
          if (wStr.includes('CS01')) {
            return [{ LGORT: 'CS01', LABST: '30.000' }]; // Increased from 20 to 30
          }
        }
        return [];
      });

      const res = await adapter.verifyStock({
        materialDocument: '5000123458',
        materialDocumentYear: '2026',
        movementType: '311',
        material: '8000000023',
        quantity: 10,
        plant: '1120',
        storageLocation: 'HS01',
        receivingStorageLocation: 'CS01',
        initialSourceStock: 100,
        initialDestStock: 20
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('STOCK_VERIFICATION');
      expect(res.movementType).toBe('311');
      expect(res.sourceStockDecreased).toBe(true);
      expect(res.destinationStockIncreased).toBe(true);
      expect(res.sourceStock.delta).toBe(-10);
      expect(res.destinationStock.delta).toBe(10);
      expect(res.comparison.expected.sourceSLocDecreases).toBe(true);
      expect(res.comparison.expected.destinationSLocIncreases).toBe(true);
      expect(res.comparison.matches).toBe(true);
    });

    test('Movement 311: Fails verification if destination SLoc does not increase', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '5000123458',
            MJAHR: '2026',
            BWART: '311',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            UMWRK: '1120',
            UMLGO: 'CS01',
            MENGE: '10.000'
          }];
        }
        if (table === 'MARD') {
          const wStr = where.join(' ');
          if (wStr.includes('HS01')) {
            return [{ LGORT: 'HS01', LABST: '90.000' }];
          }
          if (wStr.includes('CS01')) {
            return [{ LGORT: 'CS01', LABST: '15.000' }]; // Decreased instead of increasing!
          }
        }
        return [];
      });

      await expect(adapter.verifyStock({
        materialDocument: '5000123458',
        materialDocumentYear: '2026',
        movementType: '311',
        material: '8000000023',
        quantity: 10,
        plant: '1120',
        storageLocation: 'HS01',
        receivingStorageLocation: 'CS01',
        initialSourceStock: 100,
        initialDestStock: 20
      })).rejects.toMatchObject({
        status: 400,
        stage: 'STOCK_VERIFICATION',
        message: expect.stringContaining('Destination SLoc stock did not increase')
      });
    });

    test('Movement 301: Verifies source plant/SLoc decreases and destination plant/SLoc increases', async () => {
      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        if (table === 'MATDOC' || table === 'MSEG') {
          return [{
            MBLNR: '5000123459',
            MJAHR: '2026',
            BWART: '301',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            UMWRK: '2000',
            UMLGO: '0001',
            MENGE: '8.000'
          }];
        }
        if (table === 'MARD') {
          const wStr = where.join(' ');
          if (wStr.includes('1120')) {
            return [{ LGORT: 'HS01', LABST: '42.000' }]; // Decreased from 50 to 42
          }
          if (wStr.includes('2000')) {
            return [{ LGORT: '0001', LABST: '18.000' }]; // Increased from 10 to 18
          }
        }
        return [];
      });

      const res = await adapter.verifyStock({
        materialDocument: '5000123459',
        materialDocumentYear: '2026',
        movementType: '301',
        material: '8000000023',
        quantity: 8,
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '2000',
        receivingStorageLocation: '0001',
        initialSourceStock: 50,
        initialDestStock: 10
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('STOCK_VERIFICATION');
      expect(res.movementType).toBe('301');
      expect(res.sourceStockDecreased).toBe(true);
      expect(res.destinationStockIncreased).toBe(true);
      expect(res.sourceStock.delta).toBe(-8);
      expect(res.destinationStock.delta).toBe(8);
      expect(res.comparison.expected.sourcePlantSLocDecreases).toBe(true);
      expect(res.comparison.expected.destinationPlantSLocIncreases).toBe(true);
      expect(res.comparison.matches).toBe(true);
    });

    test('Enforces timing: Only after MIGO succeeds (rejects missing material document)', async () => {
      await expect(adapter.verifyStock({
        materialDocument: '',
        movementType: '201'
      })).rejects.toMatchObject({
        status: 400,
        stage: 'STOCK_VERIFICATION',
        message: expect.stringContaining('Material Document is required for stock verification')
      });
    });

    test('postGoodsMovement() chains Step 10 and Step 11 automatically', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '5000999999',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      mockRfc.readTable.mockImplementation(async (table, fields, where = []) => {
        const whereStr = where.join(' ');
        if (table === 'MATDOC' || table === 'MSEG') {
          if (whereStr.includes('5000999999')) {
            return [{
              MBLNR: '5000999999',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '201',
              MATNR: '000000008000000023',
              WERKS: '1120',
              LGORT: 'HS01',
              MENGE: '5.000',
              SHKZG: 'H',
              KOSTL: '1011201301',
              RSNUM: '0000524980',
              RSPOS: '0001'
            }];
          }
          return [];
        }
        if (table === 'MARD') {
          return [{ LGORT: 'HS01', LABST: '95.000' }];
        }
        return [];
      });

      const res = await adapter.postGoodsMovement({
        reservationNo: '524980',
        reservationItem: '0001',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 5,
        unit: 'NOS',
        costCenter: '1011201301'
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('MIGO');
      expect(res.materialDocument).toBe('5000999999');
      expect(res.stockVerification).toBeDefined();
      expect(res.stockVerification.success).toBe(true);
      expect(res.stockVerification.stage).toBe('STOCK_VERIFICATION');
      expect(res.stockVerification.movementType).toBe('201');
      expect(res.stockVerification.comparison.matches).toBe(true);
    });

    test('TrToHandler verifyStock action executes and returns StockVerificationResult', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        verifyStock: jest.fn().mockResolvedValue({
          success: true,
          stage: 'STOCK_VERIFICATION',
          movementType: '201',
          materialDocument: '5000123456',
          materialDocumentYear: '2026',
          material: '8000000023',
          quantity: 5,
          consumedQuantity: 5,
          sourceStockDecreased: true,
          destinationStockIncreased: false,
          comparison: { matches: true },
          verified: true
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          materialDocument: '5000123456',
          materialDocumentYear: '2026',
          movementType: '201',
          material: '8000000023',
          quantity: 5,
          plant: '1120',
          storageLocation: 'HS01',
          costCenter: '1011201301'
        },
        error: jest.fn()
      };

      const result = await handlers.verifyStock(req);
      expect(result.success).toBe(true);
      expect(result.stage).toBe('STOCK_VERIFICATION');
      expect(result.sourceStockDecreased).toBe(true);
      expect(mockRes.verifyStock).toHaveBeenCalledWith(req.data);
    });
  });

  describe('9. Step 12: Add Reservation Verification (After MIGO: Read Reservation, Check Issued/Withdrawn, Remaining, and Completion Status)', () => {
    test('Complete issue: Requested = 10, Issued = 10, Remaining = 0 -> completelyProcessed = true, completionStatus = COMPLETED', async () => {
      mockRfc.readTable.mockImplementation(async (table, _fields, _where) => {
        if (table === 'RESB') {
          return [{
            RSNUM: '0000520235',
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            BDMNG: '10.000',
            ENMNG: '10.000',
            MEINS: 'NOS',
            KZEAR: '',
            XLOEK: ''
          }];
        }
        return [];
      });

      const res = await adapter.verifyReservation({
        reservationNumber: '520235',
        reservationItem: '0001'
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('RESERVATION_VERIFICATION');
      expect(res.reservationNumber).toBe('520235');
      expect(res.reservationItem).toBe('0001');
      expect(res.requestedQuantity).toBe(10);
      expect(res.issuedQuantity).toBe(10);
      expect(res.remainingQuantity).toBe(0);
      expect(res.completelyProcessed).toBe(true);
      expect(res.isComplete).toBe(true);
      expect(res.completionStatus).toBe('COMPLETED');
      expect(res.comparison).toEqual({
        requested: 10,
        issued: 10,
        remaining: 0,
        isComplete: true,
        status: 'COMPLETED'
      });
      expect(res.verified).toBe(true);
    });

    test('Partial issue: Requested = 10, Issued = 6, Remaining = 4 -> completelyProcessed = false, completionStatus = PARTIALLY_PROCESSED (application must NOT mark completely processed)', async () => {
      mockRfc.readTable.mockImplementation(async (table, _fields, _where) => {
        if (table === 'RESB') {
          return [{
            RSNUM: '0000520235',
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            BDMNG: '10.000',
            ENMNG: '6.000',
            MEINS: 'NOS',
            KZEAR: '',
            XLOEK: ''
          }];
        }
        return [];
      });

      const res = await adapter.verifyReservation({
        reservationNumber: '520235',
        reservationItem: '0001'
      });

      expect(res.success).toBe(true);
      expect(res.stage).toBe('RESERVATION_VERIFICATION');
      expect(res.requestedQuantity).toBe(10);
      expect(res.issuedQuantity).toBe(6);
      expect(res.remainingQuantity).toBe(4);
      expect(res.completelyProcessed).toBe(false);
      expect(res.isComplete).toBe(false);
      expect(res.completionStatus).toBe('PARTIALLY_PROCESSED');
      expect(res.comparison).toEqual({
        requested: 10,
        issued: 6,
        remaining: 4,
        isComplete: false,
        status: 'PARTIALLY_PROCESSED'
      });
    });

    test('Partial issue with KZEAR = X: Requested = 10, Issued = 6, Remaining = 4 but final issue set -> completelyProcessed = true, completionStatus = COMPLETED', async () => {
      mockRfc.readTable.mockImplementation(async (table, _fields, _where) => {
        if (table === 'RESB') {
          return [{
            RSNUM: '0000520235',
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            BDMNG: '10.000',
            ENMNG: '6.000',
            MEINS: 'NOS',
            KZEAR: 'X',
            XLOEK: ''
          }];
        }
        return [];
      });

      const res = await adapter.verifyReservation({
        reservationNumber: '520235',
        reservationItem: '0001'
      });

      expect(res.success).toBe(true);
      expect(res.requestedQuantity).toBe(10);
      expect(res.issuedQuantity).toBe(6);
      expect(res.remainingQuantity).toBe(4);
      expect(res.isFinalIssue).toBe(true);
      expect(res.completelyProcessed).toBe(true);
      expect(res.completionStatus).toBe('COMPLETED');
    });

    test('verifyReservation rejects missing reservation number with 400 Bad Request', async () => {
      await expect(adapter.verifyReservation({}))
        .rejects
        .toMatchObject({
          status: 400,
          stage: 'RESERVATION_VERIFICATION',
          message: expect.stringContaining('Reservation number is mandatory')
        });
    });

    test('verifyReservation rejects when reservation not found in SAP RESB transparent table', async () => {
      adapter._checkResbPersistence = true;
      mockRfc.readTable.mockResolvedValue([]);

      await expect(adapter.verifyReservation({ reservationNumber: '599999', reservationItem: '0001' }))
        .rejects
        .toMatchObject({
          status: 404,
          stage: 'RESERVATION_VERIFICATION',
          message: expect.stringContaining('Reservation 599999/0001 not found in SAP (RESB)')
        });
      adapter._checkResbPersistence = false;
    });

    test('postGoodsMovement() automatically chains Step 10, Step 11, and Step 12 for reservations', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '5000888888',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000888888 posted' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (table === 'MATDOC' && whereStr.includes("MBLNR = '5000888888'")) {
          return [{
            MBLNR: '5000888888',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '201',
            MATNR: '000000008000000023',
            MENGE: '6.000',
            WERKS: '1120',
            LGORT: 'HS01',
            RSNUM: '0000524980',
            RSPOS: '0001',
            KOSTL: '001011201301',
            SHKZG: 'H'
          }];
        }
        if (table === 'MATDOC') return []; // For idempotency check
        if (table === 'MARD') {
          return [{ LGORT: 'HS01', LABST: '94.000' }];
        }
        if (table === 'RESB') {
          return [{
            RSNUM: '0000524980',
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            BDMNG: '10.000',
            ENMNG: '6.000',
            MEINS: 'NOS',
            KZEAR: '',
            XLOEK: ''
          }];
        }
        return [];
      });

      const res = await adapter.postGoodsMovement({
        reservationNo: '524980',
        reservationItem: '0001',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 6,
        unit: 'NOS',
        costCenter: '1011201301'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('5000888888');

      // Step 10 verified
      expect(res.stage).toBe('MIGO');
      expect(res.materialDocumentYear).toBe('2026');

      // Step 11 verified
      expect(res.stockVerification).toBeDefined();
      expect(res.stockVerification.stage).toBe('STOCK_VERIFICATION');
      expect(res.stockVerification.success).toBe(true);

      // Step 12 verified
      expect(res.reservationVerification).toBeDefined();
      expect(res.reservationVerification.stage).toBe('RESERVATION_VERIFICATION');
      expect(res.reservationVerification.success).toBe(true);
      expect(res.reservationVerification.requestedQuantity).toBe(10);
      expect(res.reservationVerification.issuedQuantity).toBe(6);
      expect(res.reservationVerification.remainingQuantity).toBe(4);
      expect(res.reservationVerification.completelyProcessed).toBe(false);
      expect(res.reservationVerification.completionStatus).toBe('PARTIALLY_PROCESSED');
    });

    test('postGoodsMovement() without reservation leaves reservationVerification null', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '5000777777',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000777777 posted' }]
        })
        .mockResolvedValueOnce({});

      mockRfc.readTable.mockImplementation(async (table, fields, where) => {
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (table === 'MATDOC' && whereStr.includes("MBLNR = '5000777777'")) {
          return [{
            MBLNR: '5000777777',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '311',
            MATNR: '000000008000000023',
            MENGE: '5.000',
            WERKS: '1120',
            LGORT: 'HS01',
            SHKZG: 'H'
          }];
        }
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS02' }];
        if (table === 'MARD') return [{ LGORT: 'HS01', LABST: '50.000' }];
        return [];
      });

      const res = await adapter.postGoodsMovement({
        movementType: '311',
        plant: '1120',
        sourceStorageLocation: 'HS01',
        destinationStorageLocation: 'HS02',
        material: '8000000023',
        quantity: 5,
        unit: 'NOS'
      });

      expect(res.success).toBe(true);
      expect(res.materialDocument).toBe('5000777777');
      expect(res.reservationVerification).toBeNull();
    });

    test('TrToHandler verifyReservation action executes and returns ReservationVerificationResult', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        verifyReservation: jest.fn().mockResolvedValue({
          success: true,
          stage: 'RESERVATION_VERIFICATION',
          reservationNumber: '520235',
          reservationItem: '0001',
          requestedQuantity: 10,
          issuedQuantity: 6,
          remainingQuantity: 4,
          completelyProcessed: false,
          isComplete: false,
          completionStatus: 'PARTIALLY_PROCESSED',
          verified: true
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          reservationNumber: '520235',
          reservationItem: '0001'
        },
        error: jest.fn()
      };

      const result = await handlers.verifyReservation(req);
      expect(result.success).toBe(true);
      expect(result.stage).toBe('RESERVATION_VERIFICATION');
      expect(result.completelyProcessed).toBe(false);
      expect(result.completionStatus).toBe('PARTIALLY_PROCESSED');
      expect(mockRes.verifyReservation).toHaveBeenCalledWith(req.data);
    });
  });

  describe('10. Step 13: One Common Process Orchestrator (executeReservationWarehouseFlow)', () => {
    test('State machine full execution: RESERVATION_CREATED -> TR_CREATED -> TR_VERIFIED -> TO_CREATED -> TO_CONFIRMED -> MIGO_POSTED -> STOCK_VERIFIED -> RESERVATION_VERIFIED -> COMPLETED', async () => {
      setupDefaultFmCalls();
      setupDefaultReadTable();

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.currentState).toBe('COMPLETED');
      expect(result.completed).toBe(true);
      expect(result.stages).toEqual([
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED',
        'TO_CONFIRMED',
        'MIGO_POSTED',
        'STOCK_VERIFIED',
        'RESERVATION_VERIFIED',
        'COMPLETED'
      ]);

      // Stage outputs verified
      expect(result.reservation.reservationNo).toBe('520235');
      expect(result.tr.trNumber).toBe('1000850');
      expect(result.verifiedTR.trNumber).toBe('1000850');
      expect(result.verifiedTR.status).toBe('O');
      expect(result.to.toNumber).toBe('1037299');
      expect(result.confirmation.confirmed).toBe(true);
      expect(result.migo.materialDocument).toBe('5000999999');
      expect(result.stock.success).toBe(true);
      expect(result.finalReservation.completelyProcessed).toBe(true);
      expect(result.finalReservation.completionStatus).toBe('COMPLETED');
    });

    test('Partial issue flow: Requested = 10, Issued = 6, Remaining = 4 -> PARTIALLY_PROCESSED, completed = false', async () => {
      setupDefaultFmCalls({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000850',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: 6,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: '311'
          }]
        })
      });
      setupDefaultReadTable({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001037299',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: () => [{
          MBLNR: '5000999999',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '201',
          MATNR: '000000008000000023',
          MENGE: '6.000',
          WERKS: '1120',
          LGORT: 'HS01',
          RSNUM: '0000520235',
          RSPOS: '0001',
          KOSTL: '001011201301',
          SHKZG: 'H'
        }],
        RESB: () => [{
          RSNUM: '0000520235',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'NOS',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 6,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe('PARTIALLY_PROCESSED');
      expect(result.currentState).toBe('PARTIALLY_PROCESSED');
      expect(result.completed).toBe(false);
      expect(result.stages).not.toContain('COMPLETED');
      expect(result.finalReservation.remainingQuantity).toBe(4);
      expect(result.finalReservation.completelyProcessed).toBe(false);
    });

    test('Stage failure: RESERVATION failure returns fail("RESERVATION", reservation)', async () => {
      setupDefaultFmCalls({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Material blocked');
        }
      });
      setupDefaultReadTable();

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.currentState).toBe('RESERVATION');
      expect(result.error).toContain('Material blocked');
      expect(result.stages).toEqual([]);
    });

    test('Stage failure: TR failure returns fail("TR", tr)', async () => {
      setupDefaultFmCalls({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed: Storage type not defined');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed: Storage type not defined');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed: Storage type not defined');
        }
      });
      setupDefaultReadTable();

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR');
      expect(result.currentState).toBe('TR');
      expect(result.reservation).toBeDefined();
      expect(result.reservation.reservationNo).toBe('520235');
      expect(result.stages).toEqual(['RESERVATION_CREATED']);
    });

    test('Stage failure: TR_VERIFICATION failure returns fail("TR_VERIFICATION", verifiedTR)', async () => {
      setupDefaultFmCalls();
      setupDefaultReadTable({
        LTBK: () => [] // TR not found in SAP
      });

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR_VERIFICATION');
      expect(result.currentState).toBe('TR_VERIFICATION');
      expect(result.reservation).toBeDefined();
      expect(result.tr).toBeDefined();
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED']);
    });

    test('Stage failure: TO failure returns fail("TO", to)', async () => {
      setupDefaultFmCalls({
        L_TO_CREATE_TR: () => {
          throw new Error('L_TO_CREATE_TR failed: No quants available in source storage bin');
        },
        ZWM_TO_CREATE_FROM_TR: () => {
          throw new Error('ZWM_TO_CREATE_FROM_TR failed: No quants available in source storage bin');
        },
        Z_WM_TO_CREATE_FROM_TR: () => {
          throw new Error('Z_WM_TO_CREATE_FROM_TR failed: No quants available in source storage bin');
        }
      });
      setupDefaultReadTable();

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO');
      expect(result.currentState).toBe('TO');
      expect(result.reservation).toBeDefined();
      expect(result.tr).toBeDefined();
      expect(result.verifiedTR).toBeDefined();
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED']);
    });

    test('Stage failure: TO_CONFIRMATION failure returns fail("TO_CONFIRMATION", confirmation)', async () => {
      setupDefaultFmCalls({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Differences exist');
        }
      });
      setupDefaultReadTable();

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO_CONFIRMATION');
      expect(result.currentState).toBe('TO_CONFIRMATION');
      expect(result.to).toBeDefined();
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED']);
    });

    test('Stage failure: MIGO failure returns fail("MIGO", migo)', async () => {
      setupDefaultFmCalls({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('BAPI_GOODSMVT_CREATE failed: Posting period 10/2026 is closed');
        }
      });
      setupDefaultReadTable();

      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      });

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.currentState).toBe('MIGO');
      expect(result.confirmation).toBeDefined();
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('verifyTR rejects missing trNumber', async () => {
      await expect(adapter.verifyTR({}))
        .rejects
        .toMatchObject({
          status: 400,
          stage: 'TR_VERIFICATION',
          message: expect.stringContaining('Transfer Requirement (trNumber) is mandatory')
        });
    });

    test('verifyTR rejects completed TR (STATU = E)', async () => {
      setupDefaultReadTable({
        LTBK: () => [{
          LGNUM: 'W01',
          TBNUM: '0001000850',
          BWLVS: '201',
          STATU: 'E',
          RSNUM: '0000520235'
        }]
      });

      await expect(adapter.verifyTR({ trNumber: '1000850', warehouseNumber: 'W01' }))
        .rejects
        .toMatchObject({
          status: 400,
          stage: 'TR_VERIFICATION',
          message: expect.stringContaining('already completed in SAP (STATU = E)')
        });
    });

    test('Adapter helper aliases createTR, createTO, confirmTO, postMigo are defined and callable', async () => {
      expect(typeof adapter.createTR).toBe('function');
      expect(typeof adapter.createTO).toBe('function');
      expect(typeof adapter.confirmTO).toBe('function');
      expect(typeof adapter.postMigo).toBe('function');
      expect(typeof adapter.verifyTR).toBe('function');
    });

    test('TrToHandler executeReservationWarehouseFlow action executes and returns OrchestratorProcessResult', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        executeReservationWarehouseFlow: jest.fn().mockResolvedValue({
          success: true,
          state: 'COMPLETED',
          currentState: 'COMPLETED',
          completed: true,
          stages: ['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED', 'MIGO_POSTED', 'STOCK_VERIFIED', 'RESERVATION_VERIFIED', 'COMPLETED'],
          reservation: { reservationNo: '520235', reservationItem: '0001' },
          tr: { trNumber: '1000850', trItem: '0001' },
          verifiedTR: { trNumber: '1000850' },
          to: { toNumber: '1037299', toItem: '0001' },
          confirmation: { confirmed: true },
          migo: { materialDocument: '5000999999', materialDocumentYear: '2026' },
          stock: { success: true, verified: true },
          finalReservation: { success: true, verified: true, completelyProcessed: true }
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          movementType: '201',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 10,
          unit: 'NOS',
          costCenter: '1011201301',
          warehouseNumber: 'W01'
        },
        error: jest.fn()
      };

      const result = await handlers.executeReservationWarehouseFlow(req);
      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.currentState).toBe('COMPLETED');
      expect(result.completed).toBe(true);
      expect(result.reservationNumber).toBe('520235');
      expect(result.trNumber).toBe('1000850');
      expect(result.toNumber).toBe('1037299');
      expect(result.toConfirmed).toBe(true);
      expect(result.materialDocument).toBe('5000999999');
      expect(result.stockVerified).toBe(true);
      expect(result.completelyProcessed).toBe(true);
      expect(mockRes.executeReservationWarehouseFlow).toHaveBeenCalledWith(expect.objectContaining(req.data));
    });
  });

  describe('11. Step 14: Persistent Process Status across Lifecycle', () => {
    test('Happy path persists and returns PROCESS_STATUS progression ending in COMPLETED', async () => {
      setupDefaultFmCalls();
      setupDefaultReadTable();

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(true);
      expect(result.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(persistedStatuses).toEqual([
        'CREATED',
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED',
        'TO_CONFIRMED',
        'MIGO_POSTED',
        'STOCK_VERIFIED',
        'COMPLETED'
      ]);
    });

    test('Partial issue persists and returns PROCESS_STATUS.PARTIALLY_PROCESSED', async () => {
      setupDefaultFmCalls({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000850',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: 6,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: '311'
          }]
        })
      });
      setupDefaultReadTable({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001037299',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: () => [{
          MBLNR: '5000999999',
          MJAHR: '2026',
          ZEILE: '0001',
          BWART: '201',
          MATNR: '000000008000000023',
          MENGE: '6.000',
          WERKS: '1120',
          LGORT: 'HS01',
          RSNUM: '0000520235',
          RSPOS: '0001',
          KOSTL: '001011201301',
          SHKZG: 'H'
        }],
        RESB: () => [{
          RSNUM: '0000520235',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'NOS',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 6,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(true);
      expect(result.processStatus).toBe('PARTIALLY_PROCESSED');
      expect(persistedStatuses).toEqual([
        'CREATED',
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED',
        'TO_CONFIRMED',
        'MIGO_POSTED',
        'STOCK_VERIFIED',
        'PARTIALLY_PROCESSED'
      ]);
    });

    test('Reservation failure persists and returns FAILED_RESERVATION', async () => {
      setupDefaultFmCalls({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('Cost center 1011201301 locked');
        }
      });
      setupDefaultReadTable();

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(false);
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(persistedStatuses).toEqual(['CREATED', 'FAILED_RESERVATION']);
    });

    test('TR failure persists and returns FAILED_TR', async () => {
      setupDefaultFmCalls({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed');
        }
      });
      setupDefaultReadTable();

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(false);
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(persistedStatuses).toEqual(['CREATED', 'RESERVATION_CREATED', 'FAILED_TR']);
    });

    test('TO failure persists and returns FAILED_TO', async () => {
      setupDefaultFmCalls({
        L_TO_CREATE_TR: () => {
          throw new Error('No bins available');
        },
        ZWM_TO_CREATE_FROM_TR: () => {
          throw new Error('No bins available');
        },
        Z_WM_TO_CREATE_FROM_TR: () => {
          throw new Error('No bins available');
        }
      });
      setupDefaultReadTable();

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(false);
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TO);
      expect(persistedStatuses).toEqual(['CREATED', 'RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'FAILED_TO']);
    });

    test('TO confirmation failure persists and returns FAILED_CONFIRMATION', async () => {
      setupDefaultFmCalls({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Differences exist');
        }
      });
      setupDefaultReadTable();

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(false);
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(persistedStatuses).toEqual([
        'CREATED',
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED',
        'FAILED_CONFIRMATION'
      ]);
    });

    test('MIGO failure persists and returns FAILED_MIGO', async () => {
      setupDefaultFmCalls({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('Posting deficit of BA Unrestricted-use');
        }
      });
      setupDefaultReadTable();

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(false);
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(persistedStatuses).toEqual([
        'CREATED',
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED',
        'TO_CONFIRMED',
        'FAILED_MIGO'
      ]);
    });

    test('Stock verification failure persists and returns FAILED_STOCK_VERIFICATION', async () => {
      setupDefaultFmCalls();
      setupDefaultReadTable({
        MARD: () => [{ LGORT: 'HS01', LABST: '105.000' }] // Stock increased instead of decreased
      });

      const persistedStatuses = [];
      const result = await adapter.executeReservationWarehouseFlow({
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01',
        initialSourceStock: 100,
        persistStatus: (status) => {
          persistedStatuses.push(status);
        }
      });

      expect(result.success).toBe(false);
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_STOCK_VERIFICATION);
      expect(persistedStatuses).toEqual([
        'CREATED',
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED',
        'TO_CONFIRMED',
        'MIGO_POSTED',
        'FAILED_STOCK_VERIFICATION'
      ]);
    });
  });

  describe('12. Step 15: Add Idempotency Protection', () => {
    test('buildMigoBusinessKey constructs normalized key components and formatted string', () => {
      const bKey = adapter.buildMigoBusinessKey({
        reservationNumber: '0000520235',
        reservationItem: '0001',
        transferOrder: '0001037299',
        processId: 'E5B42701-1111-4222-8333-000000000000'
      });

      expect(bKey).toEqual({
        reservationNo: '0000520235',
        reservationItem: '0001',
        transferOrder: '0001037299',
        processId: 'E5B42701-1111-4222-8333-000000000000',
        key: 'RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000000'
      });
    });

    test('buildMigoBusinessKey handles missing / partial parameters safely', () => {
      const bKey = adapter.buildMigoBusinessKey({});
      expect(bKey).toEqual({
        reservationNo: '',
        reservationItem: '0001',
        transferOrder: '',
        processId: '',
        key: 'RES:NONE/1#TO:NONE#PID:NONE'
      });
    });

    test('Browser timeout retry simulation: returns existing material document and does NOT call BAPI_GOODSMVT_CREATE twice', async () => {
      setupDefaultFmCalls();
      setupDefaultReadTable();

      const bapiCalls = [];
      mockRfc.call.mockImplementation(async (fm, params) => {
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiCalls.push(params);
          return {
            MATERIALDOCUMENT: '5000999999',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT') return {};
        return {};
      });

      const processId = 'E5B42701-1111-4222-8333-000000000001';
      const requestParams = {
        reservationNo: '0000520235',
        reservationItem: '0001',
        transferOrder: '0001037299',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        processId
      };

      // 1. Initial attempt: TO confirmed -> MIGO posted
      const firstResult = await adapter.postGoodsMovement(requestParams);
      expect(firstResult.success).toBe(true);
      expect(firstResult.materialDocument).toBe('5000999999');
      expect(firstResult.alreadyPosted).toBe(false);
      expect(firstResult.idempotentRetry).toBe(false);
      expect(bapiCalls.length).toBe(1);

      // Now simulate MATDOC returning this document for the processId (as SAP would persist it)
      setupDefaultReadTable({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${processId}'`) || whereStr.includes("RSNUM = '0000520235'")) {
            return [{
              MBLNR: '5000999999',
              MJAHR: '2026',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520235',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      // 2. Retry after timeout: user clicks submit again with same processId and params
      const retryResult = await adapter.postGoodsMovement(requestParams);

      expect(retryResult.success).toBe(true);
      expect(retryResult.materialDocument).toBe('5000999999');
      expect(retryResult.alreadyPosted).toBe(true);
      expect(retryResult.idempotentRetry).toBe(true);
      expect(retryResult.businessKey).toContain('E5B42701-1111-4222-8333-000000000001');
      // CRITICAL: Stock is NOT consumed twice! BAPI_GOODSMVT_CREATE was NOT called a second time!
      expect(bapiCalls.length).toBe(1);
    });

    test('Persistent CAP DB (ReservationTrack) check returns existing document without SAP query', async () => {
      setupDefaultFmCalls();
      setupDefaultReadTable();

      const origCds = global.cds;
      try {
        global.cds = {
          db: {
            run: jest.fn().mockResolvedValue({
              ReservationNo: '0000520235',
              ReservationItem: '0001',
              TransferOrder: '0001037299',
              ProcessId: 'E5B42701-1111-4222-8333-000000000002',
              MaterialDocument: '5000888888',
              MaterialDocYear: '2026',
              Status_code: '05'
            })
          },
          ql: {
            SELECT: {
              one: {
                from: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({})
                })
              }
            }
          }
        };

        const idempotency = await adapter.checkMigoIdempotency({
          reservationNumber: '0000520235',
          reservationItem: '0001',
          transferOrder: '0001037299',
          processId: 'E5B42701-1111-4222-8333-000000000002'
        });

        expect(idempotency.alreadyPosted).toBe(true);
        expect(idempotency.materialDocument).toBe('5000888888');
        expect(idempotency.materialDocumentYear).toBe('2026');
        expect(idempotency.source).toBe('DB');
        expect(idempotency.businessKey).toBe('RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000002');
      } finally {
        global.cds = origCds;
      }
    });

    test('SAP MATDOC transparent table query detects committed document and filters cancelled documents', async () => {
      setupDefaultFmCalls();

      // Case A: Valid uncancelled document in MATDOC
      setupDefaultReadTable({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("SGTXT = 'E5B42701-1111-4222-8333-000000000003'") && whereStr.includes("CANCELLED = ''")) {
            return [{
              MBLNR: '5000777777',
              MJAHR: '2026',
              BWART: '201'
            }];
          }
          return [];
        }
      });

      const validCheck = await adapter.checkMigoIdempotency({
        reservationNumber: '0000520235',
        reservationItem: '0001',
        transferOrder: '0001037299',
        processId: 'E5B42701-1111-4222-8333-000000000003'
      });
      expect(validCheck.alreadyPosted).toBe(true);
      expect(validCheck.materialDocument).toBe('5000777777');
      expect(validCheck.source).toBe('SAP');

      // Case B: Cancelled document in MATDOC should NOT be treated as already posted
      setupDefaultReadTable({
        MATDOC: () => [] // Cancelled filter returns empty
      });

      const cancelledCheck = await adapter.checkMigoIdempotency({
        reservationNumber: '0000520235',
        reservationItem: '0001',
        transferOrder: '0001037299',
        processId: 'E5B42701-1111-4222-8333-000000000004'
      });
      expect(cancelledCheck.alreadyPosted).toBe(false);
    });

    test('Subsequent partial issue with a new TO and fresh ProcessId is NOT blocked by idempotency', async () => {
      setupDefaultFmCalls();
      const bapiCalls = [];
      mockRfc.call.mockImplementation(async (fm, params) => {
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiCalls.push(params);
          return {
            MATERIALDOCUMENT: '5000999992',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document posted' }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT') return {};
        return {};
      });

      setupDefaultReadTable({
        MATDOC: (fields, where, whereStr) => {
          // Only matches previous TO / process ID, not the new one
          if (whereStr.includes("SGTXT = 'E5B42701-1111-4222-8333-000000000005'")) {
            return [{ MBLNR: '5000999991', MJAHR: '2026', BWART: '201' }];
          }
          return [];
        }
      });

      // Partial Issue 2 with new TO and new ProcessId
      const partial2Result = await adapter.postGoodsMovement({
        reservationNo: '0000520235',
        reservationItem: '0001',
        transferOrder: '0001037300', // newly created TO for remaining quantity
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 4,
        unit: 'NOS',
        costCenter: '1011201301',
        processId: 'E5B42701-1111-4222-8333-000000000006' // fresh process ID
      });

      expect(partial2Result.success).toBe(true);
      expect(partial2Result.materialDocument).toBe('5000999992');
      expect(partial2Result.alreadyPosted).toBe(false);
      expect(partial2Result.idempotentRetry).toBe(false);
      expect(bapiCalls.length).toBe(1);
    });

    test('TrToHandler handlePostMigoGoodsMovement returns idempotency fields and writes MigoBusinessKey', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        checkAuthorization: jest.fn().mockResolvedValue(true),
        postGoodsMovement: jest.fn().mockResolvedValue({
          success: true,
          materialDocument: '5000999999',
          materialDocYear: '2026',
          movementType: '201',
          alreadyPosted: true,
          idempotentRetry: true,
          businessKey: 'RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000007',
          stockEffect: 'Stock consumed to Cost Center 1011201301'
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          ReservationNo: '520235',
          ReservationItem: '0001',
          TransferOrder: '1037299',
          MovementType: '201',
          Material: '8000000023',
          Plant: '1120',
          StorageLocation: 'HS01',
          Quantity: 10,
          Unit: 'NOS',
          CostCenter: '1011201301',
          ProcessId: 'E5B42701-1111-4222-8333-000000000007'
        },
        error: jest.fn()
      };

      const result = await handlers.postMigoGoodsMovement(req);
      expect(result.success).toBe(true);
      expect(result.materialDocument).toBe('5000999999');
      expect(result.alreadyPosted).toBe(true);
      expect(result.idempotentRetry).toBe(true);
      expect(result.businessKey).toBe('RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000007');
      expect(result.Message).toContain('already existed for this process step; not posted again');
    });

    test('TrToHandler handleExecuteOrchestrator propagates alreadyPosted, idempotentRetry, and businessKey', async () => {
      const handlers = {};
      const mockAdapter = {};
      const mockRes = {
        executeReservationWarehouseFlow: jest.fn().mockResolvedValue({
          success: true,
          state: 'COMPLETED',
          currentState: 'COMPLETED',
          completed: true,
          stages: ['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED', 'MIGO_POSTED', 'STOCK_VERIFIED', 'RESERVATION_VERIFIED', 'COMPLETED'],
          reservation: { reservationNo: '520235', reservationItem: '0001' },
          tr: { trNumber: '1000850', trItem: '0001' },
          to: { toNumber: '1037299', toItem: '0001' },
          confirmation: { confirmed: true },
          migo: {
            materialDocument: '5000999999',
            materialDocumentYear: '2026',
            alreadyPosted: true,
            idempotentRetry: true,
            businessKey: 'RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000008'
          },
          alreadyPosted: true,
          idempotentRetry: true,
          businessKey: 'RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000008',
          stock: { success: true, verified: true },
          finalReservation: { success: true, verified: true, completelyProcessed: true }
        })
      };

      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter: mockAdapter, resProcessAdapter: mockRes }
      );

      const req = {
        data: {
          reservationNumber: '520235',
          reservationItem: '0001',
          transferOrder: '1037299',
          processId: 'E5B42701-1111-4222-8333-000000000008'
        },
        error: jest.fn()
      };

      const result = await handlers.executeReservationWarehouseFlow(req);
      expect(result.success).toBe(true);
      expect(result.alreadyPosted).toBe(true);
      expect(result.idempotentRetry).toBe(true);
      expect(result.businessKey).toBe('RES:520235/1#TO:1037299#PID:E5B42701-1111-4222-8333-000000000008');
      expect(result.materialDocument).toBe('5000999999');
    });
  });
});
