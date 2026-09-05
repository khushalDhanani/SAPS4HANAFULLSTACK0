/**
 * Unit Tests for Purchase Order Status according to Document Type and Completeness
 * Target: app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel.js
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

// Setup mock sap.ui.define before loading PurchaseOrderModel
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

describe('Unit: Create Purchase Order Status according to Document Type', () => {

    afterAll(() => {
        global.sap = originalSap;
    });

    describe('createInitialModel default status', () => {
        it('should initialize with default status In Preparation for standard NB document type', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            const header = oModel.getProperty('/header');

            expect(header.PurchaseOrderType).toBe('NB');
            expect(header.StatusText).toBe('In Preparation (NB - Incomplete)');
            expect(header.StatusState).toBe('Information');
            expect(header.StatusIcon).toBe('sap-icon://edit');
            expect(header.PurchasingCompletenessStatus).toBe(false);
        });
    });

    describe('computeStatus based on Document Type', () => {
        it('should reflect different document types (NB, ZDOM, FO, UB) when incomplete', () => {
            const testTypes = ['NB', 'ZDOM', 'FO', 'UB', 'EC'];

            testTypes.forEach(type => {
                const oData = {
                    header: {
                        PurchaseOrderType: type,
                        CompanyCode: '1010'
                        // incomplete
                    },
                    items: []
                };

                const status = PurchaseOrderModel.computeStatus(oData);
                expect(status.text).toBe(`In Preparation (${type} - Incomplete)`);
                expect(status.state).toBe('Information');
                expect(status.icon).toBe('sap-icon://edit');
                expect(status.complete).toBe(false);
            });
        });

        it('should return Warning status when Document Type is missing or empty', () => {
            const oDataMissingType = {
                header: {
                    PurchaseOrderType: '',
                    CompanyCode: '1010'
                },
                items: []
            };

            const status = PurchaseOrderModel.computeStatus(oDataMissingType);
            expect(status.text).toBe('Incomplete (Missing Document Type)');
            expect(status.state).toBe('Warning');
            expect(status.icon).toBe('sap-icon://alert');
            expect(status.complete).toBe(false);
        });

        it('should handle null or invalid data safely', () => {
            const statusNull = PurchaseOrderModel.computeStatus(null);
            expect(statusNull.text).toBe('Draft (Incomplete)');
            expect(statusNull.state).toBe('Warning');
            expect(statusNull.complete).toBe(false);

            const statusEmpty = PurchaseOrderModel.computeStatus({});
            expect(statusEmpty.text).toBe('Draft (Incomplete)');
            expect(statusEmpty.complete).toBe(false);
        });

        it('should return Ready to Create (<Type> - Complete) when all required fields and items are valid', () => {
            const oDataComplete = {
                header: {
                    PurchaseOrderType: 'NB',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'EUR',
                    DocumentDate: '2026-09-05'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'TG11',
                        Plant: '1010',
                        StorageLocation: '101A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '5',
                        NetPriceAmount: '100.00'
                    }
                ]
            };

            const status = PurchaseOrderModel.computeStatus(oDataComplete);
            expect(status.text).toBe('Ready to Create (NB - Complete)');
            expect(status.state).toBe('Success');
            expect(status.icon).toBe('sap-icon://accept');
            expect(status.complete).toBe(true);
        });

        it('should handle custom document type when complete', () => {
            const oDataCustom = {
                header: {
                    PurchaseOrderType: 'ZDOM',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'USD',
                    DocumentDate: '2026-09-05'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'TG12',
                        Plant: '1010',
                        StorageLocation: '101A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '10',
                        NetPriceAmount: '50.00'
                    }
                ]
            };

            const status = PurchaseOrderModel.computeStatus(oDataCustom);
            expect(status.text).toBe('Ready to Create (ZDOM - Complete)');
            expect(status.state).toBe('Success');
            expect(status.complete).toBe(true);
        });

        it('should require IncotermsLocation1 when IncotermsClassification is provided', () => {
            const oDataWithInco = {
                header: {
                    PurchaseOrderType: 'NB',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'EUR',
                    DocumentDate: '2026-09-05',
                    IncotermsClassification: 'EXW',
                    IncotermsLocation1: '' // missing location
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'TG11',
                        Plant: '1010',
                        StorageLocation: '101A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '5'
                    }
                ]
            };

            const statusIncomplete = PurchaseOrderModel.computeStatus(oDataWithInco);
            expect(statusIncomplete.complete).toBe(false);
            expect(statusIncomplete.text).toBe('In Preparation (NB - Incomplete)');

            // Add location
            oDataWithInco.header.IncotermsLocation1 = 'BERLIN';
            const statusComplete = PurchaseOrderModel.computeStatus(oDataWithInco);
            expect(statusComplete.complete).toBe(true);
            expect(statusComplete.text).toBe('Ready to Create (NB - Complete)');
        });

        it('should invalidate if item quantity is missing or <= 0', () => {
            const oDataZeroQty = {
                header: {
                    PurchaseOrderType: 'NB',
                    CompanyCode: '1010',
                    PurchasingOrganization: '1010',
                    PurchasingGroup: '001',
                    Supplier: '10300001',
                    Currency: 'EUR',
                    DocumentDate: '2026-09-05'
                },
                items: [
                    {
                        PurchaseOrderItem: '10',
                        Material: 'TG11',
                        Plant: '1010',
                        StorageLocation: '101A',
                        UnitOfMeasure: 'PC',
                        OrderQuantity: '0'
                    }
                ]
            };

            const status = PurchaseOrderModel.computeStatus(oDataZeroQty);
            expect(status.complete).toBe(false);
            expect(status.text).toBe('In Preparation (NB - Incomplete)');
        });
    });

    describe('updateStatus', () => {
        it('should update JSONModel properties correctly when invoked', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            
            // Initial check
            expect(oModel.getProperty('/header/StatusText')).toBe('In Preparation (NB - Incomplete)');

            // Change document type to FO
            oModel.setProperty('/header/PurchaseOrderType', 'FO');
            PurchaseOrderModel.updateStatus(oModel);

            expect(oModel.getProperty('/header/StatusText')).toBe('In Preparation (FO - Incomplete)');
            expect(oModel.getProperty('/header/StatusState')).toBe('Information');

            // Fill all required fields
            oModel.setProperty('/header/CompanyCode', '1010');
            oModel.setProperty('/header/PurchasingOrganization', '1010');
            oModel.setProperty('/header/PurchasingGroup', '001');
            oModel.setProperty('/header/Supplier', '10300001');
            oModel.setProperty('/header/Currency', 'EUR');
            oModel.setProperty('/items/0/Material', 'TG11');
            oModel.setProperty('/items/0/Plant', '1010');
            oModel.setProperty('/items/0/StorageLocation', '101A');
            oModel.setProperty('/items/0/OrderQuantity', '2');

            PurchaseOrderModel.updateStatus(oModel);

            expect(oModel.getProperty('/header/StatusText')).toBe('Ready to Create (FO - Complete)');
            expect(oModel.getProperty('/header/StatusState')).toBe('Success');
            expect(oModel.getProperty('/header/StatusIcon')).toBe('sap-icon://accept');
            expect(oModel.getProperty('/header/PurchasingCompletenessStatus')).toBe(true);
        });

        it('should work with plain JavaScript objects as fallback', () => {
            const rawObj = {
                header: {
                    PurchaseOrderType: 'NB'
                },
                items: []
            };

            const res = PurchaseOrderModel.updateStatus(rawObj);
            expect(res.complete).toBe(false);
            expect(rawObj.header.StatusText).toBe('In Preparation (NB - Incomplete)');
            expect(rawObj.header.PurchasingCompletenessStatus).toBe(false);
        });

        it('should return null if model is falsy', () => {
            expect(PurchaseOrderModel.updateStatus(null)).toBeNull();
        });
    });
});
