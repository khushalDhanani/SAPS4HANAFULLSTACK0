'use strict';

/**
 * Integration: If-Match round trip. Real CAP HTTP, real handlers, real adapters, real S4HttpClient and S4ErrorMapper.
 * Only the Cloud SDK (destination lookup and HTTP call) is stubbed, so the header is read at the SAP boundary.
 * The S/4 412 bodies keep the shape of the earlier fixtures; that SAP really answers this way is NOT proven here.
 */

const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { axios } = cdsTest;

const rejected = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data, headers: {} } });
const etagFailure = (value) => rejected(412, { error: { code: 'CX_SADL_ETAG_CHECK_FAILED', message: { value } } });

/** Stubs SAP: `post` answers the non-CSRF POST, `get` answers reads. Returns the POST requests that reached SAP. */
function stubSap({ post, get = () => ({ status: 200, data: {}, headers: {} }) }) {
    jest.spyOn(connectivity, 'getDestination').mockResolvedValue({ url: 'https://s4.example.test', sapClient: '220' });
    const posts = [];
    jest.spyOn(httpClient, 'executeHttpRequest').mockImplementation(async (_dest, config) => {
        if (config.headers['x-csrf-token'] === 'Fetch') return { status: 200, data: {}, headers: { 'x-csrf-token': 'TOKEN' } };
        if (config.method === 'get') return get(config);
        posts.push(config);
        return post(config);
    });
    return posts;
}

const send = (path, body, etag) => axios.post(path, body, { headers: { 'If-Match': etag }, validateStatus: () => true });

describe('Integration: If-Match round trip to the S/4 HTTP boundary', () => {
    afterEach(() => jest.restoreAllMocks());

    describe('Outbound delivery', () => {
        it('postGoodsIssue sends If-Match to S/4 and answers 409 with the SAP text when S/4 returns 412', async () => {
            const posts = stubSap({ post: () => { throw etagFailure('ETag condition check failed: delivery 80000001 was changed by another user'); } });

            const res = await send('/odata/v4/outbound-delivery/postGoodsIssue', { DeliveryDocument: '80000001' }, 'W/"ETAG123"');

            expect(posts).toHaveLength(1);
            expect(posts[0].url).toContain("PostGoodsIssue?DeliveryNumber='80000001'");
            expect(posts[0].headers['If-Match']).toBe('W/"ETAG123"');
            expect(res.status).toBe(409);
            expect(res.data.error.message).toBe('ETag condition check failed: delivery 80000001 was changed by another user');
        });

        it('postGoodsIssue sends If-Match to S/4 and returns Done from the S/4 answer', async () => {
            const posts = stubSap({ post: () => ({ status: 200, headers: {}, data: { d: { PostGoodsIssue: { Done: true, ErrorAny: false } } } }) });

            const res = await send('/odata/v4/outbound-delivery/postGoodsIssue', { DeliveryDocument: '80000001' }, 'W/"MATCH123"');

            expect(posts[0].headers['If-Match']).toBe('W/"MATCH123"');
            expect(res.status).toBe(200);
            expect(res.data.DeliveryDocument).toBe('80000001');
            expect(res.data.Done).toBe(true);
        });

        it('createBillingDocument sends If-Match to S/4 and answers 409 with the SAP text when S/4 returns 412', async () => {
            const posts = stubSap({ post: () => { throw etagFailure('Precondition Failed: document was modified by another session'); } });

            const res = await send('/odata/v4/outbound-delivery/createBillingDocument', { DeliveryDocument: '80000001', BillingDocumentType: 'F2' }, 'W/"BILL678"');

            expect(posts).toHaveLength(1);
            expect(posts[0].url).toContain("ReferenceSDDocument='80000001'");
            expect(posts[0].url).toContain("BillingDocumentType='F2'");
            expect(posts[0].headers['If-Match']).toBe('W/"BILL678"');
            expect(res.status).toBe(409);
            expect(res.data.error.message).toBe('Precondition Failed: document was modified by another session');
        });
    });

    describe('Customer invoice', () => {
        const openInvoice = (id) => () => ({ status: 200, headers: {}, data: { d: { BillingDocument: id, AccountingTransferStatus: 'B', BillingDocumentIsCancelled: false, SDDocumentCategory: 'M' } } });

        it('releaseInvoiceToAccounting sends If-Match to S/4 and answers 409 with the SAP text when S/4 returns 412', async () => {
            const posts = stubSap({ get: openInvoice('31000111'), post: () => { throw etagFailure('Invoice 31000111 changed by another user'); } });

            const res = await send('/odata/v4/customer-invoice/releaseInvoiceToAccounting', { BillingDocument: '31000111' }, 'W/"INV111"');

            expect(posts).toHaveLength(1);
            expect(posts[0].url).toContain("PostBillingDocumentToAccounting?BillingDocument='31000111'");
            expect(posts[0].headers['If-Match']).toBe('W/"INV111"');
            expect(res.status).toBe(409);
            expect(res.data.error.message).toBe('Invoice 31000111 changed by another user');
        });

        it('cancelBillingDocument sends If-Match to S/4 and answers 409 with the SAP text when S/4 returns 412', async () => {
            const posts = stubSap({ get: openInvoice('31000112'), post: () => { throw etagFailure('Billing document was changed by another user'); } });

            const res = await send('/odata/v4/customer-invoice/cancelBillingDocument', { BillingDocument: '31000112' }, 'W/"INV222"');

            expect(posts).toHaveLength(1);
            expect(posts[0].url).toContain("CancelBillingDocument?BillingDocument='31000112'");
            expect(posts[0].headers['If-Match']).toBe('W/"INV222"');
            expect(res.status).toBe(409);
            expect(res.data.error.message).toBe('Billing document was changed by another user');
        });
    });

    describe('Goods receipt', () => {
        const receipt = (delivery) => ({
            DeliveryDocument: delivery,
            DeliveryDocumentItem: '10',
            Material: '1000000045',
            Plant: '1120',
            StorageLocation: 'CS01',
            Quantity: 10,
            Unit: 'KG'
        });

        it('postGoodsReceipt sends If-Match to S/4 and answers 409 when S/4 returns 412', async () => {
            const posts = stubSap({ post: () => { throw etagFailure('Inbound Delivery 18000001 condition check failed'); } });

            const res = await send('/odata/v4/goods-receipt/postGoodsReceipt', receipt('18000001'), 'W/"GR333"');

            expect(posts).toHaveLength(1);
            expect(posts[0].url).toBe('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers');
            expect(posts[0].headers['If-Match']).toBe('W/"GR333"');
            expect(res.status).toBe(409);
            expect(res.data.error.message).toContain('Inbound Delivery 18000001 condition check failed');
        });

        it('postGoodsReceipt sends If-Match to S/4 and returns the material document S/4 created', async () => {
            const posts = stubSap({ post: () => ({ status: 201, headers: {}, data: { d: { MaterialDocument: '5000009999' } } }) });

            const res = await send('/odata/v4/goods-receipt/postGoodsReceipt', receipt('18000002'), 'W/"GRMATCH"');

            expect(posts[0].headers['If-Match']).toBe('W/"GRMATCH"');
            expect(res.status).toBe(200);
            expect(res.data.MaterialDocument).toBe('5000009999');
        });
    });
});
