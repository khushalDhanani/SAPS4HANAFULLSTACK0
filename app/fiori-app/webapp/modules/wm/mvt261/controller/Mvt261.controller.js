sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/mvt261";

    function ymd(oDate) {
        if (!oDate) {
            return "";
        }
        return oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" + String(oDate.getDate()).padStart(2, "0");
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.mvt261.controller.Mvt261", {

        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                material: "",
                productionOrder: "",
                dateFrom: null,
                dateTo: null,
                definition: "A",
                excludeReversed: false,
                manualOnly: false,
                busy: false,
                message: "",
                messageType: "Information",
                result: null
            }), "mvt261View");
        },

        formatTimestamp: function (sIso) {
            return sIso ? new Date(sIso).toLocaleString() : "";
        },

        onFind: function () {
            var oModel = this.getModel("mvt261View");
            var o = oModel.getData();
            var sPlant = (o.plant || "").trim();
            if (!sPlant) {
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", this.getText("mvt261PlantRequired"));
                return;
            }
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/findFirst(plant=" + q(sPlant) + ",material=" + q(o.material) +
                ",productionOrder=" + q(o.productionOrder) + ",dateFrom=" + q(ymd(o.dateFrom)) + ",dateTo=" + q(ymd(o.dateTo)) +
                ",definition=" + q(o.definition) + ",excludeReversed=" + !!o.excludeReversed + ",manualOnly=" + !!o.manualOnly + ")";

            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/result", oResult);
                var bNone = !oResult.Top || !oResult.Top.length;
                oModel.setProperty("/messageType", bNone ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(bNone ? "mvt261NoneFound" : "mvt261AuthNote"));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/result", null);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        }
    });
});
