/**
 * Unit Test Suite: PO Type-Wise Dynamic Business Rules (poTypeDynamicRules.test.js)
 * Comprehensive testing of all 16 PO types across frontend rules, model reconciliation,
 * context filters, item categories, account assignments, and backend validation.
 */

let PurchaseOrderModel;

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

const originalSap = global.sap;
global.sap = {
    ui: {
        define: function (deps, factory) {
            PurchaseOrderModel = factory(MockJSONModel);
        },
        model: {
            json: {
                JSONModel: MockJSONModel
            }
        }
    }
};

require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');

const PurchaseOrderRules = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules');
const PurchaseOrderValidator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');
const { validateCreatePurchaseOrderPayload } = require('../../../srv/mm/purchase-order/validation/purchaseOrder.validation');

const ALL_16_PO_TYPES = [
    'ZCAP', 'ZDIA', 'ZDIS', 'ZDOM', 'ZDOS', 'ZHSA', 'ZHSS', 'ZIMP',
    'ZIMS', 'ZINT', 'ZLOG', 'ZNVM', 'ZRTV', 'ZSER', 'ZSTO', 'ZSUB'
];

describe('PO Type-Wise Dynamic Business Rules - 16 Types Matrix', () => {

    afterAll(() => {
        global.sap = originalSap;
    });

    describe('1. Rule Definition Completeness & Integrity', () => {
        it('should define all 16 PO types in PurchaseOrderRules.PO_TYPES', () => {
            expect(Object.keys(PurchaseOrderRules.PO_TYPES).sort()).toEqual(ALL_16_PO_TYPES.sort());
        });

        ALL_16_PO_TYPES.forEach((docType) => {
            it(`should have valid structural metadata for PO type ${docType}`, () => {
                const rule = PurchaseOrderRules.PO_TYPES[docType];
                expect(rule).toBeDefined();
                expect(rule.code).toBe(docType);
                expect(typeof rule.description).toBe('string');
                expect(rule.description.length).toBeGreaterThan(0);
                expect(Array.isArray(rule.allowedCompanyCodes)).toBe(true);
                expect(rule.allowedCompanyCodes).toEqual(['1000', '2000']);
                expect(rule.allowedCompanyCodes).toContain(rule.defaultCompanyCode);

                expect(Array.isArray(rule.allowedPurchOrgs)).toBe(true);
                expect(rule.allowedPurchOrgs.length).toBeGreaterThan(0);
                expect(rule.allowedPurchOrgs).toContain(rule.defaultPurchOrg);

                expect(Array.isArray(rule.allowedCurrencies)).toBe(true);
                expect(rule.allowedCurrencies.length).toBeGreaterThan(0);
                expect(rule.allowedCurrencies).toContain(rule.defaultCurrency);

                expect(Array.isArray(rule.allowedItemCategories)).toBe(true);
                expect(rule.allowedItemCategories.length).toBeGreaterThan(0);
                expect(rule.allowedItemCategories).toContain(rule.defaultItemCategory);

                expect(Array.isArray(rule.allowedAcctAssignmentCategories)).toBe(true);
                expect(rule.allowedAcctAssignmentCategories).toContain(rule.defaultAcctAssignmentCategory);
            });
        });
    });

    describe('2. Model Reconciliation & Dynamic UI Rules on PO Type Change', () => {
        let oModel;

        beforeEach(() => {
            oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
        });

        it('should update uiRules with process flags and item category allowances for ZSER', () => {
            PurchaseOrderModel.setDocumentType(oModel, 'ZSER', 'Service PO');

            const uiRules = oModel.getProperty('/uiRules');
            expect(uiRules.materialRequired).toBe(false);
            expect(uiRules.isService).toBe(true);
            expect(uiRules.allowedItemCategories).toContain('9');
            expect(uiRules.showAccountAssignment).toBe(true);
        });

        it('should reconcile line item defaults when changing to ZSER', () => {
            // Initial item starts with standard category '0'
            expect(oModel.getProperty('/items/0/PurchaseOrderItemCategory')).toBe('0');

            PurchaseOrderModel.setDocumentType(oModel, 'ZSER', 'Service PO');

            expect(oModel.getProperty('/items/0/PurchaseOrderItemCategory')).toBe('9');
            expect(oModel.getProperty('/items/0/AccountAssignmentCategory')).toBe('K');
        });

        it('should update uiRules and line items when changing to ZSUB (Subcontracting)', () => {
            PurchaseOrderModel.setDocumentType(oModel, 'ZSUB', 'Subcontracting PO');

            const uiRules = oModel.getProperty('/uiRules');
            expect(uiRules.isSubcontracting).toBe(true);
            expect(uiRules.allowedItemCategories).toEqual(['3']);
            expect(oModel.getProperty('/items/0/PurchaseOrderItemCategory')).toBe('3');
        });

        it('should update uiRules and line items when changing to ZSTO (Stock Transfer)', () => {
            PurchaseOrderModel.setDocumentType(oModel, 'ZSTO', 'Company to Company T');

            const uiRules = oModel.getProperty('/uiRules');
            expect(uiRules.isStockTransfer).toBe(true);
            expect(uiRules.allowedItemCategories).toContain('7');
            expect(oModel.getProperty('/items/0/PurchaseOrderItemCategory')).toBe('7');
        });

        it('should reconcile CompanyCode and PurchasingOrg when switching between 1000 and 2000 PO types', () => {
            // Set 1000 PO type
            PurchaseOrderModel.setDocumentType(oModel, 'ZDOM', 'Dom. Aether In.LTD.');
            expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
            expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('AE01');

            // Switch to 2000 PO type (ZDOS)
            PurchaseOrderModel.setDocumentType(oModel, 'ZDOS', 'Dom.Aether Spec.Chem');
            expect(oModel.getProperty('/header/CompanyCode')).toBe('2000');
            expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('AS01');
            expect(oModel.getProperty('/header/Currency')).toBe('INR');
        });

        it('should reconcile Currency when switching to Import PO type (ZIMP)', () => {
            PurchaseOrderModel.setDocumentType(oModel, 'ZDOM', 'Dom. Aether In.LTD.');
            expect(oModel.getProperty('/header/Currency')).toBe('INR');

            PurchaseOrderModel.setDocumentType(oModel, 'ZIMP', 'Imp.Aether In.LTD.');
            expect(oModel.getProperty('/header/Currency')).toBe('USD');
        });
    });

    describe('3. Client-Side Field Validation for PO Types', () => {
        ALL_16_PO_TYPES.forEach((docType) => {
            it(`should validate permitted company code and currency for ${docType}`, () => {
                const rule = PurchaseOrderRules.PO_TYPES[docType];
                const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
                PurchaseOrderModel.setDocumentType(oModel, docType, rule.description);

                // Valid single field test for CompanyCode (both 1000 and 2000 permitted for all 16 types)
                expect(PurchaseOrderValidator.validateSingleField(oModel, 'CompanyCode', '1000').state).toBe('None');
                expect(PurchaseOrderValidator.validateSingleField(oModel, 'CompanyCode', '2000').state).toBe('None');

                // Valid single field test for Currency
                const validCurrRes = PurchaseOrderValidator.validateSingleField(
                    oModel,
                    'Currency',
                    rule.defaultCurrency
                );
                expect(validCurrRes.state).toBe('None');

                // Invalid company code test (e.g. 9999)
                const invalidCcRes = PurchaseOrderValidator.validateSingleField(
                    oModel,
                    'CompanyCode',
                    '9999'
                );
                expect(invalidCcRes.state).toBe('Error');
                expect(invalidCcRes.text).toContain('not permitted');
            });
        });

        it('should allow empty Material for ZSER if PurchaseOrderItemText is provided', () => {
            const data = {
                header: {
                    PurchaseOrderType: 'ZSER',
                    CompanyCode: '1000',
                    PurchasingOrganization: 'AE01',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'INR',
                    DocumentDate: '2026-09-24'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: '',
                        PurchaseOrderItemText: 'Consulting & Maintenance Services',
                        Plant: '1000',
                        StorageLocation: '100A',
                        UnitOfMeasure: 'AU',
                        OrderQuantity: '1',
                        PurchaseOrderItemCategory: '9',
                        AccountAssignmentCategory: 'K'
                    }
                ]
            };

            const errors = PurchaseOrderValidator.validateUI(data);
            expect(errors).toHaveLength(0);
        });

        it('should require PurchaseOrderItemText for ZSER when Material is omitted', () => {
            const data = {
                header: {
                    PurchaseOrderType: 'ZSER',
                    CompanyCode: '1000',
                    PurchasingOrganization: 'AE01',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'INR',
                    DocumentDate: '2026-09-24'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: '',
                        PurchaseOrderItemText: '',
                        Plant: '1000',
                        StorageLocation: '100A',
                        UnitOfMeasure: 'AU',
                        OrderQuantity: '1'
                    }
                ]
            };

            const errors = PurchaseOrderValidator.validateUI(data);
            expect(errors.some(e => e.includes('Short Text (Description) is required'))).toBe(true);
        });

        it('should enforce plant prefix 1 for company 1000 PO types like ZDOM', () => {
            const data = {
                header: {
                    PurchaseOrderType: 'ZDOM',
                    CompanyCode: '1000',
                    PurchasingOrganization: 'AE01',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'INR',
                    DocumentDate: '2026-09-24'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'MAT01',
                        Plant: '2000', // Invalid plant for ZDOM
                        StorageLocation: '100A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '10'
                    }
                ]
            };

            const errors = PurchaseOrderValidator.validateUI(data);
            expect(errors.some(e => e.includes("must start with '1'"))).toBe(true);
        });
    });

    describe('4. Backend Business Validation for All 16 PO Types', () => {
        ALL_16_PO_TYPES.forEach((docType) => {
            it(`should accept valid creation payload for PO type ${docType}`, () => {
                const rule = PurchaseOrderRules.PO_TYPES[docType];
                const plant = rule.allowedPlantPrefix ? `${rule.allowedPlantPrefix}000` : '1000';
                const payload = {
                    header: {
                        PurchaseOrderType: docType,
                        CompanyCode: rule.defaultCompanyCode,
                        PurchasingOrganization: rule.defaultPurchOrg,
                        PurchasingGroup: '001',
                        Supplier: '100001',
                        Currency: rule.defaultCurrency,
                        DocumentDate: '2026-09-24'
                    },
                    items: [
                        {
                            PurchaseOrderItem: '10',
                            Material: rule.materialRequired ? 'MAT101' : '',
                            PurchaseOrderItemText: 'Test Line Description',
                            Plant: plant,
                            StorageLocation: '100A',
                            UnitOfMeasure: 'PC',
                            OrderQuantity: '10',
                            NetPriceAmount: '100.00',
                            PurchaseOrderItemCategory: rule.defaultItemCategory,
                            AccountAssignmentCategory: rule.defaultAcctAssignmentCategory
                        }
                    ]
                };

                const result = validateCreatePurchaseOrderPayload(payload);
                expect(result.isValid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

            it(`should accept both 1000 and 2000 as allowed company codes for PO type ${docType}`, () => {
                const rule = PurchaseOrderRules.PO_TYPES[docType];
                const plant = rule.allowedPlantPrefix ? `${rule.allowedPlantPrefix}000` : '1000';

                ['1000', '2000'].forEach((coCode) => {
                    // Test 1: Single field validation in UI validator
                    const mockModel = new MockJSONModel({
                        header: { PurchaseOrderType: docType }
                    });
                    const fieldRes = PurchaseOrderValidator.validateSingleField(mockModel, 'CompanyCode', coCode);
                    expect(fieldRes.state).toBe('None');

                    // Test 2: Full backend payload validation
                    const payload = {
                        header: {
                            PurchaseOrderType: docType,
                            CompanyCode: coCode,
                            PurchasingOrganization: rule.defaultPurchOrg,
                            PurchasingGroup: '001',
                            Supplier: '100001',
                            Currency: rule.defaultCurrency,
                            DocumentDate: '2026-09-24'
                        },
                        items: [
                            {
                                PurchaseOrderItem: '10',
                                Material: rule.materialRequired ? 'MAT101' : '',
                                PurchaseOrderItemText: 'Test Line Description',
                                Plant: plant,
                                StorageLocation: '100A',
                                UnitOfMeasure: 'PC',
                                OrderQuantity: '10',
                                NetPriceAmount: '100.00',
                                PurchaseOrderItemCategory: rule.defaultItemCategory,
                                AccountAssignmentCategory: rule.defaultAcctAssignmentCategory
                            }
                        ]
                    };
                    const res = validateCreatePurchaseOrderPayload(payload);
                    expect(res.isValid).toBe(true);
                    expect(res.errors.filter(e => e.field === 'header.CompanyCode')).toHaveLength(0);
                });
            });

            it(`should reject invalid company code for PO type ${docType}`, () => {
                const rule = PurchaseOrderRules.PO_TYPES[docType];
                const plant = rule.allowedPlantPrefix ? `${rule.allowedPlantPrefix}000` : '1000';
                const payload = {
                    header: {
                        PurchaseOrderType: docType,
                        CompanyCode: '9999', // Invalid
                        PurchasingOrganization: rule.defaultPurchOrg,
                        PurchasingGroup: '001',
                        Supplier: '100001',
                        Currency: rule.defaultCurrency,
                        DocumentDate: '2026-09-24'
                    },
                    items: [
                        {
                            PurchaseOrderItem: '10',
                            Material: rule.materialRequired ? 'MAT101' : '',
                            PurchaseOrderItemText: 'Test Line Description',
                            Plant: plant,
                            StorageLocation: '100A',
                            UnitOfMeasure: 'PC',
                            OrderQuantity: '10',
                            PurchaseOrderItemCategory: rule.defaultItemCategory,
                            AccountAssignmentCategory: rule.defaultAcctAssignmentCategory
                        }
                    ]
                };

                const result = validateCreatePurchaseOrderPayload(payload);
                expect(result.isValid).toBe(false);
                expect(result.errors.some(e => e.field === 'header.CompanyCode')).toBe(true);
            });
        });

        it('should reject invalid item category for ZSUB', () => {
            const payload = {
                header: {
                    PurchaseOrderType: 'ZSUB',
                    CompanyCode: '1000',
                    PurchasingOrganization: 'AE01',
                    PurchasingGroup: '001',
                    Supplier: '100001',
                    Currency: 'INR',
                    DocumentDate: '2026-09-24'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'MAT101',
                        Plant: '1000',
                        StorageLocation: '100A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '10',
                        PurchaseOrderItemCategory: '0', // Invalid for ZSUB (requires 3)
                        AccountAssignmentCategory: ''
                    }
                ]
            };

            const result = validateCreatePurchaseOrderPayload(payload);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field.includes('PurchaseOrderItemCategory'))).toBe(true);
        });
    });
});
