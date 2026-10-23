sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "saps4hana/fiori/modules/wm/hu-stock-transfer/model/DemoRackDataProvider"
], function (BaseController, JSONModel, MessageToast, DemoRackDataProvider) {
    "use strict";

    function flattenBins(oRack) {
        return (oRack && oRack.bins ? oRack.bins : []).map(function (oBin) {
            return Object.assign({ warehouse: oRack.warehouse, storageType: oRack.storageType }, oBin);
        });
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRackDemo", {
        onInit: function () {
            var oData = DemoRackDataProvider.getData();
            this._oDemoData = oData;
            this._oViewModel = new JSONModel({
                demoOnly: true,
                material: oData.material,
                storageTypes: oData.storageTypes,
                selectedStorageType: "ALL",
                racks: oData.racks,
                rackIndex: 0,
                rack: oData.racks[0],
                rackTitle: oData.racks[0].title,
                rackSubtitle: "Floor 1 · " + oData.racks[0].storageType + " · Demo layout",
                rackCounter: "1 of " + oData.racks.length,
                bins: flattenBins(oData.racks[0]),
                sections: oData.sections,
                physicalInfo: oData.physicalInfo,
                selectedBinId: "1-L0001-04",
                selectedBin: null,
                selectedHu: null,
                tableMode: false,
                demoSelectionText: "",
                demoSelectionState: "Information"
            });
            this.setModel(this._oViewModel, "demoRack");
            this._selectBin("1-L0001-04");
            this.getRouter().getRoute("wmHuStockTransferRackDemo").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () { this._showRack(0); },

        _getFilteredRacks: function () {
            var sType = this._oViewModel.getProperty("/selectedStorageType");
            return this._oDemoData.racks.filter(function (oRack) { return sType === "ALL" || oRack.storageType === sType; });
        },

        _showRack: function (iIndex) {
            var aRacks = this._getFilteredRacks();
            if (!aRacks.length) { return; }
            var iSafeIndex = Math.max(0, Math.min(iIndex, aRacks.length - 1));
            var oRack = aRacks[iSafeIndex];
            this._oViewModel.setProperty("/racks", aRacks);
            this._oViewModel.setProperty("/rackIndex", iSafeIndex);
            this._oViewModel.setProperty("/rack", oRack);
            this._oViewModel.setProperty("/rackTitle", oRack.title);
            this._oViewModel.setProperty("/rackSubtitle", "Floor " + oRack.floor + " · " + oRack.storageType + " · Demo layout");
            this._oViewModel.setProperty("/rackCounter", (iSafeIndex + 1) + " of " + aRacks.length);
            this._oViewModel.setProperty("/bins", flattenBins(oRack));
            this._oViewModel.setProperty("/selectedHu", null);
            this._oViewModel.setProperty("/demoSelectionText", "");
            var sCurrentBinId = this._oViewModel.getProperty("/selectedBinId");
            var oCurrentBin = oRack.bins.find(function (oBin) { return oBin.binId === sCurrentBinId; });
            this._selectBin(oCurrentBin ? oCurrentBin.binId : oRack.bins[0].binId);
        },

        _selectBin: function (sBinId) {
            var oRack = this._oViewModel.getProperty("/rack");
            var oBin = oRack && oRack.bins.find(function (oItem) { return oItem.binId === sBinId; });
            if (!oBin) { return; }
            this._oViewModel.setProperty("/selectedBinId", sBinId);
            this._oViewModel.setProperty("/selectedBin", oBin);
            this._oViewModel.setProperty("/selectedHu", null);
            this._oViewModel.setProperty("/demoSelectionText", "");
            this._oViewModel.setProperty("/demoSelectionState", "Information");
        },

        onPrevRack: function () {
            var aRacks = this._getFilteredRacks();
            this._showRack((this._oViewModel.getProperty("/rackIndex") + aRacks.length - 1) % aRacks.length);
        },
        onNextRack: function () {
            var aRacks = this._getFilteredRacks();
            this._showRack((this._oViewModel.getProperty("/rackIndex") + 1) % aRacks.length);
        },
        onStorageTypeChange: function (oEvent) {
            this._oViewModel.setProperty("/selectedStorageType", oEvent.getParameter("selectedItem").getKey());
            this._showRack(0);
        },
        onToggleTable: function () { this._oViewModel.setProperty("/tableMode", !this._oViewModel.getProperty("/tableMode")); },
        onDemoBinPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("demoRack");
            var oObject = oContext && oContext.getObject();
            var oBin = oObject && (oObject.bin || oObject);
            if (oBin) { this._selectBin(oBin.binId); }
        },
        onDemoHuPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("demoRack");
            var oHu = oContext && oContext.getObject();
            if (!oHu) { return; }
            this._oViewModel.setProperty("/selectedHu", oHu);
            MessageToast.show("Demo only: " + oHu.unitNumber + " selected; no SAP transfer was started.");
        },
        onSelectHuForDemo: function () {
            var oHu = this._oViewModel.getProperty("/selectedHu") || (this._oViewModel.getProperty("/selectedBin/units") || [])[0];
            if (!oHu) {
                this._oViewModel.setProperty("/demoSelectionState", "Error");
                this._oViewModel.setProperty("/demoSelectionText", "Demo validation: choose an occupied bin with a demo HU first.");
                return;
            }
            this._oViewModel.setProperty("/selectedHu", oHu);
            this._oViewModel.setProperty("/demoSelectionState", "Success");
            this._oViewModel.setProperty("/demoSelectionText", "DEMO ONLY — " + oHu.unitNumber + " selected locally. No SAP transfer was started.");
        },
        onCloseDemo: function () { this.getRouter().navTo("wmHuStockTransfer"); }
    });
});
