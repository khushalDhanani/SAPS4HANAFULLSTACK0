var SEARCH_DEBOUNCE_MS = 300;

function createAdminUserFilterSection(deps) {
    deps = deps || {};
    var UserListLogic = deps.UserListLogic;

    return {
        _chipsFor: function (oFilters) {
            var that = this;
            var aChips = [];
            var fnAdd = function (sKey, sTextKey, aArgs) {
                aChips.push({ key: sKey, text: that._text(sTextKey, sKey, aArgs) });
            };
            if (oFilters.search) {
                fnAdd("search:", "adminChipSearch", [oFilters.search]);
            }
            if (oFilters.lockStatus) {
                var mStatus = { active: "adminStatusUnlocked", locked: "adminStatusLocked", unavailable: "adminDetailsUnavailable" };
                fnAdd("lockStatus:", "adminChipLockStatus", [this._text(mStatus[oFilters.lockStatus], oFilters.lockStatus)]);
            }
            if (oFilters.pwdStatus) {
                var mPwdStatus = {
                    valid: "adminPwdStatusValid",
                    expiring_soon: "adminPwdStatusExpiringSoon",
                    expired: "adminPwdStatusExpired",
                    initial: "adminPwdStatusInitial",
                    exempt: "adminPwdStatusExempt"
                };
                fnAdd("pwdStatus:" + oFilters.pwdStatus, "adminChipPwdStatus", [this._text(mPwdStatus[oFilters.pwdStatus] || oFilters.pwdStatus, oFilters.pwdStatus)]);
            }
            oFilters.userTypes.forEach(function (sType) {
                fnAdd("userTypes:" + sType, "adminChipUserType", [that.formatAdminUserType(sType)]);
            });
            oFilters.changedBy.forEach(function (sUser) {
                fnAdd("changedBy:" + sUser, "adminChipChangedBy", [sUser]);
            });
            if (oFilters.changedFrom || oFilters.changedTo) {
                fnAdd("changed:", "adminChipChanged", [this.formatAdminDate(oFilters.changedFrom), this.formatAdminDate(oFilters.changedTo)]);
            }
            return aChips;
        },

        _syncAdminDateRange: function (oFilters) {
            var oRange = this.byId("adminChangedRangeFilter");
            if (!oRange) {
                return;
            }
            var fnToDate = function (sDay) {
                return sDay ? new Date(Number(sDay.slice(0, 4)), Number(sDay.slice(4, 6)) - 1, Number(sDay.slice(6, 8))) : null;
            };
            oRange.setDateValue(fnToDate(oFilters.changedFrom));
            oRange.setSecondDateValue(fnToDate(oFilters.changedTo));
        },

        _setAdminFilters: function (oFilters) {
            var oAdminModel = this.getView().getModel("adminView");
            clearTimeout(this._iAdminSearchTimer);
            oAdminModel.setProperty("/filters", oFilters);
            oAdminModel.setProperty("/searchInput", oFilters.search);
            this._applyAdminFilters();
        },

        _mergeAdminFilters: function (oChange) {
            var oFilters = this.getView().getModel("adminView").getProperty("/filters");
            this._setAdminFilters(Object.assign({}, oFilters, oChange));
        },

        onSearchUsersLive: function (oEvent) {
            var that = this;
            var sQuery = oEvent.getParameter("newValue");
            clearTimeout(this._iAdminSearchTimer);
            this._iAdminSearchTimer = setTimeout(function () {
                that._mergeAdminFilters({ search: sQuery });
            }, SEARCH_DEBOUNCE_MS);
        },

        onSearchUsers: function (oEvent) {
            this._mergeAdminFilters({ search: oEvent.getParameter("query") || "" });
        },

        onLockStatusFilterChange: function (oEvent) {
            this._mergeAdminFilters({ lockStatus: oEvent.getSource().getSelectedKey() });
        },

        onPwdStatusFilterChange: function (oEvent) {
            this._mergeAdminFilters({ pwdStatus: oEvent.getSource().getSelectedKey() });
        },

        onUserTypeFilterChange: function (oEvent) {
            this._mergeAdminFilters({ userTypes: oEvent.getSource().getSelectedKeys() });
        },

        onChangedByFilterChange: function (oEvent) {
            this._mergeAdminFilters({ changedBy: oEvent.getSource().getSelectedKeys() });
        },

        onChangedRangeFilterChange: function (oEvent) {
            var oRange = oEvent.getSource();
            var dFrom = oRange.getDateValue();
            var dTo = oRange.getSecondDateValue();
            this._mergeAdminFilters({
                changedFrom: dFrom ? UserListLogic.dayKey(dFrom) : "",
                changedTo: dTo ? UserListLogic.dayKey(dTo) : (dFrom ? UserListLogic.dayKey(dFrom) : "")
            });
        },

        onRemoveFilterChip: function (oEvent) {
            var oFilters = this.getView().getModel("adminView").getProperty("/filters");
            (oEvent.getParameter("tokens") || []).forEach(function (oToken) {
                oFilters = UserListLogic.removeChip(oFilters, oToken.getKey());
            });
            this._setAdminFilters(oFilters);
        }
    };
}

var oExports = {
    createAdminUserFilterSection: createAdminUserFilterSection
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
