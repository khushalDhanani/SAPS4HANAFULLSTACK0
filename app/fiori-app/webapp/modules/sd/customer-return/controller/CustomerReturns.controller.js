sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/core/CustomData",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/sd/customer-return/service/CustomerReturnService"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    Fragment,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    CustomData,
    AuthService,
    CustomerReturnService
) {
    "use strict";

    var DEFAULT_RETURN_REASONS = [
        { ReasonCode: "101", ReasonText: "Poor quality" },
        { ReasonCode: "102", ReasonText: "Damaged in transit" },
        { ReasonCode: "004", ReasonText: "Customer recommendation" },
        { ReasonCode: "005", ReasonText: "Customer request" },
        { ReasonCode: "007", ReasonText: "Wrong delivery" }
    ];

    return BaseController.extend("saps4hana.fiori.modules.sd.customer-return.controller.CustomerReturns", {

        // =========================================================================
        // Formatters
        // =========================================================================

        formatReasonState: function (sReason) {
            if (sReason === "101") {
                return "Warning";
            }
            if (sReason === "102") {
                return "Error";
            }
            if (sReason === "004" || sReason === "005") {
                return "Information";
            }
            return "None";
        },

        formatReasonIcon: function (sReason) {
            if (sReason === "101") {
                return "sap-icon://quality-issue";
            }
            if (sReason === "102") {
                return "sap-icon://shipping-status";
            }
            if (sReason === "004" || sReason === "005") {
                return "sap-icon://customer";
            }
            return "sap-icon://notes";
        },

        formatDate: function (sDate) {
            if (!sDate) return "-";
            // Accept ISO string from CAP ("YYYY-MM-DD") or raw /Date(ms)/ from SAP
            var d;
            if (typeof sDate === "string" && sDate.indexOf("/Date(") === 0) {
                var ms = parseInt(sDate.replace(/\/Date\((\d+).*/, "$1"), 10);
                d = isNaN(ms) ? null : new Date(ms);
            } else {
                d = new Date(sDate);
            }
            if (!d || isNaN(d.getTime())) return sDate;
            // Format as DD MMM YYYY (e.g. 07 Jul 2025)
            var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            var day = String(d.getUTCDate()).padStart(2, "0");
            return day + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
        },

        formatAmount: function (vAmount) {
            if (vAmount == null || vAmount === "") {
                return "-";
            }
            var f = parseFloat(vAmount);
            if (isNaN(f) || f === 0) return "-";
            return f.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        formatAmountState: function (vAmount) {
            var f = parseFloat(vAmount);
            if (isNaN(f) || f === 0 || vAmount == null || vAmount === "") return "None";
            return "Good";
        },

        formatReason: function (sReason, sReasonText) {
            if (!sReason && !sReasonText) return "-";
            if (!sReasonText) return sReason;
            return sReason ? sReason + " - " + sReasonText : sReasonText;
        },

        formatQuantity: function (vQty) {
            if (vQty == null || vQty === "") {
                return "-";
            }
            var f = parseFloat(vQty);
            return isNaN(f) ? "-" : f.toFixed(3);
        },

        // =========================================================================
        // Lifecycle Methods
        // =========================================================================

        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            var oViewModel = new JSONModel({
                totalReturns: "-",
                totalNetValueFormatted: "-",
                poorQualityCount: "-",
                damagedTransitCount: "-",
                otherReasonsCount: "-",
                selectedTab: "ALL",
                searchQuery: "",
                selectedReturnNumber: "",
                returnItems: [],
                busy: false
            });
            this.getView().setModel(oViewModel, "customerReturnsView");

            this._oCreateReturnModel = new JSONModel(this._getDefaultCreateData());
            this.getView().setModel(this._oCreateReturnModel, "createReturnModel");

            this._oReturnReasonsModel = new JSONModel(DEFAULT_RETURN_REASONS);
            this.getView().setModel(this._oReturnReasonsModel, "returnReasons");

            var oRouter = this.getOwnerComponent() ? this.getOwnerComponent().getRouter() : null;
            if (oRouter && oRouter.getRoute("customerReturns")) {
                oRouter.getRoute("customerReturns").attachPatternMatched(this._onRouteMatched, this);
            }

            this._loadMetrics();
            this._loadReasons();
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            var oTable = this.byId("tblCustomerReturns");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard against refreshing in-flight initial request
                }
            }
            this._loadMetrics();
        },

        onRefresh: function () {
            var oTable = this.byId("tblCustomerReturns");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard
                }
            }
            this._loadMetrics();
            this._loadReasons();
            MessageToast.show(this.getText("msgReturnsRefreshed"));
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding && typeof oBinding.getLength === "function") {
                var iCount = oBinding.getLength();
                var oViewModel = this.getView().getModel("customerReturnsView");
                var sTab = oViewModel ? oViewModel.getProperty("/selectedTab") : "ALL";
                if (sTab === "ALL" && oViewModel && (oViewModel.getProperty("/totalReturns") === "-" || !oViewModel.getProperty("/totalReturns"))) {
                    oViewModel.setProperty("/totalReturns", iCount);
                }
            }
        },

        // =========================================================================
        // Filtering & Search
        // =========================================================================

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            var oViewModel = this.getView().getModel("customerReturnsView");
            if (oViewModel) {
                oViewModel.setProperty("/selectedTab", sKey);
            }
            this._applyFilters();
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var oViewModel = this.getView().getModel("customerReturnsView");
            if (oViewModel) {
                oViewModel.setProperty("/searchQuery", sQuery.trim());
            }
            this._applyFilters();
        },

        _applyFilters: function () {
            var oViewModel = this.getView().getModel("customerReturnsView");
            var sTab = oViewModel ? oViewModel.getProperty("/selectedTab") : "ALL";
            var sQuery = oViewModel ? oViewModel.getProperty("/searchQuery") : "";

            var aFilters = [];

            // Tab filter
            if (sTab === "101") {
                aFilters.push(new Filter("ReturnsOrderReason", FilterOperator.EQ, "101"));
            } else if (sTab === "102") {
                aFilters.push(new Filter("ReturnsOrderReason", FilterOperator.EQ, "102"));
            } else if (sTab === "OTHER") {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("ReturnsOrderReason", FilterOperator.NE, "101"),
                        new Filter("ReturnsOrderReason", FilterOperator.NE, "102")
                    ],
                    and: true
                }));
            }

            // Search filter
            if (sQuery) {
                var aSearchFilters = [
                    new Filter("CustomerReturn", FilterOperator.Contains, sQuery),
                    new Filter("SoldToParty", FilterOperator.Contains, sQuery),
                    new Filter("SoldToPartyName", FilterOperator.Contains, sQuery),
                    new Filter("ReferenceSDDocument", FilterOperator.Contains, sQuery),
                    new Filter("SDDocumentReasonText", FilterOperator.Contains, sQuery)
                ];
                aFilters.push(new Filter({
                    filters: aSearchFilters,
                    and: false
                }));
            }

            var oTable = this.byId("tblCustomerReturns");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        // =========================================================================
        // Server Metrics & Reasons
        // =========================================================================

        _loadMetrics: function () {
            var that = this;
            var oViewModel = this.getView().getModel("customerReturnsView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            return CustomerReturnService.getMetrics(this.getView().getModel("customerReturn"))
                .then(function (oMetrics) {
                    if (!oMetrics) return;
                    var iTotal = oMetrics.totalReturns != null ? oMetrics.totalReturns : 0;
                    var fVal = parseFloat(oMetrics.totalNetValue || 0);
                    var sValFormatted = isNaN(fVal) ? "0.00" : fVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    oViewModel.setProperty("/totalReturns", iTotal);
                    oViewModel.setProperty("/totalNetValueFormatted", sValFormatted);
                    oViewModel.setProperty("/poorQualityCount", oMetrics.poorQualityCount != null ? oMetrics.poorQualityCount : 0);
                    oViewModel.setProperty("/damagedTransitCount", oMetrics.damagedTransitCount != null ? oMetrics.damagedTransitCount : 0);
                    oViewModel.setProperty("/otherReasonsCount", oMetrics.otherReasonsCount != null ? oMetrics.otherReasonsCount : 0);
                })
                .catch(function () {
                    // Retain defaults gracefully
                });
        },

        _loadReasons: function () {
            var that = this;
            var oModel = this._oReturnReasonsModel;
            if (!oModel) {
                return Promise.resolve();
            }

            return CustomerReturnService.getReturnReasons(this.getView().getModel("customerReturn"))
                .then(function (aReasons) {
                    if (Array.isArray(aReasons) && aReasons.length > 0) {
                        oModel.setData(aReasons);
                    }
                })
                .catch(function () {
                    // Retain default reasons
                });
        },

        // =========================================================================
        // Items Drilldown Dialog
        // =========================================================================

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
        },

        // =========================================================================
        // Create Customer Return Dialog
        // =========================================================================

        _getDefaultCreateData: function () {
            var sToday = new Date().toISOString().slice(0, 10);
            return {
                CustomerReturnType: "ZRET",
                SoldToParty: "",
                ReturnsOrderReason: "101",
                ReferenceSDDocument: "",
                ReferenceSDDocumentCategory: "M",
                SalesOrganization: "1000",
                DistributionChannel: "10",
                OrganizationDivision: "52",
                CustomerReturnDate: sToday,
                PurchaseOrderByCustomer: "",
                Items: [
                    {
                        ItemIndex: 1,
                        Material: "",
                        OrderQuantity: "1.000",
                        OrderQuantityUnit: "KG",
                        ProductionPlant: "1110",
                        StorageLocation: "FG01",
                        ReturnReason: "101",
                        ReferenceSDDocument: "",
                        ReferenceSDDocumentItem: "000010"
                    }
                ]
            };
        },

        onCreateReturnPress: function () {
            var oRouter = this.getOwnerComponent() ? this.getOwnerComponent().getRouter() : null;
            if (oRouter) {
                oRouter.navTo("createCustomerReturn");
            }
        },

        onCancelCreateReturnDialog: function () {
            if (this._oCreateDialog) {
                this._oCreateDialog.close();
            }
        },

        onAddReturnItem: function () {
            if (!this._oCreateReturnModel) return;
            var aItems = this._oCreateReturnModel.getProperty("/Items") || [];
            var iNextIndex = aItems.length + 1;
            var sRefDoc = this._oCreateReturnModel.getProperty("/ReferenceSDDocument") || "";
            var sReason = this._oCreateReturnModel.getProperty("/ReturnsOrderReason") || "101";
            aItems.push({
                ItemIndex: iNextIndex,
                Material: "",
                OrderQuantity: "1.000",
                OrderQuantityUnit: "KG",
                ProductionPlant: "1110",
                StorageLocation: "FG01",
                ReturnReason: sReason,
                ReferenceSDDocument: sRefDoc,
                ReferenceSDDocumentItem: ("0000" + (iNextIndex * 10)).slice(-6)
            });
            this._oCreateReturnModel.setProperty("/Items", aItems);
        },

        onDeleteReturnItem: function () {
            if (!this._oCreateReturnModel) return;
            var aItems = this._oCreateReturnModel.getProperty("/Items") || [];
            if (aItems.length > 1) {
                aItems.pop();
                this._oCreateReturnModel.setProperty("/Items", aItems);
            }
        },

        onReferenceDocChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            if (sVal && this._oCreateReturnModel) {
                var aItems = this._oCreateReturnModel.getProperty("/Items") || [];
                aItems.forEach(function (it) {
                    if (!it.ReferenceSDDocument) {
                        it.ReferenceSDDocument = sVal;
                    }
                });
                this._oCreateReturnModel.setProperty("/Items", aItems);
            }
        },

        onReferenceDocValueHelp: function () {
            var that = this;
            if (!this._oRefDocSelectDialog) {
                this._oRefDocSelectDialog = new SelectDialog({
                    title: this.getText("titleReferenceDocument"),
                    search: function (oEvt) {
                        var sValue = oEvt.getParameter("value");
                        that._loadReferenceDocuments(sValue);
                    },
                    confirm: function (oEvt) {
                        var oSelectedItem = oEvt.getParameter("selectedItem");
                        if (oSelectedItem) {
                            var sDoc = oSelectedItem.getTitle();
                            var aCustomData = oSelectedItem.getCustomData();
                            that._onSelectReferenceDoc(sDoc, aCustomData);
                        }
                    }
                });
                this.getView().addDependent(this._oRefDocSelectDialog);
            }
            this._loadReferenceDocuments("");
            this._oRefDocSelectDialog.open();
        },

        _loadReferenceDocuments: function (sSearch) {
            var that = this;
            var oModel = this._oRefDocSelectDialog.getModel("refDocs");
            if (!oModel) {
                oModel = new JSONModel([]);
                this._oRefDocSelectDialog.setModel(oModel, "refDocs");
                this._oRefDocSelectDialog.bindAggregation("items", {
                    path: "refDocs>/",
                    factory: function (sId, oCtx) {
                        var item = oCtx.getObject();
                        var oLi = new StandardListItem(sId, {
                            title: item.ReferenceSDDocument,
                            description: (item.SDDocumentCategoryName || item.SDDocumentCategory || "") + " | Customer: " + (item.SoldToParty || "-"),
                            info: (item.SalesOrganization || "") + "/" + (item.DistributionChannel || "") + "/" + (item.Division || "")
                        });
                        oLi.addCustomData(new CustomData({ key: "data", value: item }));
                        return oLi;
                    }
                });
            }

            if (this._oRefDocSelectDialog.setBusy) {
                this._oRefDocSelectDialog.setBusy(true);
            }

            CustomerReturnService.getReferenceDocuments(sSearch, 50, this.getView().getModel("customerReturn"))
                .then(function (aDocs) {
                    if (that._oRefDocSelectDialog.setBusy) {
                        that._oRefDocSelectDialog.setBusy(false);
                    }
                    oModel.setData(Array.isArray(aDocs) ? aDocs : []);
                })
                .catch(function () {
                    if (that._oRefDocSelectDialog.setBusy) {
                        that._oRefDocSelectDialog.setBusy(false);
                    }
                    oModel.setData([]);
                });
        },

        _onSelectReferenceDoc: function (sDoc, aCustomData) {
            if (this._oCreateReturnModel) {
                this._oCreateReturnModel.setProperty("/ReferenceSDDocument", sDoc);
                if (aCustomData && aCustomData.length > 0) {
                    var oData = aCustomData[0].getValue();
                    if (oData) {
                        if (oData.SoldToParty) {
                            this._oCreateReturnModel.setProperty("/SoldToParty", oData.SoldToParty);
                        }
                        if (oData.SDDocumentCategory) {
                            this._oCreateReturnModel.setProperty("/ReferenceSDDocumentCategory", oData.SDDocumentCategory);
                        }
                        if (oData.SalesOrganization) {
                            this._oCreateReturnModel.setProperty("/SalesOrganization", oData.SalesOrganization);
                        }
                        if (oData.DistributionChannel) {
                            this._oCreateReturnModel.setProperty("/DistributionChannel", oData.DistributionChannel);
                        }
                        if (oData.Division) {
                            this._oCreateReturnModel.setProperty("/OrganizationDivision", oData.Division);
                        }
                    }
                }
                var aItems = this._oCreateReturnModel.getProperty("/Items") || [];
                aItems.forEach(function (it) {
                    if (!it.ReferenceSDDocument) {
                        it.ReferenceSDDocument = sDoc;
                    }
                });
                this._oCreateReturnModel.setProperty("/Items", aItems);
            }
        },

        onConfirmCreateReturn: function () {
            var that = this;
            var oCreateData = this._oCreateReturnModel ? this._oCreateReturnModel.getData() : null;
            if (!oCreateData) return;

            if (!oCreateData.SoldToParty || !oCreateData.SoldToParty.trim()) {
                MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                return;
            }
            if (!oCreateData.ReturnsOrderReason) {
                MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                return;
            }
            if (!oCreateData.Items || oCreateData.Items.length === 0 || !oCreateData.Items[0].Material) {
                MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                return;
            }

            if (this._oCreateDialog && this._oCreateDialog.setBusy) {
                this._oCreateDialog.setBusy(true);
            }

            var oPayload = {
                CustomerReturnType: oCreateData.CustomerReturnType || "ZRET",
                SoldToParty: oCreateData.SoldToParty.trim(),
                ReturnsOrderReason: oCreateData.ReturnsOrderReason,
                ReferenceSDDocument: oCreateData.ReferenceSDDocument ? oCreateData.ReferenceSDDocument.trim() : "",
                ReferenceSDDocumentCategory: oCreateData.ReferenceSDDocumentCategory || "",
                SalesOrganization: oCreateData.SalesOrganization || "1000",
                DistributionChannel: oCreateData.DistributionChannel || "10",
                OrganizationDivision: oCreateData.OrganizationDivision || "52",
                CustomerReturnDate: oCreateData.CustomerReturnDate || new Date().toISOString().slice(0, 10),
                PurchaseOrderByCustomer: oCreateData.PurchaseOrderByCustomer ? oCreateData.PurchaseOrderByCustomer.trim() : "",
                Items: (oCreateData.Items || []).map(function (it, idx) {
                    return {
                        Material: it.Material ? it.Material.trim() : "",
                        OrderQuantity: parseFloat(it.OrderQuantity) || 1,
                        OrderQuantityUnit: it.OrderQuantityUnit || "KG",
                        ProductionPlant: it.ProductionPlant || "1110",
                        StorageLocation: it.StorageLocation || "FG01",
                        ReturnReason: it.ReturnReason || oCreateData.ReturnsOrderReason || "101",
                        ReferenceSDDocument: it.ReferenceSDDocument || oCreateData.ReferenceSDDocument || "",
                        ReferenceSDDocumentItem: it.ReferenceSDDocumentItem || ("0000" + ((idx + 1) * 10)).slice(-6)
                    };
                })
            };

            CustomerReturnService.createCustomerReturn(oPayload, this.getView().getModel("customerReturn"))
                .then(function (oResult) {
                    if (that._oCreateDialog && that._oCreateDialog.setBusy) {
                        that._oCreateDialog.setBusy(false);
                    }
                    if (that._oCreateDialog) {
                        that._oCreateDialog.close();
                    }
                    var sDocNum = oResult && (oResult.CustomerReturn || (oResult.d && oResult.d.CustomerReturn));
                    MessageBox.success(
                        that.getText("msgReturnCreatedSuccess", [sDocNum || ""]),
                        {
                            title: that.getText("msgReturnCreatedSuccessTitle"),
                            onClose: function () {
                                that.onRefresh();
                            }
                        }
                    );
                })
                .catch(function (oErr) {
                    if (that._oCreateDialog && that._oCreateDialog.setBusy) {
                        that._oCreateDialog.setBusy(false);
                    }
                    var sMsg = (oErr && (oErr.message || (oErr.error && oErr.error.message))) || JSON.stringify(oErr);
                    MessageBox.error(that.getText("msgCreateReturnFailed", [sMsg]));
                });
        }
    });
});
