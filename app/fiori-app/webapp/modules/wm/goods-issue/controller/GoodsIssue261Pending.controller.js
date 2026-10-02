sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue261Service"
], function (BaseController, JSONModel, GoodsIssue261Service) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue261Pending", {

        onInit: function () {
            this._oModel = new JSONModel({ items: [], busy: false, error: "", resultState: "None", resultText: "" });
            this.getView().setModel(this._oModel, "gi261p");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue261Pending").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent && oEvent.getParameter("arguments");
            // Outcome of a just-completed reservation (set by the 261 complete page's Complete action).
            this._completedOutcome = (oArgs && oArgs["?query"]) || null;
            this._loadPending();
        },

        _loadPending: function () {
            var that = this;
            this._oModel.setProperty("/busy", true);
            this._oModel.setProperty("/error", "");
            GoodsIssue261Service.fetchOpenReservations()
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
                    that._oModel.setProperty("/error", (err && err.message) || that.getText("gi261OpenResvLoadError"));
                })
                .finally(function () {
                    that._oModel.setProperty("/busy", false);
                });
        },

        /**
         * Show the outcome of a completed reservation: the SAP Material Document number when posted.
         */
        _showCompletionResult: function (oDone) {
            if (oDone && oDone.doc) {
                this._oModel.setProperty("/resultState", "Success");
                this._oModel.setProperty("/resultText", this.getText("gi261OpenResvCompletedPosted", [oDone.resv, oDone.doc, oDone.year || ""]));
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
         * Open the dedicated 261 review and complete page pre-filled from the selected reservation,
         * so the user can verify order/components, scan serials if managed, and complete the issue.
         */
        onOpenReservation: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("gi261p");
            if (!oCtx) return;
            var sResv = oCtx.getProperty("ReservationNo");
            if (!sResv) return;
            this.getRouter().navTo("wmGoodsIssue261", { "?query": { resv: sResv } });
        },

        onNavBack: function () {
            this.getRouter().navTo("dashboard");
        }
    });
});
