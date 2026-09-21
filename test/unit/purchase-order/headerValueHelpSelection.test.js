/**
 * Unit Test: Header Value Help Selection in CreatePurchaseOrder Controller
 * Ensures selecting values from Value Help dialogs updates the newPO model properties.
 */

let CreatePurchaseOrderController;
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

const mockBaseController = {
    extend: function (name, def) {
        return def;
    }
};

const mockMessageBox = {};
const mockMessageToast = { show: jest.fn() };
const mockMessagePopover = function () {};
const mockMessageItem = function () {};
const mockBusyIndicator = {};
const mockFilter = function () {};
const mockFilterOperator = {};
const mockValueHelpService = {};
const mockPurchaseOrderService = {
    getSupplierDefaults: jest.fn().mockResolvedValue({})
};

const originalSap = global.sap;

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                if (deps.includes("sap/ui/model/json/JSONModel")) {
                    PurchaseOrderModel = factory(MockJSONModel);
                } else if (deps.includes("saps4hana/fiori/controller/BaseController")) {
                    CreatePurchaseOrderController = factory(
                        mockBaseController,
                        mockMessageBox,
                        mockMessageToast,
                        mockMessagePopover,
                        mockMessageItem,
                        mockBusyIndicator,
                        mockFilter,
                        mockFilterOperator,
                        PurchaseOrderModel,
                        mockValueHelpService,
                        mockPurchaseOrderService
                    );
                }
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller');
});

afterAll(() => {
    global.sap = originalSap;
});

describe('Unit: CreatePurchaseOrder Controller Header Value Help Selection', () => {
    let controller;
    let oModel;

    beforeEach(() => {
        controller = Object.create(CreatePurchaseOrderController);
        oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
        const mockView = {
            getModel: jest.fn((sName) => (sName === 'newPO' ? oModel : null))
        };
        controller.getView = jest.fn(() => mockView);
        controller.byId = jest.fn();
    });

    it('should set /header/PaymentTerms when inPaymentTerms value help item is selected', () => {
        // Initial state
        expect(oModel.getProperty('/header/PaymentTerms')).toBe('');

        const mockSource = {
            getId: () => 'inPaymentTerms',
            getBindingContext: () => null,
            getBindingPath: () => 'PaymentTerms'
        };

        controller._handleValueHelpSelected(mockSource, '0002', { getDescription: () => '14 days 2%' });

        expect(oModel.getProperty('/header/PaymentTerms')).toBe('0002');
        expect(oModel.getProperty('/userModified/PaymentTerms')).toBe(true);
    });

    it('should set /header/PurchaseOrderType when inDocType value help item is selected', () => {
        const mockSource = {
            getId: () => 'inDocType',
            getBindingContext: () => null,
            getBindingPath: () => 'PurchaseOrderType'
        };

        controller._handleValueHelpSelected(mockSource, 'NB', {});

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('NB');
        expect(oModel.getProperty('/userModified/PurchaseOrderType')).toBe(true);
    });

    it('should set /header/CompanyCode when inCompanyCode value help item is selected', () => {
        const mockSource = {
            getId: () => 'inCompanyCode',
            getBindingContext: () => null,
            getBindingPath: () => 'CompanyCode'
        };

        controller._handleValueHelpSelected(mockSource, '1000', {});

        expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
        expect(oModel.getProperty('/userModified/CompanyCode')).toBe(true);
    });

    it('should set /header/PurchasingOrganization when inPurchOrg value help item is selected', () => {
        const mockSource = {
            getId: () => 'inPurchOrg',
            getBindingContext: () => null,
            getBindingPath: () => 'PurchasingOrganization'
        };

        controller._handleValueHelpSelected(mockSource, 'AE01', {});

        expect(oModel.getProperty('/header/PurchasingOrganization')).toBe('AE01');
        expect(oModel.getProperty('/userModified/PurchasingOrganization')).toBe(true);
    });

    it('should set /header/PurchasingGroup when inPurchGrp value help item is selected', () => {
        const mockSource = {
            getId: () => 'inPurchGrp',
            getBindingContext: () => null,
            getBindingPath: () => 'PurchasingGroup'
        };

        controller._handleValueHelpSelected(mockSource, '104', {});

        expect(oModel.getProperty('/header/PurchasingGroup')).toBe('104');
        expect(oModel.getProperty('/userModified/PurchasingGroup')).toBe(true);
    });

    it('should set /header/Currency when inCurrency value help item is selected', () => {
        const mockSource = {
            getId: () => 'inCurrency',
            getBindingContext: () => null,
            getBindingPath: () => 'Currency'
        };

        controller._handleValueHelpSelected(mockSource, 'INR', {});

        expect(oModel.getProperty('/header/Currency')).toBe('INR');
        expect(oModel.getProperty('/userModified/Currency')).toBe(true);
    });

    it('should set /header/IncotermsClassification when inIncoterms value help item is selected', () => {
        const mockSource = {
            getId: () => 'inIncoterms',
            getBindingContext: () => null,
            getBindingPath: () => 'IncotermsClassification'
        };

        controller._handleValueHelpSelected(mockSource, 'EXW', {});

        expect(oModel.getProperty('/header/IncotermsClassification')).toBe('EXW');
        expect(oModel.getProperty('/userModified/IncotermsClassification')).toBe(true);
    });

    it('should set /header/Supplier and derive defaults when inSupplier value help item is selected', () => {
        const mockSource = {
            getId: () => 'inSupplier',
            getBindingContext: () => null,
            getBindingPath: () => 'Supplier'
        };

        controller._handleValueHelpSelected(mockSource, '100102', {}, { CompanyCode: '1000' });

        expect(oModel.getProperty('/header/Supplier')).toBe('100102');
        expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
        expect(oModel.getProperty('/userModified/Supplier')).toBe(true);
    });
});
