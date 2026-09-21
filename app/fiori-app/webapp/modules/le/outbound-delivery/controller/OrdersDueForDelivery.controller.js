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
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    FilterType,
    Fragment,
    MessageBox,
    AuthService,
    OutboundDeliveryService
) {
    "use strict";

    var DEFAULT_SHIPPING_POINTS = [
        { key: "1120", text: "1120 - 1130-FG Loading Area" },
        { key: "1112", text: "1112 - Shipping Point 1112" },
        { key: "1108", text: "1108 - Shipping Point 1108" },
        { key: "1109", text: "1109 - Shipping Point 1109" }
    ];

    return BaseController.extend("saps4hana.fiori.modules.le.outbound-delivery.controller.OrdersDueForDelivery", {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            var oViewModel = new JSONModel({
                totalCount: 0,
                shippingPointCount: 0
            });
            this.getView().setModel(oViewModel, "ordersDueView");

            var oDialogModel = new JSONModel({
                salesOrder: "",
                shippingPoint: "1120",
                deliveryDate: this._getTodayDateString(),
                shippingPoints: DEFAULT_SHIPPING_POINTS
            });
            this.getView().setModel(oDialogModel, "deliveryDialog");

            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("ordersDueForDelivery")) {
                oRouter.getRoute("ordersDueForDelivery").attachPatternMatched(this._onRouteMatched, this);
            }

            this._loadShippingPoints();
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            var oTable = this.byId("ordersDueTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Ignore refresh error if request is in flight
                }
            }
            this._loadShippingPoints();
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
                        var oFound = DEFAULT_SHIPPING_POINTS.find(function (p) { return p.key === sPt; });
                        return oFound || { key: sPt, text: sPt };
                    });
                    var oDialogModel = that.getView().getModel("deliveryDialog");
                    if (oDialogModel) {
                        oDialogModel.setProperty("/shippingPoints", aFormatted);
                    }
                })
                .catch(function () {
                    // Fall back to pre-set default shipping points
                });
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var iTotal = oEvent.getParameter("total") || 0;
            var aItems = oTable.getItems() || [];
            var oViewModel = this.getView().getModel("ordersDueView");

            var mShippingPoints = {};
            aItems.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext("outboundDelivery");
                if (oCtx) {
                    var sSp = oCtx.getProperty("ShippingPoint");
                    if (sSp) {
                        mShippingPoints[sSp] = true;
                    }
                }
            });

            var iDistinctSp = Object.keys(mShippingPoints).length;
            oViewModel.setProperty("/totalCount", iTotal || aItems.length);
            oViewModel.setProperty("/shippingPointCount", iDistinctSp);
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var oTable = this.byId("ordersDueTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (!oBinding) return;

            var aFilters = [];
            if (sQuery && sQuery.trim() !== "") {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("SalesOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("ShipToParty", FilterOperator.Contains, sTrimmed),
                        new Filter("ShippingPoint", FilterOperator.Contains, sTrimmed),
                        new Filter("DelivBlockReasonForSchedLine", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters, FilterType.Application);
        },

        onRefresh: function () {
            var oTable = this.byId("ordersDueTable");
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

        onCreateDeliveryPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("outboundDelivery");
            if (!oCtx) return;

            var sSalesOrder = oCtx.getProperty("SalesOrder");
            var sShippingPoint = oCtx.getProperty("ShippingPoint") || "1120";
            var sGoodsIssueDate = oCtx.getProperty("GoodsIssueDate") || this._getTodayDateString();

            var oDialogModel = this.getView().getModel("deliveryDialog");
            oDialogModel.setProperty("/salesOrder", sSalesOrder);
            oDialogModel.setProperty("/shippingPoint", sShippingPoint);
            oDialogModel.setProperty("/deliveryDate", sGoodsIssueDate);

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
                    var sSuccessTemplate = that._text("msgDeliveryCreatedSuccess", "Delivery {0} created");
                    var sSuccessMessage = sSuccessTemplate.replace("{0}", sDeliveryNo);
                    MessageBox.success(sSuccessMessage, {
                        onClose: function () {
                            that.onRefresh();
                        }
                    });
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
