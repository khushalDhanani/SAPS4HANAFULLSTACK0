sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/BusyDialog",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPrinter",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPdf",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuBatchReader",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelSizeDialog",
    "saps4hana/fiori/modules/wm/handling-unit/util/QrCode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuQrPdf",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuQrLayoutDialog",
    "saps4hana/fiori/modules/wm/handling-unit/controller/HandlingUnitLabelReader",
    "saps4hana/fiori/modules/wm/handling-unit/controller/HandlingUnitLabelActions",
    "saps4hana/fiori/modules/wm/handling-unit/controller/HandlingUnitQrManager",
    "saps4hana/fiori/modules/wm/handling-unit/controller/HandlingUnitCreateManager"
], function (
    BaseController,
    JSONModel,
    ODataClient,
    Fragment,
    MessageToast,
    MessageBox,
    BusyDialog,
    HuLabelPrinter,
    HuLabelPdf,
    HuBatchReader,
    HuLabelLayout,
    HuLabelSizeDialog,
    QrCode,
    HuQrPdf,
    HuQrLayoutDialog,
    HandlingUnitLabelReader,
    HandlingUnitLabelActions,
    HandlingUnitQrManager,
    HandlingUnitCreateManager
) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";
    var FIRST_PAGE = 200;
    var VALUE_HELPS = {
        plant: "/vhPlant",
        packaging: "/vhPackaging",
        status: "/vhStatus",
        shippingpoint: "/vhShippingPoint",
        storagelocation: "/vhStorageLocation"
    };
    var EXPORT_COLUMNS = [
        ["huColHandlingUnit", "HandlingUnitExternalID"],
        ["huColPackaging", "PackagingMaterial"],
        ["huPackagingMaterial", "PackagingMaterialName"],
        ["huPlant", "Plant"],
        ["huStorageLocation", "StorageLocation"],
        ["huColGrossWeight", "GrossWeight", "Number"],
        ["huColGrossWeight", "WeightUnit"],
        ["huColStatus", "StatusText"],
        ["huColReference", "ReferenceDocument"],
        ["huCreatedBy", "CreatedByUser"],
        ["huColCreated", "CreationDateTime"]
    ];

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modReader = req(HandlingUnitLabelReader, "./HandlingUnitLabelReader");
    var modActions = req(HandlingUnitLabelActions, "./HandlingUnitLabelActions");
    var modQr = req(HandlingUnitQrManager, "./HandlingUnitQrManager");
    var modCreate = req(HandlingUnitCreateManager, "./HandlingUnitCreateManager");

    var fnReader = typeof createHandlingUnitLabelReader === "function" ? createHandlingUnitLabelReader : (modReader && modReader.createHandlingUnitLabelReader);
    var fnActions = typeof createHandlingUnitLabelActions === "function" ? createHandlingUnitLabelActions : (modActions && modActions.createHandlingUnitLabelActions);
    var fnQr = typeof createHandlingUnitQrManager === "function" ? createHandlingUnitQrManager : (modQr && modQr.createHandlingUnitQrManager);
    var fnCreate = typeof createHandlingUnitCreateManager === "function" ? createHandlingUnitCreateManager : (modCreate && modCreate.createHandlingUnitCreateManager);

    var mReader = typeof fnReader === "function" ? fnReader({
        ODataClient: ODataClient,
        MessageToast: MessageToast,
        HuBatchReader: HuBatchReader,
        HuLabelPrinter: HuLabelPrinter
    }) : {};

    var mActions = typeof fnActions === "function" ? fnActions({
        MessageBox: MessageBox,
        MessageToast: MessageToast,
        BusyDialog: BusyDialog,
        HuLabelPrinter: HuLabelPrinter,
        HuLabelPdf: HuLabelPdf,
        HuLabelLayout: HuLabelLayout,
        HuLabelSizeDialog: HuLabelSizeDialog
    }) : {};

    var mQr = typeof fnQr === "function" ? fnQr({
        JSONModel: JSONModel,
        Fragment: Fragment,
        MessageToast: MessageToast,
        MessageBox: MessageBox,
        QrCode: QrCode,
        HuQrPdf: HuQrPdf,
        HuQrLayoutDialog: HuQrLayoutDialog
    }) : {};

    var mCreate = typeof fnCreate === "function" ? fnCreate({
        Fragment: Fragment,
        MessageToast: MessageToast,
        ODataClient: ODataClient
    }) : {};

    var oMembers = {
        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                storageLocation: "",
                packagingMaterial: "",
                handlingUnitExternalID: "",
                status: "",
                shippingPoint: "",
                busy: false,
                printing: false,
                message: "",
                messageType: "Information",
                items: [],
                selectedCount: 0,
                canLoadMore: false,
                vhPlant: [],
                vhPackaging: [],
                vhStatus: [],
                vhShippingPoint: [],
                vhStorageLocation: [],
                kpiTotal: 0,
                kpis: [],
                kpiBusy: false
            }), "huView");
            this.getModel("huView").setSizeLimit(2000);
            this.setModel(new JSONModel({ packagingMaterial: "", plant: "", storageLocation: "", content: "", busy: false, error: "" }), "huCreate");
            this._loadValueHelps();
            this._loadKpis();
            this.getRouter().getRoute("wmHandlingUnits").attachPatternMatched(this.onRouteMatched, this);
        },

        formatCount: function (v) {
            if (v === null || v === undefined || v === "" || isNaN(v)) {
                return "-";
            }
            return Number(v).toLocaleString();
        },

        _loadKpis: function () {
            var oModel = this.getModel("huView");
            oModel.setProperty("/kpiBusy", true);
            return ODataClient.get(BASE_PATH + "/statusKpis()").then(function (oResult) {
                oModel.setProperty("/kpiTotal", (oResult && oResult.Total) || 0);
                oModel.setProperty("/kpis", (oResult && oResult.Items) || []);
            }).catch(function () {
                // KPI cards are informational; a failure must not break the list.
            }).then(function () {
                oModel.setProperty("/kpiBusy", false);
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

        onRouteMatched: function () {
            this.onGo();
        },

        onGo: function () {
            this._load(FIRST_PAGE);
        },

        onLoadMore: function () {
            this._load(1000);
        },

        _load: function (iLimit) {
            var oModel = this.getModel("huView");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/list(plant=" + q(o.plant) + ",storageLocation=" + q(o.storageLocation) +
                ",warehouse=" + q("") + ",packagingMaterial=" + q(o.packagingMaterial) +
                ",handlingUnitExternalID=" + q(o.handlingUnitExternalID) + ",status=" + q(o.status) +
                ",shippingPoint=" + q(o.shippingPoint) + ",limit=" + iLimit + ")";

            oModel.setProperty("/selectedCount", 0);
            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/items", oResult.Items || []);
                oModel.setProperty("/canLoadMore", !!oResult.Truncated && iLimit < 1000);
                oModel.setProperty("/messageType", oResult.Truncated ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(oResult.Truncated ? "huTruncated" : "huSummary", [oResult.TotalCount, oResult.SapCount]));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/items", []);
                oModel.setProperty("/canLoadMore", false);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("huLoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        onSelectionChange: function (oEvent) {
            this.getModel("huView").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
        },

        _rowsToObjects: function (aItems) {
            return aItems.map(function (i) { return i.getBindingContext("huView").getObject(); });
        },

        _fileStamp: function () {
            var d = new Date();
            var p = function (n) { return (n < 10 ? "0" : "") + n; };
            return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
        },

        onOpenDetail: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("huView").getObject();
            this.getRouter().navTo("wmHandlingUnitDetail", {
                hu: encodeURIComponent(o.HandlingUnitExternalID),
                "?query": { wh: o.Warehouse || "", char32: o.HandlingUnitIDChar32 || "", origin: o.HandlingUnitOrigin || "ERP" }
            });
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
    };

    Object.assign(oMembers, mReader, mActions, mQr, mCreate);

    var Controller = BaseController.extend("saps4hana.fiori.modules.wm.handling-unit.controller.HandlingUnits", oMembers);

    var oTargetProto = Controller.prototype || Controller;
    Object.assign(oTargetProto, mReader, mActions, mQr, mCreate);

    return Controller;
});
