function createCreatePurchaseOrderContextFilter(deps) {
    deps = deps || {};
    var Filter = deps.Filter;
    var FilterOperator = deps.FilterOperator;
    var PurchaseOrderRules = deps.PurchaseOrderRules;
    var PurchaseOrderModel = deps.PurchaseOrderModel;

    return {
        _resolveSourceField: function (oSource) {
            if (!oSource) return "";
            if (typeof oSource.data === "function") {
                var sCustomDataField = oSource.data("field");
                if (sCustomDataField && typeof sCustomDataField === "string") {
                    return sCustomDataField.trim();
                }
            }
            if (typeof oSource.getBindingPath === "function") {
                var sPath = oSource.getBindingPath("value");
                if (sPath) {
                    var sClean = sPath.split("/").pop();
                    if (sClean) return sClean;
                }
            }
            var sId = (typeof oSource.getId === "function" ? oSource.getId() : "") || "";
            var sControlName = sId.indexOf("--") !== -1 ? sId.split("--").pop() : sId;
            var FIELD_ID_MAP = {
                "inDocType": "PurchaseOrderType",
                "inCompanyCode": "CompanyCode",
                "inPurchOrg": "PurchasingOrganization",
                "inPurchGrp": "PurchasingGroup",
                "inSupplier": "Supplier",
                "inCurrency": "Currency",
                "inPaymentTerms": "PaymentTerms",
                "inIncoterms": "IncotermsClassification",
                "inIncotermsLoc": "IncotermsLocation1",
                "inDocDate": "DocumentDate"
            };
            return FIELD_ID_MAP[sControlName] || sControlName;
        },

        _buildContextFilters: function (oSource) {
            var aFilters = [];
            var oModel = this.getView().getModel("newPO");
            if (!oModel || !oSource) return aFilters;

            var sField = this._resolveSourceField(oSource);
            var oRowContext = typeof oSource.getBindingContext === "function" ? oSource.getBindingContext("newPO") : null;
            var sDocType = oModel.getProperty("/header/PurchaseOrderType");
            var sCleanDocType = sDocType ? String(sDocType).trim().toUpperCase() : "";
            var oRules = PurchaseOrderRules || (PurchaseOrderModel && PurchaseOrderModel.rules);
            var oPoRule = (oRules && oRules.PO_TYPES && oRules.PO_TYPES[sCleanDocType]) || null;

            if (oRowContext) {
                if (sField === "Material" || sField === "StorageLocation") {
                    var sPlant = oRowContext.getProperty("Plant");
                    if (sPlant && String(sPlant).trim() !== "") {
                        aFilters.push(new Filter("Plant", FilterOperator.EQ, String(sPlant).trim()));
                    }
                } else if (sField === "Plant") {
                    var sPurchOrg = oModel.getProperty("/header/PurchasingOrganization");
                    if (sPurchOrg && String(sPurchOrg).trim() !== "") {
                        aFilters.push(new Filter("PurchasingOrganization", FilterOperator.EQ, String(sPurchOrg).trim()));
                    }
                    if (oPoRule && oPoRule.allowedPlantPrefix) {
                        aFilters.push(new Filter("Plant", FilterOperator.StartsWith, oPoRule.allowedPlantPrefix));
                    }
                } else if (sField === "PurchaseOrderItemCategory") {
                    if (oPoRule && oPoRule.allowedItemCategories && oPoRule.allowedItemCategories.length > 0) {
                        if (oPoRule.allowedItemCategories.length === 1) {
                            aFilters.push(new Filter("PurchasingDocumentItemCategory", FilterOperator.EQ, oPoRule.allowedItemCategories[0]));
                        } else {
                            var aCatFilters = oPoRule.allowedItemCategories.map(function (c) {
                                return new Filter("PurchasingDocumentItemCategory", FilterOperator.EQ, c);
                            });
                            aFilters.push(new Filter({ filters: aCatFilters, and: false }));
                        }
                    }
                } else if (sField === "AccountAssignmentCategory") {
                    if (oPoRule && oPoRule.allowedAcctAssignmentCategories && oPoRule.allowedAcctAssignmentCategories.length > 0) {
                        if (oPoRule.allowedAcctAssignmentCategories.length === 1) {
                            aFilters.push(new Filter("AccountAssignmentCategory", FilterOperator.EQ, oPoRule.allowedAcctAssignmentCategories[0]));
                        } else {
                            var aAcctFilters = oPoRule.allowedAcctAssignmentCategories.map(function (c) {
                                return new Filter("AccountAssignmentCategory", FilterOperator.EQ, c);
                            });
                            aFilters.push(new Filter({ filters: aAcctFilters, and: false }));
                        }
                    }
                }
            } else {
                if (sField === "PurchaseOrderType" || sField === "PurchaseOrderTypeText") {
                    aFilters.push(new Filter("PurchasingDocumentType", FilterOperator.StartsWith, "Z"));
                } else if (sField === "CompanyCode") {
                    var aAllowedCoCodes = (oPoRule && Array.isArray(oPoRule.allowedCompanyCodes) && oPoRule.allowedCompanyCodes.length > 0)
                        ? oPoRule.allowedCompanyCodes
                        : ["1000", "2000"];
                    if (aAllowedCoCodes.length === 1) {
                        aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, aAllowedCoCodes[0]));
                    } else {
                        var aCoFilters = aAllowedCoCodes.map(function (cc) {
                            return new Filter("CompanyCode", FilterOperator.EQ, cc);
                        });
                        aFilters.push(new Filter({ filters: aCoFilters, and: false }));
                    }
                } else if (sField === "Supplier") {
                    var sCompanyCode = oModel.getProperty("/header/CompanyCode");
                    if (sCompanyCode && String(sCompanyCode).trim() !== "") {
                        aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, String(sCompanyCode).trim()));
                    }
                    if (oPoRule && oPoRule.supplierAccountGroup) {
                        aFilters.push(new Filter("SupplierAccountGroup", FilterOperator.EQ, oPoRule.supplierAccountGroup));
                    }
                } else if (sField === "PurchasingOrganization") {
                    var sCoCode = oModel.getProperty("/header/CompanyCode");
                    if (sCoCode && String(sCoCode).trim() !== "") {
                        aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, String(sCoCode).trim()));
                    }
                    if (oPoRule && oPoRule.allowedPurchOrgs && oPoRule.allowedPurchOrgs.length > 0) {
                        if (oPoRule.allowedPurchOrgs.length === 1) {
                            aFilters.push(new Filter("PurchasingOrganization", FilterOperator.EQ, oPoRule.allowedPurchOrgs[0]));
                        } else {
                            var aPoFilters = oPoRule.allowedPurchOrgs.map(function (po) {
                                return new Filter("PurchasingOrganization", FilterOperator.EQ, po);
                            });
                            aFilters.push(new Filter({ filters: aPoFilters, and: false }));
                        }
                    }
                } else if (sField === "Currency") {
                    if (oPoRule && oPoRule.allowedCurrencies && oPoRule.allowedCurrencies.length > 0) {
                        if (oPoRule.allowedCurrencies.length === 1) {
                            aFilters.push(new Filter("Currency", FilterOperator.EQ, oPoRule.allowedCurrencies[0]));
                        } else {
                            var aCurrFilters = oPoRule.allowedCurrencies.map(function (cu) {
                                return new Filter("Currency", FilterOperator.EQ, cu);
                            });
                            aFilters.push(new Filter({ filters: aCurrFilters, and: false }));
                        }
                    }
                } else if (sField === "PurchasingGroup") {
                    aFilters.push(new Filter("PurchasingGroup", FilterOperator.StartsWith, "1"));
                }
            }
            return aFilters;
        },

        _refreshSupplierBinding: function () {
            var oSupplierInput = typeof this.byId === "function" ? this.byId("inSupplier") : null;
            if (oSupplierInput && typeof oSupplierInput.getBinding === "function") {
                var oBinding = oSupplierInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    oBinding.filter(this._buildContextFilters(oSupplierInput));
                }
            }
        },

        _serializeFilterArray: function (aFilters) {
            if (!Array.isArray(aFilters) || aFilters.length === 0) return "";
            return JSON.stringify(aFilters.map(function (f) {
                if (!f) return "";
                if (f.aFilters && Array.isArray(f.aFilters)) {
                    return (f.bAnd ? "AND:" : "OR:") + f.aFilters.map(function (sf) {
                        var sP = sf.sPath || (sf.getPath && sf.getPath()) || "";
                        var sV = sf.sValue !== undefined ? sf.sValue : (sf.oValue1 !== undefined ? sf.oValue1 : (sf.getValue1 && sf.getValue1()) || "");
                        return sP + "=" + sV;
                    }).join(",");
                }
                var sPath = f.sPath || (f.getPath && f.getPath()) || "";
                var sVal = f.sValue !== undefined ? f.sValue : (f.oValue1 !== undefined ? f.oValue1 : (f.getValue1 && f.getValue1()) || "");
                return sPath + "=" + sVal;
            }));
        },

        _refreshCompanyCodeBinding: function (bForce) {
            var oCompanyInput = typeof this.byId === "function" ? this.byId("inCompanyCode") : null;
            if (oCompanyInput && typeof oCompanyInput.getBinding === "function") {
                var oBinding = oCompanyInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    var aFilters = this._buildContextFilters(oCompanyInput);
                    var sNewSig = this._serializeFilterArray(aFilters);
                    var sCurrentSig = oBinding._sContextFilterSig || this._serializeFilterArray(oBinding.aApplicationFilters || oBinding.aFilters);
                    if (!bForce && sCurrentSig && sCurrentSig === sNewSig) return;
                    oBinding._sContextFilterSig = sNewSig;
                    oBinding.filter(aFilters);
                }
            }
        },

        _refreshPurchOrgBinding: function () {
            var oPurchOrgInput = typeof this.byId === "function" ? this.byId("inPurchOrg") : null;
            if (oPurchOrgInput && typeof oPurchOrgInput.getBinding === "function") {
                var oBinding = oPurchOrgInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    oBinding.filter(this._buildContextFilters(oPurchOrgInput));
                }
            }
        },

        _refreshPurchGrpBinding: function (bForce) {
            var oPurchGrpInput = typeof this.byId === "function" ? this.byId("inPurchGrp") : null;
            if (oPurchGrpInput && typeof oPurchGrpInput.getBinding === "function") {
                var oBinding = oPurchGrpInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    var aFilters = this._buildContextFilters(oPurchGrpInput);
                    var sNewSig = this._serializeFilterArray(aFilters);
                    var sCurrentSig = oBinding._sContextFilterSig || this._serializeFilterArray(oBinding.aApplicationFilters || oBinding.aFilters);
                    if (!bForce && sCurrentSig && sCurrentSig === sNewSig) return;
                    oBinding._sContextFilterSig = sNewSig;
                    oBinding.filter(aFilters);
                }
            }
        },

        _refreshCurrencyBinding: function () {
            var oCurrencyInput = typeof this.byId === "function" ? this.byId("inCurrency") : null;
            if (oCurrencyInput && typeof oCurrencyInput.getBinding === "function") {
                var oBinding = oCurrencyInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    oBinding.filter(this._buildContextFilters(oCurrencyInput));
                }
            }
        }
    };
}

var oExports = {
    createCreatePurchaseOrderContextFilter: createCreatePurchaseOrderContextFilter
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
