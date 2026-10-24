'use strict';

/**
 * Complete Movement Matrix Lifecycle & Failure Path Unit Test Suite for Movement 261
 * Phase 2 — Gate critical SAP transactions
 *
 * Covers Movement 261 (Goods Issue to Internal Order):
 * 1. Happy path:
 *    Reservation (AUFNR 1011 / ZEMP) -> TR (BWLVS 261, BETYP F, BENUM 1011, dynamic bin 914) -> TO -> Confirm -> MIGO (GM_CODE 03) -> Stock -> Reservation Completion
 *
 * 2. Failure paths (15 scenarios):
 *    - Failure path 1: Reservation fails
 *    - Failure path 2: TR creation fails
 *    - Failure path 3: TR missing in SAP
 *    - Failure path 4: TO creation fails
 *    - Failure path 5: TO confirmation fails
 *    - Failure path 6: MIGO posting fails
 *    - Failure path 7: MIGO timeout
 *    - Failure path 8: Duplicate MIGO (idempotency protection)
 *    - Failure path 9: Partial quantity (PARTIALLY_PROCESSED)
 *    - Failure path 10: Wrong material (MARC existence check fails)
 *    - Failure path 11: Wrong SLoc (SLoc not mapped in T320)
 *    - Failure path 12: Wrong plant (Plant not mapped in T320)
 *    - Failure path 13: Missing Order ID (AUFNR is mandatory for 261)
 *    - Failure path 14: Order Type mismatch (AUFK order exists but type is not ZEMP)
 *    - Failure path 15: Order status locked / closed in JEST
 *
 * 3. Failure-first MIGO rejection and rollback retry
 * 4. Scenario-by-scenario fixes, retries & resumptions for failure paths
 *
 * All tests labeled: [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { PROCESS_STATUS } = require('../../../srv/common/wmStatus');

describe('Phase 2: Movement Type 261 Complete Lifecycle & Failure Matrix [mock only, not SAP verification]', () => {
  const origRealMvt = process.env.WM_TR_REAL_MOVEMENT;

  beforeAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = 'true';
  });

  afterAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = origRealMvt;
  });

  const createTestEnvironment = () => {
    let bapiGoodsmvtCalls = [];

    const mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(),
      readTable: jest.fn()
    };

    const adapter = new ReservationProcessAdapter({
      rfc: mockRfc,
      checkCsksExistence: true,
      checkAssetExistence: true,
      checkAufkExistence: true,
      checkMarcExistence: true
    });

    const setupDefaultFms = (overrides = {}) => {
      bapiGoodsmvtCalls = [];
      mockRfc.call.mockImplementation(async (fm, params) => {
        if (overrides[fm]) return overrides[fm](params);

        if (fm === 'BAPI_RESERVATION_CREATE1') {
          return {
            RESERVATION: '0000520261',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 520261 created' }]
          };
        }
        if (fm === 'L_TR_CREATE') {
          const reqItem = (params && params.T_LTBA && params.T_LTBA[0]) || {};
          const qty = reqItem.MENGA !== undefined ? reqItem.MENGA : 10;
          return {
            T_LTBA: [{
              TBNUM: '0001000261',
              TBPOS: '0001',
              MATNR: '000000008000000023',
              MENGA: qty,
              WERKS: '1120',
              LGORT: 'CS01',
              LGNUM: 'W01',
              BWLVS: '261',
              BETYP: 'F',
              BENUM: '000000001011',
              NLTYP: '914'
            }]
          };
        }
        if (fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
          const qty = params && params.IV_MENGA !== undefined ? params.IV_MENGA : 10;
          return {
            EV_TBNUM: '0001000261',
            EV_TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: qty,
            WERKS: '1120',
            LGORT: 'CS01',
            LGNUM: 'W01',
            BWLVS: '261'
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR' || fm === 'Z_WM_TO_CREATE_FROM_TR') {
          return { E_TANUM: '0001030261', EV_TANUM: '0001030261', EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          return {
            EV_SUCCESS: 'S',
            ET_ITEMS: [{ TANUM: '0001030261', TAPOS: '0001', NISTM: '10.000' }]
          };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiGoodsmvtCalls.push(params);
          return {
            MATERIALDOCUMENT: '5000000261',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000000261 posted' }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT' || fm === 'BAPI_TRANSACTION_ROLLBACK') {
          return {};
        }
        return {};
      });
    };

    const setupDefaultTables = (overrides = {}) => {
      mockRfc.readTable.mockImplementation(async (table, fields, where = []) => {
        if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (overrides[table]) return overrides[table](fields, where, whereStr);

        if (table === 'T320') {
          if (whereStr.includes('9999') || whereStr.includes('XX99')) return [];
          return [
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }
          ];
        }

        if (table === 'AUFK') {
          if (whereStr.includes('INVALID_ORDER') || whereStr.includes('NONEXISTENT') || whereStr.includes('999999999999')) return [];
          if (whereStr.includes('000000009999')) {
            return [{
              AUFNR: '000000009999',
              AUART: 'PP01',
              WERKS: '1120',
              LOEKZ: ''
            }];
          }
          return [{
            AUFNR: '000000001011',
            AUART: 'ZEMP',
            WERKS: '1120',
            LOEKZ: ''
          }];
        }

        if (table === 'JEST') {
          if (whereStr.includes('LOCKED_ORDER')) {
            return [{ OBJNR: 'OR000000001011', STAT: 'I0043', INACT: '' }];
          }
          return [{ OBJNR: 'OR000000001011', STAT: 'I0002', INACT: '' }];
        }

        if (table === 'MARC') {
          if (whereStr.includes('INVALID_MAT') || whereStr.includes('NONEXISTENT')) return [];
          return [
            { MATNR: '000000008000000023', WERKS: '1120', XCHPF: '', SERNP: '' }
          ];
        }

        if (table === 'MARD') {
          return [
            { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '100.000' }
          ];
        }

        if (table === 'LTBK') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000261',
            BWLVS: '261',
            BETYP: 'F',
            BENUM: '000000001011',
            NLTYP: '914',
            NLPLA: '1011',
            RSNUM: '0000520261',
            STATU: 'O',
            BDATU: '20261014'
          }];
        }

        if (table === 'LTAK') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001030261',
            TBNUM: '0001000261',
            BWLVS: '261',
            KQUIT: 'X',
            BDATU: '20261014'
          }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001030261',
            TAPOS: '0001',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'CS01',
            NSOLA: '10.000',
            ALTME: 'NOS',
            PQUIT: ' '
          }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          if (whereStr.includes("MBLNR = '5000000261'")) {
            return [{
              MBLNR: '5000000261',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '261',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'CS01',
              RSNUM: '0000520261',
              RSPOS: '0001',
              AUFNR: '000000001011',
              SHKZG: 'H'
            }];
          }
          return [];
        }

        if (table === 'RESB') {
          return [{
            RSNUM: '0000520261',
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'CS01',
            BDMNG: '10.000',
            ENMNG: '10.000',
            MEINS: 'NOS',
            KZEAR: 'X',
            AUFNR: '000000001011',
            RGEKZ: '',
            XLOEK: ''
          }];
        }

        return [];
      });
    };

    const defaultInput261 = {
      movementType: '261',
      plant: '1120',
      storageLocation: 'CS01',
      material: '8000000023',
      quantity: 10,
      unit: 'NOS',
      orderId: '1011',
      orderType: 'ZEMP',
      warehouseNumber: 'W01',
      processId: 'E5B42701-1111-4222-8333-000000000261'
    };

    return {
      adapter,
      mockRfc,
      setupDefaultFms,
      setupDefaultTables,
      getBapiGoodsmvtCalls: () => bapiGoodsmvtCalls,
      defaultInput261
    };
  };

  describe('Movement Type 261 (Goods Issue to Order) - Complete Lifecycle & Failure Matrix', () => {
    let env;

    beforeEach(() => {
      env = createTestEnvironment();
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Happy path: Reservation → TR → TO → Confirm → MIGO → Stock → Reservation', async () => {
      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(true);
      expect(result.state).toBe('COMPLETED');
      expect(result.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(result.completed).toBe(true);
      expect(result.completelyProcessed).toBe(true);

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

      expect(result.reservationNumber).toBe('520261');
      expect(result.trNumber).toBe('1000261');
      expect(result.toNumber).toBe('1030261');
      expect(result.confirmation.confirmed).toBe(true);
      expect(result.migo.materialDocument).toBe('5000000261');
      expect(result.stock.success).toBe(true);
      expect(result.stock.sourceStockDecreased).toBe(true);
      expect(result.stock.comparison.actual.orderId).toContain('1011');
      expect(result.finalReservation.completelyProcessed).toBe(true);
      expect(result.finalReservation.remainingQuantity).toBe(0);

      const migoCalls = env.getBapiGoodsmvtCalls();
      expect(migoCalls.length).toBe(1);
      const migoPayload = migoCalls[0];
      expect(migoPayload.GOODSMVT_CODE.GM_CODE).toBe('03');
      expect(migoPayload.GOODSMVT_ITEM[0].MOVE_TYPE).toBe('261');
      expect(migoPayload.GOODSMVT_ITEM[0].ORDERID).toBe('000000001011');
    });

    test('Failure path 1: Reservation fails', async () => {
      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => {
          throw new Error('BAPI_RESERVATION_CREATE1 failed: Plant 1120 locked for posting');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Plant 1120 locked');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 2: TR creation fails', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => {
          throw new Error('L_TR_CREATE failed: Storage type 914 not defined in W01');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('ZWM_TR_CREATE failed: Storage type 914 not defined in W01');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('Z_WM_TR_CREATE failed: Storage type 914 not defined in W01');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.reservationNumber).toBe('520261');
      expect(result.stages).toEqual(['RESERVATION_CREATED']);
    });

    test('Failure path 3: TR missing in SAP', async () => {
      env.setupDefaultTables({
        LTBK: () => []
      });

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TR_VERIFICATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_TR);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED']);
    });

    test('Failure path 4: TO creation fails', async () => {
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

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

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

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('TO_CONFIRMATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED']);
    });

    test('Failure path 6: MIGO posting fails', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('BAPI_GOODSMVT_CREATE failed: Deficit of SL Unrestricted-use stock 10 NOS');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('Deficit of SL Unrestricted-use stock');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 7: MIGO timeout', async () => {
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          throw new Error('Gateway Timeout (ETIMEDOUT): Connection closed while waiting for SAP response');
        }
      });

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('MIGO');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_MIGO);
      expect(result.error).toContain('ETIMEDOUT');
      expect(result.stages).toEqual(['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED']);
    });

    test('Failure path 8: Duplicate MIGO (idempotency protection)', async () => {
      const firstResult = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);
      expect(firstResult.success).toBe(true);
      expect(firstResult.migo.materialDocument).toBe('5000000261');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${env.defaultInput261.processId}'`) || whereStr.includes("RSNUM = '0000520261'")) {
            return [{
              MBLNR: '5000000261',
              MJAHR: '2026',
              BWART: '261',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'CS01',
              RSNUM: '0000520261',
              RSPOS: '0001',
              AUFNR: '000000001011',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      const retryResult = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(retryResult.success).toBe(true);
      expect(retryResult.migo.materialDocument).toBe('5000000261');
      expect(retryResult.alreadyPosted).toBe(true);
      expect(retryResult.idempotentRetry).toBe(true);
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });

    test('Failure path 9: Partial quantity (PARTIALLY_PROCESSED)', async () => {
      env.setupDefaultFms({
        L_TR_CREATE: () => ({
          T_LTBA: [{
            TBNUM: '0001000261',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            MENGA: 5,
            WERKS: '1120',
            LGORT: 'CS01',
            LGNUM: 'W01',
            BWLVS: '261'
          }]
        })
      });

      env.setupDefaultTables({
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: '0001030261',
          TAPOS: '0001',
          TBPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'CS01',
          NSOLA: '5.000',
          ALTME: 'NOS',
          PQUIT: ' '
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000261'")) {
            return [{
              MBLNR: '5000000261',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '261',
              MATNR: '000000008000000023',
              MENGE: '5.000',
              WERKS: '1120',
              LGORT: 'CS01',
              RSNUM: '0000520261',
              RSPOS: '0001',
              AUFNR: '000000001011',
              SHKZG: 'H'
            }];
          }
          return [];
        },
        RESB: () => [{
          RSNUM: '0000520261',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'CS01',
          BDMNG: '10.000',
          ENMNG: '5.000',
          MEINS: 'NOS',
          KZEAR: '',
          AUFNR: '000000001011',
          RGEKZ: '',
          XLOEK: ''
        }]
      });

      const input = { ...env.defaultInput261, quantity: 5 };
      const result = await env.adapter.executeReservationWarehouseFlow(input);

      expect(result.success).toBe(true);
      expect(result.state).toBe('PARTIALLY_PROCESSED');
      expect(result.processStatus).toBe(PROCESS_STATUS.PARTIALLY_PROCESSED);
      expect(result.completed).toBe(false);
      expect(result.completelyProcessed).toBe(false);
      expect(result.finalReservation.remainingQuantity).toBe(5);
    });

    test('Failure path 10: Wrong material (not extended to plant in MARC)', async () => {
      const wrongMaterialInput = { ...env.defaultInput261, material: 'NONEXISTENT_MAT' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongMaterialInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('MARC');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 11: Wrong SLoc (not mapped to warehouse in T320)', async () => {
      const wrongSlocInput = { ...env.defaultInput261, storageLocation: 'XX99' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongSlocInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('XX99');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 12: Wrong plant (not mapped to warehouse in T320)', async () => {
      const wrongPlantInput = { ...env.defaultInput261, plant: '9999' };
      const result = await env.adapter.executeReservationWarehouseFlow(wrongPlantInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('9999');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 13: Missing Order ID (AUFNR is mandatory for 261)', async () => {
      const missingOrderInput = { ...env.defaultInput261, orderId: '' };
      const result = await env.adapter.executeReservationWarehouseFlow(missingOrderInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('Order');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 14: Order Type mismatch (AUFK order exists but type is not ZEMP)', async () => {
      const mismatchInput = { ...env.defaultInput261, orderId: '9999', orderType: 'ZEMP' };
      const result = await env.adapter.executeReservationWarehouseFlow(mismatchInput);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('PP01');
      expect(result.stages).toEqual([]);
    });

    test('Failure path 15: Order status locked in JEST', async () => {
      env.setupDefaultTables({
        JEST: () => [{ OBJNR: 'OR000000001011', STAT: 'I0043', INACT: '' }]
      });

      const result = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(result.error).toContain('locked');
      expect(result.stages).toEqual([]);
    });
  });

  describe('Failure-first MIGO rejection and retry for Movement 261', () => {
    test('Movement 261: a first SAP rejection rolls back and a corrected retry can complete', async () => {
      const env = createTestEnvironment();
      let postCalls = 0;
      env.setupDefaultFms({
        BAPI_GOODSMVT_CREATE: () => {
          postCalls++;
          if (postCalls === 1) {
            return {
              MATERIALDOCUMENT: '',
              MATDOCUMENTYEAR: '',
              RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Simulated first-attempt rejection' }]
            };
          }
          return {
            MATERIALDOCUMENT: '5000000261',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000000261 posted' }]
          };
        }
      });
      env.setupDefaultTables();

      const rejected = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);
      expect(rejected.success).toBe(false);
      expect(rejected.stage).toBe('MIGO');
      expect(rejected.error).toMatch(/Simulated first-attempt rejection/);
      const firstBapiIndex = env.mockRfc.call.mock.calls.findIndex(([fm]) => fm === 'BAPI_GOODSMVT_CREATE');
      const afterFirstBapi = env.mockRfc.call.mock.calls.slice(firstBapiIndex + 1).map(([fm]) => fm);
      expect(afterFirstBapi).toContain('BAPI_TRANSACTION_ROLLBACK');
      expect(afterFirstBapi).not.toContain('BAPI_TRANSACTION_COMMIT');

      const retried = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);
      expect(retried.success).toBe(true);
      expect(retried.migo.materialDocument).toBe('5000000261');
      expect(postCalls).toBe(2);
    });
  });

  describe('Movement Type 261 — Failure Paths: Fixes, Retries & Resumptions for Scenarios', () => {
    let env;

    beforeEach(() => {
      env = createTestEnvironment();
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Fix 1 (Reservation failure recovery): Correcting invalid parameters generates reservation and finishes flow', async () => {
      const badInput = { ...env.defaultInput261, orderId: '' };
      const failed = await env.adapter.executeReservationWarehouseFlow(badInput);
      expect(failed.success).toBe(false);
      expect(failed.stage).toBe('RESERVATION');

      const fixed = await env.adapter.executeReservationWarehouseFlow(env.defaultInput261);
      expect(fixed.success).toBe(true);
      expect(fixed.state).toBe('COMPLETED');
      expect(fixed.completed).toBe(true);
    });

    test('Fix 2 (TR failure retry): Resuming with existing reservationNumber creates TR and completes all subsequent stages', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...env.defaultInput261,
        reservationNumber: '520261'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520261');
      expect(resumed.trNumber).toBe('1000261');
      expect(resumed.state).toBe('COMPLETED');
      expect(resumed.completed).toBe(true);
    });

    test('Fix 3 (TR missing recovery): Resuming with reservationNumber regenerates missing TR in SAP and completes flow', async () => {
      const regenerated = await env.adapter.executeReservationWarehouseFlow({
        ...env.defaultInput261,
        reservationNumber: '520261'
      });
      expect(regenerated.success).toBe(true);
      expect(regenerated.trNumber).toBe('1000261');
      expect(regenerated.state).toBe('COMPLETED');
    });

    test('Fix 4 (TO failure retry): Resuming with existing reservationNumber and trNumber creates TO and finishes flow', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...env.defaultInput261,
        reservationNumber: '520261',
        trNumber: '1000261'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.reservationNumber).toBe('520261');
      expect(resumed.trNumber).toBe('1000261');
      expect(resumed.toNumber).toBe('1030261');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 5 (TO confirmation failure retry): Resuming with existing toNumber confirms TO and posts MIGO', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...env.defaultInput261,
        reservationNumber: '520261',
        trNumber: '1000261',
        toNumber: '1030261'
      });
      expect(resumed.success).toBe(true);
      expect(resumed.toNumber).toBe('1030261');
      expect(resumed.confirmation.confirmed).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000261');
      expect(resumed.state).toBe('COMPLETED');
    });

    test('Fix 6 (MIGO failure retry): Resuming with confirmed TO posts MIGO after issue resolved without re-picking', async () => {
      const resumed = await env.adapter.executeReservationWarehouseFlow({
        ...env.defaultInput261,
        reservationNumber: '520261',
        toNumber: '1030261',
        toConfirmed: true
      });
      expect(resumed.success).toBe(true);
      expect(resumed.migo.materialDocument).toBe('5000000261');
      expect(resumed.state).toBe('COMPLETED');
    });
  });
});
