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
                selectedItem: null,
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
                    oViewModel.setProperty("/selectedItem", null);
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

        onClearFilters: function () {
            var oViewModel = this.getModel("listView");
            oViewModel.setProperty("/filters", {
                plant: "1120",
                storageLocation: "",
                movementType: "311",
                reservation: "",
                material: "",
                requester: "",
                status: "open"
            });
            this.loadReservations();
        },

        onRefresh: function () {
            this.loadReservations();
            MessageToast.show("Reservations refreshed");
        },

        onOpenRackDemo: function () {
            this.getRouter().navTo("wmHuStockTransferRackDemo");
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

        onSelectionChange: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem ? oItem.getBindingContext("listView") : null;
            var oViewModel = this.getModel("listView");
            if (oContext) {
                oViewModel.setProperty("/selectedItem", oContext.getObject());
            } else {
                oViewModel.setProperty("/selectedItem", null);
            }
        },

        onProcessSelected: function () {
            var oViewModel = this.getModel("listView");
            var oSelected = oViewModel.getProperty("/selectedItem");
            if (!oSelected) {
                MessageToast.show(this.getText("selectReservationPrompt", [], "Please select a reservation to process"));
                return;
            }
            this._navigateToDetail(oSelected.ReservationNo, oSelected.ReservationItem);
        },

        onItemPress: function (oEvent) {
            var oItem = (oEvent && typeof oEvent.getParameter === "function" && oEvent.getParameter("listItem")) ||
                        (oEvent && oEvent.getSource ? oEvent.getSource() : null);
            var oContext = oItem ? oItem.getBindingContext("listView") : null;
            if (!oContext) return;

            var sReservation = oContext.getProperty("ReservationNo");
            var sItem = oContext.getProperty("ReservationItem");

            this._navigateToDetail(sReservation, sItem);
        },

        _navigateToDetail: function (sReservation, sItem) {
            if (!sReservation) return;
            var oRouter = (this.getOwnerComponent && this.getOwnerComponent().getRouter()) || this.getRouter();
            if (oRouter) {
                oRouter.navTo("wmHuStockTransferDetail", {
                    reservation: String(sReservation),
                    item: String(sItem || "1")
                });
            }
        }
    });
});
