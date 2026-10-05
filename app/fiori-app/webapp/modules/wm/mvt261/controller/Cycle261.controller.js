sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var STATE = { done: "Success", open: "Warning", blocked: "Error" };

    return BaseController.extend("saps4hana.fiori.modules.wm.mvt261.controller.Cycle261", {

        onInit: function () {
            this.setModel(new JSONModel({ busy: false, error: "", c: null }), "cycle261View");
            this.getRouter().getRoute("wmCycle261").attachPatternMatched(this._onRoute, this);
        },

        formatState: function (sStatus) {
            return STATE[sStatus] || "None";
        },

        formatStatus: function (sStatus) {
            return sStatus ? this.getText("cycle261Status_" + sStatus) : "";
        },

        formatStep: function (sStep) {
            return sStep ? this.getText("cycle261Step_" + sStep) : "";
        },

        _onRoute: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var oModel = this.getModel("cycle261View");
            var sUrl = "/odata/v4/mvt261/cycle(reservation='" + encodeURIComponent(oArgs.reservation) +
                "',item='" + encodeURIComponent(oArgs.item) + "')";

            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            oModel.setProperty("/c", null);
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/c", oResult);
            }).catch(function (oError) {
                oModel.setProperty("/error", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        }
    });
});
