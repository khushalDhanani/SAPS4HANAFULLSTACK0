const cds = require('@sap/cds');
// Boots the CAP server with the test profile's in-memory SQLite database so cds.db is bound.
cds.test(__dirname + '/../../../');

const queueSingleton = require('../../../srv/wm/goods-issue/GoodsIssueQueueManager');
const { GoodsIssueQueueManager, QueueStoreUnavailableError } = queueSingleton;
const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

function sapPostingUnavailable() {
  const err = new Error('SAP S/4HANA Backend Posting Capability Unavailable: posting service not activated');
  err.status = 501;
  return err;
}

function fakeService() {
  const handlers = {};
  const srv = {
    on: jest.fn((event, entityOrHandler, handler) => {
      const key = typeof entityOrHandler === 'string' ? `${event}:${entityOrHandler}` : event;
      handlers[key] = typeof entityOrHandler === 'function' ? entityOrHandler : handler;
    })
  };
  GoodsIssueHandler.init(srv);
  return handlers;
}

describe('GoodsIssueQueueManager (CAP database store)', () => {
  let manager;

  beforeEach(async () => {
    manager = new GoodsIssueQueueManager();
    await manager.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('store availability', () => {
    it('is available when CAP has bound a database', () => {
      expect(cds.db).toBeDefined();
      expect(manager.isAvailable()).toBe(true);
      expect(queueSingleton.isAvailable()).toBe(true);
    });

    it('is unavailable without a database: reads are empty and writes are refused', async () => {
      const detached = new GoodsIssueQueueManager({ db: null });
      expect(detached.isAvailable()).toBe(false);
      await expect(detached.getAll()).resolves.toEqual([]);
      await expect(detached.get('GI-QUEUE-X')).resolves.toBeNull();
      await expect(detached.getSummary()).resolves.toEqual({ QueuedCount: 0, TotalCount: 0, Items: [], StoreAvailable: false });
      await expect(detached.enqueue({ ReservationNo: '1', ReservationItem: '1' })).rejects.toBeInstanceOf(QueueStoreUnavailableError);
      await expect(detached.update('x', {})).rejects.toBeInstanceOf(QueueStoreUnavailableError);
      await expect(detached.remove('x')).rejects.toBeInstanceOf(QueueStoreUnavailableError);
    });
  });

  describe('queue operations', () => {
    it('enqueues, reads back through another instance, updates, removes and summarizes', async () => {
      for (let i = 1; i <= 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const record = await manager.enqueue({
          ReservationNo: `RTS${i}`,
          ReservationItem: `${i}`,
          Material: '4000000125',
          IssueQty: 10,
          Unit: 'KG',
          FinalIssue: true
        });
        expect(record.QueueReference).toMatch(new RegExp(`^GI-QUEUE-RTS${i}-000${i}-\\d{4}$`));
        expect(record.SyncStatus).toBe('QUEUED');
        expect(record.SyncAttempts).toBe(1);
      }

      const summary = await manager.getSummary();
      expect(summary.QueuedCount).toBe(3);
      expect(summary.TotalCount).toBe(3);
      expect(summary.StoreAvailable).toBe(true);
      expect(summary.Items[0].ReservationNo).toBe('RTS3');

      // A second instance (another application instance in production) sees the same records.
      const other = new GoodsIssueQueueManager();
      const all = await other.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].QueuedAt >= all[2].QueuedAt).toBe(true);

      const updated = await other.update(all[0].QueueReference, {
        SyncStatus: 'POSTED_IN_SAP',
        SapMaterialDocument: '5000000012',
        SapMaterialDocYear: '2026'
      });
      expect(updated.SyncStatus).toBe('POSTED_IN_SAP');
      expect(updated.SapMaterialDocument).toBe('5000000012');
      expect((await other.getSummary()).QueuedCount).toBe(2);

      expect(await other.get(all[1].ID)).toMatchObject({ QueueReference: all[1].QueueReference });
      expect(await other.remove(all[1].QueueReference)).toBe(true);
      expect(await other.remove(all[1].QueueReference)).toBe(false);
      expect(await manager.getAll()).toHaveLength(2);
      expect(await manager.update('does-not-exist', { SyncStatus: 'FAILED' })).toBeNull();
    });

    it('keeps FAILED records pending and counts only QUEUED / FAILED as pending', async () => {
      const a = await manager.enqueue({ ReservationNo: 'RTA1', ReservationItem: '1', IssueQty: 5, Unit: 'KG' });
      const b = await manager.enqueue({ ReservationNo: 'RTA2', ReservationItem: '1', IssueQty: 5, Unit: 'KG' });
      await manager.update(a.QueueReference, { SyncStatus: 'FAILED', LastSyncError: 'sap unreachable', SyncAttempts: 2 });
      await manager.update(b.QueueReference, { SyncStatus: 'POSTED_IN_SAP' });
      const summary = await manager.getSummary();
      expect(summary.QueuedCount).toBe(1);
      expect(summary.TotalCount).toBe(2);
      expect((await manager.get(a.ID)).LastSyncError).toBe('sap unreachable');
    });

    it('clear() empties the store', async () => {
      await manager.enqueue({ ReservationNo: 'RTC1', ReservationItem: '1', IssueQty: 1, Unit: 'KG' });
      await manager.clear();
      expect((await manager.getSummary()).TotalCount).toBe(0);
    });

    it('getPendingItems, getPendingQueueMap, and getPendingQueuedQty aggregate non-posted items correctly', async () => {
      await manager.enqueue({ ReservationNo: '0000010001', ReservationItem: '0001', IssueQty: 10, FinalIssue: false });
      await manager.enqueue({ ReservationNo: '10001', ReservationItem: '1', IssueQty: 5, FinalIssue: true });
      const rec3 = await manager.enqueue({ ReservationNo: '10001', ReservationItem: '2', IssueQty: 20, FinalIssue: false });
      await manager.enqueue({ ReservationNo: '20002', ReservationItem: '1', IssueQty: 15, FinalIssue: false });

      // Mark rec3 as posted to SAP
      await manager.update(rec3.QueueReference, { SyncStatus: 'POSTED_IN_SAP', SapMaterialDocument: '5000000001' });

      // getPendingItems without filter
      const allPending = await manager.getPendingItems();
      expect(allPending).toHaveLength(3);

      // getPendingItems with reservation filter (matches with/without leading zeros)
      const res10001Pending = await manager.getPendingItems('0000010001');
      expect(res10001Pending).toHaveLength(2);

      // getPendingQueueMap aggregates queuedQty and finalIssue flag
      const queueMap = await manager.getPendingQueueMap('10001');
      expect(queueMap.get('10001:1')).toEqual({ queuedQty: 15, finalIssue: true });
      expect(queueMap.has('10001:2')).toBe(false); // Posted to SAP, so not pending

      // getPendingQueuedQty retrieves single item details
      const singleItem = await manager.getPendingQueuedQty('0000010001', '0001');
      expect(singleItem).toEqual({ queuedQty: 15, finalIssue: true });

      const unqueued = await manager.getPendingQueuedQty('99999', '0001');
      expect(unqueued).toEqual({ queuedQty: 0, finalIssue: false });
    });
  });

  describe('Goods Issue handlers with the database-backed queue', () => {
    const request = () => ({
      data: { ReservationNo: '18025', ReservationItem: '0003', Material: '1000000514', IssueQty: 50, Unit: 'KG' },
      error: jest.fn((code, msg) => ({ code, message: msg }))
    });

    it('queues the transaction and reports QUEUED (never a SAP document) when SAP cannot post and a store is bound', async () => {
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockRejectedValue(sapPostingUnavailable());
      const handlers = fakeService();

      const result = await handlers['postGoodsIssue'](request());

      expect(result).toMatchObject({ Success: true, Queued: true, SyncStatus: 'QUEUED', MaterialDocument: '' });
      expect(result.QueueReference).toMatch(/^GI-QUEUE-18025-0003-\d{4}$/);
      expect(result.Message).not.toMatch(/safely/i);
      await expect(manager.get(result.QueueReference)).resolves.toMatchObject({ ReservationNo: '18025', SyncStatus: 'QUEUED' });

      const summary = await handlers['getQueueSummary']({});
      expect(summary.QueuedCount).toBe(1);
      expect(summary.StoreAvailable).toBe(true);
    });

    it('fails closed with the SAP error when SAP cannot post and no queue store is bound', async () => {
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockRejectedValue(sapPostingUnavailable());
      jest.spyOn(queueSingleton, 'enqueue').mockRejectedValue(new QueueStoreUnavailableError());
      const handlers = fakeService();
      const req = request();

      await handlers['postGoodsIssue'](req);

      expect(req.error).toHaveBeenCalledTimes(1);
      const [status, message] = req.error.mock.calls[0];
      expect(status).toBe(501);
      expect(message).toMatch(/Posting Capability Unavailable/);
      expect(message).toMatch(/could not be recorded in the dispatch queue/);
      expect(message).toMatch(/NOT recorded/);
      expect(await manager.getAll()).toHaveLength(0);
    });

    it('retry and clear refuse with 503 when no queue store is bound', async () => {
      jest.spyOn(queueSingleton, 'isAvailable').mockReturnValue(false);
      const handlers = fakeService();

      const retryReq = { data: { QueueReference: 'GI-QUEUE-1-0001-1234' }, error: jest.fn((code, msg) => ({ code, message: msg })) };
      await handlers['retryQueuedGoodsIssue'](retryReq);
      expect(retryReq.error).toHaveBeenCalledWith(503, expect.stringContaining('no database is bound'));

      const clearReq = { data: { QueueReference: 'GI-QUEUE-1-0001-1234' }, error: jest.fn((code, msg) => ({ code, message: msg })) };
      await handlers['clearQueuedGoodsIssue'](clearReq);
      expect(clearReq.error).toHaveBeenCalledWith(503, expect.stringContaining('no database is bound'));

      expect(await handlers['READ:GoodsIssueQueue']({}, () => Promise.resolve(['generic']))).toEqual([]);
      expect(await handlers['getQueueSummary']({})).toMatchObject({ QueuedCount: 0, StoreAvailable: false });
    });

    it('READ GoodsIssueQueue delegates to the generic database handler when a store is bound', async () => {
      const handlers = fakeService();
      const next = jest.fn().mockResolvedValue(['from-db']);
      expect(await handlers['READ:GoodsIssueQueue']({}, next)).toEqual(['from-db']);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('retries a queued item and records the outcome in the database', async () => {
      const queued = await manager.enqueue({ ReservationNo: '18025', ReservationItem: '0003', Material: '1000000514', IssueQty: 50, Unit: 'KG' });
      const handlers = fakeService();

      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockRejectedValueOnce(sapPostingUnavailable());
      const failed = await handlers['retryQueuedGoodsIssue']({ data: { QueueReference: queued.QueueReference }, error: jest.fn() });
      expect(failed).toMatchObject({ Success: false, Queued: true, SyncStatus: 'FAILED', QueueReference: queued.QueueReference });
      expect(await manager.get(queued.ID)).toMatchObject({ SyncAttempts: 2, LastSyncError: expect.stringContaining('Posting Capability Unavailable') });

      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockResolvedValueOnce({ MaterialDocument: '4900001234', MaterialDocYear: '2026', Success: true });
      const posted = await handlers['retryQueuedGoodsIssue']({ data: { QueueReference: queued.QueueReference }, error: jest.fn() });
      expect(posted).toMatchObject({ Success: true, Queued: false, SyncStatus: 'POSTED_IN_SAP', MaterialDocument: '4900001234' });
      expect(await manager.get(queued.ID)).toMatchObject({ SyncStatus: 'POSTED_IN_SAP', SapMaterialDocument: '4900001234', SapMaterialDocYear: '2026' });
      expect((await manager.getSummary()).QueuedCount).toBe(0);

      expect(await handlers['clearQueuedGoodsIssue']({ data: { QueueReference: queued.QueueReference }, error: jest.fn() })).toBe(true);
      expect(await manager.getAll()).toHaveLength(0);
    });
  });
});
