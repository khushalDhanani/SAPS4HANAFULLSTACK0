let DemoRackController;
let WorklistController;
const fs = require("fs");
const path = require("path");
const demoView = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/view/HuStockTransferRackDemo.view.xml"), "utf8");
const i18n = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/i18n/i18n.properties"), "utf8");
const parseRackBinName = require("../../../srv/integration/s4hana/wm/parseRackBinName");
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

    test("demo fixture shows one rack row of five positions, occupied ones holding synthetic DEMO-HU numbers", () => {
        const positions = controller.model.getProperty("/positions");
        expect(positions.map((pos) => [pos.position, pos.status, pos.unitNumber])).toEqual([
            ["01", "occupied", "DEMO-HU-001"],
            ["02", "empty", ""],
            ["03", "occupied", "DEMO-HU-002"],
            ["04", "empty", ""],
            ["05", "occupied", "DEMO-HU-003"]
        ]);
    });

    test("every demo position agrees with the server bin parser used by rackLayout", () => {
        controller.model.getProperty("/positions").forEach((pos) => {
            expect(parseRackBinName(pos.storageBin)).toEqual({ Floor: pos.floor, Rack: pos.rack, Position: pos.position, IsRackBin: true });
        });
    });

    test("demo non-rack list holds one synthetic unit on a bin the server parser rejects as a rack bin", () => {
        const nonRack = controller.model.getProperty("/nonRackBins");
        expect(nonRack.map((bin) => bin.unitNumber)).toEqual(["DEMO-HU-004"]);
        expect(parseRackBinName(nonRack[0].storageBin).IsRackBin).toBe(false);
    });

    test("demo notice strip text resolves to an i18n entry that says the data is synthetic", () => {
        // Cross-file rule: the view binds the strip to a key, and that key must exist with demo wording. Display needs a browser check.
        const key = /id="demoNoticeStrip"\s+text="\{i18n>(\w+)\}"/.exec(demoView)[1];
        const entry = i18n.split("\n").find((line) => line.startsWith(`${key}=`));
        expect(entry).toMatch(/^demoRackNotice=DEMO MODE .* Synthetic/);
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
    test("manifest has no unused wmGoodsIssue311 alias", () => {
        const routes = manifest["sap.ui5"].routing.routes;
        const goodsIssue311Route = routes.find((r) => r.name === "wmGoodsIssue311");
        expect(goodsIssue311Route).toBeUndefined();
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
