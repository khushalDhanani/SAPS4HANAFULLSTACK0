const { normalizePurchaseOrderData } = require('../../../srv/mm/purchase-order/mapping/purchaseOrder.mapper');
const validPayload = require('../../fixtures/validPOPayload.json');

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
                    NetPriceAmount: '20'
                }
            ]
        };

        const result = normalizePurchaseOrderData(rawData, { user: 'AUTH_BUYER' });
        expect(result.items[0].RequisitionerName).toBe('AUTH_BUYER');
    });

    it('should preserve explicit custom item numbers and requisitioner name', () => {
        const rawData = {
            header: validPayload.header,
            items: [
                {
                    PurchaseOrderItem: '00020',
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '2',
                    NetPriceAmount: '15.50',
                    RequisitionerName: 'Buyer 2',
                    NetAmount: '31.00'
                }
            ]
        };

        const result = normalizePurchaseOrderData(rawData);
        expect(result.items[0].PurchaseOrderItem).toBe('00020');
        expect(result.items[0].RequisitionerName).toBe('Buyer 2');
        expect(result.items[0].NetAmount).toBe('31.00');
    });

    it('should return input as-is when input is falsy or invalid', () => {
        expect(normalizePurchaseOrderData(null)).toBeNull();
        expect(normalizePurchaseOrderData(undefined)).toBeUndefined();
        expect(normalizePurchaseOrderData({})).toEqual({});
    });

});
