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
                busy: false
            });
            this.getView().setModel(this._oViewModel, "view");

            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("wmReservationEntryList").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.loadData();
        },

        loadData: function () {
            const that = this;
            this._oViewModel.setProperty("/busy", true);

            const oFilters = {
                MovementType: this._oViewModel.getProperty("/filterMvtType"),
                Status: this._oViewModel.getProperty("/filterStatus"),
                Plant: this._oViewModel.getProperty("/filterPlant")
            };

            this._oService.getEntries(oFilters).then(function (aEntries) {
                that._oViewModel.setProperty("/entries", aEntries);
                that._oViewModel.setProperty("/allEntries", aEntries);
                that._oViewModel.setProperty("/busy", false);
            }).catch(function (err) {
                that._oViewModel.setProperty("/busy", false);
                MessageToast.show("Error loading entries: " + err.message);
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
            this.loadData();
        },

        onSearchFieldSearch: function (oEvent) {
            const sQuery = (oEvent.getParameter("query") || "").trim().toLowerCase();
            const aAll = this._oViewModel.getProperty("/allEntries") || [];

            if (!sQuery) {
                this._oViewModel.setProperty("/entries", aAll);
                return;
            }

            const aFiltered = aAll.filter(function (e) {
                return (e.ReservationNo && e.ReservationNo.toLowerCase().includes(sQuery)) ||
                    (e.Material && e.Material.toLowerCase().includes(sQuery)) ||
                    (e.MaterialName && e.MaterialName.toLowerCase().includes(sQuery)) ||
                    (e.MovementType && e.MovementType.includes(sQuery)) ||
                    (e.TransferRequirement && e.TransferRequirement.includes(sQuery));
            });

            this._oViewModel.setProperty("/entries", aFiltered);
        },

        onCreatePress: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmReservationEntryCreate");
        },

        onRowPress: function (oEvent) {
            const oItem = oEvent.getSource();
            const oCtx = oItem.getBindingContext("view");
            if (!oCtx) return;

            const oData = oCtx.getObject();
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmReservationEntryDetail", {
                ReservationNo: oData.ReservationNo,
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
                case "99": return "Error";
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
                case "99": return "Error";
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
                case "99": return "sap-icon://error";
                default: return "";
            }
        }
    });
});
