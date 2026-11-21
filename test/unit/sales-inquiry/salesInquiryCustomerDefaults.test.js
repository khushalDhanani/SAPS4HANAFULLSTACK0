'use strict';

const customerDefaultsReader = require('../../../srv/integration/s4hana/sd/sales-inquiry/salesInquiryCustomerDefaults');

describe('Unit: salesInquiryCustomerDefaults', () => {
    test('returns blank defaults object when customer is empty', async () => {
        const mockAdapter = {};
        const result = await customerDefaultsReader.getCustomerDefaults(mockAdapter, '', '', '', '');
        expect(result.Customer).toBe('');
        expect(result.CustomerName).toBe('');
        expect(result.SalesOffice).toBe('');
        expect(result.derived).toBe(false);
    });

    test('derives customer defaults from master data and historical inquiries', async () => {
        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            customerMasterCache: {
                getOrSet: jest.fn().mockResolvedValue({
                    Name: 'Acme Corp',
                    City: 'Metropolis',
                    Country: 'US'
                })
            },
            s4hanaWL: {
                run: jest.fn().mockImplementation(() => {
                    return Promise.resolve([
                        { TransactionCurrency: 'USD', SalesOffice: 'US01', SalesGroup: '101' }
                    ]);
                })
            },
            customerSalesAreaCache: {
                getOrSet: jest.fn().mockResolvedValue([
                    {
                        SalesOrganization: '1000',
                        DistributionChannel: '10',
                        Division: '52',
                        CustomerPaymentTerms: 'NT30',
                        Incoterms: 'FOB',
                        IncotermsLocation1: 'Port'
                    }
                ])
            },
            salesOfficeVhCache: {
                getOrSet: jest.fn().mockResolvedValue('US East Office')
            },
            salesGroupVhCache: {
                getOrSet: jest.fn().mockResolvedValue('US Commercial Group')
            },
            client: { get: jest.fn() },
            rfc: { readTable: jest.fn().mockResolvedValue([]) }
        };

        const result = await customerDefaultsReader.getCustomerDefaults(mockAdapter, '100001', '1000', '10', '52');
        expect(result.Customer).toBe('100001');
        expect(result.CustomerName).toBe('Acme Corp');
        expect(result.City).toBe('Metropolis');
        expect(result.Country).toBe('US');
        expect(result.Currency).toBe('USD');
        expect(result.SalesOffice).toBe('US01');
        expect(result.SalesOfficeName).toBe('US East Office');
        expect(result.SalesGroup).toBe('101');
        expect(result.SalesGroupName).toBe('US Commercial Group');
        expect(result.PaymentTerms).toBe('NT30');
        expect(result.Incoterms).toBe('FOB');
        expect(result.validForSalesArea).toBe(true);
    });
});
