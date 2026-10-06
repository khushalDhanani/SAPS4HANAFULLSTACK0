sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";

    return BaseController.extend("saps4hana.fiori.modules.wm.handling-unit.controller.HandlingUnits", {

        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                storageLocation: "",
                warehouse: "",
                packagingMaterial: "",
                handlingUnitExternalID: "",
                busy: false,
                message: "",
                messageType: "Information",
                items: []
            }), "huView");
            this.getModel("huView").setSizeLimit(2000);
            this.getRouter().getRoute("wmHandlingUnits").attachPatternMatched(this.onGo, this);
        },

        onGo: function () {
            var oModel = this.getModel("huView");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/list(plant=" + q(o.plant) + ",storageLocation=" + q(o.storageLocation) +
                ",warehouse=" + q(o.warehouse) + ",packagingMaterial=" + q(o.packagingMaterial) +
                ",handlingUnitExternalID=" + q(o.handlingUnitExternalID) + ")";

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
        }
    });
});
