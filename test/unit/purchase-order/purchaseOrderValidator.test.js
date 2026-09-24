/**
 * Unit Tests for PurchaseOrderValidator module
 */

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

describe('Unit: PurchaseOrderValidator', () => {

    describe('isValidDocType', () => {
        it('should return true for valid Z-document types', () => {
            expect(PurchaseOrderValidator.isValidDocType('ZDOM')).toBe(true);
            expect(PurchaseOrderValidator.isValidDocType('ZDOS')).toBe(true);
            expect(PurchaseOrderValidator.isValidDocType('ZIMP')).toBe(true);
            expect(PurchaseOrderValidator.isValidDocType('ZCAP')).toBe(true);
            expect(PurchaseOrderValidator.isValidDocType('zdom')).toBe(true);
        });

        it('should return false for non-Z or invalid document types', () => {
            expect(PurchaseOrderValidator.isValidDocType('NB')).toBe(false);
            expect(PurchaseOrderValidator.isValidDocType('FO')).toBe(false);
            expect(PurchaseOrderValidator.isValidDocType('')).toBe(false);
            expect(PurchaseOrderValidator.isValidDocType(null)).toBe(false);
            expect(PurchaseOrderValidator.isValidDocType('ZTOOLONG')).toBe(false);
        });
    });

    describe('validateDocType', () => {
        it('should return valid for ZDOM', () => {
            const res = PurchaseOrderValidator.validateDocType('ZDOM');
            expect(res.valid).toBe(true);
            expect(res.state).toBe('None');
            expect(res.text).toBe('');
        });

        it('should return error for empty document type', () => {
            const res = PurchaseOrderValidator.validateDocType('');
            expect(res.valid).toBe(false);
            expect(res.state).toBe('Error');
            expect(res.text).toContain('Document Type is required');
        });

        it('should return error for non-Z document type', () => {
            const res = PurchaseOrderValidator.validateDocType('NB');
            expect(res.valid).toBe(false);
            expect(res.state).toBe('Error');
            expect(res.text).toContain('Only Z-related document types');
        });
    });

    describe('validateUI', () => {
        it('should return error if data or header is missing', () => {
            expect(PurchaseOrderValidator.validateUI(null)).toEqual(['Invalid Purchase Order data.']);
            expect(PurchaseOrderValidator.validateUI({})).toEqual(['Invalid Purchase Order data.']);
        });

        it('should return list of errors when header fields are missing', () => {
            const data = {
                header: {},
                items: []
            };
            const errors = PurchaseOrderValidator.validateUI(data);
            expect(errors).toContain('Document Type is required.');
            expect(errors).toContain('Company Code is required.');
            expect(errors).toContain('Purchasing Organization is required.');
            expect(errors).toContain('Purchasing Group is required.');
            expect(errors).toContain('Supplier is required.');
            expect(errors).toContain('Currency is required.');
            expect(errors).toContain('Document Date is required.');
            expect(errors).toContain('Please add at least one line item.');
        });

        it('should validate IncotermsLocation1 when IncotermsClassification is provided', () => {
            const data = {
                header: {
                    PurchaseOrderType: 'ZDOM',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'EUR',
                    DocumentDate: '2026-09-24',
                    IncotermsClassification: 'EXW',
                    IncotermsLocation1: ''
                },
                items: [
                    { Material: 'TG11', Plant: '1010', StorageLocation: '101A', UnitOfMeasure: 'PC', OrderQuantity: '10' }
                ]
            };
            const errors = PurchaseOrderValidator.validateUI(data);
            expect(errors).toContain('Incoterms Location is required when Incoterms is specified.');
        });

        it('should return empty array for fully valid data', () => {
            const data = {
                header: {
                    PurchaseOrderType: 'ZDOM',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'EUR',
                    DocumentDate: '2026-09-24',
                    IncotermsClassification: 'EXW',
                    IncotermsLocation1: 'BERLIN'
                },
                items: [
                    { Material: 'TG11', Plant: '1010', StorageLocation: '101A', UnitOfMeasure: 'PC', OrderQuantity: '10' }
                ]
            };
            const errors = PurchaseOrderValidator.validateUI(data);
            expect(errors.length).toBe(0);
        });
    });

    describe('validateSingleField', () => {
        let oModel;

        beforeEach(() => {
            oModel = createMockModel({
                hasError: false,
                errors: {},
                header: {
                    PurchaseOrderType: 'ZDOM',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'EUR',
                    DocumentDate: '2026-09-24'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'TG11',
                        Plant: '1010',
                        StorageLocation: '101A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '10',
                        NetPriceAmount: '100.00',
                        TaxCode: 'V1',
                        errors: {}
                    }
                ]
            });
        });

        it('should validate Currency ISO format', () => {
            const invalidRes = PurchaseOrderValidator.validateSingleField(oModel, 'Currency', 'EURO');
            expect(invalidRes.state).toBe('Error');
            expect(invalidRes.text).toContain('3-letter ISO code');

            const validRes = PurchaseOrderValidator.validateSingleField(oModel, 'Currency', 'USD');
            expect(validRes.state).toBe('None');
        });

        it('should validate item OrderQuantity positivity', () => {
            const zeroRes = PurchaseOrderValidator.validateSingleField(oModel, 'OrderQuantity', '0', 0);
            expect(zeroRes.state).toBe('Error');
            expect(zeroRes.text).toContain('greater than 0');

            const negRes = PurchaseOrderValidator.validateSingleField(oModel, 'OrderQuantity', '-5', 0);
            expect(negRes.state).toBe('Error');

            const validRes = PurchaseOrderValidator.validateSingleField(oModel, 'OrderQuantity', '25', 0);
            expect(validRes.state).toBe('None');
        });
    });

    describe('clearErrors and setFieldValidation', () => {
        it('should clear all header and item errors', () => {
            const oModel = createMockModel({
                hasError: true,
                errorMessage: 'Some error',
                errorCount: 1,
                errorList: [{ title: 'Err' }],
                errors: {
                    CompanyCode: { state: 'Error', text: 'Required' }
                },
                items: [
                    {
                        errors: {
                            Plant: { state: 'Error', text: 'Required' }
                        }
                    }
                ]
            });

            PurchaseOrderValidator.clearErrors(oModel);

            expect(oModel.getProperty('/hasError')).toBe(false);
            expect(oModel.getProperty('/errorMessage')).toBe('');
            expect(oModel.getProperty('/errorCount')).toBe(0);
            expect(oModel.getProperty('/errors/CompanyCode/state')).toBe('None');
            expect(oModel.getProperty('/items/0/errors/Plant/state')).toBe('None');
        });

        it('should set field validation state and text', () => {
            const oModel = createMockModel({ errors: {} });
            PurchaseOrderValidator.setFieldValidation(oModel, 'Supplier', 'Warning', 'Check supplier status');
            expect(oModel.getProperty('/errors/Supplier/state')).toBe('Warning');
            expect(oModel.getProperty('/errors/Supplier/text')).toBe('Check supplier status');
        });
    });

    describe('validateCompanyCodePurchasingOrg', () => {
        it('should detect mismatch when PurchasingOrg belongs to another CompanyCode', () => {
            const oModel = createMockModel({
                header: {
                    CompanyCode: '1010',
                    PurchasingOrganization: '2000'
                },
                errors: {}
            });
            const config = {
                purchasingOrgs: [
                    { PurchasingOrganization: '2000', CompanyCode: '2000' }
                ]
            };

            const result = PurchaseOrderValidator.validateCompanyCodePurchasingOrg(oModel, config);
            expect(result.isValid).toBe(false);
            expect(result.message).toContain('belongs to Company Code 2000, not 1010');
            expect(oModel.getProperty('/errors/PurchasingOrganization/state')).toBe('Error');
        });

        it('should pass when PurchasingOrg matches CompanyCode', () => {
            const oModel = createMockModel({
                header: {
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010'
                },
                errors: {}
            });
            const config = {
                purchasingOrgs: [
                    { PurchasingOrganization: '1010', CompanyCode: '1010' }
                ]
            };

            const result = PurchaseOrderValidator.validateCompanyCodePurchasingOrg(oModel, config);
            expect(result.isValid).toBe(true);
        });
    });

    describe('applyBackendErrors', () => {
        it('should map backend detail items to header controls and errorList', () => {
            const oModel = createMockModel({
                errors: {},
                items: [{ errors: {} }]
            });
            const oError = {
                message: 'Creation failed',
                details: [
                    { target: 'header.CompanyCode', message: 'Company Code 1010 is closed for posting', code: 'ME001' },
                    { target: 'items[0].Plant', message: 'Plant 1010 does not exist', code: 'ME002' }
                ]
            };

            const res = PurchaseOrderValidator.applyBackendErrors(oModel, oError);
            expect(res.errorCount).toBe(2);
            expect(oModel.getProperty('/errors/CompanyCode/state')).toBe('Error');
            expect(oModel.getProperty('/items/0/errors/Plant/state')).toBe('Error');
            expect(oModel.getProperty('/hasError')).toBe(true);
        });
    });
});
