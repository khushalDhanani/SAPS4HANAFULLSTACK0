function createCreatePurchaseOrderValueHelp(deps) {
    deps = deps || {};
    var PurchaseOrderModel = deps.PurchaseOrderModel;
    var PurchaseOrderService = deps.PurchaseOrderService;
    var ValueHelpService = deps.ValueHelpService;

    return {
        onValueHelpRequest: function (oEvent) {
            var oSource = oEvent.getSource();
            var that = this;
            var aInitialFilters = this._buildContextFilters(oSource);

            ValueHelpService.openValueHelp(this.getView(), oSource, function (sKey, oSelectedItem, oData) {
                that._handleValueHelpSelected(oSource, sKey, oSelectedItem, oData);
            }, aInitialFilters);
        },

        _handleValueHelpSelected: function (oSource, sKey, oSelectedItem, oData) {
            if (!oSource || !sKey) return;
            var sField = this._resolveSourceField(oSource);
            var oRowContext = typeof oSource.getBindingContext === "function" ? oSource.getBindingContext("newPO") : null;
            var oModel = this.getView().getModel("newPO");

            if (oRowContext) {
                var sRowPath = oRowContext.getPath();
                switch (sField) {
                    case "Material":
                        var sPlant = oModel.getProperty(sRowPath + "/Plant") || "";
                        var oMatData = oData || {
                            Material: sKey,
                            MaterialName: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || ""
                        };
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sRowPath, oMatData, true);
                        var that = this;
                        if (!oData || !oData.MaterialBaseUnit || !oData.MaterialGroup) {
                            var oPoModel = this.getModel();
                            PurchaseOrderService.getMaterialDetails(oPoModel, sKey, sPlant).then(function (oMat) {
                                if (oMat) {
                                    PurchaseOrderModel.applyMaterialDefaults(oModel, sRowPath, oMat, true);
                                    that.onItemFieldChange();
                                }
                            });
                        }
                        this.onItemFieldChange();
                        break;
                    case "UnitOfMeasure":
                    case "Plant":
                    case "StorageLocation":
                    case "TaxCode":
                    case "PurchaseOrderItemCategory":
                    case "AccountAssignmentCategory":
                        oModel.setProperty(sRowPath + "/" + sField, sKey);
                        oModel.setProperty(sRowPath + "/errors/" + sField, { state: "None", text: "" });
                        this.onItemFieldChange();
                        break;
                }
                return;
            }

            switch (sField) {
                case "PurchaseOrderType":
                    var oDefaultDoc = this._getDefaultDocType();
                    var sDocText = (oSelectedItem && typeof oSelectedItem.getDescription === "function" && oSelectedItem.getDescription()) ||
                                   (oSelectedItem && typeof oSelectedItem.getTitle === "function" && oSelectedItem.getTitle()) ||
                                   (oData && (oData.PurchasingDocumentType_Text || oData.PurchasingDocumentType)) ||
                                   (sKey === oDefaultDoc.code ? oDefaultDoc.text : sKey);
                    PurchaseOrderModel.setDocumentType(oModel, sKey, this._oConfigData, sDocText);
                    this._onDocTypeSelectedCheck(sKey);
                    break;
                case "Supplier":
                    oModel.setProperty("/header/Supplier", sKey);
                    PurchaseOrderModel.markUserModified(oModel, "Supplier", true);
                    if (oData && oData.CompanyCode && !oModel.getProperty("/header/CompanyCode")) {
                        oModel.setProperty("/header/CompanyCode", oData.CompanyCode);
                    }
                    if (oData && oData.SupplierAccountGroup) {
                        oModel.setProperty("/header/SupplierAccountGroup", oData.SupplierAccountGroup);
                    }
                    this.onSupplierChange(sKey);
                    break;
                case "CompanyCode":
                    oModel.setProperty("/header/" + sField, sKey);
                    PurchaseOrderModel.markUserModified(oModel, sField, true);
                    this._onFieldChange(sField);
                    this._refreshSupplierBinding();
                    break;
                case "PurchasingOrganization":
                case "PurchasingGroup":
                case "Currency":
                case "PaymentTerms":
                case "IncotermsClassification":
                case "IncotermsLocation1":
                    oModel.setProperty("/header/" + sField, sKey);
                    PurchaseOrderModel.markUserModified(oModel, sField, true);
                    this._onFieldChange(sField);
                    break;
            }
        },

        onSuggest: function (oEvent) {
            var oSource = oEvent.getSource();
            var sValue = oEvent.getParameter("suggestValue");
            var aContextFilters = this._buildContextFilters(oSource);
            var sField = this._resolveSourceField(oSource);
            var oDefaultDoc = this._getDefaultDocType();

            if (sField === "PurchaseOrderType" && sValue === oDefaultDoc.code) {
                sValue = "";
            }

            ValueHelpService.applySuggestionFilter(oSource, sValue, aContextFilters);
        }
    };
}

var oExports = {
    createCreatePurchaseOrderValueHelp: createCreatePurchaseOrderValueHelp
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
