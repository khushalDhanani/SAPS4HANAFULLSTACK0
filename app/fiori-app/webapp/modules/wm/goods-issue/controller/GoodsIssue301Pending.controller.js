sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue301Service"
], function (BaseController, JSONModel, GoodsIssue301Service) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue301Pending", {

        onInit: function () {
            this._oModel = new JSONModel({ items: [], busy: false, error: "", resultState: "None", resultText: "" });
            this.getView().setModel(this._oModel, "gi301p");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue301Pending").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent && oEvent.getParameter("arguments");
            // Outcome of a just-completed transfer (set by the 301 execution page's Complete action).
            this._completedOutcome = (oArgs && oArgs["?query"]) || null;
            this._loadPending();
        },

        _loadPending: function () {
            var that = this;
            this._oModel.setProperty("/busy", true);
            this._oModel.setProperty("/error", "");
            GoodsIssue301Service.fetchOpenReservations()
                .then(function (aItems) {
                    var aList = Array.isArray(aItems) ? aItems : [];
                    var oDone = that._completedOutcome;
                    if (oDone && oDone.resv && oDone.doc) {
                        aList = aList.filter(function (r) { return String(r.ReservationNo) !== String(oDone.resv); });
                        that._showCompletionResult(oDone);
                        that._completedOutcome = null; // one-shot
                    }
                    that._oModel.setProperty("/items", aList);
                })
                .catch(function (err) {
                    that._oModel.setProperty("/items", []);
                    that._oModel.setProperty("/error", (err && err.message) || that.getText("gi301OpenTransfersLoadError"));
                })
                .finally(function () {
                    that._oModel.setProperty("/busy", false);
                });
        },

        /**
         * Show the outcome of a completed transfer reservation: the SAP Material Document number when posted.
         */
        _showCompletionResult: function (oDone) {
            if (oDone && oDone.doc) {
                this._oModel.setProperty("/resultState", "Success");
                this._oModel.setProperty("/resultText", this.getText("gi301OpenTransfersCompletedPosted", [oDone.resv, oDone.doc, oDone.year || ""]));
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
         * Open the dedicated 301 review and complete page pre-filled from the selected reservation,
         * so the user can verify locations/materials, scan serials if managed, and complete the transfer.
         */
        onOpenReservation: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("gi301p");
            if (!oCtx) return;
            var sResv = oCtx.getProperty("ReservationNo");
            if (!sResv) return;
            this.getRouter().navTo("wmGoodsIssue301", { "?query": { resv: sResv } });
        },

        onNavBack: function () {
            this.getRouter().navTo("dashboard");
        }
    });
});
