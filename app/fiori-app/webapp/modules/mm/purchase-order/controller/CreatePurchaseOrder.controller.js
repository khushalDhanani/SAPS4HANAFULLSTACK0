sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "saps4hana/fiori/modules/mm/purchase-order/model/PurchaseOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/mm/purchase-order/service/PurchaseOrderService"
], function (Controller, MessageBox, MessageToast, BusyIndicator, PurchaseOrderModel, ValueHelpService, PurchaseOrderService) {
    "use strict";

    return Controller.extend("saps4hana.fiori.modules.mm.purchase-order.controller.CreatePurchaseOrder", {
        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createPurchaseOrder").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = PurchaseOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newPO");
        },

        onValueHelpRequest: function (oEvent) {
            ValueHelpService.openValueHelp(this.getView(), oEvent.getSource());
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            ValueHelpService.applySuggestionFilter(oEvent.getSource(), sValue);
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("purchaseOrders");
        },

        onCancelPress: function () {
            this.onNavBack();
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newPO");
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            PurchaseOrderModel.addItem(oModel, sUser);
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sPath = oItem.getBindingContext("newPO").getPath();
            var iIndex = parseInt(sPath.split("/")[2], 10);
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.deleteItem(oModel, iIndex);
        },

        onCalculateNetAmount: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("newPO");
            if (!oContext) return;

            var sPath = oContext.getPath();
            var oModel = this.getView().getModel("newPO");

            // Defer update to allow UI5 event and measurement cycle to finish
            setTimeout(function () {
                PurchaseOrderModel.calculateItemNetAmount(oModel, sPath);
            }, 0);
        },

        _getErrorMessageConfig: function (oError) {
            var iStatus = oError.status || 500;
            var sMessage = oError.message || "An unexpected error occurred.";

            switch (iStatus) {
                case 400:
                    return {
                        title: "Invalid Input",
                        message: sMessage
                    };
                case 401:
                    return {
                        title: "Authentication Failed",
                        message: "Your session is unauthenticated or has expired. Please log in again."
                    };
                case 403:
                    return {
                        title: "Authorization Denied",
                        message: sMessage || "You do not have permission to create Purchase Orders for this Purchasing Group or Organization."
                    };
                case 404:
                    return {
                        title: "Resource Not Found",
                        message: sMessage || "One or more referenced master data records were not found in SAP."
                    };
                case 409:
                    return {
                        title: "Document Locked / Conflict",
                        message: sMessage || "The purchasing record or vendor is currently locked by another user. Please retry shortly."
                    };
                case 422:
                    return {
                        title: "Business Validation Error",
                        message: sMessage
                    };
                case 502:
                case 503:
                    return {
                        title: "S/4HANA Backend Unavailable",
                        message: "The SAP S/4HANA backend system is currently unreachable. Please check connectivity or try again later."
                    };
                case 500:
                default:
                    return {
                        title: "Application Error",
                        message: sMessage
                    };
            }
        },

        onCreatePress: function () {
            var oModel = this.getView().getModel("newPO");
            var oData = oModel.getData();
            var that = this;

            // Immediate UX Validation
            var aUIErrors = PurchaseOrderModel.validateUI(oData);
            if (aUIErrors.length > 0) {
                MessageBox.error(aUIErrors.join("\n"));
                return;
            }

            BusyIndicator.show(0);
            PurchaseOrderService.createPurchaseOrder({
                header: oData.header,
                items: oData.items
            })
                .then(function (sNewPO) {
                    BusyIndicator.hide();
                    MessageToast.show("Purchase Order Created: " + sNewPO);
                    that.onNavBack();
                })
                .catch(function (oError) {
                    BusyIndicator.hide();
                    var oErrConfig = that._getErrorMessageConfig(oError);
                    MessageBox.error(oErrConfig.message, {
                        title: oErrConfig.title
                    });
                });
        }
    });
});
