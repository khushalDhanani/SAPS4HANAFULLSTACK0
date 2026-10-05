sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/mvt261";
    // Export columns: i18n label key -> result property, in table order.
    var EXPORT_COLUMNS = [
        ["open261Reservation", "Reservation"], ["open261Item", "ReservationItem"], ["mvt261Order", "ProductionOrder"],
        ["open261OrderDescription", "OrderDescription"], ["mvt261Material", "Material"], ["open261MaterialName", "MaterialName"],
        ["mvt261Plant", "Plant"], ["open261Sloc", "StorageLocation"], ["open261RequirementDate", "RequirementDate"],
        ["open261Required", "RequiredQuantity", "Number"], ["open261Withdrawn", "WithdrawnQuantity", "Number"],
        ["open261Open", "OpenQuantity", "Number"], ["open261Unit", "Unit"], ["open261MovementAllowed", "MovementAllowed", "Boolean"]
    ];

    function ymd(oDate) {
        if (!oDate) {
            return "";
        }
        return oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" + String(oDate.getDate()).padStart(2, "0");
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.mvt261.controller.Open261", {

        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                productionOrder: "",
                material: "",
                reservation: "",
                dateFrom: null,
                dateTo: null,
                includeFullyWithdrawn: false,
                busy: false,
                message: "",
                messageType: "Information",
                items: []
            }), "open261View");
            this.getModel("open261View").setSizeLimit(5000);
            this.getRouter().getRoute("wmOpen261").attachPatternMatched(this.onGo, this);
        },

        onGo: function () {
            var oModel = this.getModel("open261View");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/openItems(plant=" + q(o.plant) + ",material=" + q(o.material) +
                ",productionOrder=" + q(o.productionOrder) + ",reservation=" + q(o.reservation) +
                ",dateFrom=" + q(ymd(o.dateFrom)) + ",dateTo=" + q(ymd(o.dateTo)) +
                ",includeFullyWithdrawn=" + !!o.includeFullyWithdrawn + ")";

            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/items", oResult.Items || []);
                oModel.setProperty("/messageType", oResult.Truncated ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(oResult.Truncated ? "open261Truncated" : "open261Summary",
                    [oResult.TotalCount, oResult.SapOpenCount]));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/items", []);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
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
                    dataSource: that.getModel("open261View").getProperty("/items"),
                    fileName: that.getText("open261ExportFile") + ".xlsx"
                });
                oSheet.build().finally(function () { oSheet.destroy(); });
            });
        }
    });
});
