const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const purchaseOrderAdapter = require('../../../integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');

/**
 * Sales Order Value Help entity mappings against SD_F1873_SO_WL_SRV, SD_F2370_INQY_WL_SRV, and MM_PUR_PO_MAINT_V2_SRV
 */
const SO_VALUE_HELP_ENTITIES = [
    'SalesOrderTypeVH',
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

const soValueHelpConfig = [
    {
        entities: ['SalesOrderTypeVH'],
        read: (query) => salesInquiryAdapter.readSoData(query),
        entityDeduplicateBy: {
            SalesOrderTypeVH: 'SalesOrderType'
        }
    },
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
    soValueHelpConfig,
    SO_VALUE_HELP_ENTITIES
};
