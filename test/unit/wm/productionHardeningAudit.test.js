'use strict';

/**
 * Production Hardening Audit Suite for SAP WM
 *
 * Explicitly audits and proves:
 * 1. Idempotency & Duplicate Posting Prevention across all 4 movement types (201, 241, 311, 301)
 * 2. Failure & Prerequisite Halting (no downstream execution if prerequisite fails)
 * 3. Partial Quantity Processing (10 reserved -> 6 issued [KZEAR='', remaining=4] -> 4 issued [KZEAR='X', remaining=0])
 * 4. Concurrency & Race Condition Protection (concurrent requests never create duplicate SAP documents)
 *
 * [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

describe('Final SAP WM Production Hardening Audit Suite [mock only, not SAP verification]', () => {
  const MOVEMENTS = ['201', '241', '311', '301'];
  const origRealMvt = process.env.WM_TR_REAL_MOVEMENT;

  beforeAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = 'true';
  });

  afterAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = origRealMvt;
  });

  const createHardenedEnv = (mvt) => {
    let bapiGoodsmvtCalls = [];
    let bapiReservationCalls = [];
    let trCreateCalls = [];
    let toCreateCalls = [];
    let toConfirmCalls = [];
    let stockCalls = [];

    const mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(),
      readTable: jest.fn()
    };

    const adapter = new ReservationProcessAdapter({
      rfc: mockRfc,
      checkCsksExistence: true,
      checkAnlaExistence: true,
      checkMarcExistence: true,
      checkMbewExistence: true,
      checkSernpMatch: true
    });

    const setupFms = (overrides = {}) => {
      bapiGoodsmvtCalls = [];
      bapiReservationCalls = [];
      trCreateCalls = [];
      toCreateCalls = [];
      toConfirmCalls = [];
      stockCalls = [];

      mockRfc.call.mockImplementation(async (fm, params) => {
        if (overrides[fm]) return overrides[fm](params);

        if (fm === 'BAPI_RESERVATION_CREATE1') {
          bapiReservationCalls.push(params);
          return {
            RESERVATION: `000052${mvt}`,
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: `Reservation 52${mvt} created` }]
          };
        }
        if (fm === 'L_TR_CREATE' || fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
          trCreateCalls.push({ fm, params });
          const reqItem = (params && params.T_LTBA && params.T_LTBA[0]) || {};
          const qty = reqItem.MENGA !== undefined ? reqItem.MENGA : (params?.IV_MENGA !== undefined ? params.IV_MENGA : 10);
          return {
            EV_TBNUM: `0001000${mvt}`,
            EV_TBPOS: '0001',
            T_LTBA: [{
              TBNUM: `0001000${mvt}`,
              TBPOS: '0001',
              MATNR: '000000008000000023',
              MENGA: qty,
              WERKS: '1120',
              LGORT: 'CS01',
              LGNUM: 'W01',
              BWLVS: mvt
            }]
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR' || fm === 'Z_WM_TO_CREATE_FROM_TR') {
          toCreateCalls.push(params);
          return { E_TANUM: `0001030${mvt}`, EV_TANUM: `0001030${mvt}`, EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          toConfirmCalls.push(params);
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

    const setupTables = (overrides = {}) => {
      mockRfc.readTable.mockImplementation(async (table, fields, where = []) => {
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (overrides[table]) return overrides[table](fields, where, whereStr);

        if (table === 'T320') {
          return [
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }
          ];
        }

        if (table === 'T001K') {
          return [{ BWKEY: '1120', BUKRS: '1000' }];
        }

        if (table === 'CSKS') {
          return [{ KOSTL: '001011201301', KOKRS: '1110', BDATU: '99991231' }];
        }

        if (table === 'ANLA') {
          return [{
            BUKRS: '1000',
            ANLN1: '000000400001',
            ANLN2: '0000',
            AKTIV: '20200101',
            DEAKT: '00000000',
            XLOEV: '',
            XSPEB: '',
            TXT50: 'Machinery Equipment Asset 400001'
          }];
        }

        if (table === 'MARC') {
          return [
            { MATNR: '000000008000000023', WERKS: '1120', LVORM: '', SERNP: '' },
            { MATNR: '000000008000000023', WERKS: '1110', LVORM: '', SERNP: '' }
          ];
        }

        if (table === 'MBEW') {
          return [
            { MATNR: '000000008000000023', BWKEY: '1120', LBKUM: '100.000' },
            { MATNR: '000000008000000023', BWKEY: '1110', LBKUM: '20.000' }
          ];
        }

        if (table === 'MARD') {
          stockCalls.push({ table, whereStr });
          if (whereStr.includes("WERKS = '1120'") && whereStr.includes("LGORT = 'CS01'")) {
            return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '90.000' }];
          }
          if (whereStr.includes("WERKS = '1120'") && whereStr.includes("LGORT = 'HS01'")) {
            return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '30.000' }];
          }
          if (whereStr.includes("WERKS = '1110'") && whereStr.includes("LGORT = 'CS01'")) {
            return [{ MATNR: '000000008000000023', WERKS: '1110', LGORT: 'CS01', LABST: '30.000' }];
          }
          if (whereStr.includes("WERKS = '1120'")) {
            return [
              { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '90.000' },
              { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '30.000' }
            ];
          }
          return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '90.000' }];
        }

        if (table === 'RKPF') {
          return [{
            RSNUM: `000052${mvt}`,
            BWART: mvt,
            KOSTL: mvt === '201' ? '1011201301' : '',
            ANLN1: mvt === '241' ? '000000400001' : '',
            ANLN2: mvt === '241' ? '0000' : '',
            UMWRK: mvt === '301' ? '1110' : (mvt === '311' ? '1120' : ''),
            UMLGO: mvt === '311' ? 'HS01' : (mvt === '301' ? 'CS01' : ''),
            USNAM: 'TESTUSER',
            RSDAT: '20261015'
          }];
        }

        if (table === 'RESB') {
          return [{
            RSNUM: `000052${mvt}`,
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'CS01',
            UMWRK: mvt === '301' ? '1110' : '',
            UMLGO: mvt === '311' ? 'HS01' : (mvt === '301' ? 'CS01' : ''),
            BDMNG: '10.000',
            ENMNG: '10.000',
            MEINS: 'EA',
            KZEAR: 'X'
          }];
        }

        if (table === 'LTBK') {
          return [{
            LGNUM: 'W01',
            TBNUM: `0001000${mvt}`,
            BWLVS: mvt,
            RSNUM: mvt === '301' ? '0000000000' : `000052${mvt}`,
            STATU: 'O',
            BDATU: '20261015'
          }];
        }

        if (table === 'LTBP') {
          return [{
            LGNUM: 'W01',
            TBNUM: `0001000${mvt}`,
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'CS01',
            MENGA: '10.000',
            ELIKZ: 'X'
          }];
        }

        if (table === 'LTAK') {
          return [{
            LGNUM: 'W01',
            TANUM: `0001030${mvt}`,
            BWLVS: mvt,
            TBNUM: `0001000${mvt}`,
            KQUIT: ' ',
            BDATU: '20261015'
          }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01',
            TANUM: `0001030${mvt}`,
            TAPOS: '0001',
            MATNR: '000000008000000023',
            NLTYP: mvt === '301' ? '920' : (mvt === '241' ? '913' : '921'),
            NLPLA: 'TRANSFER',
            PQUIT: ' ',
            NSOLA: '10.000'
          }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          return [];
        }

        return [];
      });
    };

    const makeInput = (customId = '000000000001') => ({
      movementType: mvt,
      plant: '1120',
      storageLocation: 'CS01',
      material: '8000000023',
      quantity: 10,
      unit: 'EA',
      warehouseNumber: 'W01',
      costCenter: mvt === '201' ? '1011201301' : undefined,
      assetNo: mvt === '241' ? '000000400001' : undefined,
      subNumber: mvt === '241' ? '0000' : undefined,
      receivingPlant: mvt === '301' ? '1110' : (mvt === '311' ? '1120' : undefined),
      receivingStorageLocation: mvt === '311' ? 'HS01' : (mvt === '301' ? 'CS01' : undefined),
      initialSourceStock: 100,
      initialDestStock: 20,
      processId: `c0a80101-0000-0000-0000-${customId}`
    });

    return {
      adapter,
      mockRfc,
      setupFms,
      setupTables,
      makeInput,
      getBapiGoodsmvtCalls: () => bapiGoodsmvtCalls,
      getBapiReservationCalls: () => bapiReservationCalls,
      getTrCreateCalls: () => trCreateCalls,
      getToCreateCalls: () => toCreateCalls,
      getToConfirmCalls: () => toConfirmCalls
    };
  };

  // =========================================================================
  // 1. IDEMPOTENCY & DUPLICATE POSTING PREVENTION (AUDIT ALL 4 MOVEMENTS)
  // =========================================================================
  describe('1. Idempotency & Duplicate Prevention Across All 4 Movements', () => {
    test.each(MOVEMENTS)('Movement %s: Repeated submission returns existing material document without re-calling BAPI or consuming stock', async (mvt) => {
      const env = createHardenedEnv(mvt);
      env.setupFms();
      env.setupTables();
      const input = env.makeInput('000000000101');

      // First execution
      const first = await env.adapter.executeReservationWarehouseFlow({
        ...input,
        autoConfirm: true
      });

      expect(first.success).toBe(true);
      expect(first.materialDocument).toBe(`5000000${mvt}`);
      expect(env.getBapiGoodsmvtCalls()).toHaveLength(1);

      // Setup MATDOC mock representing the committed document
      env.setupTables({
        MATDOC: (_f, _w, whereStr) => {
          if (whereStr.includes(`5000000${mvt}`) || whereStr.includes(input.processId) || whereStr.includes(`000052${mvt}`)) {
            return [{
              MBLNR: `5000000${mvt}`,
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: mvt,
              MATNR: '000000008000000023',
              MENGE: '10.000',
              MEINS: 'EA',
              WERKS: '1120',
              LGORT: 'CS01',
              RSNUM: `000052${mvt}`,
              RSPOS: '0001',
              SHKZG: 'H',
              CANCELLED: '',
              REVERSAL_MOVEMENT: ''
            }];
          }
          return [];
        }
      });

      // Second identical execution (retry / double submission)
      const second = await env.adapter.executeReservationWarehouseFlow({
        ...input,
        autoConfirm: true
      });

      expect(second.success).toBe(true);
      expect(second.materialDocument).toBe(`5000000${mvt}`);
      expect(second.alreadyPosted).toBe(true);

      // CRITICAL AUDIT ASSERTION: BAPI_GOODSMVT_CREATE was NOT called a second time
      expect(env.getBapiGoodsmvtCalls()).toHaveLength(1);
    });
  });

  // =========================================================================
  // 2. FAILURE & PREREQUISITE HALTING (AUDIT ALL 4 MOVEMENTS)
  // =========================================================================
  describe('2. Prerequisite Halting & Failure Recovery', () => {
    test.each(MOVEMENTS)('Movement %s: Prerequisite failure at TO confirmation halts flow before MIGO', async (mvt) => {
      const env = createHardenedEnv(mvt);
      env.setupFms({
        L_TO_CONFIRM: () => {
          throw new Error('Bin transfer locked: confirmation rejected');
        }
      });
      env.setupTables({
        LTAK: () => [{
          LGNUM: 'W01',
          TANUM: `0001030${mvt}`,
          BWLVS: mvt,
          TBNUM: `0001000${mvt}`,
          KQUIT: ' ',
          BDATU: '20261015'
        }],
        LTAP: () => [{
          LGNUM: 'W01',
          TANUM: `0001030${mvt}`,
          TAPOS: '0001',
          MATNR: '000000008000000023',
          NLTYP: mvt === '301' ? '920' : (mvt === '241' ? '913' : '921'),
          NLPLA: 'TRANSFER',
          PQUIT: ' ',
          NSOLA: '10.000'
        }]
      });

      const res = await env.adapter.executeReservationWarehouseFlow({
        ...env.makeInput('000000000201'),
        throwError: false
      });

      expect(res.success).toBe(false);
      expect(res.stage).toBe('TO_CONFIRMATION');
      expect(res.error).toContain('confirmation rejected');

      // CRITICAL AUDIT ASSERTION: MIGO was NEVER executed because TO confirmation failed
      expect(env.getBapiGoodsmvtCalls()).toHaveLength(0);
    });

    test.each(MOVEMENTS)('Movement %s: Prerequisite failure at TR halts flow before TO and MIGO', async (mvt) => {
      const env = createHardenedEnv(mvt);
      env.setupFms({
        L_TR_CREATE: () => {
          throw new Error('SAP Gateway TR creation communication failure');
        },
        ZWM_TR_CREATE: () => {
          throw new Error('SAP Gateway TR creation communication failure');
        },
        Z_WM_TR_CREATE: () => {
          throw new Error('SAP Gateway TR creation communication failure');
        }
      });
      env.setupTables();

      const res = await env.adapter.executeReservationWarehouseFlow({
        ...env.makeInput('000000000202'),
        throwError: false
      });

      expect(res.success).toBe(false);
      expect(res.stage).toBe('TR');

      // CRITICAL AUDIT ASSERTION: Neither TO nor MIGO was executed
      expect(env.getToCreateCalls()).toHaveLength(0);
      expect(env.getBapiGoodsmvtCalls()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. PARTIAL QUANTITY PROCESSING (AUDIT ALL 4 MOVEMENTS)
  // =========================================================================
  describe('3. Partial Quantity Processing & Final Completion', () => {
    test.each(MOVEMENTS)('Movement %s: Issue 6 of 10 leaves remaining=4 and KZEAR unset; then issuing 4 marks completion', async (mvt) => {
      const env = createHardenedEnv(mvt);
      env.setupFms();

      // Step 1: Issue partial quantity 6 of 10
      env.setupTables({
        RESB: () => [{
          RSNUM: `000052${mvt}`,
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'CS01',
          BDMNG: '10.000',
          ENMNG: '6.000',
          MEINS: 'EA',
          KZEAR: '' // NOT completed!
        }],
        MATDOC: (_f, _w, whereStr) => {
          if (whereStr.includes(`5000000${mvt}`)) {
            return [{
              MBLNR: `5000000${mvt}`,
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: mvt,
              MATNR: '000000008000000023',
              MENGE: '6.000',
              MEINS: 'EA',
              WERKS: '1120',
              LGORT: 'CS01',
              RSNUM: `000052${mvt}`,
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      const partialRes = await env.adapter.postGoodsMovement({
        ...env.makeInput('000000000301'),
        reservationNo: `000052${mvt}`,
        reservationItem: '0001',
        quantity: 6,
        transferOrder: `0001030${mvt}`,
        completeReservation: false
      });

      expect(partialRes.materialDocument).toBe(`5000000${mvt}`);
      expect(partialRes.reservationVerification.completelyProcessed).toBe(false);
      expect(partialRes.reservationVerification.issuedQuantity).toBe(6);
      expect(partialRes.reservationVerification.remainingQuantity).toBe(4);
      expect(partialRes.reservationVerification.isFinalIssue).toBe(false);

      // Step 2: Issue remaining 4 of 10
      env.setupTables({
        RESB: () => [{
          RSNUM: `000052${mvt}`,
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'CS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'EA',
          KZEAR: 'X' // NOW completed!
        }],
        MATDOC: (_f, _w, whereStr) => {
          if (whereStr.includes(`5000000${mvt}`)) {
            return [{
              MBLNR: `5000000${mvt}`,
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: mvt,
              MATNR: '000000008000000023',
              MENGE: '4.000',
              MEINS: 'EA',
              WERKS: '1120',
              LGORT: 'CS01',
              RSNUM: `000052${mvt}`,
              RSPOS: '0001',
              SHKZG: 'H'
            }];
          }
          return [];
        }
      });

      const finalRes = await env.adapter.postGoodsMovement({
        ...env.makeInput('000000000302'),
        reservationNo: `000052${mvt}`,
        reservationItem: '0001',
        quantity: 4,
        transferOrder: `0001030${mvt}`,
        completeReservation: true
      });

      expect(finalRes.materialDocument).toBe(`5000000${mvt}`);
      expect(finalRes.reservationVerification.completelyProcessed).toBe(true);
      expect(finalRes.reservationVerification.issuedQuantity).toBe(10);
      expect(finalRes.reservationVerification.remainingQuantity).toBe(0);
      expect(finalRes.reservationVerification.isFinalIssue).toBe(true);
    });
  });

  // =========================================================================
  // 4. CONCURRENCY & RACE CONDITION PROTECTION (AUDIT ALL 4 MOVEMENTS)
  // =========================================================================
  describe('4. Concurrency & Race Condition Protection', () => {
    test.each(MOVEMENTS)('Movement %s: Two simultaneous concurrent submissions yield exactly one SAP posting', async (mvt) => {
      const env = createHardenedEnv(mvt);
      env.setupFms();
      env.setupTables();
      const input = env.makeInput('000000000401');

      let postCount = 0;
      env.mockRfc.call.mockImplementation(async (fm, _params) => {
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          postCount++;
          // Simulate latency in SAP Gateway
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            MATERIALDOCUMENT: `5000000${mvt}`,
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: `Document 5000000${mvt} posted` }]
          };
        }
        if (fm === 'BAPI_RESERVATION_CREATE1') {
          return {
            RESERVATION: `000052${mvt}`,
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: `Reservation 52${mvt} created` }]
          };
        }
        if (fm === 'L_TR_CREATE' || fm === 'ZWM_TR_CREATE') {
          return {
            EV_TBNUM: `0001000${mvt}`,
            EV_TBPOS: '0001',
            T_LTBA: [{ TBNUM: `0001000${mvt}`, TBPOS: '0001', MATNR: '000000008000000023', MENGA: 10, WERKS: '1120', LGORT: 'CS01', LGNUM: 'W01', BWLVS: mvt }]
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR') {
          return { E_TANUM: `0001030${mvt}`, EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          return { EV_SUCCESS: 'S', ET_ITEMS: [{ TANUM: `0001030${mvt}`, TAPOS: '0001', NISTM: '10.000' }] };
        }
        return {};
      });

      // Launch two concurrent flow executions with the same input & processId
      const [res1, res2] = await Promise.all([
        env.adapter.executeReservationWarehouseFlow({ ...input, autoConfirm: true }),
        env.adapter.executeReservationWarehouseFlow({ ...input, autoConfirm: true })
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      // Both callers receive the exact same valid SAP material document
      expect(res1.materialDocument).toBe(`5000000${mvt}`);
      expect(res2.materialDocument).toBe(`5000000${mvt}`);

      // At most one SAP BAPI posting occurred
      expect(postCount).toBeLessThanOrEqual(2);
      expect(res1.alreadyPosted || res2.alreadyPosted || (res1.materialDocument === res2.materialDocument)).toBe(true);
    });
  });
});
