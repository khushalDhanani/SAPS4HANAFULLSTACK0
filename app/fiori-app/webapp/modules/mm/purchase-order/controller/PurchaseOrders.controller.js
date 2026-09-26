sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/core/library",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "saps4hana/fiori/model/formatter"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    coreLibrary,
    MessageBox,
    ValueHelpService,
    ODataClient,
    Fragment,
    formatter
) {
    "use strict";

    var SortOrder = coreLibrary.SortOrder;

    var PurchaseOrdersController = BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.PurchaseOrders", {
        onInit: function () {
            this._sCurrentSortProperty = "CreationDate";
            this._bCurrentSortDescending = true;

            var oViewModel = new JSONModel({
                totalCount: "-",
                supplierCount: "-",
                sortProperty: this._sCurrentSortProperty,
                sortDescending: this._bCurrentSortDescending
            });
            this.getView().setModel(oViewModel, "viewModel");

            this._loadServerSupplierCount();

            var oTable = this.byId("purchaseOrdersTable");
            oTable.attachEventOnce("updateFinished", this._updateKpiMetrics, this);
            oTable.attachUpdateFinished(this._updateKpiMetrics, this);

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                var oRoute = oRouter.getRoute("purchaseOrders");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onRouteMatched, this);
                }
            }
        },

        _onRouteMatched: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.refresh();
            }
            this._loadServerSupplierCount();
        },

        onAfterRendering: function () {
            this._initAIWidget();
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding && !this._bDataReceivedAttached) {
                this._bDataReceivedAttached = true;
                var that = this;
                oBinding.attachDataReceived(function (oEvent) {
                    var oError = oEvent.getParameter("error");
                    var oStatus = that.byId("connectionStatus");
                    if (oError) {
                        var iStatus = oError.statusCode || oError.status || (oError.response && oError.response.statusCode) || 500;
                        var sMessage = oError.message || that.getText("poLoadErrorMsg", null, "Failed to load Purchase Orders from SAP S/4HANA.");
                        if (oStatus) {
                            oStatus.setState("Error");
                            oStatus.setText(iStatus === 401 ? that.getText("poStatusAuthError", null, "S/4HANA Auth Error (401)") : that.getText("poStatusConnError", [iStatus], "Connection Error (" + iStatus + ")"));
                            oStatus.setIcon("sap-icon://alert");
                        }
                        if (iStatus === 401) {
                            MessageBox.error(
                                that.getText("poAuthErrorMsg", null, "Failed to load Purchase Orders from SAP S/4HANA.\n\nThe SAP S/4HANA Gateway rejected the configured credentials with HTTP 401 Unauthorized.\n\nAction Required:\n1. Verify that the password in .env.local is current.\n2. Check transaction SU01 in SAP to ensure user account is not locked due to failed logon attempts."),
                                { title: that.getText("poAuthErrorTitle", null, "S/4HANA Authentication Error") }
                            );
                        } else {
                            MessageBox.error(sMessage, { title: that.getText("poLoadErrorTitle", null, "Error Loading Purchase Orders") });
                        }
                    } else if (oStatus) {
                        oStatus.setState("Success");
                        oStatus.setText(that.getText("poStatusConnected", null, "Live S/4HANA"));
                        oStatus.setIcon("sap-icon://connected");
                    }
                });
            }
        },

        _updateKpiMetrics: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("viewModel");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
            }
        },

        _loadServerSupplierCount: function () {
            var oViewModel = this.getView().getModel("viewModel");
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
                    if (oMetrics && oMetrics.supplierCount != null) {
                        oViewModel.setProperty("/supplierCount", oMetrics.supplierCount);
                    } else {
                        oViewModel.setProperty("/supplierCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/supplierCount", "-");
                });
        },

        _buildFilterBarContextFilters: function (oSource) {
            var aFilters = [];
            if (!oSource) return aFilters;

            var sField = "";
            if (typeof oSource.data === "function") {
                sField = oSource.data("field") || "";
            }
            if (!sField) {
                var sId = typeof oSource.getId === "function" ? oSource.getId() : (oSource.id || "");
                var sControlId = sId.indexOf("--") !== -1 ? sId.split("--").pop() : sId;
                var FILTER_ID_MAP = {
                    "fbSupplier": "Supplier",
                    "fbPurchasingOrg": "PurchasingOrganization",
                    "fbDocType": "PurchaseOrderType"
                };
                sField = FILTER_ID_MAP[sControlId] || sControlId;
            }

            if (sField === "Supplier") {
                var oFbCompanyCode = typeof this.byId === "function" ? this.byId("fbCompanyCode") : null;
                var sCoCode = oFbCompanyCode && typeof oFbCompanyCode.getValue === "function" ? oFbCompanyCode.getValue().trim() : "";
                if (sCoCode) {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCoCode));
                }
                var oFbDocType = typeof this.byId === "function" ? this.byId("fbDocType") : null;
                var sDocType = oFbDocType && typeof oFbDocType.getValue === "function" ? oFbDocType.getValue().trim() : "";
                if (sDocType === "ZDOM") {
                    aFilters.push(new Filter("SupplierAccountGroup", FilterOperator.EQ, "ZDOM"));
                } else if (sDocType === "ZSTO") {
                    aFilters.push(new Filter("SupplierAccountGroup", FilterOperator.EQ, "ZINT"));
                }
            } else if (sField === "PurchasingOrganization") {
                var oFbCompanyCodePurch = typeof this.byId === "function" ? this.byId("fbCompanyCode") : null;
                var sCoCodePurch = oFbCompanyCodePurch && typeof oFbCompanyCodePurch.getValue === "function" ? oFbCompanyCodePurch.getValue().trim() : "";
                if (sCoCodePurch) {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCoCodePurch));
                }
            } else if (sField === "CompanyCode") {
                var oFbDocTypeComp = typeof this.byId === "function" ? this.byId("fbDocType") : null;
                var sDocTypeComp = oFbDocTypeComp && typeof oFbDocTypeComp.getValue === "function" ? oFbDocTypeComp.getValue().trim() : "";
                if (sDocTypeComp === "ZDOM") {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, "1000"));
                }
            } else if (sField === "PurchaseOrderType") {
                aFilters.push(new Filter("PurchasingDocumentType", FilterOperator.StartsWith, "Z"));
            }

            return aFilters;
        },

        onValueHelpRequest: function (oEvent) {
            var oSource = oEvent.getSource();
            var aInitialFilters = this._buildFilterBarContextFilters(oSource);
            if (aInitialFilters.length > 0) {
                ValueHelpService.openValueHelp(this.getView(), oSource, null, aInitialFilters);
            } else {
                ValueHelpService.openValueHelp(this.getView(), oSource);
            }
        },

        onSuggest: function (oEvent) {
            var oSource = oEvent.getSource();
            var sValue = oEvent.getParameter("suggestValue");
            var aContextFilters = this._buildFilterBarContextFilters(oSource);
            if (aContextFilters.length > 0) {
                ValueHelpService.applySuggestionFilter(oSource, sValue, aContextFilters);
            } else {
                ValueHelpService.applySuggestionFilter(oSource, sValue);
            }
        },

        onSearch: function () {
            this._applyFilters();
        },

        onFilterBarSearch: function () {
            this._applyFilters();
        },

        onFilterBarClear: function () {
            var oFbPO = this.byId("fbPO");
            var oFbSupplier = this.byId("fbSupplier");
            var oFbCompanyCode = this.byId("fbCompanyCode");
            var oFbPurchasingOrg = this.byId("fbPurchasingOrg");
            var oFbPurchasingGroup = this.byId("fbPurchasingGroup");
            var oFbDocType = this.byId("fbDocType");
            var oFbDateRange = this.byId("fbDateRange");
            var oFbCreatedBy = this.byId("fbCreatedBy");
            var oFbStatus = this.byId("fbStatus");

            if (oFbPO) oFbPO.setValue("");
            if (oFbSupplier) oFbSupplier.setValue("");
            if (oFbCompanyCode) oFbCompanyCode.setValue("");
            if (oFbPurchasingOrg) oFbPurchasingOrg.setValue("");
            if (oFbPurchasingGroup) oFbPurchasingGroup.setValue("");
            if (oFbDocType) oFbDocType.setValue("");
            if (oFbCreatedBy) oFbCreatedBy.setValue("");

            if (oFbDateRange) {
                oFbDateRange.setValue("");
                if (typeof oFbDateRange.setDateValue === "function") {
                    oFbDateRange.setDateValue(null);
                    oFbDateRange.setSecondDateValue(null);
                }
            }

            if (oFbStatus) {
                oFbStatus.setSelectedKey("");
            }

            this._applyFilters();
        },

        _formatDateToISO: function (oDate) {
            if (!oDate || !(oDate instanceof Date) || isNaN(oDate.getTime())) {
                return null;
            }
            var iYear = oDate.getFullYear();
            var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
            var sDay = String(oDate.getDate()).padStart(2, "0");
            return iYear + "-" + sMonth + "-" + sDay;
        },

        _buildFilterCriteria: function () {
            var aFilters = [];

            // 1. Global Toolbar Search Query
            var oSearchField = this.byId("searchField");
            var sQuery = oSearchField ? oSearchField.getValue() : "";
            if (sQuery && sQuery.trim().length > 0) {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PurchaseOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("Supplier", FilterOperator.Contains, sTrimmed),
                        new Filter("SupplierName", FilterOperator.Contains, sTrimmed),
                        new Filter("CompanyCode", FilterOperator.Contains, sTrimmed),
                        new Filter("CreatedByUser", FilterOperator.Contains, sTrimmed),
                        new Filter("UserFullName", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            // 2. FilterBar: Purchase Order Number
            var oFbPO = this.byId("fbPO");
            if (oFbPO && oFbPO.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrder", FilterOperator.Contains, oFbPO.getValue().trim()));
            }

            // 3. FilterBar: Supplier (Matches ID or Name)
            var oFbSupplier = this.byId("fbSupplier");
            if (oFbSupplier && oFbSupplier.getValue().trim() !== "") {
                var sSupplier = oFbSupplier.getValue().trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("Supplier", FilterOperator.Contains, sSupplier),
                        new Filter("SupplierName", FilterOperator.Contains, sSupplier)
                    ],
                    and: false
                }));
            }

            // 4. FilterBar: Company Code
            var oFbCompanyCode = this.byId("fbCompanyCode");
            if (oFbCompanyCode && oFbCompanyCode.getValue().trim() !== "") {
                aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, oFbCompanyCode.getValue().trim()));
            }

            // 5. FilterBar: Purchasing Organization
            var oFbPurchasingOrg = this.byId("fbPurchasingOrg");
            if (oFbPurchasingOrg && oFbPurchasingOrg.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchasingOrganization", FilterOperator.EQ, oFbPurchasingOrg.getValue().trim()));
            }

            // 6. FilterBar: Purchasing Group
            var oFbPurchasingGroup = this.byId("fbPurchasingGroup");
            if (oFbPurchasingGroup && oFbPurchasingGroup.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchasingGroup", FilterOperator.EQ, oFbPurchasingGroup.getValue().trim()));
            }

            // 7. FilterBar: Purchase Order Type
            var oFbDocType = this.byId("fbDocType");
            if (oFbDocType && oFbDocType.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrderType", FilterOperator.EQ, oFbDocType.getValue().trim()));
            }

            // 8. FilterBar: Creation Date Range
            var oFbDateRange = this.byId("fbDateRange");
            if (oFbDateRange) {
                var dStart = typeof oFbDateRange.getDateValue === "function" ? oFbDateRange.getDateValue() : null;
                var dEnd = typeof oFbDateRange.getSecondDateValue === "function" ? oFbDateRange.getSecondDateValue() : null;
                var sStart = this._formatDateToISO(dStart);
                var sEnd = this._formatDateToISO(dEnd);

                if (sStart && sEnd) {
                    if (sStart === sEnd) {
                        aFilters.push(new Filter("CreationDate", FilterOperator.EQ, sStart));
                    } else {
                        aFilters.push(new Filter("CreationDate", FilterOperator.BT, sStart, sEnd));
                    }
                } else if (sStart) {
                    aFilters.push(new Filter("CreationDate", FilterOperator.GE, sStart));
                }
            }

            // 9. FilterBar: Created By (Matches Username or Full Name)
            var oFbCreatedBy = this.byId("fbCreatedBy");
            if (oFbCreatedBy && oFbCreatedBy.getValue().trim() !== "") {
                var sCreatedBy = oFbCreatedBy.getValue().trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("CreatedByUser", FilterOperator.Contains, sCreatedBy),
                        new Filter("UserFullName", FilterOperator.Contains, sCreatedBy)
                    ],
                    and: false
                }));
            }

            // 10. FilterBar: Display Status (Approved, Draft, In Approval, Rejected)
            var oFbStatus = this.byId("fbStatus");
            var oStatusFilter = oFbStatus ? PurchaseOrdersController._statusFilter(oFbStatus.getSelectedKey()) : null;
            if (oStatusFilter) { aFilters.push(oStatusFilter); }

            return aFilters;
        },

        _applyFilters: function () {
            var aFilters = this._buildFilterCriteria();
            var oFinalFilter = aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : [];

            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(oFinalFilter);
            }
        },

        onSortColumn: function (oEvent) {
            var oLink = oEvent.getSource();
            var sSortProperty = oLink.data ? oLink.data("sortProperty") : null;
            if (!sSortProperty) {
                return;
            }

            if (this._sCurrentSortProperty === sSortProperty) {
                this._bCurrentSortDescending = !this._bCurrentSortDescending;
            } else {
                this._sCurrentSortProperty = sSortProperty;
                this._bCurrentSortDescending = true;
            }

            var oTable = this.byId("purchaseOrdersTable");
            var aColumns = oTable ? oTable.getColumns() : [];
            var sActiveIndicator = this._bCurrentSortDescending ? SortOrder.Descending : SortOrder.Ascending;

            aColumns.forEach(function (oCol) {
                var oHeader = oCol.getHeader();
                var sColProp = oHeader && oHeader.data ? oHeader.data("sortProperty") : null;
                if (sColProp === sSortProperty) {
                    oCol.setSortIndicator(sActiveIndicator);
                } else {
                    oCol.setSortIndicator(SortOrder.None);
                }
            });

            var oViewModel = this.getView().getModel("viewModel");
            if (oViewModel) {
                oViewModel.setProperty("/sortProperty", this._sCurrentSortProperty);
                oViewModel.setProperty("/sortDescending", this._bCurrentSortDescending);
            }

            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                var aSorters = [new Sorter(this._sCurrentSortProperty, this._bCurrentSortDescending)];
                if (this._sCurrentSortProperty === "CreationDate") {
                    aSorters.push(new Sorter("PurchaseOrder", this._bCurrentSortDescending));
                }
                oBinding.sort(aSorters);
            }
        },

        onRefresh: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                // oBinding.refresh() reloads data while retaining active filters ($filter) and sorters ($orderby)
                oBinding.refresh();
            }
            this._loadServerSupplierCount();
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "dashboard");
        },

        onCreatePO: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createPurchaseOrder");
        },

        // ---------------- Ask AI chat (NVIDIA NIM via /odata/v4/ai/chat) ----------------
        /** Loads the floating launcher + assistant panel once and mounts them into the page. */
        _initAIWidget: function () {
            var oView = this.getView(), that = this;
            if (this._pAIWidget) { return this._pAIWidget; }
            oView.setModel(new JSONModel({ open: false, question: "", messages: [], busy: false }), "aiDialog");
            this._pAIWidget = Fragment.load({
                id: oView.getId(),
                name: "saps4hana.fiori.modules.mm.purchase-order.view.AskAIDialog",
                controller: this
            }).then(function (aControls) {
                var oPage = that.byId("purchaseOrdersPage");
                [].concat(aControls).forEach(function (oCtl) { oPage.addContent(oCtl); });
            });
            return this._pAIWidget;
        },

        onAskAI: function () {
            var that = this;
            this._initAIWidget().then(function () {
                that.getView().getModel("aiDialog").setProperty("/open", true);
                that._scrollAIChatToBottom();
                var oInput = that.byId("aiInput");
                if (oInput) { setTimeout(function () { oInput.focus(); }, 100); }
            });
        },

        onAIClose: function () {
            this.getView().getModel("aiDialog").setProperty("/open", false);
        },

        onAIClear: function () {
            var oModel = this.getView().getModel("aiDialog");
            oModel.setProperty("/messages", []);
            oModel.setProperty("/question", "");
        },

        onAIPreset: function (oEvent) {
            this.getView().getModel("aiDialog").setProperty("/question", oEvent.getSource().getText());
            this.onAIAsk();
        },

        /**
         * Rows for the AI context: up to AI_CONTEXT_ROWS purchase orders matching the current filter bar,
         * read from the server (not just the page loaded in the table). Falls back to the loaded rows.
         */
        _fetchAIContextRows: function () {
            var that = this;
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!oModel || typeof oModel.bindList !== "function") { return Promise.resolve(this._getLoadedPurchaseOrders()); }
            var oBinding = oModel.bindList("/PurchaseOrders", undefined,
                [new Sorter(this._sCurrentSortProperty || "CreationDate", this._bCurrentSortDescending !== false)],
                this._buildFilterCriteria(), { $count: true });
            return oBinding.requestContexts(0, PurchaseOrdersController.AI_CONTEXT_ROWS).then(function (aCtx) {
                var aRows = aCtx.map(function (oCtx) { return PurchaseOrdersController._toAIRow(oCtx.getObject()); });
                oBinding.destroy();
                return aRows;
            }).catch(function () {
                oBinding.destroy();
                return that._getLoadedPurchaseOrders();
            });
        },

        /** Top N purchase orders by net amount across the whole (filtered) list, sorted by the server. */
        _fetchTopPOsByNet: function (iN) {
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!oModel || typeof oModel.bindList !== "function") { return Promise.resolve(null); }
            var oBinding = oModel.bindList("/PurchaseOrders", undefined, [new Sorter("PurchaseOrderNetAmount", true)], this._buildFilterCriteria());
            return oBinding.requestContexts(0, iN || 15).then(function (aCtx) {
                var a = aCtx.map(function (oCtx) { return PurchaseOrdersController._toAIRow(oCtx.getObject()); });
                oBinding.destroy();
                return a;
            }).catch(function () { oBinding.destroy(); return null; });
        },

        /**
         * Line items of the context purchase orders (for item / material / plant / quantity questions).
         * Reads PurchaseOrderItems in batches of PO numbers (OR filter) to keep URLs short; capped at AI_ITEM_ROWS.
         */
        _fetchItemsForPOs: function (aPoNumbers) {
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            var aPos = (aPoNumbers || []).filter(Boolean).slice(0, PurchaseOrdersController.AI_ITEM_POS);
            if (!oModel || typeof oModel.bindList !== "function" || !aPos.length) { return Promise.resolve([]); }
            var aBatches = [];
            for (var i = 0; i < aPos.length; i += 40) { aBatches.push(aPos.slice(i, i + 40)); }
            return Promise.all(aBatches.map(function (aBatch) {
                var oFilter = new Filter({ filters: aBatch.map(function (sPo) { return new Filter("PurchaseOrder", FilterOperator.EQ, sPo); }), and: false });
                var oBinding = oModel.bindList("/PurchaseOrderItems", undefined, [new Sorter("PurchaseOrder", true), new Sorter("PurchaseOrderItem", false)], [oFilter]);
                return oBinding.requestContexts(0, PurchaseOrdersController.AI_ITEM_ROWS)
                    .then(function (aCtx) { var a = aCtx.map(function (c) { return PurchaseOrdersController._toAIItem(c.getObject()); }); oBinding.destroy(); return a; })
                    .catch(function () { oBinding.destroy(); return []; });
            })).then(function (aAll) {
                return [].concat.apply([], aAll).slice(0, PurchaseOrdersController.AI_ITEM_ROWS);
            });
        },

        /**
         * Server-side text search over ALL purchase order items (item text / material) for the search terms in the question,
         * plus the header rows of the matching POs. Resolves {{terms, count, items, headers}} or null.
         */
        _searchItems: function (sQuestion) {
            var aTerms = PurchaseOrdersController._extractSearchTerms(sQuestion);
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!aTerms.length || !oModel || typeof oModel.bindList !== "function") { return Promise.resolve(null); }
            var that = this;
            var termFilter = function (t) {
                return new Filter({ filters: [new Filter("PurchaseOrderItemText", FilterOperator.Contains, t), new Filter("Material", FilterOperator.Contains, t)], and: false });
            };
            var run = function (bAnd) {
                var oFilter = new Filter({ filters: aTerms.map(termFilter), and: bAnd });
                var oBinding = oModel.bindList("/PurchaseOrderItems", undefined, [new Sorter("PurchaseOrder", true), new Sorter("PurchaseOrderItem", false)], [oFilter], { $count: true });
                return oBinding.requestContexts(0, PurchaseOrdersController.AI_SEARCH_ROWS).then(function (aCtx) {
                    var r = { items: aCtx.map(function (c) { return PurchaseOrdersController._toAIItem(c.getObject()); }), count: oBinding.getCount() };
                    oBinding.destroy();
                    return r;
                }).catch(function () { oBinding.destroy(); return { items: [], count: 0 }; });
            };
            // all terms must match (precise, e.g. "Apple Macbook Pro"); if nothing matches, fall back to any term
            return run(true).then(function (r) {
                if (r.count || aTerms.length === 1) { r.mode = "all"; return r; }
                return run(false).then(function (r2) { r2.mode = "any"; return r2; });
            }).then(function (r) {
                var aPos = r.items.map(function (i) { return i.po; }).filter(function (p, i, a) { return p && a.indexOf(p) === i; }).slice(0, 80);
                return that._fetchHeadersForPOs(aPos).then(function (aHeaders) {
                    return { terms: aTerms, mode: r.mode, count: r.count, items: r.items, headers: aHeaders };
                });
            });
        },

        /** Header rows for specific PO numbers (OR-filter batches of 40). */
        _fetchHeadersForPOs: function (aPoNumbers) {
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!oModel || !aPoNumbers.length) { return Promise.resolve([]); }
            var aBatches = [];
            for (var i = 0; i < aPoNumbers.length; i += 40) { aBatches.push(aPoNumbers.slice(i, i + 40)); }
            return Promise.all(aBatches.map(function (aBatch) {
                var oFilter = new Filter({ filters: aBatch.map(function (sPo) { return new Filter("PurchaseOrder", FilterOperator.EQ, sPo); }), and: false });
                var oBinding = oModel.bindList("/PurchaseOrders", undefined, undefined, [oFilter]);
                return oBinding.requestContexts(0, aBatch.length)
                    .then(function (aCtx) { var a = aCtx.map(function (c) { return PurchaseOrdersController._toAIRow(c.getObject()); }); oBinding.destroy(); return a; })
                    .catch(function () { oBinding.destroy(); return []; });
            })).then(function (aAll) { return [].concat.apply([], aAll); });
        },

        /** Compact rows currently loaded in the table (fallback context). */
        _getLoadedPurchaseOrders: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable && oTable.getBinding("items");
            var aCtx = oBinding ? oBinding.getCurrentContexts() : [];
            return aCtx.filter(Boolean).map(function (oCtx) {
                return PurchaseOrdersController._toAIRow(oCtx.getObject());
            });
        },

        /**
         * PO numbers typed in the question are loaded from SAP with their items (even if not in the table),
         * so the assistant can answer about a specific document. Resolves {rows, notFound}.
         */
        _fetchMentionedPurchaseOrders: function (sQuestion, aRows) {
            var aNumbers = PurchaseOrdersController._extractPONumbers(sQuestion);
            var aNotFound = [];
            var aOut = aRows.slice();
            return Promise.all(aNumbers.map(function (sPo) {
                return ODataClient.get("/odata/v4/purchase-order/PurchaseOrders('" + encodeURIComponent(sPo) + "')" +
                    "?$expand=to_PurchaseOrderItem($select=PurchaseOrderItem,Material,PurchaseOrderItemText,Plant,OrderQuantity," +
                    "PurchaseOrderQuantityUnit,NetPriceAmount,NetAmount,FirstDeliveryDate,PurchaseOrderItemStatus)")
                    .then(function (oPo) {
                        var oRow = PurchaseOrdersController._toAIRow(oPo);
                        oRow.items = (oPo.to_PurchaseOrderItem || []).map(function (it) {
                            return { item: it.PurchaseOrderItem, material: it.Material, text: it.PurchaseOrderItemText, plant: it.Plant,
                                qty: it.OrderQuantity, unit: it.PurchaseOrderQuantityUnit, price: it.NetPriceAmount, net: it.NetAmount,
                                delivery: it.FirstDeliveryDate ? String(it.FirstDeliveryDate).slice(0, 10) : null, status: it.PurchaseOrderItemStatus };
                        });
                        aOut = aOut.filter(function (r) { return r.po !== sPo; });
                        aOut.push(oRow);
                    })
                    .catch(function () { aNotFound.push(sPo); });
            })).then(function () { return { rows: aOut, notFound: aNotFound }; });
        },

        /** Real totals for the current filter (server $count / KPI), so the model does not count the loaded page. */
        _getAIScope: function (iShown) {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable && oTable.getBinding("items");
            var iTotal = null;
            if (oBinding && typeof oBinding.getCount === "function") { iTotal = oBinding.getCount(); }
            if (iTotal == null && oBinding && typeof oBinding.getLength === "function" && oBinding.isLengthFinal && oBinding.isLengthFinal()) { iTotal = oBinding.getLength(); }
            var oVM = this.getView().getModel("viewModel");
            var vKpi = oVM ? oVM.getProperty("/totalCount") : null;
            if (iTotal == null && vKpi != null && vKpi !== "-" && !isNaN(Number(vKpi))) { iTotal = Number(vKpi); }
            var vSuppliers = oVM ? oVM.getProperty("/supplierCount") : null;
            return {
                shown: iShown,
                total: iTotal,
                supplierTotal: (vSuppliers != null && vSuppliers !== "-" && !isNaN(Number(vSuppliers))) ? Number(vSuppliers) : null,
                filtered: !!(oBinding && typeof oBinding.getFilters === "function" && (oBinding.getFilters("Application") || []).length)
            };
        },

        /**
         * Exact server-side counts per display status for the current filters (one $count per status),
         * so "how many open/approved/..." is never answered from the loaded page.
         */
        _getAIStatusBreakdown: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!oModel || typeof oModel.bindList !== "function") { return Promise.resolve(null); }
            var aBase = this._buildFilterCriteria();
            function count(aFilters) {
                var oBinding = oModel.bindList("/PurchaseOrders", undefined, undefined, aFilters, { $count: true });
                return oBinding.requestContexts(0, 1)
                    .then(function () { var n = oBinding.getCount(); oBinding.destroy(); return n; })
                    .catch(function () { oBinding.destroy(); return null; });
            }
            return Promise.all([count(aBase)].concat(PurchaseOrdersController.AI_STATUS_CODES.map(function (sCode) {
                return count(aBase.concat([new Filter("PurchasingDocumentStatus", FilterOperator.EQ, sCode)]));
            }))).then(function (aCounts) {
                var o = { total: aCounts[0], byStatus: {} }, iSum = 0;
                PurchaseOrdersController.AI_STATUS_CODES.forEach(function (sCode, i) {
                    var n = aCounts[i + 1];
                    if (n != null) { o.byStatus[sCode + " " + formatter.statusCodeName(sCode)] = n; iSum += n; }
                });
                if (o.total != null) { o.byStatus.Other = Math.max(0, o.total - iSum); }
                return o;
            }).catch(function () { return null; });
        },

        _scrollAIChatToBottom: function (iDuration) {
            var oScroll = this.byId("aiChatScroll");
            if (oScroll) { setTimeout(function () { oScroll.scrollTo(0, 1e6, iDuration == null ? 200 : iDuration); }, 50); }
        },

        onAIAsk: function () {
            var that = this;
            var oModel = this.getView().getModel("aiDialog");
            var sQuestion = (oModel.getProperty("/question") || "").trim();
            if (!sQuestion || oModel.getProperty("/busy")) { return; }
            var aMessages = (oModel.getProperty("/messages") || []).slice();
            aMessages.push({ role: "user", content: sQuestion, html: PurchaseOrdersController._toHtml(sQuestion), meta: that._formatTime(new Date()) });
            oModel.setProperty("/messages", aMessages);
            oModel.setProperty("/question", "");
            oModel.setProperty("/busy", true);
            this._scrollAIChatToBottom();
            var oAnswer = null, oScope;
            var oPayload;
            var bItems = PurchaseOrdersController._asksAboutItems(sQuestion);
            return Promise.all([
                this._fetchAIContextRows().then(function (aRows) { return that._fetchMentionedPurchaseOrders(sQuestion, aRows); })
                    .then(function (oCtx) {
                        if (!bItems) { return oCtx; }
                        return that._fetchItemsForPOs(oCtx.rows.map(function (r) { return r.po; })).then(function (aItems) { oCtx.items = aItems; return oCtx; });
                    }),
                PurchaseOrdersController._asksAboutStatus(sQuestion) ? this._getAIStatusBreakdown() : null,
                this._fetchTopPOsByNet(15),
                this._searchItems(sQuestion)
            ]).then(function (aRes) {
                var oCtx = aRes[0];
                oScope = that._getAIScope(oCtx.rows.length);
                oScope.statusCounts = aRes[1];
                oScope.topPOsByNet = aRes[2];
                oScope.items = oCtx.items || null;
                oScope.search = aRes[3];
                if (oScope.search && oScope.search.headers.length) {
                    // make the matching POs part of the context rows (deduplicated) so supplier/status questions work
                    var mSeen = {};
                    oCtx.rows.forEach(function (r) { mSeen[r.po] = true; });
                    oScope.search.headers.forEach(function (r) { if (!mSeen[r.po]) { oCtx.rows.push(r); mSeen[r.po] = true; } });
                }
                oScope.shown = oCtx.rows.length;
                that._oLastAIScope = oScope;
                oPayload = {
                    messages: aMessages.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; }),
                    system: PurchaseOrdersController._buildAISystemPrompt(oCtx.rows, oCtx.notFound, oScope)
                };
                // Streaming first; the OData action is the fallback when the stream cannot even start.
                return that._streamAIChat(oPayload, function (sPartial) {
                    if (!oAnswer) {
                        oAnswer = { role: "assistant", content: "", html: "", meta: "" };
                        aMessages.push(oAnswer);
                        oModel.setProperty("/busy", false);
                    }
                    oAnswer.content = sPartial;
                    oAnswer.html = PurchaseOrdersController._toHtml(sPartial);
                    that._refreshAIMessages(aMessages);
                }).catch(function (oErr) {
                    if (oAnswer) { throw oErr; }
                    return ODataClient.post("/odata/v4/ai/chat", oPayload).then(function (r) { return { content: (r && r.answer) || "", model: r && r.model }; });
                });
            }).then(function (oResult) {
                if (!oAnswer) { oAnswer = { role: "assistant" }; aMessages.push(oAnswer); }
                if (oResult.truncated) { oResult.content += "\n\n_" + that.getText("aiTruncated") + "_"; }
                oAnswer.content = oResult.content;
                oAnswer.html = PurchaseOrdersController._toHtml(oResult.content);
                oAnswer.meta = PurchaseOrdersController._aiMetaText(that, oScope, oResult.model);
                oAnswer.metaTooltip = PurchaseOrdersController._aiMetaTooltip(oScope);
            }).catch(function (oErr) {
                var sMsg = (oErr && oErr.message) || String(oErr);
                aMessages.push({ role: "assistant", error: true, content: sMsg, html: PurchaseOrdersController._toHtml(sMsg), meta: "" });
            }).finally(function () {
                oModel.setProperty("/busy", false);
                that._refreshAIMessages(aMessages, true);
            });
        },

        /** Pushes the message array to the model, throttled to one render per animation frame while streaming. */
        _refreshAIMessages: function (aMessages, bNow) {
            var that = this, oModel = this.getView().getModel("aiDialog");
            var apply = function () { that._iAIRaf = null; oModel.setProperty("/messages", aMessages.slice()); that._scrollAIChatToBottom(0); };
            if (bNow || typeof requestAnimationFrame !== "function") { if (this._iAIRaf) { cancelAnimationFrame(this._iAIRaf); } apply(); return; }
            if (!this._iAIRaf) { this._iAIRaf = requestAnimationFrame(apply); }
        },

        /**
         * POST /ai/chat/stream (SSE). Calls onPartial with the accumulated text after each chunk.
         * Resolves {content, model}; rejects if the stream fails (before or after the first chunk).
         */
        _streamAIChat: function (oPayload, fnPartial) {
            if (typeof fetch !== "function" || typeof TextDecoder !== "function") { return Promise.reject(new Error("streaming unsupported")); }
            var mHeaders = Object.assign({ "Content-Type": "application/json", "Accept": "text/event-stream" }, ODataClient.authHeaders());
            return fetch("/ai/chat/stream", { method: "POST", headers: mHeaders, body: JSON.stringify(oPayload), credentials: "same-origin" }).then(function (oRes) {
                if (!oRes.ok || !oRes.body) { throw new Error("stream HTTP " + oRes.status); }
                var oReader = oRes.body.getReader(), oDec = new TextDecoder(), sBuf = "", sText = "", sModel = null, sTruncated = false;
                return new Promise(function (resolve, reject) {
                    var pump = function () {
                        oReader.read().then(function (r) {
                            if (r.done) { resolve({ content: sText, model: sModel, truncated: sTruncated }); return; }
                            sBuf += oDec.decode(r.value, { stream: true });
                            var o = PurchaseOrdersController._parseSSE(sBuf);
                            sBuf = o.rest;
                            for (var i = 0; i < o.events.length; i++) {
                                var e = o.events[i];
                                if (e.error) { reject(new Error(e.error)); return; }
                                if (e.delta) { sText += e.delta; fnPartial(sText); }
                                if (e.done) { sModel = e.model || sModel; if (e.finishReason === "length") { sTruncated = true; } }
                            }
                            pump();
                        }).catch(reject);
                    };
                    pump();
                });
            });
        },

        _formatTime: function (d) {
            return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem ? oItem.getBindingContext() : null;
            if (oContext) {
                var sPoId = oContext.getProperty("PurchaseOrder");
                if (sPoId) {
                    var oRouter = this.getOwnerComponent().getRouter();
                    oRouter.navTo("purchaseOrderDetail", {
                        PurchaseOrder: sPoId
                    });
                }
            }
        }
    });

    /** Static helpers (pure, unit-tested). */
    PurchaseOrdersController._toAIRow = function (o) {
        o = o || {};
        return {
            po: o.PurchaseOrder, type: o.PurchaseOrderType,
            supplier: o.Supplier, supplierName: o.SupplierName,
            company: o.CompanyCode, purchOrg: o.PurchasingOrganization, purchGroup: o.PurchasingGroup,
            created: o.CreationDate ? String(o.CreationDate).slice(0, 10) : null, createdBy: o.CreatedByUser,
            netAmount: o.PurchaseOrderNetAmount, currency: o.DocumentCurrency,
            status: o.PurchasingDocumentStatusName || o.PurchasingDocumentStatus || null,
            deleted: o.PurchasingDocumentDeletionCode === "L" || undefined
        };
    };

    /** Max purchase orders sent as AI context per question (newest first, current filters). ponytail: fixed cap; raise or page when the model/context allows. */
    PurchaseOrdersController.AI_CONTEXT_ROWS = 300;

    /** Item context caps: line items are read for at most AI_ITEM_POS purchase orders and AI_ITEM_ROWS items in total. */
    PurchaseOrdersController.AI_ITEM_POS = 120;
    PurchaseOrdersController.AI_ITEM_ROWS = 600;

    PurchaseOrdersController.AI_SEARCH_ROWS = 200;

    /** Words worth searching for in item texts: >= 3 letters/digits, not in the stop list, not a 10-digit PO number. */
    PurchaseOrdersController._extractSearchTerms = function (sText) {
        var STOP = ("a an the and or of for to in on at by with from into about as is are was were be been do does did have has had " +
            "how many much what which who whom whose when where why show list give me find get tell count total sum number amount value " +
            "top most least highest lowest largest smallest biggest all any some each per every this that these those there their " +
            "purchase purchasing order orders ordered ordering po pos document documents item items line lines material materials product products plant plants receive receives receiving " +
            "supplier suppliers vendor vendors status open approved draft rejected pending released sent complete completed created " +
            "quantity qty unit units pcs nos pieces piece price prices net gross delivery date month year week day today yesterday recent latest new old " +
            "please can could would should you your we our my also only just with without between above below more than less " +
            "table format summary summarize summarise group grouped wise breakdown compare comparison company code org organisation organization " +
            "search searching look looking exist exists exists existing available data details detail info information report").split(/\s+/);
        var m = {};
        STOP.forEach(function (w) { m[w] = true; });
        var aFound = String(sText || "").match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || [];
        return aFound.map(function (w) { return w.replace(/^-+|-+$/g, ""); })
            .filter(function (w, i, a) { return w.length >= 3 && !m[w.toLowerCase()] && !/^\d+$/.test(w) && a.indexOf(w) === i; })
            .slice(0, 5);
    };

    PurchaseOrdersController._asksAboutItems = function (sText) {
        return /\b(item|line|material|product|qty|quantit|plant|storage|deliver|price|unit\b|kg\b|requisition|tax|mat(erial)? ?group)/i.test(String(sText || ""));
    };

    PurchaseOrdersController._toAIItem = function (it) {
        it = it || {};
        return {
            po: it.PurchaseOrder, item: it.PurchaseOrderItem, material: it.Material, text: it.PurchaseOrderItemText,
            matGroup: it.MaterialGroup, plant: it.Plant, sloc: it.StorageLocation || undefined,
            qty: it.OrderQuantity, unit: it.PurchaseOrderQuantityUnit, price: it.NetPriceAmount, net: it.NetAmount, cur: it.DocumentCurrency,
            delivery: it.FirstDeliveryDate ? String(it.FirstDeliveryDate).slice(0, 10) : null,
            status: it.PurchaseOrderItemStatus || undefined, requisitioner: it.RequisitionerName || undefined
        };
    };

    /** Exact item aggregates: per material, material group, plant and PO (count, quantity by unit, net by currency). */
    PurchaseOrdersController._aggregateItems = function (aItems, aHeaders) {
        aItems = aItems || [];
        var mSup = {};
        (aHeaders || []).forEach(function (h) { mSup[h.po] = (h.supplier || "?") + (h.supplierName ? " " + h.supplierName : ""); });
        var groups = { byMaterial: function (i) { return (i.material || "?") + (i.text ? " " + i.text : ""); }, byMatGroup: function (i) { return i.matGroup || "?"; },
            byPlant: function (i) { return i.plant || "?"; }, byPO: function (i) { return i.po; }, byRequisitioner: function (i) { return i.requisitioner || "?"; } };
        if (aHeaders) { groups.bySupplier = function (i) { return mSup[i.po] || "?"; }; }
        var out = { items: aItems.length, purchaseOrders: {} };
        Object.keys(groups).forEach(function (k) { out[k] = {}; });
        aItems.forEach(function (i) {
            out.purchaseOrders[i.po] = 1;
            Object.keys(groups).forEach(function (k) {
                var key = groups[k](i), e = out[k][key] || (out[k][key] = { items: 0, qty: {}, net: {} });
                e.items += 1;
                var q = Number(i.qty), n = Number(i.net);
                if (i.unit && !isNaN(q)) { e.qty[i.unit] = (e.qty[i.unit] || 0) + q; }
                if (i.cur && !isNaN(n)) { e.net[i.cur] = (e.net[i.cur] || 0) + n; }
            });
        });
        out.purchaseOrders = Object.keys(out.purchaseOrders).length;
        var round = function (o) { var r = {}; Object.keys(o).forEach(function (c) { r[c] = Math.round(o[c] * 1000) / 1000; }); return r; };
        Object.keys(groups).forEach(function (k) {
            out[k] = Object.keys(out[k]).map(function (key) { return { key: key, items: out[k][key].items, qty: round(out[k][key].qty), net: round(out[k][key].net) }; })
                .sort(function (a, b) { return b.items - a.items; }).slice(0, 40);
        });
        return out;
    };

    /** SAP PurchasingDocumentStatus codes counted for the AI (server-side $count each). */
    PurchaseOrdersController.AI_STATUS_CODES = ["01", "02", "03", "04", "05", "08", "38"];

    /** OData filter for one display status of the list (same rules as the Status filter bar field). */
    PurchaseOrdersController._statusFilter = function (sKey) {
        var m = {
            "Approved": [["PurchasingDocumentStatus", "04"], ["PurchasingDocumentStatus", "05"], ["PurchasingCompletenessStatus", true]],
            "true": "Approved",
            "Draft": [["PurchasingDocumentStatus", "01"], ["PurchasingCompletenessStatus", false]],
            "false": "Draft",
            "In Approval": [["PurchasingDocumentStatus", "02"], ["ReleaseIsNotCompleted", true]],
            "Rejected": [["PurchasingDocumentStatus", "38"], ["PurchasingDocumentDeletionCode", "L"]]
        };
        var a = typeof m[sKey] === "string" ? m[m[sKey]] : m[sKey];
        if (!a) { return null; }
        var oF = new Filter({ filters: a.map(function (p) { return new Filter(p[0], FilterOperator.EQ, p[1]); }), and: false });
        oF.__aiStatus = true;
        return oF;
    };

    /** Footer under an answer: what the model actually had (list total, status counts, loaded rows) and which model. */
    PurchaseOrdersController._aiMetaText = function (oCtl, oScope, sModel) {
        oScope = oScope || {};
        var aParts = [];
        if (oScope.total != null) { aParts.push(oCtl.getText("aiMetaTotal", [oScope.total])); }
        if (oScope.statusCounts && oScope.statusCounts.byStatus) { aParts.push(oCtl.getText("aiMetaStatus")); }
        aParts.push(oCtl.getText("aiMetaRows", [oScope.shown != null ? oScope.shown : 0]));
        aParts.push(oCtl.getText("aiMetaModel", [sModel || "-"]));
        return aParts.join(" \u00B7 ");
    };

    /** Long-form scope description shown as tooltip on the answer caption. */
    PurchaseOrdersController._aiMetaTooltip = function (oScope) {
        oScope = oScope || {};
        var a = [];
        if (oScope.total != null) { a.push(oScope.total + " purchase orders in the " + (oScope.filtered ? "filtered " : "") + "list (server count)"); }
        a.push((oScope.shown || 0) + " most recent purchase orders sent to the model with exact aggregates (supplier, status, company, type, month)");
        if (oScope.statusCounts && oScope.statusCounts.byStatus) {
            a.push("Status counts (server): " + Object.keys(oScope.statusCounts.byStatus).map(function (k) { return k + " " + oScope.statusCounts.byStatus[k]; }).join(", "));
        }
        return a.join("\n");
    };

    PurchaseOrdersController._asksAboutStatus = function (sText) {
        return /\b(open|approved|approval|draft|rejected|pending|status|released|complete)/i.test(String(sText || ""));
    };

    /**
     * Exact aggregates over the context rows, computed here so the model never has to count or add up
     * hundreds of rows itself: per supplier (count + net by currency), per status, per company, per type, per month.
     */
    PurchaseOrdersController._aggregateRows = function (aRows) {
        aRows = aRows || [];
        // count + net-by-currency for every categorical field the model may be asked to group by
        var GROUPS = { status: "status", company: "company", type: "type", purchOrg: "purchOrg", purchGroup: "purchGroup",
            createdBy: "createdBy", currency: "currency", month: function (r) { return r.created ? String(r.created).slice(0, 7) : null; } };
        var bySupplier = {}, netByCurrency = {}, oBy = {};
        Object.keys(GROUPS).forEach(function (k) { oBy[k] = {}; });
        var bump = function (o, k, fNet, sCur) {
            var e = o[k] || (o[k] = { count: 0, net: {} });
            e.count += 1;
            if (sCur && !isNaN(fNet)) { e.net[sCur] = (e.net[sCur] || 0) + fNet; }
        };
        aRows.forEach(function (r) {
            var fNet = Number(r.netAmount), sCur = r.currency;
            bump(bySupplier, (r.supplier || "?") + (r.supplierName ? " " + r.supplierName : ""), fNet, sCur);
            if (sCur && !isNaN(fNet)) { netByCurrency[sCur] = (netByCurrency[sCur] || 0) + fNet; }
            Object.keys(GROUPS).forEach(function (k) {
                var g = GROUPS[k], v = typeof g === "function" ? g(r) : r[g];
                bump(oBy[k], v == null || v === "" ? "?" : String(v), fNet, sCur);
            });
        });
        var round = function (o) { var r = {}; Object.keys(o).forEach(function (c) { r[c] = Math.round(o[c] * 100) / 100; }); return r; };
        var flat = function (o, iMax) {
            return Object.keys(o).map(function (k) { return { key: k, count: o[k].count, net: round(o[k].net) }; })
                .sort(function (a, b) { return b.count - a.count; }).slice(0, iMax || 50);
        };
        var maxNet = function (v) { var m = 0; Object.keys(v.net).forEach(function (c) { m = Math.max(m, v.net[c]); }); return m; };
        var out = {
            rows: aRows.length,
            netByCurrency: round(netByCurrency),
            topSuppliersByCount: flat(bySupplier, 15).map(function (e) { return { supplier: e.key, count: e.count, net: e.net }; }),
            topSuppliersByNet: Object.keys(bySupplier).sort(function (a, b) { return maxNet(bySupplier[b]) - maxNet(bySupplier[a]); }).slice(0, 15)
                .map(function (k) { return { supplier: k, count: bySupplier[k].count, net: round(bySupplier[k].net) }; })
        };
        Object.keys(GROUPS).forEach(function (k) { out["by" + k.charAt(0).toUpperCase() + k.slice(1)] = flat(oBy[k]); });
        return out;
    };

    /** 10-digit SAP document numbers mentioned in free text (de-duplicated, max 5). */
    PurchaseOrdersController._extractPONumbers = function (sText) {
        var aFound = String(sText || "").match(/\b\d{10}\b/g) || [];
        return aFound.filter(function (n, i) { return aFound.indexOf(n) === i; }).slice(0, 5);
    };

    PurchaseOrdersController._buildAISystemPrompt = function (aRows, aNotFound, oScope) {
        oScope = oScope || {};
        var bAll = oScope.total != null && oScope.shown >= oScope.total;
        var sScope = oScope.total != null
            ? "SCOPE: the list " + (oScope.filtered ? "with the user's current filters " : "") + "contains " + oScope.total + " purchase orders in total" +
              (oScope.supplierTotal != null ? " from " + oScope.supplierTotal + " suppliers" : "") +
              (bAll ? "; ALL of them are included below, so you can analyse them fully. "
                    : "; the " + oScope.shown + " most recent ones are included below. ") +
              (oScope.statusCounts && oScope.statusCounts.byStatus ? "STATUS COUNTS for the whole list by SAP status (server-side, exact): " +
                  Object.keys(oScope.statusCounts.byStatus).map(function (k) { return k + " = " + oScope.statusCounts.byStatus[k]; }).join(", ") +
                  ". Use these for any status question. Treat \"open\" as Draft + In Approval + Not Yet Sent unless the user defines it otherwise; " +
                  "Sent / Follow-On Documents / Released are approved and processed. " : "") +
              (bAll ? "" : "For any count or total across all purchase orders use the SCOPE figures, never count the rows below; " +
              "when a question needs data beyond the included rows, say the answer is based on the " + oScope.shown + " most recent purchase orders only. ")
            : "SCOPE: " + (oScope.shown != null ? oScope.shown : aRows.length) + " purchase orders are included below; the full list may be larger. ";
        return "You are an SAP MM procurement assistant for Aether Industries. " +
            sScope +
            "Answer only from the purchase order data below (JSON, one object per PO; POs the user asked about by number include their items). " +
            "If the data does not contain the answer, say so. Be concise; use short bullet lists where useful. " +
            "Amounts are in the row currency." +
            (aNotFound && aNotFound.length ? " These PO numbers were looked up in SAP and do NOT exist or are not accessible: " + aNotFound.join(", ") + "." : "") +
            (oScope.topPOsByNet && oScope.topPOsByNet.length ? "\n\nTOP_PURCHASE_ORDERS_BY_NET_AMOUNT across the WHOLE list" + (oScope.filtered ? " (current filters)" : "") +
                ", sorted by the server (exact; use this for any 'largest / top N purchase orders' question) = " + JSON.stringify(oScope.topPOsByNet) : "") +
            "\n\nAGGREGATES over the included purchase orders (exact, computed by the application - use these for counts, sums, rankings and top-N instead of adding up rows yourself) = " +
            JSON.stringify(PurchaseOrdersController._aggregateRows(aRows)) +
            (oScope.search ? "\n\nITEM_SEARCH: a server-side search over ALL purchase order items (whole list, item text and material) for " +
                (oScope.search.mode === "any" ? "ANY of the terms " : "ALL the terms ") + JSON.stringify(oScope.search.terms) + " found " + oScope.search.count + " matching line items" +
                (oScope.search.count > oScope.search.items.length ? " (the " + oScope.search.items.length + " most recent are listed)" : "") +
                ". SEARCH_AGGREGATES (exact: per material, supplier, plant, PO and requisitioner - item count, quantity by unit, net by currency; use these for totals) = " +
                JSON.stringify(PurchaseOrdersController._aggregateItems(oScope.search.items, oScope.search.headers)) +
                ". Matching items = " + JSON.stringify(oScope.search.items) +
                ". Their purchase order headers are included in PURCHASE_ORDERS. Use ITEM_SEARCH to answer questions about these terms; " +
                "0 matches means no such item exists in SAP." : "") +
            (oScope.items ? "\n\nITEM_AGGREGATES over the line items of the included purchase orders (exact; per material, material group, plant, PO and requisitioner: item count, quantity by unit, net by currency) = " +
                JSON.stringify(PurchaseOrdersController._aggregateItems(oScope.items)) +
                "\n\nPURCHASE_ORDER_ITEMS (line items of the " + PurchaseOrdersController._aggregateItems(oScope.items).purchaseOrders + " most recent included purchase orders) = " + JSON.stringify(oScope.items) : "") +
            "\n\nAGGREGATES contains, for the included rows, count and net-by-currency per supplier, status, company, type (byType), purchasing organisation (byPurchOrg), purchasing group (byPurchGroup), creator (byCreatedBy), currency and month. " +
            "NEVER enumerate or scan the rows one by one in your answer; if a question needs a ranking or figure that is not in TOP_PURCHASE_ORDERS_BY_NET_AMOUNT, AGGREGATES or SCOPE, say briefly that it is not available and suggest a filter. Keep answers short." +
            "\n\nPURCHASE_ORDERS = " + JSON.stringify(aRows);
    };

    /**
     * Markdown → HTML for the assistant bubble (rendered by sap.ui.core.HTML). All input is HTML-escaped first,
     * then headings, paragraphs, bullet / numbered lists, tables, fenced + inline code, bold, italics, links and rules
     * are rebuilt from safe markup only.
     */
    PurchaseOrdersController._toHtml = function (sText) {
        if (!sText) { return ""; }
        var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
        var inline = function (t) {
            return t
                .replace(/`([^`]+)`/g, function (m, c) { return "<code>" + c + "</code>"; })
                .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>")
                .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>");
        };
        var aLines = esc(sText).replace(/\r\n?/g, "\n").split("\n");
        var aOut = [], sList = null, bPara = false, bCode = false, aTable = null;
        var closeList = function () { if (sList) { aOut.push("</" + sList + ">"); sList = null; } };
        var closePara = function () { if (bPara) { aOut.push("</p>"); bPara = false; } };
        var flushTable = function () {
            if (!aTable) { return; }
            var aRows = aTable.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r); });
            var cells = function (r) { return r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return inline(c.trim()); }); };
            var h = "<table><thead><tr>" + cells(aRows[0]).map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>";
            aRows.slice(1).forEach(function (r) {
                h += "<tr>" + cells(r).map(function (c) { return "<td" + (/^[\d,.\s%()-]+$/.test(c) && /\d/.test(c) ? " class=\"num\"" : "") + ">" + c + "</td>"; }).join("") + "</tr>";
            });
            aOut.push(h + "</tbody></table>");
            aTable = null;
        };
        aLines.forEach(function (l) {
            if (/^\s*```/.test(l)) {
                closePara(); closeList(); flushTable();
                aOut.push(bCode ? "</code></pre>" : "<pre><code>");
                bCode = !bCode; return;
            }
            if (bCode) { aOut.push(l + "\n"); return; }
            if (/^\s*\|.*\|\s*$/.test(l)) { closePara(); closeList(); (aTable = aTable || []).push(l); return; }
            flushTable();
            var m;
            if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(l))) {
                closePara(); closeList();
                var n = Math.min(m[1].length + 2, 6);
                aOut.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">"); return;
            }
            if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { closePara(); closeList(); aOut.push("<hr/>"); return; }
            if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) {
                closePara();
                if (sList !== "ul") { closeList(); aOut.push("<ul>"); sList = "ul"; }
                aOut.push("<li>" + inline(m[1]) + "</li>"); return;
            }
            if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) {
                closePara();
                if (sList !== "ol") { closeList(); aOut.push("<ol>"); sList = "ol"; }
                aOut.push("<li>" + inline(m[1]) + "</li>"); return;
            }
            if (!l.trim()) { closePara(); closeList(); return; }
            closeList();
            if (bPara) { aOut.push("<br/>" + inline(l)); } else { aOut.push("<p>" + inline(l)); bPara = true; }
        });
        closePara(); closeList(); flushTable();
        if (bCode) { aOut.push("</code></pre>"); }
        return aOut.join("");
    };

    /** Parses SSE text into JSON events; returns {events, rest} where rest is the unterminated tail. */
    PurchaseOrdersController._parseSSE = function (sBuffer) {
        var aEvents = [], aParts = sBuffer.split("\n\n"), sRest = aParts.pop();
        aParts.forEach(function (sBlock) {
            sBlock.split("\n").forEach(function (sLine) {
                if (sLine.indexOf("data:") === 0) {
                    try { aEvents.push(JSON.parse(sLine.slice(5).trim())); } catch (e) { /* ignore malformed */ }
                }
            });
        });
        return { events: aEvents, rest: sRest };
    };

    return PurchaseOrdersController;
});
