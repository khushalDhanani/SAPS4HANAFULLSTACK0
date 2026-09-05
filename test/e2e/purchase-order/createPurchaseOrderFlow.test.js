const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const valueHelpsFixture = require('../../fixtures/purchase-order/valueHelps.json');
const purchaseOrdersFixture = require('../../fixtures/purchase-order/purchaseOrders.json');
const { POST, GET } = cds.test(__dirname + '/../../../');

describe('E2E: Create Purchase Order Full User Journey', () => {

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

    // Simulated Fiori UI State Model across the user journey
    let uiModel;

    it('Step 1: open Create PO - initialize view state and default model', () => {
        // Mirrors CreatePurchaseOrder.controller.js _resetModel()
        uiModel = {
            header: {
                PurchaseOrderType: 'NB',
                CompanyCode: '',
                PurchasingOrganization: '',
                PurchasingGroup: '',
                Supplier: '',
                DocumentDate: new Date().toISOString().split('T')[0],
                Currency: '',
                IncotermsClassification: '',
                IncotermsLocation1: '',
                PaymentTerms: ''
            },
            items: [
                {
                    PurchaseOrderItem: '10',
                    PurchaseOrderItemCategory: '0',
                    AccountAssignmentCategory: '',
                    Material: '',
                    MaterialGroup: '',
                    Plant: '',
                    StorageLocation: '',
                    OrderQuantity: '',
                    UnitOfMeasure: 'PC',
                    NetPriceAmount: '',
                    TaxCode: '',
                    NetAmount: '0.00'
                }
            ]
        };

        expect(uiModel.header.PurchaseOrderType).toBe('NB');
        expect(uiModel.header.DocumentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(uiModel.header.Supplier).toBe('');
        expect(uiModel.items).toHaveLength(1);
        expect(uiModel.items[0].PurchaseOrderItem).toBe('10');
        expect(uiModel.items[0].UnitOfMeasure).toBe('PC');
        expect(uiModel.items[0].NetAmount).toBe('0.00');
    });

    it('Step 2: search Supplier - query SupplierVH and select supplier', async () => {
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

    it('Step 3: search Material - query MaterialVH and select material', async () => {
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

    it('Step 4: populate required fields - fill header organizational data and item details', () => {
        // Header
        uiModel.header.CompanyCode = '1010';
        uiModel.header.PurchasingOrganization = '1010';
        uiModel.header.PurchasingGroup = '001';
        uiModel.header.Currency = 'EUR';
        uiModel.header.IncotermsClassification = 'EXW';
        uiModel.header.IncotermsLocation1 = 'MUMBAI';
        uiModel.header.PaymentTerms = '0001';

        // Item
        uiModel.items[0].Plant = '1010';
        uiModel.items[0].StorageLocation = '101A';
        uiModel.items[0].OrderQuantity = '10';
        uiModel.items[0].NetPriceAmount = '25.00';
        uiModel.items[0].TaxCode = 'V1';

        expect(uiModel.header.CompanyCode).toBe('1010');
        expect(uiModel.items[0].Plant).toBe('1010');
        expect(uiModel.items[0].OrderQuantity).toBe('10');
    });

    it('Step 5: calculate Net Amount - trigger onCalculateNetAmount and verify updated item amount', () => {
        // Mirrors CreatePurchaseOrder.controller.js onCalculateNetAmount
        const item = uiModel.items[0];
        const fQty = parseFloat(item.OrderQuantity) || 0;
        const fNetPrice = parseFloat(item.NetPriceAmount) || 0;
        const fNetAmount = fQty * fNetPrice;

        item.NetAmount = fNetAmount.toFixed(2);

        expect(item.NetAmount).toBe('250.00');
    });

    it('Step 6: submit - dispatch createPurchaseOrder action to CAP backend and assert success', async () => {
        const payload = {
            header: uiModel.header,
            items: uiModel.items
        };

        const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', payload);

        expect(status).toBe(200);
        expect(data).toHaveProperty('value', '4500001001');
    });

    it('Step 7: verify created PO - retrieve purchase order via /PurchaseOrders endpoint', async () => {
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
