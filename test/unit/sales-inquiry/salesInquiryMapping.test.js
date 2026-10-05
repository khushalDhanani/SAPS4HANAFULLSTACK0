const { normalizeSalesInquiryData } = require('../../../srv/sd/sales-inquiry/mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload, mapToS4OrderPayload } = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');

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

        test('should leave dates empty when not provided instead of inventing today or future dates', () => {
            const raw = {
                header: {
                    SoldToParty: '10135'
                },
                items: [
                    {
                        Material: '4000000123',
                        OrderQuantity: 5,
                        OrderQuantityUnit: 'PC'
                    }
                ]
            };
            const result = normalizeSalesInquiryData(raw);
            expect(result.header.CustomerPurchaseOrderDate).toBe('');
            expect(result.header.SalesInquiryDate).toBe('');
            expect(result.header.CreationDate).toBe('');
            expect(result.header.RequestedDeliveryDate).toBe('');
            expect(result.header.BindingPeriodValidityStartDate).toBe('');
            expect(result.header.BindingPeriodValidityEndDate).toBe('');
            expect(result.items[0].RequestedDeliveryDate).toBe('');
        });

        test('should preserve authentic dates when provided', () => {
            const raw = {
                header: {
                    SoldToParty: '10135',
                    CustomerPurchaseOrderDate: '2026-10-01',
                    SalesInquiryDate: '2026-10-02',
                    CreationDate: '2026-10-03',
                    RequestedDeliveryDate: '2026-10-15',
                    BindingPeriodValidityStartDate: '2026-10-05',
                    BindingPeriodValidityEndDate: '2026-11-05'
                },
                items: [
                    {
                        Material: '4000000123',
                        OrderQuantity: 5,
                        OrderQuantityUnit: 'PC',
                        RequestedDeliveryDate: '2026-10-20'
                    }
                ]
            };
            const result = normalizeSalesInquiryData(raw);
            expect(result.header.CustomerPurchaseOrderDate).toBe('2026-10-01');
            expect(result.header.SalesInquiryDate).toBe('2026-10-02');
            expect(result.header.CreationDate).toBe('2026-10-03');
            expect(result.header.RequestedDeliveryDate).toBe('2026-10-15');
            expect(result.header.BindingPeriodValidityStartDate).toBe('2026-10-05');
            expect(result.header.BindingPeriodValidityEndDate).toBe('2026-11-05');
            expect(result.items[0].RequestedDeliveryDate).toBe('2026-10-20');
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

        test('should preserve CustomerName and ShipToPartyName and leave customer reference empty when omitted', () => {
            const raw = {
                header: {
                    SoldToParty: '10135',
                    CustomerName: "Divi's Laboratories Limited",
                    ShipToParty: '10135',
                    ShipToPartyName: "Divi's Laboratories Limited",
                    PurchaseOrderByCustomer: '' // Empty description
                },
                items: [
                    {
                        Material: '4000000091',
                        SalesInquiryItemText: 'Industrial Grade Chemical Inquiry',
                        OrderQuantity: 10,
                        OrderQuantityUnit: 'PC',
                        NetPriceAmount: 100
                    }
                ]
            };

            const result = normalizeSalesInquiryData(raw);
            expect(result.header.CustomerName).toBe("Divi's Laboratories Limited");
            expect(result.header.ShipToPartyName).toBe("Divi's Laboratories Limited");
            expect(result.header.PurchaseOrderByCustomer).toBe('');
            expect(result.header.PurchaseOrderNumber).toBe('');
        });

        test('should throw error if header is null or missing', () => {
            expect(() => mapToS4InquiryPayload(null, [])).toThrow();
        });

        test('should preserve CustomerName, ShipToPartyName, and TotalNetAmount in mapToS4InquiryPayload', () => {
            const header = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135',
                CustomerName: "Divi's Laboratories Limited",
                ShipToParty: '10135',
                ShipToPartyName: "Divi's Laboratories Limited",
                PurchaseOrderByCustomer: 'Chemical Inquiry',
                TotalNetAmount: 1500
            };
            const s4 = mapToS4InquiryPayload(header, []);
            expect(s4.header.CustomerName).toBe("Divi's Laboratories Limited");
            expect(s4.header.ShipToPartyName).toBe("Divi's Laboratories Limited");
            expect(s4.header.TotalNetAmount).toBe('1500');
        });

        test('should throw error if required org fields, docType, or currency are missing or blank in mapToS4InquiryPayload', () => {
            const baseHeader = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135'
            };
            const requiredFields = ['SalesInquiryType', 'SalesOrganization', 'DistributionChannel', 'OrganizationDivision', 'TransactionCurrency'];
            requiredFields.forEach(field => {
                const missing = { ...baseHeader };
                delete missing[field];
                expect(() => mapToS4InquiryPayload(missing, [])).toThrow(new RegExp(`${field} is required`));

                const blank = { ...baseHeader, [field]: '   ' };
                expect(() => mapToS4InquiryPayload(blank, [])).toThrow(new RegExp(`${field} is required`));
            });
        });

        test('should throw error if an item is missing OrderQuantityUnit in mapToS4InquiryPayload', () => {
            const header = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135'
            };
            const items = [{
                Material: '4000000123',
                OrderQuantity: 10
            }];
            expect(() => mapToS4InquiryPayload(header, items)).toThrow(/OrderQuantityUnit is required for item 000010/);
        });

        test('should leave dates empty when not provided instead of inventing today in inquiry payload', () => {
            const header = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135'
            };
            const items = [
                {
                    Material: '4000000123',
                    OrderQuantity: 5,
                    OrderQuantityUnit: 'PC'
                }
            ];
            const s4 = mapToS4InquiryPayload(header, items);
            expect(s4.header.CustomerPurchaseOrderDate).toBe('');
            expect(s4.header.SalesInquiryDate).toBe('');
            expect(s4.header.BindingPeriodValidityStartDate).toBe('');
            expect(s4.header.BindingPeriodValidityEndDate).toBe('');
        });
    });

    describe('mapToS4OrderPayload', () => {
        test('should leave dates empty when not provided instead of inventing today or today + 7 days in order payload', () => {
            const header = {
                SalesOrderType: 'OR',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135'
            };
            const items = [
                {
                    Material: '4000000123',
                    OrderQuantity: 5,
                    OrderQuantityUnit: 'PC'
                }
            ];
            const s4 = mapToS4OrderPayload(header, items);
            expect(s4.header.CustomerPurchaseOrderDate).toBe('');
            expect(s4.header.SalesOrderDate).toBe('');
            expect(s4.header.RequestedDeliveryDate).toBe('');
            expect(s4.items[0].RequestedDeliveryDate).toBe('');
        });

        test('should throw error if required org fields, docType, or currency are missing or blank in mapToS4OrderPayload', () => {
            const baseHeader = {
                SalesOrderType: 'OR',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135'
            };
            const requiredFields = ['SalesOrderType', 'SalesOrganization', 'DistributionChannel', 'OrganizationDivision', 'TransactionCurrency'];
            requiredFields.forEach(field => {
                const missing = { ...baseHeader };
                delete missing[field];
                expect(() => mapToS4OrderPayload(missing, [])).toThrow(new RegExp(`${field} is required`));

                const blank = { ...baseHeader, [field]: '   ' };
                expect(() => mapToS4OrderPayload(blank, [])).toThrow(new RegExp(`${field} is required`));
            });
        });

        test('should preserve authentic dates and item delivery date override in order payload', () => {
            const header = {
                SalesOrderType: 'OR',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135',
                CustomerPurchaseOrderDate: '2026-10-01',
                SalesOrderDate: '2026-10-02',
                RequestedDeliveryDate: '2026-10-15'
            };
            const items = [
                {
                    Material: '4000000123',
                    OrderQuantity: 5,
                    OrderQuantityUnit: 'PC'
                },
                {
                    Material: '4000000124',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'PC',
                    RequestedDeliveryDate: '2026-10-25'
                }
            ];
            const s4 = mapToS4OrderPayload(header, items);
            expect(s4.header.CustomerPurchaseOrderDate).toBe('2026-10-01');
            expect(s4.header.SalesOrderDate).toBe('2026-10-02');
            expect(s4.header.RequestedDeliveryDate).toBe('2026-10-15');
            expect(s4.items[0].RequestedDeliveryDate).toBe('2026-10-15');
            expect(s4.items[1].RequestedDeliveryDate).toBe('2026-10-25');
        });
    });
});
