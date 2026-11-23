'use strict';

/**
 * Integration: refusals that say nothing was posted keep their text in production, where CAP replaces 5xx text with a
 * generic message unless the error opts out. Real CAP HTTP, roles and handlers; only SAP is doubled.
 */

const cds = require('@sap/cds');

const { axios } = cds.test(__dirname + '/../../');
const outbound = require('../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');

const LE = '/odata/v4/outbound-delivery';
const call = (user, path, body) => axios.post(path, body, { auth: { username: user, password: '' }, validateStatus: () => true });
const SHIPPING_POINTS_TEXT = 'The shipping points of plant 1120 could not be read from SAP, so nothing was read or posted. Try again.';
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

    it('createBillingDocument: shows why when the plant of the delivery cannot be read', async () => {
        const res = await call('test-sales-1120', `${LE}/createBillingDocument`, { DeliveryDocument: '80000001', BillingDocumentType: 'F2' });

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
});
