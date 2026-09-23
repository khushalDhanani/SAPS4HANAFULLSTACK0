sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/ui/core/Messaging",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "saps4hana/fiori/modules/sd/customer-invoice/service/CustomerInvoiceService"
], function (Controller, JSONModel, Filter, FilterOperator, Fragment, Messaging, BusyIndicator, MessageBox, MessageToast, CustomerInvoiceService) {
    "use strict";

    return Controller.extend("saps4hana.fiori.modules.sd.customer-invoice.controller.CustomerInvoices", {

        onInit: function () {
            var oViewModel = new JSONModel({
                totalInvoices: 0,
                pendingAccountingCount: 0,
                transferredCount: 0,
                cancelledCount: 0,
                displayCount: 0,
                selectedTab: "all",
                searchQuery: "",
                hasSelectedInvoice: false,
                canReleaseSelected: false,
                canCancelSelected: false,
                selectedInvoice: null
            });
            this.getView().setModel(oViewModel, "customerInvoicesView");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("customerInvoices").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oModel = this.getView().getModel("customerInvoice");
            if (oModel) {
                CustomerInvoiceService.setModel(oModel);
            }
            this._loadMetrics();
            this._applyFilters();
        },

        onRefresh: function () {
            this._resetSelection();
            this._loadMetrics();
            var oTable = this.byId("tblCustomerInvoices");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    oBinding.refresh();
                }
            }
            MessageToast.show(this._getText("msgInvoicesRefreshed"));
        },

        _resetSelection: function () {
            var oViewModel = this.getView().getModel("customerInvoicesView");
            if (oViewModel) {
                oViewModel.setProperty("/hasSelectedInvoice", false);
                oViewModel.setProperty("/canReleaseSelected", false);
                oViewModel.setProperty("/canCancelSelected", false);
                oViewModel.setProperty("/selectedInvoice", null);
            }
            var oTable = this.byId("tblCustomerInvoices");
            if (oTable && typeof oTable.removeSelections === "function") {
                oTable.removeSelections(true);
            }
        },

        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("customerInvoicesView");
            var oModel = this.getView().getModel("customerInvoice");

            return CustomerInvoiceService.getMetrics(oModel).then(function (m) {
                if (m) {
                    oViewModel.setProperty("/totalInvoices", m.totalInvoices || 0);
                    oViewModel.setProperty("/pendingAccountingCount", m.pendingAccountingCount || 0);
                    oViewModel.setProperty("/transferredCount", m.transferredCount || 0);
                    oViewModel.setProperty("/cancelledCount", m.cancelledCount || 0);

                    var sSearch = (oViewModel.getProperty("/searchQuery") || "").trim();
                    if (!sSearch) {
                        var sTab = oViewModel.getProperty("/selectedTab") || "all";
                        var iCount = sTab === "pending"
                            ? m.pendingAccountingCount
                            : (sTab === "transferred"
                                ? m.transferredCount
                                : (sTab === "cancelled" ? m.cancelledCount : m.totalInvoices));
                        oViewModel.setProperty("/displayCount", iCount || 0);
                    }
                }
            }).catch(function (err) {
                // Non-critical metric failure
            });
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key") || oEvent.getSource().getSelectedKey();
            var oViewModel = this.getView().getModel("customerInvoicesView");
            oViewModel.setProperty("/selectedTab", sKey);

            var sSearch = (oViewModel.getProperty("/searchQuery") || "").trim();
            if (!sSearch) {
                var iCount = sKey === "pending"
                    ? oViewModel.getProperty("/pendingAccountingCount")
                    : (sKey === "transferred"
                        ? oViewModel.getProperty("/transferredCount")
                        : (sKey === "cancelled" ? oViewModel.getProperty("/cancelledCount") : oViewModel.getProperty("/totalInvoices")));
                oViewModel.setProperty("/displayCount", iCount || 0);
            }

            this._applyFilters();
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getSource().getValue() || "";
            var oViewModel = this.getView().getModel("customerInvoicesView");
            oViewModel.setProperty("/searchQuery", sQuery);
            if (!sQuery.trim()) {
                var sTab = oViewModel.getProperty("/selectedTab") || "all";
                var iCount = sTab === "pending"
                    ? oViewModel.getProperty("/pendingAccountingCount")
                    : (sTab === "transferred"
                        ? oViewModel.getProperty("/transferredCount")
                        : (sTab === "cancelled" ? oViewModel.getProperty("/cancelledCount") : oViewModel.getProperty("/totalInvoices")));
                oViewModel.setProperty("/displayCount", iCount || 0);
            }
            this._applyFilters();
        },

        onLiveSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            this.getView().getModel("customerInvoicesView").setProperty("/searchQuery", sQuery);
            this._applyFilters();
        },

        _applyFilters: function () {
            var oTable = this.byId("tblCustomerInvoices");
            if (!oTable) return;
            var oBinding = oTable.getBinding("items");
            if (!oBinding) return;

            var oViewModel = this.getView().getModel("customerInvoicesView");
            var sTab = oViewModel.getProperty("/selectedTab") || "all";
            var sSearch = (oViewModel.getProperty("/searchQuery") || "").trim();

            var aFilters = [];

            // Tab Filters
            if (sTab === "pending") {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("AccountingTransferStatus", FilterOperator.NE, "C"),
                        new Filter("BillingDocumentIsCancelled", FilterOperator.EQ, false)
                    ],
                    and: true
                }));
            } else if (sTab === "transferred") {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("AccountingTransferStatus", FilterOperator.EQ, "C"),
                        new Filter("BillingDocumentIsCancelled", FilterOperator.EQ, false)
                    ],
                    and: true
                }));
            } else if (sTab === "cancelled") {
                aFilters.push(new Filter("BillingDocumentIsCancelled", FilterOperator.EQ, true));
            }

            // Search query filter
            if (sSearch) {
                var oSearchFilter = new Filter({
                    filters: [
                        new Filter("BillingDocument", FilterOperator.Contains, sSearch),
                        new Filter("SoldToPartyFullName", FilterOperator.Contains, sSearch),
                        new Filter("SoldToParty", FilterOperator.Contains, sSearch),
                        new Filter("BillingDocumentType", FilterOperator.Contains, sSearch)
                    ],
                    and: false
                });
                aFilters.push(oSearchFilter);
            }

            this._resetSelection();
            var oFinalFilter = aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : null;
            oBinding.filter(oFinalFilter);

            // Update display count dynamically from server count or loaded length
            var that = this;
            oBinding.attachEventOnce("dataReceived", function () {
                var oVM = that.getView().getModel("customerInvoicesView");
                var iServerCount = (typeof oBinding.getCount === "function") ? oBinding.getCount() : null;
                if (iServerCount !== null && iServerCount !== undefined) {
                    oVM.setProperty("/displayCount", iServerCount);
                } else {
                    var sCurrentTab = oVM.getProperty("/selectedTab") || "all";
                    var sCurrentSearch = (oVM.getProperty("/searchQuery") || "").trim();
                    if (!sCurrentSearch) {
                        var iTabCount = sCurrentTab === "pending"
                            ? oVM.getProperty("/pendingAccountingCount")
                            : (sCurrentTab === "transferred"
                                ? oVM.getProperty("/transferredCount")
                                : (sCurrentTab === "cancelled" ? oVM.getProperty("/cancelledCount") : oVM.getProperty("/totalInvoices")));
                        oVM.setProperty("/displayCount", iTabCount || 0);
                    } else {
                        var iCount = oBinding.getLength ? oBinding.getLength() : 0;
                        oVM.setProperty("/displayCount", iCount);
                    }
                }
            });
        },

        onInvoiceSelectionChange: function (oEvent) {
            var oTable = oEvent.getSource();
            var oSelectedItem = oTable.getSelectedItem();
            var oViewModel = this.getView().getModel("customerInvoicesView");

            if (!oSelectedItem) {
                this._resetSelection();
                return;
            }

            var oContext = oSelectedItem.getBindingContext("customerInvoice");
            var oData = oContext ? oContext.getObject() : null;
            if (oData) {
                var bIsCancelled = oData.BillingDocumentIsCancelled === true || oData.BillingDocumentIsCancelled === "true" || oData.AccountingTransferStatus === "E" || oData.SDDocumentCategory === "N";
                var bCanRelease = !bIsCancelled && oData.AccountingTransferStatus !== "C" && oData.AccountingTransferStatus !== "D" && oData.AccountingTransferStatus !== "E" && oData.AccountingTransferStatus !== "A" && oData.SDDocumentCategory !== "N";
                var bCanCancel = !bIsCancelled && oData.AccountingTransferStatus !== "E" && oData.SDDocumentCategory !== "N";

                oViewModel.setProperty("/hasSelectedInvoice", true);
                oViewModel.setProperty("/canReleaseSelected", bCanRelease);
                oViewModel.setProperty("/canCancelSelected", bCanCancel);
                oViewModel.setProperty("/selectedInvoice", oData);
            } else {
                this._resetSelection();
            }
        },

        onToolbarReleasePress: function () {
            var oViewModel = this.getView().getModel("customerInvoicesView");
            var oSelected = oViewModel.getProperty("/selectedInvoice");
            if (!oSelected || !oSelected.BillingDocument) {
                return;
            }
            this._confirmAndReleaseInvoice(oSelected.BillingDocument);
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
            this._confirmAndReleaseInvoice(oData.BillingDocument);
        },

        _confirmAndReleaseInvoice: function (sDoc) {
            var that = this;
            var sConfirmMsg = this._getText("msgConfirmReleaseAccounting", [sDoc]);
            MessageBox.confirm(sConfirmMsg, {
                title: this._getText("titleReleaseAccounting"),
                onClose: function (sAction) {
                    if (sAction === "OK" || (MessageBox.Action && sAction === MessageBox.Action.OK)) {
                        that._executeReleaseToAccounting(sDoc);
                    }
                }
            });
        },

        _executeReleaseToAccounting: function (sDoc) {
            var that = this;
            var oModel = this.getView().getModel("customerInvoice");

            BusyIndicator.show(0);
            CustomerInvoiceService.releaseInvoiceToAccounting(sDoc, oModel).then(function (res) {
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
            var oCancelModel = this._oCancelDialog ? this._oCancelDialog.getModel("cancelInvoiceModel") : null;
            if (!oCancelModel) return;
            var sDoc = oCancelModel.getProperty("/BillingDocument");
            var that = this;
            var oModel = this.getView().getModel("customerInvoice");

            this.onCloseCancelInvoiceDialog();
            BusyIndicator.show(0);

            CustomerInvoiceService.cancelBillingDocument(sDoc, oModel).then(function (res) {
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
            var sMsg = sRaw || err.message || this._getText(sFallbackKey);
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
        },

        _getText: function (sKey, aArgs) {
            var oResourceBundle = this.getView().getModel("i18n").getResourceBundle();
            return oResourceBundle.getText(sKey, aArgs);
        },

        formatInvoiceStatusText: function (bIsCancelled, sAccountingStatus, sCategory) {
            if (bIsCancelled === true || bIsCancelled === "true" || sAccountingStatus === "E" || sCategory === "N") {
                return this._getText("statusCancelled");
            }
            if (sAccountingStatus === "C" || sAccountingStatus === "H") {
                return this._getText("statusTransferredToAccounting");
            }
            if (sAccountingStatus === "D") {
                return this._getText("statusNotRelevantForAccounting");
            }
            if (sAccountingStatus === "B") {
                return this._getText("statusAccountDeterminationError");
            }
            if (sAccountingStatus === "A") {
                return this._getText("statusPostingBlocked");
            }
            if (!sAccountingStatus || sAccountingStatus === "") {
                return this._getText("statusAccountingInterfaceError");
            }
            return this._getText("statusPostingError");
        },

        formatInvoiceStatusState: function (bIsCancelled, sAccountingStatus, sCategory) {
            if (bIsCancelled === true || bIsCancelled === "true" || sAccountingStatus === "E" || sCategory === "N") {
                return "Error";
            }
            if (sAccountingStatus === "C" || sAccountingStatus === "H") {
                return "Success";
            }
            if (sAccountingStatus === "D") {
                return "None";
            }
            if (sAccountingStatus === "A") {
                return "Warning";
            }
            return "Error";
        },

        formatInvoiceStatusIcon: function (bIsCancelled, sAccountingStatus, sCategory) {
            if (bIsCancelled === true || bIsCancelled === "true" || sAccountingStatus === "E" || sCategory === "N") {
                return "sap-icon://sys-cancel";
            }
            if (sAccountingStatus === "C" || sAccountingStatus === "H") {
                return "sap-icon://accept";
            }
            if (sAccountingStatus === "D") {
                return "sap-icon://document-text";
            }
            if (sAccountingStatus === "A") {
                return "sap-icon://locked";
            }
            return "sap-icon://alert";
        },

        formatReleaseEnabled: function (bIsCancelled, sAccountingStatus, sCategory) {
            return bIsCancelled !== true && bIsCancelled !== "true" &&
                sAccountingStatus !== "C" && sAccountingStatus !== "H" &&
                sAccountingStatus !== "D" && sAccountingStatus !== "E" &&
                sAccountingStatus !== "A" &&
                sCategory !== "N";
        },

        formatCancelEnabled: function (bIsCancelled, sAccountingStatus, sCategory) {
            return bIsCancelled !== true && bIsCancelled !== "true" &&
                sAccountingStatus !== "E" && sCategory !== "N";
        }
    });
});
