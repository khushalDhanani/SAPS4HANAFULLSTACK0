sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/m/MessageToast",
    "saps4hana/fiori/model/models",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssueService",
    "saps4hana/fiori/modules/wm/goods-receipt/service/GoodsReceiptService",
    "saps4hana/fiori/modules/ewm/warehouse-cockpit/service/EwmService",
    "saps4hana/fiori/modules/mm/purchase-order/service/PurchaseOrderService",
    "saps4hana/fiori/modules/sd/sales-inquiry/service/SalesInquiryService"
], function (UIComponent, Device, MessageToast, models, AuthService, GoodsIssueService, GoodsReceiptService, EwmService, PurchaseOrderService, SalesInquiryService) {
    "use strict";

    return UIComponent.extend("saps4hana.fiori.Component", {
        metadata: {
            manifest: "json",
            interfaces: ["sap.ui.core.IAsyncContentCreation"]
        },

        init: function () {
            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // initialize auth service and bind auth model
            AuthService.init(this);

            // set the device model
            this.setModel(models.createDeviceModel(), "device");

            // Wire OData V4 models to services for entity set reads
            var oGoodsIssueModel = this.getModel("goodsIssue");
            if (oGoodsIssueModel && GoodsIssueService && typeof GoodsIssueService.setModel === "function") {
                GoodsIssueService.setModel(oGoodsIssueModel);
            }
            var oGoodsReceiptModel = this.getModel("goodsReceipt");
            if (oGoodsReceiptModel && GoodsReceiptService && typeof GoodsReceiptService.setModel === "function") {
                GoodsReceiptService.setModel(oGoodsReceiptModel);
            }
            var oWarehouseMgmtModel = this.getModel("warehouseMgmt");
            if (oWarehouseMgmtModel && EwmService && typeof EwmService.setModel === "function") {
                EwmService.setModel(oWarehouseMgmtModel);
            }
            var oPoModel = this.getModel();
            if (oPoModel && PurchaseOrderService && typeof PurchaseOrderService.setModel === "function") {
                PurchaseOrderService.setModel(oPoModel);
            }
            var oSalesInquiryModel = this.getModel("salesInquiry");
            if (oSalesInquiryModel && SalesInquiryService && typeof SalesInquiryService.setModel === "function") {
                SalesInquiryService.setModel(oSalesInquiryModel);
            }

            // Synchronize active authentication headers across all OData V4 models before routing starts
            AuthService.syncModelHeaders(this);

            // setup routing and route guard
            var oRouter = this.getRouter();
            oRouter.attachRouteMatched(this._onRouteMatched, this);

            // Also listen for hash changes that the router might not fire routeMatched for
            // (e.g. when hash is set to the same value as current)
            var oHashChanger = oRouter.getHashChanger();
            if (oHashChanger) {
                oHashChanger.attachEvent("hashChanged", this._onHashChanged, this);
            }

            // Ensure static area (dialogs, popovers, value helps) receives compact density
            if (typeof document !== "undefined") {
                var fnEnsureStaticCompact = function () {
                    var oStatic = document.getElementById("sap-ui-static");
                    if (oStatic && !oStatic.classList.contains("sapUiSizeCompact")) {
                        oStatic.classList.add("sapUiSizeCompact");
                    }
                };
                fnEnsureStaticCompact();
                if (typeof MutationObserver !== "undefined" && document.body) {
                    var oStaticObserver = new MutationObserver(function () {
                        fnEnsureStaticCompact();
                    });
                    oStaticObserver.observe(document.body, { childList: true });
                }
            }

            oRouter.initialize();
        },

        /**
         * Returns the content density class for the application.
         * Official SAPUI5 Compact Density is applied across the entire application.
         *
         * @returns {string} "sapUiSizeCompact"
         */
        getContentDensityClass: function () {
            if (!this._sContentDensityClass) {
                this._sContentDensityClass = "sapUiSizeCompact";
            }
            return this._sContentDensityClass;
        },

        /**
         * Route guard — enforces authentication on every route change.
         * Uses attachRouteMatched (fires after route resolves) so that
         * navigation reliably replaces the current view.
         */
        _onRouteMatched: function (oEvent) {
            var sRouteName = oEvent.getParameter("name");
            var bIsAuth = AuthService.isAuthenticated();
            var oRouter = this.getRouter();

            if (sRouteName === "login") {
                if (bIsAuth) {
                    oRouter.navTo("dashboard", {}, true);
                }
                return;
            }

            // If already authenticated, proceed normally
            if (bIsAuth) {
                return;
            }

            // In deployed / XSUAA environments, probe for SSO user info before redirecting
            var that = this;
            AuthService.fetchCurrentUserInfo().then(function (oUser) {
                if (oUser && oUser.username) {
                    // Authenticated via SSO/XSUAA; stay on route
                    return;
                }
                // Unauthenticated in local environment — redirect to login
                var oI18n = that.getModel("i18n");
                var sMsg = "Authentication required. Please sign in to access SAP S/4HANA.";
                if (oI18n) {
                    var oBundle = oI18n.getResourceBundle();
                    if (oBundle) {
                        sMsg = oBundle.getText("authRequiredMsg") || sMsg;
                    }
                }
                MessageToast.show(sMsg);
                oRouter.navTo("login", {}, true);
            });
        },

        /**
         * Fallback guard — catches hash changes that routeMatched might miss
         * (e.g. browser back button after logout, or same-hash navigation).
         */
        _onHashChanged: function (oEvent) {
            var sNewHash = oEvent.getParameter("newHash") || "";
            var bIsAuth = AuthService.isAuthenticated();

            // If authenticated and landing on empty hash or login, redirect to dashboard
            if (bIsAuth && (sNewHash === "" || sNewHash === "login")) {
                window.location.hash = "dashboard";
            }
        }
    });
});
