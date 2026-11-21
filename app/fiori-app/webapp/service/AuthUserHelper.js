sap.ui.define([], function () {
    "use strict";

    /**
     * AuthUserHelper
     *
     * Helper for resolving user identity across UI5/FLP models and evaluating role-based permissions.
     */
    return {
        /**
         * Resolves the current authenticated user's name across FLP Container,
         * AuthService model, and Component-scoped user/auth models.
         *
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @param {object} [oAuthUser]
         * @returns {string} The resolved username or empty string
         */
        getCurrentUserName: function (oComponent, oAuthUser) {
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

        /**
         * Checks whether the user has any of the specified roles / scopes.
         *
         * @param {object} oUser
         * @param {string[]} aRoles
         * @returns {boolean}
         */
        hasAnyRole: function (oUser, aRoles) {
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
         * @param {object} oUser
         * @returns {boolean}
         */
        canCreateDelivery: function (oUser) {
            return this.hasAnyRole(oUser, ["SalesRepresentative", "WarehouseClerk", "WarehouseManager", "SalesManager", "Admin"]);
        }
    };
});
