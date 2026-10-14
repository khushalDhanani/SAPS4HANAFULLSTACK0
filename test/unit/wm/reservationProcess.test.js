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
      call: jest.fn(),
      readTable: jest.fn((table) => Promise.resolve(
        table === 'MARD' ? [{ LGORT: 'HS01' }, { LGORT: 'CS01' }] :
        table === 'T320' ? [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }, { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }] :
        table === 'LTBK' ? [{ LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979', STATU: '02' }] :
        []
      )) // MARD, T320, and LTBK preflight mock
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
        unit: 'NOS',
        quantity: 5,
        costCenter: '1011201301'
      });

      expect(result.success).toBe(true);
      expect(result.reservationNo).toBe('524980');
      expect(result.reservation).toEqual({
        number: '524980',
        item: '0001'
      });
      expect(result.movementType).toBe('201');
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
        unit: 'NOS',
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
        receivingStorageLocation: 'CS01',
        material: '8000000023',
        unit: 'NOS',
        quantity: 2
      });

      expect(result.success).toBe(true);
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '301',
            MOVE_PLANT: '1130',
            MOVE_STLOC: 'CS01'
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
        storageLocation: 'HS01',
        receivingStorageLocation: 'CS01',
        material: '8000000023',
        unit: 'NOS',
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

    test('Surfaces SAP\'s own rejection of L_TR_CREATE unchanged when no wrapper creates a TR (caller records status 11)', async () => {
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
      ).rejects.toThrow('Incompatible Call Rejected, see note 2295840; Called Incompatible Function :L_TR_CREATE');
    });

    test('when WM_TR_REAL_MOVEMENT is false (default), keeps BWLVS 311 substitution for 201 and 241 [mock only, not SAP verification]', async () => {
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [{ TBNUM: '0001001839', TBPOS: '0001' }]
      });

      await adapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'NOS',
        reservationNo: '524979',
        costCenter: '1011201301'
      });

      expect(mockRfc.call).toHaveBeenCalledWith(
        'L_TR_CREATE',
        expect.objectContaining({
          T_LTBA: [
            expect.objectContaining({
              BWLVS: '311'
            })
          ]
        })
      );
      expect(mockRfc.call.mock.calls[0][1].T_LTBA[0].BETYP).toBeUndefined();
      expect(mockRfc.call.mock.calls[0][1].T_LTBA[0].BENUM).toBeUndefined();
    });

    test('when WM_TR_REAL_MOVEMENT is true, passes real BWLVS 201, BETYP K and formatted BENUM cost center [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      try {
        mockRfc.call.mockResolvedValueOnce({
          T_LTBA: [{ TBNUM: '0001001839', TBPOS: '0001' }]
        });

        await adapter.createTransferRequirement({
          warehouseNumber: 'W01',
          wmMovementType: '201',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 1,
          unit: 'NOS',
          reservationNo: '524979',
          costCenter: '1011201301'
        });

        expect(mockRfc.call).toHaveBeenCalledWith(
          'L_TR_CREATE',
          expect.objectContaining({
            T_LTBA: [
              expect.objectContaining({
                BWLVS: '201',
                BETYP: 'K',
                BENUM: '1011201301'
              })
            ]
          })
        );
      } finally {
        process.env.WM_TR_REAL_MOVEMENT = origEnv;
      }
    });

    test('when WM_TR_REAL_MOVEMENT is true, passes real BWLVS 241, BETYP A and formatted BENUM asset [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      try {
        mockRfc.call.mockResolvedValueOnce({
          T_LTBA: [{ TBNUM: '0001001839', TBPOS: '0001' }]
        });

        await adapter.createTransferRequirement({
          warehouseNumber: 'W01',
          wmMovementType: '241',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 1,
          unit: 'NOS',
          reservationNo: '524979',
          assetNo: '000000400001'
        });

        expect(mockRfc.call).toHaveBeenCalledWith(
          'L_TR_CREATE',
          expect.objectContaining({
            T_LTBA: [
              expect.objectContaining({
                BWLVS: '241',
                BETYP: 'A',
                BENUM: '0000400001'
              })
            ]
          })
        );
      } finally {
        process.env.WM_TR_REAL_MOVEMENT = origEnv;
      }
    });

    test('when WM_TR_REAL_MOVEMENT is true, passes alphanumeric cost center unchanged up to 10 chars with VERIFY rule [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      try {
        mockRfc.call.mockResolvedValueOnce({
          T_LTBA: [{ TBNUM: '0001001840', TBPOS: '0001' }]
        });

        await adapter.createTransferRequirement({
          warehouseNumber: 'W01',
          wmMovementType: '201',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 1,
          unit: 'NOS',
          reservationNo: '524979',
          costCenter: 'SAP-DUMMY'
        });

        expect(mockRfc.call).toHaveBeenCalledWith(
          'L_TR_CREATE',
          expect.objectContaining({
            T_LTBA: [
              expect.objectContaining({
                BWLVS: '201',
                BETYP: 'K',
                BENUM: 'SAP-DUMMY'
              })
            ]
          })
        );
      } finally {
        process.env.WM_TR_REAL_MOVEMENT = origEnv;
      }
    });

    test('when WM_TR_REAL_MOVEMENT is true, pads short numeric asset number to 10 chars [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      try {
        mockRfc.call.mockResolvedValueOnce({
          T_LTBA: [{ TBNUM: '0001001841', TBPOS: '0001' }]
        });

        await adapter.createTransferRequirement({
          warehouseNumber: 'W01',
          wmMovementType: '241',
          material: '8000000023',
          plant: '1120',
          storageLocation: 'HS01',
          quantity: 1,
          unit: 'NOS',
          reservationNo: '524979',
          assetNo: '400001'
        });

        expect(mockRfc.call).toHaveBeenCalledWith(
          'L_TR_CREATE',
          expect.objectContaining({
            T_LTBA: [
              expect.objectContaining({
                BWLVS: '241',
                BETYP: 'A',
                BENUM: '0000400001'
              })
            ]
          })
        );
      } finally {
        process.env.WM_TR_REAL_MOVEMENT = origEnv;
      }
    });

    test('when WM_TR_REAL_MOVEMENT is true and cost center is missing for 201, throws clear 400 error before calling SAP [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      try {
        await expect(
          adapter.createTransferRequirement({
            warehouseNumber: 'W01',
            wmMovementType: '201',
            material: '8000000023',
            plant: '1120',
            storageLocation: 'HS01',
            quantity: 1,
            unit: 'NOS',
            reservationNo: '524979'
          })
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('Movement 201 requires Cost Center (BENUM)')
        });
        expect(mockRfc.call).not.toHaveBeenCalled();
      } finally {
        process.env.WM_TR_REAL_MOVEMENT = origEnv;
      }
    });

    test('when WM_TR_REAL_MOVEMENT is true and asset is missing for 241, throws clear 400 error before calling SAP [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_TR_REAL_MOVEMENT;
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      try {
        await expect(
          adapter.createTransferRequirement({
            warehouseNumber: 'W01',
            wmMovementType: '241',
            material: '8000000023',
            plant: '1120',
            storageLocation: 'HS01',
            quantity: 1,
            unit: 'NOS',
            reservationNo: '524979'
          })
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('Movement 241 requires Asset number (BENUM)')
        });
        expect(mockRfc.call).not.toHaveBeenCalled();
      } finally {
        process.env.WM_TR_REAL_MOVEMENT = origEnv;
      }
    });

    test('Pre-check before TR creation: when WM_PRE_MIGO_T321_CHECK is true and T321 has TBFKZ = X, returns warning that goods movement will create an additional TR [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_PRE_MIGO_T321_CHECK;
      process.env.WM_PRE_MIGO_T321_CHECK = 'true';
      try {
        mockRfc.readTable.mockImplementation(async (table) => {
          if (table === 'T321') {
            return [{ LGNUM: '***', RBLVS: '311', TBFKZ: 'X' }];
          }
          return [];
        });

        mockRfc.call.mockResolvedValueOnce({
          T_LTBA: [{ TBNUM: '0001001839', TBPOS: '0001' }]
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
        expect(result.warning).toBe('goods movement will create an additional TR');
        expect(mockRfc.readTable).toHaveBeenCalledWith('T321', expect.any(Array), expect.any(Array));
      } finally {
        process.env.WM_PRE_MIGO_T321_CHECK = origEnv;
      }
    });

    test('Deterministic TR return: returns success, reservationNumber, trNumber, and trItem', async () => {
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
            MENGA: 5,
            ALTME: 'NOS',
            RSNUM: '0000520235',
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
        quantity: 5,
        unit: 'NOS',
        reservationNo: '520235'
      });

      expect(result).toMatchObject({
        success: true,
        reservationNumber: '520235',
        trNumber: '1001839',
        trItem: '0001',
        material: '8000000023',
        quantity: 5,
        plant: '1120',
        storageLocation: 'HS01',
        warehouse: 'W01',
        movement: '311'
      });
    });

    test('Critical Rule: rejects when returned TR material mismatches expected material', async () => {
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [
          {
            LGNUM: 'W01',
            BWLVS: '311',
            TBNUM: '0001001839',
            TBPOS: '0001',
            MATNR: '000000008000009999', // Mismatched material!
            WERKS: '1120',
            LGORT: 'HS01',
            MENGA: 1,
            ALTME: 'NOS'
          }
        ]
      });

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
      ).rejects.toMatchObject({
        stage: 'TR',
        message: expect.stringContaining('material mismatch')
      });
    });

    test('Critical Rule: rejects when returned TR quantity mismatches expected quantity', async () => {
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
            MENGA: 99, // Mismatched quantity!
            ALTME: 'NOS'
          }
        ]
      });

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
      ).rejects.toMatchObject({
        stage: 'TR',
        message: expect.stringContaining('quantity mismatch')
      });
    });

    test('Critical Rule: rejects when returned TR plant or storage location mismatches', async () => {
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [
          {
            LGNUM: 'W01',
            BWLVS: '311',
            TBNUM: '0001001839',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '9999', // Mismatched plant!
            LGORT: 'HS01',
            MENGA: 1,
            ALTME: 'NOS'
          }
        ]
      });

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
      ).rejects.toMatchObject({
        stage: 'TR',
        message: expect.stringContaining('plant mismatch')
      });
    });

    test('Critical Rule: rejects when returned TR number is missing or zero', async () => {
      mockRfc.call.mockResolvedValueOnce({
        T_LTBA: [
          {
            LGNUM: 'W01',
            BWLVS: '311',
            TBNUM: '0000000000', // Invalid zero TR!
            TBPOS: '0001'
          }
        ]
      });

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
      ).rejects.toMatchObject({
        stage: 'TR',
        message: expect.stringContaining('missing or invalid TR number')
      });
    });

    test('returns { success: false, stage: "TR", error: "..." } when throwError is false', async () => {
      mockRfc.call.mockRejectedValueOnce(new Error('SAP connection failure'));

      const result = await adapter.createTransferRequirement({
        warehouseNumber: 'W01',
        wmMovementType: '311',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'HS01',
        quantity: 1,
        unit: 'NOS',
        reservationNo: '524979',
        throwError: false
      });

      expect(result).toMatchObject({
        success: false,
        stage: 'TR',
        error: expect.stringMatching(/SAP connection failure/)
      });
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

    test('Maps SAP L3 007 storage type search error into actionable message with SPRO path', async () => {
      mockRfc.call.mockRejectedValueOnce(
        new Error('Data for storage type search is not defined (A EN1 )')
      );

      await expect(
        adapter.createTransferOrderFromTR({
          warehouseNumber: 'W01',
          trNumber: '1001839',
          movementType: '311'
        })
      ).rejects.toThrow(
        /missing customizing key in table T334T \(Warehouse: W01, Operation: A \[Stock Removal\], Storage Type Indicator: 'EN1'\)/
      );
    });

    test('Architecture Rule: Rejects TO creation when TR cannot be verified in SAP', async () => {
      // trNumber '9999999' is not in LTBK mock
      await expect(
        adapter.createTransferOrderFromTR({
          warehouseNumber: 'W01',
          trNumber: '9999999'
        })
      ).rejects.toThrow(/Created TR 9999999 cannot be verified in SAP before TO creation/);
    });
  });

  describe('3b. getTransferRequirement (TR Read & Verification)', () => {
    test('Reads and verifies TR from LTBK table', async () => {
      const tr = await adapter.getTransferRequirement('1001839', 'W01');
      expect(tr).toMatchObject({
        success: true,
        trNumber: '1001839',
        trNumberRaw: '0001001839',
        warehouse: 'W01',
        movement: '311',
        reservationNo: '524979',
        source: 'LTBK'
      });
    });

    test('Falls back to Z_WM_GET_TR_MATERIAL_LIST when LTBK table yields no row', async () => {
      mockRfc.call.mockResolvedValueOnce({
        ET_TR_HEADER: [
          {
            LGNUM: 'W01',
            TBNUM: '0001009999',
            BWLVS: '201',
            BETYP: 'K',
            BENUM: '1011201301',
            RSNUM: '0000529999',
            STATU: '01'
          }
        ]
      });

      const tr = await adapter.getTransferRequirement('1009999', 'W01');
      expect(tr).toMatchObject({
        success: true,
        trNumber: '1009999',
        warehouse: 'W01',
        movement: '201',
        requirementNo: '1011201301',
        reservationNo: '529999',
        source: 'Z_WM_GET_TR_MATERIAL_LIST'
      });
    });

    test('Returns null when TR is not found in LTBK or RFC fallback', async () => {
      mockRfc.call.mockResolvedValueOnce({
        ET_TR_HEADER: []
      });

      const tr = await adapter.getTransferRequirement('8888888', 'W01');
      expect(tr).toBeNull();
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
          GOODSMVT_CODE: { GM_CODE: '04' }, // 311 -> MB1B; no '06' fallback
          GOODSMVT_ITEM: [
            expect.objectContaining({
              MOVE_TYPE: '311',
              RESERV_NO: '0000524979',
              RES_ITEM: '0001'
            })
          ]
        })
      );
      expect(result.warning).toBeUndefined();
    });

    test('Pre-MIGO check: when flag is on and T321 has TBFKZ = X, returns warning that goods movement will create an additional TR [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_PRE_MIGO_T321_CHECK;
      process.env.WM_PRE_MIGO_T321_CHECK = 'true';
      try {
        mockRfc.readTable.mockImplementation(async (table) => {
          if (table === 'T321') {
            return [{ LGNUM: '***', RBLVS: '311', TBFKZ: 'X' }];
          }
          if (table === 'T320') {
            return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
          }
          if (table === 'MARD') {
            return [{ LGORT: 'CS01' }, { LGORT: 'HS01' }];
          }
          return [];
        });

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
        expect(result.warning).toBe('goods movement will create an additional TR');
        expect(mockRfc.readTable).toHaveBeenCalledWith('T321', expect.any(Array), expect.any(Array));
      } finally {
        process.env.WM_PRE_MIGO_T321_CHECK = origEnv;
      }
    });

    test('Pre-MIGO check: when flag is on but T321 has TBFKZ = "", returns no warning [mock only, not SAP verification]', async () => {
      const origEnv = process.env.WM_PRE_MIGO_T321_CHECK;
      process.env.WM_PRE_MIGO_T321_CHECK = 'true';
      try {
        mockRfc.readTable.mockImplementation(async (table) => {
          if (table === 'T321') {
            return [{ LGNUM: '***', RBLVS: '311', TBFKZ: '' }];
          }
          if (table === 'T320') {
            return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
          }
          if (table === 'MARD') {
            return [{ LGORT: 'CS01' }, { LGORT: 'HS01' }];
          }
          return [];
        });

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
        expect(result.warning).toBeUndefined();
      } finally {
        process.env.WM_PRE_MIGO_T321_CHECK = origEnv;
      }
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
          storageLocation: 'HS01',
          receivingStorageLocation: 'CS01',
          material: '8000000023',
          unit: 'NOS',
          quantity: 999999
        })
      ).rejects.toMatchObject({
        stage: 'RESERVATION',
        success: false,
        message: expect.stringMatching(/Deficit of BA Unrestricted-use stock/)
      });
    });

    test('createReservation returns { success: false, stage: "RESERVATION", error: "..." } when throwError is false', async () => {
      mockRfc.call.mockResolvedValueOnce({
        RESERVATION: '',
        RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Cost center 1011201301 locked' }]
      });

      const result = await adapter.createReservation({
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000000023',
        costCenter: '1011201301',
        unit: 'NOS',
        quantity: 1,
        throwError: false
      });

      expect(result).toMatchObject({
        success: false,
        stage: 'RESERVATION',
        error: expect.stringMatching(/Cost center 1011201301 locked/)
      });
    });

    test('createReservation throws 500 when BAPI returns success messages but empty reservation number in non-testrun mode', async () => {
      mockRfc.call
        .mockResolvedValueOnce({
          RESERVATION: '',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Commit simulated' }]
        })
        .mockResolvedValueOnce({}); // COMMIT

      await expect(
        adapter.createReservation({
          movementType: '201',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000000023',
          costCenter: '1011201301',
          unit: 'NOS',
          quantity: 1
        })
      ).rejects.toMatchObject({
        stage: 'RESERVATION',
        success: false,
        status: 500,
        message: expect.stringMatching(/No reservation number generated by SAP/)
      });
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

  describe('7. Storage-location extension preflight (MARD)', () => {
    let rfc;
    let adp;
    const mard = { 1120: ['HS01', 'MT01', 'MT02'], 1110: ['CS01'] };

    beforeEach(() => {
      rfc = {
        session: jest.fn(async (fn) => fn(rfc.call)),
        call: jest.fn()
          .mockResolvedValueOnce({ RESERVATION: '0000525900', RETURN: [{ TYPE: 'S', MESSAGE: 'ok' }] })
          .mockResolvedValueOnce({}),
        readTable: jest.fn(async (table, fields, where) => {
          const w = (where || []).find((c) => c.includes('WERKS'));
          const m = w && w.match(/WERKS = '(\d+)'/);
          const plant = m ? m[1] : '';
          return (mard[plant] || []).map((lgort) => ({ LGORT: lgort }));
        })
      };
      adp = new ReservationProcessAdapter({ rfc });
    });

    test('passes when material is extended to both issuing and receiving SLocs (311)', async () => {
      const result = await adp.createReservation({
        movementType: '311', plant: '1120', storageLocation: 'HS01',
        receivingStorageLocation: 'MT01', material: '8000009753', quantity: 1, unit: 'KG'
      });
      expect(result.success).toBe(true);
      expect(rfc.readTable).toHaveBeenCalledWith('MARD', ['LGORT'], expect.arrayContaining([expect.stringContaining('WERKS')]), 50);
      expect(rfc.call).toHaveBeenCalledWith('BAPI_RESERVATION_CREATE1', expect.anything());
    });

    test('rejects (400) and lists the valid SLocs when the issuing SLoc is not extended (201)', async () => {
      await expect(adp.createReservation({
        movementType: '201', plant: '1120', storageLocation: 'CS01',
        costCenter: '1011201301', material: '8000009753', quantity: 1, unit: 'KG'
      })).rejects.toThrow(/not extended to issuing storage location CS01 in plant 1120.*HS01, MT01, MT02/);
      expect(rfc.call).not.toHaveBeenCalled(); // BAPI must not run when preflight fails
    });

    test('rejects (400) when the receiving SLoc is not extended (311)', async () => {
      await expect(adp.createReservation({
        movementType: '311', plant: '1120', storageLocation: 'HS01',
        receivingStorageLocation: 'CS01', material: '8000009753', quantity: 1, unit: 'KG'
      })).rejects.toThrow(/not extended to receiving storage location CS01 in plant 1120/);
    });

    test('does not block the create when the MARD read itself fails', async () => {
      rfc.readTable = jest.fn(async () => { throw new Error('RFC_READ_TABLE blocked'); });
      const result = await adp.createReservation({
        movementType: '201', plant: '1120', storageLocation: 'CS01',
        costCenter: '1011201301',
        material: '8000009753', quantity: 1, unit: 'KG'
      });
      expect(result.success).toBe(true);
      expect(rfc.call).toHaveBeenCalledWith('BAPI_RESERVATION_CREATE1', expect.anything());
    });
  });
});
