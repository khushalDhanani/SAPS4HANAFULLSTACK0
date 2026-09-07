/**
 * Unit Tests for Purchase Order Detail Controller
 * (PurchaseOrderDetail.controller.js)
 *
 * Tests:
 * - Controller initialization and detailViewModel initialization
 * - Route pattern matching and view element binding with $expand: to_PurchaseOrderItem
 * - Navigation fallback if PurchaseOrder parameter is missing
 * - Binding change and not-found handling
 * - Items table updateFinished count and title formatting
 * - Line items search filtering (liveChange)
 * - Navigation back to purchaseOrders
 * - Refresh mechanism
 */

let ControllerClass;

// Mock UI5 classes and environment
class MockFilter {
    constructor(sPathOrConfig, sOperator, vValue1, vValue2) {
        if (typeof sPathOrConfig === "object" && sPathOrConfig !== null) {
            this.aFilters = sPathOrConfig.filters || [];
            this.bAnd = sPathOrConfig.and !== undefined ? sPathOrConfig.and : true;
        } else {
            this.sPath = sPathOrConfig;
            this.sOperator = sOperator;
            this.oValue1 = vValue1;
            this.oValue2 = vValue2;
        }
    }
}

const FilterOperator = {
    Contains: "Contains",
    EQ: "EQ"
};

class MockJSONModel {
    constructor(data) {
        this.data = data || {};
    }
    setProperty(path, value) {
        var prop = path.replace(/^\//, "");
        this.data[prop] = value;
    }
    getProperty(path) {
        var prop = path.replace(/^\//, "");
        return this.data[prop];
    }
    getData() {
        return this.data;
    }
}

const mockMessageBox = {
    error: jest.fn(),
    warning: jest.fn((msg, opts) => {
        if (opts && typeof opts.onClose === "function") {
            opts.onClose();
        }
    })
};

const mockMessageToast = {
    show: jest.fn()
};

const MockBaseController = {
    prototype: {
        onNavBack: jest.fn()
    },
    extend: (name, proto) => {
        function Controller() {
            if (proto) {
                Object.assign(this, proto);
            }
        }
        return Controller;
    }
};

// Setup sap.ui.define mock
global.sap = {
    ui: {
        define: (deps, factory) => {
            ControllerClass = factory(
                MockBaseController,
                MockJSONModel,
                MockFilter,
                FilterOperator,
                mockMessageBox,
                mockMessageToast
            );
        },
        model: {
            Filter: MockFilter,
            FilterOperator: FilterOperator,
            json: {
                JSONModel: MockJSONModel
            }
        }
    },
    m: {
        MessageBox: mockMessageBox,
        MessageToast: mockMessageToast
    }
};

describe('PurchaseOrderDetail Controller Unit Tests', () => {
    let controller;
    let mockView;
    let mockRouter;
    let mockRoute;
    let mockElementBinding;
    let mockItemsBinding;
    let mockTable;
    let mockI18nBundle;

    beforeAll(() => {
        require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrderDetail.controller.js');
    });

    beforeEach(() => {
        jest.clearAllMocks();

        mockI18nBundle = {
            getText: jest.fn((key, args) => {
                if (key === "itemsTableTitle" && args) {
                    return `Items (${args[0]})`;
                }
                if (key === "secItems") {
                    return "Line Items";
                }
                if (key === "poNotFound") {
                    return "Purchase Order not found.";
                }
                if (key === "detailRefreshed") {
                    return "Purchase Order data refreshed.";
                }
                return key;
            })
        };

        mockRoute = {
            attachPatternMatched: jest.fn()
        };

        mockRouter = {
            getRoute: jest.fn().mockReturnValue(mockRoute),
            navTo: jest.fn()
        };

        mockElementBinding = {
            getBoundContext: jest.fn().mockReturnValue({}),
            refresh: jest.fn()
        };

        mockItemsBinding = {
            filter: jest.fn(),
            refresh: jest.fn()
        };

        mockTable = {
            getItems: jest.fn().mockReturnValue([{}, {}]),
            getBinding: jest.fn().mockReturnValue(mockItemsBinding)
        };

        const mockObjectPage = {
            setSelectedSection: jest.fn(),
            setHeaderExpanded: jest.fn()
        };
        const mockFirstSection = { id: "secGeneralInfo" };

        const mModels = {};
        mockView = {
            setModel: jest.fn((oModel, sName) => {
                mModels[sName] = oModel;
            }),
            getModel: jest.fn((sName) => mModels[sName]),
            bindElement: jest.fn(),
            getElementBinding: jest.fn().mockReturnValue(mockElementBinding),
            setBusy: jest.fn(),
            byId: jest.fn((sId) => {
                if (sId === "poItemsTable") return mockTable;
                if (sId === "poObjectPage") return mockObjectPage;
                if (sId === "secGeneralInfo") return mockFirstSection;
                return null;
            })
        };

        controller = new ControllerClass();
        controller.getView = () => mockView;
        controller.byId = (sId) => mockView.byId(sId);
        controller._mockObjectPage = mockObjectPage;
        controller._mockFirstSection = mockFirstSection;
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter,
            getModel: () => ({
                getResourceBundle: () => mockI18nBundle
            })
        });
    });

    describe('Initialization (onInit)', () => {
        it('should initialize detailViewModel with expected initial properties', () => {
            controller.onInit();

            const oModel = mockView.getModel("detailViewModel");
            expect(oModel).toBeDefined();
            expect(oModel.getProperty("/busy")).toBe(false);
            expect(oModel.getProperty("/itemsTitle")).toBe("Items (0)");
            expect(oModel.getProperty("/itemsTabTitle")).toBe("Line Items (0)");
            expect(oModel.getProperty("/itemsCount")).toBe(0);
            expect(oModel.getProperty("/purchaseOrder")).toBe("");
        });

        it('should attach pattern matched handler to purchaseOrderDetail route', () => {
            controller.onInit();

            expect(mockRouter.getRoute).toHaveBeenCalledWith("purchaseOrderDetail");
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(
                controller._onPatternMatched,
                controller
            );
        });
    });

    describe('Route Pattern Matched (_onPatternMatched)', () => {
        beforeEach(() => {
            controller.onInit();
        });

        it('should bind the view element to /PurchaseOrders with expanded to_PurchaseOrderItem and reset section', () => {
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({
                    PurchaseOrder: "300000001"
                })
            };

            controller._onPatternMatched(oEvent);

            const oModel = mockView.getModel("detailViewModel");
            expect(oModel.getProperty("/purchaseOrder")).toBe("300000001");
            expect(controller._mockObjectPage.setSelectedSection).toHaveBeenCalledWith(controller._mockFirstSection);
            expect(controller._mockObjectPage.setHeaderExpanded).toHaveBeenCalledWith(true);

            expect(mockView.bindElement).toHaveBeenCalledWith(expect.objectContaining({
                path: "/PurchaseOrders('300000001')",
                parameters: {
                    $expand: "to_PurchaseOrderItem"
                }
            }));
        });

        it('should handle dataRequested and dataReceived callbacks during binding', () => {
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({
                    PurchaseOrder: "300000002"
                })
            };

            controller._onPatternMatched(oEvent);

            const oBindingCall = mockView.bindElement.mock.calls[0][0];
            const oEvents = oBindingCall.events;

            // Trigger dataRequested
            oEvents.dataRequested();
            expect(mockView.setBusy).toHaveBeenCalledWith(true);
            expect(mockView.getModel("detailViewModel").getProperty("/busy")).toBe(true);

            // Trigger dataReceived with success
            oEvents.dataReceived({
                getParameter: jest.fn().mockReturnValue(null)
            });
            expect(mockView.setBusy).toHaveBeenCalledWith(false);
            expect(mockView.getModel("detailViewModel").getProperty("/busy")).toBe(false);
        });

        it('should display error message if dataReceived returns an error', () => {
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({
                    PurchaseOrder: "300000002"
                })
            };

            controller._onPatternMatched(oEvent);

            const oBindingCall = mockView.bindElement.mock.calls[0][0];
            oBindingCall.events.dataReceived({
                getParameter: jest.fn().mockReturnValue({ message: "Network connection failed" })
            });

            expect(mockMessageBox.error).toHaveBeenCalledWith("Network connection failed");
        });

        it('should navigate back if PurchaseOrder argument is missing', () => {
            const spyNavBack = jest.spyOn(controller, 'onNavBack');
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({})
            };

            controller._onPatternMatched(oEvent);
            expect(spyNavBack).toHaveBeenCalled();
        });
    });

    describe('Binding Change (_onBindingChange)', () => {
        it('should show warning message and navigate back when bound context does not exist', () => {
            const spyNavBack = jest.spyOn(controller, 'onNavBack');
            mockElementBinding.getBoundContext.mockReturnValue(null);

            controller._onBindingChange();

            expect(mockMessageBox.warning).toHaveBeenCalledWith(
                "Purchase Order not found.",
                expect.any(Object)
            );
            expect(spyNavBack).toHaveBeenCalled();
        });

        it('should not show warning if bound context exists', () => {
            mockElementBinding.getBoundContext.mockReturnValue({ sPath: "/PurchaseOrders('300000001')" });

            controller._onBindingChange();
            expect(mockMessageBox.warning).not.toHaveBeenCalled();
        });
    });

    describe('Items Table updateFinished (onItemsTableUpdateFinished)', () => {
        beforeEach(() => {
            controller.onInit();
        });

        it('should update items count and title from event total parameter', () => {
            const oEvent = {
                getParameter: jest.fn().mockReturnValue(5)
            };

            controller.onItemsTableUpdateFinished(oEvent);

            const oModel = mockView.getModel("detailViewModel");
            expect(oModel.getProperty("/itemsCount")).toBe(5);
            expect(oModel.getProperty("/itemsTitle")).toBe("Items (5)");
            expect(oModel.getProperty("/itemsTabTitle")).toBe("Line Items (5)");
        });

        it('should fallback to table items length if event parameter is missing', () => {
            const oEvent = {
                getParameter: jest.fn().mockReturnValue(undefined)
            };

            controller.onItemsTableUpdateFinished(oEvent);

            const oModel = mockView.getModel("detailViewModel");
            expect(oModel.getProperty("/itemsCount")).toBe(2);
            expect(oModel.getProperty("/itemsTitle")).toBe("Items (2)");
            expect(oModel.getProperty("/itemsTabTitle")).toBe("Line Items (2)");
        });
    });

    describe('Line Items Search (onSearchItems)', () => {
        it('should apply multi-field Contains filter when query is provided', () => {
            const oEvent = {
                getParameter: jest.fn((sParam) => sParam === "newValue" ? "P-101" : null)
            };

            controller.onSearchItems(oEvent);

            expect(mockItemsBinding.filter).toHaveBeenCalledTimes(1);
            const aFilters = mockItemsBinding.filter.mock.calls[0][0];
            expect(aFilters.length).toBe(1);

            const oCompositeFilter = aFilters[0];
            expect(oCompositeFilter.bAnd).toBe(false);
            expect(oCompositeFilter.aFilters.length).toBe(4);
            expect(oCompositeFilter.aFilters.map(f => f.sPath)).toEqual([
                "PurchaseOrderItem",
                "Material",
                "PurchaseOrderItemText",
                "Plant"
            ]);
        });

        it('should reset filters when query is empty', () => {
            const oEvent = {
                getParameter: jest.fn().mockReturnValue("")
            };

            controller.onSearchItems(oEvent);

            expect(mockItemsBinding.filter).toHaveBeenCalledWith([]);
        });
    });

    describe('Navigation & Refresh Actions', () => {
        it('onNavBack should delegate to BaseController', () => {
            controller.onNavBack();

            expect(MockBaseController.prototype.onNavBack).toHaveBeenCalledWith("purchaseOrders");
        });

        it('onRefresh should refresh element and items binding and display toast', () => {
            controller.onRefresh();

            expect(mockElementBinding.refresh).toHaveBeenCalledTimes(1);
            expect(mockItemsBinding.refresh).toHaveBeenCalledTimes(1);
            expect(mockMessageToast.show).toHaveBeenCalledWith("Purchase Order data refreshed.");
        });
    });
});
