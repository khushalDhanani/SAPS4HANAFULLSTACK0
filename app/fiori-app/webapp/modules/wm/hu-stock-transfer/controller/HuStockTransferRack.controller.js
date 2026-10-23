sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, MessageToast) {
    "use strict";

    function unwrapCollection(oResponse) {
        if (oResponse && Array.isArray(oResponse.value)) {
            return oResponse.value;
        }
        return Array.isArray(oResponse) ? oResponse : [];
    }

    function isSelectableStockRow(oBin) {
        return Boolean(oBin && oBin.UnitNumber && ["HU", "SU", "BIN"].indexOf(oBin.UnitCategory) !== -1);
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRack", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy: false,
                error: "",
                reservationNo: "",
                reservationItem: "",
                bins: [],
                filteredBins: []
            });
            this.setModel(this._oViewModel, "rackView");
            this.getRouter().getRoute("wmHuStockTransferRack").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments") || {};
            var sReservation = oArgs.reservation || "";
            var sItem = oArgs.item || "1";

            this._oViewModel.setProperty("/reservationNo", sReservation);
            this._oViewModel.setProperty("/reservationItem", sItem);
            this.loadBins(sReservation, sItem);
        },

        loadBins: function (sReservation, sItem) {
            if (!sReservation) {
                this._oViewModel.setProperty("/bins", []);
                this._oViewModel.setProperty("/filteredBins", []);
                this._oViewModel.setProperty("/error", this.getText("rackMissingReservationError", null, "Reservation number is missing."));
                return Promise.resolve();
            }

            var sUrl = "/odata/v4/hu-stock-transfer/getStorageBins(" +
                "reservation='" + encodeURIComponent(sReservation) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            this._oViewModel.setProperty("/busy", true);
            this._oViewModel.setProperty("/error", "");
            this._oViewModel.setProperty("/bins", []);
            this._oViewModel.setProperty("/filteredBins", []);

            return ODataClient.get(sUrl).then(function (oResponse) {
                var aBins = unwrapCollection(oResponse);
                this._oViewModel.setProperty("/bins", aBins);
                this._oViewModel.setProperty("/filteredBins", aBins.slice());
            }.bind(this)).catch(function () {
                this._oViewModel.setProperty("/error", this.getText("rackLoadError", null, "Could not load stock bins. Check your connection and retry."));
            }.bind(this)).then(function () {
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        },

        onSearchBins: function (oEvent) {
            var sQuery = (oEvent.getParameter("query") || oEvent.getParameter("newValue") || "").trim().toLowerCase();
            var aBins = this._oViewModel.getProperty("/bins") || [];
            if (!sQuery) {
                this._oViewModel.setProperty("/filteredBins", aBins.slice());
                return;
            }

            this._oViewModel.setProperty("/filteredBins", aBins.filter(function (oBin) {
                return [oBin.UnitNumber, oBin.UnitCategory, oBin.StorageBin, oBin.StorageType,
                    oBin.StorageTypeDesc, oBin.SutCode, oBin.Batch, oBin.SerialNumber]
                    .some(function (sValue) {
                        return String(sValue || "").toLowerCase().includes(sQuery);
                    });
            }));
        },

        onRetryLoad: function () {
            this.loadBins(
                this._oViewModel.getProperty("/reservationNo"),
                this._oViewModel.getProperty("/reservationItem")
            );
        },

        onSelectBinUnit: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("rackView");
            var oBin = oContext && oContext.getObject();
            if (!isSelectableStockRow(oBin)) {
                MessageToast.show(this.getText("rackSelectStockOnly", null, "Select a handling unit, storage unit, or bin with stock."));
                return;
            }

            var oShared = this.getOwnerComponent().getModel("cockpitShared");
            if (!oShared) {
                oShared = new JSONModel();
                this.getOwnerComponent().setModel(oShared, "cockpitShared");
            }
            oShared.setProperty("/preselectedUnit", oBin.UnitNumber);
            this.onNavBackToCockpit();
        },

        onNavBackToCockpit: function () {
            this.getRouter().navTo("wmHuStockTransferDetail", {
                reservation: this._oViewModel.getProperty("/reservationNo"),
                item: this._oViewModel.getProperty("/reservationItem") || "1"
            });
        }
    });
});
