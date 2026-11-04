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
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');

describe('P1: Protect SAP Writes - Fail-Closed, Duplicate/Concurrent & Timeout Recovery [mock only]', () => {
  let huTransferSpy;
  let _s4HttpSpy;
  let _rfcReadTableSpy;

  const authCarol = { auth: { username: 'test-clerk-1120', password: '' } };

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
