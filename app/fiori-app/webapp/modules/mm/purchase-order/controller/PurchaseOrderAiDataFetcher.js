function createAiDataFetcher(deps) {
    deps = deps || {};
    var Filter = deps.Filter;
    var FilterOperator = deps.FilterOperator;
    var Sorter = deps.Sorter;
    var ODataClient = deps.ODataClient;
    var formatter = deps.formatter;
    var ControllerClass = deps.ControllerClass;

    return {
        /**
         * Rows for the AI context: up to AI_CONTEXT_ROWS purchase orders matching the current filter bar,
         * read from the server (not just the page loaded in the table). Falls back to the loaded rows.
         */
        _fetchAIContextRows: function () {
            var that = this;
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!oModel || typeof oModel.bindList !== "function") {
                var aFallback = this._getLoadedPurchaseOrders();
                aFallback.isFallback = true;
                aFallback.queryFailed = true;
                return Promise.resolve(aFallback);
            }
            var oBinding = oModel.bindList("/PurchaseOrders", undefined,
                [new Sorter(this._sCurrentSortProperty || "CreationDate", this._bCurrentSortDescending !== false)],
                this._buildFilterCriteria(), { $count: true });
            return oBinding.requestContexts(0, ControllerClass.AI_CONTEXT_ROWS).then(function (aCtx) {
                var aRows = aCtx.map(function (oCtx) { return ControllerClass._toAIRow(oCtx.getObject()); });
                aRows.isFallback = false;
                aRows.queryFailed = false;
                oBinding.destroy();
                return aRows;
            }).catch(function (oErr) {
                oBinding.destroy();
                var aFallback = that._getLoadedPurchaseOrders();
                aFallback.isFallback = true;
                aFallback.queryFailed = true;
                aFallback.error = (oErr && oErr.message) || String(oErr);
                return aFallback;
            });
        },

        /** Top N purchase orders by net amount across the whole (filtered) list, sorted by the server. */
        _fetchTopPOsByNet: function (iN) {
            var oTable = this.byId("purchaseOrdersTable");
            var oModel = oTable && typeof oTable.getModel === "function" ? oTable.getModel() : null;
            if (!oModel || typeof oModel.bindList !== "function") { return Promise.resolve(null); }
            var oBinding = oModel.bindList("/PurchaseOrders", undefined, [new Sorter("PurchaseOrderNetAmount", true)], this._buildFilterCriteria());
            return oBinding.requestContexts(0, iN || 15).then(function (aCtx) {
                var a = aCtx.map(function (oCtx) { return ControllerClass._toAIRow(oCtx.getObject()); });
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
            var aPos = (aPoNumbers || []).filter(Boolean).slice(0, ControllerClass.AI_ITEM_POS);
            if (!oModel || typeof oModel.bindList !== "function" || !aPos.length) { return Promise.resolve([]); }
            var aBatches = [];
            for (var i = 0; i < aPos.length; i += 40) { aBatches.push(aPos.slice(i, i + 40)); }
            return Promise.all(aBatches.map(function (aBatch) {
                var oFilter = new Filter({ filters: aBatch.map(function (sPo) { return new Filter("PurchaseOrder", FilterOperator.EQ, sPo); }), and: false });
                var oBinding = oModel.bindList("/PurchaseOrderItems", undefined, [new Sorter("PurchaseOrder", true), new Sorter("PurchaseOrderItem", false)], [oFilter]);
                return oBinding.requestContexts(0, ControllerClass.AI_ITEM_ROWS)
                    .then(function (aCtx) { var a = aCtx.map(function (c) { return ControllerClass._toAIItem(c.getObject()); }); oBinding.destroy(); return a; })
                    .catch(function () { oBinding.destroy(); return []; });
            })).then(function (aAll) {
                return [].concat.apply([], aAll).slice(0, ControllerClass.AI_ITEM_ROWS);
            });
        },

        /**
         * Server-side text search over ALL purchase order items (item text / material) for the search terms in the question,
         * plus the header rows of the matching POs. Resolves {{terms, count, items, headers}} or null.
         */
        _searchItems: function (sQuestion) {
            var aTerms = ControllerClass._extractSearchTerms(sQuestion);
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
                return oBinding.requestContexts(0, ControllerClass.AI_SEARCH_ROWS).then(function (aCtx) {
                    var r = { items: aCtx.map(function (c) { return ControllerClass._toAIItem(c.getObject()); }), count: oBinding.getCount() };
                    oBinding.destroy();
                    return r;
                }).catch(function () { oBinding.destroy(); return { items: [], count: 0 }; });
            };
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
                    .then(function (aCtx) { var a = aCtx.map(function (c) { return ControllerClass._toAIRow(c.getObject()); }); oBinding.destroy(); return a; })
                    .catch(function () { oBinding.destroy(); return []; });
            })).then(function (aAll) { return [].concat.apply([], aAll); });
        },

        /** Compact rows currently loaded in the table (fallback context). */
        _getLoadedPurchaseOrders: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable && oTable.getBinding("items");
            var aCtx = oBinding ? oBinding.getCurrentContexts() : [];
            return aCtx.filter(Boolean).map(function (oCtx) {
                return ControllerClass._toAIRow(oCtx.getObject());
            });
        },

        /**
         * PO numbers typed in the question are loaded from SAP with their items (even if not in the table),
         * so the assistant can answer about a specific document. Resolves {rows, notFound}.
         */
        _fetchMentionedPurchaseOrders: function (sQuestion, aRows) {
            var aNumbers = ControllerClass._extractPONumbers(sQuestion);
            var aNotFound = [];
            var aOut = aRows.slice();
            aOut.isFallback = aRows.isFallback || false;
            aOut.queryFailed = aRows.queryFailed || false;
            return Promise.all(aNumbers.map(function (sPo) {
                return ODataClient.get("/odata/v4/purchase-order/PurchaseOrders('" + encodeURIComponent(sPo) + "')" +
                    "?$expand=to_PurchaseOrderItem($select=PurchaseOrderItem,Material,PurchaseOrderItemText,Plant,OrderQuantity," +
                    "PurchaseOrderQuantityUnit,NetPriceAmount,NetAmount,FirstDeliveryDate,PurchaseOrderItemStatus)")
                    .then(function (oPo) {
                        var oRow = ControllerClass._toAIRow(oPo);
                        oRow.retrievalStatus = "VERIFIED_LIVE_SAP";
                        oRow.dataScope = "Single Document Expand (/PurchaseOrders('" + sPo + "')?$expand=to_PurchaseOrderItem)";
                        oRow.items = (oPo.to_PurchaseOrderItem || []).map(function (it) {
                            return { item: it.PurchaseOrderItem, material: it.Material, text: it.PurchaseOrderItemText, plant: it.Plant,
                                qty: it.OrderQuantity, unit: it.PurchaseOrderQuantityUnit, price: it.NetPriceAmount, net: it.NetAmount,
                                delivery: it.FirstDeliveryDate ? String(it.FirstDeliveryDate).slice(0, 10) : null, status: it.PurchaseOrderItemStatus };
                        });
                        aOut = aOut.filter(function (r) { return r.po !== sPo; });
                        aOut.push(oRow);
                    })
                    .catch(function () { aNotFound.push(sPo); });
            })).then(function () {
                return {
                    rows: aOut,
                    notFound: aNotFound,
                    isFallback: aOut.isFallback,
                    queryFailed: aOut.queryFailed
                };
            });
        },

        /** Real totals for the current filter (server $count / KPI), so the model does not count the loaded page. */
        _getAIScope: function (iShown, bFallback, bQueryFailed) {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable && oTable.getBinding("items");
            var iTotal = null;
            if (oBinding && typeof oBinding.getCount === "function") { iTotal = oBinding.getCount(); }
            if (iTotal == null && oBinding && typeof oBinding.getLength === "function" && oBinding.isLengthFinal && oBinding.isLengthFinal()) { iTotal = oBinding.getLength(); }
            var oVM = this.getView().getModel("viewModel");
            var vKpi = oVM ? oVM.getProperty("/totalCount") : null;
            if (iTotal == null && vKpi != null && vKpi !== "-" && !isNaN(Number(vKpi))) { iTotal = Number(vKpi); }
            var vSuppliers = oVM ? oVM.getProperty("/supplierCount") : null;
            var sCompleteness = ControllerClass._classifyCompleteness(iShown, iTotal, bFallback, bQueryFailed);
            return {
                shown: iShown,
                total: iTotal,
                supplierTotal: (vSuppliers != null && vSuppliers !== "-" && !isNaN(Number(vSuppliers))) ? Number(vSuppliers) : null,
                filtered: !!(oBinding && typeof oBinding.getFilters === "function" && (oBinding.getFilters("Application") || []).length),
                isFallback: !!bFallback,
                queryFailed: !!bQueryFailed,
                completeness: sCompleteness
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
            return Promise.all([count(aBase)].concat(ControllerClass.AI_STATUS_CODES.map(function (sCode) {
                return count(aBase.concat([new Filter("PurchasingDocumentStatus", FilterOperator.EQ, sCode)]));
            }))).then(function (aCounts) {
                var o = { total: aCounts[0], byStatus: {} }, iSum = 0;
                ControllerClass.AI_STATUS_CODES.forEach(function (sCode, i) {
                    var n = aCounts[i + 1];
                    if (n != null) { o.byStatus[sCode + " " + formatter.statusCodeName(sCode)] = n; iSum += n; }
                });
                if (o.total != null) { o.byStatus.Other = Math.max(0, o.total - iSum); }
                return o;
            }).catch(function () { return null; });
        }
    };
}

var oExports = {
    createAiDataFetcher: createAiDataFetcher
};

var isNode = typeof module !== "undefined" && module.exports;
if (isNode) {
    module.exports = oExports;
}
if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
    sap.ui.define([], function () {
        return oExports;
    });
}
