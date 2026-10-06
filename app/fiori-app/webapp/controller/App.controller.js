sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Messaging"
], function (BaseController, JSONModel, Messaging) {
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

            // Apply official SAPUI5 compact density class to the root view
            this.getView().addStyleClass(this.getOwnerComponent().getContentDensityClass());
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
            } else if (sHash.indexOf("sd/sales-orders/create") === 0) {
                this._updateShell("createSalesOrder");
            } else if (sHash.indexOf("sd/sales-orders") === 0) {
                this._updateShell("salesOrders");
            } else if (sHash.indexOf("sd/sales-inquiries/create") === 0) {
                this._updateShell("createSalesInquiry");
            } else if (sHash.indexOf("sd/sales-inquiries/") === 0) {
                var sInqId = sHash.replace("sd/sales-inquiries/", "").split("/")[0];
                this._updateShell("salesInquiryDetail", { SalesInquiry: sInqId });
            } else if (sHash.indexOf("sd/sales-inquiries") === 0) {
                this._updateShell("salesInquiries");
            } else if (sHash.indexOf("wm/tr-to") === 0) {
                this._updateShell("wmTrTo");
            } else if (sHash.indexOf("wm/mvt261/open/") === 0) {
                this._updateShell(/\/cycle$/.test(sHash) ? "wmCycle261" : "wmScan261");
            } else if (sHash.indexOf("wm/mvt261/open") === 0) {
                this._updateShell("wmOpen261");
            } else if (sHash.indexOf("wm/mvt261") === 0) {
                this._updateShell("wmMvt261");
            } else if (sHash.indexOf("wm/handling-unit/") === 0) {
                this._updateShell("wmHandlingUnitDetail");
            } else if (sHash.indexOf("wm/handling-unit") === 0) {
                this._updateShell("wmHandlingUnits");
            } else if (sHash.indexOf("le/orders-due") === 0) {
                this._updateShell("ordersDueForDelivery");
            } else if (sHash.indexOf("sd/invoices") === 0) {
                this._updateShell("customerInvoices");
            } else if (sHash.indexOf("sd/returns/create") === 0) {
                this._updateShell("createCustomerReturn");
            } else if (sHash.indexOf("sd/returns") === 0) {
                this._updateShell("customerReturns");
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
            this._attachListErrorStates(oEvent.getParameter("view"));
        },

        /**
         * A failed OData read must not look like "no data": every table of the displayed page that is
         * bound to an OData V4 list shows the load error in its no-data area until a read succeeds.
         * A read that fails before the request is sent (e.g. $metadata rejected) raises no dataReceived
         * event; the model reports it as a technical message, so both sources are observed.
         */
        _attachListErrorStates: function (oView) {
            if (!oView || typeof oView.findAggregatedObjects !== "function") {
                return;
            }
            var that = this;
            oView.findAggregatedObjects(true, function (oControl) {
                return oControl.isA && oControl.isA("sap.m.Table");
            }).forEach(function (oTable) {
                var oBinding = oTable.getBinding("items");
                if (!oBinding || oBinding._bLoadErrorState || !oBinding.isA("sap.ui.model.odata.v4.ODataListBinding")) {
                    return;
                }
                oBinding._bLoadErrorState = true;
                var oModel = oBinding.getModel();
                var sNoData = oTable.getNoDataText();
                var fnShow = function (sMessage) {
                    oTable.setNoDataText(sMessage === null ? sNoData : that.getText("listLoadError", [sMessage || ""], "Data could not be loaded: {0}"));
                };
                var fnModelErrors = function () {
                    return Messaging.getMessageModel().getData().filter(function (oMessage) {
                        return oMessage.getMessageProcessor() === oModel && oMessage.getTechnical() && oMessage.getType() === "Error";
                    });
                };

                var aErrors = fnModelErrors();
                var iSeen = aErrors.length;
                if (iSeen && !oBinding.isLengthFinal()) {
                    fnShow(aErrors[iSeen - 1].getMessage()); // the read already failed before this page was shown
                }
                oBinding.attachDataReceived(function (oDataEvent) {
                    var oError = oDataEvent.getParameter("error");
                    fnShow(oError ? oError.message : null);
                });
                // ponytail: one message binding per list table, never released (router views live for the app's lifetime)
                var oMessages = Messaging.getMessageModel().bindList("/");
                oMessages.attachChange(function () {
                    var aNow = fnModelErrors();
                    if (aNow.length > iSeen) {
                        fnShow(aNow[aNow.length - 1].getMessage());
                    }
                    iSeen = aNow.length;
                });
            });
        },

        /** Goods issue routes: shell title key, and for an execution page the list it returns to. */
        _mGoodsIssueTitles: {
            wmGoodsIssue201Pending: "gi201OpenResvTitle",
            wmGoodsIssue201: "gi201PageTitle",
            wmGoodsIssue301Pending: "gi301OpenTransfersTitle",
            wmGoodsIssue301: "gi301PageTitle",
            wmGoodsIssue311Pending: "gi311OpenTransfersTitle",
            wmGoodsIssue311: "gi311PageTitle"
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
                case "salesOrders":
                    sTitle = oBundle ? oBundle.getText("salesOrdersTitle") : "Sales Orders Worklist";
                    bShowNav = true;
                    break;
                case "createSalesOrder":
                    sTitle = oBundle ? oBundle.getText("createSalesOrderTitle") : "Create Sales Order (VA01)";
                    bShowNav = true;
                    break;
                case "wmGoodsIssue201Pending":
                case "wmGoodsIssue201":
                case "wmGoodsIssue301Pending":
                case "wmGoodsIssue301":
                case "wmGoodsIssue311Pending":
                case "wmGoodsIssue311":
                    sTitle = this.getText(this._mGoodsIssueTitles[sRouteName]);
                    bShowNav = true;
                    break;
                case "wmGoodsReceipt":
                    sTitle = oBundle ? oBundle.getText("grPageTitle") : "Goods Receipt against Storage Unit (101)";
                    bShowNav = true;
                    break;
                case "wmTrTo":
                    sTitle = oBundle ? oBundle.getText("trToTitle") : "TO Creation (ZTO)";
                    bShowNav = true;
                    break;
                case "wmScan261":
                    sTitle = oBundle ? oBundle.getText("scan261Title") : "Scan for Goods Issue 261";
                    bShowNav = true;
                    break;
                case "wmCycle261":
                    sTitle = oBundle ? oBundle.getText("cycle261Title") : "261 Cycle";
                    bShowNav = true;
                    break;
                case "wmOpen261":
                    sTitle = oBundle ? oBundle.getText("open261Title") : "Open 261 Items";
                    bShowNav = true;
                    break;
                case "wmMvt261":
                    sTitle = oBundle ? oBundle.getText("mvt261Title") : "First Goods Issue 261";
                    bShowNav = true;
                    break;
                case "wmHandlingUnits":
                    sTitle = oBundle ? oBundle.getText("huTitle") : "Handling Unit Cockpit";
                    bShowNav = true;
                    break;
                case "wmHandlingUnitDetail":
                    sTitle = oBundle ? oBundle.getText("huDetailTitle") : "Handling Unit";
                    bShowNav = true;
                    break;
                case "ordersDueForDelivery":
                    sTitle = oBundle ? oBundle.getText("ordersDueForDeliveryTitle") : "Orders Due for Delivery";
                    bShowNav = true;
                    break;
                case "customerInvoices":
                    sTitle = oBundle ? oBundle.getText("customerInvoicesTitle") : "Customer Invoices";
                    bShowNav = true;
                    break;
                case "customerReturns":
                    sTitle = oBundle ? oBundle.getText("customerReturnsTitle") : "Customer Returns Management";
                    bShowNav = true;
                    break;
                case "createCustomerReturn":
                    sTitle = oBundle ? oBundle.getText("createReturnPageTitle") : "Create Customer Return";
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
            } else if (sRoute === "createSalesOrder") {
                this.onNavBack("salesOrders");
            } else if (sRoute === "createCustomerReturn") {
                this.onNavBack("customerReturns");
            } else if (/^wmGoodsIssue\d{3}$/.test(sRoute)) {
                this.onNavBack(sRoute + "Pending");
            } else if (sRoute === "wmHandlingUnitDetail") {
                this.onNavBack("wmHandlingUnits");
            } else if (sRoute === "purchaseOrders" || sRoute === "journalEntries" || sRoute === "salesInquiries" || sRoute === "salesOrders" || sRoute === "wmGoodsReceipt" || sRoute === "ordersDueForDelivery") {
                this.onNavBack("dashboard");
            } else {
                this.onNavBack("dashboard");
            }
        }
    });
});
