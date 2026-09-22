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
    "sap/ui/core/Fragment"
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
    Fragment
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
                        var sMessage = oError.message || "Failed to load Purchase Orders from SAP S/4HANA.";
                        if (oStatus) {
                            oStatus.setState("Error");
                            oStatus.setText(iStatus === 401 ? "S/4HANA Auth Error (401)" : "Connection Error (" + iStatus + ")");
                            oStatus.setIcon("sap-icon://alert");
                        }
                        if (iStatus === 401) {
                            MessageBox.error(
                                "Failed to load Purchase Orders from SAP S/4HANA.\n\n" +
                                "The SAP S/4HANA Gateway rejected the configured credentials with HTTP 401 Unauthorized.\n\n" +
                                "Action Required:\n" +
                                "1. Verify that the password in .env.local is current.\n" +
                                "2. Check transaction SU01 in SAP to ensure user account is not locked due to failed logon attempts.",
                                { title: "S/4HANA Authentication Error" }
                            );
                        } else {
                            MessageBox.error(sMessage, { title: "Error Loading Purchase Orders" });
                        }
                    } else if (oStatus) {
                        oStatus.setState("Success");
                        oStatus.setText("Live S/4HANA");
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
            var sId = typeof oSource.getId === "function" ? oSource.getId() : (oSource.id || "");

            if (sId.indexOf("fbSupplier") !== -1) {
                var oFbCompanyCode = typeof this.byId === "function" ? this.byId("fbCompanyCode") : null;
                var sCoCode = oFbCompanyCode && typeof oFbCompanyCode.getValue === "function" ? oFbCompanyCode.getValue().trim() : "";
                if (sCoCode) {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCoCode));
                }
            } else if (sId.indexOf("fbPurchasingOrg") !== -1) {
                var oFbCoCode = typeof this.byId === "function" ? this.byId("fbCompanyCode") : null;
                var sCoCode2 = oFbCoCode && typeof oFbCoCode.getValue === "function" ? oFbCoCode.getValue().trim() : "";
                if (sCoCode2) {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCoCode2));
                }
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
            if (oFbStatus) {
                var sStatusKey = oFbStatus.getSelectedKey();
                if (sStatusKey === "Approved" || sStatusKey === "true") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "04"),
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "05"),
                            new Filter("PurchasingCompletenessStatus", FilterOperator.EQ, true)
                        ],
                        and: false
                    }));
                } else if (sStatusKey === "Draft" || sStatusKey === "false") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "01"),
                            new Filter("PurchasingCompletenessStatus", FilterOperator.EQ, false)
                        ],
                        and: false
                    }));
                } else if (sStatusKey === "In Approval") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "02"),
                            new Filter("ReleaseIsNotCompleted", FilterOperator.EQ, true)
                        ],
                        and: false
                    }));
                } else if (sStatusKey === "Rejected") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "38"),
                            new Filter("PurchasingDocumentDeletionCode", FilterOperator.EQ, "L")
                        ],
                        and: false
                    }));
                }
            }

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
        onAskAI: function () {
            var oView = this.getView(), that = this;
            if (!oView.getModel("aiDialog")) {
                oView.setModel(new JSONModel({ question: "", messages: [], busy: false }), "aiDialog");
            }
            if (!this._pAskAIDialog) {
                this._pAskAIDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.mm.purchase-order.view.AskAIDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    if (oDialog.addStyleClass && that.getContentDensityClass) {
                        oDialog.addStyleClass(that.getContentDensityClass());
                    }
                    return oDialog;
                });
            }
            this._pAskAIDialog.then(function (oDialog) { oDialog.open(); });
        },

        onAIClose: function () {
            this._pAskAIDialog.then(function (oDialog) { oDialog.close(); });
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

        /** Compact rows currently loaded in the table (only what the user already sees). */
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

        _scrollAIChatToBottom: function () {
            var oScroll = this.byId("aiChatScroll");
            if (oScroll) { setTimeout(function () { oScroll.scrollTo(0, 1e6, 200); }, 50); }
        },

        onAIAsk: function () {
            var that = this;
            var oModel = this.getView().getModel("aiDialog");
            var sQuestion = (oModel.getProperty("/question") || "").trim();
            if (!sQuestion || oModel.getProperty("/busy")) { return; }
            var aMessages = (oModel.getProperty("/messages") || []).slice();
            aMessages.push({ role: "user", content: sQuestion, html: PurchaseOrdersController._toHtml(sQuestion) });
            oModel.setProperty("/messages", aMessages);
            oModel.setProperty("/question", "");
            oModel.setProperty("/busy", true);
            this._scrollAIChatToBottom();
            var aRows = this._getLoadedPurchaseOrders();
            return this._fetchMentionedPurchaseOrders(sQuestion, aRows).then(function (oCtx) {
                return ODataClient.post("/odata/v4/ai/chat", {
                    messages: aMessages.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; }),
                    system: PurchaseOrdersController._buildAISystemPrompt(oCtx.rows, oCtx.notFound, that._getAIScope(aRows.length))
                });
            }).then(function (oResult) {
                var sAnswer = (oResult && oResult.answer) || "";
                aMessages.push({ role: "assistant", content: sAnswer, html: PurchaseOrdersController._toHtml(sAnswer) +
                    "<p><em>" + that.getText("aiMeta", [aRows.length, (oResult && oResult.model) || "-"]) + "</em></p>" });
            }).catch(function (oErr) {
                var sMsg = (oErr && oErr.message) || String(oErr);
                aMessages.push({ role: "assistant", error: true, content: sMsg, html: PurchaseOrdersController._toHtml(sMsg) });
            }).finally(function () {
                oModel.setProperty("/messages", aMessages.slice());
                oModel.setProperty("/busy", false);
                that._scrollAIChatToBottom();
            });
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

    /** 10-digit SAP document numbers mentioned in free text (de-duplicated, max 5). */
    PurchaseOrdersController._extractPONumbers = function (sText) {
        var aFound = String(sText || "").match(/\b\d{10}\b/g) || [];
        return aFound.filter(function (n, i) { return aFound.indexOf(n) === i; }).slice(0, 5);
    };

    PurchaseOrdersController._buildAISystemPrompt = function (aRows, aNotFound, oScope) {
        oScope = oScope || {};
        var sScope = oScope.total != null
            ? "SCOPE: the list " + (oScope.filtered ? "with the user's current filters " : "") + "contains " + oScope.total + " purchase orders in total" +
              (oScope.supplierTotal != null ? " from " + oScope.supplierTotal + " suppliers" : "") +
              "; only the " + oScope.shown + " rows loaded on screen are included below. " +
              "For any count or total across all purchase orders use the SCOPE figures, never count the rows below; " +
              "when a question needs data beyond the loaded rows, say the answer is based on the " + oScope.shown + " loaded rows only. "
            : "SCOPE: only the " + (oScope.shown != null ? oScope.shown : aRows.length) + " rows loaded on screen are included below; the full list may be larger. ";
        return "You are an SAP MM procurement assistant for Aether Industries. " +
            sScope +
            "Answer only from the purchase order data below (JSON, one object per PO; POs the user asked about by number include their items). " +
            "If the data does not contain the answer, say so. Be concise; use short bullet lists where useful. " +
            "Amounts are in the row currency." +
            (aNotFound && aNotFound.length ? " These PO numbers were looked up in SAP and do NOT exist or are not accessible: " + aNotFound.join(", ") + "." : "") +
            "\n\nPURCHASE_ORDERS = " + JSON.stringify(aRows);
    };

    /** Minimal markdown → HTML for sap.m.FormattedText (escapes HTML first). */
    PurchaseOrdersController._toHtml = function (sText) {
        if (!sText) { return ""; }
        var s = String(sText).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        var aLines = s.split(/\r?\n/), aOut = [], bList = false;
        aLines.forEach(function (l) {
            var m = /^\s*[-*]\s+(.*)$/.exec(l);
            if (m) { if (!bList) { aOut.push("<ul>"); bList = true; } aOut.push("<li>" + m[1] + "</li>"); return; }
            if (bList) { aOut.push("</ul>"); bList = false; }
            if (l.trim()) { aOut.push("<p>" + l + "</p>"); }
        });
        if (bList) { aOut.push("</ul>"); }
        return aOut.join("");
    };

    return PurchaseOrdersController;
});
