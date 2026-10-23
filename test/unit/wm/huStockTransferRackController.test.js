let ControllerClass;
const fs = require("fs");
const path = require("path");
const rackView = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/view/HuStockTransferRack.view.xml"), "utf8");
const rackI18n = fs.readFileSync(path.join(__dirname, "../../../app/fiori-app/webapp/i18n/i18n.properties"), "utf8");

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
        controller.setModel = jest.fn((model, _name) => { controller.model = model; });
        controller.getRouter = jest.fn(() => ({ getRoute: () => ({ attachPatternMatched: jest.fn() }) }));
        controller.getText = (key, args, fallback) => fallback;
        controller.getOwnerComponent = jest.fn(() => ({
            getModel: jest.fn(() => null),
            setModel: jest.fn()
        }));
        controller.onNavBackToCockpit = jest.fn();
        controller.onInit();
    });

    test("loads SAP bins and builds rack groups only from strict rack-name matches", async () => {
        const rows = [
            { Warehouse: "W01", UnitNumber: "2001", UnitCategory: "HU", StorageBin: "2-L0002-04", Floor: "2", Rack: "L0002", Position: "04", IsRackBin: true, SectionCode: "S2", SectionName: "Ambient", BinMasterFound: true },
            { Warehouse: "W01", UnitNumber: "2002", UnitCategory: "SU", StorageBin: "1-L0001-02", Floor: "1", Rack: "L0001", Position: "02", IsRackBin: true, SectionCode: "S1", SectionName: "Chilled", BinMasterFound: true },
            { Warehouse: "W01", UnitNumber: "2003", UnitCategory: "HU", StorageBin: "1-L0001-10", Floor: "1", Rack: "L0001", Position: "10", IsRackBin: true, SectionCode: "", SectionName: "", BinMasterFound: true },
            { Warehouse: "W01", UnitNumber: "HU-3", UnitCategory: "HU", StorageBin: "WE-ZONE", Floor: "", Rack: "", Position: "", IsRackBin: false }
        ];
        MockODataClient.get.mockResolvedValueOnce({ value: rows });

        await controller.loadBins("10042", "1");

        expect(MockODataClient.get.mock.calls[0][0]).toContain("rackLayout(");
        expect(MockODataClient.get.mock.calls[0][0]).not.toContain("getVisualRack");
        expect(controller.model.getProperty("/bins").map((bin) => bin.SectionColorSlot)).toEqual([2, 1, 0, 0]);
        expect(controller.model.getProperty("/filteredBins")).toHaveLength(4);
        expect(controller.model.getProperty("/warehouses")).toEqual([{ key: "W01", text: "W01" }]);
        expect(controller.model.getProperty("/floors")).toEqual([{ key: "1", text: "1" }, { key: "2", text: "2" }]);
        expect(controller.model.getProperty("/racks")).toEqual([{ key: "L0001", text: "L0001" }]);
        expect(controller.model.getProperty("/positions").map((p) => p.position)).toEqual(["02", "10"]);
        expect(controller.model.getProperty("/positions")[0].sectionDisplay).toBe("Chilled");
        expect(controller.model.getProperty("/positions")[1].sectionDisplay).toBe("Section not maintained");
        expect(controller.model.getProperty("/selectedFloor")).toBe("1");
        expect(controller.model.getProperty("/selectedRack")).toBe("L0001");
        expect(controller.model.getProperty("/nonRackCount")).toBe(1);
        expect(controller.model.getProperty("/error")).toBe("");
    });

    test("Option A banner displays when T001L-XHUPF is blank and routes to standard 311", async () => {
        const layoutResult = {
            Warehouse: "W01",
            StorageType: "EN1",
            RackPrefix: "1-L0001",
            Plant: "1120",
            StorageLocation: "HS01",
            IsHuManaged: false,
            Xhupf: "",
            Cells: [],
            NonRackBins: [{ StorageBin: "TRANSFER", StorageType: "921", IsRackBin: false }]
        };
        MockODataClient.get.mockResolvedValueOnce({ value: layoutResult });
        const oNavSpy = jest.fn();
        controller.getRouter = jest.fn(() => ({ navTo: oNavSpy }));

        await controller.loadBins("527868", "1");

        expect(controller.model.getProperty("/isHuManaged")).toBe(false);
        expect(controller.model.getProperty("/storageLocation")).toBe("HS01");
        expect(rackView).toContain('id="stripBlankXhupf"');
        expect(rackView).toContain('{i18n>rackBlankXhupfBannerText}');
        expect(rackView).toContain('press=".onRouteToStandard311"');

        controller.onRouteToStandard311();
        expect(oNavSpy).toHaveBeenCalledWith("wmReservationEntryDetail", {
            ReservationNo: "527868",
            ReservationItem: "1"
        });
    });

    test("shows an unmaintained section without a color and wraps section color slots after 24", async () => {
        const rows = Array.from({ length: 26 }, (_value, index) => ({
            UnitNumber: "HU-" + index,
            UnitCategory: "HU",
            StorageBin: "1-L0001-" + String(index).padStart(2, "0"),
            Floor: "1",
            Rack: "L0001",
            Position: String(index).padStart(2, "0"),
            IsRackBin: true,
            SectionCode: index === 0 ? "" : "S" + String(index).padStart(2, "0"),
            SectionName: "",
            BinMasterFound: true
        }));
        MockODataClient.get.mockResolvedValueOnce({ value: rows });

        await controller.loadBins("10042", "1");

        const bins = controller.model.getProperty("/bins");
        expect(bins[0]).toMatchObject({ SectionDisplay: "Section not maintained", SectionColorSlot: 0 });
        expect(bins.find((bin) => bin.SectionCode === "S24").SectionColorSlot).toBe(24);
        expect(bins.find((bin) => bin.SectionCode === "S01").SectionColorSlot).toBe(1);
        expect(bins.find((bin) => bin.SectionCode === "S25").SectionColorSlot).toBe(1);
    });

    test("switches between the rack grid and the full table", () => {
        controller.onToggleMode();
        expect(controller.model.getProperty("/mode")).toBe("table");
        controller.onToggleMode();
        expect(controller.model.getProperty("/mode")).toBe("rack");
    });

    test("empty rack state shows the non-rack count and links to table mode", async () => {
        MockODataClient.get.mockResolvedValueOnce({ value: [
            { UnitNumber: "TRANSFER", UnitCategory: "BIN", StorageBin: "TRANSFER", StorageType: "921", IsRackBin: false }
        ] });
        await controller.loadBins("527868", "1");

        expect(controller.model.getProperty("/positions")).toEqual([]);
        expect(controller.model.getProperty("/nonRackCount")).toBe(1);
        expect(rackView).toContain('text="{i18n>rackNoRackBins}"');
        expect(rackI18n).toContain("rackNoRackBins=No rack bins for this item;");
        expect(rackView).toContain("{i18n>rackOneNonRackBinIsIn}");
        expect(rackView).toContain("!(${rackView>/positions}.length === 0)");
        expect(rackView).toContain("press=\".onShowTable\"");

        controller.onShowTable();
        expect(controller.model.getProperty("/mode")).toBe("table");
    });

    test("renders floor-rack-position groups while keeping the complete response in table mode", () => {
        expect(rackView).toContain("selectedKey=\"{rackView>/selectedWarehouse}\"");
        expect(rackView).toContain("selectedKey=\"{rackView>/selectedFloor}\"");
        expect(rackView).toContain("selectedKey=\"{rackView>/selectedRack}\"");
        expect(rackView).toContain("items=\"{rackView>/positions}\"");
        expect(rackView).toContain('wrap="NoWrap"');
        expect(rackView).toContain("items=\"{path: 'rackView>/filteredBins'}\"");
        expect(rackView).toContain("rackStockScopeNote");
        expect(rackView).not.toMatch(/\b(Bay|Level|Shelf)\b/);
    });

    test("rebuilds dependent selectors from data and shows only the chosen rack positions", async () => {
        MockODataClient.get.mockResolvedValueOnce({ value: [
            { Warehouse: "W01", Floor: "1", Rack: "R1", Position: "2", StorageBin: "1-R1-2", IsRackBin: true },
            { Warehouse: "W01", Floor: "1", Rack: "R1", Position: "10", StorageBin: "1-R1-10", IsRackBin: true },
            { Warehouse: "W01", Floor: "1", Rack: "R2", Position: "1", StorageBin: "1-R2-1", IsRackBin: true },
            { Warehouse: "W02", Floor: "3", Rack: "R3", Position: "1", StorageBin: "3-R3-1", IsRackBin: true },
            { Warehouse: "W02", Floor: "", Rack: "", Position: "", StorageBin: "WE-ZONE", IsRackBin: false }
        ] });
        await controller.loadBins("10042", "1");
        controller.onFloorChange({ getParameter: () => ({ getKey: () => "3" }) });
        controller.onWarehouseChange({ getParameter: () => ({ getKey: () => "W02" }) });
        controller.onRackChange({ getParameter: () => ({ getKey: () => "R3" }) });

        expect(controller.model.getProperty("/floors")).toEqual([{ key: "3", text: "3" }]);
        expect(controller.model.getProperty("/racks")).toEqual([{ key: "R3", text: "R3" }]);
        expect(controller.model.getProperty("/positions").map((p) => p.position)).toEqual(["1"]);
        expect(controller.model.getProperty("/filteredBins")).toHaveLength(5);
        expect(controller.model.getProperty("/nonRackCount")).toBe(1);
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
