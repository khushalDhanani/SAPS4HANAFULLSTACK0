sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/packing-instruction";

    return BaseController.extend("saps4hana.fiori.modules.wm.packing-instruction.controller.PackingInstructionDetail", {

        onInit: function () {
            this.setModel(new JSONModel({ busy: false, message: "", messageType: "Information", header: {}, components: [], texts: [] }), "piDetail");
            this.getModel("piDetail").setSizeLimit(2000);
            this.getRouter().getRoute("wmPackingInstructionDetail").attachPatternMatched(this.onRouteMatched, this);
        },

        onRouteMatched: function (oEvent) {
            var sUuid = decodeURIComponent(oEvent.getParameter("arguments").systemUUID);
            var oModel = this.getModel("piDetail");
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };

            oModel.setData({ busy: true, message: "", messageType: "Information", header: {}, components: [], texts: [] });
            ODataClient.get(BASE_PATH + "/get(systemUUID=" + q(sUuid) + ")").then(function (oResult) {
                oModel.setProperty("/header", oResult);
                oModel.setProperty("/components", oResult.Components || []);
                oModel.setProperty("/texts", oResult.Texts || []);
            }).catch(function (oError) {
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("piLoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        }
    });
});
