const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: Sales Inquiry Adapter', () => {
    test('should provide standard Sales Inquiry creation defaults', async () => {
        const defaults = await salesInquiryAdapter.getSalesInquiryDefaults();
        expect(defaults.SalesInquiryType).toBe('ZIN');
        expect(defaults.SalesOrganization).toBe('1000');
        expect(defaults.DistributionChannel).toBe('10');
        expect(defaults.OrganizationDivision).toBe('52');
        expect(defaults.TransactionCurrency).toBe('INR');
        expect(defaults.SalesInquiryDate).toBeDefined();
        expect(defaults.BindingPeriodValidityStartDate).toBeDefined();
        expect(defaults.BindingPeriodValidityEndDate).toBeDefined();
        expect(defaults.derived).toBe(true);
    });

    test('should return customer defaults with fallback for empty input', async () => {
        const result = await salesInquiryAdapter.getCustomerDefaults('', '', '', '');
        expect(result.Customer).toBe('');
        expect(result.derived).toBe(false);
    });

    test('should create sales inquiry directly via S/4HANA OData service and return SAP-assigned number', async () => {
        const header = {
            SalesInquiryType: 'ZIN',
            SalesOrganization: '1000',
            DistributionChannel: '10',
            OrganizationDivision: '52',
            SoldToParty: '10135',
            PurchaseOrderByCustomer: 'TEST-PO-REF',
            TransactionCurrency: 'INR'
        };

        const items = [
            {
                SalesInquiryItem: '000010',
                Material: '4000000091',
                SalesInquiryItemText: 'Active Raw Material',
                OrderQuantity: 1,
                OrderQuantityUnit: 'KG',
                NetPriceAmount: 250,
                NetAmount: 250
            }
        ];

        const mockExecuteHttpRequest = jest.fn()
            // 1st call: HeaderSet POST
            .mockResolvedValueOnce({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '1000522',
                        SalesOrderTypeCode: 'ZIN',
                        SalesOrganization: '1000',
                        NetValue: '250.00',
                        Currency: 'INR'
                    }
                }
            })
            // 2nd call: ItemSet POST
            .mockResolvedValueOnce({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '1000522',
                        ItemID: '000010',
                        MaterialID: '4000000091'
                    }
                }
            })
            // 3rd call: PriceCondSet POST
            .mockResolvedValueOnce({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '1000522',
                        ItemID: '000010',
                        CondTypeCode: 'ZPR1',
                        AmountInternal: '50.00'
                    }
                }
            });

        const created = await salesInquiryAdapter.createSalesInquiry(header, items, {
            destination: { url: 'http://mock-s4hana' },
            executeHttpRequest: mockExecuteHttpRequest
        });

        expect(created.SalesInquiry).toBe('1000522');
        expect(created.TotalNetAmount).toBe('250.00');
        expect(created.TransactionCurrency).toBe('INR');

        // Check calls
        expect(mockExecuteHttpRequest).toHaveBeenCalledTimes(3);
        const headerCall = mockExecuteHttpRequest.mock.calls[0];
        expect(headerCall[1].method).toBe('post');
        expect(headerCall[1].url).toContain('/HeaderSet');
        expect(headerCall[1].data.SalesOrderTypeCode).toBe('ZIN');
        expect(headerCall[1].data.SoldToPartyID).toBe('10135');
        expect(headerCall[1].data.PurchaseOrderNumber).toBe('TEST-PO-REF');

        // Check item call
        const itemCall = mockExecuteHttpRequest.mock.calls[1];
        expect(itemCall[1].method).toBe('post');
        expect(itemCall[1].url).toMatch(/\/HeaderSet\((?:'|%27)1000522(?:'|%27)\)\/ItemSet/);
        expect(itemCall[1].data.SalesOrderID).toBe('1000522');
        expect(itemCall[1].data.ItemID).toBe('000010');
        expect(itemCall[1].data.MaterialID).toBe('4000000091');

        // Check price condition call
        const condCall = mockExecuteHttpRequest.mock.calls[2];
        expect(condCall[1].method).toBe('post');
        expect(condCall[1].url).toMatch(/\/HeaderSet\((?:'|%27)1000522(?:'|%27)\)\/PriceCondSet/);
        expect(condCall[1].data.SalesOrderID).toBe('1000522');
        expect(condCall[1].data.ItemID).toBe('000010');
        expect(condCall[1].data.CondTypeCode).toBe('ZPR1');
        expect(condCall[1].data.AmountInternal).toBe('250.00');
    });

    test('should fallback PurchaseOrderByCustomer to first item text if reference is empty', async () => {
        const header = {
            SalesInquiryType: 'ZIN',
            SoldToParty: '10135',
            PurchaseOrderByCustomer: ''
        };
        const items = [
            {
                SalesInquiryItem: '000010',
                Material: '4000000091',
                SalesInquiryItemText: 'High Grade Chemical Reagent',
                OrderQuantity: 5
            }
        ];

        const mockExecuteHttpRequest = jest.fn()
            .mockResolvedValueOnce({
                status: 201,
                data: { d: { SalesOrderID: '1000523' } }
            })
            .mockResolvedValueOnce({
                status: 201,
                data: { d: { SalesOrderID: '1000523', ItemID: '000010' } }
            });

        const created = await salesInquiryAdapter.createSalesInquiry(header, items, {
            destination: { url: 'http://mock-s4hana' },
            executeHttpRequest: mockExecuteHttpRequest
        });

        expect(created.SalesInquiry).toBe('1000523');
        const headerCall = mockExecuteHttpRequest.mock.calls[0];
        expect(headerCall[1].data.PurchaseOrderNumber).toBe('High Grade Chemical Reagent');
    });

    test('should propagate SAP S/4HANA backend error message when creation fails', async () => {
        const header = { SalesInquiryType: 'ZIN', SoldToParty: '99999' };
        const mockExecuteHttpRequest = jest.fn().mockRejectedValue({
            message: 'Request failed with status code 400',
            response: {
                data: {
                    error: {
                        code: 'SLS_LORD/005',
                        message: {
                            lang: 'en',
                            value: 'Customer 99999 does not exist in sales area 1000/10/52'
                        }
                    }
                }
            }
        });

        await expect(salesInquiryAdapter.createSalesInquiry(header, [], {
            destination: { url: 'http://mock-s4hana' },
            executeHttpRequest: mockExecuteHttpRequest
        })).rejects.toThrow('Customer 99999 does not exist in sales area 1000/10/52');
    });
});
