sap.ui.define([], function () {
    "use strict";

    function createSalesOrderDeliveryActions(options) {
        options = options || {};
        var Fragment = options.Fragment;
        var MessageBox = options.MessageBox;
        var OutboundDeliveryService = options.OutboundDeliveryService;

        return {
            _getTodayDateString: function () {
                var d = new Date();
                var sMonth = String(d.getMonth() + 1).padStart(2, "0");
                var sDay = String(d.getDate()).padStart(2, "0");
                return d.getFullYear() + "-" + sMonth + "-" + sDay;
            },

            onCreateDeliveryPress: function (oEvent) {
                var oCtx = oEvent.getSource().getBindingContext("salesOrder");
                if (!oCtx) return;

                var sSalesOrder = oCtx.getProperty("SalesOrder");
                var sApprovalStatus = oCtx.getProperty("SalesDocApprovalStatus");
                var sDeliveryBlock = oCtx.getProperty("DeliveryBlockReason");

                if (sApprovalStatus === "unknown") {
                    MessageBox.warning(this._text("msgOrderApprovalUnknown", "Approval status for Sales Order {0} could not be verified from S/4HANA. Delivery creation is blocked until status is confirmed.", [sSalesOrder]));
                    return;
                }
                if (sApprovalStatus === "A") {
                    MessageBox.warning(this._text("msgOrderInApproval", "Sales Order {0} is currently in approval and cannot be delivered.", [sSalesOrder]));
                    return;
                }
                if (sApprovalStatus === "C") {
                    MessageBox.warning(this._text("msgOrderRejected", "Sales Order {0} has been rejected and cannot be delivered.", [sSalesOrder]));
                    return;
                }
                if (sApprovalStatus === "D") {
                    MessageBox.warning(this._text("msgOrderRework", "Sales Order {0} is being reworked and cannot be delivered.", [sSalesOrder]));
                    return;
                }
                if (sDeliveryBlock) {
                    MessageBox.warning(this._text("msgOrderDeliveryBlocked", "Sales Order {0} has a delivery block ({1}) and cannot be delivered.", [sSalesOrder, sDeliveryBlock]));
                    return;
                }

                var oDialogModel = this.getView().getModel("deliveryDialog");
                if (oDialogModel) {
                    oDialogModel.setProperty("/salesOrder", sSalesOrder);
                    // The sales order worklist has no ShippingPoint; the user enters it in the dialog
                    oDialogModel.setProperty("/shippingPoint", "");
                    oDialogModel.setProperty("/deliveryDate", this._getTodayDateString());
                }

                this._openCreateDeliveryDialog();
            },

            _openCreateDeliveryDialog: function () {
                var oView = this.getView();
                var that = this;

                if (!this._pCreateDeliveryDialog) {
                    this._pCreateDeliveryDialog = Fragment.load({
                        id: oView.getId(),
                        name: "saps4hana.fiori.modules.le.outbound-delivery.view.CreateDeliveryDialog",
                        controller: this
                    }).then(function (oDialog) {
                        oView.addDependent(oDialog);
                        if (oDialog.addStyleClass && that.getContentDensityClass) {
                            oDialog.addStyleClass(that.getContentDensityClass());
                        }
                        return oDialog;
                    });
                }

                this._pCreateDeliveryDialog.then(function (oDialog) {
                    oDialog.open();
                });
            },

            onCancelCreateDelivery: function () {
                if (this._pCreateDeliveryDialog) {
                    this._pCreateDeliveryDialog.then(function (oDialog) {
                        oDialog.close();
                    });
                }
            },

            onConfirmCreateDelivery: function () {
                var that = this;
                var oDialogModel = this.getView().getModel("deliveryDialog");
                var sSalesOrder = oDialogModel.getProperty("/salesOrder");
                var sShippingPoint = oDialogModel.getProperty("/shippingPoint");
                var sDeliveryDate = oDialogModel.getProperty("/deliveryDate");

                if (!sSalesOrder) {
                    MessageBox.error(this._text("msgSalesOrderRequired", "Sales Order is required."));
                    return;
                }
                if (!sShippingPoint) {
                    MessageBox.error(this._text("msgShippingPointRequired", "Shipping Point is required."));
                    return;
                }

                this._setDialogBusy(true);

                OutboundDeliveryService.createOutboundDelivery({
                    salesOrder: sSalesOrder,
                    shippingPoint: sShippingPoint,
                    deliveryDate: sDeliveryDate
                })
                    .then(function (sDeliveryNo) {
                        that.onCancelCreateDelivery();
                        if (sDeliveryNo && String(sDeliveryNo).trim() !== "" && sDeliveryNo !== "Delivery created") {
                            var sSuccessTemplate = that._text("msgDeliveryCreatedSuccess", "Delivery {0} created");
                            var sSuccessMessage = sSuccessTemplate.replace("{0}", sDeliveryNo);
                            MessageBox.success(sSuccessMessage, {
                                onClose: function () {
                                    that.onRefresh();
                                }
                            });
                        } else {
                            var sWarningTemplate = that._text(
                                "msgDeliveryCreatedNoNumberWarning",
                                "Delivery created in SAP S/4HANA for Sales Order {0}, but no delivery number was returned. Please check transaction VL03N."
                            );
                            var sWarningMessage = sWarningTemplate.replace("{0}", sSalesOrder);
                            MessageBox.warning(sWarningMessage, {
                                onClose: function () {
                                    that.onRefresh();
                                }
                            });
                        }
                    })
                    .catch(function (err) {
                        // Show SAP's own message on failure
                        var sErrorMessage = (err && (err.message || err.statusText)) || "Failed to create outbound delivery.";
                        MessageBox.error(sErrorMessage);
                    })
                    .finally(function () {
                        that._setDialogBusy(false);
                    });
            },

            _setDialogBusy: function (bBusy) {
                if (this._pCreateDeliveryDialog) {
                    this._pCreateDeliveryDialog.then(function (oDialog) {
                        oDialog.setBusy(bBusy);
                    });
                }
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createSalesOrderDeliveryActions: createSalesOrderDeliveryActions
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
