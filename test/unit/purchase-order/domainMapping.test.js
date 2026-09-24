const { normalizePurchaseOrderData } = require('../../../srv/mm/purchase-order/mapping/purchaseOrder.mapper');
const validPayload = require('../../fixtures/purchase-order/validPOPayload.json');

describe('Unit: Domain Mapping (purchaseOrder.mapper)', () => {

    it('should normalize valid incoming PO data with default values', () => {
        const rawData = {
            header: {
                PurchaseOrderType: 'NB ',
                CompanyCode: ' 1010 ',
                PurchasingOrganization: '1010',
                PurchasingGroup: '001',
                Supplier: '10300001',
                Currency: 'eur'
            },
            items: [
                {
                    Material: ' TG11 ',
                    Plant: ' 1010 ',
                    OrderQuantity: '5',
                    UnitOfMeasure: 'pc',
                    NetPriceAmount: '20'
                }
            ]
        };

        const result = normalizePurchaseOrderData(rawData);

        expect(result.header.PurchaseOrderType).toBe('NB');
        expect(result.header.CompanyCode).toBe('1010');
        expect(result.header.Currency).toBe('EUR');
        expect(result.header.DocumentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        expect(result.items).toHaveLength(1);
        const item = result.items[0];
        expect(item.PurchaseOrderItem).toBe('10');
        expect(item.Material).toBe('TG11');
        expect(item.Plant).toBe('1010');
        expect(item.UnitOfMeasure).toBe('PC');
        expect(item.NetPriceAmount).toBe('20.00');
        expect(item.NetAmount).toBe('100.00'); // 5 * 20
        expect(item.RequisitionerName).toBe('SYSTEM');
    });

    it('should derive requisitioner name from authenticated user context', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '5',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '20'
                }
            ]
        };

        const result = normalizePurchaseOrderData(rawData, { user: 'AUTH_BUYER' });
        expect(result.items[0].RequisitionerName).toBe('AUTH_BUYER');
    });

    it('should preserve explicit custom item numbers and enforce authenticated requisitioner', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    PurchaseOrderItem: '00020',
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '2',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '15.50',
                    RequisitionerName: 'Buyer 2',
                    NetAmount: '31.00'
                }
            ]
        };

        const result = normalizePurchaseOrderData(rawData, { user: 'AUTH_BUYER' });
        expect(result.items[0].PurchaseOrderItem).toBe('00020');
        expect(result.items[0].RequisitionerName).toBe('AUTH_BUYER');
        expect(result.items[0].NetAmount).toBe('31.00');
    });

    it('should ignore client-supplied RequisitionerName and enforce authenticated user identity', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    PurchaseOrderItem: '10',
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '1',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '10.00',
                    RequisitionerName: 'ATTACKER_SPOOFED_USER'
                }
            ]
        };

        // When authenticated user is provided in context
        const result = normalizePurchaseOrderData(rawData, { user: 'LEGIT_USER' });
        expect(result.items[0].RequisitionerName).toBe('LEGIT_USER');

        // When context user is absent, falls back to SYSTEM, never trusting client-supplied value
        const resultSystem = normalizePurchaseOrderData(rawData);
        expect(resultSystem.items[0].RequisitionerName).toBe('SYSTEM');
    });

    it('should ignore client-supplied NetAmount and always calculate NetAmount from OrderQuantity * NetPriceAmount', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    PurchaseOrderItem: '10',
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '4',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '25.00',
                    NetAmount: '0.01' // Malicious or mismatched client value
                }
            ]
        };

        const result = normalizePurchaseOrderData(rawData);
        // Backend must own NetAmount calculation: 4 * 25.00 = 100.00, ignoring 0.01
        expect(result.items[0].NetAmount).toBe('100.00');
    });

    it('should throw an error if PurchaseOrderType (Document Type) is missing or empty', () => {
        const rawData = {
            header: {
                PurchaseOrderType: '',
                CompanyCode: '1010',
                PurchasingOrganization: '1010',
                PurchasingGroup: '001',
                Supplier: '10300001',
                Currency: 'EUR'
            },
            items: [
                {
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '5',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '20'
                }
            ]
        };
        expect(() => normalizePurchaseOrderData(rawData)).toThrow(/PurchaseOrderType .*is required/i);
    });

    it('should throw an error if an item is missing UnitOfMeasure', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '5',
                    NetPriceAmount: '20'
                }
            ]
        };
        expect(() => normalizePurchaseOrderData(rawData)).toThrow(/UnitOfMeasure is required for item 10/);
    });

    it('should throw an error if an item is missing OrderQuantity', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    Material: 'TG11',
                    Plant: '1010',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '20'
                }
            ]
        };
        expect(() => normalizePurchaseOrderData(rawData)).toThrow(/OrderQuantity is required for item 10/);
    });

    it('should throw an error if an item has invalid OrderQuantity', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '0',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '20'
                }
            ]
        };
        expect(() => normalizePurchaseOrderData(rawData)).toThrow(/OrderQuantity must be greater than 0 for item 10/);
    });

    it('should return input as-is when input is falsy or invalid', () => {
        expect(normalizePurchaseOrderData(null)).toBeNull();
        expect(normalizePurchaseOrderData(undefined)).toBeUndefined();
        expect(normalizePurchaseOrderData({})).toEqual({});
    });

});
