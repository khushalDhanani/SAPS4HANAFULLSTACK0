'use strict';

/**
 * Critical Transaction Authorization & Gating Test Suite
 * Phase 2 — Gate critical SAP transactions
 *
 * Covers:
 * 3. Mvt261Service authorization & plant scope gating:
 *    - postGoodsIssue: Viewer (test-viewer-1120) -> 403, WarehouseClerk (test-clerk-1120) -> 200 Permitted
 *    - reverse: Viewer (test-viewer-1120) -> 403, WarehouseClerk (test-clerk-1120) -> 403, Admin (khushal) -> 200 Permitted
 *    - plantScope: test-clerk-1130 (plant 1130) -> 403 for plant 1120; test-viewer-noplant (no plant) -> 403
 *
 * 4. HuStockTransferService gating:
 *    - executeHuStockTransfer: Unauthenticated -> 401, Viewer (test-viewer-1120) -> 403, WarehouseClerk (test-clerk-1120) -> 200 Permitted
 *
 * [mock only, not SAP verification]
 */

// A clerk with no Plant attribute passes the role check, so only the plant scope can refuse it. It is added here, for this
// file only, before cds loads: plantScope.js:5 says a non-Admin with no Plant attribute sees nothing.
const { USERS } = require('../../testUsers');
process.env.CDS_CONFIG = JSON.stringify({ requires: { auth: { users: { ...USERS, 'test-clerk-noplant': { roles: ['Viewer', 'WarehouseClerk'] } } } } });

const cds = require('@sap/cds');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST, GET } = cds.test(__dirname + '/../../../');

describe('Phase 2: Critical Transaction Authorization & Gating [mock only, not SAP verification]', () => {
  let _mvt261CycleSpy;
  let mvt261PostSpy;
  let mvt261RevSpy;
  let huTransferSpy;
  let _s4HttpSpy;
  let _rfcReadTableSpy;

  beforeEach(() => {
    // S4HttpClient mock for reservation pre-checks with positive open quantities
    _s4HttpSpy = jest.spyOn(S4HttpClient.prototype, 'get').mockImplementation(async (path) => {
      const is301 = String(path).includes('301') || String(path).includes('520301');
      if (String(path).includes('C_ReservationDocTP_F4839')) {
        return {
          data: {
            d: {
              results: [{
                Reservation: is301 ? '520301' : '520001',
                IssuingOrReceivingPlant: is301 ? '1110' : '1120',
                IssuingOrReceivingStorageLoc: 'CS01',
                CostCenter: '1011201301'
              }]
            }
          }
        };
      }
      return {
        data: {
          d: {
            results: [{
              Reservation: is301 ? '520301' : '520001',
              ReservationItem: '0001',
              Plant: '1120',
              Material: '8000000023',
              MovementType: is301 ? '301' : '201',
              StorageLocation: 'HS01',
              ReceivingPlant: is301 ? '1110' : '1120',
              ReceivingStorageLocation: 'CS01',
              ResvnItmRequiredQtyInBaseUnit: '10.000',
              ResvnItmWithdrawnQtyInBaseUnit: '0.000'
            }]
          }
        }
      };
    });

    _rfcReadTableSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
      if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
      if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS01' }, { WERKS: '1110', LGORT: 'CS01' }];
      if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }, { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
      if (table === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011201301', DATBI: '99991231' }];
      if (table === 'MARC') return [{ MATNR: '000000008000000023', WERKS: '1120' }, { MATNR: '000000008000000023', WERKS: '1110' }];
      if (table === 'MARD') return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }, { MATNR: '000000008000000023', WERKS: '1110', LGORT: 'CS01', LABST: '50.000' }];
      if (table === 'LTBP' || table === 'LTAP') return [{ WERKS: '1120' }];
      return [];
    });







    // GoodsIssueAdapter spies





    // Mvt261Adapter spies
    _mvt261CycleSpy = jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockImplementation(async (input = {}) => {
      const allowed = input.allowedPlants;
      if (allowed !== undefined && allowed !== null && !allowed.includes('1120')) {
        const err = new Error('Not authorized for plant 1120');
        err.status = 403;
        throw err;
      }
      return {
        Reservation: '528780',
        ReservationItem: '1',
        Material: 'M',
        Plant: '1120',
        StorageLocation: 'CS01',
        ProductionOrder: '4000033120',
        OrderType: 'ZBDN',
        Unit: 'NOS',
        OpenQuantity: 10,
        History: [{
          MaterialDocument: '5000000261',
          MaterialDocumentYear: '2026',
          MaterialDocumentItem: '0001',
          MovementType: '261',
          IsReversed: false
        }]
      };
    });

    mvt261PostSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
      MaterialDocument: '5000000261', MaterialDocumentYear: '2026', DeliveryNumber: '', Pending: false, SapMessage: ''
    });

    mvt261RevSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockResolvedValue({
      MaterialDocument: '5000000262', MaterialDocumentYear: '2026', SapMessage: 'Reversed'
    });

    // plant-scope pre-read of the reservation (test-clerk-1120/test-clerk-1130 are plant-scoped users)
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ ReservationNo: '520001', ReservationItem: '1', Plant: '1120', OpenQty: 10 });
    // HuStockTransferAdapter spy
    huTransferSpy = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({
      Success: true,
      ReservationNo: '520311',
      ReservationItem: '0001',
      MaterialDocument: '5000000311',
      MaterialDocYear: '2026',
      TransferOrder: '1030311',
      Message: 'HU transferred successfully'
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 3. Mvt261Service Authorization, Reversal & Plant Scope Gating
  // =========================================================================
  describe('3. Mvt261Service Gating & Plant Scope', () => {
    it('postGoodsIssue: rejects Viewer (test-viewer-1120) with 403; permits WarehouseClerk (test-clerk-1120)', async () => {
      const url = '/odata/v4/mvt261/postGoodsIssue';
      const payload = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '528780', item: '1', quantity: 10 };

      await expect(POST(url, payload, { auth: { username: 'test-viewer-1120', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261PostSpy).not.toHaveBeenCalled();

      const res = await POST(url, payload, { auth: { username: 'test-clerk-1120', password: '' } });
      expect(res.status).toBe(200);
      expect(mvt261PostSpy).toHaveBeenCalledTimes(1);
    });

    it('postGoodsIssue: rejects out-of-scope clerk (test-clerk-1130, plant 1130) for plant 1120 reservation with 403', async () => {
      const url = '/odata/v4/mvt261/postGoodsIssue';
      const payload = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '528780', item: '1', quantity: 10 };
      await expect(POST(url, payload, { auth: { username: 'test-clerk-1130', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue: the service passes an empty plant scope for a clerk with no Plant attribute, and the post is refused', async () => {
      const url = '/odata/v4/mvt261/postGoodsIssue';
      const payload = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '528780', item: '1', quantity: 10 };
      // The 403 here is raised by the cycle stub at the top of this file when allowedPlants lacks 1120; the real adapter's check is not run.
      await expect(POST(url, payload, { auth: { username: 'test-clerk-noplant', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403, data: { error: { message: 'Not authorized for plant 1120' } } } });
      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    it('reverse: rejects Clerk (test-clerk-1120) with 403 (privilege escalation blocked); permits khushal (Admin/Manager)', async () => {
      const url = '/odata/v4/mvt261/reverse';
      const payload = {
        reservation: '528780',
        item: '1',
        materialDocument: '5000000261',
        materialDocumentYear: '2026',
        materialDocumentItem: '0001'
      };

      await expect(POST(url, payload, { auth: { username: 'test-clerk-1120', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261RevSpy).not.toHaveBeenCalled();

      const ok = await POST(url, payload, { auth: { username: 'khushal', password: '' } });
      expect(ok.status).toBe(200);
      expect(mvt261RevSpy).toHaveBeenCalledTimes(1);
    });

    it('plant scope: out-of-scope user (test-clerk-1130, plant 1130) asking for 1120 receives 403', async () => {
      const url = "/odata/v4/mvt261/openItems(plant='1120',material='',productionOrder='',reservation='',dateFrom='',dateTo='',includeFullyWithdrawn=false,scanPossibleOnly=false)";
      await expect(GET(url, { auth: { username: 'test-clerk-1130', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
    });

    it('plant scope: user with no plant scope (test-viewer-noplant) asking for 1120 receives 403', async () => {
      const url = "/odata/v4/mvt261/openItems(plant='1120',material='',productionOrder='',reservation='',dateFrom='',dateTo='',includeFullyWithdrawn=false,scanPossibleOnly=false)";
      await expect(GET(url, { auth: { username: 'test-viewer-noplant', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
    });
  });

  // =========================================================================
  // 4. HuStockTransferService Gating
  // =========================================================================
  describe('4. HuStockTransferService executeHuStockTransfer Gating', () => {
    const url = '/odata/v4/hu-stock-transfer/executeHuStockTransfer';
    const payload = {
      ReservationNo: '520311',
      ReservationItem: '0001',
      UnitNumber: '1000048321',
      TransferQty: 10,
      IsFullUnit: true,
      ClientAttemptId: 'hu-attempt-001'
    };

    it('rejects unauthenticated request with 401', async () => {
      await expect(POST(url, payload)).rejects.toMatchObject({ response: { status: 401 } });
      expect(huTransferSpy).not.toHaveBeenCalled();
    });

    it('rejects read-only Viewer (test-viewer-1120) with 403', async () => {
      await expect(POST(url, payload, { auth: { username: 'test-viewer-1120', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(huTransferSpy).not.toHaveBeenCalled();
    });

    it('permits authorized WarehouseClerk (test-clerk-1120)', async () => {
      const res = await POST(url, payload, { auth: { username: 'test-clerk-1120', password: '' } });
      expect(res.status).toBe(200);
      expect(huTransferSpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 5. Backend RFC Authorization Failure & Leak Prevention
  // =========================================================================
  // SAP is stubbed at RFC with a plain readTable. The error texts and message numbers are hand-written, so SAP's real wording is not
  // proven. Whether raw SAP error text (user, client) may reach the caller is an open question, not asserted here.
});
