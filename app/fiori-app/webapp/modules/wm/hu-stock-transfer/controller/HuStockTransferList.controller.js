sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, ODataClient, MessageToast, MessageBox) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferList", {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                filters: {
                    plant: "1120",
                    storageLocation: "",
                    movementType: "311",
                    reservation: "",
                    material: "",
                    requester: "",
                    status: "open"
                },
                items: [],
                allItems: []
            });
            this.setModel(oViewModel, "listView");

            this.getRouter().getRoute("wmHuStockTransfer").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.loadReservations();
        },

        loadReservations: function () {
            var oViewModel = this.getModel("listView");
            var oFilters = oViewModel.getProperty("/filters") || {};
            oViewModel.setProperty("/busy", true);

            var sUrl = "/odata/v4/hu-stock-transfer/getOpenReservations(" +
                "plant='" + encodeURIComponent(oFilters.plant || "") + "'," +
                "storageLocation='" + encodeURIComponent(oFilters.storageLocation || "") + "'," +
                "movementType='" + encodeURIComponent(oFilters.movementType || "") + "'," +
                "requester='" + encodeURIComponent(oFilters.requester || "") + "'," +
                "reservation='" + encodeURIComponent(oFilters.reservation || "") + "'," +
                "material='" + encodeURIComponent(oFilters.material || "") + "'," +
                "status='" + encodeURIComponent(oFilters.status || "open") + "'," +
                "includeDeleted=false)";

            ODataClient.get(sUrl)
                .then(function (data) {
                    var oPayload = (data && data.value) ? data.value : data;
                    var aItems = (oPayload && oPayload.Items) || (Array.isArray(oPayload) ? oPayload : []);
                    oViewModel.setProperty("/items", aItems);
                    oViewModel.setProperty("/allItems", aItems);
                    oViewModel.setProperty("/busy", false);
                })
                .catch(function (err) {
                    oViewModel.setProperty("/busy", false);
                    MessageBox.error("Failed to load reservations from SAP: " + (err && err.message ? err.message : String(err)));
                });
        },

        onSearch: function () {
            this.loadReservations();
        },

        onRefresh: function () {
            this.loadReservations();
            MessageToast.show("Reservations refreshed");
        },

        onLiveSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var oViewModel = this.getModel("listView");
            var aAll = oViewModel.getProperty("/allItems") || [];

            if (!sQuery.trim()) {
                oViewModel.setProperty("/items", aAll);
                return;
            }

            var sLower = sQuery.toLowerCase();
            var aFiltered = aAll.filter(function (it) {
                return (it.ReservationNo && it.ReservationNo.toLowerCase().includes(sLower)) ||
                       (it.Material && it.Material.toLowerCase().includes(sLower)) ||
                       (it.MaterialDesc && it.MaterialDesc.toLowerCase().includes(sLower)) ||
                       (it.RequesterName && it.RequesterName.toLowerCase().includes(sLower));
            });
            oViewModel.setProperty("/items", aFiltered);
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem.getBindingContext("listView");
            if (!oContext) return;

            var sReservation = oContext.getProperty("ReservationNo");
            var sItem = oContext.getProperty("ReservationItem");

            this.getRouter().navTo("wmHuStockTransferDetail", {
                reservation: sReservation,
                item: sItem
            });
        }
    });
});
