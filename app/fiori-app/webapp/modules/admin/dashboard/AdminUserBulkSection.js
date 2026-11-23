var UNDO_WINDOW_MS = 10000;
var RESULT_LOOK = {
    success: { state: "Success", icon: "sap-icon://sys-enter-2", text: "adminBulkStatusSuccess" },
    warning: { state: "Warning", icon: "sap-icon://alert", text: "adminBulkStatusWarning" },
    error: { state: "Error", icon: "sap-icon://error", text: "adminBulkStatusError" },
    skipped: { state: "None", icon: "sap-icon://less", text: "adminBulkStatusSkipped" }
};

function createAdminUserBulkSection(deps) {
    deps = deps || {};
    var UserListLogic = deps.UserListLogic;
    var ODataClient = deps.ODataClient;
    var FileUtil = deps.FileUtil;
    var uid = deps.uid || function () { return String(Date.now()); };

    return {
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

        _undoBulk: function () {
            var oUndo = this._oUndo;
            if (!oUndo) {
                return Promise.resolve();
            }
            this._aBulkSucceeded = [];
            return this._runBulk(oUndo.action, oUndo.usernames, [], this._text("adminBulkUndoReason", "Undo of a bulk action"), true);
        }
    };
}

var oExports = {
    createAdminUserBulkSection: createAdminUserBulkSection
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
