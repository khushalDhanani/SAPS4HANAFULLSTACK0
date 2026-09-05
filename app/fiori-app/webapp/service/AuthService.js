sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/model/json/JSONModel"
], function (BaseObject, JSONModel) {
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
                    if (oSession && oSession.user && oSession.token) {
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
         * No credentials are validated on the client — they are sent to the CAP server
         * which forwards them to the S/4HANA Gateway for verification.
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

                // Call CAP AuthService login action
                fetch("/odata/v4/auth/login", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        username: sTrimmedUser,
                        password: sTrimmedPass
                    })
                })
                .then(function (response) {
                    return response.json().then(function (data) {
                        return { status: response.status, ok: response.ok, data: data };
                    });
                })
                .then(function (result) {
                    if (!result.ok) {
                        var sErrorMsg = "Authentication failed. Please check your credentials.";
                        if (result.data && result.data.error && result.data.error.message) {
                            sErrorMsg = result.data.error.message;
                        }
                        reject({
                            code: "AUTH_FAILED",
                            message: sErrorMsg
                        });
                        return;
                    }

                    var oServerUser = result.data;

                    var oUserSession = {
                        username: oServerUser.username || sTrimmedUser,
                        avatarInitials: oServerUser.avatarInitials || sTrimmedUser.substring(0, 2).toUpperCase(),
                        system: oServerUser.system || "PRD",
                        loginTimestamp: oServerUser.loginTimestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    };

                    var sToken = "S4_TOKEN_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
                    var oStorageData = {
                        user: oUserSession,
                        token: sToken
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
                        code: "NETWORK_ERROR",
                        message: "Cannot connect to the authentication service. Please check your network connection and try again."
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
        }
    });

    var oInstance = new AuthService();
    return oInstance;
});
