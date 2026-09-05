/**
 * PurchaseOrderValidator
 * Authoritative CAP business validation for Purchase Order creation requests.
 */

const CURRENCY_REGEX = /^[A-Za-z]{3}$/;
const ALPHANUMERIC_REGEX = /^[A-Za-z0-9_-]+$/;

const REQUIRED_HEADER_FIELDS = [
    { field: 'PurchaseOrderType', label: 'Document Type', maxLen: 4 },
    { field: 'CompanyCode', label: 'Company Code', maxLen: 4 },
    { field: 'PurchasingOrganization', label: 'Purchasing Organization', maxLen: 4 },
    { field: 'PurchasingGroup', label: 'Purchasing Group', maxLen: 3 },
    { field: 'Supplier', label: 'Supplier', maxLen: 10 },
    { field: 'Currency', label: 'Currency', maxLen: 3 },
    { field: 'DocumentDate', label: 'Document Date' }
];

const REQUIRED_ITEM_FIELDS = [
    { field: 'Material', label: 'Material', maxLen: 40 },
    { field: 'Plant', label: 'Plant', maxLen: 4 },
    { field: 'StorageLocation', label: 'Storage Location', maxLen: 4 },
    { field: 'OrderQuantity', label: 'Order Quantity' },
    { field: 'UnitOfMeasure', label: 'Unit of Measure', maxLen: 3 }
];

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
            if (incoterms.length > 3) {
                addError('header.IncotermsClassification', `IncotermsClassification '${incoterms}' exceeds maximum length of 3 characters`);
            }
            if (!header.IncotermsLocation1 || String(header.IncotermsLocation1).trim() === '') {
                addError('header.IncotermsLocation1', 'IncotermsLocation1 is required when IncotermsClassification is specified');
            } else if (String(header.IncotermsLocation1).trim().length > 70) {
                addError('header.IncotermsLocation1', 'IncotermsLocation1 exceeds maximum length of 70 characters');
            }
        }

        // PaymentTerms length
        if (header.PaymentTerms && String(header.PaymentTerms).trim().length > 4) {
            addError('header.PaymentTerms', 'PaymentTerms exceeds maximum length of 4 characters');
        }
    }

    // --- Items Validation ---
    if (!Array.isArray(items) || items.length === 0) {
        addError('items', 'At least one item is required');
    } else if (items.length > 999) {
        addError('items', 'Maximum limit of 999 items exceeded');
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
                if (isNaN(qty) || qty <= 0) {
                    addError(`${prefix}.OrderQuantity`, `Item ${itemNumber}: OrderQuantity must be a positive number greater than 0`);
                } else if (qty > 999999999) {
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
            if (item.TaxCode && String(item.TaxCode).trim().length > 2) {
                addError(`${prefix}.TaxCode`, `Item ${itemNumber}: TaxCode exceeds maximum length of 2 characters`);
            }
            if (item.MaterialGroup && String(item.MaterialGroup).trim().length > 9) {
                addError(`${prefix}.MaterialGroup`, `Item ${itemNumber}: MaterialGroup exceeds maximum length of 9 characters`);
            }
            if (item.PurchaseOrderItemCategory && String(item.PurchaseOrderItemCategory).trim().length > 1) {
                addError(`${prefix}.PurchaseOrderItemCategory`, `Item ${itemNumber}: PurchaseOrderItemCategory exceeds maximum length of 1 character`);
            }
            if (item.AccountAssignmentCategory && String(item.AccountAssignmentCategory).trim().length > 1) {
                addError(`${prefix}.AccountAssignmentCategory`, `Item ${itemNumber}: AccountAssignmentCategory exceeds maximum length of 1 character`);
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
    REQUIRED_HEADER_FIELDS,
    REQUIRED_ITEM_FIELDS,
    validateCreatePurchaseOrderPayload
};
