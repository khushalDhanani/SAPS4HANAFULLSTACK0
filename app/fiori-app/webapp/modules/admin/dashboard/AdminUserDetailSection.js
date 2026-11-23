function createAdminUserDetailSection(deps) {
    deps = deps || {};
    var ODataClient = deps.ODataClient;
    var MessageToast = deps.MessageToast;
    var MessageBox = deps.MessageBox;

    return {
        _selectUser: function (oEvent) {
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

            oAdminModel.setProperty("/selectedUser", { username: sUsername });
            oAdminModel.setProperty("/detailError", "");
            oAdminModel.setProperty("/detailBusy", true);

            var sUrl = "/odata/v4/user-management/getUserDetail(username='" + encodeURIComponent(sUsername) + "')";
            return ODataClient.get(sUrl)
                .then(function (res) {
                    var oDetail = res && res.value ? res.value : res;
                    that._updateAdminUserListEntry(oDetail);
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

        _lockUser: function (oEvent) {
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

        _unlockUser: function (oEvent) {
            var sUsername = this._getAdminActionUsername(oEvent);
            if (!sUsername) {
                return;
            }
            this._confirmUnlockUser(sUsername);
        },

        _confirmUnlockUser: function (sUsername) {
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
        }
    };
}

var oExports = {
    createAdminUserDetailSection: createAdminUserDetailSection
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
