sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/fi/journal-entry/model/formatter",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment"
], function (BaseController, JSONModel, Filter, FilterOperator, formatter, MessageToast, ODataClient, Fragment) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.fi.journal-entry.controller.JournalEntries", {
        formatter: formatter,

        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: "-",
                glAccountCount: "-",
                costCenterCount: "-",
                companyCodeCount: "-",
                selectedTab: "all",
                filterDocument: "",
                filterCompanyCode: "",
                filterFiscalYear: "",
                filterGLAccount: "",
                filterCostCenter: "",
                searchQuery: ""
            });
            this.getView().setModel(oViewModel, "fiView");
            this._loadServerMetrics();

            var oRouter = this.getOwnerComponent() && this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("journalEntries")) {
                oRouter.getRoute("journalEntries").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            var oTable = this.byId("tableJournalEntries");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard against refreshing in-flight initial request
                }
            }
            this._loadServerMetrics();
        },

        _loadServerMetrics: function () {
            var oViewModel = this.getView().getModel("fiView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            return ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
                .then(function (res) {
                    var oMetrics = res;
                    if (typeof oMetrics === "string") {
                        try {
                            oMetrics = JSON.parse(oMetrics);
                        } catch (e) {
                            oMetrics = null;
                        }
                    }
                    if (oMetrics && typeof oMetrics.value === "string") {
                        try {
                            oMetrics = JSON.parse(oMetrics.value);
                        } catch (e) {
                            oMetrics = null;
                        }
                    }
                    if (oMetrics) {
                        oViewModel.setProperty("/glAccountCount", oMetrics.glAccountCount != null ? oMetrics.glAccountCount : "-");
                        oViewModel.setProperty("/costCenterCount", oMetrics.costCenterCount != null ? oMetrics.costCenterCount : "-");
                        oViewModel.setProperty("/companyCodeCount", oMetrics.companyCodeCount != null ? oMetrics.companyCodeCount : "-");
                    } else {
                        oViewModel.setProperty("/glAccountCount", "-");
                        oViewModel.setProperty("/costCenterCount", "-");
                        oViewModel.setProperty("/companyCodeCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/glAccountCount", "-");
                    oViewModel.setProperty("/costCenterCount", "-");
                    oViewModel.setProperty("/companyCodeCount", "-");
                });
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("fiView");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
            }
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter ? oEvent.getParameter("key") : null;
            if (!sKey && oEvent.getSource && oEvent.getSource().getSelectedKey) {
                sKey = oEvent.getSource().getSelectedKey();
            }
            var oViewModel = this.getView().getModel("fiView");
            if (oViewModel) {
                oViewModel.setProperty("/selectedTab", sKey || "all");
            }
            this._applyFilters();
        },

        onSearch: function (oEvent) {
            var sQuery = "";
            if (oEvent && typeof oEvent.getParameter === "function" && oEvent.getParameter("query") !== undefined) {
                sQuery = oEvent.getParameter("query");
            } else if (oEvent && oEvent.getSource && typeof oEvent.getSource().getValue === "function") {
                sQuery = oEvent.getSource().getValue();
            }
            var oViewModel = this.getView().getModel("fiView");
            if (oViewModel) {
                oViewModel.setProperty("/searchQuery", sQuery || "");
            }
            this._applyFilters();
        },

        onFilterBarSearch: function () {
            this._applyFilters();
        },

        onFilterBarClear: function () {
            var oViewModel = this.getView().getModel("fiView");
            if (oViewModel) {
                oViewModel.setProperty("/filterDocument", "");
                oViewModel.setProperty("/filterCompanyCode", "");
                oViewModel.setProperty("/filterFiscalYear", "");
                oViewModel.setProperty("/filterGLAccount", "");
                oViewModel.setProperty("/filterCostCenter", "");
                oViewModel.setProperty("/selectedTab", "all");
                oViewModel.setProperty("/searchQuery", "");
            }
            var oSearchField = this.byId("searchField");
            if (oSearchField && typeof oSearchField.setValue === "function") {
                oSearchField.setValue("");
            }
            this._applyFilters();
        },

        _applyFilters: function () {
            var oViewModel = this.getView().getModel("fiView");
            var aFilters = [];

            if (!oViewModel) {
                return;
            }

            var sTab = oViewModel.getProperty("/selectedTab");
            if (sTab === "S" || sTab === "H") {
                aFilters.push(new Filter("DebitCreditCode", FilterOperator.EQ, sTab));
            }

            var sQuery = oViewModel.getProperty("/searchQuery");
            if (sQuery && typeof sQuery === "string" && sQuery.trim().length > 0) {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("AccountingDocument", FilterOperator.Contains, sTrimmed),
                        new Filter("GLAccount", FilterOperator.Contains, sTrimmed),
                        new Filter("GLAccountName", FilterOperator.Contains, sTrimmed),
                        new Filter("CostCenter", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            var sDoc = oViewModel.getProperty("/filterDocument");
            if (sDoc && typeof sDoc === "string" && sDoc.trim()) {
                aFilters.push(new Filter("AccountingDocument", FilterOperator.Contains, sDoc.trim()));
            }

            var sComp = oViewModel.getProperty("/filterCompanyCode");
            if (sComp && typeof sComp === "string" && sComp.trim()) {
                aFilters.push(new Filter("CompanyCode", FilterOperator.Contains, sComp.trim()));
            }

            var sYear = oViewModel.getProperty("/filterFiscalYear");
            if (sYear && typeof sYear === "string" && sYear.trim()) {
                aFilters.push(new Filter("FiscalYear", FilterOperator.EQ, sYear.trim()));
            }

            var sGL = oViewModel.getProperty("/filterGLAccount");
            if (sGL && typeof sGL === "string" && sGL.trim()) {
                aFilters.push(new Filter("GLAccount", FilterOperator.Contains, sGL.trim()));
            }

            var sCC = oViewModel.getProperty("/filterCostCenter");
            if (sCC && typeof sCC === "string" && sCC.trim()) {
                aFilters.push(new Filter("CostCenter", FilterOperator.Contains, sCC.trim()));
            }

            var oTable = this.byId("tableJournalEntries");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(aFilters, "Application");
            }
        },

        onRefresh: function () {
            var oTable = this.byId("tableJournalEntries");
            if (oTable && oTable.getBinding("items")) {
                try {
                    oTable.getBinding("items").refresh();
                } catch (e) {
                    // Ignore refresh if already pending
                }
            }
            this._loadServerMetrics();
            var oBundle = this.getOwnerComponent() && this.getOwnerComponent().getModel("i18n")
                ? this.getOwnerComponent().getModel("i18n").getResourceBundle()
                : null;
            if (oBundle) {
                MessageToast.show(oBundle.getText("dashboardActionRefreshDesc"));
            }
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter ? oEvent.getParameter("listItem") : null;
            if (!oItem && oEvent.getSource) {
                oItem = oEvent.getSource();
            }
            var oContext = oItem ? oItem.getBindingContext("fiService") : null;
            if (!oContext) {
                return;
            }
            var sDoc = oContext.getProperty("AccountingDocument");
            var sCompany = oContext.getProperty("CompanyCode");
            
            MessageToast.show("Selected Document: " + sDoc + " (" + sCompany + ")");
            this.openJournalEntryDetailDialog(oContext);
        },

        openJournalEntryDetailDialog: function (oContext) {
            var that = this;
            if (!this._pJournalEntryDetailDialog) {
                this._pJournalEntryDetailDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "saps4hana.fiori.modules.fi.journal-entry.view.JournalEntryDetailDialog",
                    controller: this
                }).then(function (oDialog) {
                    that.getView().addDependent(oDialog);
                    return oDialog;
                });
            }

            return this._pJournalEntryDetailDialog.then(function (oDialog) {
                oDialog.setBindingContext(oContext, "fiService");
                oDialog.setBindingContext(oContext);
                oDialog.open();
                return oDialog;
            });
        },

        onCloseJournalEntryDetailDialog: function () {
            if (this._pJournalEntryDetailDialog) {
                this._pJournalEntryDetailDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onExport: function () {
            var oTable = this.byId("tableJournalEntries");
            var aItems = oTable && typeof oTable.getItems === "function" ? oTable.getItems() : [];
            var oBundle = this.getOwnerComponent() && this.getOwnerComponent().getModel("i18n")
                ? this.getOwnerComponent().getModel("i18n").getResourceBundle()
                : null;

            if (!aItems || aItems.length === 0) {
                var sNoData = oBundle ? oBundle.getText("fiExportNoData") : "No items available to export";
                MessageToast.show(sNoData);
                return;
            }

            var aHeaders = [
                "Accounting Document",
                "Item",
                "Company Code",
                "Fiscal Year",
                "G/L Account",
                "G/L Account Name",
                "Item Text",
                "D/C",
                "Amount",
                "Currency",
                "Cost Center",
                "Profit Center"
            ];

            var aLines = [aHeaders.map(function (h) { return '"' + h.replace(/"/g, '""') + '"'; }).join(",")];

            aItems.forEach(function (oItem) {
                var oCtx = typeof oItem.getBindingContext === "function" ? oItem.getBindingContext("fiService") : null;
                if (oCtx) {
                    var aRow = [
                        oCtx.getProperty("AccountingDocument") || "",
                        oCtx.getProperty("AccountingDocumentItem") || "",
                        oCtx.getProperty("CompanyCode") || "",
                        oCtx.getProperty("FiscalYear") || "",
                        oCtx.getProperty("GLAccount") || "",
                        oCtx.getProperty("GLAccountName") || "",
                        oCtx.getProperty("DocumentItemText") || "",
                        oCtx.getProperty("DebitCreditCode") || "",
                        oCtx.getProperty("AmountInCompanyCodeCurrency") != null ? oCtx.getProperty("AmountInCompanyCodeCurrency") : "",
                        oCtx.getProperty("CompanyCodeCurrency") || "",
                        oCtx.getProperty("CostCenter") || "",
                        oCtx.getProperty("ProfitCenter") || ""
                    ];
                    aLines.push(aRow.map(function (val) {
                        return '"' + String(val).replace(/"/g, '""') + '"';
                    }).join(","));
                }
            });

            var sCsv = aLines.join("\r\n");

            if (typeof Blob !== "undefined" && typeof document !== "undefined" && typeof document.createElement === "function") {
                var sBlob = new Blob([sCsv], { type: "text/csv;charset=utf-8;" });
                var sFileName = "Journal_Entries_" + new Date().toISOString().slice(0, 10) + ".csv";

                if (window.navigator && window.navigator.msSaveOrOpenBlob) {
                    window.navigator.msSaveOrOpenBlob(sBlob, sFileName);
                } else {
                    var oLink = document.createElement("a");
                    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
                        oLink.href = URL.createObjectURL(sBlob);
                        oLink.setAttribute("download", sFileName);
                        if (document.body && typeof document.body.appendChild === "function") {
                            document.body.appendChild(oLink);
                            oLink.click();
                            document.body.removeChild(oLink);
                        }
                    }
                }
            }

            var sSuccess = oBundle ? oBundle.getText("fiExportSuccess") : "Journal entries exported successfully";
            MessageToast.show(sSuccess);
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard", {}, true); // true = replace history
        }
    });
});
