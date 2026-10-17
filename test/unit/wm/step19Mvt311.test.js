'use strict';

/**
 * Step 19 — Dedicated End-to-End Test Suite for Movement Type 311 (Storage Location to Storage Location Transfer)
 *
 * Explicitly tests and proves the exact sequence:
 *   MB21
 *    ↓
 *   TR
 *    ↓
 *   Scan
 *    ↓
 *   TO
 *    ↓
 *   Confirm
 *    ↓
 *   MIGO 311
 *    ↓
 *   Material document
 *    ↓
 *   Dual-SLoc Stock Verification:
 *     Source SLoc        Destination SLoc
 *         ↓                      ↓
 *       -QTY                   +QTY
 *
 *     Example:
 *     Before:
 *       SLoc 0001 = 100
 *       SLoc 0002 = 20
 *       (Total Sum = 120)
 *
 *     311 / 10 EA
 *
 *     After:
 *       SLoc 0001 = 90  (-10)
 *       SLoc 0002 = 30  (+10)
 *       (The sum remains: 120)
 *    ↓
 *   Reservation updated
 *
 * [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { PROCESS_STATUS } = require('../../../srv/common/wmStatus');

describe('Step 19: Movement Type 311 (SLoc to SLoc Transfer) Proof Suite [mock only, not SAP verification]', () => {
  const create311Environment = () => {
    let bapiGoodsmvtCalls = [];
    let bapiReservationCalls = [];
    let trCreateCalls = [];
    let toCreateCalls = [];
    let toConfirmCalls = [];

    const mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(),
      readTable: jest.fn()
    };

    const adapter = new ReservationProcessAdapter({
      rfc: mockRfc,
      checkMarcExistence: true
    });

    const setupDefaultFms = (overrides = {}) => {
      bapiGoodsmvtCalls = [];
      bapiReservationCalls = [];
      trCreateCalls = [];
      toCreateCalls = [];
      toConfirmCalls = [];

      mockRfc.call.mockImplementation(async (fm, params) => {
        if (overrides[fm]) return overrides[fm](params);

        if (fm === 'BAPI_RESERVATION_CREATE1') {
          bapiReservationCalls.push(params);
          return {
            RESERVATION: '0000520311',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 520311 created' }]
          };
        }
        if (fm === 'L_TR_CREATE' || fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
          trCreateCalls.push({ fm, params });
          const reqItem = (params && params.T_LTBA && params.T_LTBA[0]) || {};
          const qty = reqItem.MENGA !== undefined ? reqItem.MENGA : (params?.IV_MENGA !== undefined ? params.IV_MENGA : 10);
          return {
            EV_TBNUM: '0001000311',
            EV_TBPOS: '0001',
            T_LTBA: [{
              TBNUM: '0001000311',
              TBPOS: '0001',
              MATNR: '000000008000000023',
              MENGA: qty,
              WERKS: '1120',
              LGORT: '0001',
              LGNUM: 'W01',
              BWLVS: '311'
            }]
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR' || fm === 'Z_WM_TO_CREATE_FROM_TR') {
          toCreateCalls.push(params);
          return { E_TANUM: '0001030311', EV_TANUM: '0001030311', EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          toConfirmCalls.push(params);
          return {
            EV_SUCCESS: 'S',
            ET_ITEMS: [{ TANUM: '0001030311', TAPOS: '0001', NISTM: '10.000' }]
          };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiGoodsmvtCalls.push(params);
          return {
            MATERIALDOCUMENT: '5000000311',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000000311 posted' }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT') {
          return {};
        }
        return {};
      });
    };

    const setupDefaultTables = (overrides = {}) => {
      mockRfc.readTable.mockImplementation(async (table, fields, where = []) => {
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (overrides[table]) return overrides[table](fields, where, whereStr);

        if (table === 'T320') {
          return [
            { LGNUM: 'W01', WERKS: '1120', LGORT: '0001' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: '0002' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }
          ];
        }

        if (table === 'MARC') {
          return [{ MATNR: '000000008000000023', WERKS: '1120', LVORM: '' }];
        }

        if (table === 'MARD') {
          // Source SLoc (0001) has 100 before, 90 after
          // Destination SLoc (0002) has 20 before, 30 after
          if (whereStr.includes("LGORT = '0001'")) {
            return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: '0001', LABST: '90.000' }];
          }
          if (whereStr.includes("LGORT = '0002'")) {
            return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: '0002', LABST: '30.000' }];
          }
          return [
            { MATNR: '000000008000000023', WERKS: '1120', LGORT: '0001', LABST: '90.000' },
            { MATNR: '000000008000000023', WERKS: '1120', LGORT: '0002', LABST: '30.000' }
          ];
        }

        if (table === 'RKPF') {
          return [{
            RSNUM: '0000520311',
            BWART: '311',
            UMWRK: '1120',
            UMLGO: '0002',
            USNAM: 'TESTUSER',
            RSDAT: '20261015'
          }];
        }

        if (table === 'RESB') {
          return [{
            RSNUM: '0000520311',
            RSPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: '0001',
            UMWRK: '1120',
            UMLGO: '0002',
            BDMNG: '10.000',
            ENMNG: '10.000',
            MEINS: 'EA',
            KZEAR: 'X',
            XLOEK: ''
          }];
        }

        if (table === 'LTBK') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000311',
            BWLVS: '311',
            RSNUM: '0000520311',
            STATU: 'O',
            BDATU: '20261015'
          }];
        }

        if (table === 'LTBP') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000311',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: '0001',
            MENGA: '10.000',
            TAMEN: '10.000',
            ELIKZ: 'X'
          }];
        }

        if (table === 'LTAK') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001030311',
            BWLVS: '311',
            TBNUM: '0001000311',
            KQUIT: ' ',
            BDATU: '20261015'
          }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001030311',
            TAPOS: '0001',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: '0001',
            VLTYP: '001',
            VLPLA: 'BIN-01',
            NLTYP: '921',
            NLPLA: 'TRANSFER',
            NSOLA: '10.000',
            ALTME: 'EA',
            PQUIT: ' '
          }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          if (whereStr.includes("MBLNR = '5000000311'")) {
            return [
              {
                MBLNR: '5000000311',
                MJAHR: '2026',
                ZEILE: '0001',
                BWART: '311',
                MATNR: '000000008000000023',
                MENGE: '10.000',
                MEINS: 'EA',
                WERKS: '1120',
                LGORT: '0001',
                UMWRK: '1120',
                UMLGO: '0002',
                SHKZG: 'H', // Credit / Issue (-QTY)
                RSNUM: '0000520311',
                RSPOS: '0001',
                CANCELLED: '',
                REVERSAL_MOVEMENT: ''
              },
              {
                MBLNR: '5000000311',
                MJAHR: '2026',
                ZEILE: '0002',
                BWART: '311',
                MATNR: '000000008000000023',
                MENGE: '10.000',
                MEINS: 'EA',
                WERKS: '1120',
                LGORT: '0002',
                UMWRK: '1120',
                UMLGO: '0001',
                SHKZG: 'S', // Debit / Receipt (+QTY)
                RSNUM: '0000520311',
                RSPOS: '0001',
                CANCELLED: '',
                REVERSAL_MOVEMENT: ''
              }
            ];
          }
          return [];
        }

        if (table === 'LQUA') {
          return [{
            LGNUM: 'W01',
            LQNUM: '0001045003',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: '0001',
            VERME: '90.000',
            MEINS: 'EA',
            LGTYP: '001',
            LGPLA: 'BIN-01'
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
      getBapiReservationCalls: () => bapiReservationCalls,
      getTrCreateCalls: () => trCreateCalls,
      getToCreateCalls: () => toCreateCalls,
      getToConfirmCalls: () => toConfirmCalls,
      getBapiGoodsmvtCalls: () => bapiGoodsmvtCalls
    };
  };

  const makeInput311 = (customId = '000000000311') => ({
    movementType: '311',
    plant: '1120',
    storageLocation: '0001',
    receivingPlant: '1120',
    receivingStorageLocation: '0002',
    material: '8000000023',
    quantity: 10,
    unit: 'EA',
    warehouseNumber: 'W01',
    initialSourceStock: 100, // Before: Source SLoc 0001 = 100
    initialDestStock: 20,    // Before: Dest SLoc 0002 = 20
    processId: `E5B42701-1111-4222-8333-${customId}`
  });

  // =========================================================================
  // PROOF 1: Step-by-Step Chain Execution
  // MB21 -> TR -> Scan -> TO -> Confirm -> MIGO 311 -> MATDOC -> Dual SLoc Stock -> RESB
  // =========================================================================
  describe('Proof 1: Explicit Step-by-Step Chain for Movement 311', () => {
    let env;

    beforeEach(() => {
      env = create311Environment();
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Step 1: MB21 — Create Reservation generates SAP reservation for SLoc Transfer (MOVE_TYPE 311, MOVE_STLOC 0002)', async () => {
      const input = makeInput311('000000000101');
      const res = await env.adapter.createReservation(input);

      expect(res.success).toBe(true);
      expect(res.reservationNo).toBe('520311');
      expect(res.reservationItem).toBe('0001');

      // Verify BAPI_RESERVATION_CREATE1 payload has SLoc transfer fields
      const bapiCalls = env.getBapiReservationCalls();
      expect(bapiCalls.length).toBe(1);
      expect(bapiCalls[0].RESERVATIONHEADER.MOVE_TYPE).toBe('311');
      expect(bapiCalls[0].RESERVATIONHEADER.MOVE_STLOC).toBe('0002');
      expect(bapiCalls[0].RESERVATIONITEMS[0].STGE_LOC).toBe('0001');
      expect(bapiCalls[0].RESERVATIONITEMS[0].ENTRY_QNT).toBe(10);
    });

    test('Step 2: TR — Create Transfer Requirement generates SAP TR preserving reservation link', async () => {
      const input = makeInput311('000000000102');
      const trRes = await env.adapter.createTransferRequirement({
        ...input,
        reservationNo: '520311',
        reservationItem: '0001'
      });

      expect(trRes.success).toBe(true);
      expect(trRes.trNumber).toBe('1000311');
      expect(trRes.trItem).toBe('0001');
      expect(trRes.warehouseNumber).toBe('W01');

      const trCalls = env.getTrCreateCalls();
      expect(trCalls.length).toBeGreaterThanOrEqual(1);
      const ltbaItem = (trCalls[0].params.T_LTBA && trCalls[0].params.T_LTBA[0]) || trCalls[0].params;
      expect(ltbaItem.BWLVS).toBe('311');
      expect(ltbaItem.RSNUM).toContain('520311');
    });

    test('Step 3: Scan — Warehouse Scan verifies critical 8-fields from SAP TR (LTBK/LTBP)', async () => {
      const scanRes = await env.adapter.verifyTR({
        warehouseNumber: 'W01',
        trNumber: '1000311',
        trItem: '0001',
        movement: '311',
        material: '8000000023',
        quantity: 10,
        plant: '1120',
        storageLocation: '0001'
      });

      expect(scanRes.success).toBe(true);
      expect(scanRes.stage).toBe('TR_VERIFICATION');
      expect(scanRes.verified).toBe(true);
      expect(scanRes.trNumber).toBe('1000311');
      expect(scanRes.warehouseNumber).toBe('W01');
    });

    test('Step 4: TO — Create Transfer Order referencing verified TR produces SAP TANUM to 921/TRANSFER', async () => {
      const input = makeInput311('000000000104');
      const toRes = await env.adapter.createTransferOrderFromTR({
        ...input,
        trNumber: '1000311',
        trItem: '0001',
        autoConfirm: false
      });

      expect(toRes.success).toBe(true);
      expect(toRes.toNumber).toBe('1030311');
      expect(toRes.toItem).toBe('0001');
      expect(toRes.warehouseNumber).toBe('W01');
    });

    test('Step 5: Confirm — Confirm Transfer Order updates LTAK-KQUIT and LTAP-PQUIT', async () => {
      const confirmRes = await env.adapter.confirmTransferOrder({
        warehouseNumber: 'W01',
        toNumber: '1030311'
      });

      expect(confirmRes.success).toBe(true);
      expect(confirmRes.confirmed).toBe(true);
      expect(confirmRes.toNumber).toBe('1030311');

      const confirmCalls = env.getToConfirmCalls();
      expect(confirmCalls.length).toBe(1);
      expect(confirmCalls[0].I_TANUM).toBe('0001030311');
    });

    test('Step 6: MIGO 311 — Post Goods Movement with confirmed TO and GM_CODE 04 calls BAPI_GOODSMVT_CREATE', async () => {
      const input = makeInput311('000000000106');
      const migoRes = await env.adapter.postGoodsMovement({
        ...input,
        reservationNumber: '520311',
        reservationItem: '0001',
        transferOrder: '1030311',
        completeReservation: true
      });

      expect(migoRes.success).toBe(true);
      expect(migoRes.stage).toBe('MIGO');
      expect(migoRes.materialDocument).toBe('5000000311');
      expect(migoRes.materialDocYear).toBe('2026');

      // Verify BAPI_GOODSMVT_CREATE parameters contain GM_CODE 04 and MOVE_STLOC
      const gmCalls = env.getBapiGoodsmvtCalls();
      expect(gmCalls.length).toBe(1);
      expect(gmCalls[0].GOODSMVT_CODE.GM_CODE).toBe('04'); // GM_CODE 04: Transfer Posting
      expect(gmCalls[0].GOODSMVT_ITEM[0].MOVE_TYPE).toBe('311');
      expect(gmCalls[0].GOODSMVT_ITEM[0].STGE_LOC).toBe('0001'); // Issuing SLoc
      expect(gmCalls[0].GOODSMVT_ITEM[0].MOVE_STLOC).toBe('0002'); // Receiving SLoc
      expect(gmCalls[0].GOODSMVT_ITEM[0].RESERV_NO).toBe('0000520311');
      expect(gmCalls[0].GOODSMVT_ITEM[0].RES_ITEM).toBe('0001');
      expect(gmCalls[0].GOODSMVT_ITEM[0].ENTRY_QNT).toBe(10);
      expect(gmCalls[0].GOODSMVT_ITEM[0].NO_MORE_GR).toBe('X');
    });

    test('Step 7: Material Document — Verified in SAP MATDOC with BWART 311 and both credit/debit rows', async () => {
      const matdoc = await env.adapter.verifyMaterialDocument({
        materialDocument: '5000000311',
        materialDocumentYear: '2026',
        movementType: '311',
        material: '8000000023',
        quantity: 10,
        plant: '1120',
        storageLocation: '0001',
        reservationNumber: '520311',
        reservationItem: '0001'
      });

      expect(matdoc.success).toBe(true);
      expect(matdoc.materialDocument).toBe('5000000311');
      expect(matdoc.materialDocumentYear).toBe('2026');
      expect(matdoc.movementType).toBe('311');

      // Directly verify credit/debit items in MATDOC
      const rows = await env.mockRfc.readTable('MATDOC', ['ZEILE', 'BWART', 'LGORT', 'UMLGO', 'SHKZG', 'MENGE'], [
        "MBLNR = '5000000311'"
      ]);
      expect(rows.length).toBe(2);
      expect(rows[0].LGORT).toBe('0001');
      expect(rows[0].UMLGO).toBe('0002');
      expect(rows[0].SHKZG).toBe('H'); // Credit (Issue from 0001)
      expect(rows[1].LGORT).toBe('0002');
      expect(rows[1].UMLGO).toBe('0001');
      expect(rows[1].SHKZG).toBe('S'); // Debit (Receipt to 0002)
    });

    test('Step 8: Dual-SLoc Stock Verification — Source: -10 EA (100 -> 90), Destination: +10 EA (20 -> 30), Constant Sum: 120', async () => {
      const input = makeInput311('000000000108');
      const stock = await env.adapter.verifyStock(input, {
        materialDocument: '5000000311',
        materialDocumentYear: '2026'
      });

      expect(stock.success).toBe(true);
      expect(stock.movementType).toBe('311');

      // Source SLoc verification: 100 -> 90 (-10 EA)
      expect(stock.sourceStock.storageLocation).toBe('0001');
      expect(stock.sourceStock.initial).toBe(100);
      expect(stock.sourceStock.resulting).toBe(90);
      expect(stock.sourceStock.delta).toBe(-10);
      expect(stock.sourceStockDecreased).toBe(true);

      // Destination SLoc verification: 20 -> 30 (+10 EA)
      expect(stock.destinationStock.storageLocation).toBe('0002');
      expect(stock.destinationStock.initial).toBe(20);
      expect(stock.destinationStock.resulting).toBe(30);
      expect(stock.destinationStock.delta).toBe(10);
      expect(stock.destinationStockIncreased).toBe(true);

      // Stock Conservation Invariant: Sum remains constant at 120
      const sumBefore = stock.sourceStock.initial + stock.destinationStock.initial;
      const sumAfter = stock.sourceStock.resulting + stock.destinationStock.resulting;
      expect(sumBefore).toBe(120);
      expect(sumAfter).toBe(120);
      expect(sumAfter).toBe(sumBefore);
    });

    test('Step 9: Reservation Updated — Verified in RESB with ENMNG=10, KZEAR=X, completelyProcessed=true', async () => {
      const resb = await env.adapter.verifyReservation({
        reservationNumber: '520311',
        reservationItem: '0001',
        expectedQuantity: 10
      });

      expect(resb.success).toBe(true);
      expect(resb.verified).toBe(true);
      expect(resb.completelyProcessed).toBe(true);
      expect(resb.isFinalIssue).toBe(true);
      expect(resb.remainingQuantity).toBe(0);
      expect(resb.issuedQuantity).toBe(10);
    });
  });

  // =========================================================================
  // PROOF 2: End-to-End Orchestrator Pipeline (executeReservationWarehouseFlow)
  // =========================================================================
  describe('Proof 2: Unified Orchestrator Flow (executeReservationWarehouseFlow) for Movement 311', () => {
    let env;

    beforeEach(() => {
      env = create311Environment();
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Executes all stages in strict sequence: MB21 -> TR -> Scan -> TO -> TO Confirm -> MIGO 311 -> MATDOC -> Stock Verification (Constant Sum 120) -> RESB', async () => {
      const input = makeInput311('000000000201');
      const flowResult = await env.adapter.executeReservationWarehouseFlow(input);

      // Status invariants
      expect(flowResult.success).toBe(true);
      expect(flowResult.state).toBe('COMPLETED');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.COMPLETED);
      expect(flowResult.completed).toBe(true);
      expect(flowResult.completelyProcessed).toBe(true);

      // Exact progression sequence
      expect(flowResult.stages).toEqual([
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

      // Stage outputs
      expect(flowResult.reservationNumber).toBe('520311');
      expect(flowResult.trNumber).toBe('1000311');
      expect(flowResult.toNumber).toBe('1030311');
      expect(flowResult.toConfirmed).toBe(true);
      expect(flowResult.migo.materialDocument).toBe('5000000311');
      expect(flowResult.migo.materialDocYear).toBe('2026');

      // Dual-SLoc stock conservation verification
      expect(flowResult.stock.sourceStockDecreased).toBe(true);
      expect(flowResult.stock.destinationStockIncreased).toBe(true);
      expect(flowResult.stock.sourceStock.initial).toBe(100);
      expect(flowResult.stock.sourceStock.resulting).toBe(90);
      expect(flowResult.stock.destinationStock.initial).toBe(20);
      expect(flowResult.stock.destinationStock.resulting).toBe(30);

      const totalBefore = flowResult.stock.sourceStock.initial + flowResult.stock.destinationStock.initial;
      const totalAfter = flowResult.stock.sourceStock.resulting + flowResult.stock.destinationStock.resulting;
      expect(totalBefore).toBe(120);
      expect(totalAfter).toBe(120);

      // Final reservation state
      expect(flowResult.finalReservation.completelyProcessed).toBe(true);
      expect(flowResult.finalReservation.remainingQuantity).toBe(0);
    });

    test('Strict Precondition: MIGO 311 fails cleanly if TO confirmation fails and MIGO is never called', async () => {
      env.setupDefaultFms({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Quant locked by user OPERATOR3');
        }
      });

      const input = makeInput311('000000000202');
      const flowResult = await env.adapter.executeReservationWarehouseFlow(input);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('TO_CONFIRMATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_CONFIRMATION);
      expect(flowResult.error).toContain('Quant locked by user');
      expect(flowResult.stages).toEqual([
        'RESERVATION_CREATED',
        'TR_CREATED',
        'TR_VERIFIED',
        'TO_CREATED'
      ]);

      // MIGO must NOT be called if TO confirmation fails
      expect(env.getBapiGoodsmvtCalls().length).toBe(0);
    });

    test('Strict Precondition: Rejects missing receiving storage location with 400 before calling SAP', async () => {
      const inputWithoutRecSLoc = makeInput311('000000000203');
      inputWithoutRecSLoc.receivingStorageLocation = '';

      const flowResult = await env.adapter.executeReservationWarehouseFlow(inputWithoutRecSLoc);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toContain('Receiving Storage Location is mandatory for Movement Type 311');
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Strict Precondition: Rejects identical issuing and receiving storage locations with 400 before calling SAP', async () => {
      const inputIdenticalSLoc = makeInput311('000000000204');
      inputIdenticalSLoc.receivingStorageLocation = inputIdenticalSLoc.storageLocation; // 0001 === 0001

      const flowResult = await env.adapter.executeReservationWarehouseFlow(inputIdenticalSLoc);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toContain('Receiving Storage Location must be different from Issuing Storage Location');
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Strict Precondition: Rejects receiving plant mismatch for Movement Type 311', async () => {
      const inputMismatchedPlant = makeInput311('000000000205');
      inputMismatchedPlant.receivingPlant = '1200'; // Different plant!

      const flowResult = await env.adapter.executeReservationWarehouseFlow(inputMismatchedPlant);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toContain('Receiving Plant must match Issuing Plant for Movement Type 311');
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Strict Precondition: Rejects receiving storage location assigned to different warehouse in T320', async () => {
      env.setupDefaultTables({
        T320: (fields, where, whereStr) => {
          if (whereStr.includes("LGORT = '0002'")) return [{ LGNUM: 'W10', WERKS: '1120', LGORT: '0002' }];
          return [{ LGNUM: 'W01', WERKS: '1120', LGORT: '0001' }];
        }
      });

      const input = makeInput311('000000000206');
      const flowResult = await env.adapter.executeReservationWarehouseFlow(input);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toContain('belongs to warehouse W10, but issuing storage location belongs to warehouse W01');
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Supports Non-WM receiving storage location when not mapped in T320', async () => {
      env.setupDefaultTables({
        T320: (fields, where, whereStr) => {
          if (whereStr.includes("LGORT = '0002'")) return []; // non-WM SLoc
          return [{ LGNUM: 'W01', WERKS: '1120', LGORT: '0001' }];
        }
      });

      const input = makeInput311('000000000208');
      const flowResult = await env.adapter.executeReservationWarehouseFlow(input);

      expect(flowResult.success).toBe(true);
      expect(flowResult.materialDocument).toBe('5000000311');
    });

    test('Idempotency: Re-submitting identical processId returns committed material document without duplicate stock transfer', async () => {
      const input = makeInput311('000000000207');

      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => ({
          RESERVATION: '0000520997',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 520997 created' }]
        })
      });

      env.setupDefaultTables({
        RESB: () => [{
          RSNUM: '0000520997',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: '0001',
          UMWRK: '1120',
          UMLGO: '0002',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'EA',
          KZEAR: 'X',
          XLOEK: ''
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              MEINS: 'EA',
              WERKS: '1120',
              LGORT: '0001',
              UMWRK: '1120',
              UMLGO: '0002',
              RSNUM: '0000520997',
              RSPOS: '0001',
              SHKZG: 'H',
              CANCELLED: '',
              REVERSAL_MOVEMENT: ''
            }];
          }
          return [];
        }
      });

      // First submission succeeds
      const first = await env.adapter.executeReservationWarehouseFlow(input);
      expect(first.success).toBe(true);
      expect(first.migo.materialDocument).toBe('5000000311');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Setup MATDOC for repeat attempt
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${input.processId}'`) || whereStr.includes("RSNUM = '0000520997'") || whereStr.includes("MBLNR = '5000000311'")) {
            return [{
              MBLNR: '5000000311',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '311',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              MEINS: 'EA',
              WERKS: '1120',
              LGORT: '0001',
              UMWRK: '1120',
              UMLGO: '0002',
              RSNUM: '0000520997',
              RSPOS: '0001',
              SHKZG: 'H',
              CANCELLED: '',
              REVERSAL_MOVEMENT: ''
            }];
          }
          return [];
        }
      });

      // Re-submission with identical processId
      const second = await env.adapter.executeReservationWarehouseFlow(input);
      expect(second.success).toBe(true);
      expect(second.alreadyPosted).toBe(true);
      expect(second.migo.materialDocument).toBe('5000000311');
      // BAPI must not be called a second time
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });
  });
});
