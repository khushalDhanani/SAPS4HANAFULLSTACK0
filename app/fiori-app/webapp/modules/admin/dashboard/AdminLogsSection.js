function createAdminLogsSection(deps) {
    deps = deps || {};
    var SapLogsLogic = deps.SapLogsLogic;

    return {
        _loadActiveSapLogsTab: function () {
            if (!this._oSapLogsModel || !SapLogsLogic) return;
            var sTab = this._oSapLogsModel.getProperty("/selectedTab");
            if (sTab === "sm21") {
                SapLogsLogic.loadSystemLogs(this._oSapLogsModel);
            } else {
                SapLogsLogic.loadSecurityAuditLogs(this._oSapLogsModel);
            }
        },

        onSapLogsTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            if (this._oSapLogsModel) {
                this._oSapLogsModel.setProperty("/selectedTab", sKey);
            }
            this._loadActiveSapLogsTab();
        },

        onRefreshSapLogs: function () {
            this._loadActiveSapLogsTab();
        },

        onSapLogsSm21PresetChange: function () {
            if (SapLogsLogic && this._oSapLogsModel) {
                SapLogsLogic.loadSystemLogs(this._oSapLogsModel);
            }
        },

        onSapLogsSm20PresetChange: function () {
            if (SapLogsLogic && this._oSapLogsModel) {
                SapLogsLogic.loadSecurityAuditLogs(this._oSapLogsModel);
            }
        },

        onSearchSapLogs: function (oEvent) {
            if (!this._oSapLogsModel || !SapLogsLogic) return;
            var sQuery = oEvent.getParameter("newValue");
            var sTab = this._oSapLogsModel.getProperty("/selectedTab");
            if (sTab === "sm21") {
                var aSm21 = this._oSapLogsModel.getProperty("/sm21/entries");
                this._oSapLogsModel.setProperty("/sm21/filteredEntries", SapLogsLogic.filterEntries(aSm21, sQuery));
            } else {
                var aSm20 = this._oSapLogsModel.getProperty("/sm20/entries");
                this._oSapLogsModel.setProperty("/sm20/filteredEntries", SapLogsLogic.filterEntries(aSm20, sQuery));
            }
        },

        onOpenSapLogsDetail: function (oEvent) {
            if (!this._oSapLogsModel) return;
            var oContext = oEvent.getSource().getBindingContext("sapLogsView");
            if (!oContext) return;
            var oEntry = oContext.getObject();
            this._oSapLogsModel.setProperty("/selectedEntry", oEntry);
            var oDialog = this.byId("sapLogsDetailDialog");
            if (oDialog) {
                oDialog.open();
            }
        },

        onCloseSapLogsDetailDialog: function () {
            var oDialog = this.byId("sapLogsDetailDialog");
            if (oDialog) {
                oDialog.close();
            }
        },

        formatSapLogsSeverityState: function (sEntryType, iSeverity) {
            return SapLogsLogic && typeof SapLogsLogic.formatSeverityState === "function" ? SapLogsLogic.formatSeverityState(sEntryType, iSeverity) : "None";
        },

        formatSapLogsSeverityIcon: function (sEntryType, iSeverity) {
            return SapLogsLogic && typeof SapLogsLogic.formatSeverityIcon === "function" ? SapLogsLogic.formatSeverityIcon(sEntryType, iSeverity) : "";
        },

        formatSapLogsUtc: function (sIso) {
            return SapLogsLogic && typeof SapLogsLogic.formatUtcTimestamp === "function" ? SapLogsLogic.formatUtcTimestamp(sIso) : "";
        },

        onNavigateToSapLogs: function () {
            this.getOwnerComponent().getRouter().navTo("dashboard", { section: "sap-logs" });
        }
    };
}

var oExports = {
    createAdminLogsSection: createAdminLogsSection
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
