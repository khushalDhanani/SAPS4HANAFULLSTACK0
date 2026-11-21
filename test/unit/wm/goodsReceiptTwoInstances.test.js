'use strict';

/**
 * test/unit/wm/goodsReceiptTwoInstances.test.js
 *
 * Unit tests for multi-instance goods receipt background recheck scheduling and distributed worker leasing.
 * Resolves Finding MON-02 (P1): Goods receipt recheck timer can run on both CF instances.
 *
 * Verifies:
 * 1. Proven single-worker strategy via CF_INSTANCE_INDEX:
 *    - Only Instance 0 runs scheduled background timers.
 *    - Secondary Cloud Foundry instances (CF_INSTANCE_INDEX != 0) do not start the timer.
 * 2. Distributed worker lease protection:
 *    - Two instances sharing the database cannot independently process the same unresolved attempt.
 *    - The instance that acquires the lease processes the attempt; the competing instance skips it.
 *    - Lease expiration recovery works if a worker fails mid-call.
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const { GoodsReceiptAttemptStore, ATTEMPT_ENTITY } = require('../../../srv/wm/goods-receipt/GoodsReceiptAttemptStore');
const GoodsReceiptService = require('../../../srv/wm/goods-receipt/service');

const RECEIPT_ATTEMPT = {
  ReferenceDocument: 'GR2INST101',
  RequestHash: 'hash-gr-two-instances',
  MovementType: '101',
  ReservationNo: '0180000001',
  ReservationItem: '000010',
  Material: 'TG11',
  Plant: '1120',
  StorageLocation: 'HS01',
  IssueQty: 10,
  Unit: 'KG',
  Status: 'sending'
};

describe('Finding MON-02: Goods Receipt Two-Instance Background Scheduling & Distributed Leasing', () => {

  describe('Single-Worker Strategy (CF_INSTANCE_INDEX)', () => {
    it('identifies primary instance 0 or undefined as the active worker', () => {
      expect(GoodsReceiptService.isWorker({ CF_INSTANCE_INDEX: '0' })).toBe(true);
      expect(GoodsReceiptService.isWorker({})).toBe(true);
      expect(GoodsReceiptService.isWorker({ CF_INSTANCE_INDEX: undefined })).toBe(true);
    });

    it('identifies secondary Cloud Foundry instances (1, 2, ...) as non-workers', () => {
      expect(GoodsReceiptService.isWorker({ CF_INSTANCE_INDEX: '1' })).toBe(false);
      expect(GoodsReceiptService.isWorker({ CF_INSTANCE_INDEX: '2' })).toBe(false);
      expect(GoodsReceiptService.isWorker({ CF_INSTANCE_INDEX: 'worker-2' })).toBe(false);
    });

    it('starts recheck timer only on worker instance 0 and disables it on secondary instance', () => {
      const mockStore = { recheckReceipts: jest.fn() };
      const mockAdapter = {};

      // Secondary instance (CF_INSTANCE_INDEX = "1")
      const timerSec = GoodsReceiptService.startRecheckJob({
        getStore: () => mockStore,
        getAdapter: () => mockAdapter,
        env: { NODE_ENV: 'production', CF_INSTANCE_INDEX: '1' }
      });
      expect(timerSec).toBeNull();

      // Primary worker instance (CF_INSTANCE_INDEX = "0")
      const timerPrimary = GoodsReceiptService.startRecheckJob({
        getStore: () => mockStore,
        getAdapter: () => mockAdapter,
        env: { NODE_ENV: 'production', CF_INSTANCE_INDEX: '0' }
      });
      expect(timerPrimary).not.toBeNull();
      GoodsReceiptService.stopRecheckJob(timerPrimary);
    });

    it('skips timer in test profile unless explicitly opted in via RECEIPT_RECHECK_IN_TEST=1', () => {
      expect(GoodsReceiptService.startRecheckJob({
        env: { NODE_ENV: 'test', CF_INSTANCE_INDEX: '0' }
      })).toBeNull();

      const timer = GoodsReceiptService.startRecheckJob({
        env: { NODE_ENV: 'test', CF_INSTANCE_INDEX: '0', RECEIPT_RECHECK_IN_TEST: '1' }
      });
      expect(timer).not.toBeNull();
      GoodsReceiptService.stopRecheckJob(timer);
    });
  });

  describe('Distributed Worker Lease Coordination Across 2 Instances', () => {
    let storeA;
    let storeB;

    beforeEach(async () => {
      if (cds.db) {
        await cds.db.run(cds.ql.DELETE.from(ATTEMPT_ENTITY));
      }
      storeA = new GoodsReceiptAttemptStore();
      storeB = new GoodsReceiptAttemptStore();
    });

    it('prevents two instances from independently processing the same unresolved receipt attempt', async () => {
      // Seed an unresolved receipt attempt in shared database
      await storeA.create(RECEIPT_ATTEMPT);

      const findReceiptMock = jest.fn().mockImplementation(async () => {
        // Simulate latency during SAP verification
        await new Promise((r) => setTimeout(r, 50));
        return { MaterialDocument: '5000000099', MaterialDocumentYear: '2026' };
      });

      const adapter = { findReceiptForAttempt: findReceiptMock };

      // Set reference time 15 minutes in the future so attempt passes recheckAge threshold
      const checkTime = Date.now() + 15 * 60 * 1000;

      // Instance A (worker 0) and Instance B (worker 1) execute recheck concurrently
      const [resA, resB] = await Promise.all([
        storeA.recheckReceipts(adapter, checkTime, { workerId: '0', leaseMs: 60000 }),
        storeB.recheckReceipts(adapter, checkTime, { workerId: '1', leaseMs: 60000 })
      ]);

      // Exactly ONE instance must have processed and posted the document
      expect(resA.Posted + resB.Posted).toBe(1);

      // The other instance must have detected the active lease and skipped the attempt
      expect((resA.SkippedLocked || 0) + (resB.SkippedLocked || 0)).toBe(1);

      // S/4HANA adapter findReceiptForAttempt must have been called exactly once, NEVER twice
      expect(findReceiptMock).toHaveBeenCalledTimes(1);

      // Database reflects posted status with confirmed SAP document number
      const row = await storeA.getByReference(RECEIPT_ATTEMPT.ReferenceDocument);
      expect(row).toMatchObject({
        Status: 'posted',
        MaterialDocument: '5000000099',
        MaterialDocYear: '2026'
      });
    });

    it('allows a secondary instance to recover an attempt if the primary worker lease expires', async () => {
      await storeA.create(RECEIPT_ATTEMPT);

      const now = Date.now() + 15 * 60 * 1000;
      // Worker 0 acquired a lease with 10s duration
      const claimedA = await storeA.claimAttemptForRecheck(
        RECEIPT_ATTEMPT.ReferenceDocument,
        '0',
        10000,
        now
      );
      expect(claimedA).toBeTruthy();

      // Immediate attempt by Worker 1 fails because Worker 0 holds the lease
      const claimedBImmediate = await storeB.claimAttemptForRecheck(
        RECEIPT_ATTEMPT.ReferenceDocument,
        '1',
        10000,
        now + 1000
      );
      expect(claimedBImmediate).toBe(false);

      // 15 seconds later (lease expired at now + 10s): Worker 1 successfully claims and processes the attempt
      const claimedBLater = await storeB.claimAttemptForRecheck(
        RECEIPT_ATTEMPT.ReferenceDocument,
        '1',
        10000,
        now + 15000
      );
      expect(claimedBLater).toBeTruthy();
    });
  });
});
