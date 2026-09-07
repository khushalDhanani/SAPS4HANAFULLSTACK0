/**
 * SalesInquiryMapper
 * Maps between CAP Sales Inquiry domain representations and SAP S/4HANA OData technical payloads.
 */

/**
 * Maps CAP domain payload to S/4HANA Inquiry structure.
 *
 * @param {Object} header - Domain header
 * @param {Array<Object>} items - Domain items
 * @param {Object} options - User and execution options
 * @returns {Object} S/4HANA compliant OData payload
 */
function mapToS4InquiryPayload(header, items, options = {}) {
    if (!header || typeof header !== 'object') {
        throw new Error('Header data is required for S/4HANA Sales Inquiry payload mapping');
    }

    const today = new Date().toISOString().split('T')[0];

    const s4Header = {
        SalesInquiryType: String(header.SalesInquiryType || 'ZIN').trim(),
        SalesOrganization: String(header.SalesOrganization || '1000').trim(),
        DistributionChannel: String(header.DistributionChannel || '10').trim(),
        OrganizationDivision: String(header.OrganizationDivision || '52').trim(),
        SoldToParty: String(header.SoldToParty || '').trim(),
        PurchaseOrderByCustomer: header.PurchaseOrderByCustomer ? String(header.PurchaseOrderByCustomer).trim() : '',
        CustomerPurchaseOrderDate: header.CustomerPurchaseOrderDate || today,
        SalesInquiryDate: header.SalesInquiryDate || today,
        BindingPeriodValidityStartDate: header.BindingPeriodValidityStartDate || today,
        BindingPeriodValidityEndDate: header.BindingPeriodValidityEndDate || today,
        TransactionCurrency: String(header.TransactionCurrency || 'INR').trim().toUpperCase()
    };

    if (header.ShipToParty) {
        s4Header.ShipToParty = String(header.ShipToParty).trim();
    }

    const s4Items = (items || []).map((item, index) => {
        const itemNumber = item.SalesInquiryItem
            ? String(item.SalesInquiryItem).padStart(6, '0')
            : String((index + 1) * 10).padStart(6, '0');

        return {
            SalesInquiryItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesInquiryItemText: item.SalesInquiryItemText ? String(item.SalesInquiryItemText).trim() : '',
            OrderQuantity: String(parseFloat(item.OrderQuantity || 0).toFixed(3)),
            OrderQuantityUnit: String(item.OrderQuantityUnit || 'PC').trim().toUpperCase(),
            NetPriceAmount: item.NetPriceAmount !== undefined ? String(parseFloat(item.NetPriceAmount || 0).toFixed(2)) : '0.00',
            NetAmount: item.NetAmount !== undefined ? String(parseFloat(item.NetAmount || 0).toFixed(2)) : '0.00',
            TransactionCurrency: s4Header.TransactionCurrency
        };
    });

    return {
        header: s4Header,
        items: s4Items
    };
}

module.exports = {
    mapToS4InquiryPayload
};
