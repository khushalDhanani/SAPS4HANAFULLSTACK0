const { normalizeSalesInquiryData } = require('../../../srv/sd/sales-inquiry/mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload } = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');

describe('Unit: Sales Inquiry Mapping', () => {
    describe('normalizeSalesInquiryData', () => {
        test('should normalize valid incoming inquiry data with default values', () => {
            const raw = {
                header: {
                    SalesInquiryType: '  ZIN  ',
                    SalesOrganization: ' 1000 ',
                    DistributionChannel: '10',
                    OrganizationDivision: '52',
                    SoldToParty: '10135',
                    TransactionCurrency: 'inr'
                },
                items: [
                    {
                        Material: '4000000123',
                        OrderQuantity: '10',
                        OrderQuantityUnit: 'kg',
                        NetPriceAmount: '500'
                    },
                    {
                        Material: '1000000003',
                        OrderQuantity: '5',
                        OrderQuantityUnit: 'ea',
                        NetPriceAmount: '200'
                    }
                ]
            };

            const result = normalizeSalesInquiryData(raw);

            expect(result.header.SalesInquiryType).toBe('ZIN');
            expect(result.header.SalesOrganization).toBe('1000');
            expect(result.header.TransactionCurrency).toBe('INR');
            expect(result.header.ShipToParty).toBe('10135'); // Defaulted to SoldTo
            expect(result.header.TotalNetAmount).toBe(6000); // 10*500 + 5*200

            expect(result.items).toHaveLength(2);
            expect(result.items[0].SalesInquiryItem).toBe('000010');
            expect(result.items[0].NetAmount).toBe(5000);
            expect(result.items[0].OrderQuantityUnit).toBe('KG');
            expect(result.items[1].SalesInquiryItem).toBe('000020');
            expect(result.items[1].NetAmount).toBe(1000);
        });

        test('should preserve explicit custom item numbers and ship-to party', () => {
            const raw = {
                header: {
                    SoldToParty: '10135',
                    ShipToParty: '10136'
                },
                items: [
                    {
                        SalesInquiryItem: '50',
                        Material: '4000000123',
                        OrderQuantity: 1
                    }
                ]
            };

            const result = normalizeSalesInquiryData(raw);
            expect(result.header.ShipToParty).toBe('10136');
            expect(result.items[0].SalesInquiryItem).toBe('000050');
        });

        test('should return input as-is when input is falsy or invalid', () => {
            expect(normalizeSalesInquiryData(null)).toBeNull();
            expect(normalizeSalesInquiryData('abc')).toBe('abc');
        });
    });

    describe('mapToS4InquiryPayload', () => {
        test('should map normalized CAP header and items to S/4HANA OData structure', () => {
            const header = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                ShipToParty: '10136',
                PurchaseOrderByCustomer: 'PO-999',
                CustomerPurchaseOrderDate: '2026-09-07',
                SalesInquiryDate: '2026-09-07',
                BindingPeriodValidityStartDate: '2026-09-07',
                BindingPeriodValidityEndDate: '2026-10-07',
                TransactionCurrency: 'INR'
            };

            const items = [
                {
                    SalesInquiryItem: '000010',
                    Material: '4000000123',
                    SalesInquiryItemText: 'Active API',
                    OrderQuantity: 10,
                    OrderQuantityUnit: 'KG',
                    NetPriceAmount: 500,
                    NetAmount: 5000
                }
            ];

            const s4 = mapToS4InquiryPayload(header, items);

            expect(s4.header.SalesInquiryType).toBe('ZIN');
            expect(s4.header.SalesOrganization).toBe('1000');
            expect(s4.header.SoldToParty).toBe('10135');
            expect(s4.header.ShipToParty).toBe('10136');
            expect(s4.header.PurchaseOrderByCustomer).toBe('PO-999');

            expect(s4.items).toHaveLength(1);
            expect(s4.items[0].SalesInquiryItem).toBe('000010');
            expect(s4.items[0].OrderQuantity).toBe('10.000');
            expect(s4.items[0].OrderQuantityUnit).toBe('KG');
            expect(s4.items[0].NetPriceAmount).toBe('500.00');
            expect(s4.items[0].NetAmount).toBe('5000.00');
            expect(s4.items[0].TransactionCurrency).toBe('INR');
        });

        test('should throw error if header is null or missing', () => {
            expect(() => mapToS4InquiryPayload(null, [])).toThrow();
        });
    });
});
