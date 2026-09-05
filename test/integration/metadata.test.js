const cds = require('@sap/cds');
const { GET } = cds.test(__dirname + '/../../');

describe('Integration: Metadata', () => {

    it('should query the service $metadata and return valid OData V4 EDMX', async () => {
        const response = await GET('/odata/v4/purchase-order/$metadata');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('xml');

        const metadataXml = response.data;
        expect(typeof metadataXml).toBe('string');
        expect(metadataXml).toContain('<edmx:Edmx');
        expect(metadataXml).toContain('EntitySet Name="PurchaseOrders"');
        expect(metadataXml).toContain('EntitySet Name="SupplierVH"');
        expect(metadataXml).toContain('EntitySet Name="MaterialVH"');
        expect(metadataXml).toContain('EntitySet Name="DocumentTypeVH"');
        expect(metadataXml).toContain('Action Name="createPurchaseOrder"');
    });

});
