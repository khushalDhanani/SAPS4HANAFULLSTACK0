/**
 * PurchaseOrderValidator
 * Authoritative CAP business validation for Purchase Order creation requests.
 * Driven by single-source-of-truth schema: config/schema/purchaseOrderRules.json
 */

const RULES = require('../../../../config/schema/purchaseOrderRules.json');

const CURRENCY_REGEX = new RegExp(RULES.patterns.currency);

const REQUIRED_HEADER_FIELDS = Object.keys(RULES.header)
    .filter(k => RULES.header[k].required)
    .map(k => ({
        field: k,
        label: RULES.header[k].label,
        maxLen: RULES.header[k].maxLen
    }));

const REQUIRED_ITEM_FIELDS = Object.keys(RULES.item)
    .filter(k => RULES.item[k].required)
    .map(k => ({
        field: k,
        label: RULES.item[k].label,
        maxLen: RULES.item[k].maxLen
    }));

/**
 * Validates the createPurchaseOrder request payload.
 *
 * @param {Object} data
 * @param {Object} data.header
 * @param {Array<Object>} data.items
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }>, message: string }}
 */
function validateCreatePurchaseOrderPayload(data) {
    const errors = [];

    function addError(field, message) {
        errors.push({ field, message });
    }

    if (!data || typeof data !== 'object') {
        return {
            isValid: false,
            errors: [{ field: 'body', message: 'Request body must be a valid JSON object' }],
            message: 'Request body must be a valid JSON object'
        };
    }

    const { header, items } = data;

    // --- Header Validation ---
    if (!header || typeof header !== 'object') {
        addError('header', 'Header is required');
    } else {
        // Required header fields presence and length
        for (const req of REQUIRED_HEADER_FIELDS) {
            const val = header[req.field];
            if (val === undefined || val === null || String(val).trim() === '') {
                addError(`header.${req.field}`, `Header field '${req.field}' (${req.label}) is required`);
            } else if (req.maxLen && String(val).trim().length > req.maxLen) {
                addError(`header.${req.field}`, `Header field '${req.field}' exceeds maximum length of ${req.maxLen} characters`);
            }
        }

        // Currency format (ISO 4217: exactly 3 alphabetic letters)
        if (header.Currency && !CURRENCY_REGEX.test(String(header.Currency).trim())) {
            addError('header.Currency', `Currency '${header.Currency}' must be a valid 3-letter ISO currency code (e.g., EUR, USD)`);
        }

        // DocumentDate validity
        if (header.DocumentDate) {
            const parsedDate = new Date(header.DocumentDate);
            if (isNaN(parsedDate.getTime())) {
                addError('header.DocumentDate', `DocumentDate '${header.DocumentDate}' is not a valid date`);
            }
        }

        // Incoterms cross-field validation
        if (header.IncotermsClassification && String(header.IncotermsClassification).trim() !== '') {
            const incoterms = String(header.IncotermsClassification).trim();
            const maxIncoLen = (RULES.header.IncotermsClassification && RULES.header.IncotermsClassification.maxLen) || 3;
            if (incoterms.length > maxIncoLen) {
                addError('header.IncotermsClassification', `IncotermsClassification '${incoterms}' exceeds maximum length of ${maxIncoLen} characters`);
            }
            const maxIncoLocLen = (RULES.header.IncotermsLocation1 && RULES.header.IncotermsLocation1.maxLen) || 70;
            if (!header.IncotermsLocation1 || String(header.IncotermsLocation1).trim() === '') {
                addError('header.IncotermsLocation1', 'IncotermsLocation1 is required when IncotermsClassification is specified');
            } else if (String(header.IncotermsLocation1).trim().length > maxIncoLocLen) {
                addError('header.IncotermsLocation1', `IncotermsLocation1 exceeds maximum length of ${maxIncoLocLen} characters`);
            }
        }

        // PaymentTerms length
        const maxPayTermsLen = (RULES.header.PaymentTerms && RULES.header.PaymentTerms.maxLen) || 4;
        if (header.PaymentTerms && String(header.PaymentTerms).trim().length > maxPayTermsLen) {
            addError('header.PaymentTerms', `PaymentTerms exceeds maximum length of ${maxPayTermsLen} characters`);
        }
    }

    // --- Items Validation ---
    const minItems = (RULES.itemsList && RULES.itemsList.minItems) || 1;
    const maxItems = (RULES.itemsList && RULES.itemsList.maxItems) || 999;
    if (!Array.isArray(items) || items.length < minItems) {
        addError('items', 'At least one item is required');
    } else if (items.length > maxItems) {
        addError('items', `Maximum limit of ${maxItems} items exceeded`);
    } else {
        items.forEach((item, index) => {
            const itemNumber = item.PurchaseOrderItem || `Item #${index + 1}`;
            const prefix = `items[${index}]`;

            // Required item fields
            for (const req of REQUIRED_ITEM_FIELDS) {
                const val = item[req.field];
                if (val === undefined || val === null || String(val).trim() === '') {
                    addError(`${prefix}.${req.field}`, `Item ${itemNumber}: field '${req.field}' (${req.label}) is required`);
                } else if (req.maxLen && String(val).trim().length > req.maxLen) {
                    addError(`${prefix}.${req.field}`, `Item ${itemNumber}: field '${req.field}' exceeds maximum length of ${req.maxLen} characters`);
                }
            }

            // OrderQuantity numeric and positive bounds
            if (item.OrderQuantity !== undefined && item.OrderQuantity !== null && String(item.OrderQuantity).trim() !== '') {
                const qty = Number(item.OrderQuantity);
                const maxQty = (RULES.item.OrderQuantity && RULES.item.OrderQuantity.max) || 999999999;
                if (isNaN(qty) || qty <= 0) {
                    addError(`${prefix}.OrderQuantity`, `Item ${itemNumber}: OrderQuantity must be a positive number greater than 0`);
                } else if (qty > maxQty) {
                    addError(`${prefix}.OrderQuantity`, `Item ${itemNumber}: OrderQuantity exceeds maximum allowed value`);
                }
            }

            // NetPriceAmount non-negative bounds
            if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && String(item.NetPriceAmount).trim() !== '') {
                const price = Number(item.NetPriceAmount);
                if (isNaN(price) || price < 0) {
                    addError(`${prefix}.NetPriceAmount`, `Item ${itemNumber}: NetPriceAmount must be a non-negative number`);
                }
            }

            // Optional item field lengths
            const maxTaxLen = (RULES.item.TaxCode && RULES.item.TaxCode.maxLen) || 2;
            if (item.TaxCode && String(item.TaxCode).trim().length > maxTaxLen) {
                addError(`${prefix}.TaxCode`, `Item ${itemNumber}: TaxCode exceeds maximum length of ${maxTaxLen} characters`);
            }
            const maxMatGrpLen = (RULES.item.MaterialGroup && RULES.item.MaterialGroup.maxLen) || 9;
            if (item.MaterialGroup && String(item.MaterialGroup).trim().length > maxMatGrpLen) {
                addError(`${prefix}.MaterialGroup`, `Item ${itemNumber}: MaterialGroup exceeds maximum length of ${maxMatGrpLen} characters`);
            }
            const maxCatLen = (RULES.item.PurchaseOrderItemCategory && RULES.item.PurchaseOrderItemCategory.maxLen) || 1;
            if (item.PurchaseOrderItemCategory && String(item.PurchaseOrderItemCategory).trim().length > maxCatLen) {
                addError(`${prefix}.PurchaseOrderItemCategory`, `Item ${itemNumber}: PurchaseOrderItemCategory exceeds maximum length of ${maxCatLen} character`);
            }
            const maxAcctLen = (RULES.item.AccountAssignmentCategory && RULES.item.AccountAssignmentCategory.maxLen) || 1;
            if (item.AccountAssignmentCategory && String(item.AccountAssignmentCategory).trim().length > maxAcctLen) {
                addError(`${prefix}.AccountAssignmentCategory`, `Item ${itemNumber}: AccountAssignmentCategory exceeds maximum length of ${maxAcctLen} character`);
            }
        });
    }

    const messages = errors.map(e => e.message);

    return {
        isValid: errors.length === 0,
        errors,
        message: messages.join('; ')
    };
}

module.exports = {
    RULES,
    CURRENCY_REGEX,
    REQUIRED_HEADER_FIELDS,
    REQUIRED_ITEM_FIELDS,
    validateCreatePurchaseOrderPayload
};
