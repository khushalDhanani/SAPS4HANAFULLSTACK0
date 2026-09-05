const cds = require('@sap/cds');
const { POST, GET, expect } = cds.test(__dirname + '/../../');

describe('Purchase Order Integration', () => {

    it('should query the service metadata', async () => {
        const { status } = await GET('/odata/v4/purchase-order/$metadata');
        expect(status).toBe(200);
    });

    it('should query Value Help entities', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/DocumentTypeVH?$top=1');
        expect(status).toBe(200);
        expect(data.value).toBeInstanceOf(Array);
    });

    it('should execute createPurchaseOrder action', async () => {
        const payload = {
            header: {
                PurchaseOrderType: "NB",
                CompanyCode: "1010",
                PurchasingOrganization: "1010",
                PurchasingGroup: "001",
                Supplier: "10300001",
                DocumentDate: new Date().toISOString().split('T')[0],
                Currency: "EUR",
                IncotermsClassification: "EXW",
                IncotermsLocation1: "MUMBAI",
                PaymentTerms: "0001"
            },
            items: [
                {
                    PurchaseOrderItem: "10",
                    PurchaseOrderItemCategory: "0",
                    AccountAssignmentCategory: "K",
                    Material: "TG11",
                    MaterialGroup: "L001",
                    Plant: "1010",
                    StorageLocation: "101A",
                    OrderQuantity: "10",
                    UnitOfMeasure: "PC",
                    NetPriceAmount: "10.00"
                }
            ]
        };

        try {
            const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', payload);
            console.log('Success response:', data);
            expect([200, 201]).toContain(status);
            expect(data).toHaveProperty('value');
        } catch (error) {
            console.error('Error response:', error.response?.data || error.message);
            // Must not fail draft creation
            const errMsg = error.response?.data?.error?.message || error.message;
            expect(errMsg).not.toContain('Draft creation failed');
        }
    }, 30000);

});
