/**
 * purchaseOrder.mapper
 * Handles CAP domain-level normalization and business mapping for Purchase Orders.
 */

/**
 * Normalizes and sanitizes incoming Purchase Order creation data at the CAP domain level.
 * Derives the default requisitioner from the authenticated user context rather than a static string.
 *
 * @param {Object} data
 * @param {Object} data.header
 * @param {Array<Object>} data.items
 * @param {Object} [context] - Execution context containing authenticated user
 * @param {string} [context.user] - Authenticated user identity (e.g., from req.user)
 * @returns {{ header: Object, items: Array<Object> }}
 */
function normalizePurchaseOrderData(data, context = {}) {
    if (!data || !data.header || !Array.isArray(data.items)) {
        return data;
    }

    const defaultRequisitioner = (context.user && String(context.user).trim() !== '')
        ? String(context.user).trim()
        : 'SYSTEM';

    if (!data.header.PurchaseOrderType || String(data.header.PurchaseOrderType).trim() === '') {
        throw new Error('PurchaseOrderType (Document Type) is required');
    }

    const header = {
        PurchaseOrderType: String(data.header.PurchaseOrderType).trim().toUpperCase(),
        CompanyCode: String(data.header.CompanyCode || '').trim(),
        PurchasingOrganization: String(data.header.PurchasingOrganization || '').trim(),
        PurchasingGroup: String(data.header.PurchasingGroup || '').trim(),
        Supplier: String(data.header.Supplier || '').trim(),
        Currency: String(data.header.Currency || '').trim().toUpperCase(),
        DocumentDate: data.header.DocumentDate ? String(data.header.DocumentDate).trim() : new Date().toISOString().split('T')[0],
        IncotermsClassification: data.header.IncotermsClassification ? String(data.header.IncotermsClassification).trim() : undefined,
        IncotermsLocation1: data.header.IncotermsLocation1 ? String(data.header.IncotermsLocation1).trim() : undefined,
        PaymentTerms: data.header.PaymentTerms ? String(data.header.PaymentTerms).trim() : undefined
    };

    const items = data.items.map((item, index) => {
        const itemNo = item.PurchaseOrderItem ? String(item.PurchaseOrderItem).trim() : String((index + 1) * 10);
        if (item.OrderQuantity === undefined || item.OrderQuantity === null || String(item.OrderQuantity).trim() === '') {
            throw new Error(`OrderQuantity is required for item ${itemNo}`);
        }
        const qty = Number(item.OrderQuantity);
        if (isNaN(qty) || qty <= 0) {
            throw new Error(`OrderQuantity must be greater than 0 for item ${itemNo}`);
        }
        const price = Number(item.NetPriceAmount) || 0;
        const calculatedNetAmount = (qty * price).toFixed(2);
        // Requisitioner identity must be strictly owned by the server's authenticated context
        // to protect the audit trail and prevent client-side impersonation.
        const itemRequisitioner = defaultRequisitioner;

        const rawUnit = item.UnitOfMeasure || item.OrderQuantityUnit || item.BaseUnit || item.Unit;
        if (!rawUnit || String(rawUnit).trim() === '') {
            throw new Error(`UnitOfMeasure is required for item ${itemNo}`);
        }
        const unitOfMeasure = String(rawUnit).trim().toUpperCase();

        return {
            PurchaseOrderItem: itemNo,
            Material: String(item.Material || '').trim(),
            Plant: String(item.Plant || '').trim(),
            StorageLocation: item.StorageLocation ? String(item.StorageLocation).trim() : undefined,
            OrderQuantity: String(item.OrderQuantity).trim(),
            UnitOfMeasure: unitOfMeasure,
            NetPriceAmount: price.toFixed(2),
            NetAmount: calculatedNetAmount,
            RequisitionerName: itemRequisitioner,
            MaterialGroup: item.MaterialGroup ? String(item.MaterialGroup).trim() : undefined,
            PurchaseOrderItemCategory: item.PurchaseOrderItemCategory ? String(item.PurchaseOrderItemCategory).trim() : undefined,
            AccountAssignmentCategory: item.AccountAssignmentCategory ? String(item.AccountAssignmentCategory).trim() : undefined,
            TaxCode: item.TaxCode ? String(item.TaxCode).trim() : undefined
        };
    });

    return { header, items };
}

module.exports = {
    normalizePurchaseOrderData
};
