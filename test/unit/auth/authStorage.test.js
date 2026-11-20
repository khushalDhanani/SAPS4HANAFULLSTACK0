/**
 * Unit Tests for Frontend Authentication Storage Architecture (Finding UI-02 / SEC-02)
 *
 * Verifies saps4hana.fiori.service.AuthStorage in isolation:
 * 1. Storage Tiering & Separation of Concerns (volatile vs persistent).
 * 2. Invariant: Active session tokens NEVER reside on disk (localStorage).
 * 3. Invariant: localStorage contains strictly non-sensitive identity hints (username).
 * 4. Automatic disk sanitization & legacy migration.
 * 5. JWT token expiration validation and auto-purge.
 * 6. Header generation for ODataClient.
 * 7. Graceful degradation under private browsing / throwing storage engines.
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

describe('Unit: AuthStorage (Frontend Authentication Storage Security)', () => {
    let mockLocalStorage;
    let mockSessionStorage;
    let AuthStorage;
    let MockLog;

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

        MockLog = {
            info: jest.fn(),
            warning: jest.fn(),
            error: jest.fn()
        };

        const storageSrc = fs.readFileSync(
            path.join(__dirname, '../../../app/fiori-app/webapp/service/AuthStorage.js'),
            'utf8'
        );
        let storageFactory;
        const sapDefine = {
            ui: {
                define: (deps, factory) => {
                    storageFactory = factory;
                }
            }
        };
        new Function('sap', storageSrc)(sapDefine);
        AuthStorage = storageFactory(MockLog);
    });

    afterEach(() => {
        delete global.window;
        delete global.localStorage;
        delete global.sessionStorage;
        jest.clearAllMocks();
    });

    describe('Constants & Core Properties', () => {
        test('exposes canonical STORAGE_KEY and REMEMBER_KEY constants', () => {
            expect(AuthStorage.STORAGE_KEY).toBe(STORAGE_KEY);
            expect(AuthStorage.REMEMBER_KEY).toBe(REMEMBER_KEY);
        });
    });

    describe('saveSession', () => {
        test('writes session strictly to volatile sessionStorage and ensures localStorage is clean', () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, user_name: 'TEST_USER' });
            const userSession = {
                username: 'TEST_USER',
                token: token,
                system: 'PRD',
                scopes: ['WarehouseClerk']
            };

            const success = AuthStorage.saveSession(userSession);
            expect(success).toBe(true);

            // Invariant 1: Saved in volatile sessionStorage
            expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
            const stored = JSON.parse(mockSessionStorage.getItem(STORAGE_KEY));
            expect(stored.token).toBe(token);
            expect(stored.user.username).toBe('TEST_USER');

            // Invariant 2: Purged from persistent localStorage
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('returns false when userSession is invalid or non-object', () => {
            expect(AuthStorage.saveSession(null)).toBe(false);
            expect(AuthStorage.saveSession(undefined)).toBe(false);
            expect(AuthStorage.saveSession('string')).toBe(false);
            expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
        });
    });

    describe('loadSession', () => {
        test('restores valid unexpired session from sessionStorage', () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, user_name: 'ACTIVE_USER' });
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'ACTIVE_USER', token: token },
                token: token
            }));

            const session = AuthStorage.loadSession();
            expect(session).not.toBeNull();
            expect(session.user.username).toBe('ACTIVE_USER');
            expect(session.token).toBe(token);
        });

        test('sanitizes and migrates legacy session from localStorage into volatile sessionStorage', () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600, user_name: 'LEGACY_USER' });
            mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'LEGACY_USER', token: token },
                token: token
            }));

            const session = AuthStorage.loadSession();
            expect(session).not.toBeNull();
            expect(session.user.username).toBe('LEGACY_USER');

            // Migrated to sessionStorage
            expect(mockSessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));

            // Purged from localStorage disk
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('rejects expired token, purges storage, and returns null', () => {
            const expiredToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 300, user_name: 'EXPIRED_USER' });
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'EXPIRED_USER', token: expiredToken },
                token: expiredToken
            }));

            const session = AuthStorage.loadSession();
            expect(session).toBeNull();
            expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
        });

        test('returns null when storage is empty or contains malformed JSON', () => {
            expect(AuthStorage.loadSession()).toBeNull();

            mockSessionStorage.setItem(STORAGE_KEY, '{invalid json');
            expect(AuthStorage.loadSession()).toBeNull();
            expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
        });
    });

    describe('clearSession', () => {
        test('purges session keys from both sessionStorage and localStorage', () => {
            mockSessionStorage.setItem(STORAGE_KEY, 'some-session');
            mockLocalStorage.setItem(STORAGE_KEY, 'legacy-session');

            AuthStorage.clearSession();

            expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
            expect(mockSessionStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });
    });

    describe('getToken & getAuthHeader', () => {
        test('getToken returns token string when session is valid and active', () => {
            const token = createJwt({ exp: Math.floor(Date.now() / 1000) + 1800, user_name: 'USER_1' });
            mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                user: { username: 'USER_1', token: token },
                token: token
            }));

            expect(AuthStorage.getToken()).toBe(token);
            expect(AuthStorage.getAuthHeader()).toEqual({ Authorization: `Bearer ${token}` });
        });

        test('returns null and empty header when no active session or expired', () => {
            expect(AuthStorage.getToken()).toBeNull();
            expect(AuthStorage.getAuthHeader()).toEqual({});
        });
    });

    describe('isTokenExpired', () => {
        test('accurately identifies expired and unexpired JWT tokens', () => {
            const futureToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 600 });
            const pastToken = createJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
            const nonExpToken = createJwt({ user_name: 'no_exp' });

            expect(AuthStorage.isTokenExpired(futureToken)).toBe(false);
            expect(AuthStorage.isTokenExpired(pastToken)).toBe(true);
            expect(AuthStorage.isTokenExpired(nonExpToken)).toBe(false);
            expect(AuthStorage.isTokenExpired(null)).toBe(false);
            expect(AuthStorage.isTokenExpired('invalid.jwt')).toBe(false);
        });
    });

    describe('Remember Me (Identity Hint Storage)', () => {
        test('saveRememberUsername stores plain username string in localStorage, never tokens', () => {
            AuthStorage.saveRememberUsername('CB9980000001');

            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(REMEMBER_KEY, 'CB9980000001');
            expect(mockLocalStorage.getItem(REMEMBER_KEY)).toBe('CB9980000001');
            expect(AuthStorage.getRememberUsername()).toBe('CB9980000001');

            // Invariant: No tokens on disk
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('clearRememberUsername removes REMEMBER_KEY from localStorage', () => {
            mockLocalStorage.setItem(REMEMBER_KEY, 'OPERATOR');
            AuthStorage.clearRememberUsername();

            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(REMEMBER_KEY);
            expect(AuthStorage.getRememberUsername()).toBe('');
        });
    });

    describe('sanitizeLocalStorage', () => {
        test('detects and purges legacy tokens on disk, returning true', () => {
            mockLocalStorage.setItem(STORAGE_KEY, 'stale-token');
            const sanitized = AuthStorage.sanitizeLocalStorage();

            expect(sanitized).toBe(true);
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
            expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
        });

        test('returns false when localStorage has no legacy tokens', () => {
            expect(AuthStorage.sanitizeLocalStorage()).toBe(false);
        });
    });

    describe('Private Browsing & Blocked Storage Resilience', () => {
        test('methods execute gracefully without throwing when storage access throws exceptions', () => {
            const throwingStorage = {
                getItem: jest.fn(() => { throw new Error('QuotaExceededError / SecurityError: access denied'); }),
                setItem: jest.fn(() => { throw new Error('SecurityError: access denied'); }),
                removeItem: jest.fn(() => { throw new Error('SecurityError: access denied'); }),
                clear: jest.fn(() => { throw new Error('SecurityError: access denied'); })
            };

            global.localStorage = throwingStorage;
            global.sessionStorage = throwingStorage;
            global.window = { localStorage: throwingStorage, sessionStorage: throwingStorage };

            expect(() => AuthStorage.saveSession({ username: 'U1', token: 'T1' })).not.toThrow();
            expect(() => AuthStorage.loadSession()).not.toThrow();
            expect(AuthStorage.loadSession()).toBeNull();
            expect(() => AuthStorage.clearSession()).not.toThrow();
            expect(() => AuthStorage.getToken()).not.toThrow();
            expect(AuthStorage.getToken()).toBeNull();
            expect(AuthStorage.getAuthHeader()).toEqual({});
            expect(() => AuthStorage.saveRememberUsername('U1')).not.toThrow();
            expect(AuthStorage.getRememberUsername()).toBe('');
            expect(() => AuthStorage.clearRememberUsername()).not.toThrow();
            expect(() => AuthStorage.sanitizeLocalStorage()).not.toThrow();
        });
    });
});
