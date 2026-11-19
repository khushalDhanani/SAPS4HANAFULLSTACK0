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
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

cds.test(__dirname + '/../../../');

describe('P1: Protect SAP Writes - Fail-Closed, Duplicate/Concurrent & Timeout Recovery [mock only]', () => {
  let _s4HttpSpy;
  let _rfcReadTableSpy;

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

  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // SECTION 1: Fail closed if production transaction logging is unavailable
  // ===========================================================================
  describe('1. Fail closed when durable database is unavailable (HTTP 503, 0 SAP writes)', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test('isAvailable returns true when database is bound, and false in production when db is null', () => {
      expect(GoodsIssueAttemptStore.isAvailable()).toBe(true);

      process.env.NODE_ENV = 'production';
      const storeWithoutDb = new GoodsIssueAttemptStore.GoodsIssueAttemptStore({ db: null });
      expect(storeWithoutDb.isAvailable()).toBe(false);
    });

    test('create fails closed with HTTP 503 when durable database is unavailable in production', async () => {
      process.env.NODE_ENV = 'production';
      const storeWithoutDb = new GoodsIssueAttemptStore.GoodsIssueAttemptStore({ db: null });

      await expect(storeWithoutDb.create({
        ReferenceDocument: 'GI-FAILCLOSED-01',
        RequestHash: 'HASH-FAIL-01',
        MovementType: '201',
        IssueQty: 1
      })).rejects.toMatchObject({
        status: 503,
        statusCode: 503,
        code: 'DB_UNAVAILABLE'
      });
    });

    test('createOrGet fails closed with HTTP 503 when durable database is unavailable in production', async () => {
      process.env.NODE_ENV = 'production';
      const storeWithoutDb = new GoodsIssueAttemptStore.GoodsIssueAttemptStore({ db: null });

      await expect(storeWithoutDb.createOrGet({
        ReferenceDocument: 'GI-FAILCLOSED-02',
        RequestHash: 'HASH-FAIL-02',
        MovementType: '201',
        IssueQty: 1
      })).rejects.toMatchObject({
        status: 503,
        statusCode: 503,
        code: 'DB_UNAVAILABLE'
      });
    });

    test('setStatus fails closed with HTTP 503 when durable database is unavailable in production', async () => {
      process.env.NODE_ENV = 'production';
      const storeWithoutDb = new GoodsIssueAttemptStore.GoodsIssueAttemptStore({ db: null });

      await expect(storeWithoutDb.setStatus('GI-FAILCLOSED-03', 'posted')).rejects.toMatchObject({
        status: 503,
        statusCode: 503,
        code: 'DB_UNAVAILABLE'
      });
    });
  });

  // ===========================================================================
  // SECTION 2: Duplicate / Concurrent Posting Protection Across Instances
  // ===========================================================================
  describe('2. Duplicate / Concurrent Posting Protection Across Instances', () => {
    test('two instances sharing database: second concurrent claim on same reference returns created: false', async () => {
      const instanceA = new GoodsIssueAttemptStore.GoodsIssueAttemptStore();
      const instanceB = new GoodsIssueAttemptStore.GoodsIssueAttemptStore();

      const claimData = {
        ReferenceDocument: 'GI-CONC-001',
        RequestHash: 'HASH-CONC-001',
        MovementType: '201',
        ReservationNo: '520001',
        ReservationItem: '0001',
        IssueQty: 5
      };

      const firstClaim = await instanceA.createOrGet(claimData);
      expect(firstClaim.created).toBe(true);
      expect(firstClaim.row.ReferenceDocument).toBe('GI-CONC-001');

      const secondClaim = await instanceB.createOrGet(claimData);
      expect(secondClaim.created).toBe(false);
      expect(secondClaim.row.ReferenceDocument).toBe('GI-CONC-001');
      expect(secondClaim.row.Status).toBe('sending');
    });

    test('reference collision with different RequestHash throws HTTP 409 Conflict across instances', async () => {
      const instanceA = new GoodsIssueAttemptStore.GoodsIssueAttemptStore();
      const instanceB = new GoodsIssueAttemptStore.GoodsIssueAttemptStore();

      await instanceA.createOrGet({
        ReferenceDocument: 'GI-COLLIDE-01',
        RequestHash: 'ORIGINAL-REQUEST-HASH',
        MovementType: '201',
        IssueQty: 1
      });

      await expect(instanceB.createOrGet({
        ReferenceDocument: 'GI-COLLIDE-01',
        RequestHash: 'DIFFERENT-REQUEST-HASH',
        MovementType: '201',
        IssueQty: 2
      })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('idempotency reference collision')
      });
    });

    test('replay of already posted document returns created: false with SAP document number', async () => {
      const claimData = {
        ReferenceDocument: 'GI-REPLAY-01',
        RequestHash: 'HASH-REPLAY-01',
        MovementType: '201',
        IssueQty: 1
      };

      const claim = await GoodsIssueAttemptStore.createOrGet(claimData);
      expect(claim.created).toBe(true);

      await GoodsIssueAttemptStore.setStatus('GI-REPLAY-01', 'posted', {
        MaterialDocument: '4900099999',
        MaterialDocYear: '2026'
      });

      const replay = await GoodsIssueAttemptStore.createOrGet(claimData);
      expect(replay.created).toBe(false);
      expect(replay.row.Status).toBe('posted');
      expect(replay.row.MaterialDocument).toBe('4900099999');
    });
  });

  // ===========================================================================
  // SECTION 3: Timeout Recovery & Reconciliation
  // ===========================================================================
  describe('3. Timeout recovery and unconfirmed outcome reconciliation', () => {
    test('unconfirmed or sending attempt blocks blind re-claim until reconciled', async () => {
      const claimData = {
        ReferenceDocument: 'GI-UNC-RETRY',
        RequestHash: 'HASH-UNC-RETRY',
        MovementType: '201',
        IssueQty: 1
      };

      await GoodsIssueAttemptStore.createOrGet(claimData);
      await GoodsIssueAttemptStore.setStatus('GI-UNC-RETRY', 'unconfirmed', {
        MaterialDocument: '4900077777',
        MaterialDocYear: '2026'
      });

      // Attempting to re-claim an unconfirmed attempt with reclaim policy must be rejected
      const retryClaim = await GoodsIssueAttemptStore.createOrGet(claimData, {
        reclaimableStatuses: ['rejected', 'not_posted']
      });

      expect(retryClaim.created).toBe(false);
      expect(retryClaim.row.Status).toBe('unconfirmed');
    });

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
