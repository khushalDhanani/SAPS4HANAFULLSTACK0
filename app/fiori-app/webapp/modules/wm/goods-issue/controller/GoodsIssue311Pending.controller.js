sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue311Service"
], function (BaseController, JSONModel, GoodsIssue311Service) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue311Pending", {

        onInit: function () {
            this._oModel = new JSONModel({ items: [], busy: false, error: "", resultState: "None", resultText: "" });
            this.getView().setModel(this._oModel, "gi311p");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue311Pending").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent && oEvent.getParameter("arguments");
            // Outcome of a just-completed transfer (set by the 311 execution page's Complete action).
            this._completedOutcome = (oArgs && oArgs["?query"]) || null;
            this._loadPending();
        },

        _loadPending: function () {
            var that = this;
            this._oModel.setProperty("/busy", true);
            this._oModel.setProperty("/error", "");
            GoodsIssue311Service.fetchOpenReservations()
                .then(function (aItems) {
                    var aList = Array.isArray(aItems) ? aItems : [];
                    var oDone = that._completedOutcome;
                    if (oDone && oDone.resv) {
                        // Clear the just-completed reservation from the list (a posted one drops off
                        // SAP on its own; a queued one is still open in SAP but locally cleared here).
                        aList = aList.filter(function (r) { return String(r.ReservationNo) !== String(oDone.resv); });
                        that._showCompletionResult(oDone);
                        that._completedOutcome = null; // one-shot
                    }
                    that._oModel.setProperty("/items", aList);
                })
                .catch(function (err) {
                    that._oModel.setProperty("/items", []);
                    that._oModel.setProperty("/error", (err && err.message) || that.getText("gi311OpenTransfersLoadError"));
                })
                .finally(function () {
                    that._oModel.setProperty("/busy", false);
                });
        },

        /**
         * Show the outcome of a completed transfer reservation: the SAP Material Document number when posted,
         * or the honest queue reference while the S/4HANA Gateway service is inactive.
         */
        _showCompletionResult: function (oDone) {
            if (oDone.doc) {
                this._oModel.setProperty("/resultState", "Success");
                this._oModel.setProperty("/resultText", this.getText("gi311OpenTransfersCompletedPosted", [oDone.resv, oDone.doc, oDone.year || ""]));
            } else {
                this._oModel.setProperty("/resultState", "Warning");
                this._oModel.setProperty("/resultText", this.getText("gi311OpenTransfersCompletedQueued", [oDone.resv, oDone.queued || ""]));
            }
        },

        onCloseResult: function () {
            this._oModel.setProperty("/resultState", "None");
            this._oModel.setProperty("/resultText", "");
        },

        onRefresh: function () {
            this._loadPending();
        },

        /**
         * Open the dedicated 311 review and complete page pre-filled from the selected reservation,
         * so the user can verify locations/materials, scan serials if managed, and complete the transfer.
         */
        onOpenReservation: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("gi311p");
            if (!oCtx) return;
            var sResv = oCtx.getProperty("ReservationNo");
            if (!sResv) return;
            this.getRouter().navTo("wmGoodsIssue311", { "?query": { resv: sResv } });
        },

        onNavBack: function () {
            this.getRouter().navTo("wmGoodsIssue");
        }
    });
});
