sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, MessageToast) {
    "use strict";

    var DEMO_FIXTURE = {
        isDemo: true,
        warehouse: "W01",
        storageType: "001",
        rackPrefix: "1-L0001",
        floor: "1",
        rack: "L0001",
        mode: "rack",
        selectedUnit: "",
        nonRackCount: 1,
        warehouses: [{ key: "W01", text: "W01" }],
        floors: [{ key: "1", text: "Floor 1" }],
        racks: [{ key: "L0001", text: "Rack L0001" }],
        positions: [
            {
                position: "01",
                storageBin: "1-L0001-01",
                floor: "1",
                rack: "L0001",
                isRackBin: true,
                status: "occupied",
                occupied: true,
                binType: "B1",
                sectionCode: "0001",
                sectionName: "Fast Moving",
                sectionDisplay: "0001 Fast Moving",
                sectionColorSlot: 1,
                unitNumber: "DEMO-HU-001",
                unitCategory: "HU",
                material: "DEMO-MAT-100",
                materialDesc: "Demo Raw Material A",
                batch: "DEMO-B01",
                availableStock: "5.000",
                baseUnit: "PC"
            },
            {
                position: "02",
                storageBin: "1-L0001-02",
                floor: "1",
                rack: "L0001",
                isRackBin: true,
                status: "empty",
                occupied: false,
                binType: "B1",
                sectionCode: "0001",
                sectionName: "Fast Moving",
                sectionDisplay: "0001 Fast Moving",
                sectionColorSlot: 1,
                unitNumber: "",
                unitCategory: "",
                material: "",
                materialDesc: "",
                batch: "",
                availableStock: "0.000",
                baseUnit: ""
            },
            {
                position: "03",
                storageBin: "1-L0001-03",
                floor: "1",
                rack: "L0001",
                isRackBin: true,
                status: "occupied",
                occupied: true,
                binType: "B2",
                sectionCode: "0002",
                sectionName: "Standard",
                sectionDisplay: "0002 Standard",
                sectionColorSlot: 2,
                unitNumber: "DEMO-HU-002",
                unitCategory: "HU",
                material: "DEMO-MAT-200",
                materialDesc: "Demo Packaging Unit B",
                batch: "DEMO-B02",
                availableStock: "10.000",
                baseUnit: "PC"
            },
            {
                position: "04",
                storageBin: "1-L0001-04",
                floor: "1",
                rack: "L0001",
                isRackBin: true,
                status: "empty",
                occupied: false,
                binType: "B2",
                sectionCode: "0002",
                sectionName: "Standard",
                sectionDisplay: "0002 Standard",
                sectionColorSlot: 2,
                unitNumber: "",
                unitCategory: "",
                material: "",
                materialDesc: "",
                batch: "",
                availableStock: "0.000",
                baseUnit: ""
            },
            {
                position: "05",
                storageBin: "1-L0001-05",
                floor: "1",
                rack: "L0001",
                isRackBin: true,
                status: "occupied",
                occupied: true,
                binType: "B1",
                sectionCode: "0002",
                sectionName: "Standard",
                sectionDisplay: "0002 Standard",
                sectionColorSlot: 2,
                unitNumber: "DEMO-HU-003",
                unitCategory: "HU",
                material: "DEMO-MAT-300",
                materialDesc: "Demo Assembly Part C",
                batch: "DEMO-B03",
                availableStock: "2.000",
                baseUnit: "PC"
            }
        ],
        nonRackBins: [
            {
                storageBin: "TRANSFER-DEMO",
                storageType: "921",
                storageTypeDesc: "Interim Transfer Area",
                storageSection: "0001",
                storageSectionDesc: "Staging",
                unitNumber: "DEMO-HU-004",
                unitCategory: "HU",
                material: "DEMO-MAT-400",
                batch: "DEMO-B04",
                availableStock: "1.000",
                baseUnit: "PC",
                isRackBin: false
            }
        ]
    };

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRackDemo", {
        onInit: function () {
            this._oViewModel = new JSONModel(JSON.parse(JSON.stringify(DEMO_FIXTURE)));
            this.setModel(this._oViewModel, "demoRack");
            var oRoute = this.getRouter && this.getRouter().getRoute("wmHuStockTransferRackDemo");
            if (oRoute && typeof oRoute.attachPatternMatched === "function") {
                oRoute.attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._oViewModel.setData(JSON.parse(JSON.stringify(DEMO_FIXTURE)));
        },

        onToggleMode: function () {
            var sCurrent = this._oViewModel.getProperty("/mode");
            this._oViewModel.setProperty("/mode", sCurrent === "rack" ? "table" : "rack");
        },

        onSelectUnit: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("demoRack");
            var oData = oContext && oContext.getObject();
            var sUnit = oData ? oData.unitNumber : "";
            if (sUnit) {
                this._oViewModel.setProperty("/selectedUnit", sUnit);
                MessageToast.show("Selected DEMO Handling Unit: " + sUnit + " (Synthetic preview)");
            }
        },

        onNavBack: function () {
            this.getRouter().navTo("wmHuStockTransfer");
        }
    });
});
