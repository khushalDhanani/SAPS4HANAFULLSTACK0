const registerValueHelpHandlers = require('../../../srv/handlers/valueHelp.handler');
const { poValueHelpConfig } = require('../../../srv/mm/purchase-order/handlers/valueHelp.config');
const { sdValueHelpConfig } = require('../../../srv/sd/sales-inquiry/handlers/valueHelp.config');

let ValueHelpService;

function MockFilter(path, operator, val1, val2) {
    this.sPath = path;
    this.sOperator = operator;
    this.oValue1 = val1;
    this.oValue2 = val2;
}

const MockFilterOperator = {
    Contains: "Contains",
    EQ: "EQ",
    BT: "BT"
};

function MockSelectDialog() {}
function MockStandardListItem() {}

const originalSap = global.sap;

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                if (deps.includes("sap/m/SelectDialog")) {
                    ValueHelpService = factory(MockFilter, MockFilterOperator, MockSelectDialog, MockStandardListItem);
                }
            }
        }
    };

    require('../../../app/fiori-app/webapp/service/ValueHelpService');
});

afterAll(() => {
    global.sap = originalSap;
});

describe('Unit: Value Help Deduplication and Context Scoping', () => {

    describe('1. Backend Entity-Specific Deduplication (valueHelp.handler.js)', () => {
        it('should deduplicate results by entity-specific key when entityDeduplicateBy is configured', async () => {
            const registeredHandlers = {};
            const mockSrv = {
                on: (event, entities, handler) => {
                    for (const ent of entities) {
                        registeredHandlers[ent] = handler;
                    }
                }
            };

            const sampleGroup = [{
                entities: ['PaymentTermsVH', 'CurrencyVH', 'OtherVH'],
                read: async () => [
                    { PaymentTerms: '0007', ValidityDays: '15' },
                    { PaymentTerms: '0007', ValidityDays: '31' },
                    { PaymentTerms: '0008', ValidityDays: '15' }
                ],
                entityDeduplicateBy: {
                    PaymentTermsVH: 'PaymentTerms',
                    CurrencyVH: 'Currency'
                }
            }];

            registerValueHelpHandlers(mockSrv, sampleGroup);

            expect(registeredHandlers['PaymentTermsVH']).toBeDefined();

            // Simulate CAP request for PaymentTermsVH
            const req = {
                target: { name: 'PurchaseOrderService.PaymentTermsVH' },
                query: {}
            };

            const results = await registeredHandlers['PaymentTermsVH'](req);

            expect(results.length).toBe(2);
            expect(results[0].PaymentTerms).toBe('0007');
            expect(results[1].PaymentTerms).toBe('0008');
        });

        it('should preserve results as-is for entities without deduplication', async () => {
            const registeredHandlers = {};
            const mockSrv = {
                on: (event, entities, handler) => {
                    for (const ent of entities) {
                        registeredHandlers[ent] = handler;
                    }
                }
            };

            const sampleGroup = [{
                entities: ['SupplierVH'],
                read: async () => [
                    { Supplier: '1110', CompanyCode: '1000' },
                    { Supplier: '1110', CompanyCode: '2000' }
                ],
                entityDeduplicateBy: {
                    PaymentTermsVH: 'PaymentTerms'
                }
            }];

            registerValueHelpHandlers(mockSrv, sampleGroup);

            const req = {
                target: { name: 'PurchaseOrderService.SupplierVH' },
                query: {}
            };

            const results = await registeredHandlers['SupplierVH'](req);

            // Genuinely distinct master records (different company codes) are preserved
            expect(results.length).toBe(2);
            expect(results[0].CompanyCode).toBe('1000');
            expect(results[1].CompanyCode).toBe('2000');
        });
    });

    describe('2. poValueHelpConfig and sdValueHelpConfig Registration', () => {
        it('poValueHelpConfig should configure deduplication for CurrencyVH, TaxCodeVH, and PaymentTermsVH', () => {
            expect(poValueHelpConfig).toBeDefined();
            const fsGroup = poValueHelpConfig[0];
            const maintGroup = poValueHelpConfig[1];

            expect(fsGroup.entityDeduplicateBy).toBeDefined();
            expect(fsGroup.entityDeduplicateBy.CurrencyVH).toBe('Currency');
            expect(fsGroup.entityDeduplicateBy.TaxCodeVH).toBe('TaxCode');

            expect(maintGroup.entityDeduplicateBy).toBeDefined();
            expect(maintGroup.entityDeduplicateBy.PaymentTermsVH).toBe('PaymentTerms');
        });

        it('sdValueHelpConfig should configure deduplication for CurrencyVH', () => {
            expect(sdValueHelpConfig).toBeDefined();
            const wlGroup = sdValueHelpConfig[0];

            expect(wlGroup.entityDeduplicateBy).toBeDefined();
            expect(wlGroup.entityDeduplicateBy.CurrencyVH).toBe('Currency');
        });
    });

    describe('3. ValueHelpService Configuration Audit', () => {
        it('should configure info columns for composite key value helps', () => {
            const supplierConf = ValueHelpService.getConfig('/SupplierVH');
            expect(supplierConf).toBeDefined();
            expect(supplierConf.info).toBe('CompanyCode');

            const plantConf = ValueHelpService.getConfig('/PlantVH');
            expect(plantConf).toBeDefined();
            expect(plantConf.info).toBe('PurchasingOrganization');

            const storLocConf = ValueHelpService.getConfig('/StorageLocationVH');
            expect(storLocConf).toBeDefined();
            expect(storLocConf.info).toBe('Plant');
        });
    });
});
