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

            // Immediately synchronize shell for direct load / browser refresh
            this._syncInitialShellState();
        },

        _syncInitialShellState: function () {
            var sHash = (typeof window !== "undefined" && window.location && window.location.hash) ? window.location.hash.replace(/^#\/?/, "") : "";
            if (!sHash) return;

            if (sHash.indexOf("mm/purchase-orders/create") === 0) {
                this._updateShell("createPurchaseOrder");
            } else if (sHash.indexOf("mm/purchase-orders/") === 0) {
                var sPoId = sHash.replace("mm/purchase-orders/", "").split("/")[0];
                this._updateShell("purchaseOrderDetail", { PurchaseOrder: sPoId });
            } else if (sHash.indexOf("mm/purchase-orders") === 0) {
                this._updateShell("purchaseOrders");
            } else if (sHash.indexOf("fi/journal-entries") === 0) {
                this._updateShell("journalEntries");
            } else if (sHash.indexOf("sd/sales-inquiries/create") === 0) {
                this._updateShell("createSalesInquiry");
            } else if (sHash.indexOf("sd/sales-inquiries/") === 0) {
                var sInqId = sHash.replace("sd/sales-inquiries/", "").split("/")[0];
                this._updateShell("salesInquiryDetail", { SalesInquiry: sInqId });
            } else if (sHash.indexOf("sd/sales-inquiries") === 0) {
                this._updateShell("salesInquiries");
            } else if (sHash.indexOf("wm/goods-issue") === 0) {
                this._updateShell("wmGoodsIssue");
            } else if (sHash.indexOf("ewm/tasks/create") === 0) {
                this._updateShell("createWarehouseTask");
            } else if (sHash.indexOf("ewm/rf-terminal") === 0) {
                this._updateShell("ewmRfTerminal");
            } else if (sHash.indexOf("ewm/warehouse-cockpit") === 0 || sHash.indexOf("ewm/cockpit") === 0) {
                this._updateShell("ewmWarehouseCockpit");
            } else if (sHash.indexOf("dashboard") === 0) {
                this._updateShell("dashboard");
            }
        },

        /**
         * Dynamically synchronizes ShellBar title and navigation button state with the current route.
         *
         * @param {sap.ui.base.Event} oEvent
         */
        _onRouteMatched: function (oEvent) {
            var sRouteName = oEvent.getParameter("name");
            var oArgs = oEvent.getParameter("arguments");
            this._updateShell(sRouteName, oArgs);
        },

        _updateShell: function (sRouteName, oArgs) {
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
                    var args = oArgs || {};
                    if (args.PurchaseOrder) {
                        var sPoPrefix = oBundle ? oBundle.getText("poDetailTitle") : "Purchase Order";
                        sTitle = sPoPrefix + " " + args.PurchaseOrder;
                    } else {
                        sTitle = oBundle ? oBundle.getText("poDetailShellTitle") : "Purchase Order Details";
                    }
                    bShowNav = true;
                    break;
                case "journalEntries":
                    sTitle = oBundle ? oBundle.getText("fiPageTitle") : "Journal Entry Items";
                    bShowNav = true;
                    break;
                case "salesInquiries":
                    sTitle = oBundle ? oBundle.getText("salesInquiriesTitle") : "Manage Sales Inquiries";
                    bShowNav = true;
                    break;
                case "createSalesInquiry":
                    sTitle = oBundle ? oBundle.getText("createSalesInquiryTitle") : "Create Sales Inquiry (VA11)";
                    bShowNav = true;
                    break;
                case "salesInquiryDetail":
                    var inqArgs = oArgs || {};
                    if (inqArgs.SalesInquiry) {
                        sTitle = "Sales Inquiry " + inqArgs.SalesInquiry;
                    } else {
                        sTitle = "Sales Inquiry Details";
                    }
                    bShowNav = true;
                    break;
                case "wmGoodsIssue":
                    sTitle = oBundle ? oBundle.getText("giPageTitle") : "Goods Issue against Order / Reservation (261)";
                    bShowNav = true;
                    break;
                case "wmGoodsReceipt":
                    sTitle = oBundle ? oBundle.getText("grPageTitle") : "Goods Receipt against Storage Unit (101)";
                    bShowNav = true;
                    break;
                case "ewmWarehouseCockpit":
                    sTitle = oBundle ? oBundle.getText("ewmCockpitTitle") : "Warehouse Management Cockpit (EWM)";
                    bShowNav = true;
                    break;
                case "ewmRfTerminal":
                    sTitle = "RF Barcode Terminal (EWM)";
                    bShowNav = true;
                    break;
                case "createWarehouseTask":
                    sTitle = oBundle ? oBundle.getText("ewmCreateTaskBtn") : "Create Warehouse Task";
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
            var sRoute = this._sCurrentRoute;

            if (sRoute === "purchaseOrderDetail" || sRoute === "createPurchaseOrder") {
                this.onNavBack("purchaseOrders");
            } else if (sRoute === "salesInquiryDetail" || sRoute === "createSalesInquiry") {
                this.onNavBack("salesInquiries");
            } else if (sRoute === "createWarehouseTask" || sRoute === "ewmRfTerminal") {
                this.onNavBack("ewmWarehouseCockpit");
            } else if (sRoute === "purchaseOrders" || sRoute === "journalEntries" || sRoute === "salesInquiries" || sRoute === "ewmWarehouseCockpit" || sRoute === "wmGoodsIssue" || sRoute === "wmGoodsReceipt") {
                this.onNavBack("dashboard");
            } else {
                this.onNavBack("dashboard");
            }
        }
    });
});
