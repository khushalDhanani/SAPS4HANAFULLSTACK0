'use strict';

/**
 * Unit Test Suite for Movement Type 261 (Goods Issue to Order) in Unified WM Workflow
 * Covers all requirements:
 *   - Movement Configuration & Pre-Validation (mandatory OrderID, reject CostCenter, Asset, RecPlant, RecSLoc)
 *   - AUFK Master Data & JEST Status Validation (REL mandatory; CRTD, LKD, TECO, CLSD, DLFL, LOEKZ rejected)
 *   - Backflush Component Rejection (RESB-RGEKZ != '')
 *   - TR Creation (BWLVS=261, BETYP=F, BENUM=AUFNR.slice(-10))
 *   - TO Creation with Interim Storage Type 914 and Dynamic Bin <AUFNR>
 *   - TO Confirmation Gate (MIGO blocked without confirmed TO)
 *   - MIGO 261 (GM_CODE=03, MOVE_TYPE=261, ORDERID=AUFNR)
 *   - Stock shortfall check (MARD)
 *   - Idempotency & duplicate-posting protection
 *   - Full End-to-End Orchestrator (executeReservationWarehouseFlow)
 *   - UI Controller Validations (ReservationEntryDetail and WarehouseScanToDetail)
 *
 * All tests labeled: [mock only, not SAP verification]
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const { validateReservationInput, MOVEMENT_CONFIG, SUPPORTED_MOVEMENT_TYPES } = require('../../../srv/common/movementConfig');

describe('Movement Type 261 – Goods Issue to Order Unified Tests [mock only, not SAP verification]', () => {
  let mockRfc;
  let resAdapter;
  let trAdapter;

  beforeEach(() => {
    mockRfc = {
      session: jest.fn(async (fn) => fn(mockRfc.call)),
      call: jest.fn(async (fm, params) => {
        if (fm === 'BAPI_RESERVATION_CREATE1') {
          return {
            RESERVATION: '0000529261',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Reservation created' }]
          };
        }
        if (fm === 'L_TR_CREATE') {
          return { T_LTBA: [{ TBNUM: '0001000861', TBPOS: '0001' }] };
        }
        if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') {
          return {
            ET_TR_HEADER: [{
              LGNUM: 'W01',
              TBNUM: params?.IV_TR_NUMBER || '0001000861',
              BWLVS: '261',
              BETYP: 'F',
              BENUM: '1000000',
              RSNUM: '0000529261',
              NLTYP: '914',
              NLPLA: '1000000'
            }],
            ET_TR_ITEMS: [{
              LGNUM: 'W01',
              TBNUM: params?.IV_TR_NUMBER || '0001000861',
              TBPOS: '0001',
              MATNR: '000000001000000045',
              WERKS: '1120',
              LGORT: 'CS01',
              MENGE: 10,
              TAMEN: 0,
              MEINS: 'KG'
            }]
          };
        }
        if (fm === 'L_TO_CREATE_TR') {
          return { E_TANUM: '0001026100' };
        }
        if (fm === 'Z_WM_TO_CREATE_FROM_TR') {
          return { EV_SUCCESS: 'S', EV_TANUM: '0001026100' };
        }
        if (fm === 'L_TO_CONFIRM') {
          return { SUBRC: 0 };
        }
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          return {
            MATERIALDOCUMENT: '4900052261',
            MATDOCUMENTYEAR: '2026',
            RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'Material document created' }]
          };
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT') {
          return {};
        }
        return {};
      }),
      readTable: jest.fn(async (table, fields, options) => {
        const optStr = Array.isArray(options) ? options.join(' ') : String(options || '');

        if (table === 'AUFK') {
          if (optStr.includes("AUFNR = '000000999999'")) {
            return []; // non-existent order
          }
          if (optStr.includes("AUFNR = '000000100002'")) {
            return [{ AUFNR: '000000100002', WERKS: '1120', OBJNR: 'OR000000100002', LOEKZ: 'X', AUTYP: '10' }]; // deleted order
          }
          if (optStr.includes("AUFNR = '000000100003'")) {
            return [{ AUFNR: '000000100003', WERKS: '1130', OBJNR: 'OR000000100003', LOEKZ: '', AUTYP: '10' }]; // plant mismatch (1130 vs 1120)
          }
          if (optStr.includes("AUFNR = '000000100001'")) {
            return [{ AUFNR: '000000100001', WERKS: '1120', OBJNR: 'OR000000100001', LOEKZ: '', AUTYP: '10' }]; // CRTD
          }
          if (optStr.includes("AUFNR = '000000100043'")) {
            return [{ AUFNR: '000000100043', WERKS: '1120', OBJNR: 'OR000000100043', LOEKZ: '', AUTYP: '10' }]; // LKD
          }
          if (optStr.includes("AUFNR = '000000100045'")) {
            return [{ AUFNR: '000000100045', WERKS: '1120', OBJNR: 'OR000000100045', LOEKZ: '', AUTYP: '10' }]; // TECO
          }
          if (optStr.includes("AUFNR = '000000100046'")) {
            return [{ AUFNR: '000000100046', WERKS: '1120', OBJNR: 'OR000000100046', LOEKZ: '', AUTYP: '10' }]; // CLSD
          }
          if (optStr.includes("AUFNR = '000000100076'")) {
            return [{ AUFNR: '000000100076', WERKS: '1120', OBJNR: 'OR000000100076', LOEKZ: '', AUTYP: '10' }]; // DLFL
          }
          return [{ AUFNR: '000000100000', WERKS: '1120', OBJNR: 'OR000000100000', LOEKZ: '', AUTYP: '10' }];
        }

        if (table === 'JEST') {
          if (optStr.includes("OBJNR = 'OR000000100001'")) {
            // Created status CRTD (I0001), not released
            return [{ OBJNR: 'OR000000100001', STAT: 'I0001', INACT: '' }];
          }
          if (optStr.includes("OBJNR = 'OR000000100045'")) {
            // TECO status (I0045)
            return [{ OBJNR: 'OR000000100045', STAT: 'I0002', INACT: '' }, { OBJNR: 'OR000000100045', STAT: 'I0045', INACT: '' }];
          }
          if (optStr.includes("OBJNR = 'OR000000100043'")) {
            // Locked status LKD (I0043)
            return [{ OBJNR: 'OR000000100043', STAT: 'I0002', INACT: '' }, { OBJNR: 'OR000000100043', STAT: 'I0043', INACT: '' }];
          }
          if (optStr.includes("OBJNR = 'OR000000100046'")) {
            // Closed status CLSD (I0046)
            return [{ OBJNR: 'OR000000100046', STAT: 'I0002', INACT: '' }, { OBJNR: 'OR000000100046', STAT: 'I0046', INACT: '' }];
          }
          if (optStr.includes("OBJNR = 'OR000000100076'")) {
            // Deletion flag DLFL (I0076)
            return [{ OBJNR: 'OR000000100076', STAT: 'I0002', INACT: '' }, { OBJNR: 'OR000000100076', STAT: 'I0076', INACT: '' }];
          }
          // Default: Released (I0002)
          return [{ OBJNR: 'OR000000100000', STAT: 'I0002', INACT: '' }];
        }

        if (table === 'TJ02T') {
          return [{ ISTAT: 'I0002', TXT04: 'REL', TXT30: 'Released' }];
        }

        if (table === 'T320') {
          return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        }

        if (table === 'T333') {
          return [{ LGNUM: 'W01', BWLVS: '261', NLTYP: '914', NLPLA: '' }];
        }

        if (table === 'RESB') {
          if (optStr.includes("RSNUM = '0000529999'")) {
            // Backflush component
            return [{
              RSNUM: '0000529999', RSPOS: '0001', MATNR: '000000001000000045', WERKS: '1120',
              LGORT: 'CS01', BDMNG: '10.000', ENMNG: '0.000', MEINS: 'KG', BWART: '261',
              AUFNR: '000000100000', RGEKZ: 'X', KZEAR: '', XLOEK: ''
            }];
          }
          return [{
            RSNUM: '0000529261', RSPOS: '0001', MATNR: '000000001000000045', WERKS: '1120',
            LGORT: 'CS01', BDMNG: '10.000', ENMNG: '10.000', MEINS: 'KG', BWART: '261',
            AUFNR: '000000100000', RGEKZ: '', KZEAR: 'X', XLOEK: ''
          }];
        }

        if (table === 'RKPF') {
          return [{ RSNUM: '0000529261', BWART: '261', AUFNR: '000000100000' }];
        }

        if (table === 'MATDOC' || table === 'MSEG') {
          if (optStr.includes("MBLNR = '004900052261'") || optStr.includes("MBLNR = '4900052261'")) {
            return [{
              MBLNR: '004900052261', MJAHR: '2026', ZEILE: '0001', BWART: '261',
              MATNR: '000000001000000045', WERKS: '1120', LGORT: 'CS01', MENGE: '10.000',
              MEINS: 'KG', SHKZG: 'H', AUFNR: '000000100000'
            }];
          }
          return [];
        }

        if (table === 'LTBK') {
          return [{ LGNUM: 'W01', TBNUM: '0001000861', STATU: ' ' }];
        }

        if (table === 'LTBP') {
          return [{
            LGNUM: 'W01', TBNUM: '0001000861', TBPOS: '0001', MATNR: '000000001000000045',
            WERKS: '1120', LGORT: 'CS01', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG',
            BWLVS: '261', BETRP: 'F', BENUM: '1000000', NLTYP: '914', NLPLA: '1000000'
          }];
        }

        if (table === 'LTAK') {
          return [{ LGNUM: 'W01', TANUM: '0001026100', TBNUM: '0001000861', KQUIT: 'X' }];
        }

        if (table === 'LTAP') {
          return [{
            LGNUM: 'W01', TANUM: '0001026100', TAPOS: '0001', TBNUM: '0001000861', TBPOS: '0001',
            MATNR: '000000001000000045', WERKS: '1120', LGORT: 'CS01', VSOLA: '10.000',
            MEINS: 'KG', PQUIT: 'X', NLTYP: '914', NLPLA: '1000000'
          }];
        }

        if (table === 'MARD') {
          if (optStr.includes("MATNR = '000000001000000099'")) {
            return [{ MATNR: '000000001000000099', WERKS: '1120', LGORT: 'CS01', LABST: '2.000' }]; // insufficient stock
          }
          return [{ MATNR: '000000001000000045', WERKS: '1120', LGORT: 'CS01', LABST: '100.000' }];
        }

        if (table === 'MARC') {
          return [{ MATNR: '000000001000000045', WERKS: '1120', XCHPF: '', SERNP: '' }];
        }

        return [];
      })
    };

    resAdapter = new ReservationProcessAdapter({
      rfc: mockRfc,
      checkAufkExistence: true,
      checkMarcExistence: true
    });
    trAdapter = new TrToAdapter({
      rfc: mockRfc
    });
  });

  describe('1. Movement 261 Configuration & Input Validation', () => {
    test('261 is in SUPPORTED_MOVEMENT_TYPES and MOVEMENT_CONFIG', () => {
      expect(SUPPORTED_MOVEMENT_TYPES).toContain('261');
      const cfg = MOVEMENT_CONFIG['261'];
      expect(cfg).toBeDefined();
      expect(cfg.configuredWmMovement).toBe('261');
      expect(cfg.requirementType).toBe('F');
      expect(cfg.interimStorageType).toBe('914');
      expect(cfg.requiresOrder).toBe(true);
      expect(cfg.preserveReservationOnTr).toBe(true);
      expect(cfg.gmCode).toBe('03');
    });

    test('validateReservationInput rejects 261 without OrderID', () => {
      const res = validateReservationInput({
        MovementType: '261',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'KG'
      });
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/Order number is mandatory for Movement Type 261/);
    });

    test('validateReservationInput rejects CostCenter for 261', () => {
      const res = validateReservationInput({
        MovementType: '261',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'KG',
        OrderID: '1000000',
        CostCenter: '1011201301'
      });
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/Cost Center is not allowed for Movement Type 261/);
    });

    test('validateReservationInput rejects AssetNo for 261', () => {
      const res = validateReservationInput({
        MovementType: '261',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'KG',
        OrderID: '1000000',
        AssetNo: '400092'
      });
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toMatch(/Asset number is not allowed for Movement Type 261/);
    });

    test('validateReservationInput rejects ReceivingPlant and ReceivingStorageLocation for 261', () => {
      const res = validateReservationInput({
        MovementType: '261',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'KG',
        OrderID: '1000000',
        ReceivingPlant: '1130',
        ReceivingStorageLocation: 'ST02'
      });
      expect(res.isValid).toBe(false);
      expect(res.errors).toContain('Receiving Plant is not allowed for Movement Type 261 (GI to Order)');
      expect(res.errors).toContain('Receiving Storage Location is not allowed for Movement Type 261 (GI to Order)');
    });

    test('validateReservationInput accepts valid 261 input', () => {
      const res = validateReservationInput({
        MovementType: '261',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'KG',
        OrderID: '1000000'
      });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe('2. Master Data & Status Validation (AUFK & JEST)', () => {
    test('validateOrder accepts released order (REL / I0002)', async () => {
      const res = await resAdapter.validateOrder('1000000', '1120');
      expect(res.valid).toBe(true);
      expect(res.orderId).toBe('000001000000');
      expect(res.isReleased).toBe(true);
    });

    test('validateOrder rejects non-existent order with 400', async () => {
      await expect(resAdapter.validateOrder('999999', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 999999 does not exist in master data \(AUFK\)/)
      });
    });

    test('validateOrder rejects deleted order (LOEKZ = X)', async () => {
      await expect(resAdapter.validateOrder('100002', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100002 is marked for deletion/)
      });
    });

    test('validateOrder rejects order with plant mismatch', async () => {
      await expect(resAdapter.validateOrder('100003', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100003 belongs to plant 1130, not issuing plant 1120/)
      });
    });

    test('validateOrder rejects order in created status (CRTD / I0001)', async () => {
      await expect(resAdapter.validateOrder('100001', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100001 is not released \(status CRTD \/ requires REL \/ I0002\)/)
      });
    });

    test('validateOrder rejects locked order (LKD / I0043)', async () => {
      await expect(resAdapter.validateOrder('100043', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100043 is locked \(status LKD \/ I0043\)/)
      });
    });

    test('validateOrder rejects technically completed order (TECO / I0045)', async () => {
      await expect(resAdapter.validateOrder('100045', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100045 is technically completed \(status TECO \/ I0045\)/)
      });
    });

    test('validateOrder rejects closed order (CLSD / I0046)', async () => {
      await expect(resAdapter.validateOrder('100046', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100046 is closed \(status CLSD \/ I0046\)/)
      });
    });

    test('validateOrder rejects deletion-flagged order (DLFL / I0076)', async () => {
      await expect(resAdapter.validateOrder('100076', '1120')).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Order 100076 has deletion flag set \(status DLFL \/ I0076\)/)
      });
    });
  });

  describe('3. Backflush Component Rejection (RESB-RGEKZ)', () => {
    test('postGoodsMovement rejects backflush component (RGEKZ = X)', async () => {
      await expect(resAdapter.postGoodsMovement({
        reservationNo: '529999',
        reservationItem: '0001',
        movementType: '261',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        transferOrder: '1026100'
      })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Component is backflushed at order confirmation.*RESB-RGEKZ/)
      });
    });
  });

  describe('4. Reservation Creation (BAPI_RESERVATION_CREATE1)', () => {
    test('createReservation passes ORDERID padded to 12 chars and returns orderId', async () => {
      const res = await resAdapter.createReservation({
        movementType: '261',
        plant: '1120',
        storageLocation: 'CS01',
        material: '1000000045',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000'
      });

      expect(res.success).toBe(true);
      expect(res.reservationNo).toBe('529261');
      expect(res.orderId).toBe('1000000');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_RESERVATION_CREATE1',
        expect.objectContaining({
          RESERVATIONHEADER: expect.objectContaining({
            MOVE_TYPE: '261',
            ORDERID: '000001000000'
          })
        })
      );
    });
  });

  describe('5. TR Creation (L_TR_CREATE) for 261', () => {
    test('createTransferRequirement sets BWLVS=261, BETYP=F, BENUM=AUFNR.slice(-10)', async () => {
      const tr = await resAdapter.createTransferRequirement({
        warehouseNumber: 'W01',
        movementType: '261',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        reservationNo: '529261',
        reservationItem: '0001',
        orderId: '1000000'
      });

      expect(tr.success).toBe(true);
      expect(tr.trNumber).toBe('1000861');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'L_TR_CREATE',
        expect.objectContaining({
          T_LTBA: expect.arrayContaining([
            expect.objectContaining({
              BWLVS: '261',
              BETYP: 'F',
              BENUM: '0001000000',
              RSNUM: '0000529261'
            })
          ])
        })
      );
    });
  });

  describe('6. TO Creation (Z_WM_TO_CREATE_FROM_TR) & Confirmation Gate', () => {
    test('lookupTR maps OrderID from tr.Benum (Betyp F) and detects backflush status', async () => {
      const trData = await trAdapter.lookupTR('1000861', 'W01', 'TR');
      expect(trData.TransferRequirement).toBe('1000861');
      expect(trData.MovementType).toBe('261');
      expect(trData.RequirementType).toBe('F');
      expect(trData.OrderID).toBe('1000000');
      expect(trData.Backflush).toBe(false);
      expect(trData.DestinationStorageType).toBe('914');
      expect(trData.DestinationStorageBin).toBe('1000000');
    });

    test('createTOFromTR creates TO with destination 914 and dynamic bin <AUFNR>', async () => {
      const toRes = await trAdapter.createTOFromTR({
        warehouseNumber: 'W01',
        tbnum: '1000861',
        tbpos: '0001',
        qty: 10,
        unit: 'KG',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        orderId: '1000000',
        autoConfirm: false
      });

      expect(toRes.success).toBe(true);
      expect(toRes.toNumber).toBe('1026100');
      expect(toRes.OrderID).toBe('1000000');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'Z_WM_TO_CREATE_FROM_TR',
        expect.objectContaining({
          IV_TBNUM: '0001000861',
          IT_ITEMS: expect.arrayContaining([
            expect.objectContaining({
              NLTYP: '914',
              NLPLA: '1000000'
            })
          ])
        })
      );
    });

    test('postGoodsMovement enforces TO confirmation gate: fails if TO unconfirmed', async () => {
      const origRead = mockRfc.readTable;
      mockRfc.readTable = jest.fn(async (table, fields, options) => {
        if (table === 'LTAK') return [{ LGNUM: 'W01', TANUM: '0001026100', TBNUM: '0001000861', KQUIT: '' }]; // Unconfirmed
        return origRead(table, fields, options);
      });

      await expect(resAdapter.postGoodsMovement({
        reservationNo: '529261',
        reservationItem: '0001',
        movementType: '261',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        transferOrder: '1026100'
      })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Transfer Order 1026100 is not confirmed in SAP \(LTAK-KQUIT is blank\)/)
      });
    });
  });

  describe('7. MIGO 261 Goods Issue & Idempotency', () => {
    test('postGoodsMovement calls BAPI_GOODSMVT_CREATE with GM_CODE=03, MOVE_TYPE=261, ORDERID=AUFNR', async () => {
      const migo = await resAdapter.postGoodsMovement({
        reservationNo: '529261',
        reservationItem: '0001',
        movementType: '261',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        transferOrder: '1026100'
      });

      expect(migo.success).toBe(true);
      expect(migo.materialDocument).toBe('4900052261');
      expect(migo.materialDocYear).toBe('2026');
      expect(mockRfc.call).toHaveBeenCalledWith(
        'BAPI_GOODSMVT_CREATE',
        expect.objectContaining({
          GOODSMVT_CODE: { GM_CODE: '03' },
          GOODSMVT_ITEM: expect.arrayContaining([
            expect.objectContaining({
              MOVE_TYPE: '261',
              ORDERID: '000001000000',
              RESERV_NO: '0000529261',
              RES_ITEM: '0001'
            })
          ])
        })
      );
    });

    test('postGoodsMovement enforces stock shortfall check (MARD LABST < quantity)', async () => {
      await expect(resAdapter.postGoodsMovement({
        reservationNo: '529261',
        reservationItem: '0001',
        movementType: '261',
        material: '1000000099', // has 2.000 in mock, requested 10
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        transferOrder: '1026100'
      })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Insufficient stock in storage location CS01 for material 1000000099.*requested: 10/)
      });
    });

    test('postGoodsMovement protects idempotency: returns existing document on retry without calling SAP', async () => {
      const pid = '11111111-2222-3333-4444-555555555555';

      // First post
      const first = await resAdapter.postGoodsMovement({
        reservationNo: '529261',
        reservationItem: '0001',
        movementType: '261',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        transferOrder: '1026100',
        processId: pid
      });

      expect(first.materialDocument).toBe('4900052261');
      const callCountAfterFirst = mockRfc.call.mock.calls.filter((c) => c[0] === 'BAPI_GOODSMVT_CREATE').length;

      // Seed MATDOC to simulate persisted document in SAP transparent table
      const origRead = mockRfc.readTable;
      mockRfc.readTable = jest.fn(async (table, fields, options) => {
        const optStr = Array.isArray(options) ? options.join(' ') : String(options || '');
        if (table === 'MATDOC') {
          if (optStr.includes(`SGTXT = '${pid}'`) || optStr.includes("MBLNR = '004900052261'")) {
            return [{
              MBLNR: '004900052261', MJAHR: '2026', ZEILE: '0001', BWART: '261',
              MATNR: '000000001000000045', WERKS: '1120', LGORT: 'CS01', MENGE: '10.000',
              MEINS: 'KG', SHKZG: 'H', AUFNR: '000000100000', CANCELLED: '', REVERSAL_MOVEMENT: ''
            }];
          }
        }
        return origRead(table, fields, options);
      });

      // Second post (same processId / businessKey)
      const second = await resAdapter.postGoodsMovement({
        reservationNo: '529261',
        reservationItem: '0001',
        movementType: '261',
        material: '1000000045',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        transferOrder: '1026100',
        processId: pid
      });

      expect(second.materialDocument).toBe('4900052261');
      expect(second.alreadyPosted).toBe(true);
      const callCountAfterSecond = mockRfc.call.mock.calls.filter((c) => c[0] === 'BAPI_GOODSMVT_CREATE').length;
      expect(callCountAfterSecond).toBe(callCountAfterFirst); // Not posted again!
    });
  });

  describe('8. Complete Successful Lifecycle via Orchestrator', () => {
    test('executeReservationWarehouseFlow executes Stage 1 to 7 successfully for 261', async () => {
      const result = await resAdapter.executeReservationWarehouseFlow({
        movementType: '261',
        plant: '1120',
        storageLocation: 'CS01',
        material: '1000000045',
        quantity: 10,
        unit: 'KG',
        orderId: '1000000',
        warehouseNumber: 'W01',
        autoConfirm: true
      });

      expect(result.success).toBe(true);
      expect(result.reservationNumber).toBe('529261');
      expect(result.trNumber).toBe('1000861');
      expect(result.toNumber).toBe('1026100');
      expect(result.toConfirmed).toBe(true);
      expect(result.materialDocument).toBe('4900052261');
      expect(result.materialDocumentYear).toBe('2026');
      expect(result.processStatus).toBe('COMPLETED');
    });
  });
});
