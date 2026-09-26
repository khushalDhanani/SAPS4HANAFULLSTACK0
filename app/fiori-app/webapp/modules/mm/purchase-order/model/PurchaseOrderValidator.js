(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        var PurchaseOrderRules = require("./PurchaseOrderRules");
        module.exports = factory(PurchaseOrderRules);
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([
            "./PurchaseOrderRules"
        ], factory);
    }
})(this, function (InjectedRules) {
    "use strict";

    var _rules = InjectedRules;
    if (!_rules && typeof require === "function") {
        try {
            _rules = require("./PurchaseOrderRules");
        } catch (e) {}
    }

    var CURRENCY_REGEX = (_rules && _rules.PATTERNS && _rules.PATTERNS.CURRENCY) || /^[A-Za-z]{3}$/;
    var DOC_TYPE_PREFIX_REGEX = (_rules && _rules.PATTERNS && _rules.PATTERNS.DOC_TYPE_PREFIX) || /^Z/;
    var HEADER_RULES = (_rules && _rules.HEADER) || {};
    var ITEM_RULES = (_rules && _rules.ITEM) || {};

    var DOC_TYPE_MAX_LEN = (HEADER_RULES.PurchaseOrderType && HEADER_RULES.PurchaseOrderType.maxLen) || 4;
    var INCOTERMS_MAX_LEN = (HEADER_RULES.IncotermsClassification && HEADER_RULES.IncotermsClassification.maxLen) || 3;
    var INCOTERMS_LOC_MAX_LEN = (HEADER_RULES.IncotermsLocation1 && HEADER_RULES.IncotermsLocation1.maxLen) || 70;
    var PAYMENT_TERMS_MAX_LEN = (HEADER_RULES.PaymentTerms && HEADER_RULES.PaymentTerms.maxLen) || 4;
    var TAX_CODE_MAX_LEN = (ITEM_RULES.TaxCode && ITEM_RULES.TaxCode.maxLen) || 2;

    var DEFAULT_HEADER_FIELD_CONFIG = {
        PurchaseOrderType: { controlId: "inDocType", label: "Document Type", section: "General Data", example: "ZDOM" },
        CompanyCode: { controlId: "inCompanyCode", label: "Company Code", section: "General Data", example: "1010" },
        PurchasingOrganization: { controlId: "inPurchOrg", label: "Purchasing Organization", section: "General Data", example: "1010" },
        PurchasingGroup: { controlId: "inPurchGrp", label: "Purchasing Group", section: "General Data", example: "101" },
        DocumentDate: { controlId: "inDocDate", label: "Document Date", section: "General Data", example: "DD-MM-YYYY" },
        Supplier: { controlId: "inSupplier", label: "Supplier", section: "Supplier & Commercial Terms", example: "10300001" },
        Currency: { controlId: "inCurrency", label: "Currency", section: "Supplier & Commercial Terms", example: "EUR" },
        IncotermsClassification: { controlId: "inIncoterms", label: "Incoterms", section: "Supplier & Commercial Terms", example: "EXW" },
        IncotermsLocation1: { controlId: "inIncotermsLoc", label: "Incoterms Location 1", section: "Supplier & Commercial Terms", example: "MUMBAI" },
        PaymentTerms: { controlId: "inPaymentTerms", label: "Payment Terms", section: "Supplier & Commercial Terms", example: "0001" }
    };

    var DEFAULT_ITEM_FIELD_CONFIG = {
        Plant: { cellIndex: 1, label: "Plant", example: "1010" },
        StorageLocation: { cellIndex: 2, label: "Storage Location", example: "101A" },
        Material: { cellIndex: 3, label: "Material", example: "TG11" },
        PurchaseOrderItemText: { cellIndex: 4, label: "Description", example: "Polypropylene Resin" },
        OrderQuantity: { cellIndex: 5, label: "Quantity", example: "10" },
        UnitOfMeasure: { cellIndex: 6, label: "Unit of Measure", example: "PC" },
        NetPriceAmount: { cellIndex: 7, label: "Net Price", example: "100.00" },
        TaxCode: { cellIndex: 8, label: "Tax Code", example: "V1" }
    };

    var PurchaseOrderValidator = {
        /** Reference to authoritative schema rules */
        rules: _rules,

        /**
         * Optional external text resolver function (e.g. bound BaseController.getText)
         */
        _fnTextResolver: null,

        setTextResolver: function (fnResolver) {
            this._fnTextResolver = fnResolver;
        },

        /**
         * Resolves text via external resolver, UI5 Core library bundle, or formatted fallback.
         * @param {string} sKey - i18n key
         * @param {string[]} [aArgs] - optional positional arguments for {0}, {1}
         * @param {string} [sFallback] - optional default English string
         * @returns {string}
         */
        getText: function (sKey, aArgs, sFallback) {
            if (typeof this._fnTextResolver === "function") {
                var sResolved = this._fnTextResolver(sKey, aArgs, sFallback);
                if (sResolved && sResolved !== sKey) {
                    return sResolved;
                }
            }
            try {
                var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                if (oSap && oSap.ui && typeof oSap.ui.getCore === "function") {
                    var oCore = oSap.ui.getCore();
                    var oBundle = oCore.getLibraryResourceBundle ? oCore.getLibraryResourceBundle("saps4hana.fiori") : null;
                    if (oBundle && typeof oBundle.getText === "function") {
                        var sBundled = oBundle.getText(sKey, aArgs);
                        if (sBundled && sBundled !== sKey) {
                            return sBundled;
                        }
                    }
                }
            } catch (e) {}

            var sResult = sFallback !== undefined ? sFallback : sKey;
            if (Array.isArray(aArgs) && aArgs.length > 0) {
                aArgs.forEach(function (arg, idx) {
                    sResult = sResult.replace(new RegExp("\\{" + idx + "\\}", "g"), arg);
                });
            }
            return sResult;
        },

        /**
         * Checks whether a Document Type satisfies domain rules:
         * Must start with 'Z' and not exceed 4 characters (e.g. ZDOM, ZDOS, ZIMP, ZCAP).
         *
         * @param {string} sDocType
         * @returns {boolean}
         */
        isValidDocType: function (sDocType) {
            var s = String(sDocType || "").trim().toUpperCase();
            return DOC_TYPE_PREFIX_REGEX.test(s) && s.length <= DOC_TYPE_MAX_LEN;
        },

        /**
         * Validates a Purchase Order Document Type against domain rules.
         *
         * @param {string} sDocType
         * @param {Function} [fnTextResolver]
         * @returns {{ valid: boolean, state: string, text: string }}
         */
        validateDocType: function (sDocType, fnTextResolver) {
            var fnResolve = fnTextResolver || this.getText.bind(this);
            var sValTrim = String(sDocType || "").trim().toUpperCase();
            if (!sValTrim) {
                return {
                    valid: false,
                    state: "Error",
                    text: fnResolve("poValDocTypeRequired", null, "Document Type is required (e.g. ZDOM).")
                };
            }
            if (this.isValidDocType(sValTrim)) {
                return {
                    valid: true,
                    state: "None",
                    text: ""
                };
            }
            return {
                valid: false,
                state: "Error",
                text: fnResolve("poValDocTypeZRequired", null, "Only Z-related document types (e.g. ZDOM, ZDOS, ZIMP, ZCAP) are supported.")
            };
        },

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
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {any} [sValue]
         * @param {number} [iItemIndex]
         * @param {Function} [fnTextResolver]
         * @param {Function} [fnValidateForm]
         * @returns {{ state: string, text: string }}
         */
        validateSingleField: function (oModel, sField, sValue, iItemIndex, fnTextResolver, fnValidateForm) {
            if (!oModel) return { state: "None", text: "" };
            var fnResolve = fnTextResolver || this.getText.bind(this);
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
                        var oDocResult = this.validateDocType(sValTrim, fnResolve);
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
                    this.validateForm(oModel, fnResolve);
                }
            }

            return oState;
        },

        /**
         * Validates the form data and updates field error states on the model for UI binding.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Function} [fnTextResolver]
         * @returns {{ isValid: boolean, errorCount: number, errorList: Array<{title: string, field: string, description: string, controlId: any}>, errorMessage: string }}
         */
        validateForm: function (oModel, fnTextResolver) {
            if (!oModel) return { isValid: false, errorCount: 0, errorList: [], errorMessage: "" };
            var fnResolve = fnTextResolver || this.getText.bind(this);
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeader = oData.header || {};
            var aItems = oData.items || [];
            var aErrorList = [];

            var sDocType = oHeader.PurchaseOrderType;
            var sCleanDocType = sDocType ? String(sDocType).trim().toUpperCase() : "";
            var oPoRule = (_rules && _rules.PO_TYPES && _rules.PO_TYPES[sCleanDocType]) || null;

            // Header errors
            var oHeaderErrors = {
                PurchaseOrderType: { state: "None", text: "" },
                CompanyCode: { state: "None", text: "" },
                PurchasingOrganization: { state: "None", text: "" },
                PurchasingGroup: { state: "None", text: "" },
                Supplier: { state: "None", text: "" },
                Currency: { state: "None", text: "" },
                DocumentDate: { state: "None", text: "" },
                IncotermsClassification: { state: "None", text: "" },
                IncotermsLocation1: { state: "None", text: "" },
                PaymentTerms: { state: "None", text: "" }
            };

            if (!oHeader.PurchaseOrderType || !String(oHeader.PurchaseOrderType).trim()) {
                oHeaderErrors.PurchaseOrderType = { state: "Error", text: fnResolve("poValDocTypeRequired", null, "Document Type is required (e.g. ZDOM).") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryDocTypeReq", null, "Document Type is required."),
                    field: "General Data / Document Type",
                    description: fnResolve("poValSummaryDocTypeDesc", null, "Select or enter a Z-related document type (e.g. ZDOM). Use the dropdown (▼) to choose from available types."),
                    controlId: "inDocType"
                });
            } else {
                var oDocVal = this.validateDocType(oHeader.PurchaseOrderType, fnResolve);
                if (!oDocVal.valid) {
                    oHeaderErrors.PurchaseOrderType = { state: "Error", text: oDocVal.text };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValSummaryDocTypeInvalid", null, "Document Type: invalid selection."),
                        field: "General Data / Document Type",
                        description: oDocVal.text,
                        controlId: "inDocType"
                    });
                }
            }
            if (!oHeader.CompanyCode || !String(oHeader.CompanyCode).trim()) {
                oHeaderErrors.CompanyCode = { state: "Error", text: fnResolve("poValCompanyCodeRequired", null, "Company Code is required (e.g. 1010).") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryCoCodeReq", null, "Company Code is required."),
                    field: "General Data / Company Code",
                    description: fnResolve("poValSummaryCoCodeDesc", null, "Specify an active 4-character Company Code (e.g. 1010) registered in your SAP organization."),
                    controlId: "inCompanyCode"
                });
            } else if (oPoRule && oPoRule.allowedCompanyCodes && !oPoRule.allowedCompanyCodes.includes(String(oHeader.CompanyCode).trim())) {
                var sCoErr = "Company Code " + oHeader.CompanyCode + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedCompanyCodes.join(", ") + ").";
                oHeaderErrors.CompanyCode = { state: "Error", text: sCoErr };
                aErrorList.push({
                    type: "Error",
                    title: sCoErr,
                    field: "General Data / Company Code",
                    description: "Select an eligible Company Code for document type " + sCleanDocType + ".",
                    controlId: "inCompanyCode"
                });
            }
            if (!oHeader.PurchasingOrganization || !String(oHeader.PurchasingOrganization).trim()) {
                oHeaderErrors.PurchasingOrganization = { state: "Error", text: fnResolve("poValPurchOrgRequired", null, "Purchasing Organization is required (e.g. 1010).") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryPurchOrgReq", null, "Purchasing Organization is required."),
                    field: "General Data / Purchasing Org",
                    description: fnResolve("poValSummaryPurchOrgDesc", null, "Enter a valid Purchasing Organization responsible for this procurement document."),
                    controlId: "inPurchOrg"
                });
            } else if (oPoRule && oPoRule.allowedPurchOrgs && !oPoRule.allowedPurchOrgs.includes(String(oHeader.PurchasingOrganization).trim())) {
                var sPoErr = "Purchasing Organization " + oHeader.PurchasingOrganization + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedPurchOrgs.join(", ") + ").";
                oHeaderErrors.PurchasingOrganization = { state: "Error", text: sPoErr };
                aErrorList.push({
                    type: "Error",
                    title: sPoErr,
                    field: "General Data / Purchasing Org",
                    description: "Select an eligible Purchasing Organization for document type " + sCleanDocType + ".",
                    controlId: "inPurchOrg"
                });
            }
            if (!oHeader.PurchasingGroup || !String(oHeader.PurchasingGroup).trim()) {
                oHeaderErrors.PurchasingGroup = { state: "Error", text: fnResolve("poValPurchGrpRequired", null, "Purchasing Group is required (e.g. 101).") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryPurchGrpReq", null, "Purchasing Group is required."),
                    field: "General Data / Purchasing Group",
                    description: fnResolve("poValSummaryPurchGrpDesc", null, "Specify a 3-character buyer purchasing group (e.g. 101)."),
                    controlId: "inPurchGrp"
                });
            }
            if (!oHeader.Supplier || !String(oHeader.Supplier).trim()) {
                oHeaderErrors.Supplier = { state: "Error", text: fnResolve("poValSupplierRequired", null, "Supplier is required (e.g. 10300001).") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummarySupplierReq", null, "Supplier is required."),
                    field: "Supplier & Commercial Terms / Supplier",
                    description: fnResolve("poValSummarySupplierDesc", null, "Enter or select an active SAP Business Partner / Supplier ID."),
                    controlId: "inSupplier"
                });
            }
            if (!oHeader.Currency || !String(oHeader.Currency).trim()) {
                oHeaderErrors.Currency = { state: "Error", text: fnResolve("poValCurrencyRequired", null, "Currency is required (e.g. EUR, USD).") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryCurrencyReq", null, "Currency is required."),
                    field: "Supplier & Commercial Terms / Currency",
                    description: fnResolve("poValSummaryCurrencyDesc", null, "Enter a valid 3-letter ISO currency code (e.g. EUR, USD)."),
                    controlId: "inCurrency"
                });
            } else if (!CURRENCY_REGEX.test(String(oHeader.Currency).trim())) {
                oHeaderErrors.Currency = { state: "Error", text: fnResolve("poValCurrencyIso", null, "Currency must be a valid 3-letter ISO code.") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValCurrencyIso", null, "Currency must be a 3-letter ISO code (e.g. EUR)."),
                    field: "Supplier & Commercial Terms / Currency",
                    description: fnResolve("poValSummaryCurrencyDesc", null, "Use an authorized ISO currency code (e.g. EUR, USD, INR)."),
                    controlId: "inCurrency"
                });
            } else if (oPoRule && oPoRule.allowedCurrencies && !oPoRule.allowedCurrencies.includes(String(oHeader.Currency).trim())) {
                var sCurrErr = "Currency " + oHeader.Currency + " is not permitted for " + sCleanDocType + " (Allowed: " + oPoRule.allowedCurrencies.join(", ") + ").";
                oHeaderErrors.Currency = { state: "Error", text: sCurrErr };
                aErrorList.push({
                    type: "Error",
                    title: sCurrErr,
                    field: "Supplier & Commercial Terms / Currency",
                    description: "Select an authorized currency for document type " + sCleanDocType + ".",
                    controlId: "inCurrency"
                });
            }
            if (!oHeader.DocumentDate || !String(oHeader.DocumentDate).trim()) {
                oHeaderErrors.DocumentDate = { state: "Error", text: fnResolve("poValDocDateRequired", null, "Document Date is required.") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryDocDateReq", null, "Document Date is required."),
                    field: "General Data / Document Date",
                    description: fnResolve("poValSummaryDocDateDesc", null, "Choose the creation or document date for this purchase order."),
                    controlId: "inDocDate"
                });
            }
            if (oHeader.IncotermsClassification && String(oHeader.IncotermsClassification).trim().length > INCOTERMS_MAX_LEN) {
                oHeaderErrors.IncotermsClassification = { state: "Error", text: fnResolve("poValIncotermsMaxLen", null, "Incoterms must not exceed " + INCOTERMS_MAX_LEN + " characters.") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValIncotermsMaxLen", null, "Incoterms must not exceed " + INCOTERMS_MAX_LEN + " characters."),
                    field: "Supplier & Commercial Terms / Incoterms",
                    description: fnResolve("poValSummaryIncotermsDesc", null, "Enter a " + INCOTERMS_MAX_LEN + "-letter Incoterms classification (e.g. EXW, FOB, CIF)."),
                    controlId: "inIncoterms"
                });
            }
            if (oHeader.IncotermsClassification && (!oHeader.IncotermsLocation1 || !String(oHeader.IncotermsLocation1).trim())) {
                oHeaderErrors.IncotermsLocation1 = { state: "Error", text: fnResolve("poValIncotermsLocRequired", null, "Incoterms Location is required when Incoterms is specified.") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValIncotermsLocRequired", null, "Incoterms Location is required when Incoterms is specified."),
                    field: "Supplier & Commercial Terms / Incoterms Location",
                    description: fnResolve("poValSummaryIncotermsLocDesc", null, "Provide the primary delivery location for Incoterms."),
                    controlId: "inIncotermsLoc"
                });
            } else if (oHeader.IncotermsLocation1 && String(oHeader.IncotermsLocation1).trim().length > INCOTERMS_LOC_MAX_LEN) {
                oHeaderErrors.IncotermsLocation1 = { state: "Error", text: fnResolve("poValIncotermsLocMaxLen", null, "Incoterms Location 1 exceeds maximum length of " + INCOTERMS_LOC_MAX_LEN + " characters.") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValIncotermsLocMaxLen", null, "Incoterms Location 1 exceeds " + INCOTERMS_LOC_MAX_LEN + " characters."),
                    field: "Supplier & Commercial Terms / Incoterms Location",
                    description: fnResolve("poValSummaryIncotermsLocDesc", null, "Shorten Incoterms Location 1 to at most " + INCOTERMS_LOC_MAX_LEN + " characters."),
                    controlId: "inIncotermsLoc"
                });
            }
            if (oHeader.PaymentTerms && String(oHeader.PaymentTerms).trim().length > PAYMENT_TERMS_MAX_LEN) {
                oHeaderErrors.PaymentTerms = { state: "Error", text: fnResolve("poValPaymentTermsMaxLen", null, "Payment Terms exceeds maximum length of " + PAYMENT_TERMS_MAX_LEN + " characters.") };
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValPaymentTermsMaxLen", null, "Payment Terms exceeds " + PAYMENT_TERMS_MAX_LEN + " characters."),
                    field: "Supplier & Commercial Terms / Payment Terms",
                    description: fnResolve("poValSummaryPayTermsDesc", null, "Enter a standard " + PAYMENT_TERMS_MAX_LEN + "-character payment terms code (e.g. 0001)."),
                    controlId: "inPaymentTerms"
                });
            }

            // Items errors
            if (aItems.length === 0) {
                aErrorList.push({
                    type: "Error",
                    title: fnResolve("poValSummaryAtLeastOneItem", null, "Please add at least one line item."),
                    field: "Items Table",
                    description: fnResolve("poValSummaryAtLeastOneItemDesc", null, "Click 'Add Item' to insert at least one purchasing line item."),
                    controlId: "poItemsTable"
                });
            } else {
                var bMaterialRequired = oPoRule ? oPoRule.materialRequired !== false : true;
                aItems.forEach(function (item, idx) {
                    var sItemNo = item.PurchaseOrderItem || "Item #" + (idx + 1);
                    item.errors = item.errors || {};
                    item.errors.Plant = { state: "None", text: "" };
                    item.errors.StorageLocation = { state: "None", text: "" };
                    item.errors.Material = { state: "None", text: "" };
                    item.errors.PurchaseOrderItemText = { state: "None", text: "" };
                    item.errors.OrderQuantity = { state: "None", text: "" };
                    item.errors.UnitOfMeasure = { state: "None", text: "" };
                    item.errors.NetPriceAmount = { state: "None", text: "" };
                    item.errors.TaxCode = { state: "None", text: "" };
                    item.errors.PurchaseOrderItemCategory = { state: "None", text: "" };
                    item.errors.AccountAssignmentCategory = { state: "None", text: "" };

                    if (bMaterialRequired && (!item.Material || !String(item.Material).trim())) {
                        item.errors.Material = { state: "Error", text: fnResolve("poValMaterialRequired", null, "Material is required.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemMaterialRequired", [sItemNo], sItemNo + ": Material is required."),
                            field: sItemNo + " / Material",
                            description: "Select a valid material master number (e.g. TG11).",
                            itemIndex: idx,
                            cellIndex: 3,
                            controlId: "poItemsTable"
                        });
                    } else if (!bMaterialRequired && !item.Material && (!item.PurchaseOrderItemText || !String(item.PurchaseOrderItemText).trim())) {
                        item.errors.PurchaseOrderItemText = { state: "Error", text: "Short Text (Description) is required when Material is omitted." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Short Text (Description) is required.",
                            field: sItemNo + " / Description",
                            description: "Enter a descriptive short text for this service/blanket line item.",
                            itemIndex: idx,
                            cellIndex: 4,
                            controlId: "poItemsTable"
                        });
                    }

                    if (!item.Plant || !String(item.Plant).trim()) {
                        item.errors.Plant = { state: "Error", text: fnResolve("poValItemPlantRequired", [""], "Plant is required.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemPlantRequired", [sItemNo], sItemNo + ": Plant is required."),
                            field: sItemNo + " / Plant",
                            description: "Specify an authorized plant (e.g. 1010).",
                            itemIndex: idx,
                            cellIndex: 1,
                            controlId: "poItemsTable"
                        });
                    } else if (oPoRule && oPoRule.allowedPlantPrefix && !String(item.Plant).trim().startsWith(oPoRule.allowedPlantPrefix)) {
                        var sPlantErr = sItemNo + ": Plant " + item.Plant + " must start with '" + oPoRule.allowedPlantPrefix + "' for " + sCleanDocType + ".";
                        item.errors.Plant = { state: "Error", text: sPlantErr };
                        aErrorList.push({
                            type: "Error",
                            title: sPlantErr,
                            field: sItemNo + " / Plant",
                            description: "Select a plant matching the company code / plant prefix for " + sCleanDocType + ".",
                            itemIndex: idx,
                            cellIndex: 1,
                            controlId: "poItemsTable"
                        });
                    }

                    if (!item.StorageLocation || !String(item.StorageLocation).trim()) {
                        item.errors.StorageLocation = { state: "Error", text: fnResolve("poValItemStorageLocRequired", [""], "Storage Location is required.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemStorageLocRequired", [sItemNo], sItemNo + ": Storage Location is required."),
                            field: sItemNo + " / Storage Location",
                            description: "Specify the receiving storage location within the plant (e.g. 101A).",
                            itemIndex: idx,
                            cellIndex: 2,
                            controlId: "poItemsTable"
                        });
                    }
                    if (!item.UnitOfMeasure || !String(item.UnitOfMeasure).trim()) {
                        item.errors.UnitOfMeasure = { state: "Error", text: fnResolve("poValItemUnitRequired", [""], "Unit of Measure is required.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemUnitRequired", [sItemNo], sItemNo + ": Unit of Measure is required."),
                            field: sItemNo + " / Unit of Measure",
                            description: "Specify the order unit of measure (e.g. PC, KG).",
                            itemIndex: idx,
                            cellIndex: 5,
                            controlId: "poItemsTable"
                        });
                    }
                    var fQty = parseFloat(item.OrderQuantity);
                    if (!item.OrderQuantity || isNaN(fQty) || fQty <= 0) {
                        item.errors.OrderQuantity = { state: "Error", text: fnResolve("poValItemQtyPositive", [""], "Order Quantity must be greater than 0.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemQtyPositive", [sItemNo], sItemNo + ": Order Quantity must be greater than 0."),
                            field: sItemNo + " / Quantity",
                            description: "Enter a positive numeric quantity.",
                            itemIndex: idx,
                            cellIndex: 4,
                            controlId: "poItemsTable"
                        });
                    }
                    if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && String(item.NetPriceAmount).trim() !== "") {
                        var fPrice = parseFloat(item.NetPriceAmount);
                        if (isNaN(fPrice) || fPrice < 0) {
                            item.errors.NetPriceAmount = { state: "Error", text: fnResolve("poValItemNetPricePositive", [""], "Net Price must be non-negative.") };
                            aErrorList.push({
                                type: "Error",
                                title: fnResolve("poValItemNetPricePositive", [sItemNo], sItemNo + ": Net Price must be non-negative."),
                                field: sItemNo + " / Net Price",
                                description: "Enter 0.00 or a positive net price.",
                                itemIndex: idx,
                                cellIndex: 6,
                                controlId: "poItemsTable"
                            });
                        }
                    }
                    if (item.TaxCode && String(item.TaxCode).trim().length > TAX_CODE_MAX_LEN) {
                        item.errors.TaxCode = { state: "Error", text: fnResolve("poValItemTaxCodeMaxLen", [""], "Tax Code exceeds " + TAX_CODE_MAX_LEN + " characters.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemTaxCodeMaxLen", [sItemNo], sItemNo + ": Tax Code exceeds " + TAX_CODE_MAX_LEN + " characters."),
                            field: sItemNo + " / Tax Code",
                            description: "Enter a " + TAX_CODE_MAX_LEN + "-character SAP tax code (e.g. V1, I0).",
                            itemIndex: idx,
                            cellIndex: 7,
                            controlId: "poItemsTable"
                        });
                    }

                    if (oPoRule && oPoRule.allowedItemCategories && item.PurchaseOrderItemCategory && !oPoRule.allowedItemCategories.includes(String(item.PurchaseOrderItemCategory).trim())) {
                        var sCatErr = sItemNo + ": Item Category " + item.PurchaseOrderItemCategory + " is not allowed for " + sCleanDocType + " (Allowed: " + oPoRule.allowedItemCategories.join(", ") + ").";
                        item.errors.PurchaseOrderItemCategory = { state: "Error", text: sCatErr };
                        aErrorList.push({
                            type: "Error",
                            title: sCatErr,
                            field: sItemNo + " / Item Category",
                            description: "Choose an authorized item category for " + sCleanDocType + ".",
                            itemIndex: idx,
                            cellIndex: 1,
                            controlId: "poItemsTable"
                        });
                    }
                    if (oPoRule && oPoRule.allowedAcctAssignmentCategories && item.AccountAssignmentCategory && !oPoRule.allowedAcctAssignmentCategories.includes(String(item.AccountAssignmentCategory).trim())) {
                        var sAcctErr = sItemNo + ": Account Assignment Category " + item.AccountAssignmentCategory + " is not allowed for " + sCleanDocType + " (Allowed: " + oPoRule.allowedAcctAssignmentCategories.join(", ") + ").";
                        item.errors.AccountAssignmentCategory = { state: "Error", text: sAcctErr };
                        aErrorList.push({
                            type: "Error",
                            title: sAcctErr,
                            field: sItemNo + " / Account Assignment",
                            description: "Choose an authorized account assignment category for " + sCleanDocType + ".",
                            itemIndex: idx,
                            cellIndex: 2,
                            controlId: "poItemsTable"
                        });
                    }
                });
            }

            var bHasError = aErrorList.length > 0;
            var sSummary = "";
            if (bHasError) {
                sSummary = aErrorList.length === 1
                    ? aErrorList[0].title
                    : fnResolve("poValSummaryMultiErrors", [aErrorList.length], aErrorList.length + " validation errors found. Please correct the highlighted fields.");
            }

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", bHasError);
                oModel.setProperty("/errorMessage", sSummary);
                oModel.setProperty("/errorCount", aErrorList.length);
                oModel.setProperty("/errorList", aErrorList);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = bHasError;
                oData.errorMessage = sSummary;
                oData.errorCount = aErrorList.length;
                oData.errorList = aErrorList;
            }

            return {
                isValid: !bHasError,
                errorCount: aErrorList.length,
                errorList: aErrorList,
                errorMessage: sSummary
            };
        },

        /**
         * Applies backend error details from S/4HANA or CAP to the model fields and error list.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oError
         * @param {Function} [fnTextResolver]
         * @param {Object} [mHeaderConfig]
         * @param {Object} [mItemConfig]
         * @returns {{ errorCount: number, errorList: Array, errorMessage: string }}
         */
        applyBackendErrors: function (oModel, oError, fnTextResolver, mHeaderConfig, mItemConfig) {
            if (!oModel) return { errorCount: 0, errorList: [], errorMessage: "" };
            var fnResolve = fnTextResolver || this.getText.bind(this);
            var mHeaderFieldConfig = mHeaderConfig || DEFAULT_HEADER_FIELD_CONFIG;
            var mItemFieldConfig = mItemConfig || DEFAULT_ITEM_FIELD_CONFIG;

            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var aErrorList = [];
            var sMainMessage = (oError && oError.message) || "Backend operation failed.";
            var aDetails = (oError && oError.details) || [];
            var iStatus = (oError && oError.status) || 500;

            var mHeaderTargets = {
                "header.purchaseordertype": "PurchaseOrderType",
                "purchaseordertype": "PurchaseOrderType",
                "doctype": "PurchaseOrderType",
                "header.companycode": "CompanyCode",
                "companycode": "CompanyCode",
                "header.purchasingorganization": "PurchasingOrganization",
                "purchasingorganization": "PurchasingOrganization",
                "purchasingorg": "PurchasingOrganization",
                "header.purchasinggroup": "PurchasingGroup",
                "purchasinggroup": "PurchasingGroup",
                "purchgroup": "PurchasingGroup",
                "header.supplier": "Supplier",
                "supplier": "Supplier",
                "vendor": "Supplier",
                "header.currency": "Currency",
                "currency": "Currency",
                "header.documentdate": "DocumentDate",
                "documentdate": "DocumentDate",
                "header.paymentterms": "PaymentTerms",
                "paymentterms": "PaymentTerms",
                "header.incotermsclassification": "IncotermsClassification",
                "incotermsclassification": "IncotermsClassification",
                "incoterms": "IncotermsClassification",
                "header.incotermslocation1": "IncotermsLocation1",
                "incotermslocation1": "IncotermsLocation1"
            };

            var mItemTargets = {
                "material": "Material",
                "plant": "Plant",
                "storagelocation": "StorageLocation",
                "orderquantity": "OrderQuantity",
                "quantity": "OrderQuantity",
                "unitofmeasure": "UnitOfMeasure",
                "uom": "UnitOfMeasure",
                "netpriceamount": "NetPriceAmount",
                "netprice": "NetPriceAmount",
                "taxcode": "TaxCode"
            };

            var oHeaderErrors = oData.errors || {
                PurchaseOrderType: { state: "None", text: "" },
                CompanyCode: { state: "None", text: "" },
                PurchasingOrganization: { state: "None", text: "" },
                PurchasingGroup: { state: "None", text: "" },
                Supplier: { state: "None", text: "" },
                Currency: { state: "None", text: "" },
                DocumentDate: { state: "None", text: "" },
                IncotermsClassification: { state: "None", text: "" },
                IncotermsLocation1: { state: "None", text: "" },
                PaymentTerms: { state: "None", text: "" }
            };
            var aItems = oData.items || [];

            if (aDetails.length > 0) {
                aDetails.forEach(function (detail) {
                    var sDetailMsg = detail.message || sMainMessage;
                    var sTarget = String(detail.target || "").toLowerCase();
                    var sCode = detail.code || "";
                    var sControlId = null;
                    var iItemIdx = -1;
                    var sItemField = null;

                    // Match header target
                    for (var k in mHeaderTargets) {
                        if (sTarget === k || sTarget.endsWith("." + k) || sTarget.endsWith("/" + k)) {
                            var sFieldKey = mHeaderTargets[k];
                            oHeaderErrors[sFieldKey] = { state: "Error", text: sDetailMsg };
                            sControlId = mHeaderFieldConfig[sFieldKey] ? mHeaderFieldConfig[sFieldKey].controlId : null;
                            break;
                        }
                    }

                    // Match item target (e.g. items[0].Plant or Plant)
                    if (!sControlId) {
                        var oItemMatch = sTarget.match(/items\[(\d+)\]\.?(\w+)?/);
                        if (oItemMatch) {
                            iItemIdx = parseInt(oItemMatch[1], 10);
                            var sTargetField = (oItemMatch[2] || "").toLowerCase();
                            sItemField = mItemTargets[sTargetField] || null;
                        } else {
                            for (var it in mItemTargets) {
                                if (sTarget === it || sTarget.endsWith("." + it)) {
                                    sItemField = mItemTargets[it];
                                    iItemIdx = 0;
                                    break;
                                }
                            }
                        }

                        if (sItemField && aItems[iItemIdx]) {
                            aItems[iItemIdx].errors = aItems[iItemIdx].errors || {};
                            aItems[iItemIdx].errors[sItemField] = { state: "Error", text: sDetailMsg };
                            sControlId = "poItemsTable";
                        }
                    }

                    aErrorList.push({
                        type: "Error",
                        title: sDetailMsg,
                        field: sCode ? ("SAP (" + sCode + ")") : (detail.target || "S/4HANA Error"),
                        description: (detail.description || sDetailMsg) + (sCode ? (" [Code: " + sCode + "]") : ""),
                        controlId: sControlId,
                        itemIndex: iItemIdx >= 0 ? iItemIdx : undefined,
                        cellIndex: sItemField && mItemFieldConfig[sItemField] ? mItemFieldConfig[sItemField].cellIndex : undefined
                    });
                });
            } else if (sMainMessage.indexOf(";") !== -1) {
                var aParts = sMainMessage.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
                aParts.forEach(function (sPart) {
                    var sLower = sPart.toLowerCase();
                    var sControlId = null;

                    for (var k in mHeaderTargets) {
                        if (sLower.indexOf(k) !== -1) {
                            var sFieldKey = mHeaderTargets[k];
                            oHeaderErrors[sFieldKey] = { state: "Error", text: sPart };
                            sControlId = mHeaderFieldConfig[sFieldKey] ? mHeaderFieldConfig[sFieldKey].controlId : null;
                            break;
                        }
                    }

                    if (!sControlId) {
                        for (var it in mItemTargets) {
                            if (sLower.indexOf(it) !== -1) {
                                var sItemField = mItemTargets[it];
                                if (aItems[0]) {
                                    aItems[0].errors = aItems[0].errors || {};
                                    aItems[0].errors[sItemField] = { state: "Error", text: sPart };
                                    sControlId = "poItemsTable";
                                }
                                break;
                            }
                        }
                    }

                    aErrorList.push({
                        type: "Error",
                        title: sPart,
                        field: sControlId ? "Validation" : ("SAP Backend (HTTP " + iStatus + ")"),
                        description: sPart,
                        controlId: sControlId
                    });
                });
            } else {
                var sLower = sMainMessage.toLowerCase();
                var sControlId = null;
                for (var hk in mHeaderTargets) {
                    if (sLower.indexOf(hk) !== -1) {
                        var sFieldKey = mHeaderTargets[hk];
                        oHeaderErrors[sFieldKey] = { state: "Error", text: sMainMessage };
                        sControlId = mHeaderFieldConfig[sFieldKey] ? mHeaderFieldConfig[sFieldKey].controlId : null;
                        break;
                    }
                }
                aErrorList.push({
                    type: "Error",
                    title: sMainMessage,
                    field: "SAP Backend (HTTP " + iStatus + ")",
                    description: (oError && oError.code ? ("Error code: " + oError.code + ". ") : "") + sMainMessage,
                    controlId: sControlId
                });
            }

            var sSummary = aErrorList.length === 1
                ? aErrorList[0].title
                : fnResolve("poValBackendErrorsSummary", [aErrorList.length], aErrorList.length + " errors returned by backend. Please review and resolve.");

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", true);
                oModel.setProperty("/errorMessage", sSummary);
                oModel.setProperty("/errorCount", aErrorList.length);
                oModel.setProperty("/errorList", aErrorList);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = true;
                oData.errorMessage = sSummary;
                oData.errorCount = aErrorList.length;
                oData.errorList = aErrorList;
            }

            return {
                errorCount: aErrorList.length,
                errorList: aErrorList,
                errorMessage: sSummary
            };
        },

        /**
         * Clears all validation error states on the model.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        clearErrors: function (oModel) {
            if (!oModel) return;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeaderErrors = {
                PurchaseOrderType: { state: "None", text: "" },
                CompanyCode: { state: "None", text: "" },
                PurchasingOrganization: { state: "None", text: "" },
                PurchasingGroup: { state: "None", text: "" },
                Supplier: { state: "None", text: "" },
                Currency: { state: "None", text: "" },
                DocumentDate: { state: "None", text: "" },
                IncotermsClassification: { state: "None", text: "" },
                IncotermsLocation1: { state: "None", text: "" },
                PaymentTerms: { state: "None", text: "" }
            };

            var aItems = oData.items || [];
            aItems.forEach(function (item) {
                if (item.errors) {
                    item.errors.Plant = { state: "None", text: "" };
                    item.errors.StorageLocation = { state: "None", text: "" };
                    item.errors.Material = { state: "None", text: "" };
                    item.errors.OrderQuantity = { state: "None", text: "" };
                    item.errors.UnitOfMeasure = { state: "None", text: "" };
                    item.errors.NetPriceAmount = { state: "None", text: "" };
                    item.errors.TaxCode = { state: "None", text: "" };
                }
            });

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
                oModel.setProperty("/errorCount", 0);
                oModel.setProperty("/errorList", []);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = false;
                oData.errorMessage = "";
                oData.errorCount = 0;
                oData.errorList = [];
            }
        },

        /**
         * Sets validation state and text on a specific header field.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {string} sState ("None" | "Information" | "Warning" | "Error")
         * @param {string} sText
         */
        setFieldValidation: function (oModel, sField, sState, sText) {
            if (!oModel || !sField) return;
            var oStateObj = { state: sState || "None", text: sText || "" };
            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors/" + sField, oStateObj);
            } else {
                var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
                if (oData && oData.errors) {
                    oData.errors[sField] = oStateObj;
                }
            }
        },

        /**
         * Cross-validates Company Code and Purchasing Organization compatibility:
         * If Purchasing Org is assigned to a different Company Code in SAP master data,
         * flags error or clears it.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ purchasingOrgs?: Array }} oConfigData
         * @param {Function} [fnTextResolver]
         * @param {Function} [fnSetValidation]
         * @returns {{ isValid: boolean, message: string }}
         */
        validateCompanyCodePurchasingOrg: function (oModel, oConfigData, fnTextResolver, fnSetValidation) {
            if (!oModel) return { isValid: true, message: "" };
            var fnResolve = fnTextResolver || this.getText.bind(this);
            var fnSetVal = fnSetValidation || this.setFieldValidation.bind(this);
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeader = (oData && oData.header) || {};
            var sCoCode = (oHeader.CompanyCode || "").trim();
            var sPurchOrg = (oHeader.PurchasingOrganization || "").trim();

            if (!sCoCode || !sPurchOrg) {
                return { isValid: true, message: "" };
            }

            var aPurchOrgs = (oConfigData && oConfigData.purchasingOrgs) || [];
            if (aPurchOrgs.length === 0) {
                return { isValid: true, message: "" };
            }

            var oOrgRecord = aPurchOrgs.find(function (org) {
                return org && org.PurchasingOrganization === sPurchOrg;
            });

            if (oOrgRecord && oOrgRecord.CompanyCode && oOrgRecord.CompanyCode !== sCoCode) {
                var sMsg = fnResolve("poValPurchOrgCoCodeMismatch", [sPurchOrg, oOrgRecord.CompanyCode, sCoCode], "Purchasing Organization " + sPurchOrg + " belongs to Company Code " + oOrgRecord.CompanyCode + ", not " + sCoCode + ".");
                fnSetVal(oModel, "PurchasingOrganization", "Error", sMsg);
                return { isValid: false, message: sMsg };
            }

            return { isValid: true, message: "" };
        }
    };

    return PurchaseOrderValidator;
});
