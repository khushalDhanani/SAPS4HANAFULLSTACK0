sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox"
], function (
    BaseController,
    JSONModel,
    ODataClient,
    MessageToast,
    AuthService,
    Fragment,
    MessageBox
) {
    "use strict";

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
            var oAdminModel = new JSONModel({
                users: [],
                userCount: 0,
                busy: false,
                searchQuery: "",
                noDataText: this._text("adminNoUsers", "No SAP users found."),
                selectedUser: null
            });
            this.getView().setModel(oAdminModel, "adminView");

            var oViewModel = new JSONModel({
                selectedTab: "overview",
                connectionState: "None",
                connectionText: this._text("dashboardConnectionChecking", "Checking S/4HANA connection…"),
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
            oViewModel.setProperty("/connectionState", "None");
            oViewModel.setProperty("/connectionText", this._text("dashboardConnectionChecking", "Checking S/4HANA connection…"));

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
                    that._setConnectionStatus(iAvailable, METRIC_KEYS.length, oMetrics.asOf);
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
                    that._setConnectionStatus(0, METRIC_KEYS.length);
                });
        },

        /**
         * @private
         */
        _setConnectionStatus: function (iAvailable, iTotal, sAsOf) {
            var oViewModel = this.getView().getModel("dashboardView");
            // Figures may come from the server cache (30 s transactional / 5 min master data): show when SAP was actually read.
            var dAsOf = sAsOf ? new Date(sAsOf) : null;
            var sAsOfText = (dAsOf && !isNaN(dAsOf.getTime())) ? dAsOf.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
            if (iAvailable === iTotal) {
                oViewModel.setProperty("/connectionState", "Success");
                oViewModel.setProperty("/connectionText", sAsOfText
                    ? this._text("dashboardConnectionOkAsOf", "S/4HANA connected \u00b7 figures as of {0}", [sAsOfText])
                    : this._text("dashboardConnectionOk", "S/4HANA connected"));
            } else if (iAvailable === 0) {
                oViewModel.setProperty("/connectionState", "Error");
                oViewModel.setProperty("/connectionText", this._text("dashboardConnectionDown", "S/4HANA not reachable"));
            } else {
                oViewModel.setProperty("/connectionState", "Warning");
                oViewModel.setProperty("/connectionText", this._text(
                    "dashboardConnectionPartial",
                    "S/4HANA partially available ({0} of {1} figures)",
                    [String(iAvailable), String(iTotal)]
                ));
            }
        },

        /**
         * Tile value: the SAP count as text, or nothing while loading / unavailable.
         */
        formatMetricValue: function (vCount) {
            return (typeof vCount === "number") ? String(vCount) : "";
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

        onRefresh: function () {
            var that = this;
            this._loadMetrics().then(function () {
                MessageToast.show(that._text("dashboardActionRefreshDesc", "Fetch latest changes from SAP Gateway"));
            });
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
        _loadAdminUsers: function (sSearch) {
            var oAdminModel = this.getView().getModel("adminView");
            if (!oAdminModel) {
                return Promise.resolve();
            }

            var sQuery = (sSearch !== undefined && sSearch !== null) ? String(sSearch).trim() : (oAdminModel.getProperty("/searchQuery") || "");
            oAdminModel.setProperty("/busy", true);

            var sUrl = "/odata/v4/user-management/listUsers(search='" + encodeURIComponent(sQuery) + "',maxRows=200)";
            var that = this;

            return ODataClient.get(sUrl)
                .then(function (res) {
                    var aUsers = (res && res.value) || [];
                    oAdminModel.setProperty("/users", aUsers);
                    oAdminModel.setProperty("/userCount", aUsers.length);
                    oAdminModel.setProperty("/noDataText", that._text("adminNoUsers", "No SAP users found."));
                    oAdminModel.setProperty("/busy", false);
                    that._bAdminUsersLoaded = true;
                })
                .catch(function (err) {
                    oAdminModel.setProperty("/users", []);
                    oAdminModel.setProperty("/userCount", 0);
                    oAdminModel.setProperty("/noDataText", that._text("adminLoadFailed", "Failed to load SAP users."));
                    oAdminModel.setProperty("/busy", false);
                    var sMsg = (err && err.message) || that._text("adminLoadFailed", "Failed to load SAP users.");
                    MessageToast.show(sMsg);
                });
        },

        onSearchUsers: function (oEvent) {
            var sQuery = oEvent ? oEvent.getParameter("query") : "";
            this.getView().getModel("adminView").setProperty("/searchQuery", sQuery);
            this._loadAdminUsers(sQuery);
        },

        onRefreshUsers: function () {
            var sQuery = this.getView().getModel("adminView").getProperty("/searchQuery") || "";
            this._loadAdminUsers(sQuery);
        },

        onSelectUser: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("adminView");
            var sUsername = oContext ? oContext.getProperty("username") : null;
            if (!sUsername) {
                return;
            }

            var oAdminModel = this.getView().getModel("adminView");
            var that = this;
            var oView = this.getView();

            if (!this._pUserDetailDialog) {
                this._pUserDetailDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.fragment.UserDetailDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }

            this._pUserDetailDialog.then(function (oDialog) {
                oDialog.setBusy(true);
                oDialog.open();

                var sUrl = "/odata/v4/user-management/getUserDetail(username='" + encodeURIComponent(sUsername) + "')";
                return ODataClient.get(sUrl)
                    .then(function (res) {
                        var oDetail = res && res.value ? res.value : res;
                        oAdminModel.setProperty("/selectedUser", oDetail);
                        that._updateAdminUserListEntry(oDetail);
                        oDialog.setBusy(false);
                    })
                    .catch(function (err) {
                        oDialog.setBusy(false);
                        that._markAdminUserDetailsUnavailable(sUsername);
                        var sMsg = (err && err.message) || that._text("adminDetailLoadFailed", "Failed to load user detail from SAP.");
                        MessageToast.show(sMsg);
                    });
            });
        },

        onCloseUserDetailDialog: function () {
            if (this._pUserDetailDialog) {
                this._pUserDetailDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
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

        _updateAdminUserListEntry: function (oDetail) {
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
                    return;
                }
            }
        },

        _markAdminUserDetailsUnavailable: function (sUsername) {
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
                        lastChangedBy: null
                    }));
                    return;
                }
            }
        },

        _executeUserAction: function (sUrl, sUsername, bExpectedLocked) {
            var that = this;
            var oAdminModel = this.getView().getModel("adminView");
            var bActionAccepted = false;
            var bDetailReceived = false;

            if (this._pUserDetailDialog) {
                this._pUserDetailDialog.then(function (oDialog) {
                    oDialog.setBusy(true);
                });
            }

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
                            oAdminModel.setProperty("/selectedUser", oDetail);
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
                    }
                    var sError = (err && err.message) || that._text("adminActionFailed", "SAP user action failed.");
                    MessageBox.error(sError);
                })
                .finally(function () {
                    if (that._pUserDetailDialog) {
                        that._pUserDetailDialog.then(function (oDialog) {
                            oDialog.setBusy(false);
                        });
                    }
                });
        },

        onExit: function () {
            if (this._oAuthBinding) {
                this._oAuthBinding.detachChange(this._onAuthChanged, this);
                this._oAuthBinding = null;
            }
            if (this._pUserDetailDialog) {
                this._pUserDetailDialog.then(function (oDialog) {
                    oDialog.destroy();
                });
                this._pUserDetailDialog = null;
            }
        }
    });
});
