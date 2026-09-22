/**
 * Unit Tests for Login Controller
 * (app/fiori-app/webapp/controller/Login.controller.js)
 */

let LoginControllerClass;
let mockAuthService;
let mockMessageToast;
let mockValueState;

describe("Login.controller Unit Tests", () => {
    let controller;
    let mockView;
    let mockViewModel;
    let mockComponent;
    let mockRouter;
    let mockResourceBundle;
    let mockUserInput;
    let mockPassInput;

    beforeAll(() => {
        mockValueState = {
            None: "None",
            Error: "Error",
            Warning: "Warning",
            Success: "Success"
        };

        mockMessageToast = {
            show: jest.fn()
        };

        mockAuthService = {
            getModel: jest.fn(() => ({
                getProperty: jest.fn((path) => path === "/savedUsername" ? "alice" : null)
            })),
            isAuthenticated: jest.fn(),
            login: jest.fn(),
            logout: jest.fn()
        };

        // Setup sap.ui.define mock to load the real controller definition
        const savedSap = global.sap;
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

                    const MockJSONModel = function (initialData) {
                        this.data = { ...initialData };
                        this.getProperty = jest.fn((path) => {
                            const key = path.replace(/^\//, "");
                            return this.data[key];
                        });
                        this.setProperty = jest.fn((path, val) => {
                            const key = path.replace(/^\//, "");
                            this.data[key] = val;
                        });
                        this.getData = jest.fn(() => this.data);
                    };

                    const MockCoreLibrary = {
                        ValueState: mockValueState
                    };

                    LoginControllerClass = factory(
                        MockController,
                        MockJSONModel,
                        MockCoreLibrary,
                        mockMessageToast,
                        mockAuthService
                    );
                }
            }
        };

        require("../../../app/fiori-app/webapp/controller/Login.controller.js");
        global.sap = savedSap;
    });

    beforeEach(() => {
        jest.clearAllMocks();

        mockViewModel = {
            data: {
                username: "",
                password: "",
                rememberMe: true,
                isBusy: false,
                hasError: false,
                errorMessage: "",
                usernameState: "None",
                usernameStateText: "",
                passwordState: "None",
                passwordStateText: ""
            },
            getProperty: jest.fn((path) => {
                const key = path.replace(/^\//, "");
                return mockViewModel.data[key];
            }),
            setProperty: jest.fn((path, val) => {
                const key = path.replace(/^\//, "");
                mockViewModel.data[key] = val;
            }),
            getData: jest.fn(() => mockViewModel.data)
        };

        mockUserInput = {
            getValue: jest.fn(() => ""),
            setValue: jest.fn()
        };

        mockPassInput = {
            getValue: jest.fn(() => ""),
            setValue: jest.fn()
        };

        mockView = {
            getModel: jest.fn((name) => name === "loginView" ? mockViewModel : null),
            setModel: jest.fn()
        };

        mockRouter = {
            navTo: jest.fn(),
            getRoute: jest.fn(() => ({
                attachPatternMatched: jest.fn()
            }))
        };

        mockResourceBundle = {
            getText: jest.fn((key, args) => {
                if (key === "loginErrorRequired") return "Username and password are required.";
                if (key === "loginErrorAuth") return "Authentication failed: Invalid username or password.";
                if (key === "loginSuccessMsg") return `Authentication successful. Welcome, ${args ? args[0] : ""}!`;
                return key;
            })
        };

        mockComponent = {
            getRouter: jest.fn(() => mockRouter),
            getModel: jest.fn((name) => {
                if (name === "i18n") {
                    return { getResourceBundle: () => mockResourceBundle };
                }
                return null;
            })
        };

        controller = new LoginControllerClass();
        controller.getView = jest.fn(() => mockView);
        controller.getOwnerComponent = jest.fn(() => mockComponent);
        controller.byId = jest.fn((id) => {
            if (id === "inputUsername") return mockUserInput;
            if (id === "inputPassword") return mockPassInput;
            return null;
        });
    });

    test("onInit should initialize view model with saved username", () => {
        controller.onInit();
        expect(mockView.setModel).toHaveBeenCalledWith(expect.any(Object), "loginView");
    });

    test("onInputChange should sync control values to view model and reset error states", () => {
        mockUserInput.getValue.mockReturnValue("alice");
        mockPassInput.getValue.mockReturnValue("secret123");

        controller.onInputChange();

        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/username", "alice");
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/password", "secret123");
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/hasError", false);
    });

    test("onLogin should reject if username is empty", () => {
        mockUserInput.getValue.mockReturnValue("");
        mockPassInput.getValue.mockReturnValue("pass");
        mockViewModel.data.username = "";
        mockViewModel.data.password = "pass";

        controller.onLogin();

        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/usernameState", "Error");
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/hasError", true);
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/errorMessage", "Username and password are required.");
        expect(mockAuthService.login).not.toHaveBeenCalled();
    });

    test("onLogin should reject if password is empty", () => {
        mockUserInput.getValue.mockReturnValue("alice");
        mockPassInput.getValue.mockReturnValue("");
        mockViewModel.data.username = "alice";
        mockViewModel.data.password = "";

        controller.onLogin();

        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/passwordState", "Error");
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/hasError", true);
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/errorMessage", "Username and password are required.");
        expect(mockAuthService.login).not.toHaveBeenCalled();
    });

    test("onLogin should read live control values before blur (Enter key submission)", async () => {
        // Simulating the exact bug: model is empty because user pressed Enter inside password field
        mockViewModel.data.username = "alice";
        mockViewModel.data.password = ""; // model empty

        // But control has value
        mockUserInput.getValue.mockReturnValue("alice");
        mockPassInput.getValue.mockReturnValue("alice");

        mockAuthService.login.mockResolvedValue({ username: "alice" });

        controller.onLogin();

        // Model was synced with control value
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/password", "alice");
        expect(mockAuthService.login).toHaveBeenCalledWith("alice", "alice", true);

        // Await promise microtask
        await new Promise(process.nextTick);

        expect(mockPassInput.setValue).toHaveBeenCalledWith("");
        expect(mockRouter.navTo).toHaveBeenCalledWith("dashboard", {}, true);
    });

    test("onLogin should handle authentication failure cleanly", async () => {
        mockUserInput.getValue.mockReturnValue("alice");
        mockPassInput.getValue.mockReturnValue("wrongpass");
        mockAuthService.login.mockRejectedValue(new Error("Invalid credentials"));

        controller.onLogin();

        // Flush all microtasks
        await new Promise(process.nextTick);

        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/isBusy", false);
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/hasError", true);
        expect(mockViewModel.setProperty).toHaveBeenCalledWith("/errorMessage", "Invalid credentials");
    });
});
