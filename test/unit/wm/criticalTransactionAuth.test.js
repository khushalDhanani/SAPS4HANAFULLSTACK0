'use strict';

/**
 * Critical Transaction Authorization & Gating Test Suite
 * Phase 2 — Gate critical SAP transactions
 *
 * Covers:
 * 4. HuStockTransferService gating:
 *    - executeHuStockTransfer: Unauthenticated -> 401, Viewer (test-viewer-1120) -> 403, WarehouseClerk (test-clerk-1120) -> 200 Permitted
 *
 * [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');

describe('Phase 2: Critical Transaction Authorization & Gating [mock only, not SAP verification]', () => {
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
