'use strict';

/**
 * Step 20 — Dedicated End-to-End Test Suite for Movement Type 301 (Plant to Plant Transfer)
 *
 * Explicitly tests and proves the exact sequence:
 *   MB21 (Reservation Type 301 with Receiving Plant)
 *    ↓
 *   TR (Transfer Requirement with BWLVS = 301, RSNUM omitted to avoid SAP XFELD_WRONG)
 *    ↓
 *   Scan (Warehouse Scan verification)
 *    ↓
 *   TO (Transfer Order Creation to Interim Type 920/TRANSFER)
 *    ↓
 *   Confirm (TO Confirmation in SAP)
 *    ↓
 *   MIGO 301 (GM_CODE = 04, MOVE_TYPE = 301, Receiving Plant)
 *    ↓
 *   Material document (MATDOC dual-row credit/debit)
 *    ↓
 *   Inter-Plant Stock Verification:
 *     Source Plant/SLoc (1120/CS01)    Destination Plant/SLoc (1110/CS01)
 *            ↓                                     ↓
 *          -QTY (SHKZG = 'H')                    +QTY (SHKZG = 'S')
 *
 *     Example:
 *     Before:
 *       Plant 1120 = 100
 *       Plant 1110 = 20
 *       (Total Sum = 120)
 *
 *     301 / 10 KG
 *
 *     After:
 *       Plant 1120 = 90  (-10)
 *       Plant 1110 = 30  (+10)
 *       (The inter-plant sum remains: 120)
 *    ↓
 *   Reservation updated (RESB KZEAR = 'X', ENMNG = 10, completelyProcessed = true)
 *
 * [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { PROCESS_STATUS } = require('../../../srv/common/wmStatus');

describe('Step 20: Movement Type 301 (Plant to Plant Transfer) Proof Suite [mock only, not SAP verification]', () => {
  const create301Environment = () => {
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
      checkMarcExistence: true,
      checkMbewExistence: true,
      checkSernpMatch: true
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
            RESERVATION: '0000525868',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation 525868 created' }]
          };
        }
        if (fm === 'L_TR_CREATE' || fm === 'ZWM_TR_CREATE' || fm === 'Z_WM_TR_CREATE') {
          trCreateCalls.push({ fm, params });
          const reqItem = (params && params.T_LTBA && params.T_LTBA[0]) || {};
          const qty = reqItem.MENGA !== undefined ? reqItem.MENGA : (params?.IV_MENGA !== undefined ? params.IV_MENGA : 1);
          return {
            EV_TBNUM: '0001000794',
            EV_TBPOS: '0001',
            T_LTBA: [{
              TBNUM: '0001000794',
              TBPOS: '0001',
              MATNR: '000000008900000004',
              MENGA: qty,
              WERKS: '1120',
              LGORT: 'CS01',
              LGNUM: 'W01',
              BWLVS: '301'
            }]
          };
        }
        if (fm === 'L_TO_CREATE_TR' || fm === 'ZWM_TO_CREATE_FROM_TR' || fm === 'Z_WM_TO_CREATE_FROM_TR') {
          toCreateCalls.push(params);
          return { E_TANUM: '0001037287', EV_TANUM: '0001037287', EV_SUCCESS: 'S' };
        }
        if (fm === 'L_TO_CONFIRM') {
          toConfirmCalls.push(params);
          return {
            EV_SUCCESS: 'S',
            ET_ITEMS: [{ TANUM: '0001037287', TAPOS: '0001', NISTM: '1.000' }]
          };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          bapiGoodsmvtCalls.push(params);
          return {
            MATERIALDOCUMENT: '4900050149',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Document 4900050149 posted' }]
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
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' },
            { LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }
          ];
        }

        if (table === 'MARC') {
          return [
            { MATNR: '000000008900000004', WERKS: '1120', LVORM: '', SERNP: '' },
            { MATNR: '000000008900000004', WERKS: '1110', LVORM: '', SERNP: '' }
          ];
        }

        if (table === 'MBEW') {
          return [
            { MATNR: '000000008900000004', BWKEY: '1120', LBKUM: '1240.000' },
            { MATNR: '000000008900000004', BWKEY: '1110', LBKUM: '3.000' }
          ];
        }

        if (table === 'MARD') {
          if (whereStr.includes("WERKS = '1120'") && whereStr.includes("LGORT = 'CS01'")) {
            return [{ MATNR: '000000008900000004', WERKS: '1120', LGORT: 'CS01', LABST: '90.000' }];
          }
          if (whereStr.includes("WERKS = '1110'") && whereStr.includes("LGORT = 'CS01'")) {
            return [{ MATNR: '000000008900000004', WERKS: '1110', LGORT: 'CS01', LABST: '30.000' }];
          }
          return [
            { MATNR: '000000008900000004', WERKS: '1120', LGORT: 'CS01', LABST: '90.000' },
            { MATNR: '000000008900000004', WERKS: '1110', LGORT: 'CS01', LABST: '30.000' }
          ];
        }

        if (table === 'RKPF') {
          return [{
            RSNUM: '0000525868',
            BWART: '301',
            UMWRK: '1110',
            UMLGO: 'CS01',
            USNAM: 'KHUSHAL',
            RSDAT: '20261012'
          }];
        }

        if (table === 'RESB') {
          return [{
            RSNUM: '0000525868',
            RSPOS: '0001',
            MATNR: '000000008900000004',
            WERKS: '1120',
            LGORT: 'CS01',
            UMWRK: '1110',
            UMLGO: 'CS01',
            BDMNG: '1.000',
            ENMNG: '1.000',
            MEINS: 'KG',
            KZEAR: 'X'
          }];
        }

        if (table === 'LTBK') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000794',
            BWLVS: '301',
            BETYP: '',
            BENUM: '',
            RSNUM: '0000000000',
            STATU: 'O',
            BDATU: '20261012'
          }];
        }

        if (table === 'LTBP') {
          return [{
            LGNUM: 'W01',
            TBNUM: '0001000794',
            TBPOS: '0001',
            MATNR: '000000008900000004',
            WERKS: '1120',
            LGORT: 'CS01',
            MENGA: '1.000',
            ELIKZ: 'X'
          }];
        }

        if (table === 'LTAK') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001037287',
            BWLVS: '301',
            TBNUM: '0001000794',
            KQUIT: ' ',
            BNAME: 'KHUSHAL',
            BDATU: '20261012'
          }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01',
            TANUM: '0001037287',
            TAPOS: '0001',
            MATNR: '000000008900000004',
            VLTYP: '921',
            VLPLA: 'TRANSFER',
            NLTYP: '920',
            NLPLA: 'TRANSFER',
            PQUIT: 'X',
            NSOLA: '1.000'
          }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          if (whereStr.includes("MBLNR = '4900050149'")) {
            const menge = whereStr.includes('MENGE') || whereStr.includes('10') ? '10.000' : '1.000';
            return [
              {
                MBLNR: '4900050149',
                MJAHR: '2026',
                ZEILE: '0001',
                BWART: '301',
                MATNR: '000000008900000004',
                MENGE: menge,
                MEINS: 'KG',
                WERKS: '1120',
                LGORT: 'CS01',
                UMWRK: '1110',
                UMLGO: 'CS01',
                RSNUM: '0000525868',
                RSPOS: '0001',
                SHKZG: 'H'
              },
              {
                MBLNR: '4900050149',
                MJAHR: '2026',
                ZEILE: '0002',
                BWART: '301',
                MATNR: '000000008900000004',
                MENGE: menge,
                MEINS: 'KG',
                WERKS: '1110',
                LGORT: 'CS01',
                UMWRK: '1120',
                UMLGO: 'CS01',
                RSNUM: '0000525868',
                RSPOS: '0001',
                SHKZG: 'S'
              }
            ];
          }
          return [];
        }

        return [];
      });
    };

    return {
      adapter,
      mockRfc,
      setupDefaultFms,
      setupDefaultTables,
      getBapiGoodsmvtCalls: () => bapiGoodsmvtCalls,
      getBapiReservationCalls: () => bapiReservationCalls,
      getTrCreateCalls: () => trCreateCalls,
      getToCreateCalls: () => toCreateCalls,
      getToConfirmCalls: () => toConfirmCalls
    };
  };

  test('Stage 1: MB21 Reservation Creation for Movement 301 includes Receiving Plant', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const res = await env.adapter.createReservation({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8900000004',
      quantity: 1,
      unit: 'KG'
    });

    expect(res.reservationNo).toBe('525868');
    expect(res.movementType).toBe('301');

    const bapiCalls = env.getBapiReservationCalls();
    expect(bapiCalls).toHaveLength(1);
    expect(bapiCalls[0].RESERVATIONHEADER.MOVE_TYPE).toBe('301');
    expect(bapiCalls[0].RESERVATIONHEADER.MOVE_PLANT).toBe('1110');
    expect(bapiCalls[0].RESERVATIONHEADER.MOVE_STLOC).toBe('CS01');
  });

  test('Stage 2: TR Creation for Movement 301 uses BWLVS=301 and omits RSNUM to prevent XFELD_WRONG', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const tr = await env.adapter.createTransferRequirement({
      warehouseNumber: 'W01',
      movementType: '301',
      material: '8900000004',
      quantity: 1,
      unit: 'KG',
      plant: '1120',
      storageLocation: 'CS01',
      reservationNo: '0000525868',
      reservationItem: '0001'
    });

    expect(tr.trNumber).toBe('1000794');
    expect(tr.movementType).toBe('301');

    const trCalls = env.getTrCreateCalls();
    expect(trCalls).toHaveLength(1);
    const ltba = trCalls[0].params.T_LTBA[0];
    expect(ltba.BWLVS).toBe('301');
    expect(ltba.RSNUM).toBe('');
  });

  test('Stage 3: Warehouse Scan Verifies 301 TR Attributes', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const verified = await env.adapter.verifyTR({
      warehouseNumber: 'W01',
      trNumber: '0001000794'
    });

    expect(verified.verified).toBe(true);
    expect(verified.trNumber).toBe('1000794');
    expect(verified.warehouseNumber).toBe('W01');
    expect(verified.movement).toBe('301');
    expect(verified.status).toBe('O');
  });

  test('Stage 4: TO Creation for 301 routes to Interim Storage 920/TRANSFER', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const to = await env.adapter.createTransferOrderFromTR({
      warehouseNumber: 'W01',
      trNumber: '0001000794',
      trItem: '0001',
      quantity: 1,
      unit: 'KG',
      movementType: '301',
      autoConfirm: false
    });

    expect(to.toNumber).toBe('1037287');
    expect(to.status).toBe('03');
    const toCalls = env.getToCreateCalls();
    expect(toCalls).toHaveLength(1);
    expect(toCalls[0].I_TBNUM).toBe('0001000794');
  });

  test('Stage 5: TO Confirmation confirms transfer order in Warehouse W01', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const conf = await env.adapter.confirmTransferOrder({
      warehouseNumber: 'W01',
      toNumber: '1037287',
      items: [{ item: '0001', quantity: 1 }]
    });

    expect(conf.success).toBe(true);
    expect(conf.confirmed).toBe(true);
    const confCalls = env.getToConfirmCalls();
    expect(confCalls).toHaveLength(1);
    expect(confCalls[0].I_TANUM).toBe('0001037287');
  });

  test('Stage 6: MIGO 301 Posts Transfer Posting with GM_CODE=04 and Preserves Both Plants', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const migo = await env.adapter.postGoodsMovement({
      reservationNo: '0000525868',
      reservationItem: '0001',
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8900000004',
      quantity: 1,
      unit: 'KG',
      transferOrder: '0001037287',
      initialSourceStock: 100,
      initialDestStock: 20
    });

    expect(migo.materialDocument).toBe('4900050149');
    expect(migo.materialDocYear).toBe('2026');
    expect(migo.stockEffect).toContain('Plant 1110');

    const gmCalls = env.getBapiGoodsmvtCalls();
    expect(gmCalls).toHaveLength(1);
    expect(gmCalls[0].GOODSMVT_CODE.GM_CODE).toBe('04');
    expect(gmCalls[0].GOODSMVT_ITEM[0].MOVE_TYPE).toBe('301');
    expect(gmCalls[0].GOODSMVT_ITEM[0].PLANT).toBe('1120');
    expect(gmCalls[0].GOODSMVT_ITEM[0].STGE_LOC).toBe('CS01');
    expect(gmCalls[0].GOODSMVT_ITEM[0].MOVE_PLANT).toBe('1110');
    expect(gmCalls[0].GOODSMVT_ITEM[0].MOVE_STLOC).toBe('CS01');
  });

  test('Stage 7: Inter-Plant Stock Conservation is Strictly Verified (-10 Source, +10 Dest, Sum 120 Constant)', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables({
      MATDOC: (_f, _w, whereStr) => {
        if (whereStr.includes("MBLNR = '4900050149'")) {
          return [
            {
              MBLNR: '4900050149',
              MJAHR: '2026',
              ZEILE: '0001',
              BWART: '301',
              MATNR: '000000008900000004',
              MENGE: '10.000',
              MEINS: 'KG',
              WERKS: '1120',
              LGORT: 'CS01',
              UMWRK: '1110',
              UMLGO: 'CS01',
              RSNUM: '0000525868',
              RSPOS: '0001',
              SHKZG: 'H'
            },
            {
              MBLNR: '4900050149',
              MJAHR: '2026',
              ZEILE: '0002',
              BWART: '301',
              MATNR: '000000008900000004',
              MENGE: '10.000',
              MEINS: 'KG',
              WERKS: '1110',
              LGORT: 'CS01',
              UMWRK: '1120',
              UMLGO: 'CS01',
              RSNUM: '0000525868',
              RSPOS: '0001',
              SHKZG: 'S'
            }
          ];
        }
        return [];
      }
    });

    const stock = await env.adapter.verifyStock({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8900000004',
      quantity: 10,
      initialSourceStock: 100,
      initialDestStock: 20
    }, {
      materialDocument: '4900050149',
      materialDocumentYear: '2026'
    });

    expect(stock.success).toBe(true);
    expect(stock.movementType).toBe('301');

    expect(stock.sourceStock.storageLocation).toBe('CS01');
    expect(stock.sourceStock.initial).toBe(100);
    expect(stock.sourceStock.resulting).toBe(90);
    expect(stock.sourceStock.delta).toBe(-10);
    expect(stock.sourceStockDecreased).toBe(true);

    expect(stock.destinationStock.storageLocation).toBe('CS01');
    expect(stock.destinationStock.initial).toBe(20);
    expect(stock.destinationStock.resulting).toBe(30);
    expect(stock.destinationStock.delta).toBe(10);
    expect(stock.destinationStockIncreased).toBe(true);

    const sumBefore = stock.sourceStock.initial + stock.destinationStock.initial;
    const sumAfter = stock.sourceStock.resulting + stock.destinationStock.resulting;
    expect(sumBefore).toBe(120);
    expect(sumAfter).toBe(120);
    expect(sumAfter).toBe(sumBefore);
  });

  test('Stage 8: Final Reservation Completion verified in RESB (completelyProcessed=true, remainingQty=0)', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const res = await env.adapter.postGoodsMovement({
      reservationNo: '0000525868',
      reservationItem: '0001',
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8900000004',
      quantity: 1,
      unit: 'KG',
      transferOrder: '0001037287',
      initialSourceStock: 100,
      initialDestStock: 20
    });

    expect(res.reservationVerification.completelyProcessed).toBe(true);
    expect(res.reservationVerification.remainingQuantity).toBe(0);
    expect(res.reservationVerification.issuedQuantity).toBe(1);
  });

  test('Validation: Rejects 301 if Receiving Plant is missing (HTTP 400)', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables({
      RKPF: async () => [{ BWART: '301', UMWRK: '', UMLGO: '' }]
    });

    await expect(env.adapter.postGoodsMovement({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '',
      material: '8900000004',
      quantity: 1,
      unit: 'KG'
    })).rejects.toThrow(/Receiving Plant is mandatory for Movement Type 301/i);
  });

  test('Validation: Rejects 301 if Receiving Plant equals Issuing Plant (HTTP 400)', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    await expect(env.adapter.postGoodsMovement({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1120',
      material: '8900000004',
      quantity: 1,
      unit: 'KG'
    })).rejects.toThrow(/Receiving Plant must be different from Issuing Plant/i);
  });

  test('Validation: Rejects 301 if Material is not extended to Receiving Plant in MARC', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables({
      MARC: async (_f, _w, whereStr) => {
        if (whereStr.includes("WERKS = '9999'")) return [];
        return [{ MATNR: '000000008900000004', WERKS: '1120', LVORM: '' }];
      }
    });

    await expect(env.adapter.postGoodsMovement({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '9999',
      material: '8900000004',
      quantity: 1,
      unit: 'KG'
    })).rejects.toThrow(/not extended to receiving plant 9999 \(MARC\)/i);
  });

  test('Validation: Rejects 301 if Material has no valuation data in Receiving Plant in MBEW', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables({
      MBEW: async (_f, _w, whereStr) => {
        if (whereStr.includes("BWKEY = '1110'")) return [];
        return [{ MATNR: '000000008900000004', BWKEY: '1120', LBKUM: '100' }];
      }
    });

    await expect(env.adapter.postGoodsMovement({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      material: '8900000004',
      quantity: 1,
      unit: 'KG'
    })).rejects.toThrow(/has no valuation\/accounting data \(MBEW\) in receiving plant 1110/i);
  });

  test('Validation: Rejects 301 if Serial Profile is mismatched between plants', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables({
      MARC: async (_f, _w, whereStr) => {
        if (whereStr.includes("WERKS = '1120'")) {
          return [{ MATNR: '000000008900000004', WERKS: '1120', SERNP: 'ZSN1' }];
        }
        if (whereStr.includes("WERKS = '1110'")) {
          return [{ MATNR: '000000008900000004', WERKS: '1110', SERNP: '' }];
        }
        return [];
      }
    });

    await expect(env.adapter.postGoodsMovement({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      material: '8900000004',
      quantity: 1,
      unit: 'KG',
      serials: ['SN1001']
    })).rejects.toThrow(/has no serial number profile in receiving plant 1110/i);
  });

  test('Idempotency Guard: Repeat 301 MIGO returns existing Material Document', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables();

    const input = {
      reservationNo: '0000525868',
      reservationItem: '0001',
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8900000004',
      quantity: 1,
      unit: 'KG',
      transferOrder: '0001037287',
      processId: 'c0a80101-0000-0000-0000-000000000301',
      initialSourceStock: 100,
      initialDestStock: 20
    };

    const first = await env.adapter.postGoodsMovement(input);
    expect(first.materialDocument).toBe('4900050149');
    expect(env.getBapiGoodsmvtCalls()).toHaveLength(1);

    // Setup MATDOC for repeat attempt
    env.setupDefaultTables({
      MATDOC: (_f, _w, whereStr) => {
        if (whereStr.includes('c0a80101-0000-0000-0000-000000000301') || whereStr.includes("RSNUM = '0000525868'") || whereStr.includes("MBLNR = '4900050149'")) {
          return [{
            MBLNR: '4900050149',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '301',
            MATNR: '000000008900000004',
            MENGE: '1.000',
            MEINS: 'KG',
            WERKS: '1120',
            LGORT: 'CS01',
            UMWRK: '1110',
            UMLGO: 'CS01',
            RSNUM: '0000525868',
            RSPOS: '0001',
            SHKZG: 'H',
            CANCELLED: '',
            REVERSAL_MOVEMENT: ''
          }];
        }
        return [];
      }
    });

    const second = await env.adapter.postGoodsMovement(input);
    expect(second.materialDocument).toBe('4900050149');
    expect(second.alreadyPosted).toBe(true);
    expect(env.getBapiGoodsmvtCalls()).toHaveLength(1);
  });

  test('Full Orchestrator: executeReservationWarehouseFlow runs complete 301 cycle', async () => {
    const env = create301Environment();
    env.setupDefaultFms();
    env.setupDefaultTables({
      RESB: async () => [{
        RSNUM: '0000525868',
        RSPOS: '0001',
        MATNR: '000000008900000004',
        WERKS: '1120',
        LGORT: 'CS01',
        UMWRK: '1110',
        UMLGO: 'CS01',
        BDMNG: '1.000',
        ENMNG: '1.000',
        MEINS: 'KG',
        KZEAR: 'X'
      }]
    });

    const res = await env.adapter.executeReservationWarehouseFlow({
      movementType: '301',
      plant: '1120',
      storageLocation: 'CS01',
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01',
      material: '8900000004',
      quantity: 1,
      unit: 'KG',
      warehouseNumber: 'W01',
      autoConfirm: true,
      initialSourceStock: 100,
      initialDestStock: 20
    });

    expect(res.success).toBe(true);
    expect(res.processStatus).toBe(PROCESS_STATUS.COMPLETED);
    expect(res.materialDocument).toBe('4900050149');
    expect(res.stockVerified).toBe(true);
  });
});
