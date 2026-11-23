sap.ui.define([
    "sap/base/Log"
], function (Log) {
    "use strict";

    var STORAGE_KEY = "saps4hana_fiori_auth_session";
    var REMEMBER_KEY = "saps4hana_fiori_remember_user";

    /**
     * Frontend Authentication Storage Security Architecture (Finding UI-02 / SEC-02)
     * - Volatile Tier (sessionStorage): Strictly tab/window-scoped. Stores ephemeral session tokens.
     * - Persistent Tier (localStorage): Disk-persisted; strictly for non-sensitive UI hints.
     * - Disk Sanitization: Legacy session token in localStorage is migrated to sessionStorage & purged.
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
                    return Math.floor(Date.now() / 1000) >= oPayload.exp;
                }
            } catch (e) {
                // Ignore decoding / parse errors
            }
            return false;
        },

        saveSession: function (oUserSession) {
            if (!oUserSession || typeof oUserSession !== "object") {
                return false;
            }
            var sSerialized = JSON.stringify({ user: oUserSession, token: oUserSession.token || null });
            var oSessionStorage = this.getSessionStorage();
            if (oSessionStorage) {
                try {
                    oSessionStorage.setItem(STORAGE_KEY, sSerialized);
                } catch (e) {
                    if (Log && typeof Log.warning === "function") {
                        Log.warning("AuthStorage: Unable to persist session: " + (e && e.message));
                    }
                }
            }
            var oLocalStorage = this.getLocalStorage();
            if (oLocalStorage) {
                try {
                    oLocalStorage.removeItem(STORAGE_KEY);
                } catch (e) {}
            }
            return true;
        },

        loadSession: function () {
            var oSessionStorage = this.getSessionStorage();
            var oLocalStorage = this.getLocalStorage();
            var sRawSession = null;
            if (oSessionStorage) {
                try {
                    sRawSession = oSessionStorage.getItem(STORAGE_KEY);
                } catch (e) {}
            }
            if (oLocalStorage) {
                try {
                    var sLegacySession = oLocalStorage.getItem(STORAGE_KEY);
                    if (sLegacySession) {
                        if (!sRawSession) {
                            sRawSession = sLegacySession;
                            if (oSessionStorage) {
                                try {
                                    oSessionStorage.setItem(STORAGE_KEY, sLegacySession);
                                } catch (err) {}
                            }
                        }
                        oLocalStorage.removeItem(STORAGE_KEY);
                    }
                } catch (e) {}
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

        clearSession: function () {
            var oSessionStorage = this.getSessionStorage();
            if (oSessionStorage) {
                try { oSessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
            }
            var oLocalStorage = this.getLocalStorage();
            if (oLocalStorage) {
                try { oLocalStorage.removeItem(STORAGE_KEY); } catch (e) {}
            }
        },

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

        getAuthHeader: function () {
            var sToken = this.getToken();
            return (sToken && typeof sToken === "string") ? { "Authorization": "Bearer " + sToken } : {};
        },

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
                    Log.warning("AuthStorage: Unable to update rememberMe: " + (e && e.message));
                }
            }
        },

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

        clearRememberUsername: function () {
            var oLocalStorage = this.getLocalStorage();
            if (!oLocalStorage) {
                return;
            }
            try {
                oLocalStorage.removeItem(REMEMBER_KEY);
            } catch (e) {}
        },

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
            } catch (e) {}
            return false;
        }
    };

    return AuthStorage;
});
