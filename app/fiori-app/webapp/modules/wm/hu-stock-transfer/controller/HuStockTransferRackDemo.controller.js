sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, MessageToast) {
    "use strict";

    function reservationItems(oResponse) {
        var oPayload = oResponse && oResponse.value ? oResponse.value : oResponse;
        if (Array.isArray(oPayload)) { return oPayload; }
        return oPayload && Array.isArray(oPayload.Items) ? oPayload.Items : [];
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRackDemo", {
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy: false,
                error: "",
                reservations: [],
                filteredReservations: [],
                selectedReservation: null,
                searchQuery: ""
            });
            this.setModel(this._oViewModel, "rackReservation");
            this.getRouter().getRoute("wmHuStockTransferRackDemo").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.loadReservations();
        },

        loadReservations: function () {
            this._oViewModel.setProperty("/busy", true);
            this._oViewModel.setProperty("/error", "");
            this._oViewModel.setProperty("/selectedReservation", null);

            var sUrl = "/odata/v4/hu-stock-transfer/getOpenReservations(" +
                "plant='1120'," +
                "storageLocation=''," +
                "movementType='311'," +
                "requester=''," +
                "reservation=''," +
                "material=''," +
                "status='open'," +
                "includeDeleted=false)";

            return ODataClient.get(sUrl).then(function (oResponse) {
                var aItems = reservationItems(oResponse);
                this._oViewModel.setProperty("/reservations", aItems);
                this._applySearch(this._oViewModel.getProperty("/searchQuery") || "");
            }.bind(this)).catch(function (oError) {
                this._oViewModel.setProperty("/reservations", []);
                this._oViewModel.setProperty("/filteredReservations", []);
                this._oViewModel.setProperty("/error", this.getText(
                    "rackReservationLoadError", null,
                    "Could not load open reservations. Check your connection and retry."
                ) + (oError && oError.message ? " " + oError.message : ""));
            }.bind(this)).then(function () {
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        },

        onSearchReservations: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            this._oViewModel.setProperty("/searchQuery", sQuery);
            this._applySearch(sQuery);
        },

        _applySearch: function (sQuery) {
            var sNeedle = String(sQuery || "").trim().toLowerCase();
            var aRows = this._oViewModel.getProperty("/reservations") || [];
            var aFiltered = !sNeedle ? aRows : aRows.filter(function (oRow) {
                return [oRow.ReservationNo, oRow.ReservationItem, oRow.Material, oRow.MaterialDesc, oRow.RequesterName]
                    .some(function (sValue) { return String(sValue || "").toLowerCase().includes(sNeedle); });
            });
            this._oViewModel.setProperty("/filteredReservations", aFiltered);
        },

        onReservationSelectionChange: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem && oItem.getBindingContext("rackReservation");
            this._oViewModel.setProperty("/selectedReservation", oContext ? oContext.getObject() : null);
        },

        onReservationPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem && oItem.getBindingContext("rackReservation");
            if (oContext) { this._openRack(oContext.getObject()); }
        },

        onOpenSelectedRack: function () {
            var oReservation = this._oViewModel.getProperty("/selectedReservation");
            if (!oReservation) {
                MessageToast.show(this.getText("rackReservationSelectPrompt", null, "Select a reservation item first."));
                return;
            }
            this._openRack(oReservation);
        },

        _openRack: function (oReservation) {
            if (!oReservation || !oReservation.ReservationNo || !oReservation.ReservationItem) {
                MessageToast.show(this.getText("rackReservationDataMissing", null, "This row has no reservation item to open."));
                return;
            }
            this.getRouter().navTo("wmHuStockTransferRack", {
                reservation: oReservation.ReservationNo,
                item: oReservation.ReservationItem
            });
        },

        onRetry: function () { this.loadReservations(); },
        onBackToReservations: function () { this.getRouter().navTo("wmHuStockTransfer"); }
    });
});
