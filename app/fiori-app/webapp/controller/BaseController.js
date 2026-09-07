sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/model/formatter"
], function (
    Controller,
    Fragment,
    MessageBox,
    MessageToast,
    History,
    AuthService,
    formatter
) {
    "use strict";

    return Controller.extend("saps4hana.fiori.controller.BaseController", {
        formatter: formatter,

        /**
         * Computes procurement KPI metrics (totalCount, supplierCount, completeRate)
         * from a sap.m.Table updateFinished event.
         *
         * @param {sap.m.Table} oTable
         * @param {sap.ui.base.Event} [oEvent]
         * @returns {{ totalCount: number, supplierCount: number, completeRate: number }}
         */
        calculateKpiMetrics: function (oTable, oEvent) {
            var aItems = oTable ? oTable.getItems() : [];
            var iTotal = (oEvent && oEvent.getParameter("total")) || aItems.length;

            var oSuppliers = {};
            var iCompleted = 0;

            aItems.forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                if (oContext) {
                    var sSupplier = oContext.getProperty("Supplier");
                    if (sSupplier) {
                        oSuppliers[sSupplier] = true;
                    }
                    if (oContext.getProperty("PurchasingCompletenessStatus")) {
                        iCompleted++;
                    }
                }
            });

            var iSupplierCount = Object.keys(oSuppliers).length;
            var iRate = aItems.length > 0 ? Math.round((iCompleted / aItems.length) * 100) : 100;

            return {
                totalCount: iTotal,
                supplierCount: iSupplierCount > 0 ? iSupplierCount : iTotal,
                completeRate: iRate
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
