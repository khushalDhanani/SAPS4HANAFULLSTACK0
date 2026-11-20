sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "saps4hana/fiori/service/ODataClient",
    "saps4hana/fiori/service/AuthStorage"
], function (BaseObject, JSONModel, Log, ODataClient, AuthStorage) {
    "use strict";

    var STORAGE_KEY = "saps4hana_fiori_auth_session";
    var REMEMBER_KEY = "saps4hana_fiori_remember_user";

    function _resolveStorage() {
        if (AuthStorage && typeof AuthStorage.loadSession === "function") {
            return AuthStorage;
        }
        var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
        var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
        if (oSap && oSap.ui && typeof oSap.ui.require === "function") {
            var reqStorage = oSap.ui.require("saps4hana/fiori/service/AuthStorage");
            if (reqStorage && typeof reqStorage.loadSession === "function") {
                return reqStorage;
            }
        }
        return null;
    }

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

        /**
         * Restores a stored session or probes the server for an SSO session.
         * Resolves with the authentication state once it is known, so routing can wait for it.
         * @returns {Promise<boolean>}
         */
        init: function (oComponent) {
            this._oComponent = oComponent;
            this._oComponent.setModel(this._oModel, "auth");
            var bRestored = this._restoreSession();
            this.syncModelHeaders(oComponent);
            if (bRestored) {
                return Promise.resolve(true);
            }
            return this.fetchCurrentUserInfo().then(function (oUser) {
                return Boolean(oUser && oUser.username);
            });
        },

        /**
         * Queries the CAP AuthService to get the current authenticated session
         * (enforced by XSUAA in deployed environments or via Bearer token in local dev).
         *
         * @returns {Promise<Object|null>}
         */
        fetchCurrentUserInfo: function () {
            var that = this;
            if (!ODataClient || typeof ODataClient.get !== "function") {
                return Promise.resolve(null);
            }
            return ODataClient.get("/odata/v4/auth/getUserInfo()")
                .then(function (oData) {
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
                })
                .catch(function (err) {
                    if (Log && typeof Log.info === "function") {
                        Log.info("AuthService: No active XSUAA/SSO session found (" + (err && err.message) + ")");
                    }
                    return null;
                });
        },

        /**
         * Synchronizes authentication Authorization header (Bearer token)
         * to all UI5 OData V4 framework models (default purchase-order, fiService,
         * salesInquiry, salesOrder, goodsReceipt).
         *
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @param {boolean} [bForce]
         */
        syncModelHeaders: function (oComponent, bForce) {
            var oComp = oComponent || this._oComponent;
            if (!oComp) {
                return;
            }
            var sToken = this.getToken();
            var sAuthHeader = sToken ? ("Bearer " + sToken) : undefined;

            // Avoid redundant and disruptive changeHttpHeaders calls if header did not change
            if (!bForce && this._sLastSyncedAuthHeader === sAuthHeader) {
                return;
            }

            var mHeaders = {
                "Authorization": sAuthHeader
            };

            var aModelNames = ["", "salesInquiry", "salesOrder", "goodsReceipt", "outboundDelivery", "customerInvoice", "customerReturn"];
            aModelNames.forEach(function (sModelName) {
                var oModel = sModelName ? oComp.getModel(sModelName) : oComp.getModel();
                if (oModel && typeof oModel.changeHttpHeaders === "function") {
                    try {
                        oModel.changeHttpHeaders(mHeaders);
                    } catch (err) {
                        // Prevent unhandled "Unexpected open requests" rejection if requests are in flight
                        if (Log && typeof Log.warning === "function") {
                            Log.warning("AuthService: Unable to update " + (sModelName || "default") + " model headers: " + (err && err.message));
                        }
                    }
                }
            });

            this._sLastSyncedAuthHeader = sAuthHeader;
        },

        getModel: function () {
            return this._oModel;
        },

        _isTokenExpired: function (sToken) {
            var oStorage = _resolveStorage();
            if (oStorage && typeof oStorage.isTokenExpired === "function") {
                return oStorage.isTokenExpired(sToken);
            }
            if (!sToken || typeof sToken !== "string") {
                return false;
            }
            try {
                var aParts = sToken.split(".");
                if (aParts.length !== 3) {
                    return false;
                }
                var sPayload = aParts[1].replace(/-/g, "+").replace(/_/g, "/");
                var sDecoded = typeof atob === "function" ? atob(sPayload) : (typeof Buffer !== "undefined" ? Buffer.from(sPayload, "base64").toString("utf-8") : "");
                var oPayload = JSON.parse(sDecoded);
                if (oPayload && typeof oPayload.exp === "number") {
                    var iNow = Math.floor(Date.now() / 1000);
                    return iNow >= oPayload.exp;
                }
            } catch (e) {
                // Ignore decoding errors
            }
            return false;
        },

        _restoreSession: function () {
            var oStorage = _resolveStorage();
            var sSavedUser = "";
            if (oStorage) {
                sSavedUser = oStorage.getRememberUsername();
            } else {
                try {
                    if (typeof localStorage !== "undefined" && localStorage) {
                        sSavedUser = localStorage.getItem(REMEMBER_KEY);
                    }
                } catch (e) {
                    // Storage may be disabled or blocked (private browsing)
                }
            }

            if (sSavedUser) {
                this._oModel.setProperty("/savedUsername", sSavedUser);
                this._oModel.setProperty("/rememberMe", true);
            } else {
                this._oModel.setProperty("/savedUsername", "");
                this._oModel.setProperty("/rememberMe", false);
            }

            var oSession = oStorage ? oStorage.loadSession() : this._fallbackLoadSession();
            if (oSession && oSession.user && oSession.user.username) {
                this._oModel.setProperty("/isAuthenticated", true);
                this._oModel.setProperty("/user", oSession.user);
                return true;
            }
            return false;
        },

        _fallbackLoadSession: function () {
            var sRawSession = null;
            try {
                if (typeof sessionStorage !== "undefined" && sessionStorage) {
                    sRawSession = sessionStorage.getItem(STORAGE_KEY);
                }
            } catch (e) {
                // Storage unavailable
            }

            try {
                if (typeof localStorage !== "undefined" && localStorage) {
                    var sLegacySession = localStorage.getItem(STORAGE_KEY);
                    if (sLegacySession) {
                        if (!sRawSession) {
                            sRawSession = sLegacySession;
                            if (typeof sessionStorage !== "undefined" && sessionStorage) {
                                try {
                                    sessionStorage.setItem(STORAGE_KEY, sLegacySession);
                                } catch (err) {
                                    // SessionStorage quota / blocked
                                }
                            }
                        }
                        localStorage.removeItem(STORAGE_KEY);
                    }
                }
            } catch (e) {
                // Storage error
            }

            if (sRawSession) {
                try {
                    var oSession = JSON.parse(sRawSession);
                    if (oSession && oSession.user && oSession.user.username) {
                        if (!oSession.user.token && oSession.token) {
                            oSession.user.token = oSession.token;
                        }
                        if (oSession.user.token && this._isTokenExpired(oSession.user.token)) {
                            try {
                                if (typeof sessionStorage !== "undefined" && sessionStorage) {
                                    sessionStorage.removeItem(STORAGE_KEY);
                                }
                            } catch (e) {
                                // ignore
                            }
                            return null;
                        }
                        return oSession;
                    }
                } catch (e) {
                    try {
                        if (typeof sessionStorage !== "undefined" && sessionStorage) {
                            sessionStorage.removeItem(STORAGE_KEY);
                        }
                    } catch (err) {
                        // ignore
                    }
                }
            }
            return null;
        },

        /**
         * Authenticate against the actual S/4HANA system via CAP AuthService backend.
         * Uses centralized ODataClient for CSRF, retries, and error handling.
         */
        login: function (sUsername, sPassword, bRememberMe) {
            var that = this;
            return new Promise(function (resolve, reject) {
                var sTrimmedUser = (sUsername || "").trim();
                var sTrimmedPass = (sPassword || "").trim();

                if (!sTrimmedUser || !sTrimmedPass) {
                    reject({
                        code: "REQUIRED_FIELDS",
                        message: "Username and password are required."
                    });
                    return;
                }

                // Call CAP AuthService login action via centralized ODataClient
                ODataClient.post("/odata/v4/auth/login", {
                    username: sTrimmedUser,
                    password: sTrimmedPass
                })
                    .then(function (oServerUser) {
                        // If server returned authenticated: false, reject cleanly with message
                        if (!oServerUser || oServerUser.authenticated === false) {
                            reject({
                                code: "AUTH_FAILED",
                                message: (oServerUser && oServerUser.message) || "Invalid username or password. Please verify your S/4HANA credentials."
                            });
                            return;
                        }

                        var oUserSession = {
                            username: oServerUser.username || sTrimmedUser,
                            avatarInitials: oServerUser.avatarInitials || sTrimmedUser.substring(0, 2).toUpperCase(),
                            system: oServerUser.system || "PRD",
                            loginTimestamp: oServerUser.loginTimestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                            token: oServerUser.token || null,
                            scopes: oServerUser.scopes || []
                        };

                        var oStorage = _resolveStorage();
                        if (oStorage) {
                            oStorage.saveSession(oUserSession);
                            if (bRememberMe) {
                                oStorage.saveRememberUsername(oUserSession.username);
                            } else {
                                oStorage.clearRememberUsername();
                            }
                        } else {
                            // Security: Active session tokens MUST NEVER be stored in localStorage.
                            // Active session always resides in sessionStorage (volatile, tab-scoped).
                            try {
                                if (typeof sessionStorage !== "undefined" && sessionStorage) {
                                    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ user: oUserSession, token: oUserSession.token }));
                                }
                            } catch (e) {
                                if (Log && typeof Log.warning === "function") {
                                    Log.warning("AuthService: Unable to persist session to sessionStorage: " + (e && e.message));
                                }
                            }

                            // Explicitly ensure localStorage never retains persistent session tokens
                            try {
                                if (typeof localStorage !== "undefined" && localStorage) {
                                    localStorage.removeItem(STORAGE_KEY);
                                }
                            } catch (e) {
                                // Storage error
                            }

                            // Remember Me ONLY stores the username identity hint in localStorage, NEVER credentials or tokens
                            try {
                                if (typeof localStorage !== "undefined" && localStorage) {
                                    if (bRememberMe) {
                                        localStorage.setItem(REMEMBER_KEY, oUserSession.username);
                                    } else {
                                        localStorage.removeItem(REMEMBER_KEY);
                                    }
                                }
                            } catch (e) {
                                if (Log && typeof Log.warning === "function") {
                                    Log.warning("AuthService: Unable to update rememberMe preference: " + (e && e.message));
                                }
                            }
                        }

                        that._oModel.setProperty("/isAuthenticated", true);
                        that._oModel.setProperty("/user", oUserSession);
                        that._oModel.setProperty("/rememberMe", Boolean(bRememberMe));
                        if (bRememberMe) {
                            that._oModel.setProperty("/savedUsername", oUserSession.username);
                        }
                        that.syncModelHeaders();

                        resolve(oUserSession);
                    })
                    .catch(function (err) {
                        reject({
                            code: "AUTH_FAILED",
                            message: (err && err.message)
                                ? err.message
                                : "Cannot connect to the authentication service. Please check your network connection and try again."
                        });
                    });
            });
        },

        logout: function () {
            var oStorage = _resolveStorage();
            var sSaved = "";
            if (oStorage) {
                oStorage.clearSession();
                sSaved = oStorage.getRememberUsername();
            } else {
                try {
                    if (typeof sessionStorage !== "undefined" && sessionStorage) {
                        sessionStorage.removeItem(STORAGE_KEY);
                    }
                } catch (e) {
                    // Storage error
                }
                try {
                    if (typeof localStorage !== "undefined" && localStorage) {
                        localStorage.removeItem(STORAGE_KEY);
                    }
                } catch (e) {
                    // Storage error
                }

                try {
                    if (typeof localStorage !== "undefined" && localStorage) {
                        sSaved = localStorage.getItem(REMEMBER_KEY) || "";
                    }
                } catch (e) {
                    // Storage error
                }
            }

            this._oModel.setProperty("/isAuthenticated", false);
            this._oModel.setProperty("/user", null);
            this._oModel.setProperty("/savedUsername", sSaved);
            this._sLastSyncedAuthHeader = null;
            this.syncModelHeaders();
        },

        isAuthenticated: function () {
            return this._oModel.getProperty("/isAuthenticated") === true;
        },

        /**
         * Resolves the current authenticated user's name across FLP Container,
         * AuthService model, and Component-scoped user/auth models.
         *
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @returns {string} The resolved username or empty string
         */
        getCurrentUserName: function (oComponent) {
            try {
                var oGlobal = typeof window !== "undefined" ? window : null;
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                var oUshell = oSap ? oSap["ushell"] : null;
                var oContainer = oUshell ? oUshell["Container"] : null;
                if (oContainer && typeof oContainer["getUser"] === "function") {
                    var oUser = oContainer["getUser"]();
                    if (oUser && typeof oUser["getId"] === "function" && oUser["getId"]()) {
                        return oUser["getId"]();
                    }
                }
            } catch (e) {
                // Ignore shell container error when running outside FLP
            }

            var oAuthUser = this.getCurrentUser();
            if (oAuthUser && oAuthUser.username && typeof oAuthUser.username === "string" && oAuthUser.username.trim() !== "") {
                return oAuthUser.username.trim();
            }

            if (oComponent && oComponent.getModel) {
                var oAuthModel = oComponent.getModel("auth");
                if (oAuthModel && oAuthModel.getProperty) {
                    var sAuthUser = oAuthModel.getProperty("/user/username");
                    if (sAuthUser && typeof sAuthUser === "string" && sAuthUser.trim() !== "") {
                        return sAuthUser.trim();
                    }
                }
                var oUserModel = oComponent.getModel("user");
                if (oUserModel && oUserModel.getProperty) {
                    var sUser = oUserModel.getProperty("/username");
                    if (sUser && typeof sUser === "string" && sUser.trim() !== "") {
                        return sUser.trim();
                    }
                }
            }
            return "";
        },

        getCurrentUser: function () {
            return this._oModel.getProperty("/user");
        },

        getToken: function () {
            var oUser = this._oModel.getProperty("/user");
            if (oUser && oUser.token) {
                return oUser.token;
            }
            var oStorage = _resolveStorage();
            if (oStorage) {
                return oStorage.getToken();
            }
            try {
                var sRaw = null;
                if (typeof sessionStorage !== "undefined" && sessionStorage) {
                    sRaw = sessionStorage.getItem(STORAGE_KEY);
                }
                // Fallback & sanitization: if in localStorage, migrate and purge
                if (!sRaw && typeof localStorage !== "undefined" && localStorage) {
                    var sLegacy = localStorage.getItem(STORAGE_KEY);
                    if (sLegacy) {
                        sRaw = sLegacy;
                        try {
                            if (typeof sessionStorage !== "undefined" && sessionStorage) {
                                sessionStorage.setItem(STORAGE_KEY, sLegacy);
                            }
                            localStorage.removeItem(STORAGE_KEY);
                        } catch (e) {
                            // ignore
                        }
                    }
                }
                if (sRaw) {
                    var parsed = JSON.parse(sRaw);
                    return (parsed && parsed.user && parsed.user.token) || (parsed && parsed.token) || null;
                }
            } catch (e) {
                // Corrupt or unreadable session storage: treated as "no token" and logged.
                if (Log && typeof Log.warning === "function") {
                    Log.warning("AuthService: stored auth session unreadable (" + (e && e.message) + ")");
                }
            }
            return null;
        },

        /**
         * Checks whether the current user has any of the specified roles / scopes.
         *
         * @param {string[]} aRoles
         * @returns {boolean}
         */
        hasAnyRole: function (aRoles) {
            var oUser = this.getCurrentUser();
            if (!oUser) {
                return false;
            }
            var aScopes = oUser.scopes || [];
            if (!Array.isArray(aRoles) || aRoles.length === 0) {
                return true;
            }
            var hasRole = function (sTargetRole) {
                return aScopes.some(function (sScope) {
                    if (typeof sScope !== "string") return false;
                    return sScope === sTargetRole || sScope.endsWith("." + sTargetRole);
                });
            };
            if (hasRole("Admin")) {
                return true;
            }
            return aRoles.some(function (sRole) {
                return hasRole(sRole);
            });
        },

        /**
         * Convenience helper to determine whether current user can create deliveries.
         *
         * @returns {boolean}
         */
        canCreateDelivery: function () {
            return this.hasAnyRole(["SalesRepresentative", "WarehouseClerk", "WarehouseManager", "SalesManager", "Admin"]);
        }
    });

    var oInstance = new AuthService();
    return oInstance;
});
