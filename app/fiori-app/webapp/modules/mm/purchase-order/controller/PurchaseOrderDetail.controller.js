sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    MessageBox,
    MessageToast
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.PurchaseOrderDetail", {
        /**
         * Lifecycle hook called when controller is initialized.
         */
        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                itemsTitle: "Items (0)",
                itemsTabTitle: "Line Items (0)",
                itemsCount: 0,
                purchaseOrder: ""
            });
            this.getView().setModel(oViewModel, "detailViewModel");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("purchaseOrderDetail").attachPatternMatched(this._onPatternMatched, this);
        },

        /**
         * Route pattern matched handler for 'purchaseOrderDetail'.
         * Binds the view to the specific Purchase Order entity.
         *
         * @param {sap.ui.base.Event} oEvent
         * @private
         */
        _onPatternMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments") || {};
            var sPoId = oArgs.PurchaseOrder;

            if (!sPoId) {
                this.onNavBack();
                return;
            }

            var oViewModel = this.getView().getModel("detailViewModel");
            oViewModel.setProperty("/busy", true);
            oViewModel.setProperty("/purchaseOrder", sPoId);
            this.getView().setBusy(true);

            // Reset ObjectPage section to General Information and expand header
            var oObjectPage = this.byId("poObjectPage");
            if (oObjectPage) {
                var oFirstSection = this.byId("secGeneralInfo");
                if (oFirstSection) {
                    oObjectPage.setSelectedSection(oFirstSection);
                }
                if (typeof oObjectPage.setHeaderExpanded === "function") {
                    oObjectPage.setHeaderExpanded(true);
                }
            }

            var sPath = "/PurchaseOrders('" + encodeURIComponent(sPoId) + "')";
            var that = this;

            this.getView().bindElement({
                path: sPath,
                parameters: {
                    $expand: "to_PurchaseOrderItem"
                },
                events: {
                    change: this._onBindingChange.bind(this),
                    dataRequested: function () {
                        oViewModel.setProperty("/busy", true);
                        that.getView().setBusy(true);
                    },
                    dataReceived: function (oDataEvent) {
                        oViewModel.setProperty("/busy", false);
                        that.getView().setBusy(false);
                        var oError = oDataEvent.getParameter("error");
                        if (oError) {
                            var sMsg = oError.message || "Failed to load Purchase Order " + sPoId;
                            MessageBox.error(sMsg);
                        }
                    }
                }
            });
        },

        /**
         * Handler for element binding change event.
         * Detects if the requested Purchase Order does not exist.
         *
         * @private
         */
        _onBindingChange: function () {
            var oElementBinding = this.getView().getElementBinding();
            if (oElementBinding && !oElementBinding.getBoundContext()) {
                // Entity could not be resolved
                var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
                var sMsg = oBundle ? oBundle.getText("poNotFound") : "Purchase Order not found.";
                MessageBox.warning(sMsg, {
                    onClose: function () {
                        this.onNavBack();
                    }.bind(this)
                });
            }
        },

        /**
         * Handler for items table updateFinished event.
         * Updates line items count title.
         *
         * @param {sap.ui.base.Event} oEvent
         */
        onItemsTableUpdateFinished: function (oEvent) {
            var oTable = this.byId("poItemsTable");
            var iTotal = (oEvent && oEvent.getParameter("total") !== undefined) ?
                oEvent.getParameter("total") :
                (oTable ? oTable.getItems().length : 0);

            var oViewModel = this.getView().getModel("detailViewModel");
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            var sTitle = oBundle ? oBundle.getText("itemsTableTitle", [iTotal]) : "Items (" + iTotal + ")";
            var sTabTitle = (oBundle ? oBundle.getText("secItems") : "Line Items") + " (" + iTotal + ")";

            oViewModel.setProperty("/itemsTitle", sTitle);
            oViewModel.setProperty("/itemsTabTitle", sTabTitle);
            oViewModel.setProperty("/itemsCount", iTotal);
        },

        /**
         * Live search / filter handler for Line Items table.
         *
         * @param {sap.ui.base.Event} oEvent
         */
        onSearchItems: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue") || oEvent.getParameter("query") || "";
            sQuery = sQuery.trim();

            var aFilters = [];
            if (sQuery.length > 0) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PurchaseOrderItem", FilterOperator.Contains, sQuery),
                        new Filter("Material", FilterOperator.Contains, sQuery),
                        new Filter("PurchaseOrderItemText", FilterOperator.Contains, sQuery),
                        new Filter("Plant", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }

            var oTable = this.byId("poItemsTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        /**
         * Navigates back to the Purchase Orders master list.
         */
        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("purchaseOrders", {}, true);
        },

        /**
         * Refreshes the detail view and line items.
         */
        onRefresh: function () {
            var oElementBinding = this.getView().getElementBinding();
            if (oElementBinding) {
                oElementBinding.refresh();
            }

            var oTable = this.byId("poItemsTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.refresh();
            }

            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            var sMsg = oBundle ? oBundle.getText("detailRefreshed") : "Purchase Order data refreshed.";
            MessageToast.show(sMsg);
        }
    });
});
