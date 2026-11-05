const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const valueHelpsFixture = require('../../fixtures/purchase-order/valueHelps.json');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { GET } = cdsTest;

// Only the connections to the two remote S/4 services are doubled. Rows are the repo fixture or hand-written from the
// entity fields in srv/external, so these tests prove our value help handling, not what SAP returns.
describe('Integration: Value Helps through CAP to the remote S/4 services', () => {
    let fsQueries;
    let maintQueries;
    let fsRows;
    let maintRows;

    beforeEach(() => {
        fsQueries = [];
        maintQueries = [];
        fsRows = [];
        maintRows = [];
        purchaseOrderAdapter.s4hana = { run: async (query) => { fsQueries.push(query); return fsRows; } };
        purchaseOrderAdapter.s4hanaMaint = { run: async (query) => { maintQueries.push(query); return maintRows; } };
    });

    afterEach(() => {
        purchaseOrderAdapter.s4hana = null;
        purchaseOrderAdapter.s4hanaMaint = null;
    });

    it('should forward the DocumentTypeVH projection filter (category F) to the remote read', async () => {
        await GET('/odata/v4/purchase-order/DocumentTypeVH');

        expect(fsQueries[0].SELECT.where).toEqual([{ ref: ['PurchasingDocumentCategory'] }, '=', { val: 'F' }]);
    });

    it('should drop a document type of another category that the remote read returns', async () => {
        fsRows = [
            { PurchasingDocumentType: 'ZDOM', PurchasingDocumentCategory: 'F' },
            { PurchasingDocumentType: 'ZRFQ', PurchasingDocumentCategory: 'A' }
        ];

        const { data } = await GET('/odata/v4/purchase-order/DocumentTypeVH');

        expect(data.value.map(row => row.PurchasingDocumentType)).toEqual(['ZDOM']);
    });

    it('should read SupplierVH from the maintenance service, not the FS service', async () => {
        await GET('/odata/v4/purchase-order/SupplierVH');

        expect(maintQueries).toHaveLength(1);
        expect(fsQueries).toHaveLength(0);
    });

    it('should apply $top to the SupplierVH rows returned to the client', async () => {
        maintRows = valueHelpsFixture.SupplierVH; // 3 rows

        const { data } = await GET('/odata/v4/purchase-order/SupplierVH?$top=2');

        expect(data.value.map(row => row.Supplier)).toEqual(['10300001', '10300002']);
    });

    it('should fill Material_Text from MaterialName when the client selects Material_Text', async () => {
        maintRows = [{ Material: 'TG11', Plant: '1010', MaterialName: 'Trading Goods' }];

        const { data } = await GET('/odata/v4/purchase-order/MaterialVH?$select=Material,Plant,Material_Text');

        expect(data.value[0].Material_Text).toBe('Trading Goods');
    });

    it('should fill Material_Text from MaterialName when the client selects no columns', async () => {
        maintRows = [{ Material: 'TG11', Plant: '1010', MaterialName: 'Trading Goods' }];

        const { data } = await GET('/odata/v4/purchase-order/MaterialVH');

        expect(data.value[0].Material_Text).toBe('Trading Goods');
    });

    it('should fill MaterialName from Material_Text when SAP filled only the alias', async () => {
        maintRows = [{ Material: 'TG11', Plant: '1010', Material_Text: 'Trading Goods' }];

        const { data } = await GET('/odata/v4/purchase-order/MaterialVH');

        expect(data.value[0].MaterialName).toBe('Trading Goods');
    });

    it('should not add the alias when the client selected other columns', async () => {
        maintRows = [{ Material: 'TG11', Plant: '1010', MaterialName: 'Trading Goods' }];

        const { data } = await GET('/odata/v4/purchase-order/MaterialVH?$select=Material,Plant,MaterialName');

        expect(data.value[0].Material_Text).toBeUndefined();
    });

    it('should not overwrite a value SAP sent under both names', async () => {
        maintRows = [{ Material: 'TG11', Plant: '1010', MaterialName: 'Name', Material_Text: 'Text' }];

        const { data } = await GET('/odata/v4/purchase-order/MaterialVH');

        expect(data.value[0]).toMatchObject({ MaterialName: 'Name', Material_Text: 'Text' });
    });

    it('should remove duplicate currencies from CurrencyVH', async () => {
        fsRows = [{ Currency: 'EUR' }, { Currency: 'EUR' }, { Currency: 'USD' }];

        const { data } = await GET('/odata/v4/purchase-order/CurrencyVH');

        expect(data.value.map(row => row.Currency)).toEqual(['EUR', 'USD']);
    });

    it('should answer 502 with the reader message when the remote read fails', async () => {
        purchaseOrderAdapter.s4hanaMaint = { run: async () => { throw new Error('remote read failed'); } };

        await expect(GET('/odata/v4/purchase-order/SupplierVH')).rejects.toMatchObject({
            response: { status: 502, data: { error: { message: 'remote read failed' } } }
        });
    });
});
