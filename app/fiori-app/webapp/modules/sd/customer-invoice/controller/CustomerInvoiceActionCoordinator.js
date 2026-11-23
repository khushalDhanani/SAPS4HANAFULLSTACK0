sap.ui.define([], function () {
    "use strict";

    function createCustomerInvoiceActionCoordinator(options) {
        options = options || {};
        var Fragment = options.Fragment;
        var Messaging = options.Messaging;
        var BusyIndicator = options.BusyIndicator;
        var MessageBox = options.MessageBox;
        var CustomerInvoiceService = options.CustomerInvoiceService;
        var JSONModel = options.JSONModel;

        return {
            onToolbarReleasePress: function () {
                var oViewModel = this.getView().getModel("customerInvoicesView");
                var oSelected = oViewModel.getProperty("/selectedInvoice");
                if (!oSelected || !oSelected.BillingDocument) {
                    return;
                }
                var sETag = (oSelected && (oSelected["@odata.etag"] || oSelected.ETag || oSelected.etag)) || "";
                this._confirmAndReleaseInvoice(oSelected.BillingDocument, sETag);
            },

            onToolbarCancelPress: function () {
                var oViewModel = this.getView().getModel("customerInvoicesView");
                var oSelected = oViewModel.getProperty("/selectedInvoice");
                if (!oSelected || !oSelected.BillingDocument) {
                    return;
                }
                this._openCancelDialog(oSelected);
            },

            onReleaseToAccountingPress: function (oEvent) {
                var oContext = oEvent.getSource().getBindingContext("customerInvoice");
                if (!oContext) return;
                var oData = oContext.getObject();
                var sETag = (oData && (oData["@odata.etag"] || oData.ETag || oData.etag)) || "";
                this._confirmAndReleaseInvoice(oData.BillingDocument, sETag);
            },

            _confirmAndReleaseInvoice: function (sDoc, sETag) {
                var that = this;
                var sConfirmMsg = this._getText("msgConfirmReleaseAccounting", [sDoc]);
                MessageBox.confirm(sConfirmMsg, {
                    title: this._getText("titleReleaseAccounting"),
                    onClose: function (sAction) {
                        if (sAction === "OK" || (MessageBox.Action && sAction === MessageBox.Action.OK)) {
                            that._executeReleaseToAccounting(sDoc, sETag);
                        }
                    }
                });
            },

            _executeReleaseToAccounting: function (sDoc, sETag) {
                if (this._bSubmitting) return;
                this._bSubmitting = true;
                var that = this;
                var oModel = this.getView().getModel("customerInvoice");

                BusyIndicator.show(0);
                var pRelease = sETag
                    ? CustomerInvoiceService.releaseInvoiceToAccounting(sDoc, oModel, { etag: sETag })
                    : CustomerInvoiceService.releaseInvoiceToAccounting(sDoc, oModel);

                pRelease.then(function (res) {
                    that._bSubmitting = false;
                    BusyIndicator.hide();
                    // Immediately refresh table to reflect live SAP status in UI
                    that.onRefresh();

                    var sAcctDoc = (res && res.AccountingDocument) || "";
                    var sStatus = (res && res.AccountingTransferStatus) || "";
                    if (sAcctDoc || sStatus === "C") {
                        var sMsg = sAcctDoc
                            ? that._getText("msgReleaseAccountingSuccessWithDoc", [sDoc, sAcctDoc])
                            : that._getText("msgReleaseAccountingSuccess", [sDoc]);

                        MessageBox.success(sMsg, {
                            title: that._getText("titleReleaseAccountingSuccess"),
                            onClose: function () {
                                that.onRefresh();
                            }
                        });
                    } else {
                        var sWarnMsg = (res && res.Message) || that._getText("msgReleaseAccountingError");
                        MessageBox.warning(sWarnMsg, {
                            title: that._getText("titleReleaseAccountingError"),
                            onClose: function () {
                                that.onRefresh();
                            }
                        });
                    }
                }).catch(function (err) {
                    that._bSubmitting = false;
                    BusyIndicator.hide();
                    // Immediately refresh table to display current authentic SAP state
                    that.onRefresh();

                    var sErrMsg = that._extractErrorMessage(err, "msgReleaseAccountingError");
                    MessageBox.error(sErrMsg, {
                        title: that._getText("titleReleaseAccountingError"),
                        onClose: function () {
                            that.onRefresh();
                        }
                    });
                });
            },

            onCancelInvoicePress: function (oEvent) {
                var oContext = oEvent.getSource().getBindingContext("customerInvoice");
                if (!oContext) return;
                var oData = oContext.getObject();
                this._openCancelDialog(oData);
            },

            _openCancelDialog: function (oData) {
                var that = this;
                if (!this._pCancelDialog) {
                    var sViewId = (this.getView && typeof this.getView().getId === "function") ? this.getView().getId() : undefined;
                    this._pCancelDialog = Fragment.load({
                        id: sViewId,
                        name: "saps4hana.fiori.modules.sd.customer-invoice.view.CancelInvoiceDialog",
                        controller: this
                    }).then(function (oDialog) {
                        that.getView().addDependent(oDialog);
                        return oDialog;
                    });
                }

                this._pCancelDialog.then(function (oDialog) {
                    that._oCancelDialog = oDialog;
                    var oCancelModel = new JSONModel(oData);
                    oDialog.setModel(oCancelModel, "cancelInvoiceModel");
                    oDialog.open();
                });
            },

            onCloseCancelInvoiceDialog: function () {
                if (this._oCancelDialog) {
                    this._oCancelDialog.close();
                }
            },

            onConfirmCancelInvoice: function () {
                if (this._bSubmitting) return;
                var oCancelModel = this._oCancelDialog ? this._oCancelDialog.getModel("cancelInvoiceModel") : null;
                if (!oCancelModel) return;
                var sDoc = oCancelModel.getProperty("/BillingDocument");
                var sETag = oCancelModel.getProperty("/@odata.etag") || oCancelModel.getProperty("/ETag") || oCancelModel.getProperty("/etag") || "";
                var that = this;
                var oModel = this.getView().getModel("customerInvoice");

                this._bSubmitting = true;
                this.onCloseCancelInvoiceDialog();
                BusyIndicator.show(0);

                var pCancel = sETag
                    ? CustomerInvoiceService.cancelBillingDocument(sDoc, oModel, { etag: sETag })
                    : CustomerInvoiceService.cancelBillingDocument(sDoc, oModel);

                pCancel.then(function (res) {
                    that._bSubmitting = false;
                    BusyIndicator.hide();
                    // Immediately refresh table to reflect cancellation in UI
                    that.onRefresh();

                    var sCancelDoc = (res && res.CancellationDocument) || "";
                    var sMsg = sCancelDoc
                        ? that._getText("msgCancelInvoiceSuccessWithDoc", [sDoc, sCancelDoc])
                        : that._getText("msgCancelInvoiceSuccess", [sDoc]);

                    MessageBox.success(sMsg, {
                        title: that._getText("titleCancelInvoiceSuccess"),
                        onClose: function () {
                            that.onRefresh();
                        }
                    });
                }).catch(function (err) {
                    that._bSubmitting = false;
                    BusyIndicator.hide();
                    // Immediately refresh table to reflect current SAP state
                    that.onRefresh();

                    var sErrMsg = that._extractErrorMessage(err, "msgCancelInvoiceError");
                    MessageBox.error(sErrMsg, {
                        title: that._getText("titleCancelInvoiceError"),
                        onClose: function () {
                            that.onRefresh();
                        }
                    });
                });
            },

            _extractErrorMessage: function (err, sFallbackKey) {
                var sRaw = "";
                if (!err) return this._getText(sFallbackKey);
                if (err.error && err.error.message) sRaw = err.error.message;
                else if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
                    sRaw = err.response.data.error.message;
                } else {
                    try {
                        if (Messaging && typeof Messaging.getMessageModel === "function") {
                            var aMessages = Messaging.getMessageModel().getData() || [];
                            for (var i = aMessages.length - 1; i >= 0; i--) {
                                var oMsg = aMessages[i];
                                if (oMsg && oMsg.message && !oMsg.message.startsWith("Communication error")) {
                                    sRaw = oMsg.message;
                                    break;
                                }
                            }
                        }
                    } catch (_) {}
                    if (!sRaw && err.message && err.message.indexOf(" - ") !== -1) {
                        var aParts = err.message.split(" - ");
                        if (aParts.length > 1 && aParts[aParts.length - 1].trim()) {
                            sRaw = aParts[aParts.length - 1].trim();
                        }
                    }
                }
                var sDirectMsg = sRaw || (err && err.message) || "";
                if (err && (err.status === 409 || err.statusCode === 409 || err.code === "STALE_DATA")) {
                    return (sDirectMsg && sDirectMsg.indexOf("changed") !== -1)
                        ? sDirectMsg
                        : (sDirectMsg || this._getText("msgInvoiceStaleDataConflict", "This document was modified by another user or session in SAP S/4HANA (stale data). The list has been refreshed with the latest data from SAP. Please review the updated status before trying again."));
                }
                var sMsg = sDirectMsg || this._getText(sFallbackKey);
                if (sMsg.indexOf("ASSERTION_FAILED") !== -1 || sMsg.indexOf("Runtime Error") !== -1) {
                    return "SAP Gateway Runtime Error (ASSERTION_FAILED): The OData interface in SAP S/4HANA aborted execution because the billing document has an active Posting Block (Status A) or inconsistent buffer state.\n\nGuidance: Release cannot be performed via OData while a Posting Block is active. Open the document in SAP GUI (transaction VF02), verify pricing/tax conditions, and release to accounting directly from VF02.";
                }
                if (sMsg.indexOf("Payment term") !== -1 && sMsg.indexOf("not defined") !== -1) {
                    return sMsg + "\n\nGuidance: The payment term assigned to this document is missing in SAP FI customizing (table T052 / transaction OBB8). To release this invoice, maintain the payment term in SAP or update the invoice in VF02.";
                }
                if (sMsg.indexOf("saved (error in account determination)") !== -1) {
                    return sMsg + "\n\nExplanation: SAP S/4HANA saved the billing document with Status B, but failed to create the G/L accounting document because G/L account determination is not configured.\n\nGuidance: Maintain revenue/tax G/L account assignment in SAP customizing (transaction VKOA) for this Billing Type and Sales Organization.";
                }
                if (sMsg.indexOf("account determination") !== -1 || sMsg.indexOf("T030K") !== -1) {
                    return sMsg + "\n\nGuidance: G/L Account Determination is missing in SAP (table VKOA / transaction VKOA). Please assign the required G/L revenue/tax accounts in SAP.";
                }
                return sMsg;
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createCustomerInvoiceActionCoordinator: createCustomerInvoiceActionCoordinator
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
