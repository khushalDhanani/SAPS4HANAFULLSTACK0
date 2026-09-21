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
function mapToS4InquiryPayload(header, items, _options = {}) {
    if (!header || typeof header !== 'object') {
        throw new Error('Header data is required for S/4HANA Sales Inquiry payload mapping');
    }

    if (!header.SalesInquiryType || String(header.SalesInquiryType).trim() === '') {
        throw new Error('SalesInquiryType is required for S/4HANA Sales Inquiry payload mapping');
    }
    if (!header.SalesOrganization || String(header.SalesOrganization).trim() === '') {
        throw new Error('SalesOrganization is required for S/4HANA Sales Inquiry payload mapping');
    }
    if (!header.DistributionChannel || String(header.DistributionChannel).trim() === '') {
        throw new Error('DistributionChannel is required for S/4HANA Sales Inquiry payload mapping');
    }
    if (!header.OrganizationDivision || String(header.OrganizationDivision).trim() === '') {
        throw new Error('OrganizationDivision is required for S/4HANA Sales Inquiry payload mapping');
    }
    if (!header.TransactionCurrency || String(header.TransactionCurrency).trim() === '') {
        throw new Error('TransactionCurrency is required for S/4HANA Sales Inquiry payload mapping');
    }

    const s4Header = {
        SalesInquiryType: String(header.SalesInquiryType).trim(),
        SalesOrganization: String(header.SalesOrganization).trim(),
        DistributionChannel: String(header.DistributionChannel).trim(),
        OrganizationDivision: String(header.OrganizationDivision).trim(),
        SalesOffice: String(header.SalesOffice || '').trim(),
        SalesGroup: String(header.SalesGroup || '').trim(),
        SoldToParty: String(header.SoldToParty || '').trim(),
        CustomerName: header.CustomerName ? String(header.CustomerName).trim() : '',
        PurchaseOrderByCustomer: header.PurchaseOrderByCustomer ? String(header.PurchaseOrderByCustomer).trim() : '',
        CustomerPurchaseOrderDate: header.CustomerPurchaseOrderDate ? String(header.CustomerPurchaseOrderDate).trim() : '',
        SalesInquiryDate: header.SalesInquiryDate ? String(header.SalesInquiryDate).trim() : '',
        BindingPeriodValidityStartDate: header.BindingPeriodValidityStartDate ? String(header.BindingPeriodValidityStartDate).trim() : '',
        BindingPeriodValidityEndDate: header.BindingPeriodValidityEndDate ? String(header.BindingPeriodValidityEndDate).trim() : '',
        TransactionCurrency: String(header.TransactionCurrency).trim().toUpperCase(),
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

        const itemUnit = item.OrderQuantityUnit || item.SalesUnit || item.UnitOfMeasure || item.BaseUnit;
        if (!itemUnit || !String(itemUnit).trim()) {
            throw new Error(`OrderQuantityUnit is required for item ${itemNumber}`);
        }
        const cleanUnit = String(itemUnit).trim().toUpperCase();

        const s4Item = {
            SalesInquiryItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesInquiryItemText: item.SalesInquiryItemText ? String(item.SalesInquiryItemText).trim() : '',
            OrderQuantity: String(parseFloat(item.OrderQuantity || 0).toFixed(3)),
            OrderQuantityUnit: cleanUnit,
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

    if (!header.SalesOrderType || String(header.SalesOrderType).trim() === '') {
        throw new Error('SalesOrderType is required for S/4HANA Sales Order payload mapping');
    }
    if (!header.SalesOrganization || String(header.SalesOrganization).trim() === '') {
        throw new Error('SalesOrganization is required for S/4HANA Sales Order payload mapping');
    }
    if (!header.DistributionChannel || String(header.DistributionChannel).trim() === '') {
        throw new Error('DistributionChannel is required for S/4HANA Sales Order payload mapping');
    }
    if (!header.OrganizationDivision || String(header.OrganizationDivision).trim() === '') {
        throw new Error('OrganizationDivision is required for S/4HANA Sales Order payload mapping');
    }
    if (!header.TransactionCurrency || String(header.TransactionCurrency).trim() === '') {
        throw new Error('TransactionCurrency is required for S/4HANA Sales Order payload mapping');
    }

    const s4Header = {
        SalesOrderType: String(header.SalesOrderType).trim(),
        SalesOrganization: String(header.SalesOrganization).trim(),
        DistributionChannel: String(header.DistributionChannel).trim(),
        OrganizationDivision: String(header.OrganizationDivision).trim(),
        SalesOffice: String(header.SalesOffice || '').trim(),
        SalesGroup: String(header.SalesGroup || '').trim(),
        SoldToParty: String(header.SoldToParty || '').trim(),
        CustomerName: header.CustomerName ? String(header.CustomerName).trim() : '',
        PurchaseOrderNumber: header.PurchaseOrderNumber || header.PurchaseOrderByCustomer || '',
        PurchaseOrderByCustomer: header.PurchaseOrderByCustomer || header.PurchaseOrderNumber || '',
        CustomerPurchaseOrderDate: header.CustomerPurchaseOrderDate ? String(header.CustomerPurchaseOrderDate).trim() : '',
        SalesOrderDate: header.SalesOrderDate ? String(header.SalesOrderDate).trim() : '',
        RequestedDeliveryDate: header.RequestedDeliveryDate ? String(header.RequestedDeliveryDate).trim() : '',
        TransactionCurrency: String(header.TransactionCurrency).trim().toUpperCase(),
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

        const itemUnit = item.OrderQuantityUnit || item.SalesUnit || item.UnitOfMeasure || item.BaseUnit;
        if (!itemUnit || !String(itemUnit).trim()) {
            throw new Error(`OrderQuantityUnit is required for item ${itemNumber}`);
        }
        const cleanUnit = String(itemUnit).trim().toUpperCase();

        const s4Item = {
            SalesOrderItem: itemNumber,
            SalesInquiryItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesOrderItemText: item.SalesOrderItemText || item.SalesInquiryItemText ? String(item.SalesOrderItemText || item.SalesInquiryItemText).trim() : '',
            OrderQuantity: String(parseFloat(item.OrderQuantity || 0).toFixed(3)),
            OrderQuantityUnit: cleanUnit,
            NetPriceAmount: item.NetPriceAmount !== undefined ? String(parseFloat(item.NetPriceAmount || 0).toFixed(2)) : '0.00',
            NetAmount: item.NetAmount !== undefined ? String(parseFloat(item.NetAmount || 0).toFixed(2)) : '0.00',
            TransactionCurrency: s4Header.TransactionCurrency,
            RequestedDeliveryDate: item.RequestedDeliveryDate ? String(item.RequestedDeliveryDate).trim() : (s4Header.RequestedDeliveryDate || '')
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
