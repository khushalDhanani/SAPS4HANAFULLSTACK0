const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const valueHelpsFixture = require('../../fixtures/purchase-order/valueHelps.json');
const purchaseOrdersFixture = require('../../fixtures/purchase-order/purchaseOrders.json');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { POST, GET } = cdsTest;

describe('Integration (mocked SAP): Create Purchase Order flow through CAP', () => {

    let readFsSpy;
    let readMaintSpy;
    let createPOSpy;

    beforeAll(() => {
        readFsSpy = jest.spyOn(purchaseOrderAdapter, 'readFsData').mockImplementation(async (query) => {
            const rawEntity = query?.SELECT?.from?.ref?.[0];
            const entityName = typeof rawEntity === 'string' ? rawEntity.split('.').pop() : (rawEntity?.id || '').split('.').pop();

            if (entityName === 'PurchaseOrders') {
                return purchaseOrdersFixture;
            }
            if (entityName === 'DocumentTypeVH') return valueHelpsFixture.DocumentTypeVH;
            if (entityName === 'CurrencyVH') return valueHelpsFixture.CurrencyVH;
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

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockResolvedValue({
            PurchaseOrder: '4500001001',
            IsActiveEntity: true
        });
    });

    afterAll(() => {
        readFsSpy?.mockRestore();
        readMaintSpy?.mockRestore();
        createPOSpy?.mockRestore();
    });

    // The request the Create PO screen would build; the supplier and material come from the value helps below.
    const uiModel = {
        header: {
            PurchaseOrderType: 'NB',
            CompanyCode: '1010',
            PurchasingOrganization: '1010',
            PurchasingGroup: '001',
            Supplier: '',
            DocumentDate: new Date().toISOString().split('T')[0],
            Currency: 'EUR',
            IncotermsClassification: 'EXW',
            IncotermsLocation1: 'MUMBAI',
            PaymentTerms: '0001'
        },
        items: [
            {
                PurchaseOrderItem: '10',
                PurchaseOrderItemCategory: '0',
                AccountAssignmentCategory: '',
                Material: '',
                MaterialGroup: '',
                Plant: '1010',
                StorageLocation: '101A',
                OrderQuantity: '10',
                UnitOfMeasure: 'PC',
                NetPriceAmount: '25.00',
                TaxCode: 'V1',
                NetAmount: '250.00',
                NetAmountIsEstimate: true
            }
        ]
    };

    it('Step 1: search Supplier - query SupplierVH and select supplier', async () => {
        // Mirrors Fiori SelectDialog search on /SupplierVH
        const { status, data } = await GET('/odata/v4/purchase-order/SupplierVH?$top=5');
        expect(status).toBe(200);
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value.length).toBeGreaterThan(0);

        const selectedSupplier = data.value.find(s => s.Supplier === '10300001');
        expect(selectedSupplier).toBeDefined();

        // User selects supplier into header
        uiModel.header.Supplier = selectedSupplier.Supplier;
        expect(uiModel.header.Supplier).toBe('10300001');
    });

    it('Step 2: search Material - query MaterialVH and select material', async () => {
        // Mirrors Fiori SelectDialog search on /MaterialVH
        const { status, data } = await GET('/odata/v4/purchase-order/MaterialVH?$top=5');
        expect(status).toBe(200);
        expect(Array.isArray(data.value)).toBe(true);
        expect(data.value.length).toBeGreaterThan(0);

        const selectedMaterial = data.value.find(m => m.Material === 'TG11');
        expect(selectedMaterial).toBeDefined();

        // User selects material into item
        uiModel.items[0].Material = selectedMaterial.Material;
        expect(uiModel.items[0].Material).toBe('TG11');
    });

    it('Step 3: submit - dispatch createPurchaseOrder action to CAP backend and assert success', async () => {
        // Mirrors CreatePurchaseOrder.controller.js onCreatePress cleaning UI-only fields
        const cleanItems = uiModel.items.map(item => {
            const clean = { ...item };
            delete clean.errors;
            delete clean.NetAmountIsEstimate;
            return clean;
        });

        const payload = {
            header: uiModel.header,
            items: cleanItems
        };

        const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', payload);

        expect(status).toBe(200);
        expect(data).toHaveProperty('value', '4500001001');
    });

    it('Step 4: verify created PO - retrieve purchase order via /PurchaseOrders endpoint', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/PurchaseOrders');

        expect(status).toBe(200);
        expect(data).toHaveProperty('value');
        expect(Array.isArray(data.value)).toBe(true);

        const createdPO = data.value.find(po => po.PurchaseOrder === '4500001001');
        expect(createdPO).toBeDefined();
        expect(createdPO.CompanyCode).toBe('1010');
        expect(createdPO.Supplier).toBe('10300001');
        expect(createdPO.GrossAmount).toBe('250.00');
    });

});
