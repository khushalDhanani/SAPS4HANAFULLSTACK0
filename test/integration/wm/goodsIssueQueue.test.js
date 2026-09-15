const cds = require('@sap/cds');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const queue = require('../../../srv/wm/goods-issue/GoodsIssueQueueManager');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'alice', password: '' };
const { GET, POST, axios } = cdsTest;

const BASE = '/odata/v4/goods-issue';

/**
 * The Goods Issue dispatch queue is stored in the CAP database (in-memory SQLite under the test
 * profile). These tests go through the real OData endpoints.
 */
describe('Integration: Goods Issue dispatch queue in the CAP database', () => {

    beforeEach(async () => {
        await queue.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reports an available, empty queue through getQueueSummary', async () => {
        const { status, data } = await GET(`${BASE}/getQueueSummary()`);
        expect(status).toBe(200);
        expect(data).toMatchObject({ QueuedCount: 0, TotalCount: 0, StoreAvailable: true, Items: [] });
    });

    it('queues a goods issue when SAP cannot post, and serves it through the read-only entity set', async () => {
        const unavailable = new Error('SAP S/4HANA Backend Posting Capability Unavailable: posting service not activated');
        unavailable.status = 501;
        jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockRejectedValue(unavailable);

        const { status, data } = await POST(`${BASE}/postGoodsIssue`, {
            ReservationNo: '18025', ReservationItem: '0003', Material: '1000000514', IssueQty: 50, Unit: 'KG',
            Batch: '', DifferenceQty: 0, DifferenceReason: '', DifferenceStorageType: '', FinalIssue: false
        });
        expect(status).toBe(200);
        expect(data).toMatchObject({ Success: true, Queued: true, SyncStatus: 'QUEUED', MaterialDocument: '' });
        expect(data.QueueReference).toMatch(/^GI-QUEUE-18025-0003-\d{4}$/);

        const list = await GET(`${BASE}/GoodsIssueQueue?$filter=QueueReference eq '${data.QueueReference}'&$select=QueueReference,ReservationNo,SyncStatus,IssueQty`);
        expect(list.status).toBe(200);
        expect(list.data.value).toHaveLength(1);
        expect(list.data.value[0]).toMatchObject({ QueueReference: data.QueueReference, ReservationNo: '18025', SyncStatus: 'QUEUED' });
        // OData V4 serialises Edm.Decimal as a string
        expect(Number(list.data.value[0].IssueQty)).toBe(50);

        const count = await GET(`${BASE}/GoodsIssueQueue/$count`);
        expect(String(count.data)).toBe('1');

        const summary = await GET(`${BASE}/getQueueSummary()`);
        expect(summary.data).toMatchObject({ QueuedCount: 1, TotalCount: 1, StoreAvailable: true });
        expect(summary.data.Items[0].QueueReference).toBe(data.QueueReference);
    });

    it('rejects direct writes to the queue entity set', async () => {
        const res = await axios.post(`${BASE}/GoodsIssueQueue`, { QueueReference: 'GI-QUEUE-FAKE', ReservationNo: '1', ReservationItem: '0001' }, { validateStatus: () => true });
        expect([403, 405]).toContain(res.status);
        expect(await queue.getAll()).toHaveLength(0);
    });

    it('retries a queued item and clears it through the actions', async () => {
        const record = await queue.enqueue({ ReservationNo: '18025', ReservationItem: '0003', Material: '1000000514', IssueQty: 50, Unit: 'KG' });
        jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockResolvedValue({ MaterialDocument: '4900001234', MaterialDocYear: '2026', Success: true });

        const retry = await POST(`${BASE}/retryQueuedGoodsIssue`, { QueueReference: record.QueueReference });
        expect(retry.status).toBe(200);
        expect(retry.data).toMatchObject({ Success: true, Queued: false, SyncStatus: 'POSTED_IN_SAP', MaterialDocument: '4900001234' });
        expect(await queue.get(record.ID)).toMatchObject({ SyncStatus: 'POSTED_IN_SAP', SapMaterialDocument: '4900001234' });

        const cleared = await POST(`${BASE}/clearQueuedGoodsIssue`, { QueueReference: record.QueueReference });
        expect(cleared.status).toBe(200);
        expect(cleared.data.value).toBe(true);
        expect(await queue.getAll()).toHaveLength(0);
    });

    it('returns the SAP error and records nothing when SAP cannot post and no queue store is bound', async () => {
        const unavailable = new Error('SAP S/4HANA Backend Posting Capability Unavailable: posting service not activated');
        unavailable.status = 501;
        jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockRejectedValue(unavailable);
        jest.spyOn(queue, 'enqueue').mockRejectedValue(new queue.QueueStoreUnavailableError());

        const res = await axios.post(`${BASE}/postGoodsIssue`, {
            ReservationNo: '18025', ReservationItem: '0003', Material: '1000000514', IssueQty: 50, Unit: 'KG',
            Batch: '', DifferenceQty: 0, DifferenceReason: '', DifferenceStorageType: '', FinalIssue: false
        }, { validateStatus: () => true });

        expect(res.status).toBe(501);
        expect(res.data.error.message).toMatch(/Posting Capability Unavailable/);
        expect(res.data.error.message).toMatch(/could not be recorded in the dispatch queue/);
        expect(await queue.getAll()).toHaveLength(0);
    });
});
