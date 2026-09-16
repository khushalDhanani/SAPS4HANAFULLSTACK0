sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "saps4hana/fiori/service/ODataClient"
], function (BaseObject, JSONModel, Log, ODataClient) {
    "use strict";

    var STORAGE_KEY = "saps4hana_fiori_auth_session";
    var REMEMBER_KEY = "saps4hana_fiori_remember_user";

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
            if (!bRestored) {
                this.fetchCurrentUserInfo();
            }
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
         * to UI5 OData V4 framework models (default model and fiService).
         *
         * @param {sap.ui.core.UIComponent} [oComponent]
         */
        syncModelHeaders: function (oComponent) {
            var oComp = oComponent || this._oComponent;
            if (!oComp) {
                return;
            }
            var sToken = this.getToken();
            var sAuthHeader = sToken ? ("Bearer " + sToken) : undefined;

            // Avoid redundant and disruptive changeHttpHeaders calls if header did not change
            if (this._sLastSyncedAuthHeader === sAuthHeader) {
                return;
            }

            var mHeaders = {
                "Authorization": sAuthHeader
            };

            var oDefaultModel = oComp.getModel();
            if (oDefaultModel && typeof oDefaultModel.changeHttpHeaders === "function") {
                try {
                    oDefaultModel.changeHttpHeaders(mHeaders);
                } catch (err) {
                    // Prevent unhandled "Unexpected open requests" rejection if requests are in flight
                    if (Log && typeof Log.warning === "function") {
                        Log.warning("AuthService: Unable to update default model headers: " + (err && err.message));
                    }
                }
            }

            var oFiModel = oComp.getModel("fiService");
            if (oFiModel && typeof oFiModel.changeHttpHeaders === "function") {
                try {
                    oFiModel.changeHttpHeaders(mHeaders);
                } catch (err) {
                    if (Log && typeof Log.warning === "function") {
                        Log.warning("AuthService: Unable to update fiService headers: " + (err && err.message));
                    }
                }
            }

            var oSdModel = oComp.getModel("salesInquiry");
            if (oSdModel && typeof oSdModel.changeHttpHeaders === "function") {
                try {
                    oSdModel.changeHttpHeaders(mHeaders);
                } catch (err) {
                    if (Log && typeof Log.warning === "function") {
                        Log.warning("AuthService: Unable to update salesInquiry headers: " + (err && err.message));
                    }
                }
            }

            this._sLastSyncedAuthHeader = sAuthHeader;
        },

        getModel: function () {
            return this._oModel;
        },

        _isTokenExpired: function (sToken) {
            if (!sToken || typeof sToken !== "string") {
                return false;
            }
            try {
                var aParts = sToken.split(".");
                if (aParts.length !== 3) {
                    return false;
                }
                var sPayload = aParts[1].replace(/-/g, "+").replace(/_/g, "/");
                var sDecoded = atob(sPayload);
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
            // Restore saved username for remember me
            var sSavedUser = localStorage.getItem(REMEMBER_KEY);
            if (sSavedUser) {
                this._oModel.setProperty("/savedUsername", sSavedUser);
                this._oModel.setProperty("/rememberMe", true);
            }

            // Check active session in sessionStorage or localStorage
            var sRawSession = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
            if (sRawSession) {
                try {
                    var oSession = JSON.parse(sRawSession);
                    if (oSession && oSession.user && oSession.user.username) {
                        if (!oSession.user.token && oSession.token) {
                            oSession.user.token = oSession.token;
                        }

                        // Validate token expiration before restoring session
                        if (oSession.user.token && this._isTokenExpired(oSession.user.token)) {
                            sessionStorage.removeItem(STORAGE_KEY);
                            localStorage.removeItem(STORAGE_KEY);
                            return false;
                        }

                        this._oModel.setProperty("/isAuthenticated", true);
                        this._oModel.setProperty("/user", oSession.user);
                        return true;
                    }
                } catch (e) {
                    sessionStorage.removeItem(STORAGE_KEY);
                    localStorage.removeItem(STORAGE_KEY);
                }
            }
            return false;
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

                        var oStorageData = {
                            user: oUserSession,
                            token: oUserSession.token
                        };

                        if (bRememberMe) {
                            localStorage.setItem(STORAGE_KEY, JSON.stringify(oStorageData));
                            localStorage.setItem(REMEMBER_KEY, oUserSession.username);
                        } else {
                            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(oStorageData));
                            localStorage.removeItem(REMEMBER_KEY);
                        }

                        that._oModel.setProperty("/isAuthenticated", true);
                        that._oModel.setProperty("/user", oUserSession);
                        that._oModel.setProperty("/rememberMe", bRememberMe);
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
            sessionStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STORAGE_KEY);

            var sSaved = localStorage.getItem(REMEMBER_KEY) || "";

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
            try {
                var sRaw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
                if (sRaw) {
                    var parsed = JSON.parse(sRaw);
                    return (parsed && parsed.user && parsed.user.token) || (parsed && parsed.token) || null;
                }
            } catch (e) {}
            return null;
        }
    });

    var oInstance = new AuthService();
    return oInstance;
});
