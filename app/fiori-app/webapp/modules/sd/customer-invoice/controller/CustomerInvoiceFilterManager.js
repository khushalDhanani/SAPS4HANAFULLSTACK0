sap.ui.define([], function () {
    "use strict";

    function createCustomerInvoiceFilterManager(options) {
        options = options || {};
        var Filter = options.Filter;
        var FilterOperator = options.FilterOperator;
        var CustomerInvoiceService = options.CustomerInvoiceService;

        return {
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
                }).catch(function () {
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
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createCustomerInvoiceFilterManager: createCustomerInvoiceFilterManager
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
