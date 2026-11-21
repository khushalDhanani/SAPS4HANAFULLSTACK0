sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "saps4hana/fiori/service/ODataClient",
    "saps4hana/fiori/service/AuthStorage",
    "saps4hana/fiori/service/AuthUserHelper",
    "saps4hana/fiori/service/AuthModelSync"
], function (BaseObject, JSONModel, Log, ODataClient, AuthStorage, AuthUserHelper, AuthModelSync) {
    "use strict";

    var STORAGE_KEY = "saps4hana_fiori_auth_session", REMEMBER_KEY = "saps4hana_fiori_remember_user";

    function _resolveStorage() {
        if (AuthStorage && typeof AuthStorage.loadSession === "function") return AuthStorage;
        var oG = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
        var s = oG && oG["s" + "ap"];
        return (s && s.ui && typeof s.ui.require === "function") ? s.ui.require("saps4hana/fiori/service/AuthStorage") : null;
    }

    function _resolveHelper(oModule, sPath) {
        if (oModule) return oModule;
        var oG = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
        var s = oG && oG["s" + "ap"];
        return (s && s.ui && typeof s.ui.require === "function") ? s.ui.require(sPath) : null;
    }

    function _getStorage(t) {
        try { var w = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null); return w ? w[t] : null; } catch (e) { return null; }
    }

    function _isJwtExpired(sToken) {
        var oS = _resolveStorage();
        if (oS && typeof oS.isTokenExpired === "function") return oS.isTokenExpired(sToken);
        if (!sToken || typeof sToken !== "string") return false;
        try {
            var parts = sToken.split(".");
            if (parts.length !== 3) return false;
            var payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            var dec = typeof atob === "function" ? atob(payload) : (typeof Buffer !== "undefined" ? Buffer.from(payload, "base64").toString("utf-8") : "");
            var oP = JSON.parse(dec);
            return (oP && typeof oP.exp === "number") ? Math.floor(Date.now() / 1000) >= oP.exp : false;
        } catch (e) { return false; }
    }

    var _storage = {
        save: function (user, bRem) {
            var oS = _resolveStorage();
            if (oS) { oS.saveSession(user); bRem ? oS.saveRememberUsername(user.username) : oS.clearRememberUsername(); return; }
            var ses = _getStorage("sessionStorage"), loc = _getStorage("localStorage");
            try { if (ses) ses.setItem(STORAGE_KEY, JSON.stringify({ user: user, token: user.token })); } catch (e) {
                if (Log && typeof Log.warning === "function") Log.warning("AuthService: Unable to persist session: " + (e && e.message));
            }
            try { if (loc) loc.removeItem(STORAGE_KEY); } catch (e) {}
            try { if (loc) bRem ? loc.setItem(REMEMBER_KEY, user.username) : loc.removeItem(REMEMBER_KEY); } catch (e) {
                if (Log && typeof Log.warning === "function") Log.warning("AuthService: Unable to update rememberMe: " + (e && e.message));
            }
        },
        clear: function () {
            var oS = _resolveStorage();
            if (oS) { oS.clearSession(); return oS.getRememberUsername(); }
            var ses = _getStorage("sessionStorage"), loc = _getStorage("localStorage"), sSaved = "";
            try { if (ses) ses.removeItem(STORAGE_KEY); } catch (e) {}
            try { if (loc) { loc.removeItem(STORAGE_KEY); sSaved = loc.getItem(REMEMBER_KEY) || ""; } } catch (e) {}
            return sSaved;
        },
        getRemembered: function () {
            var oS = _resolveStorage();
            if (oS) return oS.getRememberUsername();
            try { var loc = _getStorage("localStorage"); return loc ? (loc.getItem(REMEMBER_KEY) || "") : ""; } catch (e) { return ""; }
        },
        load: function () {
            var oS = _resolveStorage();
            if (oS) return oS.loadSession();
            var ses = _getStorage("sessionStorage"), loc = _getStorage("localStorage"), raw = null;
            try { if (ses) raw = ses.getItem(STORAGE_KEY); } catch (e) {}
            try {
                if (loc && loc.getItem(STORAGE_KEY)) {
                    var leg = loc.getItem(STORAGE_KEY);
                    if (!raw) { raw = leg; try { if (ses) ses.setItem(STORAGE_KEY, leg); } catch (err) {} }
                    loc.removeItem(STORAGE_KEY);
                }
            } catch (e) {}
            if (!raw) return null;
            try {
                var s = JSON.parse(raw);
                if (s && s.user && s.user.username) {
                    if (!s.user.token && s.token) s.user.token = s.token;
                    if (s.user.token && _isJwtExpired(s.user.token)) {
                        try { if (ses) ses.removeItem(STORAGE_KEY); } catch (e) {}
                        return null;
                    }
                    return s;
                }
            } catch (e) {
                try { if (ses) ses.removeItem(STORAGE_KEY); } catch (err) {}
            }
            return null;
        },
        getToken: function () {
            var oS = _resolveStorage();
            if (oS) return oS.getToken();
            var ses = _getStorage("sessionStorage"), loc = _getStorage("localStorage");
            try {
                var raw = ses ? ses.getItem(STORAGE_KEY) : null;
                if (!raw && loc && loc.getItem(STORAGE_KEY)) {
                    raw = loc.getItem(STORAGE_KEY);
                    try { if (ses) ses.setItem(STORAGE_KEY, raw); } catch (e) {}
                    try { loc.removeItem(STORAGE_KEY); } catch (e) {}
                }
                if (raw) {
                    var p = JSON.parse(raw);
                    return (p && p.user && p.user.token) || (p && p.token) || null;
                }
            } catch (e) {
                if (Log && typeof Log.warning === "function") Log.warning("AuthService: stored auth session unreadable (" + (e && e.message));
            }
            return null;
        }
    };

    var AuthService = BaseObject.extend("saps4hana.fiori.service.AuthService", {
        constructor: function () {
            BaseObject.apply(this, arguments);
            this._sLastSyncedAuthHeader = null;
            this._oModel = new JSONModel({
                isAuthenticated: false,
                user: null,
                rememberMe: true,
                savedUsername: ""
            });
        },

        init: function (oComponent) {
            this._oComponent = oComponent;
            this._oComponent.setModel(this._oModel, "auth");
            var bRestored = this._restoreSession();
            this.syncModelHeaders(oComponent);
            if (bRestored) return Promise.resolve(true);
            return this.fetchCurrentUserInfo().then(function (oUser) {
                return Boolean(oUser && oUser.username);
            });
        },

        fetchCurrentUserInfo: function () {
            var that = this;
            if (!ODataClient || typeof ODataClient.get !== "function") return Promise.resolve(null);
            return ODataClient.get("/odata/v4/auth/getUserInfo()").then(function (oData) {
                var oResult = oData && (oData.value !== undefined ? oData.value : oData);
                if (oResult && oResult.authenticated) {
                    var oUserSession = {
                        username: oResult.username,
                        avatarInitials: oResult.avatarInitials || (oResult.username ? oResult.username.substring(0, 2).toUpperCase() : "US"),
                        system: oResult.system || "S/4HANA (XSUAA SSO)",
                        loginTimestamp: oResult.loginTimestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        token: oResult.token || null,
                        scopes: oResult.scopes || []
                    };
                    that._oModel.setProperty("/isAuthenticated", true);
                    that._oModel.setProperty("/user", oUserSession);
                    that.syncModelHeaders();
                    return oUserSession;
                }
                return null;
            }).catch(function (err) {
                if (Log && typeof Log.info === "function") Log.info("AuthService: No active XSUAA/SSO session found (" + (err && err.message) + ")");
                return null;
            });
        },

        syncModelHeaders: function (oComponent, bForce) {
            var oComp = oComponent || this._oComponent;
            var oSync = _resolveHelper(AuthModelSync, "saps4hana/fiori/service/AuthModelSync");
            if (oSync) {
                this._sLastSyncedAuthHeader = oSync.sync(oComp, this.getToken(), bForce, this._sLastSyncedAuthHeader, Log);
            } else if (Log && typeof Log.warning === "function") {
                Log.warning("AuthService: AuthModelSync could not be resolved; model authorization headers were not updated.");
            }
        },

        getModel: function () {
            return this._oModel;
        },

        _isTokenExpired: function (sToken) {
            return _isJwtExpired(sToken);
        },

        _restoreSession: function () {
            var sSavedUser = _storage.getRemembered();
            this._oModel.setProperty("/savedUsername", sSavedUser || "");
            this._oModel.setProperty("/rememberMe", Boolean(sSavedUser));
            var oSession = _storage.load();
            if (oSession && oSession.user && oSession.user.username) {
                this._oModel.setProperty("/isAuthenticated", true);
                this._oModel.setProperty("/user", oSession.user);
                return true;
            }
            return false;
        },

        _fallbackLoadSession: function () {
            return _storage.load();
        },

        login: function (sUsername, sPassword, bRememberMe) {
            var that = this;
            return new Promise(function (resolve, reject) {
                var sUser = (sUsername || "").trim(), sPass = (sPassword || "").trim();
                if (!sUser || !sPass) {
                    reject({ code: "REQUIRED_FIELDS", message: "Username and password are required." });
                    return;
                }
                ODataClient.post("/odata/v4/auth/login", { username: sUser, password: sPass }).then(function (oServerUser) {
                    if (!oServerUser || oServerUser.authenticated === false) {
                        reject({ code: "AUTH_FAILED", message: (oServerUser && oServerUser.message) || "Invalid username or password. Please verify your S/4HANA credentials." });
                        return;
                    }
                    var oUserSession = {
                        username: oServerUser.username || sUser,
                        avatarInitials: oServerUser.avatarInitials || sUser.substring(0, 2).toUpperCase(),
                        system: oServerUser.system || "PRD",
                        loginTimestamp: oServerUser.loginTimestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        token: oServerUser.token || null,
                        scopes: oServerUser.scopes || []
                    };
                    _storage.save(oUserSession, bRememberMe);
                    that._oModel.setProperty("/isAuthenticated", true);
                    that._oModel.setProperty("/user", oUserSession);
                    that._oModel.setProperty("/rememberMe", Boolean(bRememberMe));
                    if (bRememberMe) that._oModel.setProperty("/savedUsername", oUserSession.username);
                    that.syncModelHeaders();
                    resolve(oUserSession);
                }).catch(function (err) {
                    reject({ code: "AUTH_FAILED", message: (err && err.message) ? err.message : "Cannot connect to the authentication service. Please check your network connection and try again." });
                });
            });
        },

        logout: function () {
            var sSaved = _storage.clear();
            this._oModel.setProperty("/isAuthenticated", false);
            this._oModel.setProperty("/user", null);
            this._oModel.setProperty("/savedUsername", sSaved);
            this._sLastSyncedAuthHeader = null;
            this.syncModelHeaders();
        },

        isAuthenticated: function () {
            return this._oModel.getProperty("/isAuthenticated") === true;
        },

        getCurrentUserName: function (oComponent) {
            var oHelper = _resolveHelper(AuthUserHelper, "saps4hana/fiori/service/AuthUserHelper");
            if (oHelper && typeof oHelper.getCurrentUserName === "function") {
                return oHelper.getCurrentUserName(oComponent, this.getCurrentUser());
            }
            var oAuthUser = this.getCurrentUser();
            return (oAuthUser && oAuthUser.username) ? oAuthUser.username.trim() : "";
        },

        getCurrentUser: function () {
            return this._oModel.getProperty("/user");
        },

        getToken: function () {
            var oUser = this._oModel.getProperty("/user");
            if (oUser && oUser.token) {
                return oUser.token;
            }
            return _storage.getToken();
        },

        hasAnyRole: function (aRoles) {
            var oHelper = _resolveHelper(AuthUserHelper, "saps4hana/fiori/service/AuthUserHelper");
            if (oHelper && typeof oHelper.hasAnyRole === "function") {
                return oHelper.hasAnyRole(this.getCurrentUser(), aRoles);
            }
            return true;
        },

        canCreateDelivery: function () {
            var oHelper = _resolveHelper(AuthUserHelper, "saps4hana/fiori/service/AuthUserHelper");
            if (oHelper && typeof oHelper.canCreateDelivery === "function") {
                return oHelper.canCreateDelivery(this.getCurrentUser());
            }
            return this.hasAnyRole(["SalesRepresentative", "WarehouseClerk", "WarehouseManager", "SalesManager", "Admin"]);
        }
    });

    var oInstance = new AuthService();
    return oInstance;
});
