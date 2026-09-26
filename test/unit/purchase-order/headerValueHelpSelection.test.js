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
        return Object.assign({
            getText: function (sKey, aArgs, sFallback) {
                if (sFallback !== undefined) {
                    let res = sFallback;
                    if (Array.isArray(aArgs)) {
                        aArgs.forEach((arg, i) => {
                            res = res.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
                        });
                    }
                    return res;
                }
                return sKey;
            }
        }, def);
    }
};

const mockMessageBox = {};
const mockMessageToast = { show: jest.fn() };
const mockMessagePopover = function () {};
const mockMessageItem = function () {};
const mockBusyIndicator = {};
const mockFilter = function (sPath, sOperator, sValue) {
    this.sPath = sPath;
    this.sOperator = sOperator;
    this.sValue = sValue;
};
const mockFilterOperator = {
    EQ: 'EQ',
    StartsWith: 'StartsWith',
    Contains: 'Contains'
};
const mockValueHelpService = {};
const mockPurchaseOrderService = {
    getSupplierDefaults: jest.fn().mockResolvedValue({}),
    getMaterialDetails: jest.fn().mockResolvedValue(null),
    loadConfiguration: jest.fn().mockResolvedValue({
        documentTypes: [{ PurchasingDocumentType: 'ZDOM', PurchasingDocumentType_Text: 'Dom. Aether In.LTD.' }],
        companyCodes: [{ CompanyCode: '1010', CompanyCodeName: 'Aether India' }],
        purchasingOrgs: [{ PurchasingOrganization: '1010', PurchasingOrganizationName: 'PO Org 1010' }],
        purchasingGroups: [{ PurchasingGroup: '001', PurchasingGroupName: 'Group 001' }]
    })
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
            getModel: jest.fn((sName) => (sName === 'newPO' ? oModel : null)),
            setModel: jest.fn()
        };
        controller.getView = jest.fn(() => mockView);
        controller.getModel = jest.fn((sName) => (sName === 'newPO' ? oModel : (!sName ? { name: 'defaultODataModel' } : null)));
        controller.byId = jest.fn();
        controller.getText = jest.fn((sKey, aArgs, sFallback) => {
            if (sFallback !== undefined) {
                let res = sFallback;
                if (Array.isArray(aArgs)) {
                    aArgs.forEach((arg, i) => {
                        res = res.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
                    });
                }
                return res;
            }
            return sKey;
        });
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

        controller._handleValueHelpSelected(mockSource, 'ZCAP', {
            getDescription: () => 'Asset PO'
        });

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZCAP');
        expect(oModel.getProperty('/header/PurchaseOrderTypeText')).toBe('Asset PO');
        expect(oModel.getProperty('/userModified/PurchaseOrderType')).toBe(true);
    });

    it('should set /header/PurchaseOrderType to ZDOM and PurchaseOrderTypeText to Dom. Aether In.LTD. when inDocType value help is selected', () => {
        const mockSource = {
            getId: () => 'inDocType',
            getBindingContext: () => null,
            getBindingPath: () => 'PurchaseOrderType'
        };

        controller._handleValueHelpSelected(mockSource, 'ZDOM', {
            getDescription: () => 'Dom. Aether In.LTD.'
        });

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZDOM');
        expect(oModel.getProperty('/header/PurchaseOrderTypeText')).toBe('Dom. Aether In.LTD.');
        expect(oModel.getProperty('/userModified/PurchaseOrderType')).toBe(true);
    });

    it('should set /header/PurchaseOrderType to ZDOS and description when inDocType value help is selected', () => {
        const mockSource = {
            getId: () => 'inDocType',
            getBindingContext: () => null,
            getBindingPath: () => 'PurchaseOrderType'
        };

        controller._handleValueHelpSelected(mockSource, 'ZDOS', {
            getDescription: () => 'Dom.Aether Spec.Chem'
        });

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZDOS');
        expect(oModel.getProperty('/header/PurchaseOrderTypeText')).toBe('Dom.Aether Spec.Chem');
        expect(oModel.getProperty('/userModified/PurchaseOrderType')).toBe(true);
    });

    it('should build context filter with StartsWith Z for inDocType', () => {
        const mockSource = {
            getId: () => 'inDocType',
            getBindingContext: () => null,
            getBindingPath: () => 'PurchaseOrderType'
        };

        const filters = controller._buildContextFilters(mockSource);
        expect(filters).toHaveLength(1);
        expect(filters[0].sPath).toBe('PurchasingDocumentType');
        expect(filters[0].sOperator).toBe('StartsWith');
        expect(filters[0].sValue).toBe('Z');
    });

    it('should set ZDOM and Dom. Aether In.LTD. on suggestion item selection', () => {
        const mockEvent = {
            getParameter: (param) => {
                if (param === 'selectedItem') {
                    return {
                        getKey: () => 'ZDOM',
                        getText: () => 'ZDOM',
                        getAdditionalText: () => 'Dom. Aether In.LTD.'
                    };
                }
                return null;
            }
        };

        controller.onDocTypeSelect(mockEvent);

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZDOM');
        expect(oModel.getProperty('/header/PurchaseOrderTypeText')).toBe('Dom. Aether In.LTD.');
        expect(oModel.getProperty('/errors/PurchaseOrderType/state')).toBe('None');
    });

    it('should reject invalid document types and restrict to Z-related types', () => {
        const mockEvent = {
            getParameter: (param) => (param === 'value' ? 'INVALID' : null)
        };

        controller.onDocTypeChange(mockEvent);

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('');
        expect(oModel.getProperty('/errors/PurchaseOrderType/state')).toBe('Error');
        expect(oModel.getProperty('/errors/PurchaseOrderType/text')).toContain("Z-related");
    });

    it('should accept any valid Z-type such as ZCAP or ZDOS', () => {
        const mockEvent = {
            getParameter: (param) => (param === 'value' ? 'ZCAP' : null)
        };

        controller.onDocTypeChange(mockEvent);

        expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZCAP');
        expect(oModel.getProperty('/errors/PurchaseOrderType/state')).toBe('None');
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

    describe('Field Resolution and Routing Robustness (_resolveSourceField & customData)', () => {
        it('should resolve field via data("field") regardless of control ID', () => {
            const mockSource = {
                getId: () => '__input999_unrelated_id',
                data: (key) => (key === 'field' ? 'Material' : null),
                getBindingPath: () => null
            };

            const sField = controller._resolveSourceField(mockSource);
            expect(sField).toBe('Material');
        });

        it('should resolve field via getBindingPath("value") when data("field") is absent', () => {
            const mockSource = {
                getId: () => '__input123',
                data: () => null,
                getBindingPath: (prop) => (prop === 'value' ? '/items/0/Plant' : null)
            };

            const sField = controller._resolveSourceField(mockSource);
            expect(sField).toBe('Plant');
        });

        it('should resolve field via FIELD_ID_MAP for standard header controls', () => {
            const mockSource = {
                getId: () => 'myView--inPurchOrg',
                data: () => null,
                getBindingPath: () => null
            };

            const sField = controller._resolveSourceField(mockSource);
            expect(sField).toBe('PurchasingOrganization');
        });

        it('should route line item value-help selection using customData data("field")', () => {
            oModel.setProperty('/items', [{ Plant: '', errors: {} }]);
            const mockRowContext = {
                getPath: () => '/items/0',
                getProperty: (prop) => (prop === 'Plant' ? '' : undefined)
            };
            const mockSource = {
                getId: () => '__input_generic_id',
                data: (key) => (key === 'field' ? 'Plant' : null),
                getBindingContext: (name) => (name === 'newPO' ? mockRowContext : null)
            };

            controller._handleValueHelpSelected(mockSource, '1010', {});

            expect(oModel.getProperty('/items/0/Plant')).toBe('1010');
            expect(oModel.getProperty('/items/0/errors/Plant/state')).toBe('None');
        });

        it('should build line item context filter for Material using Plant from row context', () => {
            const mockRowContext = {
                getProperty: (prop) => (prop === 'Plant' ? '1010' : undefined)
            };
            const mockSource = {
                getId: () => '__input_mat_generic',
                data: (key) => (key === 'field' ? 'Material' : null),
                getBindingContext: (name) => (name === 'newPO' ? mockRowContext : null)
            };

            const aFilters = controller._buildContextFilters(mockSource);
            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe('Plant');
            expect(aFilters[0].sValue).toBe('1010');
        });

        it('should build header context filter for PurchaseOrderType restricting to Z*', () => {
            const mockSource = {
                getId: () => 'inDocType',
                data: (key) => (key === 'field' ? 'PurchaseOrderType' : null),
                getBindingContext: () => null
            };

            const aFilters = controller._buildContextFilters(mockSource);
            expect(aFilters.length).toBe(1);
            expect(aFilters[0].sPath).toBe('PurchasingDocumentType');
            expect(aFilters[0].sOperator).toBe('StartsWith');
            expect(aFilters[0].sValue).toBe('Z');
        });
    });

    describe('Rendering Hooks & Timing Robustness (_whenRendered, _openMessagePopover, _navigateToErrorTarget)', () => {
        it('should resolve _whenRendered immediately if DOM reference exists', async () => {
            const mockControl = {
                getDomRef: () => ({ id: 'mockDom' })
            };

            const result = await controller._whenRendered(mockControl);
            expect(result).toBe(mockControl);
        });

        it('should attach onAfterRendering event delegate if DOM reference is not yet ready', async () => {
            let registeredDelegate = null;
            let removedDelegate = null;
            const mockControl = {
                getDomRef: jest.fn().mockReturnValueOnce(null).mockReturnValue({ id: 'mockDomLater' }),
                addEventDelegate: (delegate) => {
                    registeredDelegate = delegate;
                },
                removeEventDelegate: (delegate) => {
                    removedDelegate = delegate;
                }
            };

            const renderPromise = controller._whenRendered(mockControl);
            expect(registeredDelegate).toBeDefined();
            expect(typeof registeredDelegate.onAfterRendering).toBe('function');

            // Trigger the onAfterRendering lifecycle callback
            registeredDelegate.onAfterRendering();
            const result = await renderPromise;

            expect(result).toBe(mockControl);
            expect(removedDelegate).toBe(registeredDelegate);
        });

        it('should open MessagePopover once button is rendered without setTimeout race', async () => {
            const mockDom = { id: 'btnMessagesDom' };
            const mockBtn = {
                getDomRef: () => mockDom
            };
            const mockPopover = {
                isOpen: () => false,
                openBy: jest.fn()
            };

            controller.byId = (sId) => (sId === 'btnMessages' ? mockBtn : null);
            controller._oMessagePopover = mockPopover;

            controller._openMessagePopover();

            // Allow microtasks to process
            await Promise.resolve();

            expect(mockPopover.openBy).toHaveBeenCalledWith(mockBtn);
        });

        it('should focus and scroll into view target header control when error target is navigated', async () => {
            const focusSpy = jest.fn();
            const scrollSpy = jest.fn();
            const mockHeaderInput = {
                focus: focusSpy,
                getDomRef: () => ({
                    scrollIntoView: scrollSpy
                })
            };

            controller.byId = (sId) => (sId === 'inSupplier' ? mockHeaderInput : null);

            controller._navigateToErrorTarget({ controlId: 'inSupplier' });

            await Promise.resolve();

            expect(focusSpy).toHaveBeenCalled();
            expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        });

        it('should focus and scroll into view target table cell when item error target is navigated', async () => {
            const cellFocusSpy = jest.fn();
            const cellScrollSpy = jest.fn();
            const mockCell = {
                focus: cellFocusSpy,
                getDomRef: () => ({
                    scrollIntoView: cellScrollSpy
                })
            };
            const mockRow = {
                getCells: () => [{}, {}, mockCell]
            };
            const mockTable = {
                getDomRef: () => ({ id: 'tableDom' }),
                getItems: () => [mockRow]
            };

            controller.byId = (sId) => (sId === 'poItemsTable' ? mockTable : null);

            controller._navigateToErrorTarget({
                controlId: 'poItemsTable',
                itemIndex: 0,
                cellIndex: 2
            });

            await Promise.resolve();
            await Promise.resolve();

            expect(cellFocusSpy).toHaveBeenCalled();
            expect(cellScrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        });
    });

    describe('Consistent Model Retrieval (Item 6)', () => {
        it('should pass default unnamed model to PurchaseOrderService.getMaterialDetails in onItemMaterialSelect', async () => {
            const defaultModel = { name: 'defaultODataModel' };
            controller.getModel = jest.fn((sName) => (sName === 'newPO' ? oModel : (!sName ? defaultModel : null)));

            mockPurchaseOrderService.getMaterialDetails.mockClear();
            mockPurchaseOrderService.getMaterialDetails.mockResolvedValueOnce({
                Material: 'MAT01',
                MaterialBaseUnit: 'EA',
                MaterialGroup: 'L001'
            });

            const mockContext = {
                getPath: () => '/items/0',
                getProperty: () => ''
            };
            const mockSource = {
                getBindingContext: (name) => (name === 'newPO' ? mockContext : null)
            };
            const mockEvent = {
                getSource: () => mockSource,
                getParameter: (param) => (param === 'selectedItem' ? {
                    getKey: () => 'MAT01',
                    getText: () => 'MAT01',
                    getBindingContext: () => null
                } : null)
            };

            controller.onItemMaterialSelect(mockEvent);

            await Promise.resolve();

            expect(controller.getModel).toHaveBeenCalledWith();
            expect(mockPurchaseOrderService.getMaterialDetails).toHaveBeenCalledWith(defaultModel, 'MAT01', '');
        });

        it('should pass default unnamed model to PurchaseOrderService.getMaterialDetails in _handleValueHelpSelected', async () => {
            const defaultModel = { name: 'defaultODataModel' };
            controller.getModel = jest.fn((sName) => (sName === 'newPO' ? oModel : (!sName ? defaultModel : null)));

            mockPurchaseOrderService.getMaterialDetails.mockClear();
            mockPurchaseOrderService.getMaterialDetails.mockResolvedValueOnce({
                Material: 'MAT02',
                MaterialBaseUnit: 'KG',
                MaterialGroup: 'L002'
            });

            const mockRowContext = {
                getPath: () => '/items/0',
                getProperty: () => ''
            };
            const mockSource = {
                data: (key) => (key === 'field' ? 'Material' : null),
                getBindingContext: (name) => (name === 'newPO' ? mockRowContext : null)
            };

            controller._handleValueHelpSelected(mockSource, 'MAT02', null, null);

            await Promise.resolve();

            expect(controller.getModel).toHaveBeenCalledWith();
            expect(mockPurchaseOrderService.getMaterialDetails).toHaveBeenCalledWith(defaultModel, 'MAT02', '');
        });
    });

    describe('Purchase Order Localization & i18n Handling (Audit 7)', () => {
        it('should resolve localized error titles and messages in _getErrorMessageConfig', () => {
            const mockErr401 = { status: 401 };
            const cfg401 = controller._getErrorMessageConfig(mockErr401);
            expect(controller.getText).toHaveBeenCalledWith('poErrTitleAuthFailed', null, 'Authentication Failed');
            expect(controller.getText).toHaveBeenCalledWith('poErrMsgAuthFailed', null, 'Your session is unauthenticated or has expired. Please log in again.');
            expect(cfg401.title).toBe('Authentication Failed');
            expect(cfg401.message).toContain('session is unauthenticated');

            const mockErr409 = { status: 409 };
            const cfg409 = controller._getErrorMessageConfig(mockErr409);
            expect(controller.getText).toHaveBeenCalledWith('poErrTitleLocked', null, 'Document Locked / Conflict');
            expect(cfg409.title).toBe('Document Locked / Conflict');
            expect(cfg409.message).toContain('locked in SAP S/4HANA');

            const mockErr502 = { status: 502 };
            const cfg502 = controller._getErrorMessageConfig(mockErr502);
            expect(controller.getText).toHaveBeenCalledWith('poErrTitleUnavailable', null, 'S/4HANA Backend Unavailable');
            expect(cfg502.title).toBe('S/4HANA Backend Unavailable');
        });

        it('PurchaseOrderModel should support custom text resolver and fallback gracefully', () => {
            const mockResolver = jest.fn((key, args, fallback) => {
                if (key === 'poValDocTypeRequired') return 'Benötigt (DE)';
                return fallback;
            });

            PurchaseOrderModel.setTextResolver(mockResolver);

            const sResolved = PurchaseOrderModel.getText('poValDocTypeRequired', null, 'Document Type is required.');
            expect(sResolved).toBe('Benötigt (DE)');
            expect(mockResolver).toHaveBeenCalled();

            // Clear resolver
            PurchaseOrderModel.setTextResolver(null);
            const sFallback = PurchaseOrderModel.getText('poValDocTypeRequired', null, 'Document Type is required.');
            expect(sFallback).toBe('Document Type is required.');
        });

        it('should show localized toast when supplier defaults are applied', async () => {
            mockMessageToast.show.mockClear();
            mockPurchaseOrderService.getSupplierDefaults.mockResolvedValueOnce({
                Currency: 'USD',
                PaymentTerms: '0001',
                derived: true,
                source: 'from last PO'
            });

            oModel.setProperty('/header/CompanyCode', '1010');
            oModel.setProperty('/header/PurchasingOrganization', '1010');

            controller._deriveSupplierData('10300001');

            await Promise.resolve();
            await Promise.resolve();

            expect(mockMessageToast.show).toHaveBeenCalled();
            expect(mockMessageToast.show.mock.calls[0][0]).toContain('Supplier defaults applied');
        });

        it('PurchaseOrderModel.isValidDocType should enforce Z-prefix and max length 4', () => {
            expect(PurchaseOrderModel.isValidDocType('ZDOM')).toBe(true);
            expect(PurchaseOrderModel.isValidDocType('ZCAP')).toBe(true);
            expect(PurchaseOrderModel.isValidDocType('z123')).toBe(true);
            expect(PurchaseOrderModel.isValidDocType('Z1')).toBe(true);
            expect(PurchaseOrderModel.isValidDocType('NB')).toBe(false);
            expect(PurchaseOrderModel.isValidDocType('FO')).toBe(false);
            expect(PurchaseOrderModel.isValidDocType('ZTOOLONG')).toBe(false);
            expect(PurchaseOrderModel.isValidDocType('')).toBe(false);
            expect(PurchaseOrderModel.isValidDocType(null)).toBe(false);
        });

        it('PurchaseOrderModel.validateDocType should return structured validation result', () => {
            const validResult = PurchaseOrderModel.validateDocType('ZDOM');
            expect(validResult.valid).toBe(true);
            expect(validResult.state).toBe('None');
            expect(validResult.text).toBe('');

            const emptyResult = PurchaseOrderModel.validateDocType('');
            expect(emptyResult.valid).toBe(false);
            expect(emptyResult.state).toBe('Error');
            expect(emptyResult.text).toContain('Document Type is required');

            const invalidResult = PurchaseOrderModel.validateDocType('NB');
            expect(invalidResult.valid).toBe(false);
            expect(invalidResult.state).toBe('Error');
            expect(invalidResult.text).toContain('Only Z-related document types');
        });

        it('PurchaseOrderModel.setDocumentType should set valid doc type and update model state', () => {
            const testModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            PurchaseOrderModel.setDocumentType(testModel, 'ZCAP', null, 'Capital Goods PO');

            expect(testModel.getProperty('/header/PurchaseOrderType')).toBe('ZCAP');
            expect(testModel.getProperty('/header/PurchaseOrderTypeText')).toBe('Capital Goods PO');
            expect(testModel.getProperty('/errors/PurchaseOrderType/state')).toBe('None');
            expect(testModel.getProperty('/userModified/PurchaseOrderType')).toBe(true);
        });

        it('PurchaseOrderModel.setDocumentType should reject invalid type and set error state', () => {
            const testModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            PurchaseOrderModel.setDocumentType(testModel, 'INVALID');

            expect(testModel.getProperty('/header/PurchaseOrderType')).toBe('');
            expect(testModel.getProperty('/errors/PurchaseOrderType/state')).toBe('Error');
            expect(testModel.getProperty('/errors/PurchaseOrderType/text')).toContain('Only Z-related document types');
        });
    });

    describe('Item Operations & Defensive Null-Safety (Audit 9)', () => {
        it('onDeleteItem should safely handle null or malformed event objects', () => {
            expect(() => controller.onDeleteItem(null)).not.toThrow();
            expect(() => controller.onDeleteItem({})).not.toThrow();
            expect(() => controller.onDeleteItem({ getParameter: () => null })).not.toThrow();
            expect(() => controller.onDeleteItem({ getParameter: () => ({}) })).not.toThrow();
            expect(() => controller.onDeleteItem({ getParameter: () => ({ getBindingContext: () => null }) })).not.toThrow();
            expect(() => controller.onDeleteItem({ getParameter: () => ({ getBindingContext: () => ({ getPath: () => '' }) }) })).not.toThrow();
            expect(() => controller.onDeleteItem({ getParameter: () => ({ getBindingContext: () => ({ getPath: () => '/items/invalid' }) }) })).not.toThrow();
        });

        it('onDeleteItem should delete item when valid event and context are provided', () => {
            oModel.setProperty('/items', [
                { PurchaseOrderItem: '10', Material: 'TG11' },
                { PurchaseOrderItem: '20', Material: 'TG12' }
            ]);

            const mockDeleteEvent = {
                getParameter: (param) => {
                    if (param === 'listItem') {
                        return {
                            getBindingContext: (sModel) => {
                                if (sModel === 'newPO') {
                                    return {
                                        getPath: () => '/items/0'
                                    };
                                }
                                return null;
                            }
                        };
                    }
                    return null;
                }
            };

            controller.onDeleteItem(mockDeleteEvent);

            const remainingItems = oModel.getProperty('/items');
            expect(remainingItems.length).toBe(1);
            expect(remainingItems[0].Material).toBe('TG12');
            expect(remainingItems[0].PurchaseOrderItem).toBe('10');
        });

        it('onCalculateNetAmount should safely handle null event or missing source context', () => {
            expect(() => controller.onCalculateNetAmount(null)).not.toThrow();
            expect(() => controller.onCalculateNetAmount({})).not.toThrow();
            expect(() => controller.onCalculateNetAmount({ getSource: () => null })).not.toThrow();
            expect(() => controller.onCalculateNetAmount({ getSource: () => ({ getBindingContext: () => null }) })).not.toThrow();
        });
    });

    describe('Fresh Configuration Loading & Stale Cache Elimination (Audit 10)', () => {
        it('should refetch configuration from backend on subsequent route entries rather than freezing stale cache', async () => {
            mockPurchaseOrderService.loadConfiguration.mockClear();

            // First load
            await controller._loadConfigurationAndDefaults();
            expect(mockPurchaseOrderService.loadConfiguration).toHaveBeenCalledTimes(1);

            // Second load (simulating subsequent route entry)
            await controller._loadConfigurationAndDefaults();
            expect(mockPurchaseOrderService.loadConfiguration).toHaveBeenCalledTimes(2);

            // Re-matching pattern route should trigger model reset and fresh configuration fetch
            controller._onRouteMatched();
            await Promise.resolve();
            expect(mockPurchaseOrderService.loadConfiguration).toHaveBeenCalledTimes(3);
        });

        it('should clear _oConfigData on controller exit to prevent stale retention', () => {
            controller._oConfigData = { documentTypes: [] };
            controller.onExit();
            expect(controller._oConfigData).toBeNull();
        });
    });

    describe('Default PurchaseOrderType Consistency Across Layers (Audit Item 6)', () => {
        it('HEADER_FIELD_CONFIG should specify ZDOM as example document type, not NB', () => {
            expect(PurchaseOrderModel.HEADER_FIELD_CONFIG.PurchaseOrderType.example).toBe('ZDOM');
        });

        it('_resetModel should initialize clean model without hardcoding PurchaseOrderType before configuration', () => {
            controller.getOwnerComponent = jest.fn(() => ({
                getModel: jest.fn(() => null)
            }));
            controller._resetModel(false);
            const oNewModel = controller.getView().setModel.mock.calls[0][0];
            expect(oNewModel.getProperty('/header/PurchaseOrderType')).toBe('');
            expect(oNewModel.getProperty('/header/PurchaseOrderTypeText')).toBe('');
        });

        it('_loadConfigurationAndDefaults should apply DEFAULT_DOC_TYPE (ZDOM) when confirmed in config', async () => {
            const mockConfig = {
                documentTypes: [
                    { PurchasingDocumentType: 'ZDOM', PurchasingDocumentType_Text: 'Dom. Aether In.LTD.' },
                    { PurchasingDocumentType: 'ZCAP', PurchasingDocumentType_Text: 'Capital Goods PO' }
                ],
                companyCodes: [],
                purchasingOrgs: [],
                purchasingGroups: []
            };
            mockPurchaseOrderService.loadConfiguration.mockResolvedValueOnce(mockConfig);

            await controller._loadConfigurationAndDefaults(true);

            expect(oModel.getProperty('/header/PurchaseOrderType')).toBe('ZDOM');
            expect(oModel.getProperty('/header/PurchaseOrderTypeText')).toBe('Dom. Aether In.LTD.');
            expect(oModel.getProperty('/configDerived/PurchaseOrderType')).toBe(true);
        });

        it('_loadConfigurationAndDefaults should NOT set ZDOM if ZDOM is not in backend documentTypes', async () => {
            const freshModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            controller.getView = jest.fn(() => ({
                getModel: jest.fn((sName) => (sName === 'newPO' ? freshModel : null)),
                setModel: jest.fn()
            }));

            const unconfirmedConfig = {
                documentTypes: [
                    { PurchasingDocumentType: 'ZCAP', PurchasingDocumentType_Text: 'Capital Goods PO' }
                ],
                companyCodes: [],
                purchasingOrgs: [],
                purchasingGroups: []
            };
            mockPurchaseOrderService.loadConfiguration.mockResolvedValueOnce(unconfirmedConfig);

            await controller._loadConfigurationAndDefaults(true);

            expect(freshModel.getProperty('/header/PurchaseOrderType')).toBe('');
            expect(freshModel.getProperty('/configDerived/PurchaseOrderType')).toBe(false);
        });
    });

    describe('Domestic Supplier Filtering for ZDOM', () => {
        it('should build context filter with SupplierAccountGroup EQ ZDOM and CompanyCode for inSupplier when docType is ZDOM', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZDOM');
            oModel.setProperty('/header/CompanyCode', '1000');

            const mockSource = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier'
            };

            const filters = controller._buildContextFilters(mockSource);
            expect(filters).toHaveLength(2);
            expect(filters[0].sPath).toBe('CompanyCode');
            expect(filters[0].sOperator).toBe('EQ');
            expect(filters[0].sValue).toBe('1000');

            expect(filters[1].sPath).toBe('SupplierAccountGroup');
            expect(filters[1].sOperator).toBe('EQ');
            expect(filters[1].sValue).toBe('ZDOM');
        });

        it('should NOT add SupplierAccountGroup filter for inSupplier when docType is not ZDOM (e.g. ZINT)', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZINT');
            oModel.setProperty('/header/CompanyCode', '1000');

            const mockSource = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier'
            };

            const filters = controller._buildContextFilters(mockSource);
            expect(filters).toHaveLength(1);
            expect(filters[0].sPath).toBe('CompanyCode');
            expect(filters[0].sOperator).toBe('EQ');
            expect(filters[0].sValue).toBe('1000');
        });

        it('should build SupplierAccountGroup EQ ZDOM filter when docType is ZDOM and CompanyCode is empty', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZDOM');
            oModel.setProperty('/header/CompanyCode', '');

            const mockSource = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier'
            };

            const filters = controller._buildContextFilters(mockSource);
            expect(filters).toHaveLength(1);
            expect(filters[0].sPath).toBe('SupplierAccountGroup');
            expect(filters[0].sOperator).toBe('EQ');
            expect(filters[0].sValue).toBe('ZDOM');
        });

        it('should refresh supplier suggestion binding via _refreshSupplierBinding', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZDOM');
            oModel.setProperty('/header/CompanyCode', '1000');

            const mockBinding = {
                filter: jest.fn()
            };
            const mockSupplierInput = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier',
                getBinding: jest.fn((name) => (name === 'suggestionItems' ? mockBinding : null))
            };
            controller.byId = jest.fn((sId) => (sId === 'inSupplier' ? mockSupplierInput : null));

            controller._refreshSupplierBinding();

            expect(mockSupplierInput.getBinding).toHaveBeenCalledWith('suggestionItems');
            expect(mockBinding.filter).toHaveBeenCalled();
            const appliedFilters = mockBinding.filter.mock.calls[0][0];
            expect(appliedFilters).toHaveLength(2);
            expect(appliedFilters[1].sPath).toBe('SupplierAccountGroup');
            expect(appliedFilters[1].sValue).toBe('ZDOM');
        });

        it('should display warning on Supplier if docType changes to ZDOM while an internal/non-domestic supplier was chosen', () => {
            oModel.setProperty('/header/Supplier', '1110');
            oModel.setProperty('/header/SupplierAccountGroup', 'ZINT');

            controller._onDocTypeSelectedCheck('ZDOM');

            expect(oModel.getProperty('/errors/Supplier/state')).toBe('Warning');
            expect(oModel.getProperty('/errors/Supplier/text')).toContain('not a domestic supplier');
        });

        it('should capture SupplierAccountGroup from oData when supplier is selected from Value Help', () => {
            const mockSource = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier'
            };
            const mockData = {
                Supplier: '100002',
                SupplierName: 'New A V Sons Super Store Pvt Ltd',
                CompanyCode: '1000',
                SupplierAccountGroup: 'ZDOM'
            };

            controller._handleValueHelpSelected(mockSource, '100002', null, mockData);

            expect(oModel.getProperty('/header/Supplier')).toBe('100002');
            expect(oModel.getProperty('/header/SupplierAccountGroup')).toBe('ZDOM');
            expect(oModel.getProperty('/header/CompanyCode')).toBe('1000');
        });

        it('should build context filter with CompanyCode EQ 1000 for inCompanyCode when docType is ZDOM', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZDOM');

            const mockSource = {
                getId: () => 'inCompanyCode',
                getBindingContext: () => null,
                getBindingPath: () => 'CompanyCode'
            };

            const filters = controller._buildContextFilters(mockSource);
            expect(filters).toHaveLength(1);
            expect(filters[0].sPath).toBe('CompanyCode');
            expect(filters[0].sOperator).toBe('EQ');
            expect(filters[0].sValue).toBe('1000');
        });

        it('should NOT add CompanyCode filter for inCompanyCode when docType is not ZDOM (e.g. ZINT)', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZINT');

            const mockSource = {
                getId: () => 'inCompanyCode',
                getBindingContext: () => null,
                getBindingPath: () => 'CompanyCode'
            };

            const filters = controller._buildContextFilters(mockSource);
            expect(filters).toHaveLength(0);
        });

        it('should refresh company suggestion binding via _refreshCompanyCodeBinding', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZDOM');

            const mockBinding = {
                filter: jest.fn()
            };
            const mockCompanyInput = {
                getId: () => 'inCompanyCode',
                getBindingContext: () => null,
                getBindingPath: () => 'CompanyCode',
                getBinding: jest.fn((name) => (name === 'suggestionItems' ? mockBinding : null))
            };
            controller.byId = jest.fn((sId) => (sId === 'inCompanyCode' ? mockCompanyInput : null));

            controller._refreshCompanyCodeBinding();

            expect(mockCompanyInput.getBinding).toHaveBeenCalledWith('suggestionItems');
            expect(mockBinding.filter).toHaveBeenCalled();
            const appliedFilters = mockBinding.filter.mock.calls[0][0];
            expect(appliedFilters).toHaveLength(1);
            expect(appliedFilters[0].sPath).toBe('CompanyCode');
            expect(appliedFilters[0].sValue).toBe('1000');
        });

        it('should display warning on CompanyCode if docType changes to ZDOM while a non-1000 company code is selected', () => {
            oModel.setProperty('/header/CompanyCode', '2000');

            controller._onDocTypeSelectedCheck('ZDOM');

            expect(oModel.getProperty('/errors/CompanyCode/state')).toBe('Warning');
            expect(oModel.getProperty('/errors/CompanyCode/text')).toContain('not a domestic company');
        });
    });

    describe('Internal Plant Supplier Filtering for ZSTO', () => {
        it('should build context filter with SupplierAccountGroup EQ ZINT and CompanyCode for inSupplier when docType is ZSTO', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZSTO');
            oModel.setProperty('/header/CompanyCode', '1000');

            const mockSource = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier'
            };

            const filters = controller._buildContextFilters(mockSource);
            expect(filters).toHaveLength(2);
            expect(filters[0].sPath).toBe('CompanyCode');
            expect(filters[0].sOperator).toBe('EQ');
            expect(filters[0].sValue).toBe('1000');

            expect(filters[1].sPath).toBe('SupplierAccountGroup');
            expect(filters[1].sOperator).toBe('EQ');
            expect(filters[1].sValue).toBe('ZINT');
        });

        it('should refresh supplier suggestion binding with ZINT filter when docType is ZSTO', () => {
            oModel.setProperty('/header/PurchaseOrderType', 'ZSTO');
            oModel.setProperty('/header/CompanyCode', '1000');

            const mockBinding = {
                filter: jest.fn()
            };
            const mockSupplierInput = {
                getId: () => 'inSupplier',
                getBindingContext: () => null,
                getBindingPath: () => 'Supplier',
                getBinding: jest.fn((name) => (name === 'suggestionItems' ? mockBinding : null))
            };
            controller.byId = jest.fn((sId) => (sId === 'inSupplier' ? mockSupplierInput : null));

            controller._refreshSupplierBinding();

            expect(mockSupplierInput.getBinding).toHaveBeenCalledWith('suggestionItems');
            expect(mockBinding.filter).toHaveBeenCalled();
            const appliedFilters = mockBinding.filter.mock.calls[0][0];
            expect(appliedFilters).toHaveLength(2);
            expect(appliedFilters[1].sPath).toBe('SupplierAccountGroup');
            expect(appliedFilters[1].sValue).toBe('ZINT');
        });

        it('should display warning on Supplier if docType changes to ZSTO while a non-internal supplier was chosen', () => {
            oModel.setProperty('/header/Supplier', '100002');
            oModel.setProperty('/header/SupplierAccountGroup', 'ZDOM');

            controller._onDocTypeSelectedCheck('ZSTO');

            expect(oModel.getProperty('/errors/Supplier/state')).toBe('Warning');
            expect(oModel.getProperty('/errors/Supplier/text')).toContain('not an internal plant');
        });

        it('should not display warning on Supplier if docType is ZSTO and chosen supplier is an internal plant (ZINT)', () => {
            oModel.setProperty('/header/Supplier', '1110');
            oModel.setProperty('/header/SupplierAccountGroup', 'ZINT');
            oModel.setProperty('/errors/Supplier', { state: 'None', text: '' });

            controller._onDocTypeSelectedCheck('ZSTO');

            expect(oModel.getProperty('/errors/Supplier/state')).toBe('None');
            expect(oModel.getProperty('/errors/Supplier/text')).toBe('');
        });
    });
});
