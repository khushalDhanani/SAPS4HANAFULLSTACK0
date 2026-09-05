const { validateCreatePurchaseOrderPayload } = require('../../srv/service/PurchaseOrderValidator');
const validPayload = require('../fixtures/validPOPayload.json');

describe('Unit: Validation', () => {

    it('should validate a complete valid PO payload successfully', () => {
        const result = validateCreatePurchaseOrderPayload(validPayload);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should reject non-object or null payload', () => {
        const nullResult = validateCreatePurchaseOrderPayload(null);
        expect(nullResult.isValid).toBe(false);
        expect(nullResult.errors).toContain('Request body must be a valid JSON object');

        const strResult = validateCreatePurchaseOrderPayload('not-an-object');
        expect(strResult.isValid).toBe(false);
    });

    it('should reject missing header object', () => {
        const result = validateCreatePurchaseOrderPayload({ items: validPayload.items });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Header is required');
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
        expect(result.errors.some(e => e.includes('PurchaseOrderType'))).toBe(true);
        expect(result.errors.some(e => e.includes('PurchasingOrganization'))).toBe(true);
        expect(result.errors.some(e => e.includes('Supplier'))).toBe(true);
    });

    it('should reject empty or missing items array', () => {
        const emptyItems = {
            header: validPayload.header,
            items: []
        };
        const result = validateCreatePurchaseOrderPayload(emptyItems);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('At least one item is required');
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
        expect(result.errors.some(e => e.includes('Material'))).toBe(true);
        expect(result.errors.some(e => e.includes('StorageLocation'))).toBe(true);
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
        expect(result.errors.some(e => e.includes('OrderQuantity must be greater than 0'))).toBe(true);
        expect(result.errors.some(e => e.includes('NetPriceAmount must be a non-negative number'))).toBe(true);
    });

});
