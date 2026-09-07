/**
 * Unit & Contract Tests: Sales Inquiry Creation Payload Sanitization
 * Validates that CustomerCity and non-contract UI properties are stripped before dispatching to CAP OData.
 */

let SalesInquiryService;
const mockODataClient = {
    post: jest.fn(),
    get: jest.fn()
};

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                SalesInquiryService = factory(mockODataClient);
            }
        }
    };
    require('../../../app/fiori-app/webapp/modules/sd/sales-inquiry/service/SalesInquiryService');
});

const { validateCreateSalesInquiryPayload } = require('../../../srv/sd/sales-inquiry/validation/salesInquiry.validation');
const { normalizeSalesInquiryData } = require('../../../srv/sd/sales-inquiry/mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload } = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');

describe('Unit: Sales Inquiry Creation Payload Contract Validation', () => {
    test('SalesInquiryService._sanitizePayload should remove CustomerCity and non-contract fields from header', () => {
        const rawPayload = {
            header: {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                CustomerName: "Divi's Laboratories Limited",
                CustomerCity: 'Hyderabad',       // Invalid backend field
                CustomerCountry: 'IN',           // Invalid backend field
                ShipToParty: '10135',
                ShipToPartyName: "Divi's Laboratories Limited", // Invalid backend field
                PurchaseOrderByCustomer: 'PO-TEST',
                CustomerPurchaseOrderDate: '2026-09-07',
                SalesInquiryDate: '2026-09-07',
                BindingPeriodValidityStartDate: '2026-09-07',
                BindingPeriodValidityEndDate: '2026-10-07',
                TransactionCurrency: 'INR',
                TotalNetAmount: 600,
                StatusText: 'Ready to Create',   // Invalid backend field
                StatusState: 'Success',          // Invalid backend field
                StatusIcon: 'sap-icon://accept', // Invalid backend field
                CreatedByUser: 'alice'           // Invalid backend field
            },
            items: [
                {
                    SalesInquiryItem: '000010',
                    Material: '4000000091',
                    SalesInquiryItemText: 'BPAO88063',
                    OrderQuantity: 1,
                    OrderQuantityUnit: 'PC',
                    NetPriceAmount: 600,
                    NetAmount: 600,
                    TransactionCurrency: 'INR',
                    errors: {}                   // Invalid backend field
                }
            ]
        };

        const sanitized = SalesInquiryService._sanitizePayload(rawPayload);

        // Header assertions
        expect(sanitized.header.CustomerCity).toBeUndefined();
        expect(sanitized.header.CustomerCountry).toBeUndefined();
        expect(sanitized.header.ShipToPartyName).toBeUndefined();
        expect(sanitized.header.StatusText).toBeUndefined();
        expect(sanitized.header.StatusState).toBeUndefined();
        expect(sanitized.header.StatusIcon).toBeUndefined();
        expect(sanitized.header.CreatedByUser).toBeUndefined();

        expect(sanitized.header.SalesInquiryType).toBe('ZIN');
        expect(sanitized.header.SalesOrganization).toBe('1000');
        expect(sanitized.header.DistributionChannel).toBe('10');
        expect(sanitized.header.OrganizationDivision).toBe('52');
        expect(sanitized.header.SoldToParty).toBe('10135');
        expect(sanitized.header.CustomerName).toBe("Divi's Laboratories Limited");
        expect(sanitized.header.ShipToParty).toBe('10135');
        expect(sanitized.header.PurchaseOrderByCustomer).toBe('PO-TEST');
        expect(sanitized.header.TransactionCurrency).toBe('INR');
        expect(sanitized.header.TotalNetAmount).toBe(600);

        // Items assertions
        expect(sanitized.items).toHaveLength(1);
        expect(sanitized.items[0].errors).toBeUndefined();
        expect(sanitized.items[0].SalesInquiryItem).toBe('000010');
        expect(sanitized.items[0].Material).toBe('4000000091');
        expect(sanitized.items[0].OrderQuantity).toBe(1);
        expect(sanitized.items[0].OrderQuantityUnit).toBe('PC');
    });

    test('Sanitized payload should pass server-side business validation cleanly', () => {
        const payload = {
            header: {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                CustomerName: "Divi's Laboratories Limited",
                ShipToParty: '10135',
                PurchaseOrderByCustomer: 'PO-999',
                CustomerPurchaseOrderDate: '2026-09-07',
                SalesInquiryDate: '2026-09-07',
                BindingPeriodValidityStartDate: '2026-09-07',
                BindingPeriodValidityEndDate: '2026-10-07',
                TransactionCurrency: 'INR',
                TotalNetAmount: 600
            },
            items: [
                {
                    SalesInquiryItem: '000010',
                    Material: '4000000091',
                    SalesInquiryItemText: 'BPAO88063',
                    OrderQuantity: 1,
                    OrderQuantityUnit: 'PC',
                    NetPriceAmount: 600,
                    NetAmount: 600,
                    TransactionCurrency: 'INR'
                }
            ]
        };

        const validation = validateCreateSalesInquiryPayload(payload);
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toHaveLength(0);

        const normalized = normalizeSalesInquiryData(payload, { user: 'alice' });
        expect(normalized.header.SoldToParty).toBe('10135');
        expect(normalized.items[0].Material).toBe('4000000091');

        const s4Payload = mapToS4InquiryPayload(normalized.header, normalized.items, { user: 'alice' });
        expect(s4Payload.header.SoldToParty).toBe('10135');
        expect(s4Payload.header.CustomerCity).toBeUndefined();
        expect(s4Payload.items[0].OrderQuantity).toBe('1.000');
    });
});
