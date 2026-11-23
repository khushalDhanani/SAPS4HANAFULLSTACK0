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
});
