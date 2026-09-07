/**
 * Unit Tests for Configuration-Driven PO Creation Defaults & Supplier Derivations
 * Target:
 * - app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel.js
 * - app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService.js
 */

let PurchaseOrderModel;
let PurchaseOrderService;

function MockJSONModel(data) {
    this._data = JSON.parse(JSON.stringify(data || {}));
    this.getData = function () {
        return this._data;
    };
    this.getProperty = function (path) {
        if (!path) return undefined;
        const clean = path.startsWith("/") ? path.slice(1) : path;
        const parts = clean.split("/");
        let cur = this._data;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    };
    this.setProperty = function (path, val) {
        if (!path) return;
        const clean = path.startsWith("/") ? path.slice(1) : path;
        const parts = clean.split("/");
        let cur = this._data;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (cur[p] == null) {
                cur[p] = {};
            }
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = val;
    };
}

const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

const originalSap = global.sap;

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                if (deps.includes("sap/ui/model/json/JSONModel")) {
                    PurchaseOrderModel = factory(MockJSONModel);
                } else if (deps.includes("saps4hana/fiori/service/ODataClient")) {
                    PurchaseOrderService = factory(mockODataClient);
                }
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService');
});

afterAll(() => {
    global.sap = originalSap;
});

describe('Unit: Configuration-Driven PO Creation Defaults & Supplier Derivations', () => {

    const mockConfigData = {
        documentTypes: [
            { PurchasingDocumentType: 'NB', PurchasingDocumentType_Text: 'Standard PO' },
            { PurchasingDocumentType: 'ZDOM', PurchasingDocumentType_Text: 'Dom. Aether In.LTD.' },
            { PurchasingDocumentType: 'FO', PurchasingDocumentType_Text: 'Framework Order' }
        ],
        companyCodes: [
            { CompanyCode: '0001', CompanyCodeName: 'SAP SE' },
            { CompanyCode: '1000', CompanyCodeName: 'Aether Industries Limited' },
            { CompanyCode: '2000', CompanyCodeName: 'Aether Specialty Chem Ltd' }
        ],
        purchasingOrgs: [
            { PurchasingOrganization: 'AE01', PurchasingOrganizationName: 'Capital Goods', CompanyCode: '1000' },
            { PurchasingOrganization: 'AE02', PurchasingOrganizationName: 'RM & Packing', CompanyCode: '1000' },
            { PurchasingOrganization: 'AS01', PurchasingOrganizationName: 'Capital Goods', CompanyCode: '2000' }
        ],
        purchasingGroups: [
            { PurchasingGroup: '001', PurchasingGroupName: 'General Buyer' },
            { PurchasingGroup: '101', PurchasingGroupName: 'Procurement Team-E' }
        ]
    };

    describe('1. Document Date and Initial Model Initialization', () => {
        it('should initialize with userModified and configDerived maps', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            const oData = oModel.getData();

            expect(oData.userModified).toBeDefined();
            expect(oData.userModified.CompanyCode).toBe(false);
            expect(oData.userModified.PurchasingOrganization).toBe(false);
            expect(oData.userModified.Supplier).toBe(false);
            expect(oData.userModified.Currency).toBe(false);

            expect(oData.configDerived).toBeDefined();
            expect(oData.header.DocumentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('should ensure Document Date is Today when applying defaults', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/DocumentDate', '');

            const oReport = PurchaseOrderModel.applyConfigurationDefaults(oModel, mockConfigData);
            const sToday = new Date().toISOString().split('T')[0];

            expect(oModel.getProperty('/header/DocumentDate')).toBe(sToday);
            expect(oReport.applied.DocumentDate).toBe(sToday);
        });
    });

    describe('2. Company Code 1000 and Purchasing Org AE01 Validation-Gated Defaults', () => {
        it('should default Company Code = 1000 and Purchasing Organization = AE01 only when confirmed valid', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            const oReport = PurchaseOrderModel.applyConfigurationDefaults(oModel, mockConfigData);

            expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
            expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('AE01');
            expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZDOM');
            expect(oReport.applied.CompanyCode).toBe('1000');
            expect(oReport.applied.PurchasingOrganization).toBe('AE01');
            expect(oReport.unconfirmed).toHaveLength(0);
        });

        it('should NOT default Company Code = 1000 if 1000 is not in configuration', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            const unconfirmedConfig = {
                documentTypes: mockConfigData.documentTypes,
                companyCodes: [{ CompanyCode: '0001', CompanyCodeName: 'SAP SE' }], // 1000 absent
                purchasingOrgs: mockConfigData.purchasingOrgs,
                purchasingGroups: mockConfigData.purchasingGroups
            };

            const oReport = PurchaseOrderModel.applyConfigurationDefaults(oModel, unconfirmedConfig);

            expect(oModel.getProperty('/header/CompanyCode')).toBe('');
            expect(oReport.unconfirmed.some(msg => msg.includes('CompanyCode 1000'))).toBe(true);
        });

        it('should NOT default Purchasing Organization = AE01 if AE01 is not in configuration', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            const unconfirmedConfig = {
                documentTypes: mockConfigData.documentTypes,
                companyCodes: mockConfigData.companyCodes,
                purchasingOrgs: [{ PurchasingOrganization: '0001', CompanyCode: '0001' }], // AE01 absent
                purchasingGroups: mockConfigData.purchasingGroups
            };

            const oReport = PurchaseOrderModel.applyConfigurationDefaults(oModel, unconfirmedConfig);

            expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
            expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('');
            expect(oReport.unconfirmed.some(msg => msg.includes('Purchasing Organization AE01'))).toBe(true);
        });
    });

    describe('3. Document Type Driving Configuration', () => {
        it('should drive ZDOM as default document type when available in configuration', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            PurchaseOrderModel.applyConfigurationDefaults(oModel, mockConfigData);

            expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZDOM');
        });

        it('should preserve user-entered Document Type if user explicitly changed it', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/PurchaseOrderType', 'FO');
            PurchaseOrderModel.markUserModified(oModel, 'PurchaseOrderType', true);

            PurchaseOrderModel.applyConfigurationDefaults(oModel, mockConfigData);

            expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('FO');
        });
    });

    describe('4. Protection of User-Entered Values (Never Overwrite Unexpectedly)', () => {
        it('should never overwrite user-entered Company Code', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/CompanyCode', '2000');
            PurchaseOrderModel.markUserModified(oModel, 'CompanyCode', true);

            const oReport = PurchaseOrderModel.applyConfigurationDefaults(oModel, mockConfigData);

            expect(oModel.getProperty('/header/CompanyCode')).toBe('2000');
            expect(oReport.skippedDueToUser.CompanyCode).toBe('2000');
        });

        it('should never overwrite user-entered Purchasing Organization', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/PurchasingOrganization', 'AS01');
            PurchaseOrderModel.markUserModified(oModel, 'PurchasingOrganization', true);

            const oReport = PurchaseOrderModel.applyConfigurationDefaults(oModel, mockConfigData);

            expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('AS01');
            expect(oReport.skippedDueToUser.PurchasingOrganization).toBe('AS01');
        });

        it('should never overwrite user-entered Currency during supplier derivation', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/Currency', 'USD');
            PurchaseOrderModel.markUserModified(oModel, 'Currency', true);

            const oDefaults = {
                Currency: 'INR',
                PaymentTerms: 'AT01',
                IncotermsClassification: 'CIF',
                IncotermsLocation1: 'MUMBAI'
            };

            const oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, '100518', oDefaults);

            expect(oModel.getProperty('/header/Currency')).toBe('USD');
            expect(oReport.preserved.Currency).toBe('USD');
            expect(oModel.getProperty('/header/PaymentTerms')).toBe('AT01');
            expect(oModel.getProperty('/header/IncotermsClassification')).toBe('CIF');
            expect(oModel.getProperty('/header/IncotermsLocation1')).toBe('MUMBAI');
        });

        it('should never overwrite user-entered Payment Terms during supplier derivation', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/PaymentTerms', '0002');
            PurchaseOrderModel.markUserModified(oModel, 'PaymentTerms', true);

            const oDefaults = {
                Currency: 'INR',
                PaymentTerms: 'AT01'
            };

            const oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, '100102', oDefaults);

            expect(oModel.getProperty('/header/PaymentTerms')).toBe('0002');
            expect(oReport.preserved.PaymentTerms).toBe('0002');
            expect(oModel.getProperty('/header/Currency')).toBe('INR');
        });
    });

    describe('5. Supplier Selection Derivation & Never Inventing Defaults', () => {
        it('should derive complete configured terms for a supplier with full master data', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            const oDefaults = {
                Currency: 'INR',
                PaymentTerms: 'AT01',
                IncotermsClassification: 'CIF',
                IncotermsLocation1: 'SURAT',
                derived: true
            };

            const oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, '100518', oDefaults);

            expect(oModel.getProperty('/header/Currency')).toBe('INR');
            expect(oModel.getProperty('/header/PaymentTerms')).toBe('AT01');
            expect(oModel.getProperty('/header/IncotermsClassification')).toBe('CIF');
            expect(oModel.getProperty('/header/IncotermsLocation1')).toBe('SURAT');
            expect(oReport.applied.Currency).toBe('INR');
            expect(oReport.applied.PaymentTerms).toBe('AT01');
        });

        it('should never invent defaults when supplier has missing commercial terms', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            // Supplier only has Currency, no Incoterms or PaymentTerms in master data
            const oDefaults = {
                Currency: 'INR',
                PaymentTerms: '',
                IncotermsClassification: '',
                IncotermsLocation1: '',
                derived: true
            };

            const oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, '100004', oDefaults);

            expect(oModel.getProperty('/header/Currency')).toBe('INR');
            expect(oModel.getProperty('/header/PaymentTerms')).toBe('');
            expect(oModel.getProperty('/header/IncotermsClassification')).toBe('');
            expect(oModel.getProperty('/header/IncotermsLocation1')).toBe('');
            // Never invented!
            expect(oReport.missing).toContain('PaymentTerms');
        });

        it('should show clear validation when Currency or Payment Terms cannot be derived', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            // Completely unconfigured supplier
            const oDefaults = {
                Currency: '',
                PaymentTerms: '',
                derived: false
            };

            const oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, 'NEW_SUPPLIER', oDefaults);

            expect(oReport.missing).toContain('Currency');
            expect(oReport.missing).toContain('PaymentTerms');

            const oCurrencyError = oModel.getProperty('/errors/Currency');
            expect(oCurrencyError.state).toBe('Information');
            expect(oCurrencyError.text).toMatch(/could not be derived/i);

            const oPayTermsError = oModel.getProperty('/errors/PaymentTerms');
            expect(oPayTermsError.state).toBe('Information');
            expect(oPayTermsError.text).toMatch(/No payment terms configured/i);
        });

        it('should enforce Incoterms Location 1 error when Incoterms is specified without location', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            const oDefaults = {
                Currency: 'INR',
                IncotermsClassification: 'EXW',
                IncotermsLocation1: ''
            };

            PurchaseOrderModel.deriveSupplierDefaults(oModel, '101360', oDefaults);

            const oIncoLocError = oModel.getProperty('/errors/IncotermsLocation1');
            expect(oIncoLocError.state).toBe('Error');
            expect(oIncoLocError.text).toMatch(/Incoterms Location 1 is required/i);
        });
    });

    describe('6. Cross-Field Company Code vs Purchasing Organization Dependency', () => {
        it('should pass validation when Purchasing Org belongs to Company Code', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/CompanyCode', '1000');
            oModel.setProperty('/header/PurchasingOrganization', 'AE01');

            const oResult = PurchaseOrderModel.validateCompanyCodePurchasingOrg(oModel, mockConfigData);

            expect(oResult.isValid).toBe(true);
        });

        it('should fail validation and set Error state when Purchasing Org belongs to different Company Code', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
            oModel.setProperty('/header/CompanyCode', '1000');
            oModel.setProperty('/header/PurchasingOrganization', 'AS01'); // AS01 belongs to 2000

            const oResult = PurchaseOrderModel.validateCompanyCodePurchasingOrg(oModel, mockConfigData);

            expect(oResult.isValid).toBe(false);
            expect(oResult.message).toMatch(/belongs to Company Code 2000, not 1000/i);

            const oOrgError = oModel.getProperty('/errors/PurchasingOrganization');
            expect(oOrgError.state).toBe('Error');
        });
    });

    describe('7. PurchaseOrderService loadConfiguration and getSupplierDefaults', () => {
        it('loadConfiguration should aggregate all value help collections', async () => {
            mockODataClient.get.mockImplementation(async (url) => {
                if (url.includes('/DocumentTypeVH')) return { value: mockConfigData.documentTypes };
                if (url.includes('/CompanyCodeVH')) return { value: mockConfigData.companyCodes };
                if (url.includes('/PurchasingOrgVH')) return { value: mockConfigData.purchasingOrgs };
                if (url.includes('/PurchasingGroupVH')) return { value: mockConfigData.purchasingGroups };
                return { value: [] };
            });

            const config = await PurchaseOrderService.loadConfiguration();

            expect(config.documentTypes).toHaveLength(3);
            expect(config.companyCodes).toHaveLength(3);
            expect(config.purchasingOrgs).toHaveLength(3);
            expect(config.purchasingGroups).toHaveLength(2);
        });

        it('getSupplierDefaults should return supplier defaults from API function', async () => {
            mockODataClient.get.mockResolvedValueOnce({
                value: {
                    Supplier: '100518',
                    Currency: 'INR',
                    PaymentTerms: 'AT01',
                    IncotermsClassification: 'CIF',
                    IncotermsLocation1: 'SURAT',
                    derived: true
                }
            });

            const defaults = await PurchaseOrderService.getSupplierDefaults('100518', '1000', 'AE01');

            expect(defaults.Supplier).toBe('100518');
            expect(defaults.Currency).toBe('INR');
            expect(defaults.PaymentTerms).toBe('AT01');
            expect(defaults.IncotermsClassification).toBe('CIF');
            expect(defaults.derived).toBe(true);
        });

        it('getSupplierDefaults should gracefully fall back to empty when unconfigured', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Network error'));

            const defaults = await PurchaseOrderService.getSupplierDefaults('UNKNOWN', '1000', 'AE01');

            expect(defaults.Supplier).toBe('UNKNOWN');
            expect(defaults.Currency).toBe('');
            expect(defaults.PaymentTerms).toBe('');
            expect(defaults.derived).toBe(false);
        });
    });

});
