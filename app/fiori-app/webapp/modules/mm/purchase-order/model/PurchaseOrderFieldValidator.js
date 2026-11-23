(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory(require("./PurchaseOrderRules"), require("./PurchaseOrderValidationLimits"));
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define(["./PurchaseOrderRules", "./PurchaseOrderValidationLimits"], factory);
    }
})(this, function (_rules, Limits) {
    "use strict";

    var CURRENCY_REGEX = Limits.CURRENCY_REGEX;
    var INCOTERMS_MAX_LEN = Limits.INCOTERMS_MAX_LEN;
    var INCOTERMS_LOC_MAX_LEN = Limits.INCOTERMS_LOC_MAX_LEN;
    var PAYMENT_TERMS_MAX_LEN = Limits.PAYMENT_TERMS_MAX_LEN;
    var TAX_CODE_MAX_LEN = Limits.TAX_CODE_MAX_LEN;

    /**
     * PurchaseOrderFieldValidator
     *
     * Immediate (non-model) payload validation and single-field validation for
     * the Purchase Order form. Called through the PurchaseOrderValidator facade.
     */
    return {
        /**
         * Validates the PO form data at the client-side UI level for immediate UX feedback.
         *
         * @param {Object} oData
         * @returns {string[]} Array of error messages, empty if valid
         */
        validateUI: function (oData) {
            var aErrors = [];
            if (!oData || !oData.header) {
                return ["Invalid Purchase Order data."];
            }

            var sDocType = oData.header.PurchaseOrderType;
            var sCleanDocType = sDocType ? String(sDocType).trim().toUpperCase() : "";
            var oPoRule = (_rules && _rules.PO_TYPES && _rules.PO_TYPES[sCleanDocType]) || null;

            // 1. Header Validation
            if (!oData.header.PurchaseOrderType) aErrors.push("Document Type is required.");
            if (!oData.header.CompanyCode) aErrors.push("Company Code is required.");
            if (!oData.header.PurchasingOrganization) aErrors.push("Purchasing Organization is required.");
            if (!oData.header.PurchasingGroup) aErrors.push("Purchasing Group is required.");
            if (!oData.header.Supplier) aErrors.push("Supplier is required.");
            if (!oData.header.Currency) aErrors.push("Currency is required.");
            if (!oData.header.DocumentDate) aErrors.push("Document Date is required.");

            if (oPoRule) {
                if (oPoRule.allowedCompanyCodes && oData.header.CompanyCode && !oPoRule.allowedCompanyCodes.includes(oData.header.CompanyCode)) {
                    aErrors.push("Company Code " + oData.header.CompanyCode + " is not permitted for Document Type " + sCleanDocType + " (Allowed: " + oPoRule.allowedCompanyCodes.join(", ") + ").");
                }
                if (oPoRule.allowedPurchOrgs && oData.header.PurchasingOrganization && !oPoRule.allowedPurchOrgs.includes(oData.header.PurchasingOrganization)) {
                    aErrors.push("Purchasing Organization " + oData.header.PurchasingOrganization + " is not permitted for Document Type " + sCleanDocType + " (Allowed: " + oPoRule.allowedPurchOrgs.join(", ") + ").");
                }
                if (oPoRule.allowedCurrencies && oData.header.Currency && !oPoRule.allowedCurrencies.includes(oData.header.Currency)) {
                    aErrors.push("Currency " + oData.header.Currency + " is not permitted for Document Type " + sCleanDocType + " (Allowed: " + oPoRule.allowedCurrencies.join(", ") + ").");
                }
            }

            if (oData.header.IncotermsClassification && !oData.header.IncotermsLocation1) {
                aErrors.push("Incoterms Location is required when Incoterms is specified.");
            }

            // 2. Items Validation
            if (!oData.items || oData.items.length === 0) {
                aErrors.push("Please add at least one line item.");
            } else {
                var bMaterialRequired = oPoRule ? oPoRule.materialRequired !== false : true;
                oData.items.forEach(function (item, idx) {
                    var sItemNo = item.PurchaseOrderItem || "Item #" + (idx + 1);
                    if (bMaterialRequired && !item.Material) {
                        aErrors.push(sItemNo + ": Material is required.");
                    } else if (!bMaterialRequired && !item.Material && (!item.PurchaseOrderItemText || !String(item.PurchaseOrderItemText).trim())) {
                        aErrors.push(sItemNo + ": Short Text (Description) is required when Material is omitted.");
                    }

                    var bStorageLocationRequired = oPoRule ? oPoRule.storageLocationRequired !== false : true;
                    if (!item.Plant) aErrors.push(sItemNo + ": Plant is required.");
                    if (bStorageLocationRequired && !item.StorageLocation) aErrors.push(sItemNo + ": Storage Location is required.");
                    if (!item.UnitOfMeasure) aErrors.push(sItemNo + ": Unit of Measure is required.");

                    var fQty = parseFloat(item.OrderQuantity);
                    if (!item.OrderQuantity || isNaN(fQty) || fQty <= 0) {
                        aErrors.push(sItemNo + ": Order Quantity must be greater than 0.");
                    }

                    if (oPoRule) {
                        if (oPoRule.allowedPlantPrefix && item.Plant && !String(item.Plant).startsWith(oPoRule.allowedPlantPrefix)) {
                            aErrors.push(sItemNo + ": Plant " + item.Plant + " must start with '" + oPoRule.allowedPlantPrefix + "' for Document Type " + sCleanDocType + ".");
                        }
                        if (oPoRule.allowedItemCategories && item.PurchaseOrderItemCategory && !oPoRule.allowedItemCategories.includes(item.PurchaseOrderItemCategory)) {
                            aErrors.push(sItemNo + ": Item Category " + item.PurchaseOrderItemCategory + " is not allowed for Document Type " + sCleanDocType + " (Allowed: " + oPoRule.allowedItemCategories.join(", ") + ").");
                        }
                        if (oPoRule.allowedAcctAssignmentCategories && item.AccountAssignmentCategory && !oPoRule.allowedAcctAssignmentCategories.includes(item.AccountAssignmentCategory)) {
                            aErrors.push(sItemNo + ": Account Assignment Category " + item.AccountAssignmentCategory + " is not allowed for Document Type " + sCleanDocType + " (Allowed: " + oPoRule.allowedAcctAssignmentCategories.join(", ") + ").");
                        }
                    }
                });
            }

            return aErrors;
        },
        /**
         * Validates a single field contextually and updates that field's state.
         *
         * @param {Object} oValidator - PurchaseOrderValidator facade (text resolver, doc type and form validation)
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {any} [sValue]
         * @param {number} [iItemIndex]
         * @param {Function} [fnTextResolver]
         * @param {Function} [fnValidateForm]
         * @returns {{ state: string, text: string }}
         */
        validateSingleField: function (oValidator, oModel, sField, sValue, iItemIndex, fnTextResolver, fnValidateForm) {
            if (!oModel) return { state: "None", text: "" };
            var fnResolve = fnTextResolver || oValidator.getText.bind(oValidator);
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oState = { state: "None", text: "" };

            var sDocType = (oData && oData.header && oData.header.PurchaseOrderType) || "";
            var sCleanDocType = String(sDocType || "").trim().toUpperCase();
            var oPoRule = (_rules && _rules.PO_TYPES && _rules.PO_TYPES[sCleanDocType]) || null;

            if (iItemIndex === undefined || iItemIndex === null) {
                // Header field validation
                var oHeader = oData.header || {};
                var val = sValue !== undefined ? sValue : (oHeader[sField] || "");
                var sValTrim = String(val || "").trim();

                switch (sField) {
                    case "PurchaseOrderType":
                        var oDocResult = oValidator.validateDocType(sValTrim, fnResolve);
                        oState = { state: oDocResult.state, text: oDocResult.text };
                        break;
                    case "CompanyCode":
                        if (!sValTrim) {
                            oState = { state: "Error", text: fnResolve("poValCompanyCodeRequired", null, "Company Code is required (4-character code, e.g. 1010).") };
                        } else if (oPoRule && oPoRule.allowedCompanyCodes && !oPoRule.allowedCompanyCodes.includes(sValTrim)) {
                            oState = { state: "Error", text: "Company Code " + sValTrim + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedCompanyCodes.join(", ") + ")." };
                        }
                        break;
                    case "PurchasingOrganization":
                        if (!sValTrim) {
                            oState = { state: "Error", text: fnResolve("poValPurchOrgRequired", null, "Purchasing Organization is required (e.g. 1010).") };
                        } else if (oPoRule && oPoRule.allowedPurchOrgs && !oPoRule.allowedPurchOrgs.includes(sValTrim)) {
                            oState = { state: "Error", text: "Purchasing Organization " + sValTrim + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedPurchOrgs.join(", ") + ")." };
                        }
                        break;
                    case "PurchasingGroup":
                        if (!sValTrim) {
                            oState = { state: "Error", text: fnResolve("poValPurchGrpRequired", null, "Purchasing Group is required (3-character code, e.g. 101).") };
                        } else if (!sValTrim.startsWith("1")) {
                            oState = { state: "Warning", text: fnResolve("poValPurchGrp100Series", null, "Purchasing Group should be in the 100 Series (e.g. 101 Procurement Team-E).") };
                        }
                        break;
                    case "Supplier":
                        if (!sValTrim) oState = { state: "Error", text: fnResolve("poValSupplierRequired", null, "Supplier account is required (e.g. 10300001).") };
                        break;
                    case "Currency":
                        if (!sValTrim) {
                            oState = { state: "Error", text: fnResolve("poValCurrencyRequired", null, "Currency is required (e.g. EUR, USD).") };
                        } else if (!CURRENCY_REGEX.test(sValTrim)) {
                            oState = { state: "Error", text: fnResolve("poValCurrencyIso", null, "Currency must be a 3-letter ISO code (e.g. EUR).") };
                        } else if (oPoRule && oPoRule.allowedCurrencies && !oPoRule.allowedCurrencies.includes(sValTrim)) {
                            oState = { state: "Error", text: "Currency " + sValTrim + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedCurrencies.join(", ") + ")." };
                        }
                        break;
                    case "DocumentDate":
                        if (!sValTrim) oState = { state: "Error", text: fnResolve("poValDocDateRequired", null, "Document Date is required.") };
                        break;
                    case "IncotermsClassification":
                        if (sValTrim.length > INCOTERMS_MAX_LEN) oState = { state: "Error", text: fnResolve("poValIncotermsMaxLen", null, "Incoterms classification must not exceed " + INCOTERMS_MAX_LEN + " characters (e.g. EXW).") };
                        break;
                    case "IncotermsLocation1":
                        if (oHeader.IncotermsClassification && !sValTrim) {
                            oState = { state: "Error", text: fnResolve("poValIncotermsLocRequired", null, "Incoterms Location 1 is required when Incoterms is specified.") };
                        } else if (sValTrim.length > INCOTERMS_LOC_MAX_LEN) {
                            oState = { state: "Error", text: fnResolve("poValIncotermsLocMaxLen", null, "Incoterms Location 1 must not exceed " + INCOTERMS_LOC_MAX_LEN + " characters.") };
                        }
                        break;
                    case "PaymentTerms":
                        if (sValTrim.length > PAYMENT_TERMS_MAX_LEN) oState = { state: "Error", text: fnResolve("poValPaymentTermsMaxLen", null, "Payment Terms must not exceed " + PAYMENT_TERMS_MAX_LEN + " characters (e.g. 0001).") };
                        break;
                    default:
                        break;
                }

                if (typeof oModel.setProperty === "function") {
                    oModel.setProperty("/errors/" + sField, oState);
                } else if (oData.errors) {
                    oData.errors[sField] = oState;
                }
            } else {
                // Item field validation
                var aItems = oData.items || [];
                var oItem = aItems[iItemIndex];
                if (oItem) {
                    var iVal = sValue !== undefined ? sValue : (oItem[sField] || "");
                    var sItemValTrim = String(iVal || "").trim();
                    var sItemNo = oItem.PurchaseOrderItem || "Item #" + (iItemIndex + 1);
                    var bMaterialRequired = oPoRule ? oPoRule.materialRequired !== false : true;

                    switch (sField) {
                        case "Material":
                            if (bMaterialRequired && !sItemValTrim) {
                                oState = { state: "Error", text: fnResolve("poValItemMaterialRequired", [sItemNo], sItemNo + ": Material is required (e.g. TG11).") };
                            }
                            break;
                        case "PurchaseOrderItemText":
                            if (!bMaterialRequired && !oItem.Material && !sItemValTrim) {
                                oState = { state: "Error", text: sItemNo + ": Short Text (Description) is required when Material is omitted." };
                            }
                            break;
                        case "Plant":
                            if (!sItemValTrim) {
                                oState = { state: "Error", text: fnResolve("poValItemPlantRequired", [sItemNo], sItemNo + ": Plant is required (e.g. 1010).") };
                            } else if (oPoRule && oPoRule.allowedPlantPrefix && !sItemValTrim.startsWith(oPoRule.allowedPlantPrefix)) {
                                oState = { state: "Error", text: sItemNo + ": Plant " + sItemValTrim + " must start with '" + oPoRule.allowedPlantPrefix + "' for " + sCleanDocType + "." };
                            }
                            break;
                        case "StorageLocation":
                            var bStorageLocReq = oPoRule ? oPoRule.storageLocationRequired !== false : true;
                            if (bStorageLocReq && !sItemValTrim) {
                                oState = { state: "Error", text: fnResolve("poValItemStorageLocRequired", [sItemNo], sItemNo + ": Storage Location is required (e.g. 101A).") };
                            }
                            break;
                        case "UnitOfMeasure":
                            if (!sItemValTrim) oState = { state: "Error", text: fnResolve("poValItemUnitRequired", [sItemNo], sItemNo + ": Unit of Measure is required (e.g. PC).") };
                            break;
                        case "OrderQuantity":
                            var fQty = parseFloat(sItemValTrim);
                            if (!sItemValTrim || isNaN(fQty) || fQty <= 0) {
                                oState = { state: "Error", text: fnResolve("poValItemQtyPositive", [sItemNo], sItemNo + ": Order Quantity must be greater than 0.") };
                            }
                            break;
                        case "NetPriceAmount":
                            if (sItemValTrim) {
                                var fPrice = parseFloat(sItemValTrim);
                                if (isNaN(fPrice) || fPrice < 0) {
                                    oState = { state: "Error", text: fnResolve("poValItemNetPricePositive", [sItemNo], sItemNo + ": Net Price must be a non-negative number.") };
                                }
                            }
                            break;
                        case "TaxCode":
                            if (sItemValTrim.length > TAX_CODE_MAX_LEN) {
                                oState = { state: "Error", text: fnResolve("poValItemTaxCodeMaxLen", [sItemNo], sItemNo + ": Tax Code must not exceed " + TAX_CODE_MAX_LEN + " characters.") };
                            }
                            break;
                        case "PurchaseOrderItemCategory":
                            if (oPoRule && oPoRule.allowedItemCategories && sItemValTrim && !oPoRule.allowedItemCategories.includes(sItemValTrim)) {
                                oState = { state: "Error", text: sItemNo + ": Item Category " + sItemValTrim + " is not allowed for " + sCleanDocType + " (Allowed: " + oPoRule.allowedItemCategories.join(", ") + ")." };
                            }
                            break;
                        case "AccountAssignmentCategory":
                            if (oPoRule && oPoRule.allowedAcctAssignmentCategories && sItemValTrim && !oPoRule.allowedAcctAssignmentCategories.includes(sItemValTrim)) {
                                oState = { state: "Error", text: sItemNo + ": Account Assignment Category " + sItemValTrim + " is not allowed for " + sCleanDocType + " (Allowed: " + oPoRule.allowedAcctAssignmentCategories.join(", ") + ")." };
                            }
                            break;
                        default:
                            break;
                    }

                    if (typeof oModel.setProperty === "function") {
                        oModel.setProperty("/items/" + iItemIndex + "/errors/" + sField, oState);
                    } else if (oItem.errors) {
                        oItem.errors[sField] = oState;
                    }
                }
            }

            // Sync aggregate error state if form has been validated
            if (oData.hasError) {
                if (typeof fnValidateForm === "function") {
                    fnValidateForm(oModel);
                } else {
                    oValidator.validateForm(oModel, fnResolve);
                }
            }

            return oState;
        }
    };
});
