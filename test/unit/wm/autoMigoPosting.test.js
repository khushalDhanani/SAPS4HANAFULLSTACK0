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

describe('Chunk 5: Step 3 Auto MIGO Posting & Retry', () => {
  let mockRfc;
  let adapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(),
      readTable: jest.fn().mockResolvedValue([]) // RESB / LTAP / MARC reads: nothing found, material not batch-managed
    };
    adapter = new ReservationProcessAdapter({ rfc: mockRfc });
  });

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
});
