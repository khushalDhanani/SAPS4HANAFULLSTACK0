let WorklistController;
const fs = require("fs");
const path = require("path");
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
        }
    } } };
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferList.controller");
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
