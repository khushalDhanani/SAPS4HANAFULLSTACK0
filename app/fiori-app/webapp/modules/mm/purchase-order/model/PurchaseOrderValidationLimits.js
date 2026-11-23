(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory(require("./PurchaseOrderRules"));
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define(["./PurchaseOrderRules"], factory);
    }
})(this, function (_rules) {
    "use strict";

    /**
     * PurchaseOrderValidationLimits
     *
     * Patterns and maximum lengths shared by the Purchase Order validators,
     * derived from the authoritative schema rules with safe fallbacks.
     */
    var HEADER_RULES = (_rules && _rules.HEADER) || {};
    var ITEM_RULES = (_rules && _rules.ITEM) || {};

    return {
        CURRENCY_REGEX: (_rules && _rules.PATTERNS && _rules.PATTERNS.CURRENCY) || /^[A-Za-z]{3}$/,
        DOC_TYPE_PREFIX_REGEX: (_rules && _rules.PATTERNS && _rules.PATTERNS.DOC_TYPE_PREFIX) || /^Z/,
        DOC_TYPE_MAX_LEN: (HEADER_RULES.PurchaseOrderType && HEADER_RULES.PurchaseOrderType.maxLen) || 4,
        INCOTERMS_MAX_LEN: (HEADER_RULES.IncotermsClassification && HEADER_RULES.IncotermsClassification.maxLen) || 3,
        INCOTERMS_LOC_MAX_LEN: (HEADER_RULES.IncotermsLocation1 && HEADER_RULES.IncotermsLocation1.maxLen) || 70,
        PAYMENT_TERMS_MAX_LEN: (HEADER_RULES.PaymentTerms && HEADER_RULES.PaymentTerms.maxLen) || 4,
        TAX_CODE_MAX_LEN: (ITEM_RULES.TaxCode && ITEM_RULES.TaxCode.maxLen) || 2
    };
});
