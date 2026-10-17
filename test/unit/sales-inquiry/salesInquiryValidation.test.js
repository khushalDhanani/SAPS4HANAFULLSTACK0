const { validateCreateSalesInquiryPayload } = require('../../../srv/sd/sales-inquiry/validation/salesInquiry.validation');

describe('Unit: Sales Inquiry Validation', () => {
    const validHeader = {
        SalesInquiryType: 'ZIN',
        SalesOrganization: '1000',
        DistributionChannel: '10',
        OrganizationDivision: '52',
        SoldToParty: '10135',
        ShipToParty: '10135',
        PurchaseOrderByCustomer: 'REF-2026-001',
        BindingPeriodValidityStartDate: '2026-09-07',
        BindingPeriodValidityEndDate: '2026-10-07',
        TransactionCurrency: 'INR'
    };

    const validItems = [
        {
            SalesInquiryItem: '10',
            Material: '4000000123',
            SalesInquiryItemText: 'Active Formulation API',
            OrderQuantity: 50,
            OrderQuantityUnit: 'KG',
            Plant: '1120',
            NetPriceAmount: 1200,
            NetAmount: 60000
        }
    ];

    test('should validate a complete valid Sales Inquiry payload successfully', () => {
        const result = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: validItems
        });
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test('should reject non-object or null payload', () => {
        expect(validateCreateSalesInquiryPayload(null).isValid).toBe(false);
        expect(validateCreateSalesInquiryPayload(undefined).isValid).toBe(false);
        expect(validateCreateSalesInquiryPayload('invalid').isValid).toBe(false);
    });

    test('should reject missing header object', () => {
        const result = validateCreateSalesInquiryPayload({ items: validItems });
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('header');
    });

    test('should reject missing required header fields', () => {
        const missingFields = [
            'SalesInquiryType',
            'SalesOrganization',
            'DistributionChannel',
            'OrganizationDivision',
            'SoldToParty',
            'TransactionCurrency'
        ];

        missingFields.forEach(field => {
            const badHeader = { ...validHeader };
            delete badHeader[field];
            const result = validateCreateSalesInquiryPayload({
                header: badHeader,
                items: validItems
            });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === field)).toBe(true);
        });
    });

    test('should reject blank or whitespace-only required header fields', () => {
        const requiredFields = [
            'SalesInquiryType',
            'SalesOrganization',
            'DistributionChannel',
            'OrganizationDivision',
            'SoldToParty',
            'TransactionCurrency'
        ];

        requiredFields.forEach(field => {
            const badHeader = { ...validHeader, [field]: '   ' };
            const result = validateCreateSalesInquiryPayload({
                header: badHeader,
                items: validItems
            });
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === field)).toBe(true);
        });
    });

    test('should reject field length violations', () => {
        const badHeader = {
            ...validHeader,
            SalesInquiryType: 'TOOLONG',
            SalesOrganization: '10000',
            DistributionChannel: '100',
            OrganizationDivision: '520',
            SoldToParty: '12345678901'
        };
        const result = validateCreateSalesInquiryPayload({
            header: badHeader,
            items: validItems
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    test('should reject invalid currency codes', () => {
        const badHeader = { ...validHeader, TransactionCurrency: 'TOOLONG' };
        const result = validateCreateSalesInquiryPayload({
            header: badHeader,
            items: validItems
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'TransactionCurrency')).toBe(true);
    });

    test('should reject when Validity End Date is before Start Date', () => {
        const badHeader = {
            ...validHeader,
            BindingPeriodValidityStartDate: '2026-10-01',
            BindingPeriodValidityEndDate: '2026-09-01'
        };
        const result = validateCreateSalesInquiryPayload({
            header: badHeader,
            items: validItems
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'BindingPeriodValidityEndDate')).toBe(true);
    });

    test('should reject empty or missing items array', () => {
        const noItems = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: []
        });
        expect(noItems.isValid).toBe(false);

        const nullItems = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: null
        });
        expect(nullItems.isValid).toBe(false);
    });

    test('should reject item with missing material', () => {
        const badItems = [{ ...validItems[0], Material: '' }];
        const result = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: badItems
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'Material')).toBe(true);
    });

    test('should reject item with missing or non-positive quantity', () => {
        const zeroQty = [{ ...validItems[0], OrderQuantity: 0 }];
        expect(validateCreateSalesInquiryPayload({ header: validHeader, items: zeroQty }).isValid).toBe(false);

        const negativeQty = [{ ...validItems[0], OrderQuantity: -5 }];
        expect(validateCreateSalesInquiryPayload({ header: validHeader, items: negativeQty }).isValid).toBe(false);

        const nonNumericQty = [{ ...validItems[0], OrderQuantity: 'abc' }];
        expect(validateCreateSalesInquiryPayload({ header: validHeader, items: nonNumericQty }).isValid).toBe(false);
    });

    test('should reject item with missing unit of measure', () => {
        const badItems = [{ ...validItems[0], OrderQuantityUnit: '' }];
        const result = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: badItems
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'OrderQuantityUnit')).toBe(true);
    });

    test('should reject item with missing or whitespace plant', () => {
        const missingPlant = [{ ...validItems[0] }];
        delete missingPlant[0].Plant;
        const result1 = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: missingPlant
        });
        expect(result1.isValid).toBe(false);
        expect(result1.message).toBe('Plant is required for each line item');
        const plantErr = result1.errors.find(e => e.field === 'items[0].Plant');
        expect(plantErr).toBeDefined();
        expect(plantErr.code).toBe('REQUIRED_FIELD');
        expect(plantErr.message).toBe('Plant is required for each line item');

        const whitespacePlant = [{ ...validItems[0], Plant: '   ' }];
        const result2 = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: whitespacePlant
        });
        expect(result2.isValid).toBe(false);
        expect(result2.errors.some(e => e.field === 'items[0].Plant' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    test('should reject item with plant exceeding 4 characters', () => {
        const badPlant = [{ ...validItems[0], Plant: '11200' }];
        const result = validateCreateSalesInquiryPayload({
            header: validHeader,
            items: badPlant
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'Plant' && e.message.includes('cannot exceed 4 characters'))).toBe(true);
    });
});
