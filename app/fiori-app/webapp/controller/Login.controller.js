sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/library",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService"
], function (Controller, JSONModel, coreLibrary, MessageToast, AuthService) {
    "use strict";

    var ValueState = coreLibrary.ValueState;

    return Controller.extend("saps4hana.fiori.controller.Login", {
        onInit: function () {
            var sSavedUser = "";
            var oAuthModel = AuthService.getModel();
            if (oAuthModel) {
                sSavedUser = oAuthModel.getProperty("/savedUsername") || "";
            }

            var oViewModel = new JSONModel({
                username: sSavedUser,
                password: "",
                rememberMe: true,
                isBusy: false,
                hasError: false,
                errorMessage: "",
                usernameState: ValueState.None,
                usernameStateText: "",
                passwordState: ValueState.None,
                passwordStateText: ""
            });

            this.getView().setModel(oViewModel, "loginView");

            // Reset form state every time login page is navigated to (e.g. after logout)
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("login").attachPatternMatched(this._onLoginRouteMatched, this);
            oRouter.getRoute("default").attachPatternMatched(this._onLoginRouteMatched, this);
        },

        /**
         * Called every time the login route is matched — resets form state
         * so the user always sees a clean login form after logout.
         */
        _onLoginRouteMatched: function () {
            var oViewModel = this.getView().getModel("loginView");
            if (oViewModel) {
                var sSavedUser = "";
                var oAuthModel = AuthService.getModel();
                if (oAuthModel) {
                    sSavedUser = oAuthModel.getProperty("/savedUsername") || "";
                }
                oViewModel.setProperty("/username", sSavedUser);
                oViewModel.setProperty("/password", "");
                oViewModel.setProperty("/isBusy", false);
                oViewModel.setProperty("/hasError", false);
                oViewModel.setProperty("/errorMessage", "");
                oViewModel.setProperty("/usernameState", ValueState.None);
                oViewModel.setProperty("/usernameStateText", "");
                oViewModel.setProperty("/passwordState", ValueState.None);
                oViewModel.setProperty("/passwordStateText", "");
            }
        },

        onInputChange: function () {
            var oViewModel = this.getView().getModel("loginView");
            oViewModel.setProperty("/usernameState", ValueState.None);
            oViewModel.setProperty("/usernameStateText", "");
            oViewModel.setProperty("/passwordState", ValueState.None);
            oViewModel.setProperty("/passwordStateText", "");
            oViewModel.setProperty("/hasError", false);
        },

        onDismissError: function () {
            var oViewModel = this.getView().getModel("loginView");
            oViewModel.setProperty("/hasError", false);
            oViewModel.setProperty("/errorMessage", "");
        },

        onLogin: function () {
            var oViewModel = this.getView().getModel("loginView");
            var sUsername = oViewModel.getProperty("/username");
            var sPassword = oViewModel.getProperty("/password");
            var bRememberMe = oViewModel.getProperty("/rememberMe");
            var oResourceBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            var bValid = true;

            if (!sUsername || !sUsername.trim()) {
                oViewModel.setProperty("/usernameState", ValueState.Error);
                oViewModel.setProperty("/usernameStateText", oResourceBundle.getText("loginErrorRequired"));
                bValid = false;
            } else {
                oViewModel.setProperty("/usernameState", ValueState.None);
                oViewModel.setProperty("/usernameStateText", "");
            }

            if (!sPassword || !sPassword.trim()) {
                oViewModel.setProperty("/passwordState", ValueState.Error);
                oViewModel.setProperty("/passwordStateText", oResourceBundle.getText("loginErrorRequired"));
                bValid = false;
            } else {
                oViewModel.setProperty("/passwordState", ValueState.None);
                oViewModel.setProperty("/passwordStateText", "");
            }

            if (!bValid) {
                oViewModel.setProperty("/hasError", true);
                oViewModel.setProperty("/errorMessage", oResourceBundle.getText("loginErrorRequired"));
                return;
            }

            oViewModel.setProperty("/isBusy", true);
            oViewModel.setProperty("/hasError", false);

            var that = this;
            AuthService.login(sUsername, sPassword, bRememberMe)
                .then(function (oUser) {
                    oViewModel.setProperty("/isBusy", false);
                    oViewModel.setProperty("/password", "");
                    MessageToast.show(oResourceBundle.getText("loginSuccessMsg", [oUser.username]));

                    var oRouter = that.getOwnerComponent().getRouter();
                    oRouter.navTo("dashboard", {}, true);
                })
                .catch(function (oError) {
                    oViewModel.setProperty("/isBusy", false);
                    oViewModel.setProperty("/hasError", true);
                    oViewModel.setProperty("/errorMessage", oError.message || oResourceBundle.getText("loginErrorAuth"));
                });
        }
    });
});
