/**
 * Unit Tests for Sales Inquiry Detail Controller
 * (SalesInquiryDetail.controller.js)
 *
 * Tests:
 * - Controller initialization and pattern matched registration
 * - Route pattern matched with inquiry ID triggering data load
 * - Loading inquiry via SalesInquiryService and binding detail model
 * - Error handling on inquiry load failure
 * - Navigation back delegating to BaseController with 'salesInquiries' fallback
 * - Navigate to create inquiry (VA11)
 */

let ControllerClass;

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

const mockBusyIndicator = {
    show: jest.fn(),
    hide: jest.fn()
};

const mockSalesInquiryService = {
    getSalesInquiry: jest.fn()
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

const mockRouter = {
    getRoute: jest.fn().mockReturnValue({
        attachPatternMatched: jest.fn()
    }),
    navTo: jest.fn()
};

const mockView = {
    setModel: jest.fn(),
    getModel: jest.fn()
};

// Mock sap.ui.define
global.sap = {
    ui: {
        define: jest.fn((deps, factory) => {
            ControllerClass = factory(
                MockBaseController,
                MockJSONModel,
                mockBusyIndicator,
                mockSalesInquiryService
            );
        })
    }
};

describe('Sales Inquiry Detail Controller Unit Tests', () => {
    let controller;

    beforeAll(() => {
        require('../../../app/fiori-app/webapp/modules/sd/sales-inquiry/controller/SalesInquiryDetail.controller.js');
    });

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();
        controller.getView = () => mockView;
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter,
            getModel: () => ({})
        });
    });

    describe('Initialization & Pattern Matching', () => {
        it('onInit should attach pattern matched handler for salesInquiryDetail route', () => {
            const mockAttach = jest.fn();
            mockRouter.getRoute.mockReturnValue({ attachPatternMatched: mockAttach });

            controller.onInit();

            expect(mockRouter.getRoute).toHaveBeenCalledWith('salesInquiryDetail');
            expect(mockAttach).toHaveBeenCalledWith(controller._onRouteMatched, controller);
        });

        it('_onRouteMatched should invoke _loadInquiry when SalesInquiry argument is present', () => {
            const spyLoad = jest.spyOn(controller, '_loadInquiry').mockImplementation(() => {});
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({ SalesInquiry: '160000005' })
            };

            controller._onRouteMatched(oEvent);

            expect(oEvent.getParameter).toHaveBeenCalledWith('arguments');
            expect(spyLoad).toHaveBeenCalledWith('160000005');
        });

        it('_onRouteMatched should do nothing if SalesInquiry argument is missing', () => {
            const spyLoad = jest.spyOn(controller, '_loadInquiry').mockImplementation(() => {});
            const oEvent = {
                getParameter: jest.fn().mockReturnValue({})
            };

            controller._onRouteMatched(oEvent);

            expect(spyLoad).not.toHaveBeenCalled();
        });
    });

    describe('Data Loading (_loadInquiry)', () => {
        it('should fetch inquiry data, show/hide BusyIndicator, and set detail JSONModel', async () => {
            const mockData = {
                header: {
                    SalesInquiry: '160000005',
                    SoldToParty: '1000000',
                    TotalNetAmount: '4500.00'
                },
                items: [
                    { SalesInquiryItem: '10', Material: 'TG11', RequestedQuantity: '5' }
                ]
            };
            mockSalesInquiryService.getSalesInquiry.mockResolvedValue(mockData);

            controller._loadInquiry('160000005');

            expect(mockBusyIndicator.show).toHaveBeenCalledWith(0);

            // Wait for promise resolution
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), 'detail');

            const setModelCall = mockView.setModel.mock.calls[0];
            const boundModel = setModelCall[0];
            expect(boundModel.getData().header.SalesInquiry).toBe('160000005');
            expect(boundModel.getData().items).toHaveLength(1);
        });

        it('should handle service error gracefully and hide BusyIndicator', async () => {
            mockSalesInquiryService.getSalesInquiry.mockRejectedValue(new Error('Network error'));
            const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

            controller._loadInquiry('999999999');

            expect(mockBusyIndicator.show).toHaveBeenCalledWith(0);

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(spyWarn).toHaveBeenCalledWith(expect.stringContaining('[SalesInquiryDetail]'), expect.any(Error));

            spyWarn.mockRestore();
        });
    });

    describe('Navigation Actions', () => {
        it('onNavBack should delegate to BaseController with fallback to salesInquiries', () => {
            controller.onNavBack();

            expect(MockBaseController.prototype.onNavBack).toHaveBeenCalledWith('salesInquiries');
        });

        it('onCreateAnother should navigate to createSalesInquiry route', () => {
            controller.onCreateAnother();

            expect(mockRouter.navTo).toHaveBeenCalledWith('createSalesInquiry');
        });

        it('onRefresh should reload current inquiry if _sInquiryId is set', () => {
            const spyLoad = jest.spyOn(controller, '_loadInquiry').mockImplementation(() => {});
            controller._sInquiryId = '160000005';

            controller.onRefresh();

            expect(spyLoad).toHaveBeenCalledWith('160000005');
        });
    });
});
