function createCreatePurchaseOrderHeaderSync(deps) {
    deps = deps || {};
    var PurchaseOrderModel = deps.PurchaseOrderModel;
    var PurchaseOrderService = deps.PurchaseOrderService;
    var PurchaseOrderRules = deps.PurchaseOrderRules;
    var MessageToast = deps.MessageToast;

    return {
        _getDefaultDocType: function () {
            return PurchaseOrderModel.getDefaultDocType(this._oConfigData);
        },

        onDocTypeLiveChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            PurchaseOrderModel.updateDocTypeLive(oModel, sVal);
        },

        onDocTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            var sCurrentVal = sVal !== null && sVal !== undefined ? sVal : (oModel.getProperty("/header/PurchaseOrderType") || "");
            PurchaseOrderModel.setDocumentType(oModel, sCurrentVal, this._oConfigData);
            this._onDocTypeSelectedCheck(sCurrentVal);
        },

        onDocTypeSelect: function (oEvent) {
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("selectedItem") : null;
            if (oItem) {
                var sKey = (typeof oItem.getKey === "function" && oItem.getKey()) || (typeof oItem.getText === "function" && oItem.getText()) || "";
                var sText = (typeof oItem.getAdditionalText === "function" && oItem.getAdditionalText()) || (typeof oItem.getText === "function" && oItem.getText()) || "";
                var oModel = this.getView().getModel("newPO");
                PurchaseOrderModel.setDocumentType(oModel, sKey, this._oConfigData, sText);
                this._onDocTypeSelectedCheck(sKey);
            }
        },

        onDocDateChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "DocumentDate", true);
            PurchaseOrderModel.validateSingleField(oModel, "DocumentDate");
            PurchaseOrderModel.updateStatus(oModel);
        },

        _onFieldChange: function (sField, oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                PurchaseOrderModel.markUserModified(oModel, sField, true);
            } else {
                PurchaseOrderModel.markUserModified(oModel, sField, true);
            }
            if ((sField === "CompanyCode" || sField === "PurchasingOrganization") && this._oConfigData) {
                PurchaseOrderModel.validateCompanyCodePurchasingOrg(oModel, this._oConfigData);
            }
            if (sField === "CompanyCode") {
                this._refreshSupplierBinding();
            }
            PurchaseOrderModel.validateSingleField(oModel, sField);
            PurchaseOrderModel.updateStatus(oModel);
        },

        _onFieldSelect: function (sField, oEvent) {
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("selectedItem") : null;
            if (oItem) {
                var sKey = (typeof oItem.getKey === "function" && oItem.getKey()) || (typeof oItem.getText === "function" && oItem.getText()) || "";
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/" + sField, sKey);
                PurchaseOrderModel.markUserModified(oModel, sField, true);
                this._onFieldChange(sField);
            }
        },

        onCompanyCodeChange: function (oEvent) { this._onFieldChange("CompanyCode", oEvent); },
        onCompanyCodeSelect: function (oEvent) { this._onFieldSelect("CompanyCode", oEvent); },

        onPurchOrgChange: function (oEvent) { this._onFieldChange("PurchasingOrganization", oEvent); },
        onPurchOrgSelect: function (oEvent) { this._onFieldSelect("PurchasingOrganization", oEvent); },

        onPurchGrpChange: function (oEvent) { this._onFieldChange("PurchasingGroup", oEvent); },
        onPurchGrpSelect: function (oEvent) { this._onFieldSelect("PurchasingGroup", oEvent); },

        onSupplierLiveChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "Supplier", true);
            PurchaseOrderModel.validateSingleField(oModel, "Supplier");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onSupplierChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sSupplier = "";
            if (typeof oEvent === "string") {
                sSupplier = oEvent;
            } else if (oEvent && typeof oEvent.getParameter === "function") {
                sSupplier = oEvent.getParameter("value");
            } else {
                sSupplier = oModel.getProperty("/header/Supplier");
            }

            PurchaseOrderModel.markUserModified(oModel, "Supplier", true);
            PurchaseOrderModel.validateSingleField(oModel, "Supplier", sSupplier);
            PurchaseOrderModel.updateStatus(oModel);

            this._deriveSupplierData(sSupplier);
        },

        onSupplierSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/Supplier", sKey);
                this.onSupplierChange(sKey);
            }
        },

        _deriveSupplierData: function (sSupplier) {
            if (!sSupplier || String(sSupplier).trim() === "") return;

            var that = this;
            var oModel = this.getView().getModel("newPO");
            var sCoCode = oModel.getProperty("/header/CompanyCode") || "";
            var sPurchOrg = oModel.getProperty("/header/PurchasingOrganization") || "";

            PurchaseOrderService.getSupplierDefaults(sSupplier, sCoCode, sPurchOrg)
                .then(function (oDefaults) {
                    if (!oDefaults) return;
                    if (oDefaults.source === "lookup failed") {
                        MessageToast.show(that.getText("poMsgSupplierHistoryFailed", null, "Supplier history could not be read from SAP. Enter currency, payment terms and Incoterms manually."));
                        return;
                    }
                    var oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, sSupplier, oDefaults);
                    if (oReport && oReport.applied && Object.keys(oReport.applied).length > 0) {
                        var aAppliedFields = Object.keys(oReport.applied).map(function (k) {
                            return k + ": " + oReport.applied[k];
                        });
                        var sSourceInfo = oReport.source ? (" (" + oReport.source + ")") : that.getText("poMsgSupplierDefaultsFromLastPO", null, " (from last PO)");
                        MessageToast.show(that.getText("poMsgSupplierDefaultsApplied", [sSourceInfo, aAppliedFields.join(", ")], "Supplier defaults applied" + sSourceInfo + ": " + aAppliedFields.join(", ")));
                    }
                })
                .catch(function (err) {
                    console.warn("[CreatePurchaseOrder] Could not derive supplier defaults:", err);
                });
        },

        onCurrencyChange: function (oEvent) { this._onFieldChange("Currency", oEvent); },
        onCurrencySelect: function (oEvent) { this._onFieldSelect("Currency", oEvent); },

        onPaymentTermsChange: function (oEvent) { this._onFieldChange("PaymentTerms", oEvent); },
        onPaymentTermsSelect: function (oEvent) { this._onFieldSelect("PaymentTerms", oEvent); },

        onIncotermsChange: function (oEvent) { this._onFieldChange("IncotermsClassification", oEvent); },
        onIncotermsSelect: function (oEvent) { this._onFieldSelect("IncotermsClassification", oEvent); },

        onIncotermsLocChange: function (oEvent) { this._onFieldChange("IncotermsLocation1", oEvent); },

        _onDocTypeSelectedCheck: function (sDocType) {
            this._refreshSupplierBinding();
            this._refreshCompanyCodeBinding();
            this._refreshPurchOrgBinding();
            this._refreshCurrencyBinding();
            var oModel = this.getView().getModel("newPO");
            if (!oModel) return;
            var sCleanDocType = String(sDocType || "").trim().toUpperCase();

            if (sCleanDocType === "ZDOM") {
                var sExistingSupplier = oModel.getProperty("/header/Supplier");
                var sExistingAccountGroup = oModel.getProperty("/header/SupplierAccountGroup");
                if (sExistingSupplier && sExistingAccountGroup && sExistingAccountGroup !== "ZDOM") {
                    PurchaseOrderModel.setFieldValidation(
                        oModel,
                        "Supplier",
                        "Warning",
                        this.getText("poValSupplierNotDomestic", null, "Selected supplier is not a domestic supplier. Please choose a domestic supplier for document type ZDOM.")
                    );
                }
                var sExistingCoCode = oModel.getProperty("/header/CompanyCode");
                if (sExistingCoCode && sExistingCoCode !== "1000" && sExistingCoCode !== "2000") {
                    PurchaseOrderModel.setFieldValidation(
                        oModel,
                        "CompanyCode",
                        "Warning",
                        this.getText("poValCompanyCodeNotDomestic", null, "Selected Company Code is not an enterprise domestic company for document type ZDOM (expected 1000 - Aether Industries Limited or 2000 - Aether Specialty Chem Ltd).")
                    );
                } else if (sExistingCoCode) {
                    var oCoError = oModel.getProperty("/errors/CompanyCode");
                    if (oCoError && oCoError.state === "Warning") {
                        PurchaseOrderModel.setFieldValidation(oModel, "CompanyCode", "None", "");
                    }
                }
            } else if (sCleanDocType === "ZSTO") {
                var sExistingSupplierSto = oModel.getProperty("/header/Supplier");
                var sExistingAccountGroupSto = oModel.getProperty("/header/SupplierAccountGroup");
                if (sExistingSupplierSto && sExistingAccountGroupSto && sExistingAccountGroupSto !== "ZINT") {
                    PurchaseOrderModel.setFieldValidation(
                        oModel,
                        "Supplier",
                        "Warning",
                        this.getText("poValSupplierNotInternalPlant", null, "Selected supplier is not an internal plant. Please choose an internal plant / site for document type ZSTO.")
                    );
                }
                var sExistingCoCodeSto = oModel.getProperty("/header/CompanyCode");
                if (sExistingCoCodeSto && sExistingCoCodeSto !== "1000" && sExistingCoCodeSto !== "2000") {
                    PurchaseOrderModel.setFieldValidation(
                        oModel,
                        "CompanyCode",
                        "Warning",
                        this.getText("poValCompanyCodeMismatch", ["ZSTO", "1000, 2000", sExistingCoCodeSto], "Selected Company Code " + sExistingCoCodeSto + " is not permitted for document type ZSTO (Allowed: 1000, 2000).")
                    );
                } else if (sExistingCoCodeSto) {
                    var oCoErrorSto = oModel.getProperty("/errors/CompanyCode");
                    if (oCoErrorSto && oCoErrorSto.state === "Warning") {
                        PurchaseOrderModel.setFieldValidation(oModel, "CompanyCode", "None", "");
                    }
                }
            } else {
                var oRules = PurchaseOrderRules || (PurchaseOrderModel && PurchaseOrderModel.rules);
                var oPoRule = (oRules && oRules.PO_TYPES && oRules.PO_TYPES[sCleanDocType]) || null;
                if (oPoRule) {
                    var sExistingSupplierGen = oModel.getProperty("/header/Supplier");
                    var sExistingAccountGroupGen = oModel.getProperty("/header/SupplierAccountGroup");
                    if (sExistingSupplierGen && oPoRule.supplierAccountGroup && sExistingAccountGroupGen && sExistingAccountGroupGen !== oPoRule.supplierAccountGroup) {
                        PurchaseOrderModel.setFieldValidation(
                            oModel,
                            "Supplier",
                            "Warning",
                            this.getText("poValSupplierAccountGroupMismatch", [oPoRule.supplierAccountGroup, sExistingAccountGroupGen, sCleanDocType], "Selected supplier account group (" + sExistingAccountGroupGen + ") does not match required group " + oPoRule.supplierAccountGroup + " for " + sCleanDocType + ".")
                        );
                    }

                    var sExistingCoCodeGen = oModel.getProperty("/header/CompanyCode");
                    if (sExistingCoCodeGen && oPoRule.allowedCompanyCodes && !oPoRule.allowedCompanyCodes.includes(sExistingCoCodeGen)) {
                        PurchaseOrderModel.setFieldValidation(
                            oModel,
                            "CompanyCode",
                            "Warning",
                            this.getText("poValCompanyCodeMismatch", [sCleanDocType, oPoRule.allowedCompanyCodes.join(", "), sExistingCoCodeGen], "Selected Company Code " + sExistingCoCodeGen + " is not permitted for document type " + sCleanDocType + " (Allowed: " + oPoRule.allowedCompanyCodes.join(", ") + ").")
                        );
                    } else if (sExistingCoCodeGen) {
                        var oCoErrorGen = oModel.getProperty("/errors/CompanyCode");
                        if (oCoErrorGen && oCoErrorGen.state === "Warning") {
                            PurchaseOrderModel.setFieldValidation(oModel, "CompanyCode", "None", "");
                        }
                    }

                    var sExistingPurchOrgGen = oModel.getProperty("/header/PurchasingOrganization");
                    if (sExistingPurchOrgGen && oPoRule.allowedPurchOrgs && !oPoRule.allowedPurchOrgs.includes(sExistingPurchOrgGen)) {
                        PurchaseOrderModel.setFieldValidation(
                            oModel,
                            "PurchasingOrganization",
                            "Warning",
                            this.getText("poValPurchOrgMismatch", [sCleanDocType, oPoRule.allowedPurchOrgs.join(", "), sExistingPurchOrgGen], "Selected Purchasing Org " + sExistingPurchOrgGen + " is not permitted for document type " + sCleanDocType + " (Allowed: " + oPoRule.allowedPurchOrgs.join(", ") + ").")
                        );
                    }

                    var sExistingCurrencyGen = oModel.getProperty("/header/Currency");
                    if (sExistingCurrencyGen && oPoRule.allowedCurrencies && !oPoRule.allowedCurrencies.includes(sExistingCurrencyGen)) {
                        PurchaseOrderModel.setFieldValidation(
                            oModel,
                            "Currency",
                            "Warning",
                            this.getText("poValCurrencyMismatch", [sCleanDocType, oPoRule.allowedCurrencies.join(", "), sExistingCurrencyGen], "Selected Currency " + sExistingCurrencyGen + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedCurrencies.join(", ") + ").")
                        );
                    }
                }
            }
        }
    };
}

var oExports = {
    createCreatePurchaseOrderHeaderSync: createCreatePurchaseOrderHeaderSync
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
