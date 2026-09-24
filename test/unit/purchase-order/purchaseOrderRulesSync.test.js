/**
 * Unit Test: purchaseOrderRulesSync.test.js
 * Verifies cross-layer synchronization of Purchase Order validation rules:
 * - config/schema/purchaseOrderRules.json (authoritative source of truth)
 * - srv/mm/purchase-order/validation/purchaseOrder.validation.js (backend)
 * - app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js (generated frontend rules)
 * - app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator.js (frontend validator)
 * - tools/generate-po-rules.js (generator consistency check)
 */

const fs = require('fs');
const path = require('path');

const generatedRulesPath = path.resolve(__dirname, '../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js');

const poSchema = require('../../../config/schema/purchaseOrderRules.json');
const backendValidation = require('../../../srv/mm/purchase-order/validation/purchaseOrder.validation');
const PurchaseOrderRules = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules');
const PurchaseOrderValidator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');

let PurchaseOrderModel;
const originalSap = global.sap;
global.sap = {
    ui: {
        define: function (deps, factory) {
            PurchaseOrderModel = factory(function () {});
        }
    }
};
require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');

describe('Unit: Purchase Order Validation Rules Single Source of Truth & Sync', () => {

    afterAll(() => {
        global.sap = originalSap;
    });

    describe('Authoritative Schema Integrity', () => {
        it('should define expected currency and docType regex patterns', () => {
            expect(poSchema.patterns).toBeDefined();
            expect(poSchema.patterns.currency).toBe('^[A-Za-z]{3}$');
            expect(poSchema.patterns.docTypePrefix).toBe('^Z');
        });

        it('should define header length and requirement constraints matching business rules', () => {
            expect(poSchema.header.PurchaseOrderType.maxLen).toBe(4);
            expect(poSchema.header.PurchaseOrderType.required).toBe(true);

            expect(poSchema.header.CompanyCode.maxLen).toBe(4);
            expect(poSchema.header.CompanyCode.required).toBe(true);

            expect(poSchema.header.PurchasingOrganization.maxLen).toBe(4);
            expect(poSchema.header.PurchasingOrganization.required).toBe(true);

            expect(poSchema.header.PurchasingGroup.maxLen).toBe(3);
            expect(poSchema.header.PurchasingGroup.required).toBe(true);

            expect(poSchema.header.Supplier.required).toBe(true);

            expect(poSchema.header.Currency.required).toBe(true);
            expect(poSchema.header.Currency.maxLen).toBe(3);
            expect(poSchema.header.Currency.pattern).toBe('^[A-Za-z]{3}$');

            expect(poSchema.header.DocumentDate.required).toBe(true);

            expect(poSchema.header.IncotermsClassification.maxLen).toBe(3);
            expect(poSchema.header.IncotermsLocation1.maxLen).toBe(70);
            expect(poSchema.header.IncotermsLocation1.requiredIf).toBe('IncotermsClassification');

            expect(poSchema.header.PaymentTerms.maxLen).toBe(4);
        });

        it('should define item constraints matching business rules', () => {
            expect(poSchema.item.Material.required).toBe(true);
            expect(poSchema.item.Plant.required).toBe(true);
            expect(poSchema.item.StorageLocation.required).toBe(true);
            expect(poSchema.item.OrderQuantity.required).toBe(true);
            expect(poSchema.item.OrderQuantity.min).toBe(0);
            expect(poSchema.item.OrderQuantity.exclusiveMin).toBe(true);

            expect(poSchema.item.TaxCode.maxLen).toBe(2);
        });
    });

    describe('Backend Validation Sync with Schema', () => {
        it('should expose RULES identical to authoritative schema', () => {
            expect(backendValidation.RULES).toBeDefined();
            expect(backendValidation.RULES.patterns.currency).toBe(poSchema.patterns.currency);
            expect(backendValidation.RULES.header.IncotermsClassification.maxLen).toBe(3);
            expect(backendValidation.RULES.header.IncotermsLocation1.maxLen).toBe(70);
            expect(backendValidation.RULES.header.PaymentTerms.maxLen).toBe(4);
            expect(backendValidation.RULES.item.TaxCode.maxLen).toBe(2);
        });

        it('should synchronize CURRENCY_REGEX with schema', () => {
            expect(backendValidation.CURRENCY_REGEX).toBeInstanceOf(RegExp);
            expect(backendValidation.CURRENCY_REGEX.source).toBe(poSchema.patterns.currency);
            expect(backendValidation.CURRENCY_REGEX.test('EUR')).toBe(true);
            expect(backendValidation.CURRENCY_REGEX.test('USD')).toBe(true);
            expect(backendValidation.CURRENCY_REGEX.test('EURO')).toBe(false);
            expect(backendValidation.CURRENCY_REGEX.test('12')).toBe(false);
        });

        it('should synchronize REQUIRED_HEADER_FIELDS with schema required headers', () => {
            const expectedHeaders = Object.keys(poSchema.header).filter(f => poSchema.header[f].required);
            const actualHeaders = backendValidation.REQUIRED_HEADER_FIELDS.map(f => f.field);
            expect(actualHeaders).toEqual(expect.arrayContaining(expectedHeaders));
            expect(expectedHeaders).toEqual(expect.arrayContaining(actualHeaders));
        });

        it('should synchronize REQUIRED_ITEM_FIELDS with schema required items', () => {
            const expectedItems = Object.keys(poSchema.item).filter(f => poSchema.item[f].required);
            const actualItems = backendValidation.REQUIRED_ITEM_FIELDS.map(f => f.field);
            expect(actualItems).toEqual(expect.arrayContaining(expectedItems));
            expect(expectedItems).toEqual(expect.arrayContaining(actualItems));
        });
    });

    describe('Frontend PurchaseOrderRules Module Sync', () => {
        it('should export frozen schema, patterns, and field collections', () => {
            expect(PurchaseOrderRules).toBeDefined();
            expect(PurchaseOrderRules.SCHEMA).toBeDefined();
            expect(PurchaseOrderRules.PATTERNS).toBeDefined();
            expect(PurchaseOrderRules.PATTERNS.CURRENCY).toBeInstanceOf(RegExp);
            expect(PurchaseOrderRules.PATTERNS.CURRENCY.source).toBe(poSchema.patterns.currency);
            expect(PurchaseOrderRules.PATTERNS.DOC_TYPE_PREFIX.source).toBe(poSchema.patterns.docTypePrefix);

            expect(PurchaseOrderRules.HEADER).toEqual(poSchema.header);
            expect(PurchaseOrderRules.ITEM).toEqual(poSchema.item);
            expect(PurchaseOrderRules.ITEMS_LIST).toEqual(poSchema.itemsList);
        });
    });

    describe('Frontend PurchaseOrderValidator Integration', () => {
        it('should expose rules reference on PurchaseOrderValidator and PurchaseOrderModel', () => {
            expect(PurchaseOrderValidator.rules).toBeDefined();
            expect(PurchaseOrderValidator.rules.HEADER).toEqual(poSchema.header);

            expect(PurchaseOrderModel.rules).toBeDefined();
            expect(PurchaseOrderModel.rules.HEADER).toEqual(poSchema.header);
        });

        it('should validate single field currency using schema pattern', () => {
            const oModel = {
                getData: () => ({ header: {}, items: [] }),
                errors: {}
            };

            const invalidRes = PurchaseOrderValidator.validateSingleField(oModel, 'Currency', 'EURO');
            expect(invalidRes.state).toBe('Error');
            expect(invalidRes.text).toContain('3-letter ISO code');

            const validRes = PurchaseOrderValidator.validateSingleField(oModel, 'Currency', 'USD');
            expect(validRes.state).toBe('None');
        });

        it('should validate IncotermsLocation1 max length using schema constraint (70 chars)', () => {
            const oModel = {
                getData: () => ({
                    header: { IncotermsClassification: 'EXW' },
                    items: []
                }),
                errors: {}
            };

            const tooLongLoc = 'A'.repeat(71);
            const errRes = PurchaseOrderValidator.validateSingleField(oModel, 'IncotermsLocation1', tooLongLoc);
            expect(errRes.state).toBe('Error');
            expect(errRes.text).toContain('70 characters');

            const validLoc = 'A'.repeat(70);
            const validRes = PurchaseOrderValidator.validateSingleField(oModel, 'IncotermsLocation1', validLoc);
            expect(validRes.state).toBe('None');
        });

        it('should validate PaymentTerms max length using schema constraint (4 chars)', () => {
            const oModel = {
                getData: () => ({ header: {}, items: [] }),
                errors: {}
            };

            const errRes = PurchaseOrderValidator.validateSingleField(oModel, 'PaymentTerms', '00001');
            expect(errRes.state).toBe('Error');
            expect(errRes.text).toContain('4 characters');

            const validRes = PurchaseOrderValidator.validateSingleField(oModel, 'PaymentTerms', '0001');
            expect(validRes.state).toBe('None');
        });

        it('should validate item TaxCode max length using schema constraint (2 chars)', () => {
            const oModel = {
                getData: () => ({
                    header: {},
                    items: [{ PurchaseOrderItem: '10', TaxCode: 'V10', errors: {} }]
                }),
                items: [{ PurchaseOrderItem: '10', TaxCode: 'V10', errors: {} }]
            };

            const errRes = PurchaseOrderValidator.validateSingleField(oModel, 'TaxCode', 'V10', 0);
            expect(errRes.state).toBe('Error');
            expect(errRes.text).toContain('2 characters');

            const validRes = PurchaseOrderValidator.validateSingleField(oModel, 'TaxCode', 'V1', 0);
            expect(validRes.state).toBe('None');
        });
    });

    describe('Generator Determinism & Freshness', () => {
        it('should ensure generated PurchaseOrderRules.js file on disk is fresh and matches schema', () => {
            const fileContent = fs.readFileSync(generatedRulesPath, 'utf8');
            expect(fileContent).toContain('AUTO-GENERATED from config/schema/purchaseOrderRules.json');
            expect(fileContent).toContain(poSchema.patterns.currency);
            expect(fileContent).toContain('"IncotermsLocation1"');
            expect(fileContent).toContain('"maxLen": 70');
            expect(fileContent).toContain('"PaymentTerms"');
            expect(fileContent).toContain('"maxLen": 4');
        });
    });
});
