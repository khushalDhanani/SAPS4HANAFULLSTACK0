sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Messaging",
    "sap/ui/Device",
    "saps4hana/fiori/service/ThemeService",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/controller/AppShellRouteTitleManager",
    "saps4hana/fiori/controller/AppShellNavigationManager"
], function (
    BaseController,
    JSONModel,
    Messaging,
    Device,
    ThemeService,
    AuthService,
    AppShellRouteTitleManager,
    AppShellNavigationManager
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modTitles = req(AppShellRouteTitleManager, "./AppShellRouteTitleManager");
    var modNav = req(AppShellNavigationManager, "./AppShellNavigationManager");

    var fnTitles = typeof createAppShellRouteTitleManager === "function" ? createAppShellRouteTitleManager : (modTitles && modTitles.createAppShellRouteTitleManager);
    var fnNav = typeof createAppShellNavigationManager === "function" ? createAppShellNavigationManager : (modNav && modNav.createAppShellNavigationManager);

    var mTitles = typeof fnTitles === "function" ? fnTitles() : {};
    var mNav = typeof fnNav === "function" ? fnNav({
        Messaging: Messaging,
        Device: Device,
        ThemeService: ThemeService,
        AuthService: AuthService
    }) : {};

    var oMembers = {
        onInit: function () {
            this._sCurrentRoute = "";
            var sLogoPath = sap.ui.require.toUrl("saps4hana/fiori/assets/AeElementally.png");
            this._oShellModel = new JSONModel({
                currentTitle: "",
                showNavButton: false,
                sideNavKey: "overview",
                theme: ThemeService.getSavedTheme(),
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

        _onRouteMatched: function (oEvent) {
            var sRouteName = oEvent.getParameter("name");
            var oArgs = oEvent.getParameter("arguments");
            this._oLastArgs = oArgs;
            this._updateShell(sRouteName, oArgs);
            this._attachListErrorStates(oEvent.getParameter("view"));
        }
    };

    Object.assign(oMembers, mTitles, mNav);

    var ControllerClass = BaseController.extend("saps4hana.fiori.controller.App", oMembers);
    Object.assign(ControllerClass.prototype || ControllerClass, mTitles, mNav);

    return ControllerClass;
});
