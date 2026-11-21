'use strict';

/**
 * Goods Receipt recheck: lease (LeaseOwner / LeaseExpiresAt, unique token per claim) and evidence rules
 * (an attempt is resolved only on reliable evidence). Test database; SAP mocked, not SAP verification.
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

  const setLease = (owner, expiresAtMs) => cds.db.run(cds.ql.UPDATE(ATTEMPT_ENTITY)
    .set({ LeaseOwner: owner, LeaseExpiresAt: new Date(expiresAtMs).toISOString() }).where({ ReferenceDocument: REF }));
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
      expect(await row()).toMatchObject({ LeaseOwner: results.find(Boolean), LastError: '' });
    });

    it('does not read SAP while another instance holds an unexpired lease', async () => {
      await setLease('9:other-run', soon + MIN);
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(FOUND) };

      const summary = await store.recheckReceipts(adapter, soon, { workerId: '1' });

      expect(adapter.findReceiptForAttempt).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ Checked: 1, SkippedLocked: 1, Posted: 0 });
      expect((await row()).Status).toBe('sending');
    });
  });

  describe('expired lease recovery', () => {
    it('lets another instance take over and finish an attempt whose lease expired', async () => {
      await setLease('9:other-run', soon - 1000);
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(FOUND) };

      const summary = await store.recheckReceipts(adapter, soon, { workerId: '1' });

      expect(summary.Posted).toBe(1);
      expect(await row()).toMatchObject({ Status: 'posted', MaterialDocument: '5000000123', LastError: '', LeaseOwner: null, LeaseExpiresAt: null });
    });

    it('ignores a result from a worker whose lease was taken over during a slow read-back', async () => {
      let takenOver;
      const slowWorker = {
        findReceiptForAttempt: jest.fn(async () => {
          // The lease of the slow worker expires and another instance claims the attempt meanwhile.
          takenOver = await new GoodsReceiptAttemptStore().claimAttemptForRecheck(REF, '1', MIN, old + 2 * MIN);
          return null;
        })
      };

      const summary = await store.recheckReceipts(slowWorker, old, { workerId: '0' });

      expect(takenOver).toBeTruthy();
      expect(summary).toMatchObject({ NotPosted: 0, SkippedLocked: 1 });
      expect(await row()).toMatchObject({ Status: 'sending', LeaseOwner: takenOver });
    });
  });

  describe('worker failure during SAP read-back', () => {
    it('releases the lease and keeps the status when the read-back throws', async () => {
      const adapter = { findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('RFC connection lost')) };

      const summary = await store.recheckReceipts(adapter, old, { workerId: '0' });

      expect(summary).toMatchObject({ Errors: 1, Posted: 0, NotPosted: 0 });
      expect(await row()).toMatchObject({ Status: 'sending', LastError: '', LeaseOwner: null });
      await expect(store.claimAttemptForRecheck(REF, '1', MIN, old)).resolves.toBeTruthy();
    });

    it('never marks an attempt not_posted on a failed read-back, however old it is', async () => {
      const adapter = { findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('timeout')) };

      await store.recheckReceipts(adapter, old + 60 * MIN, { workerId: '0' });

      expect((await row()).Status).toBe('sending');
    });

    it('a worker that dies mid read-back blocks others only until its lease expires', async () => {
      await expect(store.claimAttemptForRecheck(REF, '0', MIN, soon)).resolves.toBeTruthy(); // worker 0 dies here

      await expect(store.claimAttemptForRecheck(REF, '1', MIN, soon + MIN - 1)).resolves.toBe(false);
      await expect(store.claimAttemptForRecheck(REF, '1', MIN, soon + MIN + 1)).resolves.toBeTruthy();
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

    it('a restarted worker with the same id waits for the old lease to expire, then finishes the attempt', async () => {
      await store.claimAttemptForRecheck(REF, '0', MIN, soon); // before the restart
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue(FOUND) };
      const restarted = new GoodsReceiptAttemptStore();

      const early = await restarted.recheckReceipts(adapter, soon + 1000, { workerId: '0' });
      expect(early).toMatchObject({ SkippedLocked: 1, Posted: 0 });
      expect(adapter.findReceiptForAttempt).not.toHaveBeenCalled();

      const later = await restarted.recheckReceipts(adapter, soon + MIN + 1, { workerId: '0' });
      expect(later.Posted).toBe(1);
      expect((await row()).Status).toBe('posted');
    });

    it('does not claim an attempt that reached a final status in the meantime', async () => {
      await store.setStatus(REF, 'posted', { MaterialDocument: '5000000001', MaterialDocYear: '2026', LastError: '' });

      await expect(store.claimAttemptForRecheck(REF, '0', MIN, soon)).resolves.toBe(false);
      expect(await row()).toMatchObject({ Status: 'posted', MaterialDocument: '5000000001' });
    });

    it('same-worker concurrency: two runs sharing a worker id are excluded from each other', async () => {
      const first = await store.claimAttemptForRecheck(REF, '0', MIN, soon);

      expect(first).toBeTruthy();
      await expect(new GoodsReceiptAttemptStore().claimAttemptForRecheck(REF, '0', MIN, soon + 1000)).resolves.toBe(false);
    });

    it('same-worker concurrency: overlapping rechecks with one worker id read SAP once', async () => {
      const adapter = {
        findReceiptForAttempt: jest.fn(async () => { await new Promise((r) => setTimeout(r, 30)); return FOUND; })
      };

      const [a, b] = await Promise.all([
        store.recheckReceipts(adapter, soon, { workerId: '0' }),
        new GoodsReceiptAttemptStore().recheckReceipts(adapter, soon, { workerId: '0' })
      ]);

      expect(adapter.findReceiptForAttempt).toHaveBeenCalledTimes(1);
      expect(a.Posted + b.Posted).toBe(1);
      expect(a.SkippedLocked + b.SkippedLocked).toBe(1);
    });

    it('a lease token only releases its own lease', async () => {
      const mine = await store.claimAttemptForRecheck(REF, '0', MIN, soon);

      await store.releaseAttemptLease(REF, '0:some-other-run');
      expect((await row()).LeaseOwner).toBe(mine);

      await store.releaseAttemptLease(REF, mine);
      expect(await row()).toMatchObject({ LeaseOwner: null, LeaseExpiresAt: null });
    });
  });

  describe('lease metadata and meaningful error information', () => {
    const REASON = 'RFC timeout: outcome unknown';

    it('a final status written by the posting request is not replaced by a recheck that was reading SAP', async () => {
      const adapter = {
        findReceiptForAttempt: jest.fn(async () => {
          await store.setStatus(REF, 'rejected', { LastError: 'SAP rejected: M7 021' }); // the request finishes meanwhile
          return null;
        })
      };

      const summary = await store.recheckReceipts(adapter, old, { workerId: '0' });

      expect(summary.NotPosted).toBe(0);
      expect(await row()).toMatchObject({ Status: 'rejected', LastError: 'SAP rejected: M7 021' });
    });

    it('a recheck that ends not_posted records its own finding', async () => {
      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockResolvedValue(null) }, old, { workerId: '0' });

      const after = await row();
      expect(after.Status).toBe('not_posted');
      expect(after.LastError).toMatch(/^Recheck: no goods receipt for delivery 0180000002/);
    });

    it('claiming and releasing the lease never touches LastError', async () => {
      await store.setStatus(REF, 'unconfirmed', { LastError: REASON });

      const lease = await store.claimAttemptForRecheck(REF, '0', MIN, soon);
      expect((await row()).LastError).toBe(REASON);

      await store.releaseAttemptLease(REF, lease);
      expect(await row()).toMatchObject({ Status: 'unconfirmed', LastError: REASON });
    });

    it('the reason of an unconfirmed attempt survives a recheck that leaves it open', async () => {
      await store.setStatus(REF, 'unconfirmed', { LastError: REASON });

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockResolvedValue(null) }, soon, { workerId: '0' });

      expect(await row()).toMatchObject({ Status: 'unconfirmed', LastError: REASON, LeaseOwner: null });
    });

    it('the reason of an unconfirmed attempt survives a failed SAP read-back', async () => {
      await store.setStatus(REF, 'unconfirmed', { LastError: REASON });

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('RFC down')) }, soon, { workerId: '0' });

      expect(await row()).toMatchObject({ Status: 'unconfirmed', LastError: REASON, LeaseOwner: null });
    });
  });

  describe('no ambiguous attempt is resolved without reliable evidence', () => {
    const GoodsReceiptAdapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter').GoodsReceiptAdapter;
    const doc = (MBLNR) => ({ MBLNR, MJAHR: '2026', ZEILE: '0001', BWART: '101' });
    /** A real adapter whose only SAP access (MATDOC via RFC) is mocked. */
    const adapterSeeing = (rows) => {
      const adapter = new GoodsReceiptAdapter();
      adapter.rfc = { readTable: jest.fn().mockResolvedValue(rows) };
      return adapter;
    };

    it('previous partial receipt: it is not taken as the document of a later attempt that did not post', async () => {
      await store.setBaseline(REF, ['2026/5000000009']); // the earlier partial receipt existed before the post

      const summary = await store.recheckReceipts(adapterSeeing([doc('5000000009')]), old, { workerId: '0' });

      expect(summary).toMatchObject({ Posted: 0, NotPosted: 1 });
      expect(await row()).toMatchObject({ Status: 'not_posted', MaterialDocument: '' });
    });

    it('previous partial receipt: the new document is reported, not the earlier one', async () => {
      await store.setBaseline(REF, ['2026/5000000009']);

      await store.recheckReceipts(adapterSeeing([doc('5000000009'), doc('5000000010')]), soon, { workerId: '0' });

      expect(await row()).toMatchObject({ Status: 'posted', MaterialDocument: '5000000010', MaterialDocYear: '2026' });
    });

    it('receipts exist but no baseline was stored: the attempt stays open and blocked, however old', async () => {
      const summary = await store.recheckReceipts(adapterSeeing([doc('5000000009')]), old + 600 * MIN, { workerId: '0' });

      expect(summary).toMatchObject({ Ambiguous: 1, StillOpen: 1, Posted: 0, NotPosted: 0 });
      expect(await row()).toMatchObject({ Status: 'sending', MaterialDocument: '', LeaseOwner: null });
    });

    it('several new documents: the attempt stays open and blocked', async () => {
      await store.setBaseline(REF, []);

      const summary = await store.recheckReceipts(adapterSeeing([doc('5000000010'), doc('5000000011')]), old, { workerId: '0' });

      expect(summary).toMatchObject({ Ambiguous: 1, Posted: 0, NotPosted: 0 });
      expect((await row()).Status).toBe('sending');
    });

    it('no receipt in SAP at all: not_posted is reliable even without a baseline', async () => {
      const summary = await store.recheckReceipts(adapterSeeing([]), old, { workerId: '0' });

      expect(summary.NotPosted).toBe(1);
      expect((await row()).Status).toBe('not_posted');
    });

    it('a baseline too large to store is kept as unknown, never as empty', async () => {
      await store.setBaseline(REF, Array.from({ length: 400 }, (_, i) => `2026/${5000000000 + i}`));

      expect((await row()).BaselineDocs).toBeNull();
    });
  });
});
