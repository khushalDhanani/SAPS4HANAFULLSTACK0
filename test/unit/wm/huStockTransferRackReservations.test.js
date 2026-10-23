let DemoRackController;
let WorklistController;
const fs = require("fs");
const path = require("path");
const demoView = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/view/HuStockTransferRackDemo.view.xml"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/manifest.json"), "utf8"));

class MockJSONModel {
    constructor(data) { this.data = data || {}; }
    setProperty(path, value) {
        const keys = path.replace(/^\//, "").split("/");
        let target = this.data;
        while (keys.length > 1) { const key = keys.shift(); target[key] = target[key] || {}; target = target[key]; }
        target[keys[0]] = value;
    }
    getProperty(path) { return path.replace(/^\//, "").split("/").reduce((value, key) => value && value[key], this.data); }
    setData(data) { this.data = data || {}; }
    getData() { return this.data; }
}

const MockBaseController = {
    extend: (_name, proto) => {
        function Controller() {}
        Controller.prototype = Object.assign({ getText: (_key, _args, fallback) => fallback }, proto);
        return Controller;
    }
};
const MockODataClient = { get: jest.fn() };
const MockToast = { show: jest.fn() };
const MockMessageBox = { error: jest.fn() };

beforeAll(() => {
    global.sap = { ui: { define: (deps, factory) => {
        if (deps.includes("saps4hana/fiori/service/ODataClient")) {
            WorklistController = factory(MockBaseController, MockJSONModel, MockODataClient, MockToast, MockMessageBox);
        } else if (deps.includes("sap/m/MessageToast")) {
            DemoRackController = factory(MockBaseController, MockJSONModel, MockToast);
        }
    } } };
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferRackDemo.controller");
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferList.controller");
});

describe("HuStockTransferRackDemo fixture shaped like rackLayout()", () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new DemoRackController();
        controller.setModel = jest.fn((model) => { controller.model = model; });
        controller._mockRouter = { getRoute: () => ({ attachPatternMatched: jest.fn() }), navTo: jest.fn() };
        controller.getRouter = jest.fn(() => controller._mockRouter);
        controller.onInit();
    });

    test("initializes with a fixture shaped like rackLayout() (single row of positions, floor/rack/position, no bays or levels)", () => {
        expect(controller.model.getProperty("/isDemo")).toBe(true);
        expect(controller.model.getProperty("/warehouse")).toBe("W01");
        expect(controller.model.getProperty("/floor")).toBe("1");
        expect(controller.model.getProperty("/rack")).toBe("L0001");

        const positions = controller.model.getProperty("/positions");
        expect(Array.isArray(positions)).toBe(true);
        expect(positions.length).toBe(5);

        // Verify single row of positions (floor/rack/position, no bays or levels)
        positions.forEach((pos) => {
            expect(pos.floor).toBe("1");
            expect(pos.rack).toBe("L0001");
            expect(pos.position).toMatch(/^\d{2}$/);
            expect(pos.storageBin).toBe(`1-L0001-${pos.position}`);
            expect(pos.isRackBin).toBe(true);
            // Must have no bay or level fields
            expect(pos.bay).toBeUndefined();
            expect(pos.level).toBeUndefined();

            // Two cell states only: 'empty' or 'occupied'
            expect(["empty", "occupied"]).toContain(pos.status);
            expect(pos.occupied).toBe(pos.status === "occupied");

            // Synthetic HU numbers only when occupied
            if (pos.occupied) {
                expect(pos.unitNumber).toMatch(/^DEMO-HU-\d{3}$/);
            } else {
                expect(pos.unitNumber).toBe("");
            }
        });
    });

    test("contains separate list for non-rack bins with synthetic numbers", () => {
        const nonRack = controller.model.getProperty("/nonRackBins");
        expect(Array.isArray(nonRack)).toBe(true);
        expect(nonRack.length).toBe(1);
        expect(nonRack[0].isRackBin).toBe(false);
        expect(nonRack[0].unitNumber).toMatch(/^DEMO-HU-\d{3}$/);
    });

    test("view is clearly labelled DEMO with synthetic banner and single row layout", () => {
        expect(demoView).toContain('id="demoNoticeStrip"');
        expect(demoView).toContain('{i18n>demoRackNotice}');
        expect(demoView).toContain('{i18n>demoRackNonRackPanel}');
    });

    test("toggles mode between rack and table", () => {
        expect(controller.model.getProperty("/mode")).toBe("rack");
        controller.onToggleMode();
        expect(controller.model.getProperty("/mode")).toBe("table");
        controller.onToggleMode();
        expect(controller.model.getProperty("/mode")).toBe("rack");
    });

    test("selecting a synthetic HU displays a toast and tracks selectedUnit", () => {
        const oEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getObject: () => ({ unitNumber: "DEMO-HU-001" })
                })
            })
        };
        controller.onSelectUnit(oEvent);
        expect(controller.model.getProperty("/selectedUnit")).toBe("DEMO-HU-001");
        expect(MockToast.show).toHaveBeenCalledWith(expect.stringContaining("DEMO-HU-001"));
    });

    test("navigates back to worklist", () => {
        controller.onNavBack();
        expect(controller._mockRouter.navTo).toHaveBeenCalledWith("wmHuStockTransfer");
    });
});

describe("Routing & Option A standard 311 check", () => {
    test("manifest contains wmReservationEntryDetail route and no unused wmGoodsIssue311 alias", () => {
        const routes = manifest["sap.ui5"].routing.routes;
        const goodsIssue311Route = routes.find((r) => r.name === "wmGoodsIssue311");
        expect(goodsIssue311Route).toBeUndefined();

        const resvEntryDetailRoute = routes.find((r) => r.name === "wmReservationEntryDetail");
        expect(resvEntryDetailRoute).toBeDefined();
        expect(resvEntryDetailRoute.target).toBe("TargetReservationEntryDetail");
    });

    test("HU reservation worklist rack handoff opens rack without posting", () => {
        const controller = new WorklistController();
        const selected = { ReservationNo: "0000042817", ReservationItem: "0001" };
        const navTo = jest.fn();
        controller.getModel = jest.fn(() => ({ getProperty: () => selected }));
        controller.getRouter = jest.fn(() => ({ navTo }));
        controller.onOpenRackForSelected();
        expect(navTo).toHaveBeenCalledWith("wmHuStockTransferRack", { reservation: "0000042817", item: "0001" });
    });
});
