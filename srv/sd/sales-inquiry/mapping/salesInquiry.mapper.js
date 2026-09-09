/**
 * Sales Inquiry Domain Mapper
 * Normalizes incoming CAP domain data into consistent business structures.
 */

/**
 * Normalizes sales inquiry domain data.
 *
 * @param {Object} data - Raw payload { header, items }
 * @param {Object} options - Context options
 * @returns {{ header: Object, items: Array<Object> }}
 */
function normalizeSalesInquiryData(data, options = {}) {
    if (!data || typeof data !== 'object') return data;

    const rawHeader = data.header || {};
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const today = new Date().toISOString().split('T')[0];
    const defaultEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const currency = rawHeader.TransactionCurrency
        ? String(rawHeader.TransactionCurrency).trim().toUpperCase()
        : 'INR';

    let calculatedTotal = 0;

    const normalizedItems = rawItems.map((item, index) => {
        const itemNumber = item.SalesInquiryItem && String(item.SalesInquiryItem).trim() !== ''
            ? String(item.SalesInquiryItem).padStart(6, '0')
            : String((index + 1) * 10).padStart(6, '0');

        const qty = parseFloat(item.OrderQuantity) || 0;
        const price = parseFloat(item.NetPriceAmount) || 0;
        const net = item.NetAmount !== undefined && item.NetAmount !== null && item.NetAmount !== ''
            ? parseFloat(item.NetAmount)
            : (qty * price);

        calculatedTotal += net;

        return {
            SalesInquiryItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesInquiryItemText: item.SalesInquiryItemText ? String(item.SalesInquiryItemText).trim() : '',
            OrderQuantity: qty,
            OrderQuantityUnit: item.OrderQuantityUnit ? String(item.OrderQuantityUnit).trim().toUpperCase() : 'PC',
            NetPriceAmount: price,
            NetAmount: net,
            TransactionCurrency: currency
        };
    });

    const firstItemDesc = normalizedItems.length > 0 && normalizedItems[0].SalesInquiryItemText
        ? normalizedItems[0].SalesInquiryItemText
        : '';
    const description = rawHeader.PurchaseOrderByCustomer
        ? String(rawHeader.PurchaseOrderByCustomer).trim()
        : firstItemDesc;

    const normalizedHeader = {
        SalesInquiryType: rawHeader.SalesInquiryType ? String(rawHeader.SalesInquiryType).trim() : 'ZIN',
        SalesOrganization: rawHeader.SalesOrganization ? String(rawHeader.SalesOrganization).trim() : '1000',
        DistributionChannel: rawHeader.DistributionChannel ? String(rawHeader.DistributionChannel).trim() : '10',
        OrganizationDivision: rawHeader.OrganizationDivision ? String(rawHeader.OrganizationDivision).trim() : '52',
        SoldToParty: rawHeader.SoldToParty ? String(rawHeader.SoldToParty).trim() : '',
        CustomerName: rawHeader.CustomerName ? String(rawHeader.CustomerName).trim() : '',
        ShipToParty: rawHeader.ShipToParty ? String(rawHeader.ShipToParty).trim() : (rawHeader.SoldToParty ? String(rawHeader.SoldToParty).trim() : ''),
        ShipToPartyName: rawHeader.ShipToPartyName ? String(rawHeader.ShipToPartyName).trim() : '',
        PurchaseOrderByCustomer: description,
        CustomerPurchaseOrderDate: rawHeader.CustomerPurchaseOrderDate || today,
        SalesInquiryDate: rawHeader.SalesInquiryDate || today,
        BindingPeriodValidityStartDate: rawHeader.BindingPeriodValidityStartDate || today,
        BindingPeriodValidityEndDate: rawHeader.BindingPeriodValidityEndDate || defaultEnd,
        TransactionCurrency: currency,
        TotalNetAmount: rawHeader.TotalNetAmount !== undefined && rawHeader.TotalNetAmount !== null
            ? parseFloat(rawHeader.TotalNetAmount)
            : calculatedTotal
    };

    return {
        header: normalizedHeader,
        items: normalizedItems
    };
}

module.exports = {
    normalizeSalesInquiryData
};
