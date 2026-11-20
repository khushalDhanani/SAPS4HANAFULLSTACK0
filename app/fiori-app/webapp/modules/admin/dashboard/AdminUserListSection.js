var ADMIN_STATE_KEY = "admin.userList.state";

function createAdminUserListSection(deps) {
    deps = deps || {};
    var UserListLogic = deps.UserListLogic;
    var ODataClient = deps.ODataClient;
    var MessageToast = deps.MessageToast;
    var Filter = deps.Filter;
    var Sorter = deps.Sorter;
    var SortOrder = deps.SortOrder || { Ascending: "Ascending", Descending: "Descending", None: "None" };
    var FileUtil = deps.FileUtil;

    return {
        _loadAdminUsers: function (bForce) {
            var oAdminModel = this.getView().getModel("adminView");
            if (!oAdminModel) {
                return Promise.resolve();
            }

            var that = this;
            var aCurrentUsers = oAdminModel.getProperty("/users") || [];

            if (!bForce && (!aCurrentUsers || aCurrentUsers.length === 0)) {
                try {
                    var sCached = sessionStorage.getItem("admin.userList.cache");
                    if (sCached) {
                        var oParsed = JSON.parse(sCached);
                        if (oParsed && Array.isArray(oParsed.users) && oParsed.users.length > 0) {
                            aCurrentUsers = oParsed.users;
                            oAdminModel.setProperty("/users", aCurrentUsers);
                            that._applyAdminSort();
                            that._applyAdminFilters();
                        }
                    }
                } catch (e) {
                    // sessionStorage unavailable or parse error; continue normal flow
                }
            }

            if (bForce || (!aCurrentUsers || aCurrentUsers.length === 0)) {
                oAdminModel.setProperty("/busy", true);
                oAdminModel.setProperty("/kpis", {});
            }

            var sUrl = "/odata/v4/user-management/listUsers(search='',maxRows=" + UserListLogic.LIST_LIMIT + ")";

            return ODataClient.get(sUrl)
                .then(function (res) {
                    var aUsers = (res && res.value) || [];
                    var mSelected = {};
                    (oAdminModel.getProperty("/users") || []).forEach(function (oUser) {
                        mSelected[oUser.username] = oUser.selected;
                    });
                    aUsers.forEach(function (oUser) {
                        oUser.selected = !!mSelected[oUser.username] && UserListLogic.isSelectable(oUser);
                    });
                    oAdminModel.setProperty("/users", aUsers);
                    oAdminModel.setProperty("/listLimitText", aUsers.length >= UserListLogic.LIST_LIMIT
                        ? that._text("adminListLimitReached", "Only the first {0} SAP users were loaded.", [String(UserListLogic.LIST_LIMIT)])
                        : "");
                    oAdminModel.setProperty("/noDataText", that._text("adminNoUsers", "No SAP users found."));
                    oAdminModel.setProperty("/busy", false);
                    that._bAdminUsersLoaded = true;
                    that._applyAdminSort();
                    that._applyAdminFilters();
                    try {
                        sessionStorage.setItem("admin.userList.cache", JSON.stringify({ users: aUsers, timestamp: Date.now() }));
                    } catch (e) {}
                })
                .catch(function (err) {
                    oAdminModel.setProperty("/users", []);
                    oAdminModel.setProperty("/userCount", 0);
                    oAdminModel.setProperty("/kpis", { total: null, active: null, locked: null, changedToday: null, changedLast7: null });
                    oAdminModel.setProperty("/noDataText", that._text("adminLoadFailed", "Failed to load SAP users."));
                    oAdminModel.setProperty("/busy", false);
                    try {
                        sessionStorage.removeItem("admin.userList.cache");
                    } catch (e) {}
                    var sMsg = (err && err.message) || that._text("adminLoadFailed", "Failed to load SAP users.");
                    MessageToast.show(sMsg);
                });
        },

        _readAdminState: function () {
            var oFilters = UserListLogic.emptyFilters();
            var oSort = null;
            try {
                var oSaved = JSON.parse(sessionStorage.getItem(ADMIN_STATE_KEY)) || {};
                Object.keys(oFilters).forEach(function (sKey) {
                    if (typeof oSaved.filters[sKey] === typeof oFilters[sKey] && Array.isArray(oSaved.filters[sKey]) === Array.isArray(oFilters[sKey])) {
                        oFilters[sKey] = oSaved.filters[sKey];
                    }
                });
                oSort = oSaved.sort && typeof oSaved.sort.property === "string" ? oSaved.sort : null;
            } catch (e) {}
            return { filters: oFilters, sort: oSort };
        },

        _saveAdminState: function (oFilters) {
            try {
                sessionStorage.setItem(ADMIN_STATE_KEY, JSON.stringify({ filters: oFilters, sort: this._oAdminSort }));
            } catch (e) {}
        },

        _adminToday: function () {
            return new Date();
        },

        _applyAdminFilters: function () {
            var oAdminModel = this.getView().getModel("adminView");
            var aUsers = oAdminModel.getProperty("/users") || [];
            var oFilters = oAdminModel.getProperty("/filters");
            var dToday = this._adminToday();
            var aVisible = UserListLogic.filterUsers(aUsers, oFilters);
            var mVisible = {};
            aVisible.forEach(function (oUser) {
                mVisible[oUser.username] = true;
            });

            aUsers.forEach(function (oUser) {
                if (!mVisible[oUser.username]) {
                    oUser.selected = false;
                }
            });
            this.byId("adminUsersTable").getBinding("items").filter(new Filter({
                path: "username",
                test: function (sUsername) {
                    return !!mVisible[sUsername];
                }
            }));

            var oSelected = {};
            ["total", "active", "locked", "changedToday", "changedLast7", "expiringSoon", "expired"].forEach(function (sKpi) {
                oSelected[sKpi] = String(UserListLogic.isKpiSelected(sKpi, oFilters, dToday));
            });
            var mChangedBy = {};
            aUsers.concat(oFilters.changedBy.map(function (sUser) {
                return { lastChangedBy: sUser };
            })).forEach(function (oUser) {
                if (oUser.lastChangedBy) {
                    mChangedBy[oUser.lastChangedBy] = true;
                }
            });

            oAdminModel.setProperty("/kpis", UserListLogic.computeKpis(aUsers, dToday));
            oAdminModel.setProperty("/kpiSelected", oSelected);
            oAdminModel.setProperty("/chips", this._chipsFor(oFilters));
            oAdminModel.setProperty("/changedByOptions", Object.keys(mChangedBy).sort().map(function (sUser) {
                return { key: sUser };
            }));
            oAdminModel.setProperty("/userCount", aVisible.length);
            oAdminModel.setProperty("/showingText", this._text("adminShowingOf", "Showing {0} of {1} users", [String(aVisible.length), String(aUsers.length)]));
            if (aUsers.length && !aVisible.length) {
                oAdminModel.setProperty("/noDataText", this._text("adminFilterNoMatch", "No users match your filters."));
            } else {
                oAdminModel.setProperty("/noDataText", this._text("adminNoUsers", "No SAP users found."));
            }
            this._syncAdminDateRange(oFilters);
            this._updateUserSelectionState(aUsers, aVisible);
            this._saveAdminState(oFilters);
        },

        _updateUserSelectionState: function (aUsers, aVisible) {
            var oAdminModel = this.getView().getModel("adminView");
            var oState = UserListLogic.selectionState(aUsers, aVisible);
            var iGrowingShown = this.byId("adminUsersTable").getItems ? this.byId("adminUsersTable").getItems().length : aVisible.length;
            oState.text = this._text("adminBulkSelected", "{0} selected", [String(oState.count)]);
            oState.hint = oState.all && oState.count > iGrowingShown
                ? this._text("adminBulkAllFilteredHint", "All {0} selectable filtered users, including rows not shown yet", [String(oState.count)])
                : "";
            oAdminModel.setProperty("/selection", oState);
            oAdminModel.refresh();
        },

        _applyAdminSort: function () {
            var oTable = this.byId("adminUsersTable");
            var oSort = this._oAdminSort;
            oTable.getColumns().forEach(function (oColumn) {
                var bSorted = !!oSort && oColumn.getHeader().data("sortProperty") === oSort.property;
                oColumn.setSortIndicator(bSorted ? (oSort.descending ? SortOrder.Descending : SortOrder.Ascending) : SortOrder.None);
            });
            oTable.getBinding("items").sort(oSort ? new Sorter(oSort.property, oSort.descending) : []);
        },

        _sortUsers: function (oEvent) {
            var sProperty = oEvent.getSource().data("sortProperty");
            var oCurrent = this._oAdminSort;
            this._oAdminSort = { property: sProperty, descending: !!oCurrent && oCurrent.property === sProperty && !oCurrent.descending };
            this._applyAdminSort();
            this._saveAdminState(this.getView().getModel("adminView").getProperty("/filters"));
        },

        _exportUsers: function () {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            var aRows = UserListLogic.sortUsers(
                UserListLogic.filterUsers(oAdminModel.getProperty("/users"), oAdminModel.getProperty("/filters")),
                this._oAdminSort
            );
            var fnLabel = function (sKey, sDefault) {
                return that._text(sKey, sDefault);
            };
            var sCsv = UserListLogic.toCsv(aRows, [
                { label: fnLabel("adminColUsername", "Username"), value: function (o) { return o.username; } },
                { label: fnLabel("adminColFullName", "Full Name"), value: function (o) { return o.fullName; } },
                { label: fnLabel("adminColLockStatus", "Lock Status"), value: function (o) { return that._lockStatusText(o); } },
                { label: fnLabel("adminColPwdStatus", "Password Status"), value: function (o) { return that.formatAdminPwdStatusText(o.pwdStatus, o.pwdDaysRemaining); } },
                { label: fnLabel("adminColUserType", "User Type"), value: function (o) { return o.userType; } },
                { label: fnLabel("adminColLastChanged", "Last Changed"), value: function (o) { return that.formatAdminDate(o.lastChanged); } },
                { label: fnLabel("adminDetailLastChangedBy", "Changed By"), value: function (o) { return o.lastChangedBy; } }
            ]);
            FileUtil.save(sCsv, "sap-users", "csv", "text/csv", "utf-8", true);
        },

        _visibleAdminUsers: function () {
            var oAdminModel = this.getView().getModel("adminView");
            return UserListLogic.filterUsers(oAdminModel.getProperty("/users"), oAdminModel.getProperty("/filters"));
        }
    };
}

var oExports = {
    createAdminUserListSection: createAdminUserListSection
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
