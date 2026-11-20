function createAdminUserFormatters(deps) {
    deps = deps || {};
    var UserListLogic = deps.UserListLogic;

    return {
        formatAdminDateTime: function (sDate, sTime) {
            var sFormatted = this.formatAdminDate(sDate);
            return sFormatted !== "-" && /^\d{6}$/.test(sTime || "")
                ? sFormatted + " " + sTime.slice(0, 2) + ":" + sTime.slice(2, 4) + ":" + sTime.slice(4, 6)
                : sFormatted;
        },

        formatAdminValidity: function (sFrom, sTo) {
            return this.formatAdminDate(sFrom) + " - " + this.formatAdminDate(sTo);
        },

        formatAdminUserType: function (sCode) {
            return this._text("adminUserType" + sCode, sCode || "-");
        },

        formatAdminDateFormat: function (sCode) {
            return this._text("adminDateFormat" + sCode, sCode || "-");
        },

        formatAdminDecimalFormat: function (sCode) {
            return this._text("adminDecimalFormat" + sCode, sCode || "-");
        },

        formatAdminLockFlag: function (sFlag) {
            return sFlag === "U" ? this._text("adminStatusNotLocked", "Not Locked") : this._text("adminStatusLocked", "Locked");
        },

        formatAdminDate: function (sDate) {
            if (!sDate || sDate === "00000000") {
                return "-";
            }
            if (typeof sDate !== "string" || !/^\d{8}$/.test(sDate)) {
                return sDate;
            }
            return sDate.slice(6, 8) + "-" + sDate.slice(4, 6) + "-" + sDate.slice(0, 4);
        },

        formatAdminPwdStatusText: function (sStatus, iDaysRemaining) {
            switch (sStatus) {
                case "expired":
                    return this._text("adminPwdStatusExpired", "Expired");
                case "expiring_soon":
                    if (typeof iDaysRemaining === "number") {
                        return this._text("adminPwdStatusExpiringDays", "Expires in {0} days", [String(iDaysRemaining)]);
                    }
                    return this._text("adminPwdStatusExpiringSoon", "Expiring Soon");
                case "initial":
                    return this._text("adminPwdStatusInitial", "Initial Password");
                case "exempt":
                    return this._text("adminPwdStatusExempt", "Exempt (System)");
                case "valid":
                    return this._text("adminPwdStatusValid", "Active");
                default:
                    return "-";
            }
        },

        formatAdminPwdStatusState: function (sStatus) {
            switch (sStatus) {
                case "expired":
                    return "Error";
                case "expiring_soon":
                    return "Warning";
                case "initial":
                    return "Information";
                case "valid":
                    return "Success";
                default:
                    return "None";
            }
        },

        formatAdminPwdStatusIcon: function (sStatus) {
            switch (sStatus) {
                case "expired":
                    return "sap-icon://error";
                case "expiring_soon":
                    return "sap-icon://alert";
                case "initial":
                    return "sap-icon://user-edit";
                case "valid":
                    return "sap-icon://sys-enter-2";
                case "exempt":
                    return "sap-icon://inspect";
                default:
                    return "sap-icon://question-mark";
            }
        },

        formatAdminHighlight: function (sValue, sSearch) {
            return UserListLogic ? UserListLogic.highlight(sValue, sSearch) : sValue;
        },

        formatAdminUsername: function (sValue, sSearch) {
            return "<strong>" + (UserListLogic ? UserListLogic.highlight(sValue, sSearch) : sValue) + "</strong>";
        },

        formatAdminSelectTooltip: function (sUsername, sProtectedReason, bDetailsAvailable) {
            var mReasons = {
                self: ["adminProtectedSelf", "You cannot lock your own user."],
                connection: ["adminProtectedConnection", "This is the user the app connects to SAP with, so it cannot be locked."],
                type: ["adminProtectedType", "System and Service users are protected from locking."]
            };
            if (mReasons[sProtectedReason]) {
                return this._text(mReasons[sProtectedReason][0], mReasons[sProtectedReason][1]);
            }
            return bDetailsAvailable
                ? this._text("adminBulkSelectUser", "Select user {0}", [sUsername])
                : this._text("adminBulkNoDetails", "This user's details could not be read from SAP.");
        },

        _lockStatusText: function (oUser) {
            if (!oUser.detailsAvailable) {
                return this._text("adminDetailsUnavailable", "Details unavailable");
            }
            return oUser.isLocked ? this._text("adminStatusLocked", "Locked") : this._text("adminStatusUnlocked", "Active");
        }
    };
}

var oExports = {
    createAdminUserFormatters: createAdminUserFormatters
};

var isNode = typeof module !== "undefined" && module.exports;
if (isNode) {
    module.exports = oExports;
}
if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
    sap.ui.define([], function () {
        return oExports;
    });
}
