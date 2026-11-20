(function () {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";

    function createHandlingUnitCreateManager(deps) {
        deps = deps || {};
        var Fragment = deps.Fragment;
        var MessageToast = deps.MessageToast;
        var ODataClient = deps.ODataClient;

        return {
            // Create HU (CAP action create -> BAPI_HU_CREATE + commit). Plant / SLoc / packaging prefilled from the filter bar.
            onOpenCreate: function () {
                var oView = this.getView();
                var o = this.getModel("huView").getData();
                this.getModel("huCreate").setData({
                    packagingMaterial: o.packagingMaterial || "",
                    plant: o.plant || "",
                    storageLocation: o.storageLocation || "",
                    content: "",
                    busy: false,
                    error: ""
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
                if (o.submitBlocked) return;
                oModel.setProperty("/busy", true);
                oModel.setProperty("/error", "");
                ODataClient.post(BASE_PATH + "/create", {
                    packagingMaterial: o.packagingMaterial,
                    plant: o.plant,
                    storageLocation: o.storageLocation,
                    content: o.content
                })
                    .then(function (oResult) {
                        MessageToast.show(this.getText("huCreateOk", [oResult.HandlingUnitExternalID]));
                        this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
                        this.getRouter().navTo("wmHandlingUnitDetail", {
                            hu: encodeURIComponent(oResult.HandlingUnitExternalID),
                            "?query": { wh: "", char32: "", origin: "ERP" }
                        });
                    }.bind(this))
                    .catch(function (oError) {
                        var sMessage = (oError && oError.message) || this.getText("huCreateError");
                        oModel.setProperty("/error", this.blockSubmitIfNotConfirmed(oModel, sMessage) || sMessage);
                    }.bind(this))
                    .then(function () { oModel.setProperty("/busy", false); });
            }
        };
    }

    var oExports = {
        createHandlingUnitCreateManager: createHandlingUnitCreateManager
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oExports;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oExports;
        });
    }
})();
