'use strict';

/**
 * Integration: SAP accepted a write, but reading it back does not confirm it. Real CAP HTTP, handlers and adapters;
 * only SAP is doubled. Run in production mode, where CAP replaces 5xx text with a generic message unless the
 * error opts out, because the text is what stops a user creating a duplicate. SAP's answers here are hand-written.
 */

const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { axios } = cdsTest;
const returnAdapter = require('../../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');

const INVOICE = { path: '/odata/v4/customer-invoice', action: 'cancelBillingDocument', body: { BillingDocument: '31000112' } };
const RETURN = {
    path: '/odata/v4/customer-return',
    action: 'createCustomerReturn',
    body: {
        SoldToParty: '10082', ReturnsOrderReason: '101', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52',
        Items: [{ Material: '4000000001', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }]
    }
};
const CANCEL_TEXT = "SAP accepted the cancellation of billing document 31000112 (reversal document 90000053), but reading it back did not show it as cancelled, so it is NOT confirmed. Check it in SAP before trying again.";
const RETURN_TEXT = 'SAP created customer return 4500099, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.';

const openInvoice = { status: 200, headers: {}, data: { d: { BillingDocument: '31000112', BillingDocumentIsCancelled: false, AccountingTransferStatus: 'C', SDDocumentCategory: 'M' } } };
const cancelledInvoice = { status: 200, headers: {}, data: { d: { ...openInvoice.data.d, BillingDocumentIsCancelled: true, AccountingTransferStatus: 'E' } } };
const cancelAccepted = { status: 200, headers: {}, data: { d: { results: [{ BillingDocument: '90000053', MessageType: 'S', Message: 'Saved' }] } } };
const returnCreated = { status: 201, headers: {}, data: { d: { SalesOrderID: '4500099', DocumentCurrency: 'INR' } } };

function stubSap({ post, get }) {
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

const direct = async ({ path, action, body }) => {
    const res = await axios.post(`${path}/${action}`, body, { validateStatus: () => true });
    return { status: res.status, data: res.data };
};
// The screens call these actions through the UI5 V4 model, which sends $batch.
const batched = async ({ path, action, body }) => {
    const res = await axios.post(`${path}/$batch`, {
        requests: [{ id: '1', method: 'POST', url: `/${action}`, headers: { 'content-type': 'application/json' }, body }]
    }, { validateStatus: () => true });
    const [part] = res.data.responses;
    return { status: part.status, data: part.body };
};

describe('Integration: a SAP write that reading it back does not confirm (production mode)', () => {
    const original = { env: process.env.NODE_ENV, rfc: returnAdapter.rfc };

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        returnAdapter.rfc = {
            readTable: async (table) => {
                if (table === 'KNVV') return [{ VKORG: '1000', VTWEG: '10', SPART: '52', LOEVM: '' }];
                return table === 'T001W' ? [{ WERKS: '1110' }] : [];
            }
        };
    });
    afterEach(() => {
        process.env.NODE_ENV = original.env;
        returnAdapter.rfc = original.rfc;
        jest.restoreAllMocks();
    });

    describe.each([['a direct call', direct], ['$batch, as the screens send it', batched]])('through %s', (_name, send) => {
        it('cancel: answers 502 with the warning when every read-back shows the invoice as not cancelled', async () => {
            const posts = stubSap({ get: () => openInvoice, post: () => cancelAccepted });

            const res = await send(INVOICE);

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe(CANCEL_TEXT);
            expect(posts).toHaveLength(1);
        });

        it('return: answers 502 with the number and the warning when every read-back fails, and does not post again', async () => {
            const posts = stubSap({ get: () => { throw new Error('read-back unavailable'); }, post: () => returnCreated });

            const res = await send(RETURN);

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe(RETURN_TEXT);
            expect(posts).toHaveLength(1);
        });
    });

    it('cancel: answers 502 with the warning when SAP accepted it but no read-back succeeded', async () => {
        let reads = 0;
        stubSap({
            // The first read is the handler's check before the cancel.
            get: () => { if (++reads === 1) return openInvoice; throw new Error('read-back unavailable'); },
            post: () => cancelAccepted
        });

        const res = await direct(INVOICE);

        expect(res.status).toBe(502);
        expect(res.data.error.message).toBe(CANCEL_TEXT);
    });

    it('cancel: still reports success once a read-back confirms it', async () => {
        let reads = 0;
        stubSap({ get: () => (++reads === 1 ? openInvoice : cancelledInvoice), post: () => cancelAccepted });

        const res = await direct(INVOICE);

        expect(res.status).toBe(200);
        expect(res.data).toMatchObject({ BillingDocumentIsCancelled: true, CancellationDocument: '90000053', Success: true });
    });

    it('return: still reports success once a read-back confirms it', async () => {
        stubSap({ get: () => ({ status: 200, headers: {}, data: { d: { CustomerReturn: '4500099', TransactionCurrency: 'INR' } } }), post: () => returnCreated });

        const res = await direct(RETURN);

        expect(res.status).toBe(200);
        expect(res.data).toMatchObject({ CustomerReturn: '4500099', Success: true });
    });

    it('hides the text of an ordinary 5xx, so production mode is really on in these tests', async () => {
        stubSap({
            get: () => openInvoice,
            post: () => { throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { error: { message: { value: 'internal SAP detail' } } } } }); }
        });

        const res = await direct(INVOICE);

        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(res.data.error.message).not.toContain('internal SAP detail');
    });
});
