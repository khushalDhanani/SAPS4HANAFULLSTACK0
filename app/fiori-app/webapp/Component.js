sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/m/MessageToast",
    "saps4hana/fiori/model/models",
    "saps4hana/fiori/service/AuthService"
], function (UIComponent, Device, MessageToast, models, AuthService) {
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

            // setup routing and route guard
            var oRouter = this.getRouter();
            oRouter.attachRouteMatched(this._onRouteMatched, this);

            // Also listen for hash changes that the router might not fire routeMatched for
            // (e.g. when hash is set to the same value as current)
            var oHashChanger = oRouter.getHashChanger();
            if (oHashChanger) {
                oHashChanger.attachEvent("hashChanged", this._onHashChanged, this);
            }

            oRouter.initialize();
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

            // Default route and login route both show the Login page
            if (sRouteName === "login" || sRouteName === "default") {
                if (bIsAuth) {
                    oRouter.navTo("dashboard", {}, true);
                }
                return;
            }

            // Protected routes — redirect unauthenticated users to login
            if (!bIsAuth) {
                var oI18n = this.getModel("i18n");
                var sMsg = "Authentication required. Please sign in to access SAP S/4HANA.";
                if (oI18n) {
                    var oBundle = oI18n.getResourceBundle();
                    if (oBundle) {
                        sMsg = oBundle.getText("authRequiredMsg") || sMsg;
                    }
                }
                MessageToast.show(sMsg);
                oRouter.navTo("login", {}, true);
            }
        },

        /**
         * Fallback guard — catches hash changes that routeMatched might miss
         * (e.g. browser back button after logout, or same-hash navigation).
         */
        _onHashChanged: function (oEvent) {
            var sNewHash = oEvent.getParameter("newHash") || "";
            var bIsAuth = AuthService.isAuthenticated();

            // If not authenticated and trying to access a protected route, force login hash
            if (!bIsAuth && sNewHash !== "login" && sNewHash !== "") {
                window.location.hash = "login";
            }

            // If authenticated and landing on empty hash or login, redirect to dashboard
            if (bIsAuth && (sNewHash === "" || sNewHash === "login")) {
                window.location.hash = "dashboard";
            }
        }
    });
});
