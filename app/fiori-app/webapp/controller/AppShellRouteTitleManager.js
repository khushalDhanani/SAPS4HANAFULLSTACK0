sap.ui.define([], function () {
    "use strict";

    // First segment of a route pattern -> the dashboard section the sidebar highlights for that screen
    var SECTION_BY_ROUTE_PREFIX = { mm: "mm", sd: "sd", le: "sd", wm: "ewm", pm: "pm" };

    function createAppShellRouteTitleManager() {
        return {
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
                } else if (sHash.indexOf("wm/handling-unit/") === 0) {
                    this._updateShell("wmHandlingUnitDetail");
                } else if (sHash.indexOf("wm/handling-unit") === 0) {
                    this._updateShell("wmHandlingUnits");
                } else if (sHash.indexOf("wm/packing-instruction/") === 0) {
                    this._updateShell("wmPackingInstructionDetail");
                } else if (sHash.indexOf("wm/packing-instruction") === 0) {
                    this._updateShell("wmPackingInstructions");
                } else if (sHash.indexOf("wm/quarantine-labels") === 0) {
                    this._updateShell("wmQuarantineLabels");
                } else if (sHash.indexOf("wm/mib-label") === 0) {
                    this._updateShell("wmMibLabel");
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
                } else if (sHash.indexOf("pm/maintenance-orders") === 0) {
                    this._updateShell("maintenanceOrders");
                }
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

                    case "wmHandlingUnits":
                        sTitle = oBundle ? oBundle.getText("huTitle") : "Handling Unit Cockpit";
                        bShowNav = true;
                        break;
                    case "wmHandlingUnitDetail":
                        sTitle = oBundle ? oBundle.getText("huDetailTitle") : "Handling Unit";
                        bShowNav = true;
                        break;
                    case "wmPackingInstructions":
                        sTitle = oBundle ? oBundle.getText("piTitle") : "Packing Instructions";
                        bShowNav = true;
                        break;
                    case "wmQuarantineLabels":
                        sTitle = oBundle ? oBundle.getText("qlTitle") : "Quarantine Labels";
                        bShowNav = true;
                        break;
                    case "wmMibLabel":
                        sTitle = oBundle ? oBundle.getText("mibPageTitle") : "Material Issued Batch Sticker";
                        bShowNav = true;
                        break;
                    case "wmPackingInstructionDetail":
                        sTitle = oBundle ? oBundle.getText("piDetailTitle") : "Packing Instruction";
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
                    case "maintenanceOrders":
                        sTitle = oBundle ? oBundle.getText("maintOrdersShellTitle") : "Maintenance Orders";
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
                this._oShellModel.setProperty("/sideNavKey", this._getSideNavKey(sRouteName, oArgs));
            },

            _getSideNavKey: function (sRouteName, oArgs) {
                if (sRouteName === "dashboard") {
                    var sSection = oArgs && oArgs.section;
                    if (sSection === "user-master") {
                        return this.isAdmin() ? "user-master" : "overview";
                    }
                    if (sSection === "sap-logs") {
                        return this.canReadLogs() ? "sap-logs" : "overview";
                    }
                    return ["mm", "sd", "ewm", "pm"].indexOf(sSection) === -1 ? "overview" : sSection;
                }
                var oRoute = this.getOwnerComponent().getRouter().getRoute(sRouteName);
                return SECTION_BY_ROUTE_PREFIX[oRoute ? oRoute.getPattern().split("/")[0] : ""] || "overview";
            },

            onHomeIconPressed: function () {
                var oRouter = this.getOwnerComponent().getRouter();
                if (oRouter) {
                    oRouter.navTo("dashboard", {}, true);
                }
            },

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
                } else if (sRoute === "wmHandlingUnitDetail") {
                    this.onNavBack("wmHandlingUnits");
                } else if (sRoute === "wmPackingInstructionDetail") {
                    this.onNavBack("wmPackingInstructions");
                } else if (sRoute === "purchaseOrders" || sRoute === "salesInquiries" || sRoute === "salesOrders" || sRoute === "ordersDueForDelivery") {
                    this.onNavBack("dashboard");
                } else {
                    this.onNavBack("dashboard");
                }
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        SECTION_BY_ROUTE_PREFIX: SECTION_BY_ROUTE_PREFIX,
        createAppShellRouteTitleManager: createAppShellRouteTitleManager
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
