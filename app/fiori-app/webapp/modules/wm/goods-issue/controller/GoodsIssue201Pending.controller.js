sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue201Service"
], function (BaseController, JSONModel, GoodsIssue201Service) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue201Pending", {

        onInit: function () {
            this._oModel = new JSONModel({ items: [], busy: false, error: "" });
            this.getView().setModel(this._oModel, "gi201p");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue201Pending").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._loadPending();
        },

        _loadPending: function () {
            var that = this;
            this._oModel.setProperty("/busy", true);
            this._oModel.setProperty("/error", "");
            GoodsIssue201Service.fetchPendingReservations()
                .then(function (aItems) {
                    that._oModel.setProperty("/items", Array.isArray(aItems) ? aItems : []);
                })
                .catch(function (err) {
                    that._oModel.setProperty("/items", []);
                    that._oModel.setProperty("/error", (err && err.message) || that.getText("gi201PendingLoadError"));
                })
                .finally(function () {
                    that._oModel.setProperty("/busy", false);
                });
        },

        onRefresh: function () {
            this._loadPending();
        },

        /**
         * Open the dedicated 201 create page pre-filled from the selected reservation, so the user
         * can review and complete (post) the goods issue for that cost-center reservation.
         */
        onOpenReservation: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("gi201p");
            if (!oCtx) return;
            var sResv = oCtx.getProperty("ReservationNo");
            if (!sResv) return;
            this.getRouter().navTo("wmGoodsIssue201", { "?query": { resv: sResv } });
        },

        onNavBack: function () {
            this.getRouter().navTo("wmGoodsIssue");
        }
    });
});
