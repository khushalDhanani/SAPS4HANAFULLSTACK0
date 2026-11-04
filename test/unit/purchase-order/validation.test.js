const { validateCreatePurchaseOrderPayload } = require('../../../srv/mm/purchase-order/validation/purchaseOrder.validation');
const validPayload = require('../../fixtures/purchase-order/validPOPayload.json');

describe('Unit: Validation', () => {

    it('should validate a complete valid PO payload successfully', () => {
        const result = validateCreatePurchaseOrderPayload(validPayload);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.message).toBe('');
    });

    it('should reject non-object or null payload', () => {
        const nullResult = validateCreatePurchaseOrderPayload(null);
        expect(nullResult.isValid).toBe(false);
        expect(nullResult.message).toContain('Request body must be a valid JSON object');

        const strResult = validateCreatePurchaseOrderPayload('not-an-object');
        expect(strResult.isValid).toBe(false);
    });

    it('should reject missing header object', () => {
        const result = validateCreatePurchaseOrderPayload({ items: validPayload.items });
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('Header is required');
    });

    it('should reject missing required header fields', () => {
        const incompleteHeader = {
            header: {
                PurchaseOrderType: '',
                CompanyCode: '1010'
                // missing PurchasingOrganization, PurchasingGroup, Supplier, Currency, DocumentDate
            },
            items: validPayload.items
        };

        const result = validateCreatePurchaseOrderPayload(incompleteHeader);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('PurchaseOrderType'))).toBe(true);
        expect(result.errors.some(e => e.message.includes('PurchasingOrganization'))).toBe(true);
        expect(result.errors.some(e => e.message.includes('Supplier'))).toBe(true);
    });

    it('should reject invalid ISO currency codes', () => {
        const payload = {
            header: { ...validPayload.header, Currency: 'EURO' }, // 4 letters
            items: validPayload.items
        };
        const result = validateCreatePurchaseOrderPayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('valid 3-letter ISO currency code');

        const payloadNum = {
            header: { ...validPayload.header, Currency: '123' },
            items: validPayload.items
        };
        const resultNum = validateCreatePurchaseOrderPayload(payloadNum);
        expect(resultNum.isValid).toBe(false);
    });

    it('should reject invalid DocumentDate format', () => {
        const payload = {
            header: { ...validPayload.header, DocumentDate: 'not-a-date' },
            items: validPayload.items
        };
        const result = validateCreatePurchaseOrderPayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('not a valid date');
    });

    it('should enforce Incoterms cross-field validation', () => {
        // Incoterms provided without location
        const payloadNoLocation = {
            header: {
                ...validPayload.header,
                IncotermsClassification: 'EXW',
                IncotermsLocation1: ''
            },
            items: validPayload.items
        };
        const result = validateCreatePurchaseOrderPayload(payloadNoLocation);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('IncotermsLocation1 is required when IncotermsClassification is specified');

        // Location exceeds max length 70
        const payloadLongLocation = {
            header: {
                ...validPayload.header,
                IncotermsClassification: 'EXW',
                IncotermsLocation1: 'A'.repeat(71)
            },
            items: validPayload.items
        };
        const resultLong = validateCreatePurchaseOrderPayload(payloadLongLocation);
        expect(resultLong.isValid).toBe(false);
        expect(resultLong.message).toContain('exceeds maximum length of 70 characters');
    });

    it('should reject field length violations on header and item', () => {
        const payloadLongFields = {
            header: {
                ...validPayload.header,
                CompanyCode: '10101', // max 4
                PurchasingGroup: '0001' // max 3
            },
            items: [
                {
                    ...validPayload.items[0],
                    Plant: '1010A', // max 4
                    StorageLocation: '101AB', // max 4
                    TaxCode: 'TAX' // max 2
                }
            ]
        };
        const result = validateCreatePurchaseOrderPayload(payloadLongFields);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field.includes('CompanyCode'))).toBe(true);
        expect(result.errors.some(e => e.field.includes('PurchasingGroup'))).toBe(true);
        expect(result.errors.some(e => e.field.includes('Plant'))).toBe(true);
        expect(result.errors.some(e => e.field.includes('TaxCode'))).toBe(true);
    });

    it('should reject empty or missing items array', () => {
        const emptyItems = {
            header: validPayload.header,
            items: []
        };
        const result = validateCreatePurchaseOrderPayload(emptyItems);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('At least one item is required');
    });

    it('should reject item with missing required fields', () => {
        const payload = {
            header: validPayload.header,
            items: [
                {
                    PurchaseOrderItem: '10',
                    Material: '', // Missing
                    Plant: '1010',
                    StorageLocation: '', // Missing
                    OrderQuantity: '10',
                    UnitOfMeasure: 'PC'
                }
            ]
        };

        const result = validateCreatePurchaseOrderPayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.message.includes('Material'))).toBe(true);
        expect(result.errors.some(e => e.message.includes('StorageLocation'))).toBe(true);
    });

    it('should reject invalid item quantities and prices', () => {
        const payload = {
            header: validPayload.header,
            items: [
                {
                    PurchaseOrderItem: '10',
                    Material: 'TG11',
                    Plant: '1010',
                    StorageLocation: '101A',
                    OrderQuantity: '-5',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '-10.00'
                }
            ]
        };

        const result = validateCreatePurchaseOrderPayload(payload);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('OrderQuantity must be a positive number greater than 0');
        expect(result.message).toContain('NetPriceAmount must be a non-negative number');
    });

    describe('rules the schema defines for both layers (purchaseOrderRules.json: "across CAP backend and SAPUI5 frontend")', () => {
        const zdomPayload = (headerChanges, itemChanges) => ({
            header: {
                PurchaseOrderType: 'ZDOM',
                CompanyCode: '1000',
                PurchasingOrganization: 'AE01',
                PurchasingGroup: '101',
                Supplier: '100102',
                Currency: 'INR',
                DocumentDate: '2026-09-24',
                ...headerChanges
            },
            items: [{
                PurchaseOrderItem: '10',
                Material: 'MAT101',
                Plant: '1000',
                StorageLocation: '100A',
                OrderQuantity: '10',
                UnitOfMeasure: 'PC',
                PurchaseOrderItemCategory: '0',
                AccountAssignmentCategory: '',
                ...itemChanges
            }]
        });

        it('should accept a ZDOM payload whose plant starts with the allowed prefix 1', () => {
            expect(validateCreatePurchaseOrderPayload(zdomPayload()).isValid).toBe(true);
        });

        // Known defect: srv/mm/purchase-order/validation/purchaseOrder.validation.js:101-116 never applies header.PurchaseOrderType.prefix "Z" from config/schema/purchaseOrderRules.json; only the UI rejects non-Z types (PurchaseOrderValidator.js:115-118).
        it.failing('should reject a document type without the Z prefix', () => {
            const result = validateCreatePurchaseOrderPayload(zdomPayload({ PurchaseOrderType: 'NB' }));
            expect(result.errors.map(e => e.field)).toContain('header.PurchaseOrderType');
        });

        // Known defect: srv/mm/purchase-order/validation/purchaseOrder.validation.js:195-213 never applies poTypes.*.allowedPlantPrefix from config/schema/purchaseOrderRules.json; only the UI does (PurchaseOrderValidator.js:216-218).
        it.failing('should reject a ZDOM plant outside the allowed prefix 1', () => {
            const result = validateCreatePurchaseOrderPayload(zdomPayload({}, { Plant: '2000' }));
            expect(result.errors.map(e => e.field)).toContain('items[0].Plant');
        });
    });

});
