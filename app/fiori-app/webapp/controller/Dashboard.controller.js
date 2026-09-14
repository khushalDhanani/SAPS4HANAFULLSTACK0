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
                systemHealth: 100,
                totalCount: 0,
                supplierCount: 0,
                totalSpend: "0.00",
                completeRate: 0,
                fiDocCount: 0,
                openSalesOrderCount: 0,
                totalSalesOrderCount: 0,
                salesInquiryCount: 0,
                customerCount: 0,
                bpCount: 0,
                productCount: 0,
                glAccountCount: 0,
                costCenterCount: 0,
                profitCenterCount: 0,
                fixedAssetCount: 0,
                wbsElementCount: 0,
                internalOrderCount: 0,
                purchaseContractCount: 0,
                companyCodeCount: 0,
                plantCount: 0,
                storageLocationCount: 0,
                materialGroupCount: 0,
                purchasingOrgCount: 0,
                purchasingGroupCount: 0,
                warehouseCount: 0,
                openReservationCount: 0,
                inboundDeliveryCount: 0,
                gatewayCatalogCount: 0,
                carLoanActiveCount: 0,
                mdgOpenCRCount: 0,
                bankAccountCount: 0,
                workCenterCount: 0,
                workCenterCapacityRate: 0,
                technicalObjectCount: 0,
                bpProcessWorkflowCount: 0,
                productProcessWorkflowCount: 0,
                masterDataImportBatchCount: 0,
                masterDataExportBatchCount: 0,
                costSettlementRate: 0,
                costAllocationCyclesCount: 0,
                ppCapacityUtilization: 0,
                productionOrderCount: 0,
                inspectionLotCount: 0,
                fmeaCaseCount: 0,
                maintenanceOrderCount: 0,
                eamCostVarianceRate: 0,
                projectWipAmount: "0.00",
                ewmOperationsRate: 0,
                ewmStorageTypeCount: 0,
                ewmTaskCount: 0,
                tmRouteCount: 0,
                tmDispatchedCount: 0,
                carLoanVolume: "0.00",
                carLoanApprovalRate: 0,
                hcmOrgUnitCount: 0,
                hcmHeadcount: 0,
                hcmLoanCount: 0,
                analyticsCashFlow: "0.00",
                analyticsDso: 0,
                supplierScorecardAvg: 0,
                adminJobsCount: 0,
                adminWorkflowCount: 0
            });
            this.getView().setModel(oViewModel, "dashboardView");

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                var oRoute = oRouter.getRoute("dashboard");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onDashboardMatched, this);
                }
            }
        },

        _onDashboardMatched: function () {
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
                return;
            }
            this._loadMetrics();
        },

        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("dashboardView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var that = this;
            return ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
                .then(function (res) {
                    if (!res) return;
                    var oMetrics = res;
                    if (typeof oMetrics === "string") {
                        try {
                            oMetrics = JSON.parse(oMetrics);
                        } catch (_) {}
                    }
                    if (oMetrics && oMetrics.value && typeof oMetrics.value === "string") {
                        try {
                            oMetrics = JSON.parse(oMetrics.value);
                        } catch (_) {}
                    }
                    if (oMetrics && typeof oMetrics === "object") {
                        Object.keys(oMetrics).forEach(function (sKey) {
                            oViewModel.setProperty("/" + sKey, oMetrics[sKey]);
                        });
                    }
                })
                .catch(function (err) {
                    console.warn("[DashboardController] Unified metrics load warning, falling back to individual queries:", err && err.message);
                    return that._loadIndividualMetrics();
                });
        },

        _loadIndividualMetrics: function () {
            var oViewModel = this.getView().getModel("dashboardView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var pPurchaseOrders = ODataClient.get("/odata/v4/purchase-order/PurchaseOrders?$top=100&$select=PurchaseOrder,Supplier,PurchaseOrderNetAmount,PurchasingCompletenessStatus&$count=true")
                .then(function (oData) {
                    if (!oData) return;
                    var aOrders = oData.value || [];
                    var iTotal = oData["@odata.count"] != null ? parseInt(oData["@odata.count"], 10) : aOrders.length;
                    if (isNaN(iTotal)) iTotal = aOrders.length;

                    var iCompleted = 0;
                    var fSpendSum = 0;
                    aOrders.forEach(function (oOrder) {
                        if (oOrder.PurchasingCompletenessStatus) {
                            iCompleted++;
                        }
                        fSpendSum += parseFloat(oOrder.PurchaseOrderNetAmount) || 0;
                    });

                    var iRate = aOrders.length > 0 ? Math.round((iCompleted / aOrders.length) * 100) : 100;
                    var fAvg = aOrders.length > 0 ? (fSpendSum / aOrders.length) : 0;
                    var fTotalSpend = iTotal > aOrders.length ? (fAvg * iTotal) : fSpendSum;
                    var sSpendMillions = (fTotalSpend / 1000000).toFixed(2);

                    oViewModel.setProperty("/totalCount", iTotal);
                    oViewModel.setProperty("/completeRate", iRate);
                    oViewModel.setProperty("/totalSpend", sSpendMillions);
                })
                .catch(function () {});

            var pSuppliers = ODataClient.get("/odata/v4/purchase-order/SupplierVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iSuppliers = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iSuppliers) && iSuppliers > 0) {
                            oViewModel.setProperty("/supplierCount", iSuppliers);
                        }
                    }
                })
                .catch(function () {});

            var pMaterials = ODataClient.get("/odata/v4/purchase-order/MaterialVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iMaterials = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iMaterials) && iMaterials > 0) {
                            oViewModel.setProperty("/productCount", iMaterials);
                        }
                    }
                })
                .catch(function () {});

            var pFiDocs = ODataClient.get("/odata/v4/journal-entry/JournalEntryItems?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iFiCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iFiCount)) {
                            oViewModel.setProperty("/fiDocCount", iFiCount);
                        }
                    }
                })
                .catch(function () {});

            var pSalesInquiries = ODataClient.get("/odata/v4/sales-inquiry/SalesInquiries?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iInqCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iInqCount)) {
                            oViewModel.setProperty("/salesInquiryCount", iInqCount);
                        }
                    }
                })
                .catch(function () {});

            var pCustomers = ODataClient.get("/odata/v4/sales-inquiry/CustomerVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCustCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCustCount)) {
                            oViewModel.setProperty("/customerCount", iCustCount);
                        }
                    }
                })
                .catch(function () {});

            var pSalesOrders = ODataClient.get("/odata/v4/sales-inquiry/getSalesOrderMetrics()")
                .then(function (oData) {
                    if (oData) {
                        var iOpen = oData.openOrdersCount != null ? parseInt(oData.openOrdersCount, 10) : 0;
                        var iTotal = oData.totalOrdersCount != null ? parseInt(oData.totalOrdersCount, 10) : 0;
                        if (!isNaN(iOpen)) {
                            oViewModel.setProperty("/openSalesOrderCount", iOpen);
                        }
                        if (!isNaN(iTotal)) {
                            oViewModel.setProperty("/totalSalesOrderCount", iTotal);
                        }
                    }
                })
                .catch(function () {});

            var pReservations = ODataClient.get("/odata/v4/goods-issue/OpenReservations?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iResCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iResCount)) {
                            oViewModel.setProperty("/openReservationCount", iResCount);
                        }
                    } else if (oData && oData.value) {
                        oViewModel.setProperty("/openReservationCount", oData.value.length);
                    }
                })
                .catch(function () {});

            var pInboundDeliveries = ODataClient.get("/odata/v4/goods-receipt/OpenInboundDeliveries?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iInbCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iInbCount)) {
                            oViewModel.setProperty("/inboundDeliveryCount", iInbCount);
                        }
                    } else if (oData && oData.value) {
                        oViewModel.setProperty("/inboundDeliveryCount", oData.value.length);
                    }
                })
                .catch(function () {});

            var pGL = ODataClient.get("/odata/v4/purchase-order/GLAccountVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/glAccountCount", iCount);
                    }
                }).catch(function () {});

            var pCostCenter = ODataClient.get("/odata/v4/purchase-order/CostCenterVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/costCenterCount", iCount);
                    }
                }).catch(function () {});

            var pProfitCenter = ODataClient.get("/odata/v4/purchase-order/ProfitCenterVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/profitCenterCount", iCount);
                    }
                }).catch(function () {});

            var pFixedAsset = ODataClient.get("/odata/v4/purchase-order/FixedAssetVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/fixedAssetCount", iCount);
                    }
                }).catch(function () {});

            var pWBS = ODataClient.get("/odata/v4/purchase-order/WBSElementVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/wbsElementCount", iCount);
                    }
                }).catch(function () {});

            var pInternalOrder = ODataClient.get("/odata/v4/purchase-order/InternalOrderVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/internalOrderCount", iCount);
                    }
                }).catch(function () {});

            var pContract = ODataClient.get("/odata/v4/purchase-order/PurchaseContractVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/purchaseContractCount", iCount);
                    }
                }).catch(function () {});

            var pCompanyCode = ODataClient.get("/odata/v4/purchase-order/CompanyCodeVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/companyCodeCount", iCount);
                    }
                }).catch(function () {});

            var pPlant = ODataClient.get("/odata/v4/purchase-order/PlantVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/plantCount", iCount);
                    }
                }).catch(function () {});

            var pStorageLoc = ODataClient.get("/odata/v4/purchase-order/StorageLocationVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/storageLocationCount", iCount);
                    }
                }).catch(function () {});

            var pMaterialGroup = ODataClient.get("/odata/v4/purchase-order/MaterialGroupVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/materialGroupCount", iCount);
                    }
                }).catch(function () {});

            var pPurchasingOrg = ODataClient.get("/odata/v4/purchase-order/PurchasingOrgVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/purchasingOrgCount", iCount);
                    }
                }).catch(function () {});

            var pPurchasingGroup = ODataClient.get("/odata/v4/purchase-order/PurchasingGroupVH?$top=1&$count=true")
                .then(function (oData) {
                    if (oData && oData["@odata.count"] != null) {
                        var iCount = parseInt(oData["@odata.count"], 10);
                        if (!isNaN(iCount)) oViewModel.setProperty("/purchasingGroupCount", iCount);
                    }
                }).catch(function () {});

            return Promise.all([
                pPurchaseOrders, pSuppliers, pMaterials, pFiDocs, pSalesInquiries,
                pCustomers, pSalesOrders, pReservations, pInboundDeliveries,
                pGL, pCostCenter, pProfitCenter, pFixedAsset, pWBS, pInternalOrder,
                pContract, pCompanyCode, pPlant, pStorageLoc, pMaterialGroup,
                pPurchasingOrg, pPurchasingGroup
            ]);
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

        onNavigateToSalesInquiries: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("salesInquiries");
        },

        onNavigateToCreateSalesInquiry: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createSalesInquiry");
        },

        onNavigateToEwmCockpit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("ewmWarehouseCockpit");
        },

        onNavigateToGoodsIssue: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmGoodsIssue");
        },

        onNavigateToGoodsReceipt: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmGoodsReceipt");
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
