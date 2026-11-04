'use strict';

/**
 * Unit Tests for Frontend CustomerInvoiceService
 * (CustomerInvoiceService.js)
 */

describe('Frontend CustomerInvoiceService Unit Tests', () => {
    let CustomerInvoiceService;
    let mockODataClient;

    beforeAll(() => {
        mockODataClient = {
            get: jest.fn(),
            post: jest.fn(),
            readEntitySet: jest.fn()
        };
        const origSap = global.sap;
        global.sap = {
            ui: {
                define: (deps, factory) => {
                    CustomerInvoiceService = factory(mockODataClient, function Filter() {}, {});
                }
            }
        };
        delete require.cache[require.resolve('../../../app/fiori-app/webapp/modules/sd/customer-invoice/service/CustomerInvoiceService')];
        require('../../../app/fiori-app/webapp/modules/sd/customer-invoice/service/CustomerInvoiceService');
        global.sap = origSap;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        CustomerInvoiceService.setModel(null);
    });

    it('supports setModel and getModel', () => {
        const dummyModel = { bindList: jest.fn() };
        CustomerInvoiceService.setModel(dummyModel);
        expect(CustomerInvoiceService.getModel()).toBe(dummyModel);
        CustomerInvoiceService.setModel(null);
        expect(CustomerInvoiceService.getModel()).toBeNull();
    });

    describe('releaseInvoiceToAccounting', () => {
        it('with a V4 model, executes the bound action with the document and returns the bound result', async () => {
            const mockAction = {
                setParameter: jest.fn(),
                execute: jest.fn().mockResolvedValue(),
                getBoundContext: () => ({ getObject: () => ({ AccountingDocument: '9000000100' }) })
            };
            const mockModel = {
                bindContext: jest.fn().mockReturnValue(mockAction)
            };

            const res = await CustomerInvoiceService.releaseInvoiceToAccounting('31000111', mockModel);
            expect(mockModel.bindContext).toHaveBeenCalledWith('/releaseInvoiceToAccounting(...)');
            expect(mockAction.setParameter.mock.calls).toEqual([['BillingDocument', '31000111']]);
            expect(mockAction.execute).toHaveBeenCalledTimes(1);
            expect(res).toEqual({ AccountingDocument: '9000000100' });
            expect(mockODataClient.post).not.toHaveBeenCalled();
        });

        it('with a V4 model, also sets the ETag parameter when one is given', async () => {
            const mockAction = {
                setParameter: jest.fn(),
                execute: jest.fn().mockResolvedValue(),
                getBoundContext: () => ({ getObject: () => ({}) })
            };

            await CustomerInvoiceService.releaseInvoiceToAccounting('31000111', { bindContext: () => mockAction }, { etag: 'W/"12345"' });

            expect(mockAction.setParameter).toHaveBeenCalledWith('ETag', 'W/"12345"');
        });

        it('falls back to ODataClient.post without ETag (2 arguments)', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true });
            const res = await CustomerInvoiceService.releaseInvoiceToAccounting('31000111');
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/customer-invoice/releaseInvoiceToAccounting',
                { BillingDocument: '31000111' }
            );
            expect(res).toEqual({ Success: true });
        });

        it('falls back to ODataClient.post with ETag and If-Match header', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true });
            const res = await CustomerInvoiceService.releaseInvoiceToAccounting('31000111', null, { etag: 'W/"ETAG999"' });
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/customer-invoice/releaseInvoiceToAccounting',
                { BillingDocument: '31000111' },
                { 'If-Match': 'W/"ETAG999"' }
            );
            expect(res).toEqual({ Success: true });
        });
    });

    describe('cancelBillingDocument', () => {
        // ETag on this V4 path is left out on purpose: whether it should be sent is an open question (see the audit ask file).
        it('with a V4 model, executes the bound action with the document and returns the bound result', async () => {
            const mockAction = {
                setParameter: jest.fn(),
                execute: jest.fn().mockResolvedValue(),
                getBoundContext: () => ({ getObject: () => ({ CancellationDocument: '90000053' }) })
            };
            const mockModel = {
                bindContext: jest.fn().mockReturnValue(mockAction)
            };

            const res = await CustomerInvoiceService.cancelBillingDocument('31000112', mockModel);
            expect(mockModel.bindContext).toHaveBeenCalledWith('/cancelBillingDocument(...)');
            expect(mockAction.setParameter.mock.calls).toEqual([['BillingDocument', '31000112']]);
            expect(mockAction.execute).toHaveBeenCalledTimes(1);
            expect(res).toEqual({ CancellationDocument: '90000053' });
            expect(mockODataClient.post).not.toHaveBeenCalled();
        });

        it('falls back to ODataClient.post without ETag (2 arguments)', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true });
            const res = await CustomerInvoiceService.cancelBillingDocument('31000112');
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/customer-invoice/cancelBillingDocument',
                { BillingDocument: '31000112' }
            );
            expect(res).toEqual({ Success: true });
        });

        it('falls back to ODataClient.post with ETag and If-Match header', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true });
            const res = await CustomerInvoiceService.cancelBillingDocument('31000112', null, { etag: 'W/"ETAG888"' });
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/customer-invoice/cancelBillingDocument',
                { BillingDocument: '31000112' },
                { 'If-Match': 'W/"ETAG888"' }
            );
            expect(res).toEqual({ Success: true });
        });
    });
});
