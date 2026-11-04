/**
 * Unit Test: purchaseOrderRulesSync.test.js
 * Verifies cross-layer synchronization of Purchase Order validation rules:
 * - config/schema/purchaseOrderRules.json (authoritative source of truth)
 * - srv/mm/purchase-order/validation/purchaseOrder.validation.js (backend)
 * - app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js (generated frontend rules)
 * - app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator.js (frontend validator)
 * - tools/generate-po-rules.js (generator output compared with the file on disk)
 * - srv/external/MM_PUR_PO_MAINT_V2_SRV.csn (field lengths in the imported SAP metadata)
 */

const fs = require('fs');
const path = require('path');

const generatedRulesPath = path.resolve(__dirname, '../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js');

const poSchema = require('../../../config/schema/purchaseOrderRules.json');
const backendValidation = require('../../../srv/mm/purchase-order/validation/purchaseOrder.validation');
const PurchaseOrderRules = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules');
const PurchaseOrderValidator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');
const { generateRulesContent } = require('../../../tools/generate-po-rules');

const sapMetadata = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../srv/external/MM_PUR_PO_MAINT_V2_SRV.csn'), 'utf8'));
const sapLength = (sEntity, sField) => sapMetadata.definitions[`MM_PUR_PO_MAINT_V2_SRV.${sEntity}`].elements[sField].length;

const VALID_ZDOM = {
    header: {
        PurchaseOrderType: 'ZDOM',
        CompanyCode: '1000',
        PurchasingOrganization: 'AE01',
        PurchasingGroup: '101',
        Supplier: '100102',
        Currency: 'INR',
        DocumentDate: '2026-09-24',
        IncotermsClassification: 'EXW',
        IncotermsLocation1: 'MUMBAI',
        PaymentTerms: '0001'
    },
    items: [{
        PurchaseOrderItem: '10',
        Material: 'MAT101',
        Plant: '1000',
        StorageLocation: '100A',
        OrderQuantity: '10',
        UnitOfMeasure: 'PC',
        NetPriceAmount: '100.00',
        TaxCode: 'V1',
        MaterialGroup: 'L001',
        PurchaseOrderItemCategory: '0',
        AccountAssignmentCategory: ''
    }]
};

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
        // SAP lengths come from the service metadata imported at srv/external/MM_PUR_PO_MAINT_V2_SRV.csn.
        it.each([
            ['PurchaseOrderType', 'PurchaseOrderType'],
            ['CompanyCode', 'CompanyCode'],
            ['PurchasingOrganization', 'PurchasingOrganization'],
            ['PurchasingGroup', 'PurchasingGroup'],
            ['Supplier', 'Supplier'],
            ['IncotermsClassification', 'IncotermsClassification'],
            ['IncotermsLocation1', 'IncotermsLocation1'],
            ['PaymentTerms', 'PaymentTerms']
        ])('should limit header field %s to the SAP length of C_PurchaseOrderTP.%s', (sRuleField, sSapField) => {
            expect(poSchema.header[sRuleField].maxLen).toBe(sapLength('C_PurchaseOrderTP', sSapField));
        });

        it('should keep the 3-letter Currency rule within the SAP length of DocumentCurrency', () => {
            expect(poSchema.header.Currency.maxLen).toBe(3);
            expect(sapLength('C_PurchaseOrderTP', 'DocumentCurrency')).toBe(5);
        });

        it.each([
            ['Material', 'Material'],
            ['Plant', 'Plant'],
            ['StorageLocation', 'StorageLocation'],
            ['UnitOfMeasure', 'PurchaseOrderQuantityUnit'],
            ['TaxCode', 'TaxCode'],
            ['MaterialGroup', 'MaterialGroup'],
            ['PurchaseOrderItemCategory', 'PurchaseOrderItemCategory'],
            ['AccountAssignmentCategory', 'AccountAssignmentCategory']
        ])('should limit item field %s to the SAP length of C_PurchaseOrderItemTP.%s', (sRuleField, sSapField) => {
            expect(poSchema.item[sRuleField].maxLen).toBe(sapLength('C_PurchaseOrderItemTP', sSapField));
        });
    });

    describe('Backend Validation Sync with Schema', () => {
        it('should synchronize CURRENCY_REGEX with schema', () => {
            expect(backendValidation.CURRENCY_REGEX).toBeInstanceOf(RegExp);
            expect(backendValidation.CURRENCY_REGEX.source).toBe(poSchema.patterns.currency);
            expect(backendValidation.CURRENCY_REGEX.test('EUR')).toBe(true);
            expect(backendValidation.CURRENCY_REGEX.test('USD')).toBe(true);
            expect(backendValidation.CURRENCY_REGEX.test('EURO')).toBe(false);
            expect(backendValidation.CURRENCY_REGEX.test('12')).toBe(false);
        });

        it.each(['PurchaseOrderType', 'CompanyCode', 'PurchasingOrganization', 'PurchasingGroup', 'Supplier', 'Currency', 'DocumentDate'])('should reject a blank required header field %s', (sField) => {
            const result = backendValidation.validateCreatePurchaseOrderPayload({
                header: { ...VALID_ZDOM.header, [sField]: '' },
                items: VALID_ZDOM.items
            });
            expect(result.errors.map(e => e.field)).toContain(`header.${sField}`);
        });

        it.each(['IncotermsClassification', 'PaymentTerms'])('should accept a blank optional header field %s', (sField) => {
            const result = backendValidation.validateCreatePurchaseOrderPayload({
                header: { ...VALID_ZDOM.header, [sField]: '' },
                items: VALID_ZDOM.items
            });
            expect(result.isValid).toBe(true);
        });

        it.each(['Material', 'Plant', 'StorageLocation', 'OrderQuantity', 'UnitOfMeasure'])('should reject a blank required item field %s', (sField) => {
            const result = backendValidation.validateCreatePurchaseOrderPayload({
                header: VALID_ZDOM.header,
                items: [{ ...VALID_ZDOM.items[0], [sField]: '' }]
            });
            expect(result.errors.map(e => e.field)).toContain(`items[0].${sField}`);
        });

        it.each(['NetPriceAmount', 'TaxCode', 'MaterialGroup'])('should accept a blank optional item field %s', (sField) => {
            const result = backendValidation.validateCreatePurchaseOrderPayload({
                header: VALID_ZDOM.header,
                items: [{ ...VALID_ZDOM.items[0], [sField]: '' }]
            });
            expect(result.isValid).toBe(true);
        });
    });

    describe('Frontend PurchaseOrderRules Module Sync', () => {
        it.each(['PATTERNS', 'HEADER', 'ITEM', 'ITEMS_LIST', 'PO_TYPES'])('should freeze PurchaseOrderRules.%s', (sKey) => {
            expect(Object.isFrozen(PurchaseOrderRules[sKey])).toBe(true);
        });

        it('should build the regex patterns from the schema patterns', () => {
            expect(PurchaseOrderRules.PATTERNS.CURRENCY.source).toBe(poSchema.patterns.currency);
            expect(PurchaseOrderRules.PATTERNS.DOC_TYPE_PREFIX.source).toBe(poSchema.patterns.docTypePrefix);
        });

        it('should carry the same header, item, list and PO type rules as the backend schema', () => {
            expect(PurchaseOrderRules.HEADER).toEqual(poSchema.header);
            expect(PurchaseOrderRules.ITEM).toEqual(poSchema.item);
            expect(PurchaseOrderRules.ITEMS_LIST).toEqual(poSchema.itemsList);
            expect(PurchaseOrderRules.PO_TYPES).toEqual(poSchema.poTypes);
        });
    });

    describe('Frontend PurchaseOrderValidator Integration', () => {
        it('should expose rules reference on PurchaseOrderValidator and PurchaseOrderModel', () => {
            expect(PurchaseOrderValidator.rules).toBeDefined();
            expect(PurchaseOrderValidator.rules.HEADER).toEqual(poSchema.header);

            expect(PurchaseOrderModel.rules).toBeDefined();
            expect(PurchaseOrderModel.rules.HEADER).toEqual(poSchema.header);
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
        it('should keep the generated PurchaseOrderRules.js identical to fresh generator output, apart from its timestamp', () => {
            const dropTimestamp = (s) => s.replace(/^\/\/ Generated on: .*$/m, '// Generated on:');
            const onDisk = fs.readFileSync(generatedRulesPath, 'utf8');
            expect(dropTimestamp(onDisk)).toBe(dropTimestamp(generateRulesContent(poSchema)));
        });
    });
});
