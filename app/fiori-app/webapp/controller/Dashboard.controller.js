sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/Sorter",
    "sap/ui/core/library",
    "saps4hana/fiori/modules/admin/user-management/util/UserListLogic",
    "sap/ui/core/util/File",
    "sap/base/util/uid"
], function (
    BaseController,
    JSONModel,
    ODataClient,
    MessageToast,
    AuthService,
    MessageBox,
    Filter,
    Sorter,
    coreLibrary,
    UserListLogic,
    FileUtil,
    uid
) {
    "use strict";

    var SortOrder = coreLibrary.SortOrder;

    var ADMIN_STATE_KEY = "admin.userList.state";
    var UNDO_WINDOW_MS = 10000;
    var SEARCH_DEBOUNCE_MS = 300;
    var BULK_EMAIL_CHECK_MS = 15000;
    var LOCK_MONITOR_REFRESH_MS = 60000;
    var RESULT_LOOK = {
        success: { state: "Success", icon: "sap-icon://sys-enter-2", text: "adminBulkStatusSuccess" },
        warning: { state: "Warning", icon: "sap-icon://alert", text: "adminBulkStatusWarning" },
        error: { state: "Error", icon: "sap-icon://error", text: "adminBulkStatusError" },
        skipped: { state: "None", icon: "sap-icon://less", text: "adminBulkStatusSkipped" }
    };

    /**
     * Counts returned by PurchaseOrderService.getDashboardMetrics(). Each is read live from SAP S/4HANA.
     * In the view model a metric is:
     *   undefined  while it is loading,
     *   null       when SAP did not return it (the tile shows "Failed"),
     *   a number   when SAP returned it.
     * Nothing is ever defaulted to 0, sampled, extrapolated or simulated.
     */
    var METRIC_KEYS = [
        "totalCount",
        "supplierCount",
        "salesInquiryCount",
        "customerCount",
        "openSalesOrderCount",
        "totalSalesOrderCount",
        "warehouseCount",
        "openReservationCount",
        "inboundDeliveryCount",
        "ordersDueCount",
        "customerInvoiceCount",
        "customerReturnCount"
    ];

    // Sections reachable by URL (#/dashboard/<section>); anything else shows the overview
    var SECTIONS = ["mm", "sd", "ewm"];

    function toCount(vValue) {
        if (vValue === null || vValue === undefined || String(vValue).trim() === "") {
            return null;
        }
        var n = Number(vValue);
        return (isFinite(n) && Math.floor(n) === n && n >= 0) ? n : null;
    }

    return BaseController.extend("saps4hana.fiori.controller.Dashboard", {
        METRIC_KEYS: METRIC_KEYS,

        onInit: function () {
            var oSaved = this._readAdminState();
            this._oAdminSort = oSaved.sort;
            var oAdminModel = new JSONModel({
                users: [],
                userCount: 0,
                busy: false,
                filters: oSaved.filters,
                searchInput: oSaved.filters.search,
                kpis: {},
                kpiSelected: { total: "false", active: "false", locked: "false", changedToday: "false", changedLast7: "false" },
                chips: [],
                changedByOptions: [],
                showingText: "",
                listLimitText: "",
                selection: { count: 0, canLock: false, canUnlock: false, all: false, partial: false, text: "", hint: "" },
                bulk: { results: [], failed: 0, percent: 0, cancelling: false },
                undo: { text: "" },
                lockMonitor: { text: "", state: "None" },
                noDataText: this._text("adminNoUsers", "No SAP users found."),
                selectedUser: null,
                detailBusy: false,
                detailError: ""
            });
            this.getView().setModel(oAdminModel, "adminView");

            var oViewModel = new JSONModel({
                selectedTab: "overview",
                metricsError: ""
            });
            this.getView().setModel(oViewModel, "dashboardView");

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                // "default" (empty hash) shows this view too, so it must load the figures as well.
                ["dashboard", "default"].forEach(function (sRoute) {
                    var oRoute = oRouter.getRoute(sRoute);
                    if (oRoute) {
                        oRoute.attachPatternMatched(this._onDashboardMatched, this);
                    }
                }, this);
                oRouter.attachRouteMatched(this._onAnyRouteMatched, this);
            }
        },

        /**
         * Resolves an i18n text, falling back to the given default when no resource bundle is available.
         *
         * @private
         */
        _text: function (sKey, sDefault, aArgs) {
            try {
                var oComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey, aArgs);
                }
            } catch (e) {
                // fall through to the default text
            }
            var sText = sDefault;
            (aArgs || []).forEach(function (vArg, i) {
                sText = sText.replace("{" + i + "}", vArg);
            });
            return sText;
        },

        _onAnyRouteMatched: function (oEvent) {
            var sRoute = oEvent.getParameter("name");
            if (sRoute !== "dashboard" && sRoute !== "default") {
                this._bFiguresLoaded = false;
            }
        },

        _onDashboardMatched: function (oEvent) {
            var sSection = oEvent ? oEvent.getParameter("arguments").section : "";
            var bAllowed = sSection === "admin" ? AuthService.hasAnyRole(["Admin"]) : SECTIONS.indexOf(sSection) !== -1;
            this.getView().getModel("dashboardView").setProperty("/selectedTab", bAllowed ? sSection : "overview");
            if (sSection === "admin" && bAllowed && !this._bAdminUsersLoaded) {
                this._loadAdminUsers();
            }
            if (sSection === "admin" && bAllowed) {
                this._watchLockMonitor();
                var oQuery = oEvent.getParameter("arguments")["?query"];
                if (oQuery && oQuery.search) {
                    // A link from a lock alert: the list opens with that username searched.
                    this._mergeAdminFilters({ search: String(oQuery.search) });
                }
            }
            // A sidebar click only changes the section; the figures reload on arrival from another screen.
            if (this._bFiguresLoaded) {
                return;
            }
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
                // The session check (SSO / getUserInfo) may still be running when the route matches.
                // Load as soon as it authenticates; otherwise the tiles would stay in "Loading" forever.
                this._bLoadPending = true;
                if (!this._oAuthBinding && typeof oAuthModel.bindProperty === "function") {
                    this._oAuthBinding = oAuthModel.bindProperty("/isAuthenticated");
                    this._oAuthBinding.attachChange(this._onAuthChanged, this);
                }
                return;
            }
            this._loadDashboard();
        },

        _onAuthChanged: function () {
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (this._bLoadPending && oAuthModel && oAuthModel.getProperty("/isAuthenticated") === true) {
                this._loadDashboard();
            }
        },

        _loadDashboard: function () {
            this._bLoadPending = false;
            this._bFiguresLoaded = true;
            this._loadMetrics();
        },

        /**
         * Loads all dashboard counts from SAP in one call. A count SAP did not return stays null, and the
         * header status reports whether S/4HANA answered fully, partially or not at all.
         *
         * @returns {Promise<void>}
         */
        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("dashboardView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var that = this;
            METRIC_KEYS.forEach(function (sKey) {
                oViewModel.setProperty("/" + sKey, undefined);
            });
            oViewModel.setProperty("/metricsError", "");

            return ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
                .then(function (res) {
                    var oMetrics = res;
                    if (typeof oMetrics === "string") {
                        oMetrics = JSON.parse(oMetrics);
                    }
                    if (oMetrics && typeof oMetrics.value === "string") {
                        oMetrics = JSON.parse(oMetrics.value);
                    }
                    if (!oMetrics || typeof oMetrics !== "object") {
                        throw new Error(that._text("dashboardMetricsInvalid", "The metrics service returned no data."));
                    }

                    var iAvailable = 0;
                    METRIC_KEYS.forEach(function (sKey) {
                        var iCount = toCount(oMetrics[sKey]);
                        oViewModel.setProperty("/" + sKey, iCount);
                        if (iCount !== null) {
                            iAvailable++;
                        }
                    });
                    if (iAvailable === 0 && oMetrics.error) {
                        oViewModel.setProperty("/metricsError", oMetrics.error);
                    }
                })
                .catch(function (err) {
                    METRIC_KEYS.forEach(function (sKey) {
                        oViewModel.setProperty("/" + sKey, null);
                    });
                    oViewModel.setProperty("/metricsError", that._text(
                        "dashboardMetricsUnavailable",
                        "Live figures could not be loaded from SAP S/4HANA: {0}",
                        [(err && err.message) || String(err || "")]
                    ));
                });
        },

        /**
         * Tile value: the SAP count as text, or nothing while loading / unavailable.
         */
        formatMetricValue: function (vCount) {
            return (typeof vCount === "number") ? String(vCount) : "";
        },

        formatAdminDateTime: function (sDate, sTime) {
            var sFormatted = this.formatAdminDate(sDate);
            return sFormatted !== "-" && /^\d{6}$/.test(sTime || "")
                ? sFormatted + " " + sTime.slice(0, 2) + ":" + sTime.slice(2, 4) + ":" + sTime.slice(4, 6)
                : sFormatted;
        },

        formatAdminValidity: function (sFrom, sTo) {
            return this.formatAdminDate(sFrom) + " - " + this.formatAdminDate(sTo);
        },

        // The texts below are the DS4/220 dictionary values of domains XUUSTYP, XUDATFM, XUDCPFM and BAPIUSLOCK.
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

        /**
         * Tile state: Loading until the count arrives, Failed when SAP did not return it.
         */
        formatTileState: function (vCount) {
            if (vCount === undefined) {
                return "Loading";
            }
            return vCount === null ? "Failed" : "Loaded";
        },

        onNavigateToPurchaseOrders: function () {
            this.getOwnerComponent().getRouter().navTo("purchaseOrders");
        },

        onNavigateToCreatePO: function () {
            this.getOwnerComponent().getRouter().navTo("createPurchaseOrder");
        },


        onNavigateToSalesInquiries: function () {
            this.getOwnerComponent().getRouter().navTo("salesInquiries");
        },

        onNavigateToCreateSalesInquiry: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesInquiry");
        },

        onNavigateToSalesOrders: function () {
            this.getOwnerComponent().getRouter().navTo("salesOrders");
        },

        onNavigateToCreateSalesOrder: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesOrder");
        },

        onNavigateToGoodsReceipt: function () {
            this.getOwnerComponent().getRouter().navTo("wmGoodsReceipt");
        },


        onNavigateToHandlingUnits: function () {
            this.getOwnerComponent().getRouter().navTo("wmHandlingUnits");
        },

        onNavigateToPackingInstructions: function () {
            this.getOwnerComponent().getRouter().navTo("wmPackingInstructions");
        },

        onNavigateToQuarantineLabels: function () {
            this.getOwnerComponent().getRouter().navTo("wmQuarantineLabels");
        },

        onNavigateToHuStockTransfer: function () {
            this.getOwnerComponent().getRouter().navTo("wmHuStockTransfer");
        },

        onNavigateToOrdersDueForDelivery: function () {
            this.getOwnerComponent().getRouter().navTo("ordersDueForDelivery");
        },

        onNavigateToCustomerInvoices: function () {
            this.getOwnerComponent().getRouter().navTo("customerInvoices");
        },

        onNavigateToCustomerReturns: function () {
            this.getOwnerComponent().getRouter().navTo("customerReturns");
        },

        switchToTab: function (sKey) {
            this.getOwnerComponent().getRouter().navTo("dashboard", { section: sKey });
        },

        onSelectTabSD: function () { this.switchToTab("sd"); },
        onSelectTabEWM: function () { this.switchToTab("ewm"); },

        /**
         * Loads SAP users from UserManagementService.listUsers.
         *
         * @param {string} [sSearch]
         * @returns {Promise<void>}
         */
        _loadAdminUsers: function () {
            var oAdminModel = this.getView().getModel("adminView");
            if (!oAdminModel) {
                return Promise.resolve();
            }

            oAdminModel.setProperty("/busy", true);
            oAdminModel.setProperty("/kpis", {}); // a card shows Loading until its count arrives

            var sUrl = "/odata/v4/user-management/listUsers(search='',maxRows=" + UserListLogic.LIST_LIMIT + ")";
            var that = this;

            return ODataClient.get(sUrl)
                .then(function (res) {
                    var aUsers = (res && res.value) || [];
                    var mSelected = {};
                    (oAdminModel.getProperty("/users") || []).forEach(function (oUser) {
                        mSelected[oUser.username] = oUser.selected;
                    });
                    aUsers.forEach(function (oUser) {
                        // A user that became unselectable since the last load does not stay selected.
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
                })
                .catch(function (err) {
                    oAdminModel.setProperty("/users", []);
                    oAdminModel.setProperty("/userCount", 0);
                    oAdminModel.setProperty("/kpis", { total: null, active: null, locked: null, changedToday: null, changedLast7: null });
                    oAdminModel.setProperty("/noDataText", that._text("adminLoadFailed", "Failed to load SAP users."));
                    oAdminModel.setProperty("/busy", false);
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
            } catch (e) {
                // Storage blocked or no saved view: start with no filters.
            }
            return { filters: oFilters, sort: oSort };
        },

        _saveAdminState: function (oFilters) {
            try {
                sessionStorage.setItem(ADMIN_STATE_KEY, JSON.stringify({ filters: oFilters, sort: this._oAdminSort }));
            } catch (e) {
                // Storage blocked: the view just is not kept across a refresh.
            }
        },

        _adminToday: function () {
            return new Date();
        },

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

        /**
         * The one place the list view is derived from: rows, counts, cards, chips and selection all follow the filters.
         * Rows a filter hides are deselected, so a bulk action never reaches users that are not on screen.
         */
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
            ["total", "active", "locked", "changedToday", "changedLast7"].forEach(function (sKpi) {
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

        onKpiPress: function (oEvent) {
            var oFilters = this.getView().getModel("adminView").getProperty("/filters");
            this._setAdminFilters(UserListLogic.toggleKpi(oEvent.getSource().data("kpi"), oFilters, this._adminToday()));
        },

        onRemoveFilterChip: function (oEvent) {
            var oFilters = this.getView().getModel("adminView").getProperty("/filters");
            (oEvent.getParameter("tokens") || []).forEach(function (oToken) {
                oFilters = UserListLogic.removeChip(oFilters, oToken.getKey());
            });
            this._setAdminFilters(oFilters);
        },

        onClearAdminFilters: function () {
            this._setAdminFilters(UserListLogic.emptyFilters());
        },

        onRefreshUsers: function () {
            this._loadAdminUsers();
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

        onSortUsers: function (oEvent) {
            var sProperty = oEvent.getSource().data("sortProperty");
            var oCurrent = this._oAdminSort;
            this._oAdminSort = { property: sProperty, descending: !!oCurrent && oCurrent.property === sProperty && !oCurrent.descending };
            this._applyAdminSort();
            this._saveAdminState(this.getView().getModel("adminView").getProperty("/filters"));
        },

        onExportUsers: function () {
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
                { label: fnLabel("adminColUserType", "User Type"), value: function (o) { return o.userType; } },
                { label: fnLabel("adminColLastChanged", "Last Changed"), value: function (o) { return that.formatAdminDate(o.lastChanged); } },
                { label: fnLabel("adminDetailLastChangedBy", "Changed By"), value: function (o) { return o.lastChangedBy; } }
            ]);
            FileUtil.save(sCsv, "sap-users", "csv", "text/csv", "utf-8", true);
        },

        _lockStatusText: function (oUser) {
            if (!oUser.detailsAvailable) {
                return this._text("adminDetailsUnavailable", "Details unavailable");
            }
            return oUser.isLocked ? this._text("adminStatusLocked", "Locked") : this._text("adminStatusUnlocked", "Active");
        },

        formatAdminHighlight: function (sValue, sSearch) {
            return UserListLogic.highlight(sValue, sSearch);
        },

        formatAdminUsername: function (sValue, sSearch) {
            return "<strong>" + UserListLogic.highlight(sValue, sSearch) + "</strong>";
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

        _visibleAdminUsers: function () {
            var oAdminModel = this.getView().getModel("adminView");
            return UserListLogic.filterUsers(oAdminModel.getProperty("/users"), oAdminModel.getProperty("/filters"));
        },

        onUserSelectionChange: function () {
            this._updateUserSelectionState(this.getView().getModel("adminView").getProperty("/users"), this._visibleAdminUsers());
        },

        onSelectAllUsers: function (oEvent) {
            var bSelected = oEvent.getParameter("selected");
            var aVisible = this._visibleAdminUsers();
            aVisible.filter(UserListLogic.isSelectable).forEach(function (oUser) {
                oUser.selected = bSelected;
            });
            this._updateUserSelectionState(this.getView().getModel("adminView").getProperty("/users"), aVisible);
        },

        onClearUserSelection: function () {
            var aUsers = this.getView().getModel("adminView").getProperty("/users");
            aUsers.forEach(function (oUser) {
                oUser.selected = false;
            });
            this._updateUserSelectionState(aUsers, this._visibleAdminUsers());
        },

        onBulkLock: function () {
            this._openBulkConfirm("lock");
        },

        onBulkUnlock: function () {
            this._openBulkConfirm("unlock");
        },

        _openBulkConfirm: function (sAction) {
            var oAdminModel = this.getView().getModel("adminView");
            var oTargets = UserListLogic.bulkTargets(oAdminModel.getProperty("/users"), sAction);
            var aPreview = oTargets.run.slice(0, 10);
            var sPreview = aPreview.join(", ");
            var bLock = sAction === "lock";
            oAdminModel.setProperty("/bulk", Object.assign({}, oAdminModel.getProperty("/bulk"), {
                action: sAction,
                run: oTargets.run,
                skipped: oTargets.skipped,
                reason: "",
                confirmTitle: bLock ? this._text("adminBulkConfirmLockTitle", "Lock Users") : this._text("adminBulkConfirmUnlockTitle", "Unlock Users"),
                confirmButton: bLock ? this._text("adminBulkLockSelected", "Lock selected") : this._text("adminBulkUnlockSelected", "Unlock selected"),
                confirmText: this._text(bLock ? "adminBulkConfirmLockText" : "adminBulkConfirmUnlockText", bLock ? "Lock {0} SAP users?" : "Unlock {0} SAP users?", [String(oTargets.run.length)]),
                skippedText: oTargets.skipped.length ? this._text("adminBulkConfirmSkipped", "{0} already in that state will be skipped.", [String(oTargets.skipped.length)]) : "",
                preview: oTargets.run.length > aPreview.length
                    ? this._text("adminBulkPreviewMore", "{0} and {1} more", [sPreview, String(oTargets.run.length - aPreview.length)])
                    : sPreview
            }));
            this.byId("userBulkConfirmDialog").open();
        },

        onCancelBulkConfirm: function () {
            this.byId("userBulkConfirmDialog").close();
        },

        onConfirmBulk: function () {
            var oBulk = this.getView().getModel("adminView").getProperty("/bulk");
            this.byId("userBulkConfirmDialog").close();
            this._aBulkSucceeded = [];
            return this._runBulk(oBulk.action, oBulk.run, oBulk.skipped, oBulk.reason, false);
        },

        /** One user: the lock or unlock, then a read-back, because only SAP's own state proves the change. */
        _bulkWorker: function (sAction, sReason, sRunId, sUsername) {
            var that = this;
            var bExpectLocked = sAction === "lock";
            var sUrl = "/odata/v4/user-management/" + sAction + "User";
            var oBody = { username: sUsername, reason: sReason || "" };
            if (sRunId) {
                oBody.bulkRunId = sRunId;
            }
            return ODataClient.post(sUrl, oBody)
                .then(function (res) {
                    var oResult = {
                        username: sUsername,
                        status: (res && res.status) || "success",
                        messages: (res && res.messages && res.messages.length) ? res.messages : [{ type: "S", id: "", number: "", message: (res && res.message) || "" }]
                    };
                    var sDetailUrl = "/odata/v4/user-management/getUserDetail(username='" + encodeURIComponent(sUsername) + "')";
                    return ODataClient.get(sDetailUrl).then(function (detailRes) {
                        var oDetail = detailRes && detailRes.value ? detailRes.value : detailRes;
                        that._updateAdminUserListEntry(oDetail, true);
                        if (oDetail.isLocked !== bExpectLocked) {
                            oResult.status = "error";
                            oResult.messages = oResult.messages.concat({
                                type: "E",
                                id: "",
                                number: "",
                                message: that._text("adminActionStatusMismatch", "SAP did not confirm the requested lock status for user {0}.", [sUsername])
                            });
                        }
                        return oResult;
                    }, function () {
                        that._markAdminUserDetailsUnavailable(sUsername, true);
                        oResult.status = "warning";
                        oResult.messages = oResult.messages.concat({
                            type: "W",
                            id: "",
                            number: "",
                            message: that._text("adminBulkReadBackFailed", "SAP accepted the action, but its result could not be read back.")
                        });
                        return oResult;
                    });
                })
                .catch(function (err) {
                    return UserListLogic.errorToResult(sUsername, err);
                });
        },

        _runBulk: function (sAction, aRun, aSkipped, sReason, bIsUndo) {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            var oProgress = this.byId("userBulkProgressDialog");
            var bLock = sAction === "lock";
            // Groups the run's locks into one email; unlocks send none.
            var sRunId = bLock ? uid() : "";
            this._bBulkCancelled = false;
            this._clearUndo();
            oAdminModel.setProperty("/bulk", Object.assign({}, oAdminModel.getProperty("/bulk"), {
                action: sAction,
                reason: sReason,
                isUndo: bIsUndo,
                cancelling: false,
                percent: 0,
                progressTitle: bLock ? this._text("adminBulkProgressLockTitle", "Locking Users") : this._text("adminBulkProgressUnlockTitle", "Unlocking Users"),
                progressText: this._text("adminBulkProgressText", "{0} / {1} processed", ["0", String(aRun.length)])
            }));
            oProgress.setEscapeHandler(function (oEscape) {
                that.onCancelBulkRun();
                oEscape.reject();
            });
            oProgress.open();

            return UserListLogic.runWithConcurrency(aRun, UserListLogic.BULK_CONCURRENCY, this._bulkWorker.bind(this, sAction, sReason, sRunId), function () {
                return that._bBulkCancelled;
            }, function (iDone, iTotal) {
                oAdminModel.setProperty("/bulk/percent", Math.round((iDone / iTotal) * 100));
                oAdminModel.setProperty("/bulk/progressText", that._text("adminBulkProgressText", "{0} / {1} processed", [String(iDone), String(iTotal)]));
            }).then(function (aResults) {
                oProgress.close();
                that._showBulkResults(sAction, aRun.map(function (sUsername, i) {
                    return aResults[i] || {
                        username: sUsername,
                        status: "skipped",
                        notStarted: true,
                        messages: [{ type: "I", id: "", number: "", message: that._text("adminBulkSkippedCancelled", "Not processed: the run was cancelled.") }]
                    };
                }).concat(aSkipped.map(function (sUsername) {
                    return {
                        username: sUsername,
                        status: "skipped",
                        messages: [{ type: "I", id: "", number: "", message: that._text("adminBulkSkippedAlready", "Already in the target state.") }]
                    };
                })), bIsUndo);
                return that._trackBulkEmail(sRunId);
            });
        },

        /** The email comes from the lock monitor's next check, so the open result dialog follows it until it is sent. */
        _trackBulkEmail: function (sRunId) {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            var fnShow = function (sTextKey, sDefault, sState) {
                oAdminModel.setProperty("/bulk/notifyText", sTextKey ? that._text(sTextKey, sDefault) : "");
                oAdminModel.setProperty("/bulk/notifyState", sState || "None");
            };
            clearTimeout(this._iBulkEmailTimer);
            var bAnyLocked = (oAdminModel.getProperty("/bulk/results") || []).some(function (oResult) {
                return oResult.status === "success" || oResult.status === "warning";
            });
            if (!sRunId || !bAnyLocked) {
                fnShow("");
                return Promise.resolve();
            }
            fnShow("adminBulkNotifyQueued", "Queued", "Information");
            var fnCheck = function () {
                return ODataClient.get("/odata/v4/user-management/getBulkLockEmailStatus(bulkRunId='" + encodeURIComponent(sRunId) + "')")
                    .then(function (res) {
                        var sStatus = res && res.status;
                        if (sStatus === "sent") {
                            fnShow("adminBulkNotifySent", "Sent", "Success");
                        } else if (sStatus === "not_configured") {
                            fnShow("adminBulkNotifyNotConfigured", "Not configured", "Warning");
                        } else {
                            if (sStatus === "retrying") {
                                fnShow("adminBulkNotifyRetrying", "Sending failed, will retry on the next check", "Warning");
                            }
                            that._iBulkEmailTimer = setTimeout(fnCheck, BULK_EMAIL_CHECK_MS);
                        }
                    })
                    .catch(function () {
                        // Only this display failed: the email does not depend on it. Queued stays shown.
                    });
            };
            return fnCheck();
        },

        _lockMonitorView: function (oStatus) {
            var fnTime = function (sIso) {
                return sIso ? new Date(sIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "-";
            };
            var sTime = fnTime(oStatus.lastCheckedAt);
            var mLook = {
                ok: this._text("adminLockMonitorActive", "Lock monitor: Active \u00b7 Last checked {0}", [sTime]),
                starting: this._text("adminLockMonitorStarting", "Lock monitor: Active \u00b7 First check pending"),
                failed: oStatus.errorMessage
                    ? this._text("adminLockMonitorFailedWithError", "Lock monitor: Last check failed \u00b7 {0} \u00b7 {1}", [sTime, oStatus.errorMessage])
                    : this._text("adminLockMonitorFailed", "Lock monitor: Last check failed \u00b7 {0}", [sTime]),
                stale: this._text("adminLockMonitorStale", "Lock monitor: Not checking \u00b7 Last checked {0}", [sTime]),
                off: this._text("adminLockMonitorOff", "Lock monitor: Off (email not configured)")
            };
            var mState = { ok: "Success", starting: "Success", failed: "Error", stale: "Error", off: "None" };
            return {
                text: mLook[oStatus.state] || this._text("adminLockMonitorUnknown", "Lock monitor: Status not available"),
                state: mState[oStatus.state] || "Error",
                recipient: oStatus.recipient,
                intervalText: this._text("adminNotifyIntervalValue", "{0} seconds", [String(oStatus.pollIntervalSec)]),
                maxPerEmail: oStatus.maxPerEmail,
                pendingEmails: oStatus.pendingEmails
            };
        },

        _refreshLockMonitor: function () {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            return ODataClient.get("/odata/v4/user-management/getLockMonitor()")
                .then(function (res) {
                    oAdminModel.setProperty("/lockMonitor", that._lockMonitorView(res || {}));
                })
                .catch(function () {
                    oAdminModel.setProperty("/lockMonitor", that._lockMonitorView({}));
                });
        },

        _watchLockMonitor: function () {
            var that = this;
            this._refreshLockMonitor();
            clearInterval(this._iLockMonitorTimer);
            this._iLockMonitorTimer = setInterval(function () {
                if (that.getView().getModel("dashboardView").getProperty("/selectedTab") === "admin") {
                    that._refreshLockMonitor();
                }
            }, LOCK_MONITOR_REFRESH_MS);
        },

        onOpenNotifySettings: function (oEvent) {
            this.byId("adminNotifySettings").openBy(oEvent.getSource());
        },

        onCancelBulkRun: function () {
            this._bBulkCancelled = true;
            this.getView().getModel("adminView").setProperty("/bulk/cancelling", true);
        },

        _showBulkResults: function (sAction, aResults, bIsUndo) {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            var oSum = UserListLogic.aggregateResults(aResults);
            var mStaySelected = {};
            aResults.forEach(function (oResult) {
                mStaySelected[oResult.username] = oResult.status === "error" || !!oResult.notStarted;
            });
            aResults = aResults.map(function (oResult) {
                var oLook = RESULT_LOOK[oResult.status];
                return Object.assign({}, oResult, {
                    state: oLook.state,
                    icon: oLook.icon,
                    statusText: that._text(oLook.text, oResult.status),
                    message: oResult.messages.map(function (m) {
                        return m.message;
                    }).join(" "),
                    technical: oResult.messages.filter(function (m) {
                        return m.id;
                    }).map(function (m) {
                        return m.type + " " + m.id + "/" + m.number + ": " + m.message;
                    }).join("\n")
                });
            });
            (oAdminModel.getProperty("/users") || []).forEach(function (oUser) {
                if (mStaySelected[oUser.username] !== undefined) {
                    oUser.selected = mStaySelected[oUser.username] && UserListLogic.isSelectable(oUser);
                }
            });
            this._aBulkSucceeded = (this._aBulkSucceeded || []).concat(UserListLogic.usernamesWithStatus(aResults, ["success", "warning"]));
            oAdminModel.setProperty("/bulk", Object.assign({}, oAdminModel.getProperty("/bulk"), {
                results: aResults,
                failed: oSum.failed,
                resultTitle: this._text("adminBulkResultTitle", "Result"),
                summary: this._text("adminBulkSummary", "{0} succeeded · {1} failed · {2} skipped", [String(oSum.succeeded), String(oSum.failed), String(oSum.skipped)])
            }));
            this._applyAdminFilters();
            if (this._aBulkSucceeded.length && !bIsUndo) {
                this._offerUndo(sAction, this._aBulkSucceeded);
            }
            this.byId("userBulkResultDialog").open();
        },

        onRetryFailedBulk: function () {
            clearTimeout(this._iBulkEmailTimer);
            var oBulk = this.getView().getModel("adminView").getProperty("/bulk");
            this.byId("userBulkResultDialog").close();
            return this._runBulk(oBulk.action, UserListLogic.usernamesWithStatus(oBulk.results, ["error"]), [], oBulk.reason, oBulk.isUndo);
        },

        onDownloadBulkResults: function () {
            var that = this;
            var aResults = this.getView().getModel("adminView").getProperty("/bulk/results");
            var sCsv = UserListLogic.toCsv(aResults, [
                { label: this._text("adminColUsername", "Username"), value: function (o) { return o.username; } },
                { label: this._text("adminBulkColStatus", "Status"), value: function (o) { return that._text(RESULT_LOOK[o.status].text, o.status); } },
                { label: this._text("adminBulkColMessage", "Message"), value: function (o) { return o.message; } },
                { label: this._text("adminBulkDetails", "Details"), value: function (o) { return o.technical; } }
            ]);
            FileUtil.save(sCsv, "user-lock-results", "csv", "text/csv", "utf-8", true);
        },

        onCloseBulkResults: function () {
            clearTimeout(this._iBulkEmailTimer);
            this.byId("userBulkResultDialog").close();
        },

        _offerUndo: function (sAction, aUsernames) {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            this._clearUndo();
            this._oUndo = { action: sAction === "lock" ? "unlock" : "lock", usernames: aUsernames };
            oAdminModel.setProperty("/undo/text", sAction === "lock"
                ? this._text("adminBulkUndoLocked", "{0} users locked.", [String(aUsernames.length)])
                : this._text("adminBulkUndoUnlocked", "{0} users unlocked.", [String(aUsernames.length)]));
            this._iUndoTimer = setTimeout(function () {
                that._clearUndo();
            }, UNDO_WINDOW_MS);
        },

        _clearUndo: function () {
            clearTimeout(this._iUndoTimer);
            this._oUndo = null;
            this.getView().getModel("adminView").setProperty("/undo/text", "");
        },

        onUndoBulk: function () {
            var oUndo = this._oUndo;
            if (!oUndo) {
                return Promise.resolve();
            }
            this._aBulkSucceeded = [];
            return this._runBulk(oUndo.action, oUndo.usernames, [], this._text("adminBulkUndoReason", "Undo of a bulk action"), true);
        },

        onSelectUser: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("adminView");
            var sUsername = oContext ? oContext.getProperty("username") : null;
            if (!sUsername) {
                return undefined;
            }

            var oAdminModel = this.getView().getModel("adminView");
            var that = this;
            var fnIsShown = function () {
                return (oAdminModel.getProperty("/selectedUser") || {}).username === sUsername;
            };

            // Replaced at once, so a failed read never leaves the previous user's data on screen.
            oAdminModel.setProperty("/selectedUser", { username: sUsername });
            oAdminModel.setProperty("/detailError", "");
            oAdminModel.setProperty("/detailBusy", true);

            var sUrl = "/odata/v4/user-management/getUserDetail(username='" + encodeURIComponent(sUsername) + "')";
            return ODataClient.get(sUrl)
                .then(function (res) {
                    var oDetail = res && res.value ? res.value : res;
                    that._updateAdminUserListEntry(oDetail);
                    // A slower answer for a user no longer selected must not replace the pane.
                    if (fnIsShown()) {
                        oAdminModel.setProperty("/selectedUser", oDetail);
                        oAdminModel.setProperty("/detailBusy", false);
                    }
                })
                .catch(function (err) {
                    that._markAdminUserDetailsUnavailable(sUsername);
                    if (fnIsShown()) {
                        oAdminModel.setProperty("/detailError", (err && err.message) || that._text("adminDetailLoadFailed", "Failed to load user detail from SAP."));
                        oAdminModel.setProperty("/detailBusy", false);
                    }
                });
        },

        onCloseUserDetail: function () {
            var oAdminModel = this.getView().getModel("adminView");
            oAdminModel.setProperty("/selectedUser", null);
            oAdminModel.setProperty("/detailError", "");
            oAdminModel.setProperty("/detailBusy", false);
        },

        _getAdminActionUsername: function (oEvent) {
            var oSource = oEvent && oEvent.getSource ? oEvent.getSource() : null;
            var oContext = oSource && oSource.getBindingContext ? oSource.getBindingContext("adminView") : null;
            if (oContext) {
                return oContext.getProperty("username");
            }
            var oAdminModel = this.getView().getModel("adminView");
            var oUser = oAdminModel ? oAdminModel.getProperty("/selectedUser") : null;
            return oUser ? oUser.username : null;
        },

        onLockUser: function (oEvent) {
            var sUsername = this._getAdminActionUsername(oEvent);
            if (!sUsername) {
                return;
            }

            var that = this;
            var sMsg = this._text("adminConfirmLockMsg", "Are you sure you want to lock SAP user {0}?", [sUsername]);
            var sTitle = this._text("adminConfirmLockTitle", "Lock SAP User");

            MessageBox.confirm(sMsg, {
                title: sTitle,
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._executeUserAction("/odata/v4/user-management/lockUser", sUsername, true);
                    }
                }
            });
        },

        onUnlockUser: function (oEvent) {
            var sUsername = this._getAdminActionUsername(oEvent);
            if (!sUsername) {
                return;
            }

            var that = this;
            var sMsg = this._text("adminConfirmUnlockMsg", "Are you sure you want to unlock SAP user {0}?", [sUsername]);
            var sTitle = this._text("adminConfirmUnlockTitle", "Unlock SAP User");

            MessageBox.confirm(sMsg, {
                title: sTitle,
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._executeUserAction("/odata/v4/user-management/unlockUser", sUsername, false);
                    }
                }
            });
        },

        _updateAdminUserListEntry: function (oDetail, bDeferView) {
            var oAdminModel = this.getView().getModel("adminView");
            var aUsers = oAdminModel ? oAdminModel.getProperty("/users") || [] : [];
            var sUsername = oDetail && oDetail.username;
            for (var i = 0; i < aUsers.length; i++) {
                if (aUsers[i].username === sUsername) {
                    oAdminModel.setProperty("/users/" + i, Object.assign({}, aUsers[i], {
                        detailsAvailable: true,
                        isLocked: oDetail.isLocked,
                        userType: oDetail.userType,
                        validFrom: oDetail.validFrom,
                        validTo: oDetail.validTo,
                        lastChanged: oDetail.lastChanged,
                        lastChangedBy: oDetail.lastChangedBy
                    }));
                    if (!bDeferView) {
                        this._applyAdminFilters();
                    }
                    return;
                }
            }
        },

        _markAdminUserDetailsUnavailable: function (sUsername, bDeferView) {
            var oAdminModel = this.getView().getModel("adminView");
            var aUsers = oAdminModel ? oAdminModel.getProperty("/users") || [] : [];
            for (var i = 0; i < aUsers.length; i++) {
                if (aUsers[i].username === sUsername) {
                    oAdminModel.setProperty("/users/" + i, Object.assign({}, aUsers[i], {
                        detailsAvailable: false,
                        isLocked: null,
                        userType: null,
                        validFrom: null,
                        validTo: null,
                        lastChanged: null,
                        lastChangedBy: null,
                        selected: false
                    }));
                    if (!bDeferView) {
                        this._applyAdminFilters();
                    }
                    return;
                }
            }
        },

        _executeUserAction: function (sUrl, sUsername, bExpectedLocked) {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            var bActionAccepted = false;
            var bDetailReceived = false;
            var fnIsShown = function () {
                return (oAdminModel.getProperty("/selectedUser") || {}).username === sUsername;
            };

            oAdminModel.setProperty("/detailBusy", fnIsShown());

            return ODataClient.post(sUrl, { username: sUsername })
                .then(function (res) {
                    bActionAccepted = true;
                    var sDetailUrl = "/odata/v4/user-management/getUserDetail(username='" + encodeURIComponent(sUsername) + "')";
                    return ODataClient.get(sDetailUrl)
                        .then(function (detailRes) {
                            var oDetail = detailRes && detailRes.value ? detailRes.value : detailRes;
                            if (!oDetail || typeof oDetail.isLocked !== "boolean") {
                                throw new Error(that._text("adminDetailLoadFailed", "Failed to load user detail from SAP."));
                            }
                            bDetailReceived = true;
                            // A row action on another user leaves the open pane alone.
                            if (fnIsShown()) {
                                oAdminModel.setProperty("/selectedUser", oDetail);
                            }
                            that._updateAdminUserListEntry(oDetail);
                            if (oDetail.isLocked !== bExpectedLocked) {
                                throw new Error(that._text(
                                    "adminActionStatusMismatch",
                                    "SAP did not confirm the requested lock status for user {0}. The current SAP status is shown in the list.",
                                    [sUsername]
                                ));
                            }
                            var sSuccess = (res && res.message) || that._text("adminActionSuccess", "Action completed successfully in SAP.");
                            MessageToast.show(sSuccess);
                        });
                })
                .catch(function (err) {
                    if (bActionAccepted && !bDetailReceived) {
                        that._markAdminUserDetailsUnavailable(sUsername);
                        // The lock state is now unknown, so the pane must not show the old one or offer an action.
                        if (fnIsShown()) {
                            oAdminModel.setProperty("/selectedUser", { username: sUsername });
                            oAdminModel.setProperty("/detailError", (err && err.message) || that._text("adminDetailLoadFailed", "Failed to load user detail from SAP."));
                        }
                    }
                    var sError = (err && err.message) || that._text("adminActionFailed", "SAP user action failed.");
                    MessageBox.error(sError);
                })
                .finally(function () {
                    oAdminModel.setProperty("/detailBusy", false);
                });
        },

        onExit: function () {
            clearTimeout(this._iAdminSearchTimer);
            clearTimeout(this._iUndoTimer);
            clearTimeout(this._iBulkEmailTimer);
            clearInterval(this._iLockMonitorTimer);
            if (this._oAuthBinding) {
                this._oAuthBinding.detachChange(this._onAuthChanged, this);
                this._oAuthBinding = null;
            }
        }
    });
});
