'use strict';

/**
 * test/unit/wm/duplicateConcurrentTimeoutRecovery.test.js
 *
 * P1 - Protect SAP writes:
 * 1. Fail closed if production transaction logging is unavailable (HTTP 503, 0 SAP writes).
 * 2. Duplicate / concurrent posting protection (HTTP 409 Conflict, exactly 1 SAP write, replay of posted docs).
 * 3. Timeout recovery and unconfirmed outcome handling (claims kept alive, recheck reconciliation).
 *
 * [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');

describe('P1: Protect SAP Writes - Fail-Closed, Duplicate/Concurrent & Timeout Recovery [mock only]', () => {
  let _mvt261CycleSpy;
  let mvt261PostSpy;
  let mvt261RevSpy;
  let huTransferSpy;
  let _s4HttpSpy;
  let _rfcReadTableSpy;

  const authCarol = { auth: { username: 'test-clerk-1120', password: '' } };
  const authAlice = { auth: { username: 'khushal', password: '' } };

  beforeEach(async () => {
    jest.restoreAllMocks();
    try {
      if (cds.db) {
        await cds.db.run(cds.ql.DELETE.from('saps4hana.wm.GoodsIssuePostingAttempt'));
      }
    } catch {}
    GoodsIssueAttemptStore.clearMemoryStore();

    // Default S4HttpClient mock
    _s4HttpSpy = jest.spyOn(S4HttpClient.prototype, 'get').mockImplementation(async (path, options = {}) => {
      const full = `${path}?${options?.query || ''}`;
      const is301 = full.includes('301') || full.includes('520301');
      const is311 = full.includes('311') || full.includes('520311');
      if (full.includes('C_ReservationDocTP_F4839')) {
        return {
          data: {
            d: {
              results: [{
                Reservation: is301 ? '520301' : (is311 ? '520311' : '520001'),
                IssuingOrReceivingPlant: is301 ? '1110' : '1120',
                IssuingOrReceivingStorageLoc: is311 ? 'HS01' : 'CS01',
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
              Reservation: is301 ? '520301' : (is311 ? '520311' : '520001'),
              ReservationItem: '0001',
              Plant: '1120',
              Material: '8000000023',
              MovementType: is301 ? '301' : (is311 ? '311' : '201'),
              StorageLocation: 'CS01',
              ReceivingPlant: is301 ? '1110' : '1120',
              ReceivingStorageLocation: is311 ? 'HS01' : 'CS01',
              ResvnItmRequiredQtyInBaseUnit: '10.000',
              ResvnItmWithdrawnQtyInBaseUnit: '0.000'
            }]
          }
        }
      };
    });

    // Default RFC mock
    _rfcReadTableSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
      if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
      if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS01' }, { WERKS: '1110', LGORT: 'CS01' }, { WERKS: '1120', LGORT: 'HS01' }];
      if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }, { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
      if (table === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011201301', DATBI: '99991231' }];
      if (table === 'MARC') return [{ MATNR: '000000008000000023', WERKS: '1120' }, { MATNR: '000000008000000023', WERKS: '1110' }];
      if (table === 'MARD') return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }, { MATNR: '000000008000000023', WERKS: '1110', LGORT: 'CS01', LABST: '50.000' }, { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '100.000' }];
      if (table === 'AFKO') return [{ AUFNR: '000000001011', AUFPT: 'PP01' }];
      if (table === 'RESB') return [{ RSNUM: '0000528780', RSPOS: '0001', MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', BDMNG: '10.000', ENMNG: '0.000', MEINS: 'KG' }];
      return [];
    });

    // Adapter write spies




    _mvt261CycleSpy = jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue({
      Reservation: '0000528780',
      ReservationItem: '0001',
      Material: '8000000023',
      Plant: '1120',
      StorageLocation: 'CS01',
      Unit: 'KG',
      OpenQuantity: 10,
      ProductionOrder: '4000033120',
      OrderType: 'ZBDN',
      MovementAllowed: true,
      FinalIssue: false,
      IsDeleted: false,
      History: [{
        MaterialDocument: '4900050254',
        MaterialDocumentYear: '2026',
        MaterialDocumentItem: '0001',
        MovementType: '261',
        IsReversed: false
      }]
    });

    mvt261PostSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
      MaterialDocument: '4900050254',
      MaterialDocumentYear: '2026',
      Pending: false
    });

    mvt261RevSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockResolvedValue({
      MaterialDocument: '4900050255',
      MaterialDocumentYear: '2026'
    });

    // plant-scope pre-read of the reservation (test-clerk-1120/test-clerk-1130 are plant-scoped users)
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ ReservationNo: '520001', ReservationItem: '1', Plant: '1120', OpenQty: 10 });
    huTransferSpy = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({
      success: true,
      huNumber: '1122334455',
      materialDocument: '4900050999',
      materialDocYear: '2026',
      statusText: 'HU Stock Transfer Completed'
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // SECTION 1: Fail Closed If Production Transaction Logging Is Unavailable
  // ===========================================================================
  describe('1. Fail closed if production transaction logging is unavailable', () => {

    test('Mvt261 postGoodsIssue: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Attempt store write failure'));

      await expect(POST('/odata/v4/mvt261/postGoodsIssue', {
        movementType: '261',
        orderId: '4000033120',
        orderType: 'ZBDN',
        reservation: '0000528780',
        item: '0001',
        quantity: 1,
        storageUnits: []
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/goods issue posting-attempt log is unavailable/i) } }
        }
      });

      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    test('Mvt261 reverse: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Reversal audit log down'));

      await expect(POST('/odata/v4/mvt261/reverse', {
        reservation: '0000528780',
        item: '0001',
        materialDocument: '4900050254',
        materialDocumentYear: '2026',
        materialDocumentItem: '0001'
      }, authAlice)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/reversal attempt log is unavailable/i) } }
        }
      });

      expect(mvt261RevSpy).not.toHaveBeenCalled();
    });

    test('executeHuStockTransfer: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Attempt store down'));

      await expect(POST('/odata/v4/hu-stock-transfer/executeHuStockTransfer', {
        ReservationNo: '520001',
        ReservationItem: '0001',
        UnitNumber: '1122334455',
        TransferQty: 10,
        IsFullUnit: true,
        ClientAttemptId: 'test-hu-failclosed-006'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/production transaction logging is unavailable/i) } }
        }
      });

      expect(huTransferSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // SECTION 2: Duplicate / Concurrent Posting Protection
  // ===========================================================================
  describe('2. Duplicate and concurrent posting protection', () => {

    test('Mvt261 postGoodsIssue: a second submit while the first is still at SAP gets 409 and SAP is called once', async () => {
      let reachedSap;
      let releaseSap;
      const atSap = new Promise((resolve) => { reachedSap = resolve; });
      const sapHolds = new Promise((resolve) => { releaseSap = resolve; });
      mvt261PostSpy.mockImplementation(async () => {
        reachedSap();
        await sapHolds;
        return { MaterialDocument: '4900050254', MaterialDocumentYear: '2026', Pending: false };
      });
      const body = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '0000528780', item: '0001', quantity: 1 };

      const first = POST('/odata/v4/mvt261/postGoodsIssue', body, authCarol);
      await atSap;
      await expect(POST('/odata/v4/mvt261/postGoodsIssue', body, authCarol)).rejects.toMatchObject({
        response: { status: 409, data: { error: { message: 'A goods issue for reservation 0000528780/0001 is already in progress.' } } }
      });
      releaseSap();

      expect((await first).data.MaterialDocument).toBe('4900050254');
      expect(mvt261PostSpy).toHaveBeenCalledTimes(1);
    });

  });

  // ===========================================================================
  // SECTION 3: Timeout Recovery & Reconciliation
  // ===========================================================================
  describe('3. Timeout recovery and unconfirmed outcome reconciliation', () => {

    test('reconfirmUnconfirmed: promotes unconfirmed attempt to posted when readBackDocument confirms persistence in SAP', async () => {
      await GoodsIssueAttemptStore.create({
        ReferenceDocument: 'GI-TIMEOUT-REC-01',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'CS01',
        IssueQty: 2
      });

      await GoodsIssueAttemptStore.setStatus('GI-TIMEOUT-REC-01', 'unconfirmed', {
        MaterialDocument: '4900050888',
        MaterialDocYear: '2026'
      });

      // 2. Mock readBackDocument confirming document committed in SAP
      jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({
        MaterialDocument: '4900050888',
        MaterialDocYear: '2026',
        Confirmed: true,
        Status: 'confirmed',
        Tier: 'MATDOC'
      });

      // 3. Execute reconfirmUnconfirmed
      const summary = await GoodsIssueAttemptStore.reconfirmUnconfirmed(GoodsIssueAdapter);

      expect(summary.Checked).toBe(1);
      expect(summary.Confirmed).toBe(1);
      const row = await GoodsIssueAttemptStore.getByReference('GI-TIMEOUT-REC-01');
      expect(row.Status).toBe('posted');
      expect(row.MaterialDocument).toBe('4900050888');
      expect(row.MaterialDocYear).toBe('2026');
    });

  });
});
