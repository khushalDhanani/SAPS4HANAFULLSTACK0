sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "../service/ReservationEntryService"
], function (Controller, JSONModel, MessageToast, ReservationEntryService) {
    "use strict";

    return Controller.extend("saps4hana.fiori.modules.wm.reservation-entry.controller.ReservationEntryList", {
        onInit: function () {
            this._oService = new ReservationEntryService();
            this._oViewModel = new JSONModel({
                entries: [],
                allEntries: [],
                filterMvtType: "",
                filterStatus: "",
                filterPlant: "",
                filterDateFrom: null,
                filterDateTo: null,
                hasRetryableSelection: false,
                selectedEntry: null,
                busy: false
            });
            this.getView().setModel(this._oViewModel, "view");

            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("wmReservationEntryList").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.loadData();
        },

        _formatDateIso: function (d) {
            if (!d) return "";
            if (typeof d === "string") return d.split("T")[0];
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return y + "-" + m + "-" + day;
        },

        loadData: function () {
            const that = this;
            this._oViewModel.setProperty("/busy", true);

            // Filters narrow the query by Movement Type and Plant
            const oFilters = {
                MovementType: this._oViewModel.getProperty("/filterMvtType"),
                Plant: this._oViewModel.getProperty("/filterPlant")
            };

            const pTracked = (this._oService && typeof this._oService.getEntries === "function")
                ? this._oService.getEntries(oFilters).catch(function () { return []; })
                : Promise.resolve([]);

            const pOpen = (this._oService && typeof this._oService.getOpenReservations === "function")
                ? this._oService.getOpenReservations(oFilters).catch(function () { return []; })
                : Promise.resolve([]);

            const SUPPORTED_MVTS = ["311", "201", "241", "301"];

            return Promise.all([pTracked, pOpen]).then(function (aResults) {
                const aTracked = (aResults[0] || []).filter(function (e) {
                    return e && SUPPORTED_MVTS.includes(String(e.MovementType || "").trim());
                });
                const aOpen = (aResults[1] || []).filter(function (o) {
                    return o && SUPPORTED_MVTS.includes(String(o.MovementType || "").trim());
                });

                // Tracked entries take priority: they have TransferRequirement, Status_code, etc.
                const mSeen = {};
                const aCombined = [];

                const fnNorm = function (s) {
                    return String(s || "").trim().replace(/^0+/, "");
                };
                const fnPad = function (s) {
                    return String(s || "").trim().padStart(10, "0");
                };

                aTracked.forEach(function (e) {
                    if (e && e.ReservationNo) {
                        mSeen[e.ReservationNo] = true;
                        mSeen[fnNorm(e.ReservationNo)] = true;
                        mSeen[fnPad(e.ReservationNo)] = true;
                        aCombined.push(e);
                    }
                });

                aOpen.forEach(function (o) {
                    if (o && o.ReservationNo) {
                        const sClean = fnNorm(o.ReservationNo);
                        const sPad = fnPad(o.ReservationNo);
                        if (!mSeen[o.ReservationNo] && !mSeen[sClean] && !mSeen[sPad]) {
                            mSeen[o.ReservationNo] = true;
                            mSeen[sClean] = true;
                            mSeen[sPad] = true;
                            o.ReservationNo = sPad;
                            aCombined.push(o);
                        }
                    }
                });

                that._oViewModel.setProperty("/entries", aCombined);
                that._oViewModel.setProperty("/allEntries", aCombined);
                that._oViewModel.setProperty("/hasRetryableSelection", false);
                that._oViewModel.setProperty("/selectedEntry", null);
                that._oViewModel.setProperty("/busy", false);
                return aCombined;
            }).catch(function (err) {
                that._oViewModel.setProperty("/busy", false);
                MessageToast.show("Error loading reservations: " + err.message);
            });
        },

        onRefreshPress: function () {
            this.loadData();
            MessageToast.show("Data refreshed");
        },

        onFilterChange: function () {
            this.loadData();
        },

        onSearch: function () {
            this.loadData();
        },

        onClearFilters: function () {
            this._oViewModel.setProperty("/filterMvtType", "");
            this._oViewModel.setProperty("/filterStatus", "");
            this._oViewModel.setProperty("/filterPlant", "");
            this._oViewModel.setProperty("/filterDateFrom", null);
            this._oViewModel.setProperty("/filterDateTo", null);
            this.loadData();
        },

        onSelectionChange: function (oEvent) {
            const oItem = oEvent.getParameter("listItem");
            if (!oItem) {
                this._oViewModel.setProperty("/hasRetryableSelection", false);
                this._oViewModel.setProperty("/selectedEntry", null);
                return;
            }

            const oCtx = oItem.getBindingContext("view");
            const oEntry = oCtx ? oCtx.getObject() : null;

            if (oEntry) {
                this._oViewModel.setProperty("/selectedEntry", oEntry);
                // Retryable if status is not completed ('05')
                const bRetryable = oEntry.Status_code !== "05";
                this._oViewModel.setProperty("/hasRetryableSelection", bRetryable);
            } else {
                this._oViewModel.setProperty("/hasRetryableSelection", false);
                this._oViewModel.setProperty("/selectedEntry", null);
            }
        },

        onRetryPress: function () {
            const that = this;
            const oSelected = this._oViewModel.getProperty("/selectedEntry");
            if (!oSelected) {
                MessageToast.show("Please select a reservation entry to retry");
                return Promise.resolve();
            }

            this._oViewModel.setProperty("/busy", true);
            return this._oService.retryStep(oSelected.ReservationNo, oSelected.ReservationItem, "AUTO").then(function (oUpdated) {
                that._oViewModel.setProperty("/busy", false);
                const sStatus = oUpdated.Status_code;
                if (["11", "12", "13", "90", "99"].indexOf(sStatus) >= 0) {
                    MessageToast.show("Retry completed with error: " + (oUpdated.ErrorMessage || "Failed"));
                } else {
                    MessageToast.show("Step retried successfully. Current Status: " + sStatus);
                }
                return that.loadData();
            }).catch(function (err) {
                that._oViewModel.setProperty("/busy", false);
                MessageToast.show("Retry failed: " + err.message);
            });
        },

        onSearchFieldSearch: function (oEvent) {
            const sQuery = (oEvent.getParameter("query") || "").trim().toLowerCase();
            const sQueryClean = sQuery.replace(/^0+/, "");
            const aAll = this._oViewModel.getProperty("/allEntries") || [];

            if (!sQuery) {
                this._oViewModel.setProperty("/entries", aAll);
                return;
            }

            const aFiltered = aAll.filter(function (e) {
                const sRes = (e.ReservationNo || "").toLowerCase();
                const sResClean = sRes.replace(/^0+/, "");
                const bResMatch = sRes.includes(sQuery) || (sQueryClean && sResClean.includes(sQueryClean));

                return bResMatch ||
                    (e.Material && e.Material.toLowerCase().includes(sQuery)) ||
                    (e.MaterialName && e.MaterialName.toLowerCase().includes(sQuery)) ||
                    (e.MovementType && e.MovementType.includes(sQuery)) ||
                    (e.TransferRequirement && e.TransferRequirement.includes(sQuery)) ||
                    (e.TransferOrder && e.TransferOrder.includes(sQuery)) ||
                    (e.MaterialDocument && e.MaterialDocument.includes(sQuery));
            });

            this._oViewModel.setProperty("/entries", aFiltered);
        },

        onCreatePress: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmReservationEntryCreate");
        },

        onRowPress: function (oEvent) {
            const oItem = (oEvent && typeof oEvent.getParameter === "function" && oEvent.getParameter("listItem")) || (oEvent && oEvent.getSource ? oEvent.getSource() : null);
            const oCtx = oItem ? oItem.getBindingContext("view") : null;
            if (!oCtx) return;

            const oData = oCtx.getObject();
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmReservationEntryDetail", {
                ReservationNo: String(oData.ReservationNo || "").padStart(10, "0"),
                ReservationItem: oData.ReservationItem || "0001"
            });
        },

        formatStatusText: function (sCode) {
            switch (sCode) {
                case "01": return "Reservation Created";
                case "02": return "TR Auto-Created";
                case "03": return "TO Created";
                case "04": return "TO Confirmed";
                case "05": return "Goods Issue Posted";
                case "11": return "TR Creation Error";
                case "12": return "TO Creation Error";
                case "13": return "TO Confirmation Error";
                case "90": return "Goods Issue Error";
                case "99": return "Cancelled / Reversed";
                default: return sCode || "Pending";
            }
        },

        formatStatusState: function (sCode) {
            switch (sCode) {
                case "01": return "Information";
                case "02": return "Warning"; // In Progress / Staging
                case "03": return "Warning";
                case "04": return "Warning";
                case "05": return "Success"; // Green completed
                case "11": case "12": case "13": case "90": case "99": return "Error";
                default: return "None";
            }
        },

        formatStatusIcon: function (sCode) {
            switch (sCode) {
                case "01": return "sap-icon://create";
                case "02": return "sap-icon://shipping-status";
                case "03": return "sap-icon://cart";
                case "04": return "sap-icon://accept";
                case "05": return "sap-icon://sys-enter-2";
                case "11": case "12": case "13": case "90": return "sap-icon://error";
                case "99": return "sap-icon://cancel";
                default: return "";
            }
        }
    });
});
