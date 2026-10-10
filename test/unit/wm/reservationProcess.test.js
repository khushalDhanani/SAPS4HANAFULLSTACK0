'use strict';

/**
 * Unit Test Suite for Chunk 2: Backend Function Wrappers (ZCL_RES_PROCESS & ReservationProcessAdapter)
 * Tests each method in isolation and per movement type:
 *   - createReservation (BAPI_RESERVATION_CREATE1) for 201, 241, 311, 301
 *   - createTransferRequirement (L_TR_CREATE)
 *   - createTransferOrderFromTR (L_TO_CREATE_TR)
 *   - confirmTransferOrder (L_TO_CONFIRM)
 *   - postGoodsMovement (BAPI_GOODSMVT_CREATE)
 *   - Input validation & error handling
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

describe('Chunk 2: Backend Function Wrappers (ZCL_RES_PROCESS)', () => {
  let mockRfc;
  let adapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn()
    };
    adapter = new ReservationProcessAdapter({ rfc: mockRfc });
  });

  describe('1. createReservation (BAPI_RESERVATION_CREATE1)', () => {
    test('Movement 311: SLoc to SLoc transfer creates reservation', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '0000524979',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 0000524979 created' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const result = await adapter.createReservation({
        movementType: '311',
        plant: '1120',
        storageLocation: 'HS01',
        receivingStorageLocation: 'CS01',
        material: '000000008000000023',
        quantity: 1,
        unit: 'NOS'
      });

      expect(result.success).toBe(true);
      expect(result.reservationNo).toBe('524979');
      expect(result.status).toBe('01');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '311',
            MOVE_STLOC: 'CS01'
          }),
          RESERVATIONITEMS: expect.arrayContaining([
            expect.objectContaining({
              MATERIAL: '000000008000000023',
              PLANT: '1120',
              STGE_LOC: 'HS01',
              ENTRY_QNT: 1,
              ENTRY_UOM: 'NOS'
            })
          ])
        })
      );
    });

    test('Movement 201: GI to Cost Center passes COSTCENTER', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '0000524980',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 0000524980 created' }]
        })
        .mockResolvedValueOnce({});

      const result = await adapter.createReservation({
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000000023',
        quantity: 5,
        costCenter: '1011201301'
      });

      expect(result.success).toBe(true);
      expect(result.reservationNo).toBe('524980');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '201',
            COSTCENTER: '1011201301'
          })
        })
      );
    });

    test('Movement 241: GI to Asset passes ASSET_NO and SUB_NUMBER', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '0000524981',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 0000524981 created' }]
        })
        .mockResolvedValueOnce({});

      const result = await adapter.createReservation({
        movementType: '241',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000000023',
        quantity: 1,
        assetNo: '000000400092',
        subNumber: '0000'
      });

      expect(result.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '241',
            ASSET_NO: '000000400092',
            SUB_NUMBER: '0000'
          })
        })
      );
    });

    test('Movement 301: Transfer Plant to Plant passes MOVE_PLANT', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '0000524982',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 0000524982 created' }]
        })
        .mockResolvedValueOnce({});

      const result = await adapter.createReservation({
        movementType: '301',
        plant: '1120',
        storageLocation: 'HS01',
        receivingPlant: '1130',
        material: '8000000023',
        quantity: 2
      });

      expect(result.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '301',
            MOVE_PLANT: '1130'
          })
        })
      );
    });

    test('Simulation mode (testrun = true) passes TESTRUN and skips commit', async () => {
      mockRfc.call.mockResolvedValueOnce({
        RESERVATION: '',
        RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '529', MESSAGE: 'Reservation can be created' }]
      });

      const result = await adapter.createReservation({
        movementType: '311',
        plant: '1120',
        material: '8000000023',
        quantity: 1,
        testrun: true
      });

      expect(result.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({ TESTRUN: 'X' })
      );
      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_TRANSACTION_COMMIT', expect.anything());
    });
  });

  describe('2. createTransferRequirement (L_TR_CREATE)', () => {
    test('Creates Transfer Requirement from reservation details', async () => {
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [
          {
            LGNUM: 'W01',
            BWLVS: '311',
            TBNUM: '0001001839',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGA: 1,
            ALTME: 'NOS',
            RSNUM: '0000524979',
            RSPOS: '0001'
          }
        ]
      });

      const result = await adapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '311',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'NOS',
        reservationNo: '524979'
      });

      expect(result.success).toBe(true);
      expect(result.trNumber).toBe('1001839');
      expect(result.status).toBe('02');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'L_TR_CREATE',
        expect.objectContaining({
          I_COMMIT_WORK: 'X',
          T_LTBA: [
            expect.objectContaining({
              LGNUM: 'W01',
              BWLVS: '311',
              RSNUM: '0000524979',
              RSPOS: '0001'
            })
          ]
        })
      );
    });

    test('Falls back to ZWM_TR_CREATE wrapper when L_TR_CREATE throws', async () => {
      mockRfc.call
        .mockRejectedValueOnce(new Error('Incompatible Call Rejected, see note 2295840'))
        .mockResolvedValueOnce({
          EV_TBNUM: '0001001839',
          EV_TBPOS: '0001',
          EV_SUCCESS: 'S'
        });

      const result = await adapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '311',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'NOS',
        reservationNo: '524979'
      });

      expect(result.success).toBe(true);
      expect(result.trNumber).toBe('1001839');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'ZWM_TR_CREATE',
        expect.objectContaining({
          IV_LGNUM: 'W01',
          IV_BWLVS: '311',
          IV_RSNUM: '0000524979',
          IV_RSPOS: '0001'
        })
      );
    });

    test('Throws classified UCON Note 2295840 error when L_TR_CREATE is blacklisted and wrapper is unavailable', async () => {
      mockRfc.call
        .mockRejectedValueOnce(new Error('Incompatible Call Rejected, see note 2295840; Called Incompatible Function :L_TR_CREATE'))
        .mockRejectedValueOnce(new Error('Function ZWM_TR_CREATE not found'));

      await expect(
        adapter.createTransferRequirement({
          warehouseNumber: 'W01',
          wmMovementType: '311',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 1,
          unit: 'NOS',
          reservationNo: '524979'
        })
      ).rejects.toThrow(/restricted under SAP Note 2295840/);
    });
  });

  describe('3. createTransferOrderFromTR (L_TO_CREATE_TR)', () => {
    test('Creates Transfer Order from TR number', async () => {
      mockRfc.call.mockResolvedValueOnce({
        E_TANUM: '0001012966'
      });

      const result = await adapter.createTransferOrderFromTR({
        warehouseNumber: 'W01',
        trNumber: '1001839'
      });

      expect(result.success).toBe(true);
      expect(result.toNumber).toBe('1012966');
      expect(result.status).toBe('03');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'L_TO_CREATE_TR',
        expect.objectContaining({
          I_LGNUM: 'W01',
          I_TBNUM: '0001001839',
          I_COMMIT_WORK: 'X'
        })
      );
    });

    test('Falls back to ZWM_TO_CREATE_FROM_TR wrapper when L_TO_CREATE_TR throws', async () => {
      mockRfc.call
        .mockRejectedValueOnce(new Error('UCON blocked'))
        .mockResolvedValueOnce({
          EV_TANUM: '0001012966',
          EV_SUCCESS: 'S'
        });

      const result = await adapter.createTransferOrderFromTR({
        warehouseNumber: 'W01',
        trNumber: '1001839'
      });

      expect(result.success).toBe(true);
      expect(result.toNumber).toBe('1012966');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'ZWM_TO_CREATE_FROM_TR',
        expect.objectContaining({
          IV_LGNUM: 'W01',
          IV_TBNUM: '0001001839'
        })
      );
    });
  });

  describe('4. confirmTransferOrder (L_TO_CONFIRM)', () => {
    test('Confirms Transfer Order with squit = X', async () => {
      mockRfc.call.mockResolvedValueOnce({});

      const result = await adapter.confirmTransferOrder({
        warehouseNumber: 'W01',
        toNumber: '1012966'
      });

      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.status).toBe('04');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'L_TO_CONFIRM',
        expect.objectContaining({
          I_LGNUM: 'W01',
          I_TANUM: '0001012966',
          I_SQUIT: 'X',
          I_COMMIT_WORK: 'X'
        })
      );
    });
  });

  describe('5. postGoodsMovement (BAPI_GOODSMVT_CREATE)', () => {
    test('Posts Goods Movement MIGO against reservation', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          MATERIALDOCUMENT: '4900050128',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050128 posted' }]
        })
        .mockResolvedValueOnce({});

      const result = await adapter.postGoodsMovement({
        reservationNo: '524979',
        movementType: '311',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        receivingStorageLocation: 'CS01',
        quantity: 1,
        unit: 'NOS'
      });

      expect(result.success).toBe(true);
      expect(result.materialDocument).toBe('4900050128');
      expect(result.materialDocYear).toBe('2026');
      expect(result.status).toBe('05');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '06' },
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '311',
              RESERV_NO: '0000524979',
              RES_ITEM: '0001'
            })
          ]
        })
      );
    });
  });

  describe('6. Validation & Error Handling', () => {
    test('createReservation throws 400 when mandatory fields are missing', async () => {
      await expect(adapter.createReservation({})).rejects.toMatchObject({ status: 400 });
      await expect(adapter.createReservation({ movementType: '311' })).rejects.toMatchObject({ status: 400 });
      await expect(adapter.createReservation({ movementType: '311', plant: '1120', material: '123', quantity: 0 })).rejects.toMatchObject({ status: 400 });
    });

    test('createReservation throws 400 when BAPI returns error message', async () => {
      mockRfc.call.mockResolvedValueOnce({
        RESERVATION: '',
        RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Deficit of BA Unrestricted-use stock' }]
      });

      await expect(
        adapter.createReservation({
          movementType: '311',
          plant: '1120',
          material: '8000000023',
          quantity: 999999
        })
      ).rejects.toThrow('Deficit of BA Unrestricted-use stock');
    });

    test('createTransferOrderFromTR throws 400 when trNumber is missing', async () => {
      await expect(adapter.createTransferOrderFromTR({ warehouseNumber: 'W01' })).rejects.toMatchObject({ status: 400 });
    });

    test('confirmTransferOrder throws 400 when toNumber is missing', async () => {
      await expect(adapter.confirmTransferOrder({ warehouseNumber: 'W01' })).rejects.toMatchObject({ status: 400 });
    });

    test('postGoodsMovement throws 400 when reservationNo is missing', async () => {
      await expect(adapter.postGoodsMovement({ movementType: '311', material: '123', quantity: 1 })).rejects.toMatchObject({ status: 400 });
    });
  });
});
