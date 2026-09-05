sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseObject, JSONModel, ODataClient) {
    "use strict";

    var STORAGE_KEY = "saps4hana_fiori_auth_session";
    var REMEMBER_KEY = "saps4hana_fiori_remember_user";

    var AuthService = BaseObject.extend("saps4hana.fiori.service.AuthService", {
        constructor: function () {
            BaseObject.apply(this, arguments);
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
            this._restoreSession();
        },

        getModel: function () {
            return this._oModel;
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
                            user: oUserSession
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
        },

        isAuthenticated: function () {
            return this._oModel.getProperty("/isAuthenticated") === true;
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
                    return (parsed && parsed.user && parsed.user.token) || null;
                }
            } catch (e) {}
            return null;
        }
    });

    var oInstance = new AuthService();
    return oInstance;
});
