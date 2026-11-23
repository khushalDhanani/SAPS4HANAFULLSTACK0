(function () {
    "use strict";

    function createOrdersDueDeliveryCreator(deps) {
        deps = deps || {};
        var Fragment = deps.Fragment;
        var MessageBox = deps.MessageBox;
        var OutboundDeliveryService = deps.OutboundDeliveryService;

        return {
            onCreateDeliveryPress: function (oEvent) {
                var oCtx = oEvent.getSource().getBindingContext("outboundDelivery");
                if (!oCtx) return;

                var sSalesOrder = oCtx.getProperty("SalesOrder");
                var sDelivBlock = oCtx.getProperty("DelivBlockReasonForSchedLine");
                var sApprovalStatus = oCtx.getProperty("SalesDocApprovalStatus");

                if (sApprovalStatus === "unknown") {
                    MessageBox.warning(this._text("msgOrderApprovalUnknown", "Approval status for Sales Order {0} could not be verified from S/4HANA. Delivery creation is blocked until status is confirmed.", [sSalesOrder]));
                    return;
                }
                if (sApprovalStatus === "A") {
                    MessageBox.warning(this._text("msgOrderInApproval", "Sales Order {0} is currently in approval (SAP Flexible Workflow). It must be approved in SAP (My Inbox or Manage Sales Orders) before an outbound delivery can be created.", [sSalesOrder]));
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
                if (sDelivBlock) {
                    MessageBox.warning(this._text("msgOrderDeliveryBlocked", "Sales Order {0} has a delivery block ({1}) and cannot be delivered.", [sSalesOrder, sDelivBlock]));
                    return;
                }

                var oDialogModel = this.getView().getModel("deliveryDialog");
                var sShippingPoint = oCtx.getProperty("ShippingPoint") || "";
                var sGoodsIssueDate = oCtx.getProperty("GoodsIssueDate") || this._getTodayDateString();

                if (oDialogModel) {
                    oDialogModel.setProperty("/salesOrder", sSalesOrder);
                    oDialogModel.setProperty("/shippingPoint", sShippingPoint);
                    oDialogModel.setProperty("/shippingPointValueState", "None");
                    oDialogModel.setProperty("/shippingPointValueStateText", "");
                    oDialogModel.setProperty("/deliveryDate", sGoodsIssueDate);
                }

                this._openCreateDeliveryDialog();
            },

            onShippingPointChange: function (oEvent) {
                var sKey = oEvent.getParameter("selectedItem")
                    ? oEvent.getParameter("selectedItem").getKey()
                    : (oEvent.getSource().getSelectedKey() || oEvent.getSource().getValue());
                var oDialogModel = this.getView().getModel("deliveryDialog");
                if (oDialogModel) {
                    oDialogModel.setProperty("/shippingPoint", sKey);
                    if (sKey && String(sKey).trim()) {
                        oDialogModel.setProperty("/shippingPointValueState", "None");
                        oDialogModel.setProperty("/shippingPointValueStateText", "");
                    }
                }
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
                if (this._bDialogBusy) return;
                var that = this;
                var oDialogModel = this.getView().getModel("deliveryDialog");
                var sSalesOrder = oDialogModel.getProperty("/salesOrder");
                var sShippingPoint = oDialogModel.getProperty("/shippingPoint");
                var sDeliveryDate = oDialogModel.getProperty("/deliveryDate");

                if (!sSalesOrder) {
                    MessageBox.error(this._text("msgSalesOrderRequired", "Sales Order is required."));
                    return;
                }
                if (this._oUnconfirmedOrders && this._oUnconfirmedOrders[sSalesOrder]) {
                    MessageBox.warning(this._oUnconfirmedOrders[sSalesOrder]);
                    return;
                }
                if (!sShippingPoint || !String(sShippingPoint).trim()) {
                    var sRequiredMsg = this._text("msgShippingPointRequired", "Shipping Point is required. Please choose a valid shipping point from TVSTZ.");
                    if (oDialogModel) {
                        oDialogModel.setProperty("/shippingPointValueState", "Error");
                        oDialogModel.setProperty("/shippingPointValueStateText", sRequiredMsg);
                    }
                    MessageBox.error(sRequiredMsg);
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
                            var oFollowUp = that.getView().getModel("deliveryFollowUp");
                            if (oFollowUp) {
                                oFollowUp.setProperty("/delivery", String(sDeliveryNo));
                                oFollowUp.setProperty("/billingTypes", []);
                                oFollowUp.setProperty("/billingType", "");
                                that.onLoadDeliveryStatus();
                            }
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
                        var sErrorMessage = (err && (err.message || err.statusText)) || "Failed to create outbound delivery.";
                        var sNotConfirmed = that.blockSubmitIfNotConfirmed(oDialogModel, sErrorMessage);
                        if (sNotConfirmed) {
                            that._oUnconfirmedOrders = that._oUnconfirmedOrders || {};
                            that._oUnconfirmedOrders[sSalesOrder] = sNotConfirmed;
                        }
                        MessageBox.error(sNotConfirmed || sErrorMessage);
                    })
                    .finally(function () {
                        that._setDialogBusy(false);
                    });
            },

            _setDialogBusy: function (bBusy) {
                this._bDialogBusy = bBusy;
                if (this._pCreateDeliveryDialog) {
                    this._pCreateDeliveryDialog.then(function (oDialog) {
                        oDialog.setBusy(bBusy);
                    });
                }
            }
        };
    }

    var oExports = {
        createOrdersDueDeliveryCreator: createOrdersDueDeliveryCreator
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oExports;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oExports;
        });
    }
})();
