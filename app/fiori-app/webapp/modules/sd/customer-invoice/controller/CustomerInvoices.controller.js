sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "saps4hana/fiori/modules/sd/customer-invoice/service/CustomerInvoiceService"
], function (Controller, JSONModel, Filter, FilterOperator, Fragment, MessageBox, MessageToast, CustomerInvoiceService) {
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

            CustomerInvoiceService.getMetrics(oModel).then(function (m) {
                if (m) {
                    oViewModel.setProperty("/totalInvoices", m.totalInvoices || 0);
                    oViewModel.setProperty("/pendingAccountingCount", m.pendingAccountingCount || 0);
                    oViewModel.setProperty("/transferredCount", m.transferredCount || 0);
                    oViewModel.setProperty("/cancelledCount", m.cancelledCount || 0);
                }
            }).catch(function (err) {
                // Non-critical metric failure
            });
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key") || oEvent.getSource().getSelectedKey();
            this.getView().getModel("customerInvoicesView").setProperty("/selectedTab", sKey);
            this._applyFilters();
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getSource().getValue();
            this.getView().getModel("customerInvoicesView").setProperty("/searchQuery", sQuery);
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

            // Update display count dynamically
            var that = this;
            oBinding.attachEventOnce("dataReceived", function () {
                var iCount = oBinding.getLength ? oBinding.getLength() : 0;
                that.getView().getModel("customerInvoicesView").setProperty("/displayCount", iCount);
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
                var bIsCancelled = oData.BillingDocumentIsCancelled === true || oData.BillingDocumentIsCancelled === "true";
                var bCanRelease = !bIsCancelled && oData.AccountingTransferStatus !== "C";
                var bCanCancel = !bIsCancelled;

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

            CustomerInvoiceService.releaseInvoiceToAccounting(sDoc, oModel).then(function (res) {
                var sAcctDoc = (res && res.AccountingDocument) || "";
                var sMsg = sAcctDoc
                    ? that._getText("msgReleaseAccountingSuccessWithDoc", [sDoc, sAcctDoc])
                    : that._getText("msgReleaseAccountingSuccess", [sDoc]);

                MessageBox.success(sMsg, {
                    title: that._getText("titleReleaseAccountingSuccess"),
                    onClose: function () {
                        that.onRefresh();
                    }
                });
            }).catch(function (err) {
                var sErrMsg = (err && (err.message || err.error)) || that._getText("msgReleaseAccountingError");
                MessageBox.error(sErrMsg, {
                    title: that._getText("titleReleaseAccountingError")
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

            CustomerInvoiceService.cancelBillingDocument(sDoc, oModel).then(function (res) {
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
                var sErrMsg = (err && (err.message || err.error)) || that._getText("msgCancelInvoiceError");
                MessageBox.error(sErrMsg, {
                    title: that._getText("titleCancelInvoiceError")
                });
            });
        },

        _getText: function (sKey, aArgs) {
            var oResourceBundle = this.getView().getModel("i18n").getResourceBundle();
            return oResourceBundle.getText(sKey, aArgs);
        },

        formatInvoiceStatusText: function (bIsCancelled, sAccountingStatus) {
            if (bIsCancelled === true || bIsCancelled === "true") {
                return this._getText("statusCancelled");
            }
            if (sAccountingStatus === "C") {
                return this._getText("statusTransferredToAccounting");
            }
            return this._getText("statusPendingAccounting");
        },

        formatInvoiceStatusState: function (bIsCancelled, sAccountingStatus) {
            if (bIsCancelled === true || bIsCancelled === "true") {
                return "Error";
            }
            if (sAccountingStatus === "C") {
                return "Success";
            }
            return "Warning";
        },

        formatInvoiceStatusIcon: function (bIsCancelled, sAccountingStatus) {
            if (bIsCancelled === true || bIsCancelled === "true") {
                return "sap-icon://sys-cancel";
            }
            if (sAccountingStatus === "C") {
                return "sap-icon://accept";
            }
            return "sap-icon://pending";
        },

        formatReleaseEnabled: function (bIsCancelled, sAccountingStatus) {
            return bIsCancelled !== true && bIsCancelled !== "true" && sAccountingStatus !== "C";
        },

        formatCancelEnabled: function (bIsCancelled) {
            return bIsCancelled !== true && bIsCancelled !== "true";
        }
    });
});
