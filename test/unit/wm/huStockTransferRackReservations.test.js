let ReservationController;
let WorklistController;
const fs = require("fs");
const path = require("path");
const view = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/view/HuStockTransferRackDemo.view.xml"), "utf8");
const worklistView = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/view/HuStockTransferList.view.xml"), "utf8");
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
            if (deps.includes("sap/m/MessageBox")) {
                WorklistController = factory(MockBaseController, MockJSONModel, MockODataClient, MockToast, MockMessageBox);
            } else {
                ReservationController = factory(MockBaseController, MockJSONModel, MockODataClient, MockToast);
            }
        }
    } } };
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferRackDemo.controller");
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferList.controller");
});

describe("live rack reservation entry", () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ReservationController();
        controller.setModel = jest.fn((model) => { controller.model = model; });
        controller._mockRouter = { getRoute: () => ({ attachPatternMatched: jest.fn() }), navTo: jest.fn() };
        controller.getRouter = jest.fn(() => controller._mockRouter);
        MockODataClient.get.mockResolvedValue({ value: { TotalCount: 1, Items: [
            { ReservationNo: "0000042817", ReservationItem: "0001", Material: "MAT-01", MaterialDesc: "Bearing", OpenQty: 5, BaseUnit: "EA" },
            { ReservationNo: "0000042818", ReservationItem: "0002", Material: "MAT-02", MaterialDesc: "Seal", OpenQty: 2, BaseUnit: "EA" }
        ] } });
        controller.onInit();
    });

    test("loads actual open reservation items through the existing CAP read operation", async () => {
        await controller.loadReservations();

        expect(MockODataClient.get).toHaveBeenCalledWith(expect.stringContaining("/odata/v4/hu-stock-transfer/getOpenReservations("));
        expect(MockODataClient.get.mock.calls[0][0]).toContain("status='open'");
        expect(MockODataClient.get.mock.calls[0][0]).toContain("includeDeleted=false");
        expect(controller.model.getProperty("/reservations")).toHaveLength(2);
        expect(controller.model.getProperty("/filteredReservations")[0].ReservationNo).toBe("0000042817");
        expect(controller.model.getProperty("/busy")).toBe(false);
    });

    test("filters actual reservation items and hands the chosen reservation/item to the rack route", async () => {
        await controller.loadReservations();
        controller.onSearchReservations({ getParameter: () => "seal" });
        expect(controller.model.getProperty("/filteredReservations")).toHaveLength(1);
        expect(controller.model.getProperty("/filteredReservations")[0].ReservationNo).toBe("0000042818");

        const selected = controller.model.getProperty("/filteredReservations/0");
        controller.onReservationSelectionChange({ getParameter: () => ({ getBindingContext: () => ({ getObject: () => selected }) }) });
        controller.onOpenSelectedRack();
        expect(controller._mockRouter.navTo).toHaveBeenCalledWith("wmHuStockTransferRack", { reservation: "0000042818", item: "0002" });
    });

    test("opens a reservation directly from a row press", () => {
        const row = { ReservationNo: "0000042817", ReservationItem: "0001" };
        controller.onReservationPress({ getParameter: () => null, getSource: () => ({ getBindingContext: () => ({ getObject: () => row }) }) });
        expect(controller._mockRouter.navTo).toHaveBeenCalledWith("wmHuStockTransferRack", { reservation: "0000042817", item: "0001" });
    });

    test("keeps read errors visible and retry reloads reservations", async () => {
        MockODataClient.get.mockRejectedValueOnce(new Error("read failed"));
        await controller.loadReservations();
        expect(controller.model.getProperty("/error")).toContain("read failed");
        expect(controller.model.getProperty("/busy")).toBe(false);
        MockODataClient.get.mockResolvedValueOnce({ Items: [] });
        await controller.onRetry();
        expect(controller.model.getProperty("/error")).toBe("");
        expect(controller.model.getProperty("/reservations")).toEqual([]);
    });

    test("contains no demo fixture UI and routes to the existing reservation rack", () => {
        expect(view).toContain("path: 'rackReservation>/filteredReservations'");
        expect(view).toContain(".onOpenSelectedRack");
        expect(view).not.toMatch(/DEMO|fixture|rackDemo|selectedHu|Select HU/);
        expect(worklistView).toContain(".onOpenRackForSelected");
        expect(worklistView).not.toMatch(/Rack Visualizer Demo/);
        expect(manifest["sap.ui5"].routing.routes).toContainEqual(expect.objectContaining({
            name: "wmHuStockTransferRack",
            pattern: "wm/hu-stock-transfer/{reservation}/{item}/rack"
        }));
    });
});

describe("HU reservation worklist rack handoff", () => {
    test("opens the selected reservation item without invoking a posting action", () => {
        const controller = new WorklistController();
        const selected = { ReservationNo: "0000042817", ReservationItem: "0001" };
        const navTo = jest.fn();
        controller.getModel = jest.fn(() => ({ getProperty: () => selected }));
        controller.getRouter = jest.fn(() => ({ navTo }));
        controller.onOpenRackForSelected();
        expect(navTo).toHaveBeenCalledWith("wmHuStockTransferRack", { reservation: "0000042817", item: "0001" });
    });
});
