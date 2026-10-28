'use strict';

jest.mock('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter', () => ({
    postGoodsReceipt: jest.fn().mockResolvedValue({ MaterialDocument: '5000000001' }),
    postGoodsReceiptWithStorageUnit: jest.fn().mockResolvedValue({ MaterialDocument: '5000000002' })
}));

const GoodsReceiptAdapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const init = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');

const handlers = {};
init({ on: (event, a, b) => { handlers[typeof a === 'function' ? event : `${event}_${a}`] = typeof a === 'function' ? a : b; } });

const ADMIN = { is: (r) => r === 'Admin', attr: {} };
const clerkOf = (plant) => ({ is: () => false, attr: { Plant: [plant] } });
const DATA = {
    DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11', Plant: '1120',
    StorageLocation: 'HS01', Quantity: 1, Unit: 'KG'
};
const request = (user, data = DATA) => ({ data: { ...data }, user, reject: jest.fn((code, msg) => ({ code, msg })), error: jest.fn() });
const ACTIONS = [
    ['postGoodsReceipt', 'postGoodsReceipt'],
    ['postGoodsReceiptWithStorageUnit', 'postGoodsReceiptWithStorageUnit']
];

describe('Goods receipt posting: server-side plant scope', () => {
    beforeEach(() => jest.clearAllMocks());

    describe.each(ACTIONS)('%s', (action, adapterFn) => {
        it.each([
            ['a clerk of another plant', clerkOf('1130')],
            ['a user without plants', { is: () => false, attr: {} }],
            ['a request without user context', undefined]
        ])('refuses %s with 403 before any S/4 call', async (_label, user) => {
            const req = request(user);
            await handlers[action](req);
            expect(req.reject).toHaveBeenCalledWith(403, "Plant 1120 is outside the authenticated user's plant scope");
            expect(GoodsReceiptAdapter[adapterFn]).not.toHaveBeenCalled();
        });

        it.each([
            ['a clerk of that plant', clerkOf('1120')],
            ['an Admin (unrestricted)', ADMIN]
        ])('posts for %s', async (_label, user) => {
            const req = request(user);
            await handlers[action](req);
            expect(req.reject).not.toHaveBeenCalled();
            expect(GoodsReceiptAdapter[adapterFn]).toHaveBeenCalledTimes(1);
        });

        it('still answers 400 for missing input before the scope check', async () => {
            const req = request(clerkOf('1130'), { ...DATA, Plant: '' });
            await handlers[action](req);
            expect(req.reject).toHaveBeenCalledWith(400, 'Plant is required.');
        });
    });

    describe('optimistic concurrency (ETag) handling in postGoodsReceipt', () => {
        it('forwards If-Match header to GoodsReceiptAdapter.postGoodsReceipt', async () => {
            const req = {
                data: { ...DATA },
                user: ADMIN,
                headers: { 'if-match': 'W/"datetimeoffset\'2026-10-28T10%3A00%3A00Z\'"' },
                reject: jest.fn(),
                error: jest.fn()
            };
            await handlers['postGoodsReceipt'](req);
            expect(GoodsReceiptAdapter.postGoodsReceipt).toHaveBeenCalledWith(
                expect.objectContaining({ DeliveryDocument: '180000003', Material: 'TG11' }),
                { ifMatch: 'W/"datetimeoffset\'2026-10-28T10%3A00%3A00Z\'"' }
            );
        });

        it('forwards ETag property in data to GoodsReceiptAdapter.postGoodsReceipt', async () => {
            const req = {
                data: { ...DATA, ETag: 'W/"body-etag-789"' },
                user: ADMIN,
                reject: jest.fn(),
                error: jest.fn()
            };
            await handlers['postGoodsReceipt'](req);
            expect(GoodsReceiptAdapter.postGoodsReceipt).toHaveBeenCalledWith(
                expect.objectContaining({ DeliveryDocument: '180000003', Material: 'TG11' }),
                { ifMatch: 'W/"body-etag-789"' }
            );
        });

        it('rejects with HTTP 409 when adapter throws a 409 STALE_DATA error', async () => {
            const staleErr = new Error('This document was modified by another user or session in SAP S/4HANA (stale data).');
            staleErr.status = 409;
            staleErr.statusCode = 409;
            staleErr.code = 'STALE_DATA';
            GoodsReceiptAdapter.postGoodsReceipt.mockRejectedValueOnce(staleErr);

            const req = {
                data: { ...DATA },
                user: ADMIN,
                reject: jest.fn(),
                error: jest.fn()
            };
            await handlers['postGoodsReceipt'](req);
            expect(req.reject).toHaveBeenCalledWith(409, expect.stringContaining('stale data'));
        });
    });
});
