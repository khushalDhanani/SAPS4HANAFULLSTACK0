sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "saps4hana/fiori/model/PurchaseOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/service/PurchaseOrderApi"
], function (Controller, MessageBox, MessageToast, BusyIndicator, PurchaseOrderModel, ValueHelpService, PurchaseOrderApi) {
    "use strict";

    return Controller.extend("saps4hana.fiori.controller.CreatePurchaseOrder", {
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
            PurchaseOrderApi.createPurchaseOrder({
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
                    MessageBox.error(oError.message || "Error creating Purchase Order.");
                });
        }
    });
});
