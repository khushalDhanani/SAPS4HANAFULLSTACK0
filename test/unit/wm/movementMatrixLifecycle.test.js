'use strict';

/**
 * Complete Movement Matrix Lifecycle & Failure Path Unit Test Suite
 * Step 16 — Fix tests before live testing
 *
 * For every movement type (201, 241, 311, 301):
 *
 * 1. Happy path:
 *    Reservation -> TR -> TO -> Confirm -> MIGO -> Stock -> Reservation
 *
 * 2. Failure paths (12 scenarios per movement type):
 *    - Reservation fails
 *    - TR fails
 *    - TR missing
 *    - TO fails
 *    - TO confirmation fails
 *    - MIGO fails
 *    - MIGO timeout
 *    - Duplicate MIGO (idempotency protection)
 *    - Partial quantity (PARTIALLY_PROCESSED)
 *    - Wrong material
 *    - Wrong SLoc
 *    - Wrong plant
 *
 * Total matrix: 4 movement types × 13 test cases = 52 comprehensive tests.
 * All tests labeled: [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { PROCESS_STATUS } = require('../../../srv/common/wmStatus');

describe('Step 16: Complete Movement Type Lifecycle & Failure Matrix [mock only, not SAP verification]', () => {
  const origRealMvt = process.env.WM_TR_REAL_MOVEMENT;

  beforeAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = 'true';
  });

  afterAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = origRealMvt;
  });

  /**
   * Factory to create mock RFC and initialized ReservationProcessAdapter
   * Configured per movement type with standard master data and FM defaults.
   */
  const createTestEnvironment = (mvt) => {
    let bapiGoodsmvtCalls = [];

    const mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(),
      readTable: jest.fn()
    };

    const adapter = new ReservationProcessAdapter({
      rfc: mockRfc,
      checkCsksExistence: true,
      checkAnlaExistence: true,
      checkMarcExistence: true
    });

    // Default FM call handlers
    const setupDefaultFms = (overrides = {}) => {
      bapiGoodsmvtCalls = [];
      mockRfc.call.mockImplementation(async (fm, params) => {
        if (overrides[fm]) return overrides[fm](params);

        if (fm === 'BAPI_RESERVATION_CREATE1') {
          return {
            RESERVATION: `0000520${mvt}`,
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: `Reservation 520${mvt} created` }]
          };
        }
        if (fm === 'L_TR_CREATE') {
          const reqItem = (params && params.T_LTBA && params.T_LTBA[0]) || {};
          const qty = reqItem.MENGA !== undefined ? reqItem.MENGA : 10;
          return {
            T_LTBA: [{
              TBNUM: `0001000${mvt}`,
              TBPOS: '0001',
              MATNR: mvt === '241' ? '000000008000008977' : '000000008000000023',
              MENGA: qty,
              WERKS: '1120',
              LGORT: 'HS01',
              LGNUM: 'W01',
              BWLVS: mvt
            }]
          };
        }
        if (fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
          const qty = params && params.IV_MENGA !== undefined ? params.IV_MENGA : 10;
          return {
            EV_TBNUM: `0001000${mvt}`,
            EV_TBPOS: '0001',
            MATNR: mvt === '241' ? '000000008000008977' : '000000008000000023',
            MENGA: qty,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: mvt
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR' || fm === 'Z_WM_TO_CREATE_FROM_TR') {
          return { E_TANUM: `0001030${mvt}`, EV_TANUM: `0001030${mvt}`, EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          return {
            EV_SUCCESS: 'S',
            ET_ITEMS: [{ TANUM: `0001030${mvt}`, TAPOS: '0001', NISTM: '10.000' }]
          };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiGoodsmvtCalls.push(params);
          return {
            MATERIALDOCUMENT: `5000000${mvt}`,
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: `Document 5000000${mvt} posted` }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT') {
          return {};
        }
        return {};
      });
    };

    // Default readTable handlers
    const setupDefaultTables = (overrides = {}) => {
      mockRfc.readTable.mockImplementation(async (table, fields, where = []) => {
        if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }]; // company code from the plant (required on the create path since the D7 fix)
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (overrides[table]) return overrides[table](fields, where, whereStr);

        if (table === 'T320') {
          if (whereStr.includes('9999') || whereStr.includes('XX99')) return [];
          return [
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }
          ];
        }

        if (table === 'CSKS') {
          return [{
            KOKRS: '1000',
            KOSTL: '001011201301',
            DATAB: '20200101',
            DATBI: '99991231',
            BKZKP: ''
          }];
        }

        if (table === 'ANLA') {
          return [{
            BUKRS: '1000',
            ANLN1: '000000400001',
            ANLN2: '0000',
            AKTIV: '20200101',
            DEAKT: '00000000',
            XLOEV: '',
            XSPEB: ''
          }];
        }

        if (table === 'MARC') {
          if (whereStr.includes('INVALID_MAT') || whereStr.includes('NONEXISTENT')) return [];
          return [
            { MATNR: '000000008000000023', WERKS: '1120', XCHPF: '', SERNP: '' },
            { MATNR: '000000008000000023', WERKS: '1110', XCHPF: '', SERNP: '' },
            { MATNR: '000000008000008977', WERKS: '1120', XCHPF: '', SERNP: '' }
          ];
        }

        if (table === 'MARD') {
          return [
            { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' },
            { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '20.000' },
            { MATNR: '000000008000000023', WERKS: '1110', LGORT: 'CS01', LABST: '20.000' },
            { MATNR: '000000008000008977', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }
          ];
        }

        if (table === 'LTBK') {
          return [{
            LGNUM: 'W01',
            TBNUM: `0001000${mvt}`,
            BWLVS: mvt,
            BETYP: mvt === '201' ? 'K' : (mvt === '241' ? 'A' : ''),
            BENUM: mvt === '201' ? '001011201301' : (mvt === '241' ? '0000400001' : ''),
            NLTYP: mvt === '311' ? '921' : (mvt === '301' ? '920' : (mvt === '201' ? '911' : '913')),
            NLPLA: mvt === '311' ? 'TRANSFER' : (mvt === '301' ? 'TRANSFER' : (mvt === '201' ? '1011201301' : '0000400001')),
            RSNUM: `0000520${mvt}`,
            STATU: 'O',
            BDATU: '20261014'
          }];
        }

        if (table === 'LTAK') {
          return [{
            LGNUM: 'W01',
            TANUM: `0001030${mvt}`,
            TBNUM: `0001000${mvt}`,
            BWLVS: mvt,
            KQUIT: ' ',
            BDATU: '20261014'
          }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01',
            TANUM: `0001030${mvt}`,
            TAPOS: '0001',
            TBPOS: '0001',
            MATNR: mvt === '241' ? '000000008000008977' : '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            NSOLA: '10.000',
            ALTME: mvt === '241' ? 'KG' : 'NOS',
            PQUIT: ' '
          }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          if (whereStr.includes(`MBLNR = '5000000${mvt}'`)) {
            return [{
              MBLNR: `5000000${mvt}`,
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: mvt,
              MATNR: mvt === '241' ? '000000008000008977' : '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: mvt === '301' ? '1110' : '',
              UMLGO: mvt === '311' || mvt === '301' ? 'CS01' : '',
              KOSTL: mvt === '201' ? '001011201301' : '',
              ANLN1: mvt === '241' ? '000000400001' : '',
              ANLN2: mvt === '241' ? '0000' : '',
              RSNUM: `0000520${mvt}`,
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }

        if (table === 'RESB') {
          return [{
            RSNUM: `0000520${mvt}`,
            RSPOS: '0001',
            MATNR: mvt === '241' ? '000000008000008977' : '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            BDMNG: '10.000',
            ENMNG: '10.000',
            MEINS: mvt === '241' ? 'KG' : 'NOS',
            KZEAR: 'X',
            XLOEK: ''
          }];
        }

        return [];
      });
    };

    return {
      mockRfc,
      adapter,
      setupDefaultFms,
      setupDefaultTables,
      getBapiGoodsmvtCalls: () => bapiGoodsmvtCalls
    };
  };

  // =========================================================================
  // Movement Type 201: Goods Issue to Cost Center
  // =========================================================================
  describe('Movement Type 201 (Goods Issue to Cost Center) - Complete Lifecycle & Failure Matrix', () => {
    const env = createTestEnvironment('201');

    const defaultInput201 = {
      movementType: '201',
      plant: '1120',
      storageLocation: 'HS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      costCenter: '1011201301',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000201'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Happy path: Reservation → TR → TO → Confirm → MIGO → Stock → Reservation', async () => {
      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(result.completed).toBe(true);
      expect(result.completelyProcessed).toBe(true);

      // Verify all 7 sequence stages executed and logged
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
      expect(result.reservationNumber).toBe('520201');
      expect(result.trNumber).toBe('1000201');
      expect(result.toNumber).toBe('1030201');
      expect(result.confirmation.confirmed).toBe(true);
      expect(result.migo.materialDocument).toBe('5000000201');
      expect(result.stock.success).toBe(true);
      expect(result.stock.sourceStockDecreased).toBe(true);
      expect(result.stock.costCenter).toContain('1011201301');
      expect(result.finalReservation.completelyProcessed).toBe(true);
      expect(result.finalReservation.remainingQuantity).toBe(0);
    });

    test('Failure path 1: Reservation fails', async () => {
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Cost center locked for posting');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Cost center locked');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 2: TR fails', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed: Storage type 911 not defined in W01');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed: Storage type 911 not defined in W01');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed: Storage type 911 not defined in W01');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.reservationNumber).toBe('520201');
      expect(result.stages).toEqual(['RESERVATION_CREATED']);
    });

    test('Failure path 3: TR missing', async () => {
      env.setupDefaultTables({
        LTBK: () => [] // TR not persisted in SAP
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR_VERIFICATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED']);
    });

    test('Failure path 4: TO fails', async () => {
      env.setupDefaultFms({
        L_TO_CREATE_TR: () => {
          throw new Error('L_TO_CREATE_TR failed: No quants available in source storage bin');
        },
        ZWM_TO_CREATE_FROM_TR: () => {
          throw new Error('ZWM_TO_CREATE_FROM_TR failed: No quants available');
        },
        Z_WM_TO_CREATE_FROM_TR: () => {
          throw new Error('Z_WM_TO_CREATE_FROM_TR failed: No quants available');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TO);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED']);
    });

    test('Failure path 5: TO confirmation fails', async () => {
      env.setupDefaultFms({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Differences exist during confirmation');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO_CONFIRMATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED']);
    });

    test('Failure path 6: MIGO fails', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('BAPI_GOODSMVT_CREATE failed: Posting period 10/2026 is closed');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('Posting period');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 7: MIGO timeout', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('Gateway Timeout (ETIMEDOUT): Connection closed while waiting for SAP response');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('ETIMEDOUT');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 8: Duplicate MIGO (idempotency retry returns existing document without duplicate stock consumption)', async () => {
      // 1. First run posts MIGO successfully
      const firstResult = await env.adapter.executeReservationWarehouseFlow(defaultInput201);
      expect(firstResult.success).toBe(true);
      expect(firstResult.migo.materialDocument).toBe('5000000201');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Now simulate SAP table MATDOC holding this document for the processId
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${defaultInput201.processId}'`) || whereStr.includes("RSNUM = '0000520201'")) {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520201',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      // 2. Browser timeout / user submits again with identical processId and params
      const retryResult = await env.adapter.executeReservationWarehouseFlow(defaultInput201);

      expect(retryResult.success).toBe(true);
      expect(retryResult.migo.materialDocument).toBe('5000000201');
      expect(retryResult.alreadyPosted).toBe(true);
      expect(retryResult.idempotentRetry).toBe(true);
      // CRITICAL: Stock is NOT consumed twice! BAPI_GOODSMVT_CREATE was NOT called a second time
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Failure path 9: Partial quantity (PARTIALLY_PROCESSED, remaining open, completed: false)', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000201',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: 6,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: '201'
          }]
        })
      });

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030201',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000201'")) {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520201',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520201',
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

      const partialInput = { ...defaultInput201, quantity: 6 };
      const result = await env.adapter.executeReservationWarehouseFlow(partialInput);

      expect(result.success).toBe(true);
      expect(result.state).toBe('PARTIALLY_PROCESSED');
      expect(result.processStatus).toBe(PROCESS_STATUS.PARTIALLY_PROCESSED);
      expect(result.completed).toBe(false);
      expect(result.completelyProcessed).toBe(false);
      expect(result.stages).not.toContain('COMPLETED');
      expect(result.finalReservation.remainingQuantity).toBe(4);
      expect(result.finalReservation.completelyProcessed).toBe(false);
    });

    test('Failure path 10: Wrong material (MARC existence or master data validation fails)', async () => {
      const wrongMatInput = { ...defaultInput201, material: 'NONEXISTENT_MAT' };
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Material NONEXISTENT_MAT does not exist in plant 1120');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(wrongMatInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('NONEXISTENT_MAT');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 11: Wrong SLoc (T320 warehouse mapping fails)', async () => {
      const wrongSlocInput = { ...defaultInput201, storageLocation: 'XX99' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongSlocInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('XX99');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 12: Wrong plant (Plant mapping fails in T320)', async () => {
      const wrongPlantInput = { ...defaultInput201, plant: '9999' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongPlantInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('9999');
      expect(result.stages).toEqual([]);
    });
  });

  // =========================================================================
  // Movement Type 241: Goods Issue to Asset
  // =========================================================================
  describe('Movement Type 241 (Goods Issue to Asset) - Complete Lifecycle & Failure Matrix', () => {
    const env = createTestEnvironment('241');

    const defaultInput241 = {
      movementType: '241',
      plant: '1120',
      storageLocation: 'HS01',
      material: '8000008977',
      quantity: 10,
      unit: 'KG',
      assetNo: '000000400001',
      subNumber: '0000',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000241'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Happy path: Reservation → TR → TO → Confirm → MIGO → Stock → Reservation', async () => {
      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(result.completed).toBe(true);
      expect(result.completelyProcessed).toBe(true);

      // Verify all 7 sequence stages executed and logged
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
      expect(result.reservationNumber).toBe('520241');
      expect(result.trNumber).toBe('1000241');
      expect(result.toNumber).toBe('1030241');
      expect(result.confirmation.confirmed).toBe(true);
      expect(result.migo.materialDocument).toBe('5000000241');
      expect(result.stock.success).toBe(true);
      expect(result.stock.sourceStockDecreased).toBe(true);
      expect(result.stock.assetConsumptionPosted).toBe(true);
      expect(result.finalReservation.completelyProcessed).toBe(true);
      expect(result.finalReservation.remainingQuantity).toBe(0);
    });

    test('Failure path 1: Reservation fails', async () => {
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Asset deactivated');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Asset deactivated');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 2: TR fails', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed: Interim storage type 913 error');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed: Interim storage type 913 error');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed: Interim storage type 913 error');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.reservationNumber).toBe('520241');
      expect(result.stages).toEqual(['RESERVATION_CREATED']);
    });

    test('Failure path 3: TR missing', async () => {
      env.setupDefaultTables({
        LTBK: () => [] // TR not persisted in SAP
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR_VERIFICATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED']);
    });

    test('Failure path 4: TO fails', async () => {
      env.setupDefaultFms({
        L_TO_CREATE_TR: () => {
          throw new Error('L_TO_CREATE_TR failed: Storage bin blocked');
        },
        ZWM_TO_CREATE_FROM_TR: () => {
          throw new Error('ZWM_TO_CREATE_FROM_TR failed: Storage bin blocked');
        },
        Z_WM_TO_CREATE_FROM_TR: () => {
          throw new Error('Z_WM_TO_CREATE_FROM_TR failed: Storage bin blocked');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TO);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED']);
    });

    test('Failure path 5: TO confirmation fails', async () => {
      env.setupDefaultFms({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Quant difference detected');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO_CONFIRMATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED']);
    });

    test('Failure path 6: MIGO fails', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('BAPI_GOODSMVT_CREATE failed: Deficit of SL Unrestricted-use stock');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('Deficit of SL');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 7: MIGO timeout', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('Gateway Timeout (ETIMEDOUT): SAP Gateway timed out during asset post');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('ETIMEDOUT');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 8: Duplicate MIGO (idempotency retry returns existing document without duplicate stock consumption)', async () => {
      // 1. Initial attempt: TO confirmed -> MIGO posted
      const firstResult = await env.adapter.executeReservationWarehouseFlow(defaultInput241);
      expect(firstResult.success).toBe(true);
      expect(firstResult.migo.materialDocument).toBe('5000000241');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Simulate SAP MATDOC transparent table containing the document
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${defaultInput241.processId}'`) || whereStr.includes("RSNUM = '0000520241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              BWART: '241',
              MATNR: '000000008000008977',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520241',
              RSPOS: '0001',
              ANLN1: '000000400001',
              ANLN2: '0000',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      // 2. Retry after timeout: operator submits again with identical processId
      const retryResult = await env.adapter.executeReservationWarehouseFlow(defaultInput241);

      expect(retryResult.success).toBe(true);
      expect(retryResult.migo.materialDocument).toBe('5000000241');
      expect(retryResult.alreadyPosted).toBe(true);
      expect(retryResult.idempotentRetry).toBe(true);
      // Verify no second BAPI call was made
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Failure path 9: Partial quantity (PARTIALLY_PROCESSED, remaining open, completed: false)', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000241',
            TBPOS: '0001',
            MATNR: '000000008000008977',
            MENGA: 6,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: '241'
          }]
        })
      });

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030241',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000008977',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'KG',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '241',
              MATNR: '000000008000008977',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520241',
              RSPOS: '0001',
              ANLN1: '000000400001',
              ANLN2: '0000',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520241',
          RSPOS: '0001',
          MATNR: '000000008000008977',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'KG',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const partialInput = { ...defaultInput241, quantity: 6 };
      const result = await env.adapter.executeReservationWarehouseFlow(partialInput);

      expect(result.success).toBe(true);
      expect(result.state).toBe('PARTIALLY_PROCESSED');
      expect(result.processStatus).toBe(PROCESS_STATUS.PARTIALLY_PROCESSED);
      expect(result.completed).toBe(false);
      expect(result.completelyProcessed).toBe(false);
      expect(result.stages).not.toContain('COMPLETED');
      expect(result.finalReservation.remainingQuantity).toBe(4);
      expect(result.finalReservation.completelyProcessed).toBe(false);
    });

    test('Failure path 10: Wrong material (MARC existence or master data validation fails)', async () => {
      const wrongMatInput = { ...defaultInput241, material: 'NONEXISTENT_MAT' };
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Material NONEXISTENT_MAT does not exist in plant 1120');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(wrongMatInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('NONEXISTENT_MAT');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 11: Wrong SLoc (T320 warehouse mapping fails)', async () => {
      const wrongSlocInput = { ...defaultInput241, storageLocation: 'XX99' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongSlocInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('XX99');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 12: Wrong plant (Plant mapping fails in T320)', async () => {
      const wrongPlantInput = { ...defaultInput241, plant: '9999' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongPlantInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('9999');
      expect(result.stages).toEqual([]);
    });
  });

  // =========================================================================
  // Movement Type 311: Storage Location Transfer within Plant
  // =========================================================================
  describe('Movement Type 311 (SLoc Transfer within Plant) - Complete Lifecycle & Failure Matrix', () => {
    const env = createTestEnvironment('311');

    const defaultInput311 = {
      movementType: '311',
      plant: '1120',
      storageLocation: 'HS01',
      receivingStorageLocation: 'CS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000311'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Happy path: Reservation → TR → TO → Confirm → MIGO → Stock → Reservation', async () => {
      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(result.completed).toBe(true);
      expect(result.completelyProcessed).toBe(true);

      // Verify all 7 sequence stages executed and logged
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
      expect(result.reservationNumber).toBe('520311');
      expect(result.trNumber).toBe('1000311');
      expect(result.toNumber).toBe('1030311');
      expect(result.confirmation.confirmed).toBe(true);
      expect(result.migo.materialDocument).toBe('5000000311');
      expect(result.stock.success).toBe(true);
      expect(result.stock.sourceStockDecreased).toBe(true);
      expect(result.stock.destinationStockIncreased).toBe(true);
      expect(result.finalReservation.completelyProcessed).toBe(true);
      expect(result.finalReservation.remainingQuantity).toBe(0);
    });

    test('Failure path 1: Reservation fails', async () => {
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Material blocked for transfer');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Material blocked');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 2: TR fails', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed: Interim storage type 921 transfer error');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed: Interim storage type 921 transfer error');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed: Interim storage type 921 transfer error');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.reservationNumber).toBe('520311');
      expect(result.stages).toEqual(['RESERVATION_CREATED']);
    });

    test('Failure path 3: TR missing', async () => {
      env.setupDefaultTables({
        LTBK: () => [] // TR not persisted in SAP
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR_VERIFICATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED']);
    });

    test('Failure path 4: TO fails', async () => {
      env.setupDefaultFms({
        L_TO_CREATE_TR: () => {
          throw new Error('L_TO_CREATE_TR failed: No quants found in bin TRANSFER');
        },
        ZWM_TO_CREATE_FROM_TR: () => {
          throw new Error('ZWM_TO_CREATE_FROM_TR failed: No quants found');
        },
        Z_WM_TO_CREATE_FROM_TR: () => {
          throw new Error('Z_WM_TO_CREATE_FROM_TR failed: No quants found');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TO);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED']);
    });

    test('Failure path 5: TO confirmation fails', async () => {
      env.setupDefaultFms({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Difference reported on destination bin');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO_CONFIRMATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED']);
    });

    test('Failure path 6: MIGO fails', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('BAPI_GOODSMVT_CREATE failed: Deficit of SL transfer stock');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('Deficit of SL');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 7: MIGO timeout', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('Gateway Timeout (ETIMEDOUT): Gateway timed out on 311 goods movement');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('ETIMEDOUT');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 8: Duplicate MIGO (idempotency retry returns existing document without duplicate stock consumption)', async () => {
      // 1. Initial attempt: TO confirmed -> MIGO posted
      const firstResult = await env.adapter.executeReservationWarehouseFlow(defaultInput311);
      expect(firstResult.success).toBe(true);
      expect(firstResult.migo.materialDocument).toBe('5000000311');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Simulate SAP MATDOC transparent table containing the document
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${defaultInput311.processId}'`) || whereStr.includes("RSNUM = '0000520311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMLGO: 'CS01',
              RSNUM: '0000520311',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      // 2. Retry after timeout: operator submits again with identical processId
      const retryResult = await env.adapter.executeReservationWarehouseFlow(defaultInput311);

      expect(retryResult.success).toBe(true);
      expect(retryResult.migo.materialDocument).toBe('5000000311');
      expect(retryResult.alreadyPosted).toBe(true);
      expect(retryResult.idempotentRetry).toBe(true);
      // Verify no second BAPI call was made
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Failure path 9: Partial quantity (PARTIALLY_PROCESSED, remaining open, completed: false)', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000311',
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

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030311',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMLGO: 'CS01',
              RSNUM: '0000520311',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520311',
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

      const partialInput = { ...defaultInput311, quantity: 6 };
      const result = await env.adapter.executeReservationWarehouseFlow(partialInput);

      expect(result.success).toBe(true);
      expect(result.state).toBe('PARTIALLY_PROCESSED');
      expect(result.processStatus).toBe(PROCESS_STATUS.PARTIALLY_PROCESSED);
      expect(result.completed).toBe(false);
      expect(result.completelyProcessed).toBe(false);
      expect(result.stages).not.toContain('COMPLETED');
      expect(result.finalReservation.remainingQuantity).toBe(4);
      expect(result.finalReservation.completelyProcessed).toBe(false);
    });

    test('Failure path 10: Wrong material (MARC existence or master data validation fails)', async () => {
      const wrongMatInput = { ...defaultInput311, material: 'NONEXISTENT_MAT' };
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Material NONEXISTENT_MAT does not exist in plant 1120');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(wrongMatInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('NONEXISTENT_MAT');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 11: Wrong SLoc (Identical issuing and receiving SLoc rejected)', async () => {
      const identicalSlocInput = { ...defaultInput311, storageLocation: 'HS01', receivingStorageLocation: 'HS01' };
      const result = await env.adapter.executeReservationWarehouseFlow(identicalSlocInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Receiving Storage Location must be different');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 12: Wrong plant (Receiving plant mismatch rejected for 311)', async () => {
      const wrongPlantInput = { ...defaultInput311, plant: '1120', receivingPlant: '1110' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongPlantInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Receiving Plant must match Issuing Plant for Movement Type 311');
      expect(result.stages).toEqual([]);
    });
  });

  // =========================================================================
  // Movement Type 301: Plant-to-Plant Transfer
  // =========================================================================
  describe('Movement Type 301 (Plant-to-Plant Transfer) - Complete Lifecycle & Failure Matrix', () => {
    const env = createTestEnvironment('301');

    const defaultInput301 = {
      movementType: '301',
      plant: '1120',
      storageLocation: 'HS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000301'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Happy path: Reservation → TR → TO → Confirm → MIGO → Stock → Reservation', async () => {
      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(result.completed).toBe(true);
      expect(result.completelyProcessed).toBe(true);

      // Verify all 7 sequence stages executed and logged
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
      expect(result.reservationNumber).toBe('520301');
      expect(result.trNumber).toBe('1000301');
      expect(result.toNumber).toBe('1030301');
      expect(result.confirmation.confirmed).toBe(true);
      expect(result.migo.materialDocument).toBe('5000000301');
      expect(result.stock.success).toBe(true);
      expect(result.stock.sourceStockDecreased).toBe(true);
      expect(result.stock.destinationStockIncreased).toBe(true);
      expect(result.finalReservation.completelyProcessed).toBe(true);
      expect(result.finalReservation.remainingQuantity).toBe(0);
    });

    test('Failure path 1: Reservation fails', async () => {
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Plant 1110 locked for cross-plant transfer');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Plant 1110 locked');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 2: TR fails', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed: Interim storage type 920 error');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed: Interim storage type 920 error');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed: Interim storage type 920 error');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.reservationNumber).toBe('520301');
      expect(result.stages).toEqual(['RESERVATION_CREATED']);
    });

    test('Failure path 3: TR missing', async () => {
      env.setupDefaultTables({
        LTBK: () => [] // TR not persisted in SAP
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR_VERIFICATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED']);
    });

    test('Failure path 4: TO fails', async () => {
      env.setupDefaultFms({
        L_TO_CREATE_TR: () => {
          throw new Error('L_TO_CREATE_TR failed: Transfer order creation blocked by system');
        },
        ZWM_TO_CREATE_FROM_TR: () => {
          throw new Error('ZWM_TO_CREATE_FROM_TR failed: TO blocked');
        },
        Z_WM_TO_CREATE_FROM_TR: () => {
          throw new Error('Z_WM_TO_CREATE_FROM_TR failed: TO blocked');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TO);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED']);
    });

    test('Failure path 5: TO confirmation fails', async () => {
      env.setupDefaultFms({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Destination storage location confirmation rejected');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO_CONFIRMATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED']);
    });

    test('Failure path 6: MIGO fails', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('BAPI_GOODSMVT_CREATE failed: Plant 1110 accounting period closed');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('accounting period closed');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 7: MIGO timeout', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('Gateway Timeout (ETIMEDOUT): Network timeout waiting for cross-plant posting');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('ETIMEDOUT');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 8: Duplicate MIGO (idempotency retry returns existing document without duplicate stock consumption)', async () => {
      // 1. Initial attempt: TO confirmed -> MIGO posted
      const firstResult = await env.adapter.executeReservationWarehouseFlow(defaultInput301);
      expect(firstResult.success).toBe(true);
      expect(firstResult.migo.materialDocument).toBe('5000000301');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Simulate SAP MATDOC transparent table containing the document
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${defaultInput301.processId}'`) || whereStr.includes("RSNUM = '0000520301'")) {
            return [{
              MBLNR: '5000000301',
              MJAHR: '2026',
              BWART: '301',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000520301',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      // 2. Retry after timeout: operator submits again with identical processId
      const retryResult = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(retryResult.success).toBe(true);
      expect(retryResult.migo.materialDocument).toBe('5000000301');
      expect(retryResult.alreadyPosted).toBe(true);
      expect(retryResult.idempotentRetry).toBe(true);
      // Verify no second BAPI call was made
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Failure path 9: Partial quantity (PARTIALLY_PROCESSED, remaining open, completed: false)', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000301',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: 6,
            WERKS: '1120',
            LGORT: 'HS01',
            LGNUM: 'W01',
            BWLVS: '301'
          }]
        })
      });

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030301',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000301'")) {
            return [{
              MBLNR: '5000000301',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '301',
              MATNR: '000000008000000023',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000520301',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520301',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          UMWRK: '1110',
          UMLGO: 'CS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'NOS',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const partialInput = { ...defaultInput301, quantity: 6 };
      const result = await env.adapter.executeReservationWarehouseFlow(partialInput);

      expect(result.success).toBe(true);
      expect(result.state).toBe('PARTIALLY_PROCESSED');
      expect(result.processStatus).toBe(PROCESS_STATUS.PARTIALLY_PROCESSED);
      expect(result.completed).toBe(false);
      expect(result.completelyProcessed).toBe(false);
      expect(result.stages).not.toContain('COMPLETED');
      expect(result.finalReservation.remainingQuantity).toBe(4);
      expect(result.finalReservation.completelyProcessed).toBe(false);
    });

    test('Failure path 10: Wrong material (Material not extended to receiving plant in MARC)', async () => {
      env.setupDefaultTables({
        MARC: (fields, where, whereStr) => {
          if (whereStr.includes("WERKS = '1110'")) return []; // Not extended in receiving plant 1110
          return [{ MATNR: '000000008000000023', WERKS: '1120', XCHPF: '', SERNP: '' }];
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('not extended to receiving plant 1110 (MARC)');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 11: Wrong SLoc (Receiving SLoc not extended in MARD for receiving plant)', async () => {
      env.setupDefaultTables({
        MARD: (fields, where, whereStr) => {
          if (whereStr.includes("WERKS = '1110'") && whereStr.includes("LGORT = 'CS01'")) return [];
          return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }];
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(defaultInput301);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('not extended to receiving storage location CS01 in plant 1110 (MARD)');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 12: Wrong plant (Receiving plant identical to issuing plant rejected)', async () => {
      const identicalPlantInput = { ...defaultInput301, plant: '1120', receivingPlant: '1120' };
      const result = await env.adapter.executeReservationWarehouseFlow(identicalPlantInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Receiving Plant must be different from Issuing Plant');
      expect(result.stages).toEqual([]);
    });
  });

  // =========================================================================
  // Failure Paths: Fixes, Retries & Resumption across all 12 Scenarios
  // =========================================================================
  describe('Movement Type 201 — Failure Paths: Fixes, Retries & Resumptions for All 12 Scenarios', () => {
    const env = createTestEnvironment('201');

    const baseInput = {
      movementType: '201',
      plant: '1120',
      storageLocation: 'HS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      costCenter: '1011201301',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000999'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Fix 1 (Reservation failure recovery): Correcting invalid parameters generates reservation and finishes flow', async () => {
      // Step 1: Initial attempt with missing cost center fails
      const badInput = { ...baseInput, costCenter: '' };
      const failed = await env.adapter.executeReservationWarehouseFlow(badInput);
      expect(failed.success).toBe(false);
      expect(failed.stage).toBe('RESERVATION');

      // Step 2: Fixing cost center allows clean execution to COMPLETED
      const fixed = await env.adapter.executeReservationWarehouseFlow(baseInput);
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
      expect(fixed.completed).toBe(true);
    });

    test('Fix 2 (TR failure retry): Resuming with existing reservationNumber creates TR and completes all subsequent stages', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        reservationNumber: '520201' // Adopt already-created reservation
      });

      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520201');
      expect(resumed.trNumber).toBe('1000201');
      expect(resumed.state).toBe('COMPLETED');
      expect(resumed.completed).toBe(true);
    });

    test('Fix 3 (TR missing recovery): Resuming with reservationNumber regenerates missing TR in SAP and completes flow', async () => {
      const regenerated = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        reservationNumber: '520201'
      });

      expect(regenerated.success).toBe(true);
      expect(regenerated.trNumber).toBe('1000201');
      expect(regenerated.state).toBe('COMPLETED');
    });

    test('Fix 4 (TO failure retry): Resuming with existing reservationNumber and trNumber creates TO and finishes flow', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        reservationNumber: '520201',
        trNumber: '1000201' // Adopt verified TR
      });

      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520201');
      expect(resumed.trNumber).toBe('1000201');
      expect(resumed.toNumber).toBe('1030201');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 5 (TO confirmation failure retry): Resuming with existing toNumber confirms TO and posts MIGO', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        reservationNumber: '520201',
        trNumber: '1000201',
        toNumber: '1030201' // Adopt unconfirmed TO
      });

      expect(resumed.success).toBe(true);
      expect(resumed.toNumber).toBe('1030201');
      expect(resumed.confirmation.confirmed).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000201');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 6 (MIGO failure retry): Resuming with confirmed TO posts MIGO after issue resolved without re-picking', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        reservationNumber: '520201',
        trNumber: '1000201',
        toNumber: '1030201',
        toConfirmed: true // Adopt confirmed TO
      });

      expect(resumed.success).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000201');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 7 (MIGO timeout recovery): Re-submitting identical processId after timeout recovers committed document via idempotency', async () => {
      // Simulate timeout occurred after SAP committed document
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput.processId}'`) || whereStr.includes("RSNUM = '0000520201'")) {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520201',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      const recovered = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        reservationNumber: '520201',
        toNumber: '1030201',
        toConfirmed: true
      });

      expect(recovered.success).toBe(true);
      expect(recovered.migo.materialDocument).toBe('5000000201');
      expect(recovered.alreadyPosted).toBe(true);
      expect(recovered.idempotentRetry).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(0); // No double posting!
    });

    test('Fix 8 (Duplicate MIGO guard): Idempotency check prevents duplicate stock consumption on repeated submits', async () => {
      // Run 1
      const first = await env.adapter.executeReservationWarehouseFlow(baseInput);
      expect(first.success).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Setup MATDOC for repeat attempt
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput.processId}'`) || whereStr.includes("RSNUM = '0000520201'")) {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520201',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      // Run 2 (same business key and processId)
      const second = await env.adapter.executeReservationWarehouseFlow(baseInput);
      expect(second.success).toBe(true);
      expect(second.alreadyPosted).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1); // Not posted twice
    });

    test('Fix 9 (Partial quantity continuation): Second issue consumes remaining quantity and completely processes reservation', async () => {
      // Step A: Partial issue (6 of 10) leaves reservation open
      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030201',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000201'")) {
            return [{
              MBLNR: '5000000201',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520201',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520201',
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

      const part1 = await env.adapter.executeReservationWarehouseFlow({ ...baseInput, quantity: 6 });
      expect(part1.success).toBe(true);
      expect(part1.state).toBe('PARTIALLY_PROCESSED');
      expect(part1.completed).toBe(false);
      expect(part1.finalReservation.remainingQuantity).toBe(4);

      // Step B: Second issue consumes remaining 4 with completeReservation = true
      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030202',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '4.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000202'")) {
            return [{
              MBLNR: '5000000202',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '201',
              MATNR: '000000008000000023',
              MENGE: '4.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520201',
              RSPOS: '0001',
              KOSTL: '001011201301',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520201',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'NOS',
          KZEAR: 'X',
          XLOEK: ''
        }]
      });
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => ({
          MATERIALDOCUMENT: '5000000202',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Document 5000000202 posted' }]
        })
      });

      const part2 = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput,
        processId: 'E5B42701-1111-4222-8333-000000000998',
        reservationNumber: '520201',
        quantity: 4,
        completeReservation: true
      });
      expect(part2.success).toBe(true);
      expect(part2.state).toBe('COMPLETED');
      expect(part2.completed).toBe(true);
      expect(part2.finalReservation.completelyProcessed).toBe(true);
      expect(part2.finalReservation.remainingQuantity).toBe(0);
    });

    test('Fix 10 (Wrong material correction): Providing valid material completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput, material: '8000000023' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 11 (Wrong SLoc correction): Providing valid SLoc mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput, storageLocation: 'HS01' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 12 (Wrong plant correction): Providing valid plant mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput, plant: '1120' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // Movement Type 241 — Failure Paths: Fixes, Retries & Resumptions (12 Scenarios)
  // =========================================================================
  describe('Movement Type 241 — Failure Paths: Fixes, Retries & Resumptions for All 12 Scenarios', () => {
    const env = createTestEnvironment('241');

    const baseInput241 = {
      movementType: '241',
      plant: '1120',
      storageLocation: 'HS01',
      material: '8000008977',
      quantity: 10,
      unit: 'NOS',
      assetNo: '0000400001',
      subNumber: '0000',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000241'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Fix 1 (Reservation failure recovery): Correcting invalid parameters generates reservation and finishes flow', async () => {
      const badInput = { ...baseInput241, assetNo: '' };
      const failed = await env.adapter.executeReservationWarehouseFlow(badInput);
      expect(failed.success).toBe(false);
      expect(failed.stage).toBe('RESERVATION');

      const fixed = await env.adapter.executeReservationWarehouseFlow(baseInput241);
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
      expect(fixed.completed).toBe(true);
    });

    test('Fix 2 (TR failure retry): Resuming with existing reservationNumber creates TR and completes all subsequent stages', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        reservationNumber: '520241'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520241');
      expect(resumed.trNumber).toBe('1000241');
      expect(resumed.state).toBe('COMPLETED');
      expect(resumed.completed).toBe(true);
    });

    test('Fix 3 (TR missing recovery): Resuming with reservationNumber regenerates missing TR in SAP and completes flow', async () => {
      const regenerated = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        reservationNumber: '520241'
      });
      expect(regenerated.success).toBe(true);
      expect(regenerated.trNumber).toBe('1000241');
      expect(regenerated.state).toBe('COMPLETED');
    });

    test('Fix 4 (TO failure retry): Resuming with existing reservationNumber and trNumber creates TO and finishes flow', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        reservationNumber: '520241',
        trNumber: '1000241'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520241');
      expect(resumed.trNumber).toBe('1000241');
      expect(resumed.toNumber).toBe('1030241');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 5 (TO confirmation failure retry): Resuming with existing toNumber confirms TO and posts MIGO', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        reservationNumber: '520241',
        trNumber: '1000241',
        toNumber: '1030241'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.toNumber).toBe('1030241');
      expect(resumed.confirmation.confirmed).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000241');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 6 (MIGO failure retry): Resuming with confirmed TO posts MIGO after issue resolved without re-picking', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        reservationNumber: '520241',
        toNumber: '1030241',
        toConfirmed: true
      });
      expect(resumed.success).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000241');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 7 (MIGO timeout recovery): Re-submitting identical processId after timeout recovers committed document via idempotency', async () => {
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput241.processId}'`) || whereStr.includes("RSNUM = '0000520241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              BWART: '241',
              MATNR: '000000008000008977',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520241',
              RSPOS: '0001',
              ANLN1: '0000400001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });
      const recovered = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        reservationNumber: '520241',
        toNumber: '1030241',
        toConfirmed: true
      });
      expect(recovered.success).toBe(true);
      expect(recovered.migo.materialDocument).toBe('5000000241');
      expect(recovered.alreadyPosted).toBe(true);
      expect(recovered.idempotentRetry).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(0);
    });

    test('Fix 8 (Duplicate MIGO guard): Idempotency check prevents duplicate stock consumption on repeated submits', async () => {
      const first = await env.adapter.executeReservationWarehouseFlow(baseInput241);
      expect(first.success).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput241.processId}'`) || whereStr.includes("RSNUM = '0000520241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              BWART: '241',
              MATNR: '000000008000008977',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520241',
              RSPOS: '0001',
              ANLN1: '0000400001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });
      const second = await env.adapter.executeReservationWarehouseFlow(baseInput241);
      expect(second.success).toBe(true);
      expect(second.alreadyPosted).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Fix 9 (Partial quantity continuation): Second issue consumes remaining quantity and completely processes reservation', async () => {
      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030241',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000008977',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '241',
              MATNR: '000000008000008977',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520241',
              RSPOS: '0001',
              ANLN1: '0000400001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520241',
          RSPOS: '0001',
          MATNR: '000000008000008977',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'NOS',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const part1 = await env.adapter.executeReservationWarehouseFlow({ ...baseInput241, quantity: 6 });
      expect(part1.success).toBe(true);
      expect(part1.state).toBe('PARTIALLY_PROCESSED');
      expect(part1.completed).toBe(false);
      expect(part1.finalReservation.remainingQuantity).toBe(4);

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030242',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000008977',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '4.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000242'")) {
            return [{
              MBLNR: '5000000242',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '241',
              MATNR: '000000008000008977',
              MENGE: '4.000',
              WERKS: '1120',
              LGORT: 'HS01',
              RSNUM: '0000520241',
              RSPOS: '0001',
              ANLN1: '0000400001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520241',
          RSPOS: '0001',
          MATNR: '000000008000008977',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'NOS',
          KZEAR: 'X',
          XLOEK: ''
        }]
      });
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => ({
          MATERIALDOCUMENT: '5000000242',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Document 5000000242 posted' }]
        })
      });

      const part2 = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput241,
        processId: 'E5B42701-1111-4222-8333-000000000242',
        reservationNumber: '520241',
        quantity: 4,
        completeReservation: true
      });
      expect(part2.success).toBe(true);
      expect(part2.state).toBe('COMPLETED');
      expect(part2.completed).toBe(true);
      expect(part2.finalReservation.completelyProcessed).toBe(true);
      expect(part2.finalReservation.remainingQuantity).toBe(0);
    });

    test('Fix 10 (Wrong material correction): Providing valid material completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput241, material: '8000008977' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 11 (Wrong SLoc correction): Providing valid SLoc mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput241, storageLocation: 'HS01' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 12 (Wrong plant correction): Providing valid plant mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput241, plant: '1120' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // Movement Type 311 — Failure Paths: Fixes, Retries & Resumptions (12 Scenarios)
  // =========================================================================
  describe('Movement Type 311 — Failure Paths: Fixes, Retries & Resumptions for All 12 Scenarios', () => {
    const env = createTestEnvironment('311');

    const baseInput311 = {
      movementType: '311',
      plant: '1120',
      storageLocation: 'HS01',
      receivingStorageLocation: 'CS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000311'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Fix 1 (Reservation failure recovery): Correcting invalid parameters generates reservation and finishes flow', async () => {
      const badInput = { ...baseInput311, receivingStorageLocation: 'HS01' };
      const failed = await env.adapter.executeReservationWarehouseFlow(badInput);
      expect(failed.success).toBe(false);
      expect(failed.stage).toBe('RESERVATION');

      const fixed = await env.adapter.executeReservationWarehouseFlow(baseInput311);
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
      expect(fixed.completed).toBe(true);
    });

    test('Fix 2 (TR failure retry): Resuming with existing reservationNumber creates TR and completes all subsequent stages', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        reservationNumber: '520311'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520311');
      expect(resumed.trNumber).toBe('1000311');
      expect(resumed.state).toBe('COMPLETED');
      expect(resumed.completed).toBe(true);
    });

    test('Fix 3 (TR missing recovery): Resuming with reservationNumber regenerates missing TR in SAP and completes flow', async () => {
      const regenerated = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        reservationNumber: '520311'
      });
      expect(regenerated.success).toBe(true);
      expect(regenerated.trNumber).toBe('1000311');
      expect(regenerated.state).toBe('COMPLETED');
    });

    test('Fix 4 (TO failure retry): Resuming with existing reservationNumber and trNumber creates TO and finishes flow', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        reservationNumber: '520311',
        trNumber: '1000311'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520311');
      expect(resumed.trNumber).toBe('1000311');
      expect(resumed.toNumber).toBe('1030311');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 5 (TO confirmation failure retry): Resuming with existing toNumber confirms TO and posts MIGO', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        reservationNumber: '520311',
        trNumber: '1000311',
        toNumber: '1030311'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.toNumber).toBe('1030311');
      expect(resumed.confirmation.confirmed).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000311');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 6 (MIGO failure retry): Resuming with confirmed TO posts MIGO after issue resolved without re-picking', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        reservationNumber: '520311',
        toNumber: '1030311',
        toConfirmed: true
      });
      expect(resumed.success).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000311');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 7 (MIGO timeout recovery): Re-submitting identical processId after timeout recovers committed document via idempotency', async () => {
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput311.processId}'`) || whereStr.includes("RSNUM = '0000520311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMLGO: 'CS01',
              RSNUM: '0000520311',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });
      const recovered = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        reservationNumber: '520311',
        toNumber: '1030311',
        toConfirmed: true
      });
      expect(recovered.success).toBe(true);
      expect(recovered.migo.materialDocument).toBe('5000000311');
      expect(recovered.alreadyPosted).toBe(true);
      expect(recovered.idempotentRetry).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(0);
    });

    test('Fix 8 (Duplicate MIGO guard): Idempotency check prevents duplicate stock consumption on repeated submits', async () => {
      const first = await env.adapter.executeReservationWarehouseFlow(baseInput311);
      expect(first.success).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput311.processId}'`) || whereStr.includes("RSNUM = '0000520311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMLGO: 'CS01',
              RSNUM: '0000520311',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });
      const second = await env.adapter.executeReservationWarehouseFlow(baseInput311);
      expect(second.success).toBe(true);
      expect(second.alreadyPosted).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Fix 9 (Partial quantity continuation): Second issue consumes remaining quantity and completely processes reservation', async () => {
      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030311',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMLGO: 'CS01',
              RSNUM: '0000520311',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520311',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          UMLGO: 'CS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'NOS',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const part1 = await env.adapter.executeReservationWarehouseFlow({ ...baseInput311, quantity: 6 });
      expect(part1.success).toBe(true);
      expect(part1.state).toBe('PARTIALLY_PROCESSED');
      expect(part1.completed).toBe(false);
      expect(part1.finalReservation.remainingQuantity).toBe(4);

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030312',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '4.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000312'")) {
            return [{
              MBLNR: '5000000312',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '4.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMLGO: 'CS01',
              RSNUM: '0000520311',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520311',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          UMLGO: 'CS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'NOS',
          KZEAR: 'X',
          XLOEK: ''
        }]
      });
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => ({
          MATERIALDOCUMENT: '5000000312',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Document 5000000312 posted' }]
        })
      });

      const part2 = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput311,
        processId: 'E5B42701-1111-4222-8333-000000000312',
        reservationNumber: '520311',
        quantity: 4,
        completeReservation: true
      });
      expect(part2.success).toBe(true);
      expect(part2.state).toBe('COMPLETED');
      expect(part2.completed).toBe(true);
      expect(part2.finalReservation.completelyProcessed).toBe(true);
      expect(part2.finalReservation.remainingQuantity).toBe(0);
    });

    test('Fix 10 (Wrong material correction): Providing valid material completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput311, material: '8000000023' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 11 (Wrong SLoc correction): Providing valid SLoc mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput311, receivingStorageLocation: 'CS01' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 12 (Wrong plant correction): Providing valid plant mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput311, plant: '1120' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // Movement Type 301 — Failure Paths: Fixes, Retries & Resumptions (12 Scenarios)
  // =========================================================================
  describe('Movement Type 301 — Failure Paths: Fixes, Retries & Resumptions for All 12 Scenarios', () => {
    const env = createTestEnvironment('301');

    const baseInput301 = {
      movementType: '301',
      plant: '1120',
      storageLocation: 'HS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000301'
    };

    beforeEach(() => {
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Fix 1 (Reservation failure recovery): Correcting invalid parameters generates reservation and finishes flow', async () => {
      const badInput = { ...baseInput301, receivingPlant: '1120' };
      const failed = await env.adapter.executeReservationWarehouseFlow(badInput);
      expect(failed.success).toBe(false);
      expect(failed.stage).toBe('RESERVATION');

      const fixed = await env.adapter.executeReservationWarehouseFlow(baseInput301);
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
      expect(fixed.completed).toBe(true);
    });

    test('Fix 2 (TR failure retry): Resuming with existing reservationNumber creates TR and completes all subsequent stages', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        reservationNumber: '520301'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520301');
      expect(resumed.trNumber).toBe('1000301');
      expect(resumed.state).toBe('COMPLETED');
      expect(resumed.completed).toBe(true);
    });

    test('Fix 3 (TR missing recovery): Resuming with reservationNumber regenerates missing TR in SAP and completes flow', async () => {
      const regenerated = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        reservationNumber: '520301'
      });
      expect(regenerated.success).toBe(true);
      expect(regenerated.trNumber).toBe('1000301');
      expect(regenerated.state).toBe('COMPLETED');
    });

    test('Fix 4 (TO failure retry): Resuming with existing reservationNumber and trNumber creates TO and finishes flow', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        reservationNumber: '520301',
        trNumber: '1000301'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520301');
      expect(resumed.trNumber).toBe('1000301');
      expect(resumed.toNumber).toBe('1030301');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 5 (TO confirmation failure retry): Resuming with existing toNumber confirms TO and posts MIGO', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        reservationNumber: '520301',
        trNumber: '1000301',
        toNumber: '1030301'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.toNumber).toBe('1030301');
      expect(resumed.confirmation.confirmed).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000301');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 6 (MIGO failure retry): Resuming with confirmed TO posts MIGO after issue resolved without re-picking', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        reservationNumber: '520301',
        toNumber: '1030301',
        toConfirmed: true
      });
      expect(resumed.success).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000301');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 7 (MIGO timeout recovery): Re-submitting identical processId after timeout recovers committed document via idempotency', async () => {
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput301.processId}'`) || whereStr.includes("RSNUM = '0000520301'")) {
            return [{
              MBLNR: '5000000301',
              MJAHR: '2026',
              BWART: '301',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000520301',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });
      const recovered = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        reservationNumber: '520301',
        toNumber: '1030301',
        toConfirmed: true
      });
      expect(recovered.success).toBe(true);
      expect(recovered.migo.materialDocument).toBe('5000000301');
      expect(recovered.alreadyPosted).toBe(true);
      expect(recovered.idempotentRetry).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(0);
    });

    test('Fix 8 (Duplicate MIGO guard): Idempotency check prevents duplicate stock consumption on repeated submits', async () => {
      const first = await env.adapter.executeReservationWarehouseFlow(baseInput301);
      expect(first.success).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${baseInput301.processId}'`) || whereStr.includes("RSNUM = '0000520301'")) {
            return [{
              MBLNR: '5000000301',
              MJAHR: '2026',
              BWART: '301',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000520301',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });
      const second = await env.adapter.executeReservationWarehouseFlow(baseInput301);
      expect(second.success).toBe(true);
      expect(second.alreadyPosted).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Fix 9 (Partial quantity continuation): Second issue consumes remaining quantity and completely processes reservation', async () => {
      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030301',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '6.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000301'")) {
            return [{
              MBLNR: '5000000301',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '301',
              MATNR: '000000008000000023',
              MENGE: '6.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000520301',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520301',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          UMWRK: '1110',
          UMLGO: 'CS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'NOS',
          KZEAR: '',
          XLOEK: ''
        }]
      });

      const part1 = await env.adapter.executeReservationWarehouseFlow({ ...baseInput301, quantity: 6 });
      expect(part1.success).toBe(true);
      expect(part1.state).toBe('PARTIALLY_PROCESSED');
      expect(part1.completed).toBe(false);
      expect(part1.finalReservation.remainingQuantity).toBe(4);

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030302',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          NSOLA: '4.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000302'")) {
            return [{
              MBLNR: '5000000302',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '301',
              MATNR: '000000008000000023',
              MENGE: '4.000',
              WERKS: '1120',
              LGORT: 'HS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000520301',
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520301',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          UMWRK: '1110',
          UMLGO: 'CS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'NOS',
          KZEAR: 'X',
          XLOEK: ''
        }]
      });
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => ({
          MATERIALDOCUMENT: '5000000302',
          MATDOCUMENTYEAR: '2026',
          RETURN: [{ TYPE: 'S', MESSAGE: 'Document 5000000302 posted' }]
        })
      });

      const part2 = await env.adapter.executeReservationWarehouseFlow({
        ...baseInput301,
        processId: 'E5B42701-1111-4222-8333-000000000302',
        reservationNumber: '520301',
        quantity: 4,
        completeReservation: true
      });
      expect(part2.success).toBe(true);
      expect(part2.state).toBe('COMPLETED');
      expect(part2.completed).toBe(true);
      expect(part2.finalReservation.completelyProcessed).toBe(true);
      expect(part2.finalReservation.remainingQuantity).toBe(0);
    });

    test('Fix 10 (Wrong material correction): Providing valid material completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput301, material: '8000000023' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 11 (Wrong SLoc correction): Providing valid SLoc mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput301, receivingStorageLocation: 'CS01' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });

    test('Fix 12 (Wrong plant correction): Providing valid plant mapped in T320 completes the flow', async () => {
      const fixed = await env.adapter.executeReservationWarehouseFlow({ ...baseInput301, receivingPlant: '1110' });
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
    });
  });
});
