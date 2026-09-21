sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/le/outbound-delivery/service/OutboundDeliveryService"
], function (BaseController, JSONModel, Filter, FilterOperator, FilterType, Fragment, MessageBox, AuthService, OutboundDeliveryService) {
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
                totalCount: 0,
                openCount: 0,
                customerCount: 0,
                canCreateDelivery: bCanCreateDelivery
            });
            this.getView().setModel(oViewModel, "salesOrdersView");

            var oDialogModel = new JSONModel({
                salesOrder: "",
                shippingPoint: "1120",
                deliveryDate: this._getTodayDateString(),
                shippingPoints: [
                    { key: "1120", text: "1120 - 1130-FG Loading Area" },
                    { key: "1112", text: "1112 - Shipping Point 1112" },
                    { key: "1108", text: "1108 - Shipping Point 1108" },
                    { key: "1109", text: "1109 - Shipping Point 1109" }
                ]
            });
            this.getView().setModel(oDialogModel, "deliveryDialog");
            this._loadShippingPoints();

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
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var iTotal = oEvent.getParameter("total") || 0;
            var aItems = oTable.getItems() || [];
            var oViewModel = this.getView().getModel("salesOrdersView");

            var mCustomers = {};
            var iOpen = 0;

            aItems.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext("salesOrder");
                if (oCtx) {
                    var sCust = oCtx.getProperty("SoldToParty");
                    if (sCust) {
                        mCustomers[sCust] = true;
                    }
                    var sStatus = oCtx.getProperty("OverallSDProcessStatus");
                    if (!sStatus || sStatus === "A" || sStatus === "Open" || sStatus === "B") {
                        iOpen++;
                    }
                }
            });

            var iDistinctCustomers = Object.keys(mCustomers).length;
            oViewModel.setProperty("/totalCount", iTotal || aItems.length);
            oViewModel.setProperty("/openCount", iOpen);
            oViewModel.setProperty("/customerCount", iDistinctCustomers);
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
        },

        _getTodayDateString: function () {
            var d = new Date();
            var sMonth = String(d.getMonth() + 1).padStart(2, "0");
            var sDay = String(d.getDate()).padStart(2, "0");
            return d.getFullYear() + "-" + sMonth + "-" + sDay;
        },

        _loadShippingPoints: function () {
            var that = this;
            if (!OutboundDeliveryService || typeof OutboundDeliveryService.getDefaultShippingPoint !== "function") {
                return;
            }
            OutboundDeliveryService.getDefaultShippingPoint()
                .then(function (result) {
                    var aPoints = (result && result.ShippingPoints) || ["1120", "1112", "1108", "1109"];
                    var aFormatted = aPoints.map(function (sPt) {
                        return { key: sPt, text: sPt };
                    });
                    var oDialogModel = that.getView().getModel("deliveryDialog");
                    if (oDialogModel) {
                        oDialogModel.setProperty("/shippingPoints", aFormatted);
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

            if (sApprovalStatus === "A") {
                MessageBox.warning(this._text("msgOrderInApproval", "Sales Order {0} is currently in approval and cannot be delivered.", [sSalesOrder]));
                return;
            }
            if (sDeliveryBlock) {
                MessageBox.warning(this._text("msgOrderDeliveryBlocked", "Sales Order {0} has a delivery block ({1}) and cannot be delivered.", [sSalesOrder, sDeliveryBlock]));
                return;
            }

            var oDialogModel = this.getView().getModel("deliveryDialog");
            oDialogModel.setProperty("/salesOrder", sSalesOrder);
            oDialogModel.setProperty("/shippingPoint", "1120");
            oDialogModel.setProperty("/deliveryDate", this._getTodayDateString());

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
