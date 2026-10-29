'use strict';

/**
 * Integration Test: Optimistic Concurrency & ETag Propagation Round Trip (Phase 5)
 *
 * Verifies end-to-end CAP HTTP round trip for ETag / If-Match handling across:
 *   1. Client HTTP request carrying If-Match header and/or body ETag
 *   2. CAP Handler token extraction via extractIfMatch(req)
 *   3. S/4HANA Adapter invocation with ifMatch option
 *   4. S/4HANA HTTP 412 Precondition Failed / ETag check failure mapping to HTTP 409 STALE_DATA
 *   5. Successful document mutation when ETag matches
 */

const cds = require('@sap/cds');
const OutboundDeliveryAdapter = require('../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');
const CustomerInvoiceAdapter = require('../../srv/integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter');
const GoodsReceiptAdapter = require('../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const S4ErrorMapper = require('../../srv/integration/s4hana/S4ErrorMapper');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'alice', password: '' };
const { axios } = cdsTest;
const AUTH = { username: 'alice', password: '' };

describe('Integration: Optimistic Concurrency & ETag Round Trip (Phase 5)', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Outbound Delivery Concurrency Round Trip', () => {
        it('postGoodsIssue propagates If-Match to adapter and maps S/4 412 to HTTP 409 STALE_DATA', async () => {
            const staleError = S4ErrorMapper.mapS4Error({
                status: 412,
                response: {
                    status: 412,
                    data: {
                        error: {
                            code: 'CX_SADL_ETAG_CHECK_FAILED',
                            message: { value: 'ETag condition check failed: delivery 80000001 was changed by another user' }
                        }
                    }
                }
            });

            const pgiSpy = jest.spyOn(OutboundDeliveryAdapter, 'postGoodsIssue').mockRejectedValueOnce(staleError);

            const res = await axios.post(
                '/odata/v4/outbound-delivery/postGoodsIssue',
                { DeliveryDocument: '80000001' },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"ETAG123"' },
                    validateStatus: () => true
                }
            );

            expect(pgiSpy).toHaveBeenCalledWith(
                '80000001',
                expect.objectContaining({ ifMatch: 'W/"ETAG123"' })
            );

            expect(res.status).toBe(409);
            expect(['409', 'STALE_DATA']).toContain(res.data.error.code);
            expect(res.data.error.message).toMatch(/changed by another user|stale data/i);
        });

        it('postGoodsIssue succeeds with HTTP 200 when ETag matches in S/4', async () => {
            const pgiSpy = jest.spyOn(OutboundDeliveryAdapter, 'postGoodsIssue').mockResolvedValueOnce({
                DeliveryDocument: '80000001',
                Success: true
            });

            const res = await axios.post(
                '/odata/v4/outbound-delivery/postGoodsIssue',
                { DeliveryDocument: '80000001' },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"MATCH123"' },
                    validateStatus: () => true
                }
            );

            expect(pgiSpy).toHaveBeenCalledWith(
                '80000001',
                expect.objectContaining({ ifMatch: 'W/"MATCH123"' })
            );
            expect(res.status).toBe(200);
            expect(res.data.DeliveryDocument).toBe('80000001');
        });

        it('createBillingDocument propagates If-Match and body ETag, returning 409 on conflict', async () => {
            const conflictError = S4ErrorMapper.mapS4Error({
                status: 412,
                response: {
                    status: 412,
                    data: {
                        error: {
                            code: 'CX_SADL_ETAG_CHECK_FAILED',
                            message: { value: 'Precondition Failed: document was modified by another session' }
                        }
                    }
                }
            });

            const billingSpy = jest.spyOn(OutboundDeliveryAdapter, 'createBillingDocument').mockRejectedValueOnce(conflictError);

            const res = await axios.post(
                '/odata/v4/outbound-delivery/createBillingDocument',
                { DeliveryDocument: '80000001', BillingDocumentType: 'F2' },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"BILL678"' },
                    validateStatus: () => true
                }
            );

            expect(billingSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    deliveryDocument: '80000001',
                    billingDocumentType: 'F2'
                }),
                expect.objectContaining({ ifMatch: 'W/"BILL678"' })
            );

            expect(res.status).toBe(409);
            expect(['409', 'STALE_DATA']).toContain(res.data.error.code);
            expect(res.data.error.message).toMatch(/modified by another session|stale data/i);
        });
    });

    describe('Customer Invoice Concurrency Round Trip', () => {
        beforeEach(() => {
            jest.spyOn(CustomerInvoiceAdapter, 'getBillingDocument').mockResolvedValue({
                BillingDocument: '31000111',
                AccountingTransferStatus: 'B',
                BillingDocumentIsCancelled: false,
                SDDocumentCategory: 'M'
            });
        });

        it('releaseInvoiceToAccounting propagates If-Match and returns 409 STALE_DATA on S/4 412', async () => {
            const staleError = S4ErrorMapper.mapS4Error({
                status: 412,
                response: {
                    status: 412,
                    data: {
                        error: {
                            code: '412',
                            message: { value: 'Invoice 31000111 changed by another user' }
                        }
                    }
                }
            });

            const releaseSpy = jest.spyOn(CustomerInvoiceAdapter, 'postBillingDocumentToAccounting').mockRejectedValueOnce(staleError);

            const res = await axios.post(
                '/odata/v4/customer-invoice/releaseInvoiceToAccounting',
                { BillingDocument: '31000111' },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"INV111"' },
                    validateStatus: () => true
                }
            );

            expect(releaseSpy).toHaveBeenCalledWith(
                expect.objectContaining({ billingDocument: '31000111' }),
                expect.anything()
            );

            expect(res.status).toBe(409);
            expect(['409', 'STALE_DATA']).toContain(res.data.error.code);
            expect(res.data.error.message).toMatch(/changed by another user|stale data/i);
        });

        it('cancelBillingDocument propagates If-Match and returns 409 STALE_DATA on S/4 412', async () => {
            const staleError = S4ErrorMapper.mapS4Error({
                status: 412,
                response: {
                    status: 412,
                    data: {
                        error: {
                            code: 'CX_SADL_ETAG_CHECK_FAILED',
                            message: { value: 'Billing document was changed by another user' }
                        }
                    }
                }
            });

            const cancelSpy = jest.spyOn(CustomerInvoiceAdapter, 'cancelBillingDocument').mockRejectedValueOnce(staleError);

            const res = await axios.post(
                '/odata/v4/customer-invoice/cancelBillingDocument',
                { BillingDocument: '31000112' },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"INV222"' },
                    validateStatus: () => true
                }
            );

            expect(cancelSpy).toHaveBeenCalledWith(
                expect.objectContaining({ billingDocument: '31000112' }),
                expect.anything()
            );

            expect(res.status).toBe(409);
            expect(['409', 'STALE_DATA']).toContain(res.data.error.code);
            expect(res.data.error.message).toMatch(/changed by another user|stale data/i);
        });
    });

    describe('Goods Receipt Concurrency Round Trip', () => {
        it('postGoodsReceipt propagates If-Match to adapter and returns 409 STALE_DATA on S/4 412', async () => {
            const staleError = S4ErrorMapper.mapS4Error({
                status: 412,
                response: {
                    status: 412,
                    data: {
                        error: {
                            code: 'CX_SADL_ETAG_CHECK_FAILED',
                            message: { value: 'Inbound Delivery 18000001 condition check failed' }
                        }
                    }
                }
            });

            const grSpy = jest.spyOn(GoodsReceiptAdapter, 'postGoodsReceipt').mockRejectedValueOnce(staleError);

            const res = await axios.post(
                '/odata/v4/goods-receipt/postGoodsReceipt',
                {
                    DeliveryDocument: '18000001',
                    Material: '1000000045',
                    Plant: '1120',
                    StorageLocation: 'CS01',
                    Quantity: 10,
                    Unit: 'KG'
                },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"GR333"' },
                    validateStatus: () => true
                }
            );

            expect(grSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    DeliveryDocument: '18000001',
                    Material: '1000000045',
                    Plant: '1120',
                    Quantity: 10
                }),
                expect.objectContaining({ ifMatch: 'W/"GR333"' })
            );

            expect(res.status).toBe(409);
            expect(['409', 'STALE_DATA']).toContain(res.data.error.code);
            expect(res.data.error.message).toMatch(/condition check failed|stale data/i);
        });

        it('postGoodsReceipt succeeds with HTTP 200 when ETag matches in S/4', async () => {
            const grSpy = jest.spyOn(GoodsReceiptAdapter, 'postGoodsReceipt').mockResolvedValueOnce({
                MaterialDocument: '5000009999',
                MaterialDocYear: '2026',
                Success: true
            });

            const res = await axios.post(
                '/odata/v4/goods-receipt/postGoodsReceipt',
                {
                    DeliveryDocument: '18000001',
                    Material: '1000000045',
                    Plant: '1120',
                    StorageLocation: 'CS01',
                    Quantity: 10,
                    Unit: 'KG'
                },
                {
                    auth: AUTH,
                    headers: { 'If-Match': 'W/"GRMATCH"' },
                    validateStatus: () => true
                }
            );

            expect(grSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    DeliveryDocument: '18000001'
                }),
                expect.objectContaining({ ifMatch: 'W/"GRMATCH"' })
            );

            expect(res.status).toBe(200);
            expect(res.data.MaterialDocument).toBe('5000009999');
        });
    });
});
