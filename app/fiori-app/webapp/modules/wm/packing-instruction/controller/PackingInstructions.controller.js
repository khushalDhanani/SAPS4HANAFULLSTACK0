sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast) {
    "use strict";

    var BASE_PATH = "/odata/v4/packing-instruction";
    var HU_PATH = "/odata/v4/handling-unit";

    function emptyCreate() {
        return {
            externalName: "",
            weightUnit: "KG",
            pkgMaterial: "",
            pkgQty: "1",
            pkgUnit: "NOS",
            materials: [{ material: "", qty: "", unit: "KG" }],
            vhPackaging: [],
            busy: false,
            error: ""
        };
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.packing-instruction.controller.PackingInstructions", {

        onInit: function () {
            this.setModel(new JSONModel({ externalName: "", busy: false, message: "", messageType: "Information", items: [] }), "piView");
            this.getModel("piView").setSizeLimit(2000);
            this.setModel(new JSONModel(emptyCreate()), "piCreate");
            this.getRouter().getRoute("wmPackingInstructions").attachPatternMatched(this.onGo, this);
        },

        onGo: function () {
            var oModel = this.getModel("piView");
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(BASE_PATH + "/list(externalName=" + q(oModel.getProperty("/externalName")) + ")").then(function (oResult) {
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
        },

        onOpenCreate: function () {
            var oView = this.getView();
            var that = this;
            this.getModel("piCreate").setData(emptyCreate());
            // Reuse the HU cockpit's packaging-material value help for the P (load carrier) item.
            ODataClient.get(HU_PATH + "/valueHelp(kind='packaging')").then(function (oResult) {
                that.getModel("piCreate").setProperty("/vhPackaging", (oResult && oResult.Items) || []);
            }).catch(function () { /* F4 optional; input stays a plain field */ });

            if (!this._pCreateDialog) {
                this._pCreateDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.packing-instruction.view.CreatePackingInstructionDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pCreateDialog.then(function (oDialog) { oDialog.open(); });
        },

        onAddMaterialRow: function () {
            var oModel = this.getModel("piCreate");
            var aRows = oModel.getProperty("/materials").slice();
            aRows.push({ material: "", qty: "", unit: "KG" });
            oModel.setProperty("/materials", aRows);
        },

        onRemoveMaterialRow: function (oEvent) {
            var oModel = this.getModel("piCreate");
            var oCtx = oEvent.getSource().getBindingContext("piCreate");
            var iIdx = oCtx.getPath().split("/").pop();
            var aRows = oModel.getProperty("/materials").slice();
            aRows.splice(Number(iIdx), 1);
            oModel.setProperty("/materials", aRows.length ? aRows : [{ material: "", qty: "", unit: "KG" }]);
        },

        onCancelCreate: function () {
            this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
        },

        onSubmitCreate: function () {
            var oModel = this.getModel("piCreate");
            var o = oModel.getData();
            var aComponents = [{ item: "10", category: "P", material: o.pkgMaterial, targetQty: Number(o.pkgQty), unit: o.pkgUnit }];
            (o.materials || []).filter(function (m) { return (m.material || "").trim(); })
                .forEach(function (m, i) { aComponents.push({ item: String(20 + i * 10), category: "M", material: m.material, targetQty: Number(m.qty), unit: m.unit }); });

            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            ODataClient.post(BASE_PATH + "/create", { externalName: o.externalName, weightUnit: o.weightUnit, components: aComponents, texts: [] })
                .then(function (oResult) {
                    MessageToast.show(this.getText("piCreateOk", [oResult.PackingInstructionNumber]));
                    this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
                    this.getRouter().navTo("wmPackingInstructionDetail", { systemUUID: encodeURIComponent(oResult.PackingInstructionSystemUUID) });
                }.bind(this))
                .catch(function (oError) {
                    oModel.setProperty("/error", (oError && oError.message) || this.getText("piCreateError"));
                }.bind(this))
                .then(function () { oModel.setProperty("/busy", false); });
        }
    });
});
