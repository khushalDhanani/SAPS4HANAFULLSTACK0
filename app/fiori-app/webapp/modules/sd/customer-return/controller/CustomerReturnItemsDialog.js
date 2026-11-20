sap.ui.define([], function () {
    "use strict";

    function createCustomerReturnItemsDialog(options) {
        options = options || {};
        var Fragment = options.Fragment;
        var CustomerReturnService = options.CustomerReturnService;

        return {
            onViewItemsPress: function (oEvent) {
                var that = this;
                var oButton = oEvent.getSource();
                var oContext = oButton.getBindingContext("customerReturn");
                if (!oContext) {
                    return;
                }

                var sReturnNumber = oContext.getProperty("CustomerReturn");
                var oViewModel = this.getView().getModel("customerReturnsView");
                oViewModel.setProperty("/selectedReturnNumber", sReturnNumber);
                oViewModel.setProperty("/returnItems", []);

                this._openReturnItemsDialog().then(function (oDialog) {
                    if (oDialog.setBusy) {
                        oDialog.setBusy(true);
                    }
                    CustomerReturnService.getCustomerReturnItems(sReturnNumber, that.getView().getModel("customerReturn"))
                        .then(function (aItems) {
                            if (oDialog.setBusy) {
                                oDialog.setBusy(false);
                            }
                            oViewModel.setProperty("/returnItems", Array.isArray(aItems) ? aItems : []);
                        })
                        .catch(function () {
                            if (oDialog.setBusy) {
                                oDialog.setBusy(false);
                            }
                            oViewModel.setProperty("/returnItems", []);
                        });
                });
            },

            _openReturnItemsDialog: function () {
                var that = this;
                if (!this._pItemsDialog) {
                    var sViewId = (this.getView && typeof this.getView().getId === "function") ? this.getView().getId() : undefined;
                    this._pItemsDialog = Fragment.load({
                        id: sViewId,
                        name: "saps4hana.fiori.modules.sd.customer-return.view.ReturnItemsDialog",
                        controller: this
                    }).then(function (oDialog) {
                        that.getView().addDependent(oDialog);
                        return oDialog;
                    });
                }

                return this._pItemsDialog.then(function (oDialog) {
                    that._oItemsDialog = oDialog;
                    oDialog.open();
                    return oDialog;
                });
            },

            onCloseReturnItemsDialog: function () {
                if (this._oItemsDialog) {
                    this._oItemsDialog.close();
                }
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createCustomerReturnItemsDialog: createCustomerReturnItemsDialog
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
