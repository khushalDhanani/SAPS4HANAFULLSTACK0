'use strict';

/**
 * Concurrency review of the Goods Receipt recheck lease (GoodsReceiptRecheckService.js).
 * The lease is stored in the attempt's LastError column as `lease:<worker>:<expiry ISO>`.
 * Runs against the test-profile database; SAP is mocked. [mock only, not SAP verification]
 *
 * Complements goodsReceiptTwoInstances.test.js (two rechecks in parallel, lease expiry by raw claim).
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const { GoodsReceiptAttemptStore, ATTEMPT_ENTITY } = require('../../../srv/wm/goods-receipt/GoodsReceiptAttemptStore');

const REF = 'GRLEASE101';
const ATTEMPT = {
  ReferenceDocument: REF,
  RequestHash: 'hash-gr-lease-review',
  MovementType: '101',
  ReservationNo: '0180000002',
  ReservationItem: '000010',
  Material: 'TG11',
  Plant: '1120',
  StorageLocation: 'HS01',
  IssueQty: 5,
  Unit: 'KG',
  Status: 'sending'
};
const MIN = 60 * 1000;
const FOUND = { MaterialDocument: '5000000123', MaterialDocumentYear: '2026' };

describe('Goods Receipt recheck lease: concurrency review', () => {
  let store;
  let soon; // past the recheck age, before the not_posted age
  let old; // past the not_posted age

  const setLastError = (value) => cds.db.run(cds.ql.UPDATE(ATTEMPT_ENTITY).set({ LastError: value }).where({ ReferenceDocument: REF }));
  const row = () => store.getByReference(REF);

  beforeEach(async () => {
    await cds.db.run(cds.ql.DELETE.from(ATTEMPT_ENTITY));
    store = new GoodsReceiptAttemptStore();
    await store.create(ATTEMPT);
    soon = Date.now() + 4 * MIN;
    old = Date.now() + 16 * MIN;
  });

  describe('two instances claiming the same attempt simultaneously', () => {
    it('grants exactly one of several simultaneous claims', async () => {
      const results = await Promise.all(
        ['0', '1', '2', '3', '4'].map((worker) => new GoodsReceiptAttemptStore().claimAttemptForRecheck(REF, worker, MIN, soon))
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await row()).LastError).toMatch(/^lease:[0-4]:/);
    });

    it('does not read SAP while another instance holds an unexpired lease', async () => {
      await setLastError(`lease:9:${new Date(soon + MIN).toISOString()}`);
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(FOUND) };

      const summary = await store.recheckReceipts(adapter, soon, { workerId: '1' });

      expect(adapter.findReceiptForAttempt).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ Checked: 1, SkippedLocked: 1, Posted: 0 });
      expect((await row()).Status).toBe('sending');
    });
  });

  describe('expired lease recovery', () => {
    it('lets another instance take over and finish an attempt whose lease expired', async () => {
      await setLastError(`lease:9:${new Date(soon - 1000).toISOString()}`);
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(FOUND) };

      const summary = await store.recheckReceipts(adapter, soon, { workerId: '1' });

      expect(summary.Posted).toBe(1);
      expect(await row()).toMatchObject({ Status: 'posted', MaterialDocument: '5000000123', LastError: '' });
    });

    it('treats a lease tag with an unreadable expiry as claimable instead of blocking forever', async () => {
      await setLastError('lease:9:not-a-date');

      await expect(store.claimAttemptForRecheck(REF, '1', MIN, soon)).resolves.toBe(true);
    });
  });

  describe('worker failure during SAP read-back', () => {
    it('releases the lease and keeps the status when the read-back throws', async () => {
      const adapter = { findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('RFC connection lost')) };

      const summary = await store.recheckReceipts(adapter, old, { workerId: '0' });

      expect(summary).toMatchObject({ Errors: 1, Posted: 0, NotPosted: 0 });
      expect(await row()).toMatchObject({ Status: 'sending', LastError: '' });
      await expect(store.claimAttemptForRecheck(REF, '1', MIN, old)).resolves.toBe(true);
    });

    it('never marks an attempt not_posted on a failed read-back, however old it is', async () => {
      const adapter = { findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('timeout')) };

      await store.recheckReceipts(adapter, old + 60 * MIN, { workerId: '0' });

      expect((await row()).Status).toBe('sending');
    });

    it('a worker that dies mid read-back blocks others only until its lease expires', async () => {
      await expect(store.claimAttemptForRecheck(REF, '0', MIN, soon)).resolves.toBe(true); // worker 0 dies here

      await expect(store.claimAttemptForRecheck(REF, '1', MIN, soon + MIN - 1)).resolves.toBe(false);
      await expect(store.claimAttemptForRecheck(REF, '1', MIN, soon + MIN + 1)).resolves.toBe(true);
    });
  });

  describe('worker restart during an unresolved posting', () => {
    it('leaves an attempt younger than the recheck age alone (the posting may still be in flight)', async () => {
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(null) };

      const summary = await store.recheckReceipts(adapter, Date.now() + MIN, { workerId: '0' });

      expect(summary.Checked).toBe(0);
      expect(adapter.findReceiptForAttempt).not.toHaveBeenCalled();
      expect(await row()).toMatchObject({ Status: 'sending', LastError: '' });
    });

    it('a restarted worker with the same id resumes its own unexpired lease', async () => {
      await store.claimAttemptForRecheck(REF, '0', MIN, soon); // before the restart
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(FOUND) };

      const summary = await new GoodsReceiptAttemptStore().recheckReceipts(adapter, soon + 1000, { workerId: '0' });

      expect(summary.Posted).toBe(1);
      expect((await row()).Status).toBe('posted');
    });

    it('does not claim an attempt that reached a final status in the meantime', async () => {
      await store.setStatus(REF, 'posted', { MaterialDocument: '5000000001', MaterialDocYear: '2026', LastError: '' });

      await expect(store.claimAttemptForRecheck(REF, '0', MIN, soon)).resolves.toBe(false);
      expect(await row()).toMatchObject({ Status: 'posted', MaterialDocument: '5000000001' });
    });

    // Known limitation, recorded so that a change is deliberate: the lease identifies a worker by
    // CF_INSTANCE_INDEX only, so two processes with the same index are not excluded from each other.
    it('KNOWN LIMITATION: two processes sharing a worker id both obtain the lease', async () => {
      await expect(store.claimAttemptForRecheck(REF, '0', MIN, soon)).resolves.toBe(true);
      await expect(new GoodsReceiptAttemptStore().claimAttemptForRecheck(REF, '0', MIN, soon + 1000)).resolves.toBe(true);
    });
  });

  describe('lease metadata and meaningful error information', () => {
    const REASON = 'RFC timeout: outcome unknown';

    it('releasing a lease does not touch an error written by someone else in the meantime', async () => {
      await store.claimAttemptForRecheck(REF, '0', MIN, soon);
      await store.setStatus(REF, 'rejected', { LastError: 'SAP rejected: M7 021' });

      await store.releaseAttemptLease(REF, '0');

      expect(await row()).toMatchObject({ Status: 'rejected', LastError: 'SAP rejected: M7 021' });
    });

    it('a recheck that ends not_posted records its own finding', async () => {
      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockResolvedValue(null) }, old, { workerId: '0' });

      const after = await row();
      expect(after.Status).toBe('not_posted');
      expect(after.LastError).toMatch(/^Recheck: no goods receipt for delivery 0180000002/);
    });

    // KNOWN DEFECT (it.failing passes while the defect exists and fails once it is fixed):
    // an unconfirmed attempt carries the reason its outcome is unknown in LastError. Claiming the
    // lease overwrites that reason and releasing the lease clears the column, so the reason is lost.
    it.failing('DEFECT: the reason of an unconfirmed attempt survives a recheck that leaves it open', async () => {
      await store.setStatus(REF, 'unconfirmed', { LastError: REASON });

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockResolvedValue(null) }, soon, { workerId: '0' });

      expect(await row()).toMatchObject({ Status: 'unconfirmed', LastError: REASON });
    });

    it.failing('DEFECT: the reason of an unconfirmed attempt survives a failed SAP read-back', async () => {
      await store.setStatus(REF, 'unconfirmed', { LastError: REASON });

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('RFC down')) }, soon, { workerId: '0' });

      expect(await row()).toMatchObject({ Status: 'unconfirmed', LastError: REASON });
    });
  });
});
