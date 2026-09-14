const { sdValueHelpConfig, SD_VALUE_HELP_ENTITIES } = require('../../../srv/sd/sales-inquiry/handlers/valueHelp.config');

describe('Unit: Sales Inquiry Value Help Configuration', () => {
    test('should register all standard Sales Inquiry VH entities', () => {
        expect(SD_VALUE_HELP_ENTITIES).toContain('SalesInquiryTypeVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('SalesOrganizationVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('DistributionChannelVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('DivisionVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('SoldToPartyVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('CustomerVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('MaterialVH');
        expect(SD_VALUE_HELP_ENTITIES).toContain('CurrencyVH');
    });

    test('should include UnitOfMeasureVH in sdValueHelpConfig pointing to S/4HANA PO FS service', () => {
        const uomConfig = sdValueHelpConfig.find(cfg => cfg.entities.includes('UnitOfMeasureVH'));
        expect(uomConfig).toBeDefined();
        expect(typeof uomConfig.read).toBe('function');
    });

    test('should include SD WL entities in sdValueHelpConfig pointing to readWlData', () => {
        const wlConfig = sdValueHelpConfig.find(cfg => cfg.entities.includes('SalesOrganizationVH'));
        expect(wlConfig).toBeDefined();
        expect(typeof wlConfig.read).toBe('function');
    });

    test('should include SalesInquiryTypeVH in sdValueHelpConfig with dedicated getInquiryTypes reader and deduplication', () => {
        const typeConfig = sdValueHelpConfig.find(cfg => cfg.entities.includes('SalesInquiryTypeVH'));
        expect(typeConfig).toBeDefined();
        expect(typeof typeConfig.read).toBe('function');
        expect(typeConfig.entityDeduplicateBy).toEqual({
            SalesInquiryTypeVH: 'SalesDocumentType'
        });
    });
});
