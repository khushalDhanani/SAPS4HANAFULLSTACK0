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
const inquiryAdapter = require('../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const HuStockTransferAdapter = require('../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const HandlingUnitAdapter = require('../../srv/integration/s4hana/wm/HandlingUnitAdapter');
const { runCreateBapi } = require('../../srv/integration/s4hana/sd/salesDocBapi');
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

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

    describe('other errors naming work that may already be in SAP', () => {
        const INQUIRY = {
            header: { SalesInquiryType: 'ZIN', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52', SoldToParty: '10135', TransactionCurrency: 'INR' },
            items: [{ SalesInquiryItem: '000010', Material: '4000000091', OrderQuantity: 10, OrderQuantityUnit: 'KG', Plant: '1120', NetPriceAmount: 250 }]
        };
        const postInquiry = () => direct({ path: '/odata/v4/sales-inquiry', action: 'createSalesInquiry', body: INQUIRY });

        it('sales inquiry partly created: shows the number, and CAP sends only the message, not SAP\'s raw response', async () => {
            const message = 'Sales Inquiry 1000529 was created in SAP S/4HANA, but adding item 000010 failed: Material blocked. Do not retry.';
            jest.spyOn(inquiryAdapter, 'createSalesInquiryViaRfc').mockRejectedValue(new inquiryAdapter.PartialSalesInquiryError(message, '1000529', {
                step: 'ItemSet',
                originalError: Object.assign(new Error('raw'), { response: { data: 'RAW-SAP-BODY' } })
            }));

            const res = await postInquiry();

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe(message);
            expect(JSON.stringify(res.data)).not.toContain('RAW-SAP-BODY');
        });

        it('sales inquiry committed but not read back: the error keeps its text and warns', async () => {
            const creator = { create: async () => ({ SalesInquiry: '1500200', testRun: false }), readBack: async () => null };
            await expect(inquiryAdapter.createSalesInquiryViaRfc({}, [], { creator })).rejects.toMatchObject({
                status: 502,
                $sanitize: false,
                message: 'SAP committed inquiry 1500200, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.'
            });
        });

        it('a SAP document whose commit failed: the error keeps its text and tells the user to check', async () => {
            const call = async (fm) => (fm === 'BAPI_TRANSACTION_COMMIT' ? { RETURN: { TYPE: 'E', MESSAGE: 'Update terminated' } } : { SALESDOCUMENT: '0001500200', RETURN: [] });
            const rfc = { session: (fn) => fn(call) };

            await expect(runCreateBapi(rfc, 'BAPI_X', {}, { testRun: false, labels: { noun: 'inquiry', partialName: 'PartialSalesInquiryError', keyProp: 'SalesInquiry' } })).rejects.toMatchObject({
                status: 502,
                $sanitize: false,
                message: 'SAP created inquiry 0001500200 but the commit failed: Update terminated. Check it in SAP before creating it again.'
            });
        });

        it('a SAP document whose commit call dropped: names the number and warns', async () => {
            const call = async (fm) => { if (fm === 'BAPI_TRANSACTION_COMMIT') throw new Error('RFC connection lost'); return { SALESDOCUMENT: '0001500200', RETURN: [] }; };

            await expect(runCreateBapi({ session: (fn) => fn(call) }, 'BAPI_X', {}, { labels: { noun: 'inquiry', partialName: 'PartialSalesInquiryError', keyProp: 'SalesInquiry' } })).rejects.toMatchObject({
                status: 502,
                $sanitize: false,
                SalesInquiry: '0001500200',
                name: 'PartialSalesInquiryError',
                message: 'SAP created inquiry 0001500200, but the commit got no answer, so it is NOT confirmed. Check it in SAP before creating it again.'
            });
        });

        it('goods receipt with an unknown outcome: shows the warning not to post again', async () => {
            const posts = stubSap({ get: () => ({ status: 200, headers: {}, data: { d: {} } }), post: () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); } });

            const res = await direct({
                path: '/odata/v4/goods-receipt',
                action: 'postGoodsReceipt',
                body: { DeliveryDocument: `18${Date.now() % 100000000}`, DeliveryDocumentItem: '10', Material: '1000000045', Plant: '1120', StorageLocation: 'CS01', Quantity: 10, Unit: 'KG' }
            });

            expect(res.status).toBe(504);
            expect(res.data.error.message).toContain('Please do not post again.');
            expect(posts).toHaveLength(1);
        });

        it('HU stock transfer with an unknown outcome: shows the warning not to post again', async () => {
            jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ ReservationNo: '520311', ReservationItem: '1', Plant: '1120' });
            jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockImplementation(function () {
                throw this._unconfirmedError('timeout');
            });

            const res = await direct({
                path: '/odata/v4/hu-stock-transfer',
                action: 'executeHuStockTransfer',
                body: { ReservationNo: '520311', ReservationItem: '0001', UnitNumber: '1000048321', TransferQty: 10, IsFullUnit: true, ClientAttemptId: `visible-${Date.now()}` }
            });

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Stock transfer outcome is unconfirmed in SAP (timeout). Do not post again; check the material document list first.');
        });

        it('handling unit whose read-back fails after the commit: shows the number and the warning', async () => {
            jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm) => (fm === 'BAPI_HU_CREATE' ? { HUKEY: '00000000002000020166', RETURN: [] } : {})));
            jest.spyOn(RfcClient.prototype, 'readTable').mockRejectedValue(new Error('RFC down'));

            const res = await direct({ path: '/odata/v4/handling-unit', action: 'create', body: { packagingMaterial: 'PK01', plant: '1120', storageLocation: 'HS01' } });

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Create handling unit: SAP may have saved this change to handling unit 2000020166, but it could not be read back, so it is NOT confirmed. Check it in SAP before trying again.');
        });

        it('packing instruction whose read-back fails: shows the number and the warning', async () => {
            const posts = stubSap({
                get: () => { throw new Error('read-back unavailable'); },
                post: () => ({ status: 201, headers: {}, data: { d: { PackingInstructionSystemUUID: '005056b4-0af6-1fe0-8dc1-fa4bb9c857ee', PackingInstructionNumber: 'PI-2000000041' } } })
            });

            const res = await direct({
                path: '/odata/v4/packing-instruction',
                action: 'create',
                body: { externalName: 'BOX1', weightUnit: 'KG', components: [{ item: '10', category: 'P', material: '2000000041', targetQty: 1, unit: 'NOS' }] }
            });

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe("SAP accepted packing instruction 'BOX1' (PI-2000000041), but it could not be read back, so it is NOT confirmed. Check it in SAP before creating it again.");
            expect(posts).toHaveLength(1);
        });

        it('handling unit committed but not read back: shows the number and the warning', async () => {
            jest.spyOn(HandlingUnitAdapter.prototype, '_bapi').mockResolvedValue({ HandlingUnitExternalID: '2000020166', Deleted: true, Items: [] });

            const res = await direct({
                path: '/odata/v4/handling-unit',
                action: 'create',
                body: { packagingMaterial: 'PK01', plant: '1120', storageLocation: 'HS01' }
            });

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Create handling unit: SAP committed handling unit 2000020166, but it could not be read back, so it is NOT confirmed. Check it in SAP before creating it again.');
        });
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
