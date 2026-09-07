/**
 * PurchaseOrderMapper
 * Handles technical mapping, conversion, and formatting between CAP domain models
 * and SAP S/4HANA MM_PUR_PO_MAINT_V2_SRV OData V2 structures.
 */

/**
 * Formats a Date instance, ISO string, or timestamp into SAP OData V2 JSON timestamp format '/Date(epoch)/'.
 * Returns undefined if no date is provided. Throws Error if date is invalid.
 *
 * @param {Date|string|number} dateInput
 * @returns {string|undefined}
 */
function formatDateToODataV2(dateInput) {
    if (dateInput === undefined || dateInput === null || dateInput === '') {
        return undefined;
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) {
        throw new Error(`Invalid date value: ${dateInput}`);
    }
    return `/Date(${d.getTime()})/`;
}

/**
 * Formats and validates order quantity as a string for SAP S/4HANA OData V2.
 * Throws Error if quantity is non-numeric, zero, or negative.
 *
 * @param {number|string} quantityInput
 * @returns {string}
 */
function formatQuantity(quantityInput) {
    if (quantityInput === undefined || quantityInput === null || quantityInput === '') {
        throw new Error('OrderQuantity is required');
    }
    const num = Number(quantityInput);
    if (isNaN(num) || num <= 0) {
        throw new Error(`OrderQuantity must be a positive number. Received: ${quantityInput}`);
    }
    return String(quantityInput);
}

/**
 * Formats SAP Purchase Order item numbers with standard 10-increment sequence.
 *
 * @param {string|number} [itemNumber]
 * @param {number} [index=0]
 * @returns {string}
 */
function formatItemNumber(itemNumber, index = 0) {
    if (itemNumber !== undefined && itemNumber !== null && String(itemNumber).trim() !== '') {
        return String(itemNumber).trim();
    }
    return String((index + 1) * 10);
}

/**
 * Formats price amount to standard 2-decimal string.
 *
 * @param {number|string} priceInput
 * @returns {string}
 */
function formatPriceAmount(priceInput) {
    if (priceInput === undefined || priceInput === null || priceInput === '') {
        return '0.00';
    }
    const num = Number(priceInput);
    if (isNaN(num)) {
        throw new Error(`NetPriceAmount must be a numeric value. Received: ${priceInput}`);
    }
    return num.toFixed(2);
}

/**
 * Maps CAP Purchase Order header and items to S/4HANA MM_PUR_PO_MAINT_V2_SRV payload.
 *
 * @param {Object} header
 * @param {Array<Object>} items
 * @returns {Object}
 */
function mapToS4Payload(header, items, options = {}) {
    if (!header) {
        throw new Error('Header is required for S/4 payload mapping');
    }
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('At least one item is required for S/4 payload mapping');
    }

    const defaultRequisitioner = options.user || 'SYSTEM';
    const poDateFormatted = formatDateToODataV2(header.DocumentDate);

    const payload = {
        PurchaseOrderType: header.PurchaseOrderType,
        CompanyCode: header.CompanyCode,
        PurchasingOrganization: header.PurchasingOrganization,
        PurchasingGroup: header.PurchasingGroup,
        Supplier: header.Supplier,
        DocumentCurrency: header.Currency,
        ...(poDateFormatted ? { PurchaseOrderDate: poDateFormatted } : {}),
        ...(header.IncotermsClassification ? { IncotermsClassification: header.IncotermsClassification } : {}),
        ...(header.IncotermsLocation1 ? { IncotermsLocation1: header.IncotermsLocation1 } : {}),
        ...(header.PaymentTerms ? { PaymentTerms: header.PaymentTerms } : {}),
        to_PurchaseOrderItemTP: items.map((item, index) => {
            const formattedItemNo = formatItemNumber(item.PurchaseOrderItem, index);
            const formattedQty = formatQuantity(item.OrderQuantity);
            const formattedPrice = formatPriceAmount(item.NetPriceAmount);

            return {
                PurchaseOrderItem: formattedItemNo,
                Material: item.Material,
                Plant: item.Plant,
                OrderQuantity: formattedQty,
                PurchaseOrderQuantityUnit: item.UnitOfMeasure,
                NetPriceAmount: formattedPrice,
                RequisitionerName: item.RequisitionerName || defaultRequisitioner,
                ...(item.PurchaseOrderItemText ? { PurchaseOrderItemText: item.PurchaseOrderItemText } : {}),
                ...(item.StorageLocation ? { StorageLocation: item.StorageLocation } : {}),
                ...(item.MaterialGroup ? { MaterialGroup: item.MaterialGroup } : {}),
                ...(item.PurchaseOrderItemCategory ? { PurchaseOrderItemCategory: item.PurchaseOrderItemCategory } : {}),
                ...(item.AccountAssignmentCategory ? { AccountAssignmentCategory: item.AccountAssignmentCategory } : {}),
                ...(item.TaxCode ? { TaxCode: item.TaxCode } : {}),
                ...(item.NetAmount ? { NetAmount: String(item.NetAmount) } : {}),
                to_PurOrdScheduleLineTP: [
                    {
                        ScheduleLineOrderQuantity: formattedQty,
                        ...(poDateFormatted ? { ScheduleLineDeliveryDate: poDateFormatted } : {})
                    }
                ]
            };
        })
    };

    return payload;
}

module.exports = {
    formatDateToODataV2,
    formatQuantity,
    formatItemNumber,
    formatPriceAmount,
    mapToS4Payload
};
