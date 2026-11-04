'use strict';

/**
 * Integration: refusals that say nothing was posted keep their text in production, where CAP replaces 5xx text with a
 * generic message unless the error opts out. Real CAP HTTP, roles and handlers; only SAP and the attempt log are doubled.
 */

const cds = require('@sap/cds');

const { axios } = cds.test(__dirname + '/../../');
const outbound = require('../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');
const goodsReceipt = require('../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const GoodsIssueAttemptStore = require('../../srv/wm/goods-issue/GoodsIssueAttemptStore');

const LE = '/odata/v4/outbound-delivery';
const call = (user, path, body) => axios.post(path, body, { auth: { username: user, password: '' }, validateStatus: () => true });
const SHIPPING_POINTS_TEXT = 'The shipping points of plant 1120 could not be read from SAP, so nothing was read or posted. Try again.';
const LOG_TEXT = 'The goods receipt posting-attempt log is unavailable; the goods receipt was NOT posted. Check the document list before retrying.';
const RECEIPT = { DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11', Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG' };
const plantText = (doc) => `The plant of delivery ${doc} could not be read from SAP; nothing was posted (NOT posted). Try again.`;

describe('Integration: "nothing was posted" stays visible in production', () => {
    const original = { env: process.env.NODE_ENV, rfc: outbound.rfc, resolver: outbound.businessConfigResolver };

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        outbound.clearTvstzCache();
        outbound.businessConfigResolver = null;
        outbound.rfc = { readTable: async () => { throw new Error('RFC down'); } };
    });
    afterEach(() => {
        process.env.NODE_ENV = original.env;
        outbound.rfc = original.rfc;
        outbound.businessConfigResolver = original.resolver;
        outbound.clearTvstzCache();
        jest.restoreAllMocks();
    });

    it.each([
        ['postGoodsIssue', 'test-clerk-1120', { DeliveryDocument: '80000001' }],
        ['createBillingDocument', 'test-sales-1120', { DeliveryDocument: '80000001', BillingDocumentType: 'F2' }]
    ])('%s: shows why when the plant of the delivery cannot be read', async (action, user, body) => {
        const res = await call(user, `${LE}/${action}`, body);

        expect(res.status).toBe(503);
        expect(res.data.error.message).toBe(plantText('80000001'));
    });

    it('createOutboundDelivery: shows why when the shipping points cannot be read', async () => {
        const res = await call('test-clerk-1120', `${LE}/createOutboundDelivery`, { SalesOrder: '5000104', ShippingPoint: 'WAVG' });

        expect(res.status).toBe(503);
        expect(res.data.error.message).toBe(SHIPPING_POINTS_TEXT);
    });

    it('Orders Due: shows why when the shipping points cannot be read', async () => {
        const res = await axios.get(`${LE}/OrdersDueForDelivery`, { auth: { username: 'test-clerk-1120', password: '' }, validateStatus: () => true });

        expect(res.status).toBe(503);
        expect(res.data.error.message).toBe(SHIPPING_POINTS_TEXT);
    });

    it('Orders Due metrics: shows why when the shipping points cannot be read', async () => {
        const res = await axios.get(`${LE}/getOrdersDueMetrics()`, { auth: { username: 'test-clerk-1120', password: '' }, validateStatus: () => true });

        expect(res.status).toBe(503);
        expect(res.data.error.message).toBe(SHIPPING_POINTS_TEXT);
    });

    describe.each([['postGoodsReceipt'], ['postGoodsReceiptWithStorageUnit']])('%s', (action) => {
        const post = (extra = {}) => call('test-clerk-1120', `/odata/v4/goods-receipt/${action}`, { ...RECEIPT, StorageUnit: '180000003', ...extra });

        it('shows why when the plant of the delivery cannot be read', async () => {
            jest.spyOn(goodsReceipt, 'readDeliveryPlant').mockRejectedValue(new Error('RFC down'));

            const res = await post();

            expect(res.status).toBe(503);
            expect(res.data.error.message).toBe(plantText('180000003'));
        });

        it('shows why when the posting-attempt log is unavailable', async () => {
            jest.spyOn(goodsReceipt, 'readDeliveryPlant').mockResolvedValue('1120');
            jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('database down'));

            const res = await post();

            expect(res.status).toBe(503);
            expect(res.data.error.message).toBe(LOG_TEXT);
        });
    });

    it('HU stock transfer: shows why when the posting-attempt log is unavailable', async () => {
        jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('database down'));

        const res = await call('khushal', '/odata/v4/hu-stock-transfer/executeHuStockTransfer', {
            ReservationNo: '520311', ReservationItem: '0001', UnitNumber: '1000048321', TransferQty: 10, IsFullUnit: true, ClientAttemptId: 'nothing-posted-log'
        });

        expect(res.status).toBe(503);
        expect(res.data.error.message).toBe('HU stock transfer was NOT sent to SAP: production transaction logging is unavailable (database down). Check the document list before retrying.');
    });
});
