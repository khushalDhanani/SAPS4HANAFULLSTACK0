const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: Sales Inquiry Adapter', () => {
    beforeEach(() => {
        salesInquiryAdapter.resetCache();
    });

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

    test('should generate sequential standard inquiry number', async () => {
        const nextNum = await salesInquiryAdapter.getNextInquiryNumber();
        expect(parseInt(nextNum, 10)).toBeGreaterThanOrEqual(1000041);
    });

    test('should create sales inquiry, store in registry, and return generated ID', async () => {
        const header = {
            SalesInquiryType: 'ZIN',
            SalesOrganization: '1000',
            DistributionChannel: '10',
            OrganizationDivision: '52',
            SoldToParty: '10135',
            PurchaseOrderByCustomer: 'TEST-INQ-001',
            TransactionCurrency: 'INR'
        };

        const items = [
            {
                SalesInquiryItem: '000010',
                Material: '4000000123',
                SalesInquiryItemText: 'Active Raw Material',
                OrderQuantity: 100,
                OrderQuantityUnit: 'KG',
                NetPriceAmount: 250,
                NetAmount: 25000
            }
        ];

        const created = await salesInquiryAdapter.createSalesInquiry(header, items, { user: 'TESTUSER' });
        expect(created.SalesInquiry).toBeDefined();
        expect(created.TotalNetAmount).toBe('25000.00');

        // Verify readable via getInquiry
        const fetched = await salesInquiryAdapter.getInquiry(created.SalesInquiry);
        expect(fetched).toBeDefined();
        expect(fetched.header.SalesInquiry).toBe(created.SalesInquiry);
        expect(fetched.header.SoldToParty).toBe('10135');
        expect(fetched.header.TotalNetAmount).toBe('25000.00');
        expect(fetched.items).toHaveLength(1);
        expect(fetched.items[0].Material).toBe('4000000123');

        // Verify readable in getInquiries list
        const all = await salesInquiryAdapter.getInquiries();
        expect(all.some(i => i.SalesInquiry === created.SalesInquiry)).toBe(true);
    });
});
