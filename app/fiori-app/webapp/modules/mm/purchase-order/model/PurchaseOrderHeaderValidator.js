(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory(require("./PurchaseOrderValidationLimits"));
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define(["./PurchaseOrderValidationLimits"], factory);
    }
})(this, function (Limits) {
    "use strict";

    var CURRENCY_REGEX = Limits.CURRENCY_REGEX;
    var INCOTERMS_MAX_LEN = Limits.INCOTERMS_MAX_LEN;
    var INCOTERMS_LOC_MAX_LEN = Limits.INCOTERMS_LOC_MAX_LEN;
    var PAYMENT_TERMS_MAX_LEN = Limits.PAYMENT_TERMS_MAX_LEN;

    /**
     * PurchaseOrderHeaderValidator
     *
     * Header-level rules of the Purchase Order form validation. Called through
     * the PurchaseOrderValidator facade and PurchaseOrderFormValidator.
     */
    return {
        /**
         * Validates all header fields and appends summary entries to aErrorList.
         *
         * @param {Object} oValidator - PurchaseOrderValidator facade
         * @param {Object} oHeader
         * @param {Object|null} oPoRule - PO type rule, if any
         * @param {string} sCleanDocType
         * @param {Function} fnResolve - text resolver
         * @param {Array} aErrorList - receives summary entries
         * @returns {Object} header field error states
         */
        validateHeader: function (oValidator, oHeader, oPoRule, sCleanDocType, fnResolve, aErrorList) {
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
                var oDocVal = oValidator.validateDocType(oHeader.PurchaseOrderType, fnResolve);
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

            return oHeaderErrors;
        },

        /**
         * Cross-validates Company Code and Purchasing Organization compatibility:
         * If Purchasing Org is assigned to a different Company Code in SAP master data,
         * flags error or clears it.
         *
         * @param {Object} oValidator - PurchaseOrderValidator facade
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ purchasingOrgs?: Array }} oConfigData
         * @param {Function} [fnTextResolver]
         * @param {Function} [fnSetValidation]
         * @returns {{ isValid: boolean, message: string }}
         */
        validateCompanyCodePurchasingOrg: function (oValidator, oModel, oConfigData, fnTextResolver, fnSetValidation) {
            if (!oModel) return { isValid: true, message: "" };
            var fnResolve = fnTextResolver || oValidator.getText.bind(oValidator);
            var fnSetVal = fnSetValidation || oValidator.setFieldValidation.bind(oValidator);
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
});
