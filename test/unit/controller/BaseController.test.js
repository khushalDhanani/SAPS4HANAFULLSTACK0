/**
 * Unit Tests for BaseController
 * (BaseController.js)
 */

let BaseControllerClass;

// Mock sap.ui.core.routing.History
const mockHistoryInstance = {
    getPreviousHash: jest.fn()
};

const mockHistory = {
    getInstance: jest.fn(() => mockHistoryInstance)
};

// Setup sap.ui.define mock
global.sap = {
    ui: {
        define: (deps, factory) => {
            const MockController = {
                extend: (name, proto) => {
                    function Controller() {
                        if (proto) {
                            Object.assign(this, proto);
                        }
                    }
                    return Controller;
                }
            };

            const MockFragment = {
                load: jest.fn()
            };

            const MockMessageBox = {
                confirm: jest.fn()
            };

            const MockMessageToast = {
                show: jest.fn()
            };

            const MockAuthService = {
                logout: jest.fn()
            };

            const MockFormatter = {};

            BaseControllerClass = factory(
                MockController,
                MockFragment,
                MockMessageBox,
                MockMessageToast,
                mockHistory,
                MockAuthService,
                MockFormatter
            );
        }
    }
};

describe('BaseController Unit Tests', () => {
    let controller;
    let mockRouter;
    let mockOwnerComponent;
    
    let originalWindow;

    beforeAll(() => {
        require('../../../app/fiori-app/webapp/controller/BaseController.js');
        originalWindow = global.window;
        global.window = {
            history: {
                go: jest.fn()
            }
        };
    });

    afterAll(() => {
        global.window = originalWindow;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        
        controller = new BaseControllerClass();
        
        mockRouter = {
            navTo: jest.fn()
        };
        
        mockOwnerComponent = {
            getRouter: jest.fn(() => mockRouter)
        };
        
        controller.getOwnerComponent = jest.fn(() => mockOwnerComponent);
    });

    describe('Navigation (onNavBack)', () => {
        it('should call window.history.go(-1) if there is a previous hash in SAPUI5 routing history', () => {
            mockHistoryInstance.getPreviousHash.mockReturnValue("some-previous-hash");
            
            controller.onNavBack("fallbackRoute");
            
            expect(mockHistory.getInstance).toHaveBeenCalled();
            expect(mockHistoryInstance.getPreviousHash).toHaveBeenCalled();
            expect(global.window.history.go).toHaveBeenCalledWith(-1);
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });

        it('should navigate to fallback route without adding to history if previous hash is undefined', () => {
            mockHistoryInstance.getPreviousHash.mockReturnValue(undefined);
            
            controller.onNavBack("fallbackRoute");
            
            expect(mockHistory.getInstance).toHaveBeenCalled();
            expect(mockHistoryInstance.getPreviousHash).toHaveBeenCalled();
            expect(global.window.history.go).not.toHaveBeenCalled();
            expect(controller.getOwnerComponent).toHaveBeenCalled();
            expect(mockOwnerComponent.getRouter).toHaveBeenCalled();
            expect(mockRouter.navTo).toHaveBeenCalledWith("fallbackRoute", {}, true);
        });
    });
});
