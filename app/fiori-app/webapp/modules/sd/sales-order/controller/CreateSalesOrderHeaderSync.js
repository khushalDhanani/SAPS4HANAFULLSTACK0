function createCreateSalesOrderHeaderSync(deps) {
    deps = deps || {};
    var SalesOrderModel = deps.SalesOrderModel;

    return {
        onOrderTypeChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "SalesOrderType");
            SalesOrderModel.updateStatus(oModel);
        },

        onOrderTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SalesOrderType", sKey);
            this.onOrderTypeChange();
        },

        onSalesOrgChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "SalesOrganization");
            if (typeof this._updateOrganizationalFilters === "function") {
                this._updateOrganizationalFilters();
            }
            SalesOrderModel.updateStatus(oModel);
            var sCust = oModel.getProperty("/header/SoldToParty");
            if (sCust && sCust.trim() !== "" && typeof this.onSoldToPartyChange === "function") {
                this.onSoldToPartyChange();
            }
        },

        onSalesOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SalesOrganization", sKey);
            this.onSalesOrgChange();
        },

        onDistChannelChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "DistributionChannel");
            if (typeof this._updateOrganizationalFilters === "function") {
                this._updateOrganizationalFilters();
            }
            SalesOrderModel.updateStatus(oModel);
            var sCust = oModel.getProperty("/header/SoldToParty");
            if (sCust && sCust.trim() !== "" && typeof this.onSoldToPartyChange === "function") {
                this.onSoldToPartyChange();
            }
        },

        onDistChannelSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/DistributionChannel", sKey);
            this.onDistChannelChange();
        },

        onDivisionChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "OrganizationDivision");
            SalesOrderModel.updateStatus(oModel);
            var sCust = oModel.getProperty("/header/SoldToParty");
            if (sCust && sCust.trim() !== "" && typeof this.onSoldToPartyChange === "function") {
                this.onSoldToPartyChange();
            }
        },

        onDivisionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/OrganizationDivision", sKey);
            this.onDivisionChange();
        },

        onCurrencyChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "TransactionCurrency");
            SalesOrderModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/TransactionCurrency", sKey);
            this.onCurrencyChange();
        },

        onPaymentTermsSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/PaymentTerms", sKey);
            oModel.setProperty("/modifiedFields/PaymentTerms", true);
            oModel.setProperty("/isModified", true);
            SalesOrderModel.validateSingleField(oModel, "PaymentTerms");
            SalesOrderModel.updateStatus(oModel);
        },

        onIncotermsSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/Incoterms", sKey);
            oModel.setProperty("/header/INCO1", sKey);
            oModel.setProperty("/modifiedFields/Incoterms", true);
            oModel.setProperty("/modifiedFields/INCO1", true);
            oModel.setProperty("/isModified", true);
            SalesOrderModel.updateStatus(oModel);
        },

        onHeaderFieldChange: function (oEvent) {
            var oModel = this.getView().getModel("newOrder");
            if (oModel && oEvent && typeof oEvent.getSource === "function") {
                var oSource = oEvent.getSource();
                var oBinding = oSource && typeof oSource.getBinding === "function" && oSource.getBinding("value");
                if (oBinding && typeof oBinding.getPath === "function") {
                    var sPath = oBinding.getPath() || "";
                    var sField = sPath.split("/").pop();
                    if (sField) {
                        if (sField === "Incoterms") {
                            oModel.setProperty("/header/INCO1", oModel.getProperty("/header/Incoterms"));
                            oModel.setProperty("/modifiedFields/INCO1", true);
                        } else if (sField === "INCO1") {
                            oModel.setProperty("/header/Incoterms", oModel.getProperty("/header/INCO1"));
                            oModel.setProperty("/modifiedFields/Incoterms", true);
                        } else if (sField === "IncotermsLocation1") {
                            var sLocVal = oModel.getProperty("/header/IncotermsLocation1");
                            oModel.setProperty("/header/INCO2", sLocVal);
                            oModel.setProperty("/header/INCO2_L", sLocVal);
                            oModel.setProperty("/modifiedFields/INCO2", true);
                            oModel.setProperty("/modifiedFields/INCO2_L", true);
                        }
                        oModel.setProperty("/modifiedFields/" + sField, true);
                        oModel.setProperty("/isModified", true);
                        SalesOrderModel.validateSingleField(oModel, sField);
                    }
                }
            }
            SalesOrderModel.updateStatus(oModel);
        }
    };
}

var oExports = {
    createCreateSalesOrderHeaderSync: createCreateSalesOrderHeaderSync
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
