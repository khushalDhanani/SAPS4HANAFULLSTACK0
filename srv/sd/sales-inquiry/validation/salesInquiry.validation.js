/**
 * Sales Inquiry Validation
 * Validates incoming Sales Inquiry creation payloads against SAP S/4HANA SD rules.
 */

const CURRENCY_REGEX = /^[A-Z]{3}$/;

/**
 * Validates a Sales Inquiry creation payload.
 *
 * @param {Object} payload - Incoming payload with header and items
 * @returns {{ isValid: boolean, message: string, errors: Array<{ field: string, message: string, itemIndex?: number }> }}
 */
function validateCreateSalesInquiryPayload(payload) {
    const errors = [];

    if (!payload || typeof payload !== 'object') {
        return {
            isValid: false,
            message: 'Invalid payload: Payload must be a non-null object',
            errors: [{ field: 'payload', message: 'Payload must be a non-null object' }]
        };
    }

    const { header, items } = payload;

    if (!header || typeof header !== 'object') {
        return {
            isValid: false,
            message: 'Invalid payload: Missing header object',
            errors: [{ field: 'header', message: 'Header object is required' }]
        };
    }

    // Header validations
    if (!header.SalesInquiryType || String(header.SalesInquiryType).trim() === '') {
        errors.push({ field: 'SalesInquiryType', message: 'Inquiry Type is required' });
    } else if (String(header.SalesInquiryType).trim().length > 4) {
        errors.push({ field: 'SalesInquiryType', message: 'Inquiry Type cannot exceed 4 characters' });
    }

    if (!header.SalesOrganization || String(header.SalesOrganization).trim() === '') {
        errors.push({ field: 'SalesOrganization', message: 'Sales Organization is required' });
    } else if (String(header.SalesOrganization).trim().length > 4) {
        errors.push({ field: 'SalesOrganization', message: 'Sales Organization cannot exceed 4 characters' });
    }

    if (!header.DistributionChannel || String(header.DistributionChannel).trim() === '') {
        errors.push({ field: 'DistributionChannel', message: 'Distribution Channel is required' });
    } else if (String(header.DistributionChannel).trim().length > 2) {
        errors.push({ field: 'DistributionChannel', message: 'Distribution Channel cannot exceed 2 characters' });
    }

    if (!header.OrganizationDivision || String(header.OrganizationDivision).trim() === '') {
        errors.push({ field: 'OrganizationDivision', message: 'Division is required' });
    } else if (String(header.OrganizationDivision).trim().length > 2) {
        errors.push({ field: 'OrganizationDivision', message: 'Division cannot exceed 2 characters' });
    }

    if (!header.SoldToParty || String(header.SoldToParty).trim() === '') {
        errors.push({ field: 'SoldToParty', message: 'Sold-to Party is required' });
    } else if (String(header.SoldToParty).trim().length > 10) {
        errors.push({ field: 'SoldToParty', message: 'Sold-to Party cannot exceed 10 characters' });
    }

    if (header.TransactionCurrency && !CURRENCY_REGEX.test(String(header.TransactionCurrency).trim().toUpperCase())) {
        errors.push({ field: 'TransactionCurrency', message: 'Currency must be a valid 3-character ISO currency code (e.g. INR, USD)' });
    }

    // Validity date checks
    if (header.BindingPeriodValidityStartDate && header.BindingPeriodValidityEndDate) {
        const start = new Date(header.BindingPeriodValidityStartDate);
        const end = new Date(header.BindingPeriodValidityEndDate);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
            errors.push({
                field: 'BindingPeriodValidityEndDate',
                message: 'Validity End Date must not be earlier than Validity Start Date'
            });
        }
    }

    // Items validations
    if (!items || !Array.isArray(items) || items.length === 0) {
        errors.push({ field: 'items', message: 'At least one inquiry item is required' });
    } else {
        items.forEach((item, index) => {
            const itemLabel = `Item ${index + 1}`;

            if (!item.Material || String(item.Material).trim() === '') {
                errors.push({ field: 'Material', itemIndex: index, message: `${itemLabel}: Material is required` });
            }

            const qty = parseFloat(item.OrderQuantity);
            if (item.OrderQuantity === undefined || item.OrderQuantity === null || isNaN(qty) || qty <= 0) {
                errors.push({ field: 'OrderQuantity', itemIndex: index, message: `${itemLabel}: Quantity must be greater than 0` });
            }

            if (!item.OrderQuantityUnit || String(item.OrderQuantityUnit).trim() === '') {
                errors.push({ field: 'OrderQuantityUnit', itemIndex: index, message: `${itemLabel}: Unit of measure is required` });
            }

            if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && item.NetPriceAmount !== '') {
                const price = parseFloat(item.NetPriceAmount);
                if (isNaN(price) || price < 0) {
                    errors.push({ field: 'NetPriceAmount', itemIndex: index, message: `${itemLabel}: Net price cannot be negative` });
                }
            }
        });
    }

    const isValid = errors.length === 0;
    const message = isValid ? 'Validation succeeded' : errors[0].message;

    return {
        isValid,
        message,
        errors
    };
}

module.exports = {
    validateCreateSalesInquiryPayload
};
