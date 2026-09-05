sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel"
], function (BaseController, JSONModel) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.controller.App", {
        onInit: function () {
            this._sCurrentRoute = "";
            var sLogoPath = sap.ui.require.toUrl("saps4hana/fiori/assets/AeElementally.png");
            this._oShellModel = new JSONModel({
                currentTitle: "",
                showNavButton: false,
                logoUrl: sLogoPath || "assets/AeElementally.png"
            });

            this.getView().setModel(this._oShellModel, "shellModel");
            this.getOwnerComponent().setModel(this._oShellModel, "shellModel");

            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter) {
                oRouter.attachRouteMatched(this._onRouteMatched, this);
            }
        },

        /**
         * Dynamically synchronizes ShellBar title and navigation button state with the current route.
         *
         * @param {sap.ui.base.Event} oEvent
         */
        _onRouteMatched: function (oEvent) {
            var sRouteName = oEvent.getParameter("name");
            this._sCurrentRoute = sRouteName;

            var oBundle = this.getOwnerComponent().getModel("i18n") ? this.getOwnerComponent().getModel("i18n").getResourceBundle() : null;
            var sTitle = "";
            var bShowNav = false;

            switch (sRouteName) {
                case "dashboard":
                    sTitle = oBundle ? oBundle.getText("dashboardTitle") : "Enterprise Operations Dashboard";
                    bShowNav = false;
                    break;
                case "purchaseOrders":
                    sTitle = oBundle ? oBundle.getText("pageTitle") : "Purchase Orders";
                    bShowNav = true;
                    break;
                case "createPurchaseOrder":
                    sTitle = oBundle ? oBundle.getText("createPOTitle") : "Create Purchase Order";
                    bShowNav = true;
                    break;
                case "purchaseOrderDetail":
                    var oArgs = oEvent.getParameter("arguments") || {};
                    if (oArgs.PurchaseOrder) {
                        var sPoPrefix = oBundle ? oBundle.getText("poDetailTitle") : "Purchase Order";
                        sTitle = sPoPrefix + " " + oArgs.PurchaseOrder;
                    } else {
                        sTitle = oBundle ? oBundle.getText("poDetailShellTitle") : "Purchase Order Details";
                    }
                    bShowNav = true;
                    break;
                case "journalEntries":
                    sTitle = oBundle ? oBundle.getText("fiPageTitle") : "Journal Entry Items";
                    bShowNav = true;
                    break;
                case "login":
                case "default":
                default:
                    sTitle = "";
                    bShowNav = false;
                    break;
            }

            this._oShellModel.setProperty("/currentTitle", sTitle);
            this._oShellModel.setProperty("/showNavButton", bShowNav);
        },

        /**
         * Home icon press handler — returns user directly to the central Dashboard.
         */
        onHomeIconPressed: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter) {
                oRouter.navTo("dashboard", {}, true);
            }
        },

        /**
         * ShellBar navigation button handler — performs hierarchical or history back navigation.
         */
        onNavButtonPressed: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            var sRoute = this._sCurrentRoute;

            if (sRoute === "purchaseOrderDetail" || sRoute === "createPurchaseOrder") {
                if (oRouter) {
                    oRouter.navTo("purchaseOrders", {}, true);
                }
            } else if (sRoute === "purchaseOrders" || sRoute === "journalEntries") {
                if (oRouter) {
                    oRouter.navTo("dashboard", {}, true);
                }
            } else if (window.history.length > 1) {
                window.history.go(-1);
            } else if (oRouter) {
                oRouter.navTo("dashboard", {}, true);
            }
        }
    });
});
