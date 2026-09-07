const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

/**
 * Sales Inquiry Value Help entity mappings against SD_F2370_INQY_WL_SRV
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
        entities: SD_VALUE_HELP_ENTITIES,
        read: (query) => salesInquiryAdapter.readWlData(query)
    }
];

module.exports = {
    sdValueHelpConfig,
    SD_VALUE_HELP_ENTITIES
};
