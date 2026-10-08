sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, MessageBox, MessageToast) {
    "use strict";

    var BASE_PATH = "/odata/v4/mvt261";
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
            this._args = oEvent.getParameter("arguments");
            this._load();
        },

        /** (Re)loads the cycle from SAP; also used after a reversal so the history/status is live. */
        _load: function () {
            var oArgs = this._args;
            var oModel = this.getModel("cycle261View");
            var sUrl = BASE_PATH + "/cycle(reservation='" + encodeURIComponent(oArgs.reservation) +
                "',item='" + encodeURIComponent(oArgs.item) + "')";
            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            oModel.setProperty("/c", null);
            return ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/c", oResult);
            }).catch(function (oError) {
                oModel.setProperty("/error", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        /** Reverse (262) one 261 document item: confirm first, showing document/material/qty/batch/location. */
        onReverse: function (oEvent) {
            var oModel = this.getModel("cycle261View");
            if (oModel.getProperty("/busy")) { return; }
            var oRow = oEvent.getSource().getBindingContext("cycle261View").getObject();
            var oC = oModel.getProperty("/c") || {};
            var sDoc = oRow.MaterialDocument + "/" + oRow.MaterialDocumentYear + "/" + oRow.MaterialDocumentItem;
            var sConfirm = this.getText("cycle261ReverseConfirm", [
                sDoc, oC.Material || "", (oRow.Quantity || 0) + " " + (oRow.Unit || oC.Unit || ""),
                oRow.Batch || "-", oRow.StorageLocation || oC.StorageLocation || "-"
            ]);
            MessageBox.confirm(sConfirm, {
                title: this.getText("cycle261ReverseTitle"),
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) { this._doReverse(oRow); }
                }.bind(this)
            });
        },

        _doReverse: function (oRow) {
            var oModel = this.getModel("cycle261View");
            var oC = oModel.getProperty("/c") || {};
            oModel.setProperty("/busy", true);
            ODataClient.post(BASE_PATH + "/reverse", {
                reservation: String(oC.Reservation),
                item: String(oC.ReservationItem),
                materialDocument: String(oRow.MaterialDocument),
                materialDocumentYear: String(oRow.MaterialDocumentYear),
                materialDocumentItem: String(oRow.MaterialDocumentItem)
            }).then(function (oRes) {
                var sRev = oRes.MaterialDocument + (oRes.MaterialDocumentYear ? "/" + oRes.MaterialDocumentYear : "");
                MessageToast.show(this.getText("cycle261ReverseSuccess", [sRev]));
                this._load();
            }.bind(this)).catch(function (oError) {
                this._handleReverseError(oError);
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        _handleReverseError: function (oError) {
            var iStatus = oError && oError.status;
            if (!iStatus || iStatus === 502 || iStatus === 504) {
                // Unknown outcome: no status (network drop) or a gateway/timeout (502/504 = CAP->SAP
                // timed out). The reversal may or may not have posted - no blind retry.
                MessageBox.warning(this.getText("cycle261ReverseUnknown"));
                return;
            }
            if (iStatus === 409) {
                var sRefresh = this.getText("scan261Refresh");
                MessageBox.information(this.getText("cycle261ReverseInProgress"), {
                    actions: [sRefresh, MessageBox.Action.CLOSE],
                    emphasizedAction: sRefresh,
                    onClose: function (sAction) { if (sAction === sRefresh) { this._load(); } }.bind(this)
                });
                return;
            }
            MessageBox.error((oError && oError.message) || this.getText("cycle261ReverseFailed"));
        }
    });
});
