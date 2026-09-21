/**
 * Sales Document Domain Mapper (Inquiries & Orders)
 * Normalizes incoming CAP domain data into consistent business structures.
 */

const s4Config = require('../../../common/s4Config');

/**
 * Normalizes sales document domain data (Inquiry or Order).
 *
 * @param {Object} data - Raw payload { header, items }
 * @param {Object} options - Context options
 * @returns {{ header: Object, items: Array<Object> }}
 */
function normalizeSalesDocumentData(data, options = {}) {
    if (!data || typeof data !== 'object') return data;

    const rawHeader = data.header || {};
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const today = new Date().toISOString().split('T')[0];
    const defaultEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const defaultDelivery = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const currency = rawHeader.TransactionCurrency
        ? String(rawHeader.TransactionCurrency).trim().toUpperCase()
        : s4Config.getCurrency();

    let calculatedTotal = 0;

    const normalizedItems = rawItems.map((item, index) => {
        const rawItemNo = item.SalesOrderItem || item.SalesInquiryItem;
        const itemNumber = rawItemNo && String(rawItemNo).trim() !== ''
            ? String(rawItemNo).padStart(6, '0')
            : String((index + 1) * 10).padStart(6, '0');

        const qty = parseFloat(item.OrderQuantity) || 0;
        const price = parseFloat(item.NetPriceAmount) || 0;
        const net = item.NetAmount !== undefined && item.NetAmount !== null && item.NetAmount !== ''
            ? parseFloat(item.NetAmount)
            : (qty * price);

        calculatedTotal += net;

        const itemText = item.SalesOrderItemText || item.SalesInquiryItemText || '';

        return {
            SalesInquiryItem: itemNumber,
            SalesOrderItem: itemNumber,
            Material: String(item.Material || '').trim(),
            SalesInquiryItemText: itemText ? String(itemText).trim() : '',
            SalesOrderItemText: itemText ? String(itemText).trim() : '',
            OrderQuantity: qty,
            OrderQuantityUnit: (item.OrderQuantityUnit || item.SalesUnit || item.UnitOfMeasure || item.BaseUnit) ? String(item.OrderQuantityUnit || item.SalesUnit || item.UnitOfMeasure || item.BaseUnit).trim().toUpperCase() : '',
            NetPriceAmount: price,
            NetAmount: net,
            TransactionCurrency: currency,
            Plant: item.Plant ? String(item.Plant).trim().toUpperCase() : '',
            RequestedDeliveryDate: item.RequestedDeliveryDate ? String(item.RequestedDeliveryDate).trim() : (rawHeader.RequestedDeliveryDate ? String(rawHeader.RequestedDeliveryDate).trim() : defaultDelivery)
        };
    });

    const firstItemDesc = normalizedItems.length > 0 && (normalizedItems[0].SalesOrderItemText || normalizedItems[0].SalesInquiryItemText)
        ? (normalizedItems[0].SalesOrderItemText || normalizedItems[0].SalesInquiryItemText)
        : '';
    const poRef = rawHeader.PurchaseOrderNumber || rawHeader.PurchaseOrderByCustomer;
    const description = poRef ? String(poRef).trim() : firstItemDesc;

    const isOrder = Boolean(rawHeader.SalesOrderType || options.isOrder);
    const docType = isOrder
        ? (rawHeader.SalesOrderType ? String(rawHeader.SalesOrderType).trim() : s4Config.getOrderType())
        : (rawHeader.SalesInquiryType ? String(rawHeader.SalesInquiryType).trim() : s4Config.getInquiryType());

    const normalizedHeader = {
        SalesInquiryType: docType,
        SalesOrderType: docType,
        SalesOrganization: rawHeader.SalesOrganization ? String(rawHeader.SalesOrganization).trim() : s4Config.getSalesOrganization(),
        DistributionChannel: rawHeader.DistributionChannel ? String(rawHeader.DistributionChannel).trim() : s4Config.getDistributionChannel(),
        OrganizationDivision: rawHeader.OrganizationDivision ? String(rawHeader.OrganizationDivision).trim() : s4Config.getDivision(),
        SalesOffice: rawHeader.SalesOffice ? String(rawHeader.SalesOffice).trim() : '',
        SalesOfficeName: rawHeader.SalesOfficeName ? String(rawHeader.SalesOfficeName).trim() : '',
        SalesGroup: rawHeader.SalesGroup ? String(rawHeader.SalesGroup).trim() : '',
        SalesGroupName: rawHeader.SalesGroupName ? String(rawHeader.SalesGroupName).trim() : '',
        SoldToParty: rawHeader.SoldToParty ? String(rawHeader.SoldToParty).trim() : '',
        CustomerName: rawHeader.CustomerName ? String(rawHeader.CustomerName).trim() : '',
        ShipToParty: rawHeader.ShipToParty ? String(rawHeader.ShipToParty).trim() : (rawHeader.SoldToParty ? String(rawHeader.SoldToParty).trim() : ''),
        ShipToPartyName: rawHeader.ShipToPartyName ? String(rawHeader.ShipToPartyName).trim() : '',
        PurchaseOrderByCustomer: description,
        PurchaseOrderNumber: description,
        CustomerPurchaseOrderDate: rawHeader.CustomerPurchaseOrderDate || today,
        SalesInquiryDate: rawHeader.SalesInquiryDate || today,
        CreationDate: rawHeader.CreationDate || today,
        RequestedDeliveryDate: rawHeader.RequestedDeliveryDate || defaultDelivery,
        BindingPeriodValidityStartDate: rawHeader.BindingPeriodValidityStartDate || today,
        BindingPeriodValidityEndDate: rawHeader.BindingPeriodValidityEndDate || defaultEnd,
        TransactionCurrency: currency,
        TotalNetAmount: rawHeader.TotalNetAmount !== undefined && rawHeader.TotalNetAmount !== null
            ? parseFloat(rawHeader.TotalNetAmount)
            : calculatedTotal,
        // Commercial & logistics extension fields (SAP incompletion procedure Z1 / partner ZP)
        CustomerGroup2: rawHeader.CustomerGroup2 ? String(rawHeader.CustomerGroup2).trim().toUpperCase() : '',
        PortOfLoading: rawHeader.PortOfLoading ? String(rawHeader.PortOfLoading).trim() : '',
        PortOfDischarge: rawHeader.PortOfDischarge ? String(rawHeader.PortOfDischarge).trim() : '',
        ContactPerson: rawHeader.ContactPerson ? String(rawHeader.ContactPerson).trim() : ''
    };

    return {
        header: normalizedHeader,
        items: normalizedItems
    };
}

module.exports = {
    normalizeSalesDocumentData,
    normalizeSalesInquiryData: normalizeSalesDocumentData
};
