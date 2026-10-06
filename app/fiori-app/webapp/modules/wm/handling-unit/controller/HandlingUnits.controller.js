sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";
    var FILTER_FIELDS = ["plant", "storageLocation", "packagingMaterial", "handlingUnitExternalID", "status", "shippingPoint"];
    // Value-help input kind -> model path for its suggestion list.
    var VALUE_HELPS = { plant: "/vhPlant", packaging: "/vhPackaging", status: "/vhStatus", shippingpoint: "/vhShippingPoint", storagelocation: "/vhStorageLocation" };
    // Export columns: i18n label key -> result property (-> type), in table order. Same shape as Open261.
    var EXPORT_COLUMNS = [
        ["huColHandlingUnit", "HandlingUnitExternalID"], ["huColPackaging", "PackagingMaterial"], ["huPackagingMaterial", "PackagingMaterialName"],
        ["huPlant", "Plant"], ["huStorageLocation", "StorageLocation"], ["huColGrossWeight", "GrossWeight", "Number"], ["huColGrossWeight", "WeightUnit"],
        ["huColStatus", "StatusText"], ["huColReference", "ReferenceDocument"], ["huCreatedBy", "CreatedByUser"], ["huColCreated", "CreationDateTime"]
    ];

    return BaseController.extend("saps4hana.fiori.modules.wm.handling-unit.controller.HandlingUnits", {

        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                storageLocation: "",
                packagingMaterial: "",
                handlingUnitExternalID: "",
                status: "",
                shippingPoint: "",
                busy: false,
                message: "",
                messageType: "Information",
                items: [],
                vhPlant: [],
                vhPackaging: [],
                vhStatus: [],
                vhShippingPoint: [],
                vhStorageLocation: [],
                kpiTotal: 0,
                kpis: []
            }), "huView");
            this.getModel("huView").setSizeLimit(2000);
            this.setModel(new JSONModel({ packagingMaterial: "", plant: "", storageLocation: "", content: "", busy: false, error: "" }), "huCreate");
            this._loadValueHelps();
            this._loadKpis();
            this.getRouter().getRoute("wmHandlingUnits").attachPatternMatched(this.onRouteMatched, this);
        },

        _loadKpis: function () {
            var oModel = this.getModel("huView");
            ODataClient.get(BASE_PATH + "/statusKpis()").then(function (oResult) {
                oModel.setProperty("/kpiTotal", (oResult && oResult.Total) || 0);
                oModel.setProperty("/kpis", (oResult && oResult.Items) || []);
            }).catch(function () {
                // KPI cards are informational; a failure must not break the list.
            });
        },

        _loadValueHelps: function () {
            var oModel = this.getModel("huView");
            Object.keys(VALUE_HELPS).forEach(function (sKind) {
                ODataClient.get(BASE_PATH + "/valueHelp(kind='" + sKind + "')").then(function (oResult) {
                    oModel.setProperty(VALUE_HELPS[sKind], (oResult && oResult.Items) || []);
                }).catch(function () {
                    // A value-help failure must not break the filter bar; the input stays a plain text field.
                });
            });
        },

        _hasFilter: function () {
            var o = this.getModel("huView").getData();
            return FILTER_FIELDS.some(function (sField) { return (o[sField] || "").trim() !== ""; });
        },

        // Entry via route: only query when a filter is set, so a visit does not trigger a full 17k-row scan.
        onRouteMatched: function () {
            if (this._hasFilter()) {
                this.onGo();
            } else {
                var oModel = this.getModel("huView");
                oModel.setProperty("/items", []);
                oModel.setProperty("/messageType", "Information");
                oModel.setProperty("/message", this.getText("huEnterFilter"));
            }
        },

        onGo: function () {
            var oModel = this.getModel("huView");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/list(plant=" + q(o.plant) + ",storageLocation=" + q(o.storageLocation) +
                ",warehouse=" + q("") + ",packagingMaterial=" + q(o.packagingMaterial) +
                ",handlingUnitExternalID=" + q(o.handlingUnitExternalID) + ",status=" + q(o.status) +
                ",shippingPoint=" + q(o.shippingPoint) + ")";

            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/items", oResult.Items || []);
                oModel.setProperty("/messageType", oResult.Truncated ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(oResult.Truncated ? "huTruncated" : "huSummary", [oResult.TotalCount, oResult.SapCount]));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/items", []);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("huLoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        onOpenDetail: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("huView").getObject();
            this.getRouter().navTo("wmHandlingUnitDetail", {
                hu: encodeURIComponent(o.HandlingUnitExternalID),
                "?query": { wh: o.Warehouse || "", char32: o.HandlingUnitIDChar32 || "", origin: o.HandlingUnitOrigin || "ERP" }
            });
        },

        // Create HU (CAP action create -> BAPI_HU_CREATE + commit). Plant / SLoc / packaging prefilled from the filter bar.
        onOpenCreate: function () {
            var oView = this.getView();
            var o = this.getModel("huView").getData();
            this.getModel("huCreate").setData({
                packagingMaterial: o.packagingMaterial || "", plant: o.plant || "", storageLocation: o.storageLocation || "",
                content: "", busy: false, error: ""
            });
            if (!this._pCreateDialog) {
                this._pCreateDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.handling-unit.view.CreateHandlingUnitDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pCreateDialog.then(function (oDialog) { oDialog.open(); });
        },

        onCancelCreate: function () {
            this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
        },

        onSubmitCreate: function () {
            var oModel = this.getModel("huCreate");
            var o = oModel.getData();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            ODataClient.post(BASE_PATH + "/create", { packagingMaterial: o.packagingMaterial, plant: o.plant, storageLocation: o.storageLocation, content: o.content })
                .then(function (oResult) {
                    MessageToast.show(this.getText("huCreateOk", [oResult.HandlingUnitExternalID]));
                    this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
                    // detail() resolves the monitor key itself, so no char32 is needed for a fresh HU
                    this.getRouter().navTo("wmHandlingUnitDetail", {
                        hu: encodeURIComponent(oResult.HandlingUnitExternalID),
                        "?query": { wh: "", char32: "", origin: "ERP" }
                    });
                }.bind(this))
                .catch(function (oError) {
                    oModel.setProperty("/error", (oError && oError.message) || this.getText("huCreateError"));
                }.bind(this))
                .then(function () { oModel.setProperty("/busy", false); });
        },

        onExport: function () {
            var that = this;
            sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
                var oSheet = new Spreadsheet({
                    workbook: {
                        columns: EXPORT_COLUMNS.map(function (a) {
                            return { label: that.getText(a[0]), property: a[1], type: a[2] || "String" };
                        })
                    },
                    dataSource: that.getModel("huView").getProperty("/items"),
                    fileName: that.getText("huExportFile") + ".xlsx"
                });
                oSheet.build().finally(function () { oSheet.destroy(); });
            });
        }
    });
});
