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
    'SalesOfficeVH',
    'SalesGroupVH',
    'SoldToPartyVH',
    'CustomerVH',
    'MaterialVH',
    'CurrencyVH',
    'PlantVH'
];

const sdValueHelpConfig = [
    {
        entities: [
            'SalesOrganizationVH',
            'DistributionChannelVH',
            'DivisionVH',
            'SalesOfficeVH',
            'SalesGroupVH',
            'SoldToPartyVH',
            'CustomerVH',
            'CurrencyVH'
        ],
        read: (query) => salesInquiryAdapter.readWlData(query),
        entityDeduplicateBy: {
            CurrencyVH: 'Currency'
        }
    },
    {
        entities: ['SalesInquiryTypeVH'],
        read: (query) => salesInquiryAdapter.getInquiryTypes(query),
        entityDeduplicateBy: {
            SalesInquiryTypeVH: 'SalesDocumentType'
        }
    },
    {
        entities: ['MaterialVH'],
        read: (query) => salesInquiryAdapter.getMaterials(query),
        entityDeduplicateBy: {
            MaterialVH: 'Material'
        }
    },
    {
        entities: ['UnitOfMeasureVH'],
        read: (query) => purchaseOrderAdapter.readFsData(query)
    },
    {
        entities: ['PlantVH'],
        read: (query) => purchaseOrderAdapter.readMaintData(query),
        entityDeduplicateBy: {
            PlantVH: 'Plant'
        }
    }
];

module.exports = {
    sdValueHelpConfig,
    SD_VALUE_HELP_ENTITIES
};
