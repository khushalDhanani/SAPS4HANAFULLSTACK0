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
    "sap/ui/core/InvisibleMessage",
    "saps4hana/fiori/model/formatter",
    "./PurchaseOrderAiPrompt",
    "./PurchaseOrderAiIntent",
    "./PurchaseOrderAiStream",
    "./PurchaseOrderAiDataFetcher",
    "./PurchaseOrderAiWidget",
    "./PurchaseOrderAiChat",
    "./PurchaseOrderTableFilter"
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
    InvisibleMessage,
    formatter,
    _AiPrompt,
    _AiIntent,
    _AiStream,
    _AiDataFetcher,
    _AiWidget,
    _AiChat,
    _TableFilter
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    var AiPrompt = _AiPrompt || (isNode ? require("./PurchaseOrderAiPrompt") : {});
    var AiIntent = _AiIntent || (isNode ? require("./PurchaseOrderAiIntent") : {});
    var AiStream = _AiStream || (isNode ? require("./PurchaseOrderAiStream") : {});
    var AiDataFetcher = _AiDataFetcher || (isNode ? require("./PurchaseOrderAiDataFetcher") : {});
    var AiWidget = _AiWidget || (isNode ? require("./PurchaseOrderAiWidget") : {});
    var AiChat = _AiChat || (isNode ? require("./PurchaseOrderAiChat") : {});
    var TableFilter = _TableFilter || (isNode ? require("./PurchaseOrderTableFilter") : {});

    if (AiPrompt && typeof AiPrompt.setFilterClasses === "function") {
        AiPrompt.setFilterClasses(Filter, FilterOperator);
    }

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
            if (oTable) {
                oTable.attachUpdateFinished(this._updateKpiMetrics, this);
            } else {
                console.error("[PurchaseOrders] Control 'purchaseOrdersTable' was not found in the view; the KPI tiles will not update.");
            }

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
            if (!this._bRouteMatchedBefore) {
                this._bRouteMatchedBefore = true;
                return;
            }
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
                                that.getText("poAuthErrorMsg", null, "Failed to load Purchase Orders from SAP S/4HANA.\n\nThe SAP S/4HANA Gateway rejected the configured credentials with HTTP 401 Unauthorized.\n\nAction Required:\n1. Ask your administrator to verify the SAP connection credentials: the BTP destination in a deployed system, or .env.local in local development.\n2. Check transaction SU01 in SAP to ensure user account is not locked due to failed logon attempts."),
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
                    if (oMetrics && oMetrics.totalCount != null) {
                        oViewModel.setProperty("/totalCount", oMetrics.totalCount);
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/supplierCount", "-");
                });
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

    // Wire static methods and constants
    Object.assign(PurchaseOrdersController, AiPrompt, AiIntent, AiStream);

    // Wire prototype methods
    var mTableFilter = TableFilter && typeof TableFilter.createTableFilter === "function" ? TableFilter.createTableFilter({
        Filter: Filter,
        FilterOperator: FilterOperator,
        ValueHelpService: ValueHelpService,
        ControllerClass: PurchaseOrdersController
    }) : {};

    var mAiDataFetcher = AiDataFetcher && typeof AiDataFetcher.createAiDataFetcher === "function" ? AiDataFetcher.createAiDataFetcher({
        Filter: Filter,
        FilterOperator: FilterOperator,
        Sorter: Sorter,
        ODataClient: ODataClient,
        formatter: formatter,
        ControllerClass: PurchaseOrdersController
    }) : {};

    var mAiWidget = AiWidget && typeof AiWidget.createAiWidget === "function" ? AiWidget.createAiWidget({
        Fragment: Fragment,
        JSONModel: JSONModel,
        ControllerClass: PurchaseOrdersController
    }) : {};

    var mAiChat = AiChat && typeof AiChat.createAiChat === "function" ? AiChat.createAiChat({
        ODataClient: ODataClient,
        InvisibleMessage: InvisibleMessage,
        ControllerClass: PurchaseOrdersController
    }) : {};

    Object.assign(PurchaseOrdersController.prototype, mTableFilter, mAiDataFetcher, mAiWidget, mAiChat);

    return PurchaseOrdersController;
});
