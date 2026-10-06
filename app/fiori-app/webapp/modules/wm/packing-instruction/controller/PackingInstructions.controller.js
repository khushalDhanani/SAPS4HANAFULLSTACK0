sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/packing-instruction";

    return BaseController.extend("saps4hana.fiori.modules.wm.packing-instruction.controller.PackingInstructions", {

        onInit: function () {
            this.setModel(new JSONModel({
                externalName: "",
                busy: false,
                message: "",
                messageType: "Information",
                items: []
            }), "piView");
            this.getModel("piView").setSizeLimit(2000);
            this.getRouter().getRoute("wmPackingInstructions").attachPatternMatched(this.onGo, this);
        },

        onGo: function () {
            var oModel = this.getModel("piView");
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/list(externalName=" + q(oModel.getProperty("/externalName")) + ")";

            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/items", oResult.Items || []);
                oModel.setProperty("/messageType", oResult.Truncated ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(oResult.Truncated ? "piTruncated" : "piSummary", [oResult.TotalCount, oResult.SapCount]));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/items", []);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("piLoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        onOpenDetail: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("piView").getObject();
            this.getRouter().navTo("wmPackingInstructionDetail", { systemUUID: encodeURIComponent(o.PackingInstructionSystemUUID) });
        }
    });
});
