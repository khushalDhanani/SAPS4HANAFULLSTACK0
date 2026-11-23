const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { GET } = cdsTest;

// Only the connection to the remote S/4 service is doubled. Field names are from srv/mm/purchase-order/service.cds;
// the values are hand-written, so this does not prove what SAP returns.
describe('Integration: PurchaseOrders read through CAP to the remote S/4 service', () => {
    const rows = [
        { PurchaseOrder: '4500001001', CompanyCode: '1000', Supplier: '100102', DocumentCurrency: 'INR', PurchaseOrderNetAmount: 250 },
        { PurchaseOrder: '4500001002', CompanyCode: '2000', Supplier: '100103', DocumentCurrency: 'USD', PurchaseOrderNetAmount: 1200 }
    ];
    let queries;

    const keyOf = (query) => (query.SELECT.from.ref[0].where || query.SELECT.where).find(part => part.val !== undefined).val;

    beforeEach(() => {
        queries = [];
        purchaseOrderAdapter.s4hana = {
            run: async (query) => {
                queries.push(query);
                return query.SELECT.one ? (rows.find(row => row.PurchaseOrder === keyOf(query)) || null) : rows;
            }
        };
    });

    afterEach(() => {
        purchaseOrderAdapter.s4hana = null;
    });

    it('should forward a collection read to the remote service as a PurchaseOrders query', async () => {
        await GET('/odata/v4/purchase-order/PurchaseOrders');

        expect(queries).toHaveLength(1);
        expect(queries[0].SELECT.from.ref[0]).toBe('PurchaseOrderService.PurchaseOrders');
    });

    it('should return the remote rows in the OData value array', async () => {
        const { status, data } = await GET('/odata/v4/purchase-order/PurchaseOrders');

        expect(status).toBe(200);
        expect(data.value.map(po => [po.PurchaseOrder, po.PurchaseOrderNetAmount])).toEqual([['4500001001', 250], ['4500001002', 1200]]);
    });

    it('should forward the requested key to the remote service and return that purchase order', async () => {
        const { status, data } = await GET("/odata/v4/purchase-order/PurchaseOrders('4500001002')");

        expect(status).toBe(200);
        expect(keyOf(queries[0])).toBe('4500001002');
        expect(data.Supplier).toBe('100103');
    });

    it('should answer 404 when the remote service has no purchase order for the key', async () => {
        await expect(GET("/odata/v4/purchase-order/PurchaseOrders('9999999999')")).rejects.toMatchObject({ response: { status: 404 } });
    });
});
