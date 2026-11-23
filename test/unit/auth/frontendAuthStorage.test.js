/**
 * Unit Tests for Frontend Authentication Storage & Security Architecture
 * (app/fiori-app/webapp/service/AuthService.js & ODataClient.js)
 *
 * Verifies remediation for Finding UI-02 (SEC-02 frontend manifestation):
 * 1. Bearer tokens are NEVER persisted to localStorage (disk storage).
 * 2. Active session tokens reside strictly in volatile sessionStorage and in-memory model.
 * 3. "Remember Me" persists ONLY the non-sensitive username hint string in localStorage.
 * 4. Legacy session tokens in localStorage are sanitized/migrated to sessionStorage and immediately purged from disk.
 * 5. Expired tokens are detected and rejected on session restore.
 * 6. Logout clears session tokens across all storages while preserving the username hint.
 * 7. ODataClient.authHeaders resolves Bearer token from sessionStorage and purges legacy localStorage.
 */

const fs = require('fs');
const path = require('path');

if (typeof global.atob === 'undefined') {
    global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

function createMemoryStorage() {
    const store = new Map();
    return {
        getItem: jest.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: jest.fn((key, value) => { store.set(key, String(value)); }),
        removeItem: jest.fn((key) => { store.delete(key); }),
        clear: jest.fn(() => { store.clear(); }),
        _has: (key) => store.has(key),
        _dump: () => Object.fromEntries(store.entries())
    };
}

function createJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64');
    return `${header}.${body}.mockSignature`;
}

describe('Frontend Authentication Storage Security (AuthService & ODataClient)', () => {
    let mockLocalStorage;
    let mockSessionStorage;
    let mockODataClient;
    let AuthService;
    let ODataClient;
    let MockJSONModel;

    const STORAGE_KEY = 'saps4hana_fiori_auth_session';
    const REMEMBER_KEY = 'saps4hana_fiori_remember_user';

    beforeEach(() => {
        mockLocalStorage = createMemoryStorage();
        mockSessionStorage = createMemoryStorage();

        global.window = {
            localStorage: mockLocalStorage,
            sessionStorage: mockSessionStorage
        };
        global.localStorage = mockLocalStorage;
        global.sessionStorage = mockSessionStorage;

        mockODataClient = {
            post: jest.fn(),
            get: jest.fn(),
            authHeaders: jest.fn()
        };

        MockJSONModel = function (initialData) {
            this.data = { ...initialData };
            this.getProperty = jest.fn((propPath) => {
                const key = propPath.replace(/^\//, '');
                return this.data[key];
            });
            this.setProperty = jest.fn((propPath, val) => {
                const key = propPath.replace(/^\//, '');
                this.data[key] = val;
            });
            this.getData = jest.fn(() => this.data);
        };

        const MockBaseObject = function () {};
        MockBaseObject.apply = function () {};
        MockBaseObject.extend = (name, proto) => {
            function Service() {
                if (proto && proto.constructor) {
                    proto.constructor.apply(this, arguments);
                }
            }
            Object.assign(Service.prototype, proto);
            return Service;
        };

        const MockLog = {
            info: jest.fn(),
            warning: jest.fn(),
            error: jest.fn()
        };

        // Load AuthService
        const authSrc = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/service/AuthService.js'), 'utf8');
        let authFactory;
        const sapDefineAuth = {
            ui: {
                define: (deps, factory) => {
                    authFactory = factory;
                }
            }
        };
        new Function('sap', authSrc)(sapDefineAuth);
        AuthService = authFactory(MockBaseObject, MockJSONModel, MockLog, mockODataClient);

        // Load ODataClient
        const odataSrc = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/service/ODataClient.js'), 'utf8');
        let odataFactory;
        const sapDefineOData = {
            ui: {
                define: (deps, factory) => {
                    odataFactory = factory;
                }
            }
        };
        new Function('sap', odataSrc)(sapDefineOData);
        ODataClient = odataFactory(MockBaseObject, MockLog);
    });

    afterEach(() => {
        delete global.window;
        delete global.localStorage;
        delete global.sessionStorage;
        jest.clearAllMocks();
    });

    describe('Login Storage Security', () => {
        test('when rememberMe is true, session token is stored ONLY in volatile sessionStorage, and ONLY username in localStorage', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, user_name: 'CB9980000001' });
            mockODataClient.post.mockResolvedValue({
                authenticated: true,
                username: 'CB9980000001',
                token: validToken,
                system: 'S/4HANA (PRD)',
                scopes: ['PurchasingManager']
            });

            const result = await AuthService.login('CB9980000001', 'ValidPassword123!', true);

            expect(result.username).toBe('CB9980000001');

            // 1. Session token MUST be in volatile sessionStorage
            expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
            const storedSession = JSON.parse(mockSessionStorage.getItem(STORAGE_KEY));
            expect(storedSession.token).toBe(validToken);
            expect(storedSession.user.username).toBe('CB9980000001');

            // 2. Bearer token MUST NEVER be in persistent localStorage
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);

            // 3. localStorage MUST ONLY contain the plain-text username hint under REMEMBER_KEY
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(REMEMBER_KEY, 'CB9980000001');
            expect(mockLocalStorage.getItem(REMEMBER_KEY)).toBe('CB9980000001');

            // 4. In-memory model reflects authenticated state and rememberMe setting
            expect(AuthService.getModel().getProperty('/isAuthenticated')).toBe(true);
            expect(AuthService.getModel().getProperty('/rememberMe')).toBe(true);
            expect(AuthService.getModel().getProperty('/savedUsername')).toBe('CB9980000001');
        });

        test('when rememberMe is false, session is in sessionStorage, localStorage has NO token and NO username hint', async () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, user_name: 'KHUSHAL' });
            mockODataClient.post.mockResolvedValue({
                authenticated: true,
                username: 'KHUSHAL',
                token: validToken,
                system: 'S/4HANA (DEV)',
                scopes: ['Admin']
            });

            // Pre-seed an old remember key
            mockLocalStorage.setItem(REMEMBER_KEY, 'OLD_USER');

            const result = await AuthService.login('KHUSHAL', 'LocalDevPass123', false);

            expect(result.username).toBe('KHUSHAL');

            // 1. Session is in volatile sessionStorage
            expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
            const storedSession = JSON.parse(mockSessionStorage.getItem(STORAGE_KEY));
            expect(storedSession.token).toBe(validToken);

            // 2. localStorage has NO session and NO remember username
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(mockLocalStorage.getItem(REMEMBER_KEY)).toBeNull();
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(REMEMBER_KEY);

            // 3. In-memory model reflects rememberMe = false
            expect(AuthService.getModel().getProperty('/rememberMe')).toBe(false);
        });
    });

    describe('Session Restoration & Sanitization Migration', () => {
        test('restores session from active sessionStorage when unexpired', () => {
            const validToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 1800, user_name: 'TEST_USER' });
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'TEST_USER', token: validToken, scopes: ['Viewer'] },
                token: validToken
            }));
            mockLocalStorage.setItem(REMEMBER_KEY, 'TEST_USER');

            const restored = AuthService._restoreSession();

            expect(restored).toBe(true);
            expect(AuthService.isAuthenticated()).toBe(true);
            expect(AuthService.getCurrentUser().username).toBe('TEST_USER');
            expect(AuthService.getModel().getProperty('/savedUsername')).toBe('TEST_USER');
            expect(AuthService.getModel().getProperty('/rememberMe')).toBe(true);

            // localStorage must remain clean of session token
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('sanitizes and purges legacy token from localStorage into volatile sessionStorage', () => {
            const legacyToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, user_name: 'LEGACY_USER' });
            // Pre-condition: legacy version or test runner placed token in localStorage
            mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'LEGACY_USER', token: legacyToken, scopes: ['Admin'] },
                token: legacyToken
            }));

            // sessionStorage is initially empty
            expect(mockSessionStorage.getItem(STORAGE_KEY)).toBeNull();

            const restored = AuthService._restoreSession();

            expect(restored).toBe(true);
            expect(AuthService.isAuthenticated()).toBe(true);
            expect(AuthService.getCurrentUser().username).toBe('LEGACY_USER');

            // 1. Session must be migrated into sessionStorage
            expect(mockSessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
            const sessionInTab = JSON.parse(mockSessionStorage.getItem(STORAGE_KEY));
            expect(sessionInTab.user.username).toBe('LEGACY_USER');
            expect(sessionInTab.token).toBe(legacyToken);

            // 2. CRITICAL: Legacy token MUST BE IMMEDIATELY PURGED from localStorage
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
        });

        test('rejects expired tokens and cleans up storage', () => {
            const expiredToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 60, user_name: 'EXPIRED_USER' });
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'EXPIRED_USER', token: expiredToken },
                token: expiredToken
            }));

            const restored = AuthService._restoreSession();

            expect(restored).toBe(false);
            expect(AuthService.isAuthenticated()).toBe(false);
            expect(mockSessionStorage.getItem(STORAGE_KEY)).toBeNull();
        });
    });

    describe('Token Retrieval (getToken)', () => {
        test('retrieves token from in-memory user model first', () => {
            AuthService.getModel().setProperty('/user', { username: 'MEM_USER', token: 'in.memory.token' });
            expect(AuthService.getToken()).toBe('in.memory.token');
        });

        test('falls back to sessionStorage when in-memory model is not yet loaded', () => {
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'TAB_USER', token: 'session.storage.token' }
            }));
            expect(AuthService.getToken()).toBe('session.storage.token');
        });

        test('migrates and purges legacy localStorage token during getToken fallback', () => {
            mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'OLD_USER', token: 'legacy.disk.token' }
            }));

            expect(AuthService.getToken()).toBe('legacy.disk.token');
            expect(mockSessionStorage.getItem(STORAGE_KEY)).toContain('legacy.disk.token');
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });
    });

    describe('Logout', () => {
        test('purges session from sessionStorage and localStorage, but retains username hint if rememberMe was set', () => {
            mockSessionStorage.setItem(STORAGE_KEY, '{"user":{"username":"LOGOUT_USER"}}');
            mockLocalStorage.setItem(STORAGE_KEY, '{"user":{"username":"LOGOUT_USER"}}');
            mockLocalStorage.setItem(REMEMBER_KEY, 'LOGOUT_USER');
            AuthService.getModel().setProperty('/isAuthenticated', true);
            AuthService.getModel().setProperty('/user', { username: 'LOGOUT_USER' });

            AuthService.logout();

            expect(mockSessionStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(mockLocalStorage.getItem(REMEMBER_KEY)).toBe('LOGOUT_USER');

            expect(AuthService.isAuthenticated()).toBe(false);
            expect(AuthService.getCurrentUser()).toBeNull();
            expect(AuthService.getModel().getProperty('/savedUsername')).toBe('LOGOUT_USER');
        });
    });

    describe('ODataClient.authHeaders Security', () => {
        test('returns Authorization Bearer header from sessionStorage and leaves localStorage untouched', () => {
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'ODATA_USER', token: 'valid.odata.token' }
            }));

            const headers = ODataClient.authHeaders();

            expect(headers).toEqual({
                Authorization: 'Bearer valid.odata.token'
            });
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('migrates and purges legacy localStorage session during authHeaders resolution', () => {
            mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'ODATA_LEGACY', token: 'legacy.odata.token' }
            }));

            const headers = ODataClient.authHeaders();

            expect(headers).toEqual({
                Authorization: 'Bearer legacy.odata.token'
            });
            expect(mockSessionStorage.getItem(STORAGE_KEY)).toContain('legacy.odata.token');
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('returns empty object and does not throw when storage is empty or unreadable', () => {
            expect(ODataClient.authHeaders()).toEqual({});

            mockSessionStorage.setItem(STORAGE_KEY, 'invalid-json-content{');
            expect(ODataClient.authHeaders()).toEqual({});
        });
    });

    describe('Private Browsing & Blocked Storage Resilience', () => {
        test('AuthService does not crash if localStorage or sessionStorage throws (e.g. Safari Private Mode)', async () => {
            const blockedStorage = {
                getItem: jest.fn(() => { throw new Error('SecurityError: The operation is insecure.'); }),
                setItem: jest.fn(() => { throw new Error('SecurityError: The operation is insecure.'); }),
                removeItem: jest.fn(() => { throw new Error('SecurityError: The operation is insecure.'); })
            };

            global.window.localStorage = blockedStorage;
            global.window.sessionStorage = blockedStorage;
            global.localStorage = blockedStorage;
            global.sessionStorage = blockedStorage;

            // 1. _restoreSession handles storage failure gracefully
            expect(() => AuthService._restoreSession()).not.toThrow();
            expect(AuthService._restoreSession()).toBe(false);

            // 2. login handles storage failure gracefully
            mockODataClient.post.mockResolvedValue({
                authenticated: true,
                username: 'PRIVATE_USER',
                token: 'private.mode.token'
            });

            const result = await AuthService.login('PRIVATE_USER', 'Secret123!', true);
            expect(result.username).toBe('PRIVATE_USER');
            expect(AuthService.isAuthenticated()).toBe(true);
            expect(AuthService.getToken()).toBe('private.mode.token'); // served from in-memory model

            // 3. logout handles storage failure gracefully
            expect(() => AuthService.logout()).not.toThrow();
            expect(AuthService.isAuthenticated()).toBe(false);
            expect(AuthService.getToken()).toBeNull();
        });

        test('handles BTP XSUAA SSO sessions where token is null (cookie-based Approuter auth)', async () => {
            mockODataClient.get.mockResolvedValue({
                authenticated: true,
                username: 'XSUAA_USER',
                token: null, // XSUAA Approuter uses HTTP-only session cookies
                system: 'S/4HANA (XSUAA SSO)',
                scopes: ['PurchasingClerk']
            });

            const user = await AuthService.fetchCurrentUserInfo();
            expect(user).not.toBeNull();
            expect(user.username).toBe('XSUAA_USER');
            expect(user.token).toBeNull();
            expect(AuthService.isAuthenticated()).toBe(true);
            expect(AuthService.getToken()).toBeNull();
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });
    });
});
