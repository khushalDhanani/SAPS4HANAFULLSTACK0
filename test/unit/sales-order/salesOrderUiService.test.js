/**
 * Unit Tests for the Fiori SalesOrderService (app/.../sales-order/service/SalesOrderService.js)
 */

let SalesOrderService;
const mockODataClient = { post: jest.fn(), get: jest.fn() };

function MockFilter(path, operator, value1) {
    this.sPath = path;
    this.sOperator = operator;
    this.oValue1 = value1;
}
const MockFilterOperator = { EQ: "EQ", Contains: "Contains" };

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                SalesOrderService = factory(mockODataClient, MockFilter, MockFilterOperator);
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/sd/sales-order/service/SalesOrderService");
});

describe("Fiori SalesOrderService", () => {
    beforeEach(() => jest.clearAllMocks());

    test("getMaterialDetails reads one row through the V4 list binding without passing $top as a binding parameter", async () => {
        const oContext = { getObject: () => ({ Material: "4000000001", MaterialName: "X-265", MaterialBaseUnit: "KG" }) };
        const oBinding = { requestContexts: jest.fn().mockResolvedValue([oContext]) };
        const oModel = { bindList: jest.fn().mockReturnValue(oBinding) };

        const oMaterial = await SalesOrderService.getMaterialDetails(oModel, " 4000000001 ");

        expect(oMaterial).toEqual({ Material: "4000000001", MaterialName: "X-265", MaterialBaseUnit: "KG" });
        const [sPath, , , aFilters, mParameters] = oModel.bindList.mock.calls[0];
        expect(sPath).toBe("/MaterialVH");
        expect(aFilters).toHaveLength(1);
        expect(aFilters[0].sPath).toBe("Material");
        expect(aFilters[0].oValue1).toBe("4000000001");
        expect(mParameters).toBeUndefined();
        expect(oBinding.requestContexts).toHaveBeenCalledWith(0, 1);
    });

    test("getMaterialDetails resolves null when nothing matches or the model is missing", async () => {
        const oBinding = { requestContexts: jest.fn().mockResolvedValue([]) };
        const oModel = { bindList: jest.fn().mockReturnValue(oBinding) };
        expect(await SalesOrderService.getMaterialDetails(oModel, "NOPE")).toBeNull();
        expect(await SalesOrderService.getMaterialDetails(oModel, "")).toBeNull();
    });

    test("_sanitizePayload keeps only the CAP OrderHeader / OrderItem fields (no incoterms, no UI state)", () => {
        const clean = SalesOrderService._sanitizePayload({
            header: {
                SalesOrderType: "ZDOM", SoldToParty: "10135", PaymentTerms: "0001", PaymentTermCode: "0001", ContactPerson: "25363",
                IncotermsClassification: "FOB", IncotermsLocation1: "Mumbai", StatusText: "Ready", CustomerCity: "Hyderabad"
            },
            items: [{ Material: "4000000001", OrderQuantity: 5, OrderQuantityUnit: "KG", Plant: "1120", errors: {} }]
        });
        expect(Object.keys(clean.header).sort()).toEqual(["ContactPerson", "PaymentTermCode", "PaymentTerms", "SalesOrderType", "SoldToParty"]);
        expect(clean.items[0]).toEqual({ Material: "4000000001", OrderQuantity: 5, OrderQuantityUnit: "KG", Plant: "1120" });
    });

    test("createSalesOrder posts the sanitized payload to the CAP action and returns the document number", async () => {
        mockODataClient.post.mockResolvedValue({ value: "5000501" });
        const sId = await SalesOrderService.createSalesOrder({ header: { SalesOrderType: "ZDOM", Foo: "x" }, items: [] });
        expect(sId).toBe("5000501");
        expect(mockODataClient.post).toHaveBeenCalledWith("/odata/v4/sales-order/createSalesOrder", { header: { SalesOrderType: "ZDOM" }, items: [] });
    });
});
