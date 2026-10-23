let ControllerClass;

class MockJSONModel {
    constructor(data) {
        this.data = data || {};
    }
    setProperty(path, value) {
        const keys = path.replace(/^\//, "").split("/");
        let target = this.data;
        while (keys.length > 1) {
            const key = keys.shift();
            target[key] = target[key] || {};
            target = target[key];
        }
        target[keys[0]] = value;
    }
    getProperty(path) {
        return path.replace(/^\//, "").split("/").reduce((value, key) => value && value[key], this.data);
    }
}

const MockBaseController = {
    extend: (name, proto) => {
        function Controller() {}
        Controller.prototype = proto;
        return Controller;
    }
};
const MockODataClient = {
    get: jest.fn(() => Promise.resolve({ value: [] }))
};
const MockMessageToast = { show: jest.fn() };

beforeAll(() => {
    global.sap = {
        ui: {
            define: (deps, factory) => {
                ControllerClass = factory(MockBaseController, MockJSONModel, MockODataClient, MockMessageToast);
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferRack.controller");
});

describe("HU stock transfer bin selector", () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();
        controller.setModel = jest.fn((model, name) => { controller.model = model; });
        controller.getRouter = jest.fn(() => ({ getRoute: () => ({ attachPatternMatched: jest.fn() }) }));
        controller.getText = (key, args, fallback) => fallback;
        controller.getOwnerComponent = jest.fn(() => ({
            getModel: jest.fn(() => null),
            setModel: jest.fn()
        }));
        controller.onNavBackToCockpit = jest.fn();
        controller.onInit();
    });

    test("loads only SAP-returned bins and does not request synthesized rack data", async () => {
        const rows = [{ UnitNumber: "2001", UnitCategory: "HU", StorageBin: "A-01" }];
        MockODataClient.get.mockResolvedValueOnce({ value: rows });

        await controller.loadBins("10042", "1");

        expect(MockODataClient.get.mock.calls[0][0]).toContain("getStorageBins(");
        expect(MockODataClient.get.mock.calls[0][0]).not.toContain("getVisualRack");
        expect(controller.model.getProperty("/bins")).toEqual(rows);
        expect(controller.model.getProperty("/filteredBins")).toEqual(rows);
        expect(controller.model.getProperty("/error")).toBe("");
    });

    test("keeps failed reads visible and clears busy state", async () => {
        MockODataClient.get.mockRejectedValueOnce(new Error("read failed"));

        await controller.loadBins("10042", "1");

        expect(controller.model.getProperty("/error")).toMatch(/Could not load stock bins/);
        expect(controller.model.getProperty("/busy")).toBe(false);
        expect(controller.model.getProperty("/bins")).toEqual([]);
    });

    test("filters by unit or bin values", () => {
        controller.model.setProperty("/bins", [
            { UnitNumber: "HU-100", UnitCategory: "HU", StorageBin: "A-01" },
            { UnitNumber: "SU-200", UnitCategory: "SU", StorageBin: "B-02" }
        ]);

        controller.onSearchBins({ getParameter: () => "b-02" });

        expect(controller.model.getProperty("/filteredBins")).toHaveLength(1);
        expect(controller.model.getProperty("/filteredBins")[0].UnitNumber).toBe("SU-200");
    });

    test("hands selectable stock rows back to the cockpit and refuses rows without a unit identity", () => {
        controller._oViewModel = controller.model;
        const oSharedModel = { setProperty: jest.fn() };
        controller.getOwnerComponent = jest.fn(() => ({
            getModel: jest.fn(() => oSharedModel),
            setModel: jest.fn()
        }));

        const eventFor = (row) => ({ getSource: () => ({ getBindingContext: () => ({ getObject: () => row }) }) });
        controller.onSelectBinUnit(eventFor({ UnitNumber: "HU-100", UnitCategory: "HU" }));
        expect(oSharedModel.setProperty).toHaveBeenCalledWith("/preselectedUnit", "HU-100");
        expect(controller.onNavBackToCockpit).toHaveBeenCalledTimes(1);

        controller.onSelectBinUnit(eventFor({ UnitNumber: "A-01", UnitCategory: "BIN" }));
        expect(oSharedModel.setProperty).toHaveBeenCalledWith("/preselectedUnit", "A-01");
        expect(controller.onNavBackToCockpit).toHaveBeenCalledTimes(2);

        controller.onSelectBinUnit(eventFor({ UnitNumber: "", UnitCategory: "BIN" }));
        expect(oSharedModel.setProperty).toHaveBeenCalledTimes(2);
        expect(MockMessageToast.show).toHaveBeenCalled();
    });
});
