'use strict';

/**
 * test/unit/wm/postingAttemptLifecycleContract.test.js
 *
 * Verification suite for the Common Posting-Attempt Lifecycle and Shared Storage Contract.
 * Resolves Finding DEBT-01 (P2): Posting-attempt store has accumulated multiple responsibilities.
 *
 * Verifies:
 * 1. Shared contract exports and generic aliases (`PostingAttemptStore` === `GoodsIssueAttemptStore`).
 * 2. Presence and signatures of Core Generic Lifecycle interface methods (`IPostingAttemptStore`).
 * 3. Lifecycle constants (`OPEN_STATUSES`, `FINAL_STATUSES`, `RECEIPT_MOVEMENT`).
 * 4. State machine transitions from open to terminal states.
 * 5. Idempotent replay and generation re-claim audit trail semantics.
 * 6. Distributed worker lease acquisition (atomic CAS) and release.
 * 7. Fail-closed production protection when durable database is unavailable.
 */

const attemptsDefault = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const {
  GoodsIssueAttemptStore,
  PostingAttemptStore,
  ATTEMPT_ENTITY,
  OPEN_STATUSES,
  FINAL_STATUSES,
  RECEIPT_MOVEMENT
} = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');

describe('Finding DEBT-01: Common Posting-Attempt Lifecycle & Shared Contract', () => {

  describe('Shared Contract & Export Aliases', () => {
    it('exports PostingAttemptStore as an alias to GoodsIssueAttemptStore', () => {
      expect(PostingAttemptStore).toBeDefined();
      expect(PostingAttemptStore).toBe(GoodsIssueAttemptStore);
      expect(attemptsDefault).toBeInstanceOf(PostingAttemptStore);
    });

    it('exposes the underlying persistent entity name and movement constants', () => {
      expect(ATTEMPT_ENTITY).toBe('saps4hana.wm.GoodsIssuePostingAttempt');
      expect(RECEIPT_MOVEMENT).toBe('101');
    });

    it('defines standardized lifecycle state sets', () => {
      expect(OPEN_STATUSES).toContain('sending');
      expect(OPEN_STATUSES).toContain('unconfirmed');
      expect(FINAL_STATUSES).toEqual(
        expect.arrayContaining(['posted', 'rejected', 'not_posted', 'delivery_created'])
      );
    });

    it('implements all required methods of the IPostingAttemptStore contract', () => {
      const store = new PostingAttemptStore({ db: null, useMemoryStore: true });

      // Core Generic Attempt Persistence
      expect(typeof store.isAvailable).toBe('function');
      expect(typeof store.create).toBe('function');
      expect(typeof store.createOrGet).toBe('function');
      expect(typeof store.getByReference).toBe('function');
      expect(typeof store.setStatus).toBe('function');

      // Distributed Multi-Instance Leasing
      expect(typeof store.claimAttemptForRecheck).toBe('function');
      expect(typeof store.releaseAttemptLease).toBe('function');

      // Movement-Specific Reconciliation Strategies
      expect(typeof store.reconfirmUnconfirmed).toBe('function');
      expect(typeof store.recheck).toBe('function');
      expect(typeof store.recheckReceipts).toBe('function');
    });
  });

  describe('Core Generic Lifecycle State Transitions & Idempotency', () => {
    let store;

    beforeEach(() => {
      store = new PostingAttemptStore({ db: null, useMemoryStore: true });
    });

    it('records initial attempt in sending status and moves to posted upon confirmation', async () => {
      const attempt = await store.create({
        ReferenceDocument: 'REF-LIFECYCLE-01',
        RequestHash: 'hash-lifecycle-01',
        MovementType: '261',
        Material: 'TG11',
        IssueQty: 5
      });

      expect(attempt.Status).toBe('sending');
      expect(attempt.ResolvedAt).toBeNull();

      // Confirm success in SAP
      await store.setStatus('REF-LIFECYCLE-01', 'posted', {
        MaterialDocument: '5000000001',
        MaterialDocYear: '2026'
      });

      const updated = await store.getByReference('REF-LIFECYCLE-01');
      expect(updated.Status).toBe('posted');
      expect(updated.MaterialDocument).toBe('5000000001');
      expect(updated.MaterialDocYear).toBe('2026');
      expect(updated.ResolvedAt).toBeDefined();
    });

    it('handles timeout transition to unconfirmed and prevents blind retries without reclaim policy', async () => {
      const requestData = {
        ReferenceDocument: 'REF-TIMEOUT-01',
        RequestHash: 'hash-timeout-01',
        MovementType: '261'
      };

      await store.createOrGet(requestData);
      await store.setStatus('REF-TIMEOUT-01', 'unconfirmed', {
        LastError: 'S/4HANA Gateway timeout 504'
      });

      // Blind replay of identical request returns { created: false } to prevent duplicate postings
      const replay = await store.createOrGet(requestData);
      expect(replay.created).toBe(false);
      expect(replay.row.Status).toBe('unconfirmed');
    });

    it('permits generation re-claim (-1) after definitive rejection while keeping audit history', async () => {
      const baseRequest = {
        ReferenceDocument: 'GI-RECLAIM-01',
        RequestHash: 'hash-reclaim-01',
        MovementType: '261'
      };

      const reclaimPolicy = { reclaimableStatuses: ['rejected', 'not_posted'] };

      // Generation 0 attempt
      const first = await store.createOrGet(baseRequest, reclaimPolicy);
      expect(first.created).toBe(true);
      expect(first.row.ReferenceDocument).toBe('GI-RECLAIM-010');

      // Rejected by SAP (e.g. storage location deficit)
      await store.setStatus('GI-RECLAIM-010', 'rejected', {
        LastError: 'Deficit of BA On-order stock'
      });

      // Re-claim policy allows next generation (1) for rejected attempts
      const retry = await store.createOrGet(baseRequest, reclaimPolicy);

      expect(retry.created).toBe(true);
      expect(retry.row.ReferenceDocument).toBe('GI-RECLAIM-011');

      // Audit history preserves both generations under identical RequestHash
      const history = await store._attemptsByRequestHash('hash-reclaim-01');
      expect(history).toHaveLength(2);
      expect(history[0].ReferenceDocument).toBe('GI-RECLAIM-010');
      expect(history[0].Status).toBe('rejected');
      expect(history[1].ReferenceDocument).toBe('GI-RECLAIM-011');
      expect(history[1].Status).toBe('sending');
    });

    it('enforces distributed worker lease acquisition and release with timestamp expiry', async () => {
      await store.create({
        ReferenceDocument: 'GR-LEASE-01',
        RequestHash: 'hash-lease-01',
        MovementType: '101'
      });

      const now = Date.now();
      // Worker 0 acquires a 30s lease
      const claimed = await store.claimAttemptForRecheck('GR-LEASE-01', '0', 30000, now);
      expect(claimed).toBe(true);

      // Worker 1 cannot claim while Worker 0 holds unexpired lease
      const competing = await store.claimAttemptForRecheck('GR-LEASE-01', '1', 30000, now + 1000);
      expect(competing).toBe(false);

      // Releasing lease clears the lock
      await store.releaseAttemptLease('GR-LEASE-01', '0');
      const reClaimed = await store.claimAttemptForRecheck('GR-LEASE-01', '1', 30000, now + 2000);
      expect(reClaimed).toBe(true);
    });
  });

  describe('Durable Database Availability & Fail-Closed Guard', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('fails closed with HTTP 503 if durable database is unavailable in production', async () => {
      process.env.NODE_ENV = 'production';
      const prodStoreWithoutDb = new PostingAttemptStore({ db: null });

      expect(prodStoreWithoutDb.isAvailable()).toBe(false);

      await expect(
        prodStoreWithoutDb.create({
          ReferenceDocument: 'FAIL-PROD-01',
          RequestHash: 'hash-fail-01'
        })
      ).rejects.toMatchObject({
        status: 503,
        code: 'DB_UNAVAILABLE'
      });
    });
  });
});
