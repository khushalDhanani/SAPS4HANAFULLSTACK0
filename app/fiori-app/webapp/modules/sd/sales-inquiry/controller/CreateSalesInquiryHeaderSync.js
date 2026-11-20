function createCreateSalesInquiryHeaderSync(deps) {
    deps = deps || {};
    var SalesInquiryModel = deps.SalesInquiryModel;
    var Filter = deps.Filter;
    var FilterOperator = deps.FilterOperator;

    return {
        onInquiryTypeChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);
            SalesInquiryModel.validateSingleField(oModel, "SalesInquiryType");
            SalesInquiryModel.updateStatus(oModel);
        },

        onInquiryTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesInquiryType", sKey);
                SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);
                this.onInquiryTypeChange();
            }
        },

        onSalesOrgChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "SalesOrganization", true);
            if (typeof this._updateOrganizationalFilters === "function") {
                this._updateOrganizationalFilters();
            }
            SalesInquiryModel.validateSingleField(oModel, "SalesOrganization");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSalesOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesOrganization", sKey);
                SalesInquiryModel.markUserModified(oModel, "SalesOrganization", true);
                this.onSalesOrgChange();
            }
        },

        onDistChannelChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "DistributionChannel", true);
            if (typeof this._updateOrganizationalFilters === "function") {
                this._updateOrganizationalFilters();
            }
            SalesInquiryModel.validateSingleField(oModel, "DistributionChannel");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDistChannelSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/DistributionChannel", sKey);
                SalesInquiryModel.markUserModified(oModel, "DistributionChannel", true);
                this.onDistChannelChange();
            }
        },

        onDivisionChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "OrganizationDivision", true);
            SalesInquiryModel.validateSingleField(oModel, "OrganizationDivision");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDivisionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/OrganizationDivision", sKey);
                SalesInquiryModel.markUserModified(oModel, "OrganizationDivision", true);
                this.onDivisionChange();
            }
        },

        _updateOrganizationalFilters: function () {
            var oModel = this.getView().getModel("newInquiry");
            if (!oModel) return;
            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");

            var oDistInput = typeof this.byId === "function" ? this.byId("inDistChannel") : null;
            if (oDistInput) {
                var oDistBinding = oDistInput.getBinding("suggestionItems");
                if (oDistBinding) {
                    var aDistFilters = (sOrg && Filter && FilterOperator) ? [new Filter("SalesOrganization", FilterOperator.EQ, sOrg)] : [];
                    oDistBinding.filter(aDistFilters);
                }
            }

            var oDivInput = typeof this.byId === "function" ? this.byId("inDivision") : null;
            if (oDivInput) {
                var oDivBinding = oDivInput.getBinding("suggestionItems");
                if (oDivBinding) {
                    var aDivFilters = [];
                    if (sOrg && Filter && FilterOperator) aDivFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    if (sChannel && Filter && FilterOperator) aDivFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                    oDivBinding.filter(aDivFilters);
                }
            }
        },

        onValidityDateChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            var dStart = oModel.getProperty("/header/BindingPeriodValidityStartDate");
            var dEnd = oModel.getProperty("/header/BindingPeriodValidityEndDate");

            if (dStart && dEnd && new Date(dEnd) < new Date(dStart)) {
                SalesInquiryModel.setFieldValidation(oModel, "BindingPeriodValidityEndDate", "Error", "End Date must be >= Start Date");
            } else {
                SalesInquiryModel.setFieldValidation(oModel, "BindingPeriodValidityEndDate", "None", "");
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencyChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);
            SalesInquiryModel.validateSingleField(oModel, "TransactionCurrency");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/TransactionCurrency", sKey);
                SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);
                this.onCurrencyChange();
            }
        },

        onHeaderFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        }
    };
}

var oExports = {
    createCreateSalesInquiryHeaderSync: createCreateSalesInquiryHeaderSync
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
