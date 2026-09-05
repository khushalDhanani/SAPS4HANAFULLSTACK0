const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const purchaseOrdersFixture = require('../../fixtures/purchaseOrders.json');
const { GET } = cds.test(__dirname + '/../../../');

describe('Integration: S/4 Read', () => {

    let readFsSpy;

    beforeAll(() => {
        readFsSpy = jest.spyOn(purchaseOrderAdapter, 'readFsData').mockImplementation(async (query) => {
            const rawEntity = query?.SELECT?.from?.ref?.[0];
            const entityName = typeof rawEntity === 'string' ? rawEntity.split('.').pop() : (rawEntity?.id || '').split('.').pop();

            if (entityName === 'PurchaseOrders') {
                // If single entity query (by key)
                if (query?.SELECT?.one) {
                    return purchaseOrdersFixture[0];
                }
                return purchaseOrdersFixture;
            }
            return [];
        });
    });

    afterAll(() => {
        readFsSpy?.mockRestore();
    });

    it('should read purchase orders through CAP service using controlled mock adapter', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/PurchaseOrders');

        expect(status).toBe(200);
        expect(data).toHaveProperty('value');
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value).toHaveLength(2);

        const firstPO = data.value[0];
        expect(firstPO).toHaveProperty('PurchaseOrder', '4500001001');
        expect(firstPO).toHaveProperty('CompanyCode', '1010');
        expect(firstPO).toHaveProperty('Supplier', '10300001');
        expect(firstPO).toHaveProperty('DocumentCurrency', 'EUR');
    });

    it('should query a specific purchase order by key', async () => {
        const { status, data } = await GET("/odata/v4/purchase-order/PurchaseOrders('4500001001')");

        expect(status).toBe(200);
        expect(data).toHaveProperty('PurchaseOrder', '4500001001');
        expect(data).toHaveProperty('GrossAmount', '250.00');
    });

});
