var BULK_EMAIL_CHECK_MS = 15000;
var LOCK_MONITOR_REFRESH_MS = 60000;

function createAdminLockMonitorSection(deps) {
    deps = deps || {};
    var ODataClient = deps.ODataClient;

    return {
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
                    .catch(function () {});
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
                off: this._text("adminLockMonitorOff", "Lock monitor: Off")
            };
            var sText = mLook[oStatus.state];
            if (sText && oStatus.state !== "off" && oStatus.emailEnabled === false) {
                sText += this._text("adminLockMonitorEmailOff", " \u00b7 Email off (not configured)");
            }
            var mState = { ok: "Success", starting: "Success", failed: "Error", stale: "Error", off: "None" };
            return {
                text: sText || this._text("adminLockMonitorUnknown", "Lock monitor: Status not available"),
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
                if (that.getView().getModel("dashboardView").getProperty("/selectedTab") === "user-master") {
                    that._refreshLockMonitor();
                }
            }, LOCK_MONITOR_REFRESH_MS);
        },

        _openNotifySettings: function (oEvent) {
            this.byId("adminNotifySettings").openBy(oEvent.getSource());
        }
    };
}

var oExports = {
    createAdminLockMonitorSection: createAdminLockMonitorSection
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
