sap.ui.define([
    "sap/base/Log"
], function (Log) {
    "use strict";

    var STORAGE_KEY = "saps4hana_fiori_auth_session";
    var REMEMBER_KEY = "saps4hana_fiori_remember_user";

    /**
     * Frontend Authentication Storage Security Architecture (Finding UI-02 / SEC-02)
     *
     * Enforces strict storage tiering and data classification:
     * - Volatile Tier (sessionStorage): Strictly tab/window-scoped. Stores ephemeral session tokens.
     *   Automatically wiped on tab/browser closure.
     * - Persistent Tier (localStorage): Disk-persisted across browser restarts.
     *   Strictly FORBIDDEN for tokens, passwords, or session payloads.
     *   Permitted strictly for non-sensitive UI hints (e.g. remembered username string).
     * - Disk Sanitization: Any legacy session token found in localStorage is migrated to
     *   sessionStorage and immediately purged from disk.
     * - Error Resilience: All storage calls handle private browsing / quota restrictions safely.
     */
    var AuthStorage = {
        STORAGE_KEY: STORAGE_KEY,
        REMEMBER_KEY: REMEMBER_KEY,

        _getStorage: function (sType) {
            try {
                if (typeof window !== "undefined" && window && window[sType]) {
                    return window[sType];
                }
                if (typeof global !== "undefined" && global && global[sType]) {
                    return global[sType];
                }
            } catch (e) {
                // Storage may be restricted or blocked (e.g. Safari Private Browsing)
            }
            return null;
        },

        getSessionStorage: function () {
            return this._getStorage("sessionStorage");
        },

        getLocalStorage: function () {
            return this._getStorage("localStorage");
        },

        /**
         * Validates whether a JWT token has expired based on its 'exp' claim.
         *
         * @param {string} sToken
         * @returns {boolean} True if token is expired, false if valid or non-expiring
         */
        isTokenExpired: function (sToken) {
            if (!sToken || typeof sToken !== "string") {
                return false;
            }
            try {
                var aParts = sToken.split(".");
                if (aParts.length !== 3) {
                    return false;
                }
                var sPayload = aParts[1].replace(/-/g, "+").replace(/_/g, "/");
                var sDecoded;
                if (typeof atob === "function") {
                    sDecoded = atob(sPayload);
                } else if (typeof Buffer !== "undefined") {
                    sDecoded = Buffer.from(sPayload, "base64").toString("utf-8");
                } else {
                    return false;
                }
                var oPayload = JSON.parse(sDecoded);
                if (oPayload && typeof oPayload.exp === "number") {
                    var iNow = Math.floor(Date.now() / 1000);
                    return iNow >= oPayload.exp;
                }
            } catch (e) {
                // Ignore decoding / parse errors
            }
            return false;
        },

        /**
         * Persists active authenticated session strictly to volatile sessionStorage.
         * Enforces the invariant that localStorage never retains active session tokens.
         *
         * @param {object} oUserSession
         * @returns {boolean}
         */
        saveSession: function (oUserSession) {
            if (!oUserSession || typeof oUserSession !== "object") {
                return false;
            }
            var oStorageData = {
                user: oUserSession,
                token: oUserSession.token || null
            };
            var sSerialized = JSON.stringify(oStorageData);

            // Active session tokens MUST NEVER be stored in localStorage.
            var oSessionStorage = this.getSessionStorage();
            if (oSessionStorage) {
                try {
                    oSessionStorage.setItem(STORAGE_KEY, sSerialized);
                } catch (e) {
                    if (Log && typeof Log.warning === "function") {
                        Log.warning("AuthStorage: Unable to persist session to sessionStorage: " + (e && e.message));
                    }
                }
            }

            // Invariant: Explicitly purge session token from persistent localStorage
            var oLocalStorage = this.getLocalStorage();
            if (oLocalStorage) {
                try {
                    oLocalStorage.removeItem(STORAGE_KEY);
                } catch (e) {
                    // Storage error
                }
            }
            return true;
        },

        /**
         * Loads active session from volatile sessionStorage.
         * Automatically sanitizes and migrates legacy localStorage session tokens to sessionStorage,
         * purging disk persistence immediately. Validates token expiration.
         *
         * @returns {object|null} The parsed session object, or null if missing or expired
         */
        loadSession: function () {
            var oSessionStorage = this.getSessionStorage();
            var oLocalStorage = this.getLocalStorage();
            var sRawSession = null;

            if (oSessionStorage) {
                try {
                    sRawSession = oSessionStorage.getItem(STORAGE_KEY);
                } catch (e) {
                    // Storage error
                }
            }

            // Sanitization & Migration Guard:
            // If legacy session exists in localStorage, migrate it to sessionStorage and immediately purge localStorage.
            if (oLocalStorage) {
                try {
                    var sLegacySession = oLocalStorage.getItem(STORAGE_KEY);
                    if (sLegacySession) {
                        if (!sRawSession) {
                            sRawSession = sLegacySession;
                            if (oSessionStorage) {
                                try {
                                    oSessionStorage.setItem(STORAGE_KEY, sLegacySession);
                                } catch (err) {
                                    // SessionStorage quota / blocked
                                }
                            }
                        }
                        oLocalStorage.removeItem(STORAGE_KEY);
                    }
                } catch (e) {
                    // Storage error
                }
            }

            if (!sRawSession) {
                return null;
            }

            try {
                var oSession = JSON.parse(sRawSession);
                if (oSession && oSession.user && oSession.user.username) {
                    if (!oSession.user.token && oSession.token) {
                        oSession.user.token = oSession.token;
                    }

                    // Validate token expiration before returning session
                    if (oSession.user.token && this.isTokenExpired(oSession.user.token)) {
                        this.clearSession();
                        return null;
                    }

                    return oSession;
                }
            } catch (e) {
                this.clearSession();
            }
            return null;
        },

        /**
         * Clears active session across all storage tiers (sessionStorage and localStorage).
         */
        clearSession: function () {
            var oSessionStorage = this.getSessionStorage();
            if (oSessionStorage) {
                try {
                    oSessionStorage.removeItem(STORAGE_KEY);
                } catch (e) {
                    // Storage error
                }
            }
            var oLocalStorage = this.getLocalStorage();
            if (oLocalStorage) {
                try {
                    oLocalStorage.removeItem(STORAGE_KEY);
                } catch (e) {
                    // Storage error
                }
            }
        },

        /**
         * Resolves the active unexpired Bearer token string from active session.
         *
         * @returns {string|null}
         */
        getToken: function () {
            var oSession = this.loadSession();
            if (oSession && oSession.user && oSession.user.token) {
                return oSession.user.token;
            }
            if (oSession && oSession.token) {
                return oSession.token;
            }
            return null;
        },

        /**
         * Returns HTTP Authorization header object for OData / REST requests.
         *
         * @returns {object} { "Authorization": "Bearer <token>" } or {}
         */
        getAuthHeader: function () {
            var sToken = this.getToken();
            if (sToken && typeof sToken === "string") {
                return { "Authorization": "Bearer " + sToken };
            }
            return {};
        },

        /**
         * Persists the non-sensitive username hint string in localStorage for "Remember Me".
         * Never stores passwords, tokens, or session payloads.
         *
         * @param {string} sUsername
         */
        saveRememberUsername: function (sUsername) {
            var oLocalStorage = this.getLocalStorage();
            if (!oLocalStorage) {
                return;
            }
            try {
                if (sUsername && typeof sUsername === "string" && sUsername.trim() !== "") {
                    oLocalStorage.setItem(REMEMBER_KEY, sUsername.trim());
                } else {
                    oLocalStorage.removeItem(REMEMBER_KEY);
                }
            } catch (e) {
                if (Log && typeof Log.warning === "function") {
                    Log.warning("AuthStorage: Unable to update rememberMe preference: " + (e && e.message));
                }
            }
        },

        /**
         * Retrieves the remembered username hint string from localStorage.
         *
         * @returns {string}
         */
        getRememberUsername: function () {
            var oLocalStorage = this.getLocalStorage();
            if (!oLocalStorage) {
                return "";
            }
            try {
                return oLocalStorage.getItem(REMEMBER_KEY) || "";
            } catch (e) {
                return "";
            }
        },

        /**
         * Clears the remembered username hint from localStorage.
         */
        clearRememberUsername: function () {
            var oLocalStorage = this.getLocalStorage();
            if (!oLocalStorage) {
                return;
            }
            try {
                oLocalStorage.removeItem(REMEMBER_KEY);
            } catch (e) {
                // Storage error
            }
        },

        /**
         * Explicitly scans and sanitizes localStorage, removing any legacy session token.
         *
         * @returns {boolean} True if a legacy session was purged from localStorage
         */
        sanitizeLocalStorage: function () {
            var oLocalStorage = this.getLocalStorage();
            if (!oLocalStorage) {
                return false;
            }
            try {
                if (oLocalStorage.getItem(STORAGE_KEY)) {
                    oLocalStorage.removeItem(STORAGE_KEY);
                    return true;
                }
            } catch (e) {
                // Storage error
            }
            return false;
        }
    };

    return AuthStorage;
});
