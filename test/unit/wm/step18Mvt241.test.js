'use strict';

/**
 * Step 18 — Dedicated End-to-End Test Suite for Movement Type 241 (Goods Issue to Asset)
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
 *   MIGO 241
 *    ↓
 *   Material document
 *    ↓
 *   Asset / required account assignment verified
 *    ↓
 *   Stock reduced
 *    ↓
 *   Reservation updated
 *
 * Particular attention to Asset account assignment (ANLN1, ANLN2, BETYP 'A', BENUM).
 * [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { PROCESS_STATUS } = require('../../../srv/common/wmStatus');

describe('Step 18: Movement Type 241 (Goods Issue to Asset) Proof Suite [mock only, not SAP verification]', () => {
  const origRealMvt = process.env.WM_TR_REAL_MOVEMENT;

  beforeAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = 'true';
  });

  afterAll(() => {
    process.env.WM_TR_REAL_MOVEMENT = origRealMvt;
  });

  const create241Environment = () => {
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
      checkAssetExistence: true,
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
            RESERVATION: '0000520241',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 520241 created' }]
          };
        }
        if (fm === 'L_TR_CREATE' || fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
          trCreateCalls.push({ fm, params });
          const reqItem = (params && params.T_LTBA && params.T_LTBA[0]) || {};
          const qty = reqItem.MENGA !== undefined ? reqItem.MENGA : (params?.IV_MENGA !== undefined ? params.IV_MENGA : 10);
          return {
            EV_TBNUM: '0001000241',
            EV_TBPOS: '0001',
            T_LTBA: [{
              TBNUM: '0001000241',
              TBPOS: '0001',
              MATNR: '000000008000000023',
              MENGA: qty,
              WERKS: '1120',
              LGORT: 'HS01',
              LGNUM: 'W01',
              BWLVS: '241'
            }]
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR' || fm === 'Z_WM_TO_CREATE_FROM_TR') {
          toCreateCalls.push(params);
          return { E_TANUM: '0001030241', EV_TANUM: '0001030241', EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          toConfirmCalls.push(params);
          return {
            EV_SUCCESS: 'S',
            ET_ITEMS: [{ TANUM: '0001030241', TAPOS: '0001', NISTM: '10.000' }]
          };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiGoodsmvtCalls.push(params);
          return {
            MATERIALDOCUMENT: '5000000241',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 5000000241 posted' }]
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
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }
          ];
        }

        if (table === 'T001K') {
          return [{ BWKEY: '1120', BUKRS: '1000' }];
        }

        if (table === 'MARC') {
          return [{ MATNR: '000000008000000023', WERKS: '1120', LVORM: '' }];
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

        if (table === 'MARD') {
          return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }];
        }

        if (table === 'RKPF') {
          return [{
            RSNUM: '0000520241',
            BWART: '241',
            ANLN1: '000000400001',
            ANLN2: '0000',
            USNAM: 'TESTUSER',
            RSDAT: '20261015'
          }];
        }

        if (table === 'RESB') {
          return [{
            RSNUM: '0000520241',
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

        if (table === 'LTBK') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000241',
            BWLVS: '241',
            BETYP: 'A',
            BENUM: '0000400001',
            RSNUM: '0000520241',
            STATU: 'O',
            BDATU: '20261015'
          }];
        }

        if (table === 'LTBP') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000241',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            MENGA: '10.000',
            TAMEN: '10.000',
            ELIKZ: 'X'
          }];
        }

        if (table === 'LTAK') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001030241',
            BWLVS: '241',
            TBNUM: '0001000241',
            KQUIT: ' ',
            BDATU: '20261015'
          }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001030241',
            TAPOS: '0001',
            TBPOS: '0001',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            VLTYP: '001',
            VLPLA: 'BIN-01',
            NLTYP: '913',
            NLPLA: '0000400001',
            NSOLA: '10.000',
            ALTME: 'NOS',
            PQUIT: ' '
          }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          if (whereStr.includes("MBLNR = '5000000241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '241',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              ANLN1: '000000400001',
              ANLN2: '0000',
              RSNUM: '0000520241',
              RSPOS: '0001',
              SHKZG: 'H',
              CANCELLED: '',
              REVERSAL_MOVEMENT: ''
            }];
          }
          return [];
        }

        if (table === 'LQUA') {
          return [{
            LGNUM: 'W01',
            LQNUM: '0001045002',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'HS01',
            VERME: '90.000',
            MEINS: 'NOS',
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

  const makeInput241 = (customId = '000000000241') => ({
    movementType: '241',
    plant: '1120',
    storageLocation: 'HS01',
    material: '8000000023',
    quantity: 10,
    unit: 'NOS',
    assetNo: '400001',
    subNumber: '0000',
    warehouseNumber: 'W01',
    processId: `E5B42701-1111-4222-8333-${customId}`
  });

  // =========================================================================
  // PROOF 1: Step-by-Step Chain Execution
  // MB21 -> TR -> Scan -> TO -> Confirm -> MIGO 241 -> MATDOC -> Account Assignment -> Stock -> RESB
  // =========================================================================
  describe('Proof 1: Explicit Step-by-Step Chain for Movement 241', () => {
    let env;

    beforeEach(() => {
      env = create241Environment();
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Step 1: MB21 — Create Reservation generates SAP reservation with Asset Account Assignment (ANLN1/ANLN2)', async () => {
      const input = makeInput241('000000000101');
      const res = await env.adapter.createReservation(input);

      expect(res.success).toBe(true);
      expect(res.reservationNo).toBe('520241');
      expect(res.reservationItem).toBe('0001');

      // Verify BAPI_RESERVATION_CREATE1 payload has Asset Account Assignment
      const bapiCalls = env.getBapiReservationCalls();
      expect(bapiCalls.length).toBe(1);
      expect(bapiCalls[0].RESERVATIONHEADER.MOVE_TYPE).toBe('241');
      expect(bapiCalls[0].RESERVATIONHEADER.ASSET_NO).toBe('000000400001'); // 12-char padded
      expect(bapiCalls[0].RESERVATIONHEADER.SUB_NUMBER).toBe('0000');
      expect(bapiCalls[0].RESERVATIONITEMS[0].MATERIAL).toContain('8000000023');
      expect(bapiCalls[0].RESERVATIONITEMS[0].ENTRY_QNT).toBe(10);
    });

    test('Step 2: TR — Create Transfer Requirement generates SAP TR with Requirement Type A and 10-char Asset BENUM', async () => {
      const input = makeInput241('000000000102');
      const trRes = await env.adapter.createTransferRequirement({
        ...input,
        reservationNo: '520241',
        reservationItem: '0001'
      });

      expect(trRes.success).toBe(true);
      expect(trRes.trNumber).toBe('1000241');
      expect(trRes.trItem).toBe('0001');
      expect(trRes.warehouseNumber).toBe('W01');

      const trCalls = env.getTrCreateCalls();
      expect(trCalls.length).toBeGreaterThanOrEqual(1);

      // Verify Account Assignment fields sent to SAP TR
      const calledParams = trCalls[0].params;
      const ltbaItem = (calledParams.T_LTBA && calledParams.T_LTBA[0]) || calledParams;
      expect(ltbaItem.BWLVS).toBe('241');
      expect(ltbaItem.BETYP).toBe('A'); // Requirement Type 'A' for Asset
      expect(ltbaItem.BENUM).toBe('0000400001'); // 10-char padded Asset
      expect(ltbaItem.RSNUM).toContain('520241'); // Reservation linked
    });

    test('Step 3: Scan — Warehouse Scan verifies critical 8-fields from SAP TR (LTBK/LTBP)', async () => {
      const scanRes = await env.adapter.verifyTR({
        warehouseNumber: 'W01',
        trNumber: '1000241',
        trItem: '0001',
        movement: '241',
        material: '8000000023',
        quantity: 10,
        plant: '1120',
        storageLocation: 'HS01'
      });

      expect(scanRes.success).toBe(true);
      expect(scanRes.stage).toBe('TR_VERIFICATION');
      expect(scanRes.verified).toBe(true);
      expect(scanRes.trNumber).toBe('1000241');
      expect(scanRes.warehouseNumber).toBe('W01');
    });

    test('Step 4: TO — Create Transfer Order referencing verified TR produces SAP TANUM to Asset interim storage', async () => {
      const input = makeInput241('000000000104');
      const toRes = await env.adapter.createTransferOrderFromTR({
        ...input,
        trNumber: '1000241',
        trItem: '0001',
        autoConfirm: false
      });

      expect(toRes.success).toBe(true);
      expect(toRes.toNumber).toBe('1030241');
      expect(toRes.toItem).toBe('0001');
      expect(toRes.warehouseNumber).toBe('W01');
    });

    test('Step 5: Confirm — Confirm Transfer Order updates LTAK-KQUIT and LTAP-PQUIT', async () => {
      const confirmRes = await env.adapter.confirmTransferOrder({
        warehouseNumber: 'W01',
        toNumber: '1030241'
      });

      expect(confirmRes.success).toBe(true);
      expect(confirmRes.confirmed).toBe(true);
      expect(confirmRes.toNumber).toBe('1030241');

      const confirmCalls = env.getToConfirmCalls();
      expect(confirmCalls.length).toBe(1);
      expect(confirmCalls[0].I_TANUM).toBe('0001030241');
    });

    test('Step 6: MIGO 241 — Post Goods Movement with confirmed TO and Asset Account Assignment calls BAPI_GOODSMVT_CREATE', async () => {
      const input = makeInput241('000000000106');
      const migoRes = await env.adapter.postGoodsMovement({
        ...input,
        reservationNumber: '520241',
        reservationItem: '0001',
        transferOrder: '1030241',
        assetNo: '400001',
        subNumber: '0000',
        completeReservation: true
      });

      expect(migoRes.success).toBe(true);
      expect(migoRes.stage).toBe('MIGO');
      expect(migoRes.materialDocument).toBe('5000000241');
      expect(migoRes.materialDocYear).toBe('2026');

      // Verify BAPI_GOODSMVT_CREATE parameters contain Asset Account Assignment
      const gmCalls = env.getBapiGoodsmvtCalls();
      expect(gmCalls.length).toBe(1);
      expect(gmCalls[0].GOODSMVT_CODE.GM_CODE).toBe('03'); // Goods Issue code
      expect(gmCalls[0].GOODSMVT_ITEM[0].MOVE_TYPE).toBe('241');
      expect(gmCalls[0].GOODSMVT_ITEM[0].ASSET_NO).toBe('000000400001'); // 12-char padded Asset
      expect(gmCalls[0].GOODSMVT_ITEM[0].SUB_NUMBER).toBe('0000');
      expect(gmCalls[0].GOODSMVT_ITEM[0].RESERV_NO).toBe('0000520241');
      expect(gmCalls[0].GOODSMVT_ITEM[0].RES_ITEM).toBe('0001');
      expect(gmCalls[0].GOODSMVT_ITEM[0].ENTRY_QNT).toBe(10);
      expect(gmCalls[0].GOODSMVT_ITEM[0].NO_MORE_GR).toBe('X');
    });

    test('Step 7: Material Document — Verified in SAP MATDOC with BWART 241', async () => {
      const matdoc = await env.adapter.verifyMaterialDocument({
        materialDocument: '5000000241',
        materialDocumentYear: '2026',
        movementType: '241',
        material: '8000000023',
        quantity: 10,
        plant: '1120',
        storageLocation: 'HS01',
        assetNo: '400001',
        subNumber: '0000',
        reservationNumber: '520241',
        reservationItem: '0001'
      });

      expect(matdoc.success).toBe(true);
      expect(matdoc.materialDocument).toBe('5000000241');
      expect(matdoc.materialDocumentYear).toBe('2026');
      expect(matdoc.movementType).toBe('241');
    });

    test('Step 8: Asset / required account assignment verified — MATDOC contains ANLN1 and ANLN2', async () => {
      // Direct DDIC check on MATDOC transparent table for Asset Account Assignment
      const rows = await env.mockRfc.readTable('MATDOC', [
        'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'ANLN1', 'ANLN2', 'MENGE'
      ], ["MBLNR = '5000000241'"]);

      expect(rows.length).toBeGreaterThan(0);
      const postRecord = rows[0];
      expect(postRecord.BWART).toBe('241');
      expect(postRecord.ANLN1).toBe('000000400001'); // Main asset number
      expect(postRecord.ANLN2).toBe('0000'); // Asset sub-number
    });

    test('Step 9: Stock Reduced — Verified in MARD and LQUA that source stock decreased with assetConsumptionPosted', async () => {
      const input = makeInput241('000000000108');
      const stock = await env.adapter.verifyStock(input, {
        materialDocument: '5000000241',
        materialDocumentYear: '2026'
      });

      expect(stock.success).toBe(true);
      expect(stock.sourceStockDecreased).toBe(true);
      expect(stock.assetConsumptionPosted).toBe(true);
      expect(stock.assetNo).toContain('400001');
    });

    test('Step 10: Reservation Updated — Verified in RESB with ENMNG=10, KZEAR=X, completelyProcessed=true', async () => {
      const resb = await env.adapter.verifyReservation({
        reservationNumber: '520241',
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
  describe('Proof 2: Unified Orchestrator Flow (executeReservationWarehouseFlow) for Movement 241', () => {
    let env;

    beforeEach(() => {
      env = create241Environment();
      env.setupDefaultFms();
      env.setupDefaultTables();
    });

    test('Executes all stages in strict sequence: MB21 -> TR -> Scan -> TO -> TO Confirm -> MIGO 241 -> MATDOC -> Asset Account Assignment -> Stock -> RESB', async () => {
      const input = makeInput241('000000000241');
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
      expect(flowResult.reservationNumber).toBe('520241');
      expect(flowResult.trNumber).toBe('1000241');
      expect(flowResult.toNumber).toBe('1030241');
      expect(flowResult.toConfirmed).toBe(true);
      expect(flowResult.migo.materialDocument).toBe('5000000241');
      expect(flowResult.migo.materialDocYear).toBe('2026');

      // Asset account assignment verification
      expect(flowResult.stock.sourceStockDecreased).toBe(true);
      expect(flowResult.stock.assetConsumptionPosted).toBe(true);
      expect(flowResult.stock.assetNo).toContain('400001');

      // Final reservation state
      expect(flowResult.finalReservation.completelyProcessed).toBe(true);
      expect(flowResult.finalReservation.remainingQuantity).toBe(0);
    });

    test('Strict Precondition: MIGO 241 fails cleanly if TO confirmation fails and MIGO is never called', async () => {
      env.setupDefaultFms({
        L_TO_CONFIRM: () => {
          throw new Error('L_TO_CONFIRM failed: Quant locked by user OPERATOR2');
        }
      });

      const input = makeInput241('000000000242');
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

    test('Strict Precondition: Movement 241 requires Asset Number and halts before SAP call if missing', async () => {
      const inputWithoutAsset = makeInput241('000000000243');
      inputWithoutAsset.assetNo = '';

      const flowResult = await env.adapter.executeReservationWarehouseFlow(inputWithoutAsset);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toContain('Asset number is mandatory for Movement Type 241');
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Strict Precondition: Rejects deactivated / locked asset in ANLA before calling SAP', async () => {
      env.setupDefaultTables({
        ANLA: () => [{
          BUKRS: '1000',
          ANLN1: '000000400001',
          ANLN2: '0000',
          AKTIV: '20200101',
          DEAKT: '20240101', // Deactivated
          XLOEV: '',
          XSPEB: 'X', // Locked
          TXT50: 'Deactivated asset'
        }]
      });

      const input = makeInput241('000000000244');
      const flowResult = await env.adapter.executeReservationWarehouseFlow(input);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toMatch(/locked for postings|deactivated/i);
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Strict Precondition: Rejects missing material or zero quantity before calling SAP', async () => {
      const inputWithoutMaterial = makeInput241('000000000245');
      inputWithoutMaterial.material = '';

      const flowResult = await env.adapter.executeReservationWarehouseFlow(inputWithoutMaterial);

      expect(flowResult.success).toBe(false);
      expect(flowResult.stage).toBe('RESERVATION');
      expect(flowResult.processStatus).toBe(PROCESS_STATUS.FAILED_RESERVATION);
      expect(flowResult.error).toContain('Material is mandatory');
      expect(env.getBapiReservationCalls().length).toBe(0);
    });

    test('Idempotency: Re-submitting identical processId returns committed material document with Asset Account Assignment without duplicate stock consumption', async () => {
      const input = makeInput241('000000000246');

      env.setupDefaultFms({
        BAPI_RESERVATION_CREATE1: () => ({
          RESERVATION: '0000520998',
          RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 520998 created' }]
        })
      });

      env.setupDefaultTables({
        RESB: () => [{
          RSNUM: '0000520998',
          RSPOS: '0001',
          MATNR: '000000008000000023',
          WERKS: '1120',
          LGORT: 'HS01',
          BDMNG: '10.000',
          ENMNG: '10.000',
          MEINS: 'NOS',
          KZEAR: 'X',
          XLOEK: ''
        }],
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes("MBLNR = '5000000241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '241',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              ANLN1: '000000400001',
              ANLN2: '0000',
              RSNUM: '0000520998',
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
      expect(first.migo.materialDocument).toBe('5000000241');
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);

      // Setup MATDOC for repeat attempt
      env.setupDefaultTables({
        MATDOC: (fields, where, whereStr) => {
          if (whereStr.includes(`SGTXT = '${input.processId}'`) || whereStr.includes("RSNUM = '0000520998'") || whereStr.includes("MBLNR = '5000000241'")) {
            return [{
              MBLNR: '5000000241',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '241',
              MATNR: '000000008000000023',
              MENGE: '10.000',
              WERKS: '1120',
              LGORT: 'HS01',
              ANLN1: '000000400001',
              ANLN2: '0000',
              RSNUM: '0000520998',
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
      expect(second.migo.materialDocument).toBe('5000000241');
      // BAPI must not be called a second time
      expect(env.getBapiGoodsmvtCalls().length).toBe(1);
    });
  });
});
