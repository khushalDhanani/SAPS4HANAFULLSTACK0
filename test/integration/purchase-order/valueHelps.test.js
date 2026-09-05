const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const valueHelpsFixture = require('../../fixtures/purchase-order/valueHelps.json');
const { GET } = cds.test(__dirname + '/../../../');

describe('Integration: Value Helps', () => {

    let readFsSpy;
    let readMaintSpy;

    beforeAll(() => {
        readFsSpy = jest.spyOn(purchaseOrderAdapter, 'readFsData').mockImplementation(async (query) => {
            const rawEntity = query?.SELECT?.from?.ref?.[0];
            const entityName = typeof rawEntity === 'string' ? rawEntity.split('.').pop() : (rawEntity?.id || '').split('.').pop();

            if (entityName === 'DocumentTypeVH') return valueHelpsFixture.DocumentTypeVH;
            if (entityName === 'CurrencyVH') return valueHelpsFixture.CurrencyVH;
            if (entityName === 'UnitOfMeasureVH') return valueHelpsFixture.UnitOfMeasureVH;
            return [];
        });

        readMaintSpy = jest.spyOn(purchaseOrderAdapter, 'readMaintData').mockImplementation(async (query) => {
            const rawEntity = query?.SELECT?.from?.ref?.[0];
            const entityName = typeof rawEntity === 'string' ? rawEntity.split('.').pop() : (rawEntity?.id || '').split('.').pop();

            if (entityName === 'SupplierVH') return valueHelpsFixture.SupplierVH;
            if (entityName === 'MaterialVH') return valueHelpsFixture.MaterialVH;
            if (entityName === 'CompanyCodeVH') return valueHelpsFixture.CompanyCodeVH;
            if (entityName === 'PurchasingOrgVH') return valueHelpsFixture.PurchasingOrgVH;
            if (entityName === 'PurchasingGroupVH') return valueHelpsFixture.PurchasingGroupVH;
            if (entityName === 'PlantVH') return valueHelpsFixture.PlantVH;
            if (entityName === 'StorageLocationVH') return valueHelpsFixture.StorageLocationVH;
            return [];
        });
    });

    afterAll(() => {
        readFsSpy?.mockRestore();
        readMaintSpy?.mockRestore();
    });

    it('should query DocumentTypeVH value help entity and return valid records', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/DocumentTypeVH?$top=2');

        expect(status).toBe(200);
        expect(data).toHaveProperty('value');
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value.length).toBeGreaterThan(0);
        expect(data.value[0]).toHaveProperty('PurchasingDocumentType', 'NB');
    });

    it('should query SupplierVH value help entity and return valid supplier records', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/SupplierVH?$top=2');

        expect(status).toBe(200);
        expect(data).toHaveProperty('value');
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value.length).toBeGreaterThan(0);
        expect(data.value[0]).toHaveProperty('Supplier', '10300001');
    });

    it('should query MaterialVH value help entity and return valid material records', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/MaterialVH?$top=2');

        expect(status).toBe(200);
        expect(data).toHaveProperty('value');
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value.length).toBeGreaterThan(0);
        expect(data.value[0]).toHaveProperty('Material', 'TG11');
    });

    it('should query CurrencyVH and apply distinct deduplication', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/CurrencyVH?$top=2');

        expect(status).toBe(200);
        expect(data).toHaveProperty('value');
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value.length).toBe(2);
        expect(data.value[0]).toHaveProperty('Currency', 'EUR');
    });

});
