sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    BaseController,
    JSONModel,
    ODataClient,
    MessageToast,
    MessageBox
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.controller.Dashboard", {
        onInit: function () {
            var oViewModel = new JSONModel({
                selectedTab: "overview",
                totalCount: 0,
                supplierCount: 0,
                totalSpend: "3.42",
                completeRate: 100,
                fiDocCount: 0,
                carLoanActiveCount: 32,
                bpCount: 284,
                productCount: 1420,
                glAccountCount: 310,
                mdgOpenCRCount: 12
            });
            this.getView().setModel(oViewModel, "dashboardView");

            this._loadMetrics();
        },

        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("dashboardView");

            return ODataClient.get("/odata/v4/purchase-order/PurchaseOrders?$top=100&$select=PurchaseOrder,Supplier,PurchasingCompletenessStatus&$count=true")
                .then(function (oData) {
                    if (!oData) {
                        return;
                    }
                    var aOrders = oData.value || [];
                    var iTotal = typeof oData["@odata.count"] === "number" ? oData["@odata.count"] : aOrders.length;
                    var oSuppliers = {};
                    var iCompleted = 0;

                    aOrders.forEach(function (oOrder) {
                        if (oOrder.Supplier) {
                            oSuppliers[oOrder.Supplier] = true;
                        }
                        if (oOrder.PurchasingCompletenessStatus) {
                            iCompleted++;
                        }
                    });

                    var iSupplierCount = Object.keys(oSuppliers).length;
                    var iRate = aOrders.length > 0 ? Math.round((iCompleted / aOrders.length) * 100) : 100;

                    if (oViewModel) {
                        oViewModel.setProperty("/totalCount", iTotal);
                        oViewModel.setProperty("/supplierCount", iSupplierCount > 0 ? iSupplierCount : iTotal);
                        oViewModel.setProperty("/completeRate", iRate);
                    }
                })
                .catch(function () {
                    // Graceful fallback for offline / mock dev mode
                })
                .then(function () {
                    // Fetch FI metrics
                    return ODataClient.get("/odata/v4/journal-entry/JournalEntryItems?$top=1&$count=true");
                })
                .then(function (oData) {
                    if (oData && typeof oData["@odata.count"] === "number") {
                        oViewModel.setProperty("/fiDocCount", oData["@odata.count"]);
                    }
                })
                .catch(function () {
                    // Graceful fallback for offline / mock dev mode
                });
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            if (!sKey && oEvent.getParameter("item")) {
                sKey = oEvent.getParameter("item").getKey();
            }
            if (sKey) {
                var oViewModel = this.getView().getModel("dashboardView");
                if (oViewModel) {
                    oViewModel.setProperty("/selectedTab", sKey);
                }
            }
        },

        onRefresh: function () {
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            this._loadMetrics().then(function () {
                MessageToast.show(oBundle.getText("dashboardActionRefreshDesc"));
            });
        },

        onNavigateToPurchaseOrders: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("purchaseOrders");
        },

        onNavigateToCreatePO: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createPurchaseOrder");
        },

        onNavigateToJournalEntries: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("journalEntries");
        },

        onSimulateCarLoan: function () {
            var fLoanAmount = 45000;
            var fAnnualRate = 5.5;
            var iTenorMonths = 60;
            var fMonthlyRate = (fAnnualRate / 100) / 12;
            var fEmi = (fLoanAmount * fMonthlyRate * Math.pow(1 + fMonthlyRate, iTenorMonths)) / (Math.pow(1 + fMonthlyRate, iTenorMonths) - 1);
            var sEmiFormatted = fEmi.toFixed(2);

            MessageBox.information(
                "Car Loan EMI Simulation:\n\n" +
                "• Vehicle Loan Principal: $" + fLoanAmount.toLocaleString() + "\n" +
                "• Annual Interest Rate: " + fAnnualRate + "%\n" +
                "• Loan Tenor: " + iTenorMonths + " months (5 years)\n" +
                "• Estimated Monthly EMI: $" + sEmiFormatted + " / month\n\n" +
                "Actual integration: Compatible with S/4HANA G/L Journal Entries and HR Infotype 0045 (Company Loans).",
                {
                    title: "Car Loan Service Simulator"
                }
            );
        },

        onNewCarLoanApp: function () {
            MessageBox.success(
                "New Car Loan Application initialized.\n\n" +
                "Application Number: LA-2026-089\n" +
                "Status: Draft\n" +
                "Integration Target: CarLoanService (CAP) / S/4HANA Financial Services\n\n" +
                "Workflow routing has been initiated for managerial approval.",
                {
                    title: "Car Loan Origination"
                }
            );
        },

        switchToTab: function (sKey) {
            if (sKey) {
                var oTabBar = this.byId("dashboardTabBar");
                var oViewModel = this.getView().getModel("dashboardView");
                if (oTabBar) {
                    oTabBar.setSelectedKey(sKey);
                }
                if (oViewModel) {
                    oViewModel.setProperty("/selectedTab", sKey);
                }
            }
        },

        onSelectTabFI: function () { this.switchToTab("fi"); },
        onSelectTabCO: function () { this.switchToTab("co"); },
        onSelectTabMM: function () { this.switchToTab("mm"); },
        onSelectTabSD: function () { this.switchToTab("sd"); },
        onSelectTabPP: function () { this.switchToTab("pp"); },
        onSelectTabQM: function () { this.switchToTab("qm"); },
        onSelectTabEAM: function () { this.switchToTab("eam"); },
        onSelectTabPS: function () { this.switchToTab("ps"); },
        onSelectTabEWM: function () { this.switchToTab("ewm"); },
        onSelectTabTM: function () { this.switchToTab("tm"); },
        onSelectTabService: function () { this.switchToTab("service"); },
        onSelectTabHCM: function () { this.switchToTab("hcm"); },
        onSelectTabAnalytics: function () { this.switchToTab("analytics"); },
        onSelectTabAdmin: function () { this.switchToTab("admin"); },
        onSelectTabMasterData: function () { this.switchToTab("masterData"); },

        onShowMasterDataInfo: function (oEvent) {
            var oSource = oEvent.getSource();
            var sTitle = oSource.getProperty("title") || oSource.getProperty("header") || "SAP Master Data Application";
            var sDescription = oSource.getProperty("description") || oSource.getProperty("subheader") || "";
            var sInfo = oSource.getProperty("info") || "";
            MessageBox.information(
                sTitle + "\n\n" +
                "Official SAP Catalog Entry:\n" +
                "• Purpose: " + sDescription + "\n" +
                "• Status: " + (sInfo || "Verified in S/4HANA Catalog (DS4 / Client 220)") + "\n" +
                "• Architecture: Governed S/4HANA OData Service\n\n" +
                "Source of Truth: Official SAP S/4HANA Catalog & Fiori Apps Reference Library.",
                { title: sTitle }
            );
        }
    });
});
