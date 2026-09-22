sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/service/ODataClient",
    "saps4hana/fiori/modules/le/outbound-delivery/service/OutboundDeliveryService"
], function (BaseController, JSONModel, Filter, FilterOperator, FilterType, Fragment, MessageBox, AuthService, ODataClient, OutboundDeliveryService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-order.controller.SalesOrders", {
        formatter: {
            statusText: function (sStatus) {
                if (!sStatus || sStatus === "A" || sStatus === "Open") {
                    return "Open";
                }
                if (sStatus === "B") {
                    return "In Process";
                }
                if (sStatus === "C" || sStatus === "Completed") {
                    return "Completed";
                }
                return sStatus;
            },

            statusState: function (sStatus) {
                if (!sStatus || sStatus === "A" || sStatus === "Open") {
                    return "Information";
                }
                if (sStatus === "B") {
                    return "Warning";
                }
                if (sStatus === "C" || sStatus === "Completed") {
                    return "Success";
                }
                return "None";
            }
        },

        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            var bCanCreateDelivery = (AuthService && typeof AuthService.canCreateDelivery === "function") ? AuthService.canCreateDelivery() : true;
            var oViewModel = new JSONModel({
                totalCount: "-",
                openCount: "-",
                customerCount: "-",
                canCreateDelivery: bCanCreateDelivery
            });
            this.getView().setModel(oViewModel, "salesOrdersView");

            var oDialogModel = new JSONModel({
                salesOrder: "",
                shippingPoint: "",
                deliveryDate: this._getTodayDateString(),
                shippingPoints: []
            });
            this.getView().setModel(oDialogModel, "deliveryDialog");
            this._loadShippingPoints();
            this._loadServerMetrics();

            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("salesOrders")) {
                oRouter.getRoute("salesOrders").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            if (AuthService && typeof AuthService.canCreateDelivery === "function") {
                var oVm = this.getView().getModel("salesOrdersView");
                if (oVm) {
                    oVm.setProperty("/canCreateDelivery", AuthService.canCreateDelivery());
                }
            }
            var oTable = this.byId("salesOrdersTable");
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

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("salesOrdersView");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
            }
        },

        _loadServerMetrics: function () {
            var oViewModel = this.getView().getModel("salesOrdersView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var pOrderMetrics = ODataClient.get("/odata/v4/sales-order/getSalesOrderMetrics()")
                .then(function (res) {
                    var data = res && res.value ? res.value : res;
                    if (data && data.openOrdersCount != null) {
                        oViewModel.setProperty("/openCount", data.openOrdersCount);
                    } else {
                        oViewModel.setProperty("/openCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/openCount", "-");
                });

            var pCustomerMetrics = ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
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
                    if (oMetrics && oMetrics.customerCount != null) {
                        oViewModel.setProperty("/customerCount", oMetrics.customerCount);
                    } else {
                        oViewModel.setProperty("/customerCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/customerCount", "-");
                });

            return Promise.all([pOrderMetrics, pCustomerMetrics]);
        },

        onNavigateToCreateSalesOrder: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesOrder");
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var oTable = this.byId("salesOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (!oBinding) return;

            var aFilters = [];
            if (sQuery && sQuery.trim() !== "") {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("SalesOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("SoldToParty", FilterOperator.Contains, sTrimmed),
                        new Filter("SoldToPartyName", FilterOperator.Contains, sTrimmed),
                        new Filter("PurchaseOrderByCustomer", FilterOperator.Contains, sTrimmed),
                        new Filter("SalesOrderType", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters, FilterType.Application);
        },

        onRefresh: function () {
            var oTable = this.byId("salesOrdersTable");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    try {
                        oBinding.refresh();
                    } catch (e) {
                        // Ignore refresh if already pending
                    }
                }
            }
            this._loadServerMetrics();
        },

        _getTodayDateString: function () {
            var d = new Date();
            var sMonth = String(d.getMonth() + 1).padStart(2, "0");
            var sDay = String(d.getDate()).padStart(2, "0");
            return d.getFullYear() + "-" + sMonth + "-" + sDay;
        },

        _loadShippingPoints: function () {
            var that = this;
            if (!OutboundDeliveryService || typeof OutboundDeliveryService.getShippingPoints !== "function") {
                return;
            }
            OutboundDeliveryService.getShippingPoints()
                .then(function (aPoints) {
                    if (Array.isArray(aPoints)) {
                        var aFormatted = aPoints.map(function (oSp) {
                            var sKey = oSp.ShippingPoint || "";
                            var sName = oSp.ShippingPointName || oSp.ShippingPoint_Text || "";
                            return {
                                key: sKey,
                                text: sName ? (sKey + " - " + sName) : sKey,
                                name: sName
                            };
                        });
                        var oDialogModel = that.getView().getModel("deliveryDialog");
                        if (oDialogModel) {
                            oDialogModel.setProperty("/shippingPoints", aFormatted);
                        }
                    }
                })
                .catch(function () {});
        },

        onCreateDeliveryPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("salesOrder");
            if (!oCtx) return;

            var sSalesOrder = oCtx.getProperty("SalesOrder");
            var sApprovalStatus = oCtx.getProperty("SalesDocApprovalStatus");
            var sDeliveryBlock = oCtx.getProperty("DeliveryBlockReason");

            if (sApprovalStatus === "unknown") {
                MessageBox.warning(this._text("msgOrderApprovalUnknown", "Approval status for Sales Order {0} could not be verified from S/4HANA. Delivery creation is blocked until status is confirmed.", [sSalesOrder]));
                return;
            }
            if (sApprovalStatus === "A") {
                MessageBox.warning(this._text("msgOrderInApproval", "Sales Order {0} is currently in approval and cannot be delivered.", [sSalesOrder]));
                return;
            }
            if (sApprovalStatus === "C") {
                MessageBox.warning(this._text("msgOrderRejected", "Sales Order {0} has been rejected and cannot be delivered.", [sSalesOrder]));
                return;
            }
            if (sApprovalStatus === "D") {
                MessageBox.warning(this._text("msgOrderRework", "Sales Order {0} is being reworked and cannot be delivered.", [sSalesOrder]));
                return;
            }
            if (sDeliveryBlock) {
                MessageBox.warning(this._text("msgOrderDeliveryBlocked", "Sales Order {0} has a delivery block ({1}) and cannot be delivered.", [sSalesOrder, sDeliveryBlock]));
                return;
            }

            var oDialogModel = this.getView().getModel("deliveryDialog");
            var sShippingPoint = oCtx.getProperty("ShippingPoint") || "";
            if (oDialogModel) {
                oDialogModel.setProperty("/salesOrder", sSalesOrder);
                oDialogModel.setProperty("/shippingPoint", sShippingPoint);
                oDialogModel.setProperty("/deliveryDate", this._getTodayDateString());
            }

            this._openCreateDeliveryDialog();
        },

        _openCreateDeliveryDialog: function () {
            var oView = this.getView();
            var that = this;

            if (!this._pCreateDeliveryDialog) {
                this._pCreateDeliveryDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.le.outbound-delivery.view.CreateDeliveryDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    if (oDialog.addStyleClass && that.getContentDensityClass) {
                        oDialog.addStyleClass(that.getContentDensityClass());
                    }
                    return oDialog;
                });
            }

            this._pCreateDeliveryDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onCancelCreateDelivery: function () {
            if (this._pCreateDeliveryDialog) {
                this._pCreateDeliveryDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onConfirmCreateDelivery: function () {
            var that = this;
            var oDialogModel = this.getView().getModel("deliveryDialog");
            var sSalesOrder = oDialogModel.getProperty("/salesOrder");
            var sShippingPoint = oDialogModel.getProperty("/shippingPoint");
            var sDeliveryDate = oDialogModel.getProperty("/deliveryDate");

            if (!sSalesOrder) {
                MessageBox.error(this._text("msgSalesOrderRequired", "Sales Order is required."));
                return;
            }
            if (!sShippingPoint) {
                MessageBox.error(this._text("msgShippingPointRequired", "Shipping Point is required."));
                return;
            }

            this._setDialogBusy(true);

            OutboundDeliveryService.createOutboundDelivery({
                salesOrder: sSalesOrder,
                shippingPoint: sShippingPoint,
                deliveryDate: sDeliveryDate
            })
                .then(function (sDeliveryNo) {
                    that.onCancelCreateDelivery();
                    if (sDeliveryNo && String(sDeliveryNo).trim() !== "" && sDeliveryNo !== "Delivery created") {
                        var sSuccessTemplate = that._text("msgDeliveryCreatedSuccess", "Delivery {0} created");
                        var sSuccessMessage = sSuccessTemplate.replace("{0}", sDeliveryNo);
                        MessageBox.success(sSuccessMessage, {
                            onClose: function () {
                                that.onRefresh();
                            }
                        });
                    } else {
                        var sWarningTemplate = that._text(
                            "msgDeliveryCreatedNoNumberWarning",
                            "Delivery created in SAP S/4HANA for Sales Order {0}, but no delivery number was returned. Please check transaction VL03N."
                        );
                        var sWarningMessage = sWarningTemplate.replace("{0}", sSalesOrder);
                        MessageBox.warning(sWarningMessage, {
                            onClose: function () {
                                that.onRefresh();
                            }
                        });
                    }
                })
                .catch(function (err) {
                    // Show SAP's own message on failure
                    var sErrorMessage = (err && (err.message || err.statusText)) || "Failed to create outbound delivery.";
                    MessageBox.error(sErrorMessage);
                })
                .finally(function () {
                    that._setDialogBusy(false);
                });
        },

        _setDialogBusy: function (bBusy) {
            if (this._pCreateDeliveryDialog) {
                this._pCreateDeliveryDialog.then(function (oDialog) {
                    oDialog.setBusy(bBusy);
                });
            }
        },

        _text: function (sKey, sDefault) {
            try {
                var oComp = this.getOwnerComponent();
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey);
                }
            } catch (e) {}
            return sDefault;
        }
    });
});
