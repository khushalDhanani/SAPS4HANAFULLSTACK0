/**
 * SalesInquiryMapper
 * Maps between CAP Sales Inquiry domain representations and SAP S/4HANA OData technical payloads.
 */

const s4Config = require('../../s4Config');

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
        SalesInquiryType: String(header.SalesInquiryType || s4Config.getInquiryType()).trim(),
        SalesOrganization: String(header.SalesOrganization || s4Config.getSalesOrganization()).trim(),
        DistributionChannel: String(header.DistributionChannel || s4Config.getDistributionChannel()).trim(),
        OrganizationDivision: String(header.OrganizationDivision || s4Config.getDivision()).trim(),
        SalesOffice: String(header.SalesOffice || '').trim(),
        SalesGroup: String(header.SalesGroup || '').trim(),
        SoldToParty: String(header.SoldToParty || '').trim(),
        CustomerName: header.CustomerName ? String(header.CustomerName).trim() : '',
        PurchaseOrderByCustomer: header.PurchaseOrderByCustomer ? String(header.PurchaseOrderByCustomer).trim() : '',
        CustomerPurchaseOrderDate: header.CustomerPurchaseOrderDate || today,
        SalesInquiryDate: header.SalesInquiryDate || today,
        BindingPeriodValidityStartDate: header.BindingPeriodValidityStartDate || today,
        BindingPeriodValidityEndDate: header.BindingPeriodValidityEndDate || today,
        TransactionCurrency: String(header.TransactionCurrency || s4Config.getCurrency()).trim().toUpperCase(),
        TotalNetAmount: header.TotalNetAmount !== undefined ? String(header.TotalNetAmount) : '0.00'
    };

    if (header.ShipToParty) {
        s4Header.ShipToParty = String(header.ShipToParty).trim();
    }
    if (header.ShipToPartyName) {
        s4Header.ShipToPartyName = String(header.ShipToPartyName).trim();
    }
    // Commercial & logistics extension fields: passed through when present, never defaulted
    ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'].forEach(field => {
        if (header[field] && String(header[field]).trim() !== '') {
            s4Header[field] = String(header[field]).trim();
        }
    });

    const s4Items = (items || []).map((item, index) => {
        const itemNumber = item.SalesInquiryItem
            ? String(item.SalesInquiryItem).padStart(6, '0')
            : String((index + 1) * 10).padStart(6, '0');

        const s4Item = {
            SalesInquiryItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesInquiryItemText: item.SalesInquiryItemText ? String(item.SalesInquiryItemText).trim() : '',
            OrderQuantity: String(parseFloat(item.OrderQuantity || 0).toFixed(3)),
            OrderQuantityUnit: String(item.OrderQuantityUnit || 'PC').trim().toUpperCase(),
            NetPriceAmount: item.NetPriceAmount !== undefined ? String(parseFloat(item.NetPriceAmount || 0).toFixed(2)) : '0.00',
            NetAmount: item.NetAmount !== undefined ? String(parseFloat(item.NetAmount || 0).toFixed(2)) : '0.00',
            TransactionCurrency: s4Header.TransactionCurrency
        };
        if (item.Plant && String(item.Plant).trim() !== '') {
            s4Item.Plant = String(item.Plant).trim().toUpperCase();
        }
        return s4Item;
    });

    return {
        header: s4Header,
        items: s4Items
    };
}

/**
 * Maps CAP domain payload to S/4HANA Order structure.
 *
 * @param {Object} header - Domain header
 * @param {Array<Object>} items - Domain items
 * @param {Object} options - User and execution options
 * @returns {Object} S/4HANA compliant OData payload
 */
function mapToS4OrderPayload(header, items, _options = {}) {
    if (!header || typeof header !== 'object') {
        throw new Error('Header data is required for S/4HANA Sales Order payload mapping');
    }

    const today = new Date().toISOString().split('T')[0];
    const defaultDelivery = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const s4Header = {
        SalesOrderType: String(header.SalesOrderType || s4Config.getOrderType()).trim(),
        SalesOrganization: String(header.SalesOrganization || s4Config.getSalesOrganization()).trim(),
        DistributionChannel: String(header.DistributionChannel || s4Config.getDistributionChannel()).trim(),
        OrganizationDivision: String(header.OrganizationDivision || s4Config.getDivision()).trim(),
        SalesOffice: String(header.SalesOffice || '').trim(),
        SalesGroup: String(header.SalesGroup || '').trim(),
        SoldToParty: String(header.SoldToParty || '').trim(),
        CustomerName: header.CustomerName ? String(header.CustomerName).trim() : '',
        PurchaseOrderNumber: header.PurchaseOrderNumber || header.PurchaseOrderByCustomer || '',
        PurchaseOrderByCustomer: header.PurchaseOrderByCustomer || header.PurchaseOrderNumber || '',
        CustomerPurchaseOrderDate: header.CustomerPurchaseOrderDate || today,
        SalesOrderDate: header.SalesOrderDate || today,
        RequestedDeliveryDate: header.RequestedDeliveryDate || defaultDelivery,
        TransactionCurrency: String(header.TransactionCurrency || s4Config.getCurrency()).trim().toUpperCase(),
        TotalNetAmount: header.TotalNetAmount !== undefined ? String(header.TotalNetAmount) : '0.00'
    };

    if (header.ShipToParty) {
        s4Header.ShipToParty = String(header.ShipToParty).trim();
    }
    if (header.ShipToPartyName) {
        s4Header.ShipToPartyName = String(header.ShipToPartyName).trim();
    }

    ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'].forEach(field => {
        if (header[field] && String(header[field]).trim() !== '') {
            s4Header[field] = String(header[field]).trim();
        }
    });

    const s4Items = (items || []).map((item, index) => {
        const itemNumber = item.SalesOrderItem || item.SalesInquiryItem
            ? String(item.SalesOrderItem || item.SalesInquiryItem).padStart(6, '0')
            : String((index + 1) * 10).padStart(6, '0');

        const s4Item = {
            SalesOrderItem: itemNumber,
            SalesInquiryItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesOrderItemText: item.SalesOrderItemText || item.SalesInquiryItemText ? String(item.SalesOrderItemText || item.SalesInquiryItemText).trim() : '',
            OrderQuantity: String(parseFloat(item.OrderQuantity || 0).toFixed(3)),
            OrderQuantityUnit: String(item.OrderQuantityUnit || 'PC').trim().toUpperCase(),
            NetPriceAmount: item.NetPriceAmount !== undefined ? String(parseFloat(item.NetPriceAmount || 0).toFixed(2)) : '0.00',
            NetAmount: item.NetAmount !== undefined ? String(parseFloat(item.NetAmount || 0).toFixed(2)) : '0.00',
            TransactionCurrency: s4Header.TransactionCurrency,
            RequestedDeliveryDate: item.RequestedDeliveryDate || s4Header.RequestedDeliveryDate
        };
        if (item.Plant && String(item.Plant).trim() !== '') {
            s4Item.Plant = String(item.Plant).trim().toUpperCase();
        }
        return s4Item;
    });

    return {
        header: s4Header,
        items: s4Items
    };
}

module.exports = {
    mapToS4InquiryPayload,
    mapToS4OrderPayload,
    mapToS4DocumentPayload: (header, items, options = {}) => {
        return (header?.SalesOrderType && !header?.SalesInquiryType)
            ? mapToS4OrderPayload(header, items, options)
            : mapToS4InquiryPayload(header, items, options);
    }
};
