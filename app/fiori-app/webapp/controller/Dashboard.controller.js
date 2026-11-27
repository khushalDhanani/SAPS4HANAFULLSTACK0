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
    "sap/base/util/uid",
    "saps4hana/fiori/modules/admin/sap-logs/util/SapLogsLogic",
    "saps4hana/fiori/modules/admin/dashboard/AdminLogsSection",
    "saps4hana/fiori/modules/admin/dashboard/AdminUserFormatters",
    "saps4hana/fiori/modules/admin/dashboard/AdminUserListSection",
    "saps4hana/fiori/modules/admin/dashboard/AdminUserFilterSection",
    "saps4hana/fiori/modules/admin/dashboard/AdminUserBulkSection",
    "saps4hana/fiori/modules/admin/dashboard/AdminLockMonitorSection",
    "saps4hana/fiori/modules/admin/dashboard/AdminUserDetailSection",
    "saps4hana/fiori/modules/admin/dashboard/DashboardMetricsSection"
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
    uid,
    SapLogsLogic,
    _AdminLogsSection,
    _AdminUserFormatters,
    _AdminUserListSection,
    _AdminUserFilterSection,
    _AdminUserBulkSection,
    _AdminLockMonitorSection,
    _AdminUserDetailSection,
    _DashboardMetricsSection
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) { return mod || (isNode ? require(path) : {}); }
    var AdminLogsSection = req(_AdminLogsSection, "../modules/admin/dashboard/AdminLogsSection");
    var AdminUserFormatters = req(_AdminUserFormatters, "../modules/admin/dashboard/AdminUserFormatters");
    var AdminUserListSection = req(_AdminUserListSection, "../modules/admin/dashboard/AdminUserListSection");
    var AdminUserFilterSection = req(_AdminUserFilterSection, "../modules/admin/dashboard/AdminUserFilterSection");
    var AdminUserBulkSection = req(_AdminUserBulkSection, "../modules/admin/dashboard/AdminUserBulkSection");
    var AdminLockMonitorSection = req(_AdminLockMonitorSection, "../modules/admin/dashboard/AdminLockMonitorSection");
    var AdminUserDetailSection = req(_AdminUserDetailSection, "../modules/admin/dashboard/AdminUserDetailSection");
    var DashboardMetricsSection = req(_DashboardMetricsSection, "../modules/admin/dashboard/DashboardMetricsSection");

    var SortOrder = coreLibrary.SortOrder;

    var METRIC_KEYS = [
        "totalCount",
        "supplierCount",
        "salesInquiryCount",
        "customerCount",
        "openSalesOrderCount",
        "totalSalesOrderCount",
        "warehouseCount",
        "openReservationCount",
        "ordersDueCount",
        "customerInvoiceCount",
        "customerReturnCount"
    ];

    var SECTIONS = ["mm", "sd", "ewm", "pm"];

    var DashboardController = BaseController.extend("saps4hana.fiori.controller.Dashboard", {
        METRIC_KEYS: METRIC_KEYS,

        onInit: function () {
            var oSaved = this._readAdminState();
            this._oAdminSort = oSaved.sort;
            this.getView().setModel(new JSONModel({
                users: [], userCount: 0, busy: false, filters: oSaved.filters, searchInput: oSaved.filters.search,
                kpis: {}, kpiSelected: { total: "false", active: "false", locked: "false", changedToday: "false", changedLast7: "false", expiringSoon: "false", expired: "false" },
                chips: [], changedByOptions: [], showingText: "", listLimitText: "",
                selection: { count: 0, canLock: false, canUnlock: false, all: false, partial: false, text: "", hint: "" },
                bulk: { results: [], failed: 0, percent: 0, cancelling: false }, undo: { text: "" },
                lockMonitor: { text: "", state: "None" }, noDataText: this._text("adminNoUsers", "No SAP users found."),
                selectedUser: null, detailBusy: false, detailError: ""
            }), "adminView");
            this.getView().setModel(new JSONModel({ selectedTab: "overview", metricsError: "" }), "dashboardView");

            if (SapLogsLogic && typeof SapLogsLogic.createModel === "function") {
                this._oSapLogsModel = SapLogsLogic.createModel();
                this.getView().setModel(this._oSapLogsModel, "sapLogsView");
            }
            this._bSapLogsLoaded = false;

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                ["dashboard", "default"].forEach(function (sRoute) {
                    var oRoute = oRouter.getRoute(sRoute);
                    if (oRoute) {
                        oRoute.attachPatternMatched(this._onDashboardMatched, this);
                    }
                }, this);
                oRouter.attachRouteMatched(this._onAnyRouteMatched, this);
            }
        },

        _text: function (sKey, sDefault, aArgs) {
            try {
                var oComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey, aArgs);
                }
            } catch (e) {}
            var sText = sDefault;
            (aArgs || []).forEach(function (vArg, i) { sText = sText.replace("{" + i + "}", vArg); });
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
            var bAllowed = sSection === "user-master" ? AuthService.hasAnyRole(["Admin"]) :
                sSection === "sap-logs" ? AuthService.hasAnyRole(["Admin", "SapLogsReader"]) :
                SECTIONS.indexOf(sSection) !== -1;
            this.getView().getModel("dashboardView").setProperty("/selectedTab", bAllowed ? sSection : "overview");
            if (sSection === "user-master" && bAllowed && !this._bAdminUsersLoaded) {
                this._loadAdminUsers();
            }
            if (sSection === "sap-logs" && bAllowed && !this._bSapLogsLoaded) {
                this._bSapLogsLoaded = true;
                this._loadActiveSapLogsTab();
            }
            if (sSection === "user-master" && bAllowed) {
                this._watchLockMonitor();
                var oQuery = oEvent.getParameter("arguments")["?query"];
                if (oQuery && oQuery.search) {
                    this._mergeAdminFilters({ search: String(oQuery.search) });
                }
                if (oQuery && oQuery.filter) {
                    var sFilter = String(oQuery.filter);
                    if (sFilter === "expiring" || sFilter === "expiring_soon") {
                        this._mergeAdminFilters({ pwdStatus: "expiring_soon" });
                    } else if (sFilter === "expired") {
                        this._mergeAdminFilters({ pwdStatus: "expired" });
                    }
                }
                if (oQuery && oQuery.action === "unlock" && oQuery.search) {
                    this._confirmUnlockUser(String(oQuery.search).trim().toUpperCase());
                }
                return;
            }
            if (this._bFiguresLoaded) {
                return;
            }
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
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

        formatMetricValue: function (vCount) {
            return (typeof vCount === "number") ? String(vCount) : "";
        },

        formatTileState: function (vCount) {
            if (vCount === undefined) { return "Loading"; }
            return vCount === null ? "Failed" : "Loaded";
        },

        onNavigateToPurchaseOrders: function () { this.getOwnerComponent().getRouter().navTo("purchaseOrders"); },
        onNavigateToCreatePO: function () { this.getOwnerComponent().getRouter().navTo("createPurchaseOrder"); },
        onNavigateToSalesInquiries: function () { this.getOwnerComponent().getRouter().navTo("salesInquiries"); },
        onNavigateToCreateSalesInquiry: function () { this.getOwnerComponent().getRouter().navTo("createSalesInquiry"); },
        onNavigateToSalesOrders: function () { this.getOwnerComponent().getRouter().navTo("salesOrders"); },
        onNavigateToCreateSalesOrder: function () { this.getOwnerComponent().getRouter().navTo("createSalesOrder"); },
        onNavigateToHandlingUnits: function () { this.getOwnerComponent().getRouter().navTo("wmHandlingUnits"); },
        onNavigateToPackingInstructions: function () { this.getOwnerComponent().getRouter().navTo("wmPackingInstructions"); },
        onNavigateToQuarantineLabels: function () { this.getOwnerComponent().getRouter().navTo("wmQuarantineLabels"); },
        onNavigateToMibLabel: function () { this.getOwnerComponent().getRouter().navTo("wmMibLabel"); },
        onNavigateToOrdersDueForDelivery: function () { this.getOwnerComponent().getRouter().navTo("ordersDueForDelivery"); },
        onNavigateToCustomerInvoices: function () { this.getOwnerComponent().getRouter().navTo("customerInvoices"); },
        onNavigateToCustomerReturns: function () { this.getOwnerComponent().getRouter().navTo("customerReturns"); },

        switchToTab: function (sKey) {
            this.getOwnerComponent().getRouter().navTo("dashboard", { section: sKey });
        },

        onSelectTabSD: function () { this.switchToTab("sd"); },
        onSelectTabEWM: function () { this.switchToTab("ewm"); },
        onOpenNotifySettings: function (oEvent) { return this._openNotifySettings(oEvent); },
        onKpiPress: function (oEvent) {
            var oFilters = this.getView().getModel("adminView").getProperty("/filters");
            this._setAdminFilters(UserListLogic.toggleKpi(oEvent.getSource().data("kpi"), oFilters, this._adminToday()));
        },
        onUndoBulk: function () { return this._undoBulk(); },
        onClearAdminFilters: function () { this._setAdminFilters(UserListLogic.emptyFilters()); },
        onExportUsers: function () { return this._exportUsers(); },
        onRefreshUsers: function () { return this._loadAdminUsers(true); },
        onBulkLock: function () { return this._openBulkConfirm("lock"); },
        onBulkUnlock: function () { return this._openBulkConfirm("unlock"); },
        onClearUserSelection: function () {
            var aUsers = this.getView().getModel("adminView").getProperty("/users") || [];
            aUsers.forEach(function (oUser) { oUser.selected = false; });
            this._updateUserSelectionState(aUsers, this._visibleAdminUsers());
            this.getView().getModel("adminView").refresh();
        },
        onSelectAllUsers: function (oEvent) {
            var bSelected = oEvent.getParameter("selected");
            var aVisible = this._visibleAdminUsers();
            aVisible.filter(UserListLogic.isSelectable).forEach(function (oUser) { oUser.selected = bSelected; });
            this._updateUserSelectionState(this.getView().getModel("adminView").getProperty("/users") || [], aVisible);
            this.getView().getModel("adminView").refresh();
        },
        onSortUsers: function (oEvent) { return this._sortUsers(oEvent); },
        onSelectUser: function (oEvent) { return this._selectUser(oEvent); },
        onUserSelectionChange: function () {
            this._updateUserSelectionState(this.getView().getModel("adminView").getProperty("/users") || [], this._visibleAdminUsers());
        },
        onLockUser: function (oEvent) { return this._lockUser(oEvent); },
        onUnlockUser: function (oEvent) { return this._unlockUser(oEvent); },

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

    var mLogs = AdminLogsSection.createAdminLogsSection ? AdminLogsSection.createAdminLogsSection({ SapLogsLogic: SapLogsLogic }) : {};
    var mFormatters = AdminUserFormatters.createAdminUserFormatters ? AdminUserFormatters.createAdminUserFormatters({ UserListLogic: UserListLogic }) : {};
    var mList = AdminUserListSection.createAdminUserListSection ? AdminUserListSection.createAdminUserListSection({ UserListLogic: UserListLogic, ODataClient: ODataClient, MessageToast: MessageToast, Filter: Filter, Sorter: Sorter, SortOrder: SortOrder, FileUtil: FileUtil }) : {};
    var mFilter = AdminUserFilterSection.createAdminUserFilterSection ? AdminUserFilterSection.createAdminUserFilterSection({ UserListLogic: UserListLogic }) : {};
    var mBulk = AdminUserBulkSection.createAdminUserBulkSection ? AdminUserBulkSection.createAdminUserBulkSection({ UserListLogic: UserListLogic, ODataClient: ODataClient, FileUtil: FileUtil, uid: uid }) : {};
    var mLockMonitor = AdminLockMonitorSection.createAdminLockMonitorSection ? AdminLockMonitorSection.createAdminLockMonitorSection({ ODataClient: ODataClient }) : {};
    var mDetail = AdminUserDetailSection.createAdminUserDetailSection ? AdminUserDetailSection.createAdminUserDetailSection({ ODataClient: ODataClient, MessageToast: MessageToast, MessageBox: MessageBox }) : {};
    var mMetrics = DashboardMetricsSection.createDashboardMetricsSection ? DashboardMetricsSection.createDashboardMetricsSection({ ODataClient: ODataClient, METRIC_KEYS: METRIC_KEYS }) : {};

    Object.assign(DashboardController.prototype, mLogs, mFormatters, mList, mFilter, mBulk, mLockMonitor, mDetail, mMetrics);

    return DashboardController;
});
