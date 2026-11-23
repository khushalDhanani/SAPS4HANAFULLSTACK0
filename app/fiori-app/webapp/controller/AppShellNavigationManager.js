sap.ui.define([], function () {
    "use strict";

    function createAppShellNavigationManager(options) {
        options = options || {};
        var Messaging = options.Messaging;
        var Device = options.Device;
        var ThemeService = options.ThemeService;
        var AuthService = options.AuthService;

        return {
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
                        fnShow(aErrors[iSeen - 1].getMessage());
                    }
                    oBinding.attachDataReceived(function (oDataEvent) {
                        var oError = oDataEvent.getParameter("error");
                        fnShow(oError ? oError.message : null);
                    });
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

            isAdmin: function () {
                return AuthService.hasAnyRole(["Admin"]);
            },

            canReadLogs: function () {
                return AuthService.hasAnyRole(["Admin", "SapLogsReader"]);
            },

            onSideNavItemPress: function (oEvent) {
                var oItem = oEvent.getParameter("item");
                if (!oItem.getSelectable()) {
                    return;
                }
                var sKey = oItem.getKey();
                this.getOwnerComponent().getRouter().navTo("dashboard", sKey === "overview" ? {} : { section: sKey });
                if (Device.system.phone) {
                    this.byId("appToolPage").setSideExpanded(false);
                }
            },

            onMenuButtonPressed: function () {
                this.byId("appToolPage").toggleSideContentMode();
            },

            onThemeMenuPressed: function (oEvent) {
                this.byId("shellThemeMenu").openBy(oEvent.getSource());
            },

            onThemeSelected: function (oEvent) {
                var sTheme = oEvent.getParameter("item").getKey();
                ThemeService.applyTheme(sTheme);
                this._oShellModel.setProperty("/theme", sTheme);
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createAppShellNavigationManager: createAppShellNavigationManager
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
