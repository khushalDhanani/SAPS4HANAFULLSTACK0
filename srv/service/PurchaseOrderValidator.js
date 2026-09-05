/**
 * PurchaseOrderValidator
 * Validates incoming Purchase Order creation requests before forwarding to S/4HANA.
 */

const REQUIRED_HEADER_FIELDS = [
    { field: 'PurchaseOrderType', label: 'Document Type' },
    { field: 'CompanyCode', label: 'Company Code' },
    { field: 'PurchasingOrganization', label: 'Purchasing Organization' },
    { field: 'PurchasingGroup', label: 'Purchasing Group' },
    { field: 'Supplier', label: 'Supplier' },
    { field: 'Currency', label: 'Currency' },
    { field: 'DocumentDate', label: 'Document Date' }
];

const REQUIRED_ITEM_FIELDS = [
    { field: 'Material', label: 'Material' },
    { field: 'Plant', label: 'Plant' },
    { field: 'StorageLocation', label: 'Storage Location' },
    { field: 'OrderQuantity', label: 'Order Quantity' },
    { field: 'UnitOfMeasure', label: 'Unit of Measure' }
];

/**
 * Validates the createPurchaseOrder request payload.
 *
 * @param {Object} data
 * @param {Object} data.header
 * @param {Array<Object>} data.items
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateCreatePurchaseOrderPayload(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        return {
            isValid: false,
            errors: ['Request body must be a valid JSON object']
        };
    }

    const { header, items } = data;

    if (!header || typeof header !== 'object') {
        errors.push('Header is required');
    } else {
        for (const req of REQUIRED_HEADER_FIELDS) {
            if (!header[req.field] || String(header[req.field]).trim() === '') {
                errors.push(`Header field '${req.field}' (${req.label}) is required`);
            }
        }
    }

    if (!Array.isArray(items) || items.length === 0) {
        errors.push('At least one item is required');
    } else {
        items.forEach((item, index) => {
            const itemNumber = item.PurchaseOrderItem || `Item #${index + 1}`;
            for (const req of REQUIRED_ITEM_FIELDS) {
                if (item[req.field] === undefined || item[req.field] === null || String(item[req.field]).trim() === '') {
                    errors.push(`Item ${itemNumber}: field '${req.field}' (${req.label}) is required`);
                }
            }

            if (item.OrderQuantity !== undefined && item.OrderQuantity !== null) {
                const qty = Number(item.OrderQuantity);
                if (isNaN(qty) || qty <= 0) {
                    errors.push(`Item ${itemNumber}: OrderQuantity must be greater than 0`);
                }
            }

            if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && item.NetPriceAmount !== '') {
                const price = Number(item.NetPriceAmount);
                if (isNaN(price) || price < 0) {
                    errors.push(`Item ${itemNumber}: NetPriceAmount must be a non-negative number`);
                }
            }
        });
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = {
    REQUIRED_HEADER_FIELDS,
    REQUIRED_ITEM_FIELDS,
    validateCreatePurchaseOrderPayload
};
