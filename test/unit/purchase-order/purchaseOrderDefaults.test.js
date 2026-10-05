/**
 * Unit Tests for PurchaseOrderDefaults module
 */

const PurchaseOrderDefaults = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderDefaults');
const PurchaseOrderValidator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');

function createMockModel(data) {
    const oData = JSON.parse(JSON.stringify(data));
    return {
        getData: () => oData,
        getProperty: (path) => {
            const parts = path.replace(/^\//, '').split('/');
            let curr = oData;
            for (const p of parts) {
                if (curr === undefined || curr === null) return undefined;
                curr = curr[p];
            }
            return curr;
        },
        setProperty: (path, val) => {
            const parts = path.replace(/^\//, '').split('/');
            let curr = oData;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!curr[parts[i]]) curr[parts[i]] = {};
                curr = curr[parts[i]];
            }
            curr[parts[parts.length - 1]] = val;
        }
    };
}

describe('Unit: PurchaseOrderDefaults', () => {

    describe('getDefaultDocType', () => {
        it('should return matching configured type if present', () => {
            const config = {
                documentTypes: [
                    { PurchasingDocumentType: 'ZDOM', PurchasingDocumentType_Text: 'Domestic PO' },
                    { PurchasingDocumentType: 'NB', PurchasingDocumentType_Text: 'Standard PO' }
                ]
            };
            const result = PurchaseOrderDefaults.getDefaultDocType(config);
            expect(result.code).toBe('ZDOM');
            expect(result.text).toBe('Domestic PO');
        });

        it('should return fallback if config does not contain default', () => {
            const config = { documentTypes: [] };
            const result = PurchaseOrderDefaults.getDefaultDocType(config);
            expect(result.code).toBe('ZDOM');
            expect(result.text).toBe('Dom. Aether In.LTD.');
        });
    });

    describe('applyMaterialDefaults', () => {
        let oModel;

        beforeEach(() => {
            oModel = createMockModel({
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: '',
                        PurchaseOrderItemText: '',
                        UnitOfMeasure: '',
                        MaterialGroup: '',
                        Plant: '',
                        errors: {
                            Material: { state: 'Error', text: 'Required' },
                            UnitOfMeasure: { state: 'Error', text: 'Required' }
                        }
                    }
                ]
            });
        });

        it('should apply master data fields and clear validation errors on item', () => {
            const materialData = {
                Material: 'TG11',
                MaterialName: 'Polypropylene Resin',
                MaterialBaseUnit: 'PC',
                MaterialGroup: 'L001',
                Plant: '1010'
            };

            const report = PurchaseOrderDefaults.applyMaterialDefaults(oModel, 0, materialData);

            expect(report.Material).toBe('TG11');
            expect(report.PurchaseOrderItemText).toBe('Polypropylene Resin');
            expect(report.UnitOfMeasure).toBe('PC');
            expect(report.Plant).toBe('1010');

            expect(oModel.getProperty('/items/0/Material')).toBe('TG11');
            expect(oModel.getProperty('/items/0/PurchaseOrderItemText')).toBe('Polypropylene Resin');
            expect(oModel.getProperty('/items/0/UnitOfMeasure')).toBe('PC');
            expect(oModel.getProperty('/items/0/errors/Material/state')).toBe('None');
            expect(oModel.getProperty('/items/0/errors/UnitOfMeasure/state')).toBe('None');
        });

        it('should not overwrite existing description unless bForce is true', () => {
            oModel.setProperty('/items/0/PurchaseOrderItemText', 'User Custom Text');
            const materialData = {
                Material: 'TG11',
                MaterialName: 'Polypropylene Resin'
            };

            PurchaseOrderDefaults.applyMaterialDefaults(oModel, 0, materialData, false);
            expect(oModel.getProperty('/items/0/PurchaseOrderItemText')).toBe('User Custom Text');

            PurchaseOrderDefaults.applyMaterialDefaults(oModel, 0, materialData, true);
            expect(oModel.getProperty('/items/0/PurchaseOrderItemText')).toBe('Polypropylene Resin');
        });
    });

    describe('applyConfigurationDefaults', () => {
        let oModel;
        const mockConfigData = {
            documentTypes: [{ PurchasingDocumentType: 'ZDOM', PurchasingDocumentType_Text: 'Domestic PO' }],
            companyCodes: [{ CompanyCode: '1000' }],
            purchasingOrgs: [{ PurchasingOrganization: 'AE01', CompanyCode: '1000' }],
            purchasingGroups: [{ PurchasingGroup: '001' }]
        };

        beforeEach(() => {
            oModel = createMockModel({
                header: {
                    PurchaseOrderType: '',
                    CompanyCode: '',
                    PurchasingOrganization: '',
                    PurchasingGroup: '',
                    DocumentDate: ''
                },
                userModified: {},
                configDerived: {},
                errors: {}
            });
        });

        it('should derive default fields from valid configuration data', () => {
            const report = PurchaseOrderDefaults.applyConfigurationDefaults(
                oModel,
                mockConfigData,
                { code: 'ZDOM', text: 'Domestic PO' },
                PurchaseOrderValidator
            );

            expect(report.applied.PurchaseOrderType).toBe('ZDOM');
            expect(report.applied.CompanyCode).toBe('1000');
            expect(report.applied.PurchasingOrganization).toBe('AE01');
            expect(report.applied.PurchasingGroup).toBe('001');

            expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
            expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('AE01');
            expect(oModel.getProperty('/configDerived/CompanyCode')).toBe(true);
        });

        it('should prioritize 100-series (101 Procurement Team-E) over 001 when defaulting Purchasing Group', () => {
            const configWith100 = {
                ...mockConfigData,
                purchasingGroups: [
                    { PurchasingGroup: '001', PurchasingGroupName: 'General Buyer' },
                    { PurchasingGroup: '101', PurchasingGroupName: 'Procurement Team-E' }
                ]
            };

            const report = PurchaseOrderDefaults.applyConfigurationDefaults(
                oModel,
                configWith100,
                { code: 'ZDOM', text: 'Domestic PO' },
                PurchaseOrderValidator
            );

            expect(report.applied.PurchasingGroup).toBe('101');
            expect(oModel.getProperty('/header/PurchasingGroup')).toBe('101');
        });

        it('should preserve user modified fields from being overwritten', () => {
            oModel.setProperty('/header/CompanyCode', '2000');
            oModel.setProperty('/userModified/CompanyCode', true);

            const report = PurchaseOrderDefaults.applyConfigurationDefaults(
                oModel,
                mockConfigData,
                { code: 'ZDOM', text: 'Domestic PO' },
                PurchaseOrderValidator
            );

            expect(report.skippedDueToUser.CompanyCode).toBe('2000');
            expect(oModel.getProperty('/header/CompanyCode')).toBe('2000');
        });
    });

    describe('deriveSupplierDefaults', () => {
        let oModel;

        beforeEach(() => {
            oModel = createMockModel({
                header: {
                    Supplier: '10300001',
                    Currency: '',
                    PaymentTerms: '',
                    IncotermsClassification: '',
                    IncotermsLocation1: ''
                },
                userModified: {},
                configDerived: {},
                errors: {}
            });
        });

        it('should derive commercial terms from supplier defaults', () => {
            const supplierDefaults = {
                Currency: 'USD',
                PaymentTerms: '0001',
                IncotermsClassification: 'FOB',
                IncotermsLocation1: 'NEW YORK',
                lastPurchaseOrder: '4500000001'
            };

            const report = PurchaseOrderDefaults.deriveSupplierDefaults(
                oModel,
                '10300001',
                supplierDefaults,
                PurchaseOrderValidator
            );

            expect(report.applied.Currency).toBe('USD');
            expect(report.applied.PaymentTerms).toBe('0001');
            expect(report.applied.IncotermsClassification).toBe('FOB');
            expect(report.applied.IncotermsLocation1).toBe('NEW YORK');

            expect(oModel.getProperty('/header/Currency')).toBe('USD');
            expect(oModel.getProperty('/supplierDefaultsDerived')).toBe(true);
            expect(oModel.getProperty('/supplierDefaultsLastPo')).toBe('4500000001');
        });

        it('should not overwrite user-modified fields', () => {
            oModel.setProperty('/header/Currency', 'EUR');
            oModel.setProperty('/userModified/Currency', true);

            const supplierDefaults = {
                Currency: 'USD',
                PaymentTerms: '0001'
            };

            const report = PurchaseOrderDefaults.deriveSupplierDefaults(
                oModel,
                '10300001',
                supplierDefaults,
                PurchaseOrderValidator
            );

            expect(report.preserved.Currency).toBe('EUR');
            expect(oModel.getProperty('/header/Currency')).toBe('EUR');
            expect(report.applied.PaymentTerms).toBe('0001');
        });
    });
});
