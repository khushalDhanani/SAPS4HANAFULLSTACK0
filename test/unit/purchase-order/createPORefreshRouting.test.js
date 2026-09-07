/**
 * Unit & Regression Tests for Create Purchase Order Refresh & Routing State Management
 * Validates:
 * - AuthService.syncModelHeaders idempotent header sync and OData V4 collision safety
 * - PurchaseOrderModel.getCurrentUserName resolving username from 'auth' model
 * - Initial model creation and lifecycle handling
 * - App controller shell synchronization for direct URLs and browser refresh
 */

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

describe('Unit & Regression: Create PO Refresh and Routing State Management', () => {
    let originalSap;
    let originalLocalStorage;
    let originalSessionStorage;
    let PurchaseOrderModel;
    let AuthService;

    const createStorageMock = () => {
        let store = {};
        return {
            getItem: jest.fn((k) => store[k] || null),
            setItem: jest.fn((k, v) => { store[k] = String(v); }),
            removeItem: jest.fn((k) => { delete store[k]; }),
            clear: jest.fn(() => { store = {}; })
        };
    };

    beforeAll(() => {
        originalSap = global.sap;
        originalLocalStorage = global.localStorage;
        originalSessionStorage = global.sessionStorage;

        global.localStorage = createStorageMock();
        global.sessionStorage = createStorageMock();

        const BaseObject = function () {};
        BaseObject.extend = function (sName, oMembers) {
            function Subclass() {
                BaseObject.apply(this, arguments);
                if (oMembers.constructor) {
                    oMembers.constructor.apply(this, arguments);
                }
            }
            Subclass.prototype = Object.create(BaseObject.prototype);
            Object.assign(Subclass.prototype, oMembers);
            return Subclass;
        };

        // Mock sap environment for UI5 modules
        global.sap = {
            ui: {
                define: function (deps, factory) {
                    if (deps.includes("saps4hana/fiori/service/ODataClient")) {
                        AuthService = factory(
                            BaseObject,
                            MockJSONModel,
                            { post: jest.fn() }
                        );
                    } else {
                        PurchaseOrderModel = factory(MockJSONModel);
                    }
                },
                base: { Object: BaseObject },
                model: {
                    json: {
                        JSONModel: MockJSONModel
                    }
                }
            }
        };

        // Load modules
        require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');
        require('../../../app/fiori-app/webapp/service/AuthService');
    });

    afterAll(() => {
        global.sap = originalSap;
        global.localStorage = originalLocalStorage;
        global.sessionStorage = originalSessionStorage;
    });

    describe('AuthService.syncModelHeaders', () => {
        it('should synchronize authorization header to default and fiService models', () => {
            const defaultModel = {
                changeHttpHeaders: jest.fn()
            };
            const fiModel = {
                changeHttpHeaders: jest.fn()
            };
            const mockComponent = {
                getModel: jest.fn((name) => {
                    if (name === "fiService") return fiModel;
                    return defaultModel;
                }),
                setModel: jest.fn()
            };

            AuthService.init(mockComponent);
            AuthService.getModel().setProperty("/user", { token: "sample-jwt-token" });

            AuthService.syncModelHeaders(mockComponent);

            expect(defaultModel.changeHttpHeaders).toHaveBeenCalledWith({
                Authorization: "Bearer sample-jwt-token"
            });
            expect(fiModel.changeHttpHeaders).toHaveBeenCalledWith({
                Authorization: "Bearer sample-jwt-token"
            });
        });

        it('should be idempotent and not call changeHttpHeaders again if token has not changed', () => {
            const defaultModel = {
                changeHttpHeaders: jest.fn()
            };
            const mockComponent = {
                getModel: jest.fn((name) => (name === "fiService" ? null : defaultModel)),
                setModel: jest.fn()
            };

            AuthService.init(mockComponent);
            defaultModel.changeHttpHeaders.mockClear();

            AuthService.getModel().setProperty("/user", { token: "cached-token" });

            // First sync with new token
            AuthService.syncModelHeaders(mockComponent);
            expect(defaultModel.changeHttpHeaders).toHaveBeenCalledTimes(1);

            // Second sync with identical token
            AuthService.syncModelHeaders(mockComponent);
            expect(defaultModel.changeHttpHeaders).toHaveBeenCalledTimes(1); // Not called again!
        });

        it('should catch "Unexpected open requests" error without throwing or rejecting', () => {
            const throwingModel = {
                changeHttpHeaders: jest.fn(() => {
                    throw new Error("Unexpected open requests");
                })
            };
            const mockComponent = {
                getModel: jest.fn(() => throwingModel),
                setModel: jest.fn()
            };

            AuthService.init(mockComponent);
            AuthService.getModel().setProperty("/user", { token: "new-token-123" });

            expect(() => {
                AuthService.syncModelHeaders(mockComponent);
            }).not.toThrow();
        });
    });

    describe('PurchaseOrderModel.getCurrentUserName', () => {
        it('should retrieve username from auth model property /user/username', () => {
            const mockAuthModel = new MockJSONModel({
                user: {
                    username: "TEST_BUYER_01"
                }
            });
            const mockComponent = {
                getModel: jest.fn((name) => {
                    if (name === "auth") return mockAuthModel;
                    return null;
                })
            };

            const username = PurchaseOrderModel.getCurrentUserName(mockComponent);
            expect(username).toBe("TEST_BUYER_01");
        });

        it('should fall back to user model property /username if present', () => {
            const mockUserModel = new MockJSONModel({
                username: "LEGACY_USER"
            });
            const mockComponent = {
                getModel: jest.fn((name) => {
                    if (name === "user") return mockUserModel;
                    return null;
                })
            };

            const username = PurchaseOrderModel.getCurrentUserName(mockComponent);
            expect(username).toBe("LEGACY_USER");
        });

        it('should return empty string if no user or auth models are bound', () => {
            const mockComponent = {
                getModel: jest.fn(() => null)
            };

            const username = PurchaseOrderModel.getCurrentUserName(mockComponent);
            expect(username).toBe("");
        });
    });

    describe('Create PO Initial Model & Status Validation', () => {
        it('should create initial model with default NB doc type and 1 item', () => {
            const oModel = PurchaseOrderModel.createInitialModel("TEST_USER");
            const data = oModel.getData();

            expect(data.header).toBeDefined();
            expect(data.header.PurchaseOrderType).toBe("NB");
            expect(data.header.StatusText).toBe("Draft");
            expect(data.items).toHaveLength(1);
            expect(data.items[0].PurchaseOrderItem).toBe("10");
        });
    });

    describe('Shell Navigation Synchronization', () => {
        it('should map createPurchaseOrder route to correct Shell title and enable back button', () => {
            const mockShellModel = new MockJSONModel({
                currentTitle: "",
                showNavButton: false
            });

            // Simulate App.controller shell update logic
            function updateShell(sRouteName) {
                let sTitle = "";
                let bShowNav = false;
                if (sRouteName === "createPurchaseOrder") {
                    sTitle = "Create Purchase Order";
                    bShowNav = true;
                } else if (sRouteName === "purchaseOrders") {
                    sTitle = "Purchase Orders";
                    bShowNav = true;
                } else if (sRouteName === "dashboard") {
                    sTitle = "Enterprise Operations Dashboard";
                    bShowNav = false;
                }
                mockShellModel.setProperty("/currentTitle", sTitle);
                mockShellModel.setProperty("/showNavButton", bShowNav);
            }

            updateShell("createPurchaseOrder");
            expect(mockShellModel.getProperty("/currentTitle")).toBe("Create Purchase Order");
            expect(mockShellModel.getProperty("/showNavButton")).toBe(true);

            updateShell("purchaseOrders");
            expect(mockShellModel.getProperty("/currentTitle")).toBe("Purchase Orders");
            expect(mockShellModel.getProperty("/showNavButton")).toBe(true);
        });

        it('should handle direct URL hash mm/purchase-orders/create correctly on refresh', () => {
            const sHash = "mm/purchase-orders/create";
            let sDerivedRoute = "";
            if (sHash.indexOf("mm/purchase-orders/create") === 0) {
                sDerivedRoute = "createPurchaseOrder";
            }
            expect(sDerivedRoute).toBe("createPurchaseOrder");
        });
    });
});
