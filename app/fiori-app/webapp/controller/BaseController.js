sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "sap/ui/core/UIComponent",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/model/formatter"
], function (
    Controller,
    Fragment,
    MessageBox,
    MessageToast,
    History,
    UIComponent,
    AuthService,
    formatter
) {
    "use strict";

    return Controller.extend("saps4hana.fiori.controller.BaseController", {
        formatter: formatter,

        /**
         * Convenience method for accessing the router in every controller of the application.
         * @returns {sap.ui.core.routing.Router} the router for this component
         */
        getRouter: function () {
            var oComp = this.getOwnerComponent();
            return oComp ? oComp.getRouter() : (UIComponent ? UIComponent.getRouterFor(this) : null);
        },

        /**
         * Convenience method for getting a model by name from view or owner component.
         * @param {string} [sName] the model name
         * @returns {sap.ui.model.Model|null}
         */
        getModel: function (sName) {
            return (this.getView() && this.getView().getModel(sName)) ||
                   (this.getOwnerComponent() && this.getOwnerComponent().getModel(sName)) ||
                   null;
        },

        /**
         * Convenience method for getting the resource bundle text.
         * @param {string} sKey the key of the text
         * @param {string[]} [aArgs] optional arguments
         * @param {string} [sFallback] optional fallback string if bundle or key is missing
         * @returns {string} the localized text or key/fallback
         */
        getText: function (sKey, aArgs, sFallback) {
            var oResourceModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("i18n") : (this.getView() ? this.getView().getModel("i18n") : null);
            var oBundle = oResourceModel ? oResourceModel.getResourceBundle() : null;
            if (oBundle) {
                var sFound = oBundle.getText(sKey, aArgs);
                if (sFound !== sKey) {
                    return sFound;
                }
            }
            if (sFallback !== undefined) {
                var sResult = sFallback;
                if (Array.isArray(aArgs) && aArgs.length > 0) {
                    aArgs.forEach(function (arg, idx) {
                        sResult = sResult.replace(new RegExp("\\{" + idx + "\\}", "g"), arg);
                    });
                }
                return sResult;
            }
            return oBundle ? oBundle.getText(sKey, aArgs) : sKey;
        },

        /**
         * Returns the content density class for the application.
         * Official SAPUI5 Compact Density is applied across the entire application.
         *
         * @returns {string} "sapUiSizeCompact"
         */
        getContentDensityClass: function () {
            var oComp = this.getOwnerComponent();
            return (oComp && oComp.getContentDensityClass) ? oComp.getContentDensityClass() : "sapUiSizeCompact";
        },

        /**
         * Convenience method to set the view busy state.
         * @param {boolean} bBusy whether the view is busy
         */
        setBusy: function (bBusy) {
            var oView = this.getView();
            if (oView) {
                oView.setBusy(bBusy);
            }
        },

        /**
         * Computes procurement KPI metrics from a sap.m.Table updateFinished event.
         * Shows live total count from the binding's $count parameter (or '-' if absent).
         * Eliminates synthetic / page-scoped supplier counts and completeness rates.
         *
         * @param {sap.m.Table} oTable
         * @param {sap.ui.base.Event} [oEvent]
         * @returns {{ totalCount: number|string }}
         */
        calculateKpiMetrics: function (oTable, oEvent) {
            var iTotal = null;
            if (oEvent && typeof oEvent.getParameter === "function") {
                var vTotal = oEvent.getParameter("total");
                if (typeof vTotal === "number" && !isNaN(vTotal)) {
                    iTotal = vTotal;
                }
            }

            return {
                totalCount: iTotal !== null ? iTotal : "-"
            };
        },

        /**
         * Opens the User Profile popover anchored to the source button.
         *
         * @param {sap.ui.base.Event} oEvent
         */
        onOpenUserProfile: function (oEvent) {
            var oButton = oEvent.getSource();
            var that = this;

            if (!this._pUserProfilePopover) {
                this._pUserProfilePopover = Fragment.load({
                    id: this.getView().getId(),
                    name: "saps4hana.fiori.fragment.UserProfilePopover",
                    controller: this
                }).then(function (oPopover) {
                    that.getView().addDependent(oPopover);
                    oPopover.addStyleClass(that.getContentDensityClass());
                    return oPopover;
                });
            }

            this._pUserProfilePopover.then(function (oPopover) {
                oPopover.openBy(oButton);
            });
        },

        /**
         * Closes popover and triggers logout dialog.
         */
        onLogoutPress: function () {
            if (this._pUserProfilePopover) {
                this._pUserProfilePopover.then(function (oPopover) {
                    oPopover.close();
                });
            }
            this.onLogout();
        },

        /**
         * Confirms and executes user logout.
         */
        onLogout: function () {
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            MessageBox.confirm(oBundle.getText("logoutConfirmMsg"), {
                title: oBundle.getText("logoutConfirmTitle"),
                icon: MessageBox.Icon.WARNING,
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.NO,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        AuthService.logout();
                        MessageToast.show(oBundle.getText("logoutSuccessMsg"));
                        window.location.hash = "login";
                    }
                }
            });
        },

        /**
         * Handles table item press to show Purchase Order detail dialog.
         *
         * @param {sap.ui.base.Event} oEvent
         */
        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem ? oItem.getBindingContext() : null;
            if (!oContext) {
                return;
            }
            this.openPoDetailDialog(oContext);
        },

        /**
         * Loads and opens the Purchase Order detail dialog bound to the entity context.
         *
         * @param {sap.ui.model.Context} oContext
         */
        openPoDetailDialog: function (oContext) {
            var that = this;
            if (!this._pPoDetailDialog) {
                this._pPoDetailDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "saps4hana.fiori.fragment.PurchaseOrderDetailDialog",
                    controller: this
                }).then(function (oDialog) {
                    that.getView().addDependent(oDialog);
                    oDialog.addStyleClass(that.getContentDensityClass());
                    return oDialog;
                });
            }

            this._pPoDetailDialog.then(function (oDialog) {
                oDialog.setBindingContext(oContext);
                oDialog.open();
            });
        },

        /**
         * Closes the Purchase Order detail dialog.
         */
        onClosePoDetailDialog: function () {
            if (this._pPoDetailDialog) {
                this._pPoDetailDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        /**
         * Navigates back in the browser history, or to a fallback route if history is empty.
         *
         * @param {string} sFallbackRoute The route name to fallback to
         */
        onNavBack: function (sFallbackRoute) {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                var oRouter = this.getOwnerComponent().getRouter();
                oRouter.navTo(sFallbackRoute, {}, true /*no history*/);
            }
        }
    });
});
