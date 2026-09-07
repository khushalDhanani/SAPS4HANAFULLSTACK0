const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const purchaseOrderAdapter = require('../../../integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');

/**
 * Sales Inquiry Value Help entity mappings against SD_F2370_INQY_WL_SRV and MM_PUR_PO_MAINT_V2_SRV
 */
const SD_VALUE_HELP_ENTITIES = [
    'SalesInquiryTypeVH',
    'SalesOrganizationVH',
    'DistributionChannelVH',
    'DivisionVH',
    'SoldToPartyVH',
    'CustomerVH',
    'MaterialVH',
    'CurrencyVH'
];

const sdValueHelpConfig = [
    {
        entities: [
            'SalesInquiryTypeVH',
            'SalesOrganizationVH',
            'DistributionChannelVH',
            'DivisionVH',
            'SoldToPartyVH',
            'CustomerVH',
            'CurrencyVH'
        ],
        read: (query) => salesInquiryAdapter.readWlData(query)
    },
    {
        entities: ['MaterialVH'],
        read: (query) => salesInquiryAdapter.readFsData(query)
    },
    {
        entities: ['UnitOfMeasureVH'],
        read: (query) => purchaseOrderAdapter.readFsData(query)
    }
];

module.exports = {
    sdValueHelpConfig,
    SD_VALUE_HELP_ENTITIES
};
