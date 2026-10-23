let Provider;
let ControllerClass;

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

const MockBaseController = { extend: (_name, proto) => { function Controller() {} Controller.prototype = proto; return Controller; } };
const MockToast = { show: jest.fn() };

beforeAll(() => {
    global.sap = { ui: { define: (deps, factory) => {
        if (deps.length === 0) { Provider = factory(); return; }
        ControllerClass = factory(MockBaseController, MockJSONModel, MockToast, Provider);
    } } };
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/model/DemoRackDataProvider");
    require("../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferRackDemo.controller");
});

describe("HU stock transfer rack demo data model", () => {
    test("keeps floor, rack, physical level, and bin position as separate values", () => {
        const data = Provider.getData();
        expect(data.demoOnly).toBe(true);
        expect(data.racks.map((rack) => rack.rackId)).toEqual(["L0001", "L0002", "L0003"]);
        const rack = data.racks[0];
        expect(rack.physicalLevels).toHaveLength(1);
        expect(rack.physicalLevels[0].id).toBe("PICK LEVEL");
        const bin = rack.bins.find((item) => item.binId === "1-L0001-04");
        expect(bin).toMatchObject({ floor: 1, rackId: "L0001", binPosition: "04", physicalLevelId: "PICK LEVEL", physicalLevelLabel: "PHYSICAL LEVEL 0" });
        expect(bin.binPosition).not.toBe(bin.physicalLevelId);
        expect(bin.units).toHaveLength(4);
        expect(rack.physicalLevels[0].bays).toHaveLength(2);
        expect(rack.physicalLevels[0].bays.every((bay) => bay.bins.length === 7)).toBe(true);
    });

    test("assigns visual tokens explicitly by demo section, including empty bins", () => {
        const data = Provider.getData();
        expect(data.sections.map((section) => section.name)).toEqual(["Section A", "Section B", "Section C"]);
        const bins = data.racks[0].bins;
        expect(bins.find((bin) => bin.binPosition === "01").section).toBe("Section A");
        expect(bins.find((bin) => bin.binPosition === "01").sectionColor).toBe("#4389c7");
        expect(bins.find((bin) => bin.binPosition === "02").sectionColor).toBe("#57934b");
        expect(bins.find((bin) => bin.binPosition === "03").sectionColor).toBe("#e06b3c");
        expect(bins.find((bin) => bin.binPosition === "02").status).toBe("Available");
        expect(bins.find((bin) => bin.binPosition === "02").section).toBe("Section B");
    });

    test("provides occupied, available, in-process, and unavailable demo states", () => {
        const data = Provider.getData();
        const allBins = data.racks.flatMap((rack) => rack.bins);
        expect(allBins.some((bin) => bin.statusCode === "OCCUPIED")).toBe(true);
        expect(allBins.some((bin) => bin.statusCode === "AVAILABLE")).toBe(true);
        expect(allBins.some((bin) => bin.statusCode === "IN_PROCESS")).toBe(true);
        expect(allBins.some((bin) => bin.statusCode === "UNAVAILABLE")).toBe(true);
        expect(data.physicalInfo.note).toMatch(/not modeled/);
    });
});

describe("HU stock transfer rack demo controller", () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();
        controller.setModel = jest.fn((model) => { controller.model = model; });
        controller._mockRouter = { getRoute: () => ({ attachPatternMatched: jest.fn() }), navTo: jest.fn() };
        controller.getRouter = jest.fn(() => controller._mockRouter);
        controller.onInit();
    });

    test("initial selection handoff shows floor, physical level, and position 04 distinctly", () => {
        expect(controller.model.getProperty("/selectedBin/binId")).toBe("1-L0001-04");
        expect(controller.model.getProperty("/selectedBin/binPosition")).toBe("04");
        expect(controller.model.getProperty("/selectedBin/physicalLevelId")).toBe("PICK LEVEL");
        expect(controller.model.getProperty("/selectedBin/floor")).toBe(1);
    });

    test("route matching preserves the intended position 04 selection on the initial rack", () => {
        controller._onRouteMatched();
        expect(controller.model.getProperty("/selectedBin/binId")).toBe("1-L0001-04");
        expect(controller.model.getProperty("/selectedBin/binPosition")).toBe("04");
    });

    test("cycles and filters racks using demo storage type navigation", () => {
        controller.onNextRack();
        expect(controller.model.getProperty("/rack/rackId")).toBe("L0002");
        controller.onStorageTypeChange({ getParameter: () => ({ getKey: () => "EN2" }) });
        expect(controller.model.getProperty("/rack/rackId")).toBe("L0003");
        expect(controller.model.getProperty("/rackCounter")).toBe("1 of 1");
    });

    test("toggles table mode while preserving the current rack", () => {
        controller.onToggleTable();
        expect(controller.model.getProperty("/tableMode")).toBe(true);
        expect(controller.model.getProperty("/rack/rackId")).toBe("L0001");
    });

    test("selecting a bin hands its independent position and physical level to details", () => {
        const bin = controller.model.getProperty("/rack/bins").find((item) => item.binPosition === "06");
        controller.onDemoBinPress({ getSource: () => ({ getBindingContext: () => ({ getObject: () => ({ bin }) }) }) });
        expect(controller.model.getProperty("/selectedBin/binId")).toBe("1-L0001-06");
        expect(controller.model.getProperty("/selectedBin/binPosition")).toBe("06");
        expect(controller.model.getProperty("/selectedBin/physicalLevelLabel")).toBe("PHYSICAL LEVEL 0");
    });

    test("HU selection stays local and no SAP transfer starts", () => {
        const hu = controller.model.getProperty("/selectedBin/units/1");
        controller.onDemoHuPress({ getSource: () => ({ getBindingContext: () => ({ getObject: () => hu }) }) });
        expect(controller.model.getProperty("/selectedHu/unitNumber")).toBe("2000019370");
        expect(MockToast.show).toHaveBeenCalledWith(expect.stringContaining("no SAP transfer was started"));
        controller.onSelectHuForDemo();
        expect(controller.model.getProperty("/demoSelectionText")).toContain("selected locally");
    });

    test("available-bin action displays demo validation without selecting an HU", () => {
        controller._selectBin("1-L0001-02");
        controller.onSelectHuForDemo();
        expect(controller.model.getProperty("/demoSelectionState")).toBe("Error");
        expect(controller.model.getProperty("/demoSelectionText")).toContain("Demo validation");
    });

    test("close returns to the transfer worklist route", () => {
        controller.onCloseDemo();
        expect(controller._mockRouter.navTo).toHaveBeenCalledWith("wmHuStockTransfer");
    });
});
