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

    function sectionColorSlots(aBins) {
        var aCodes = Array.from(new Set(aBins.map(function (oBin) { return oBin.SectionCode; }).filter(Boolean))).sort();
        return aBins.map(function (oBin) {
            var iIndex = aCodes.indexOf(oBin.SectionCode);
            return Object.assign({}, oBin, { SectionColorSlot: iIndex < 0 ? 0 : (iIndex % 24) + 1 });
        });
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRack", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy: false,
                error: "",
                reservationNo: "",
                reservationItem: "",
                isHuManaged: null,
                xhupf: "",
                storageLocation: "",
                bins: [],
                filteredBins: [],
                warehouses: [],
                floors: [],
                racks: [],
                selectedWarehouse: "",
                selectedFloor: "",
                selectedRack: "",
                positions: [],
                nonRackCount: 0,
                mode: "rack"
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
            sItem = sItem || "1";
            this._oViewModel.setProperty("/reservationNo", sReservation || "");
            this._oViewModel.setProperty("/reservationItem", sItem);

            if (!sReservation) {
                this._oViewModel.setProperty("/bins", []);
                this._oViewModel.setProperty("/filteredBins", []);
                this._oViewModel.setProperty("/warehouses", []);
                this._oViewModel.setProperty("/floors", []);
                this._oViewModel.setProperty("/racks", []);
                this._oViewModel.setProperty("/positions", []);
                this._oViewModel.setProperty("/nonRackCount", 0);
                this._oViewModel.setProperty("/error", this.getText("rackMissingReservationError", null, "Reservation number is missing."));
                return Promise.resolve();
            }

            var sUrl = "/odata/v4/hu-stock-transfer/rackLayout(" +
                "warehouse=''," +
                "storageType=''," +
                "rackPrefix=''," +
                "reservation='" + encodeURIComponent(sReservation) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            this._oViewModel.setProperty("/busy", true);
            this._oViewModel.setProperty("/error", "");
            this._oViewModel.setProperty("/bins", []);
            this._oViewModel.setProperty("/filteredBins", []);

            return ODataClient.get(sUrl).then(function (oResponse) {
                var oData = (oResponse && oResponse.value) ? oResponse.value : oResponse;
                var aCells = [];
                var aNonRack = [];
                var sUnmaintained = this.getText("rackSectionNotMaintained", null, "Section not maintained");
                var sMasterUnavailable = this.getText("rackBinMasterUnavailable", null, "Bin master unavailable");

                if (oData && Array.isArray(oData.Cells)) {
                    aCells = oData.Cells;
                    aNonRack = oData.NonRackBins || [];
                    this._oViewModel.setProperty("/isHuManaged", oData.IsHuManaged);
                    this._oViewModel.setProperty("/xhupf", oData.Xhupf || "");
                    this._oViewModel.setProperty("/storageLocation", oData.StorageLocation || "");
                } else {
                    var aRaw = unwrapCollection(oResponse);
                    aCells = aRaw.filter(function (b) { return b.IsRackBin === true; });
                    aNonRack = aRaw.filter(function (b) { return b.IsRackBin !== true; });
                }

                var aCombined = aCells.concat(aNonRack);
                var aAllBins = sectionColorSlots(aCombined).map(function (oBin) {
                    oBin.SectionDisplay = oBin.BinMasterFound === false ? sMasterUnavailable : (oBin.SectionCode ? (oBin.SectionName || oBin.SectionCode) : sUnmaintained);
                    return oBin;
                });
                var aDecoratedCells = aAllBins.filter(function (b) { return b.IsRackBin === true; });

                this._oViewModel.setProperty("/bins", aAllBins);
                this._oViewModel.setProperty("/filteredBins", aAllBins.slice());
                this._oViewModel.setProperty("/nonRackCount", aNonRack.length);
                this._refreshRackGroups(aAllBins, aAllBins);
            }.bind(this)).catch(function () {
                this._oViewModel.setProperty("/error", this.getText("rackLoadError", null, "Could not load stock bins. Check your connection and retry."));
                this._oViewModel.setProperty("/warehouses", []);
                this._oViewModel.setProperty("/floors", []);
                this._oViewModel.setProperty("/racks", []);
                this._oViewModel.setProperty("/positions", []);
                this._oViewModel.setProperty("/nonRackCount", 0);
            }.bind(this)).then(function () {
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        },

        onSearchBins: function (oEvent) {
            var sQuery = (oEvent.getParameter("query") || oEvent.getParameter("newValue") || "").trim().toLowerCase();
            var aBins = this._oViewModel.getProperty("/bins") || [];
            if (!sQuery) {
                this._oViewModel.setProperty("/filteredBins", aBins.slice());
                this._refreshRackGroups(aBins, aBins);
                return;
            }

            var aFilteredBins = aBins.filter(function (oBin) {
                return [oBin.UnitNumber, oBin.UnitCategory, oBin.StorageBin, oBin.StorageType,
                    oBin.StorageTypeDesc, oBin.SutCode, oBin.Batch, oBin.SerialNumber,
                    oBin.Floor, oBin.Rack, oBin.Position, oBin.SectionCode, oBin.SectionName]
                    .some(function (sValue) {
                        return String(sValue || "").toLowerCase().includes(sQuery);
                    });
            });
            this._oViewModel.setProperty("/filteredBins", aFilteredBins);
            this._refreshRackGroups(aBins, aFilteredBins);
        },

        _refreshRackGroups: function (aAllBins, aVisibleBins) {
            var aRackBins = aAllBins.filter(function (oBin) { return oBin.IsRackBin === true; });
            var aVisibleRackBins = aVisibleBins.filter(function (oBin) { return oBin.IsRackBin === true; });
            var aWarehouses = this._selectorOptions(aRackBins, "Warehouse");
            var sWarehouse = this._keepOrFirst(this._oViewModel.getProperty("/selectedWarehouse"), aWarehouses);
            var aWarehouseBins = aRackBins.filter(function (oBin) { return String(oBin.Warehouse || "") === sWarehouse; });
            var aFloors = this._selectorOptions(aWarehouseBins, "Floor");
            var sFloor = this._keepOrFirst(this._oViewModel.getProperty("/selectedFloor"), aFloors);
            var aFloorBins = aWarehouseBins.filter(function (oBin) { return String(oBin.Floor || "") === sFloor; });
            var aRacks = this._selectorOptions(aFloorBins, "Rack");
            var sRack = this._keepOrFirst(this._oViewModel.getProperty("/selectedRack"), aRacks);
            var aVisibleSelected = aVisibleRackBins.filter(function (oBin) {
                return String(oBin.Warehouse || "") === sWarehouse && String(oBin.Floor || "") === sFloor && String(oBin.Rack || "") === sRack;
            });
            var sUnmaintained = this.getText("rackSectionNotMaintained", null, "Section not maintained");
            var sMasterUnavailable = this.getText("rackBinMasterUnavailable", null, "Bin master unavailable");

            var oPositions = new Map();
            aVisibleSelected.forEach(function (oBin) {
                var sPosition = String(oBin.Position || "");
                var oPosition = oPositions.get(sPosition);
                if (!oPosition) {
                    oPosition = {
                        position: sPosition,
                        storageBin: oBin.StorageBin,
                        sectionCode: oBin.SectionCode || "",
                        sectionName: oBin.SectionName || "",
                        sectionDisplay: oBin.BinMasterFound === false ? sMasterUnavailable : (oBin.SectionCode ? (oBin.SectionName || oBin.SectionCode) : sUnmaintained),
                        sectionColorSlot: String(oBin.SectionColorSlot || 0),
                        units: []
                    };
                    oPositions.set(sPosition, oPosition);
                }
                oPosition.units.push(oBin);
            });

            this._oViewModel.setProperty("/warehouses", aWarehouses);
            this._oViewModel.setProperty("/floors", aFloors);
            this._oViewModel.setProperty("/racks", aRacks);
            this._oViewModel.setProperty("/selectedWarehouse", sWarehouse);
            this._oViewModel.setProperty("/selectedFloor", sFloor);
            this._oViewModel.setProperty("/selectedRack", sRack);
            this._oViewModel.setProperty("/positions", Array.from(oPositions.values()).sort(function (a, b) {
                return a.position.localeCompare(b.position, undefined, { numeric: true });
            }));
            this._oViewModel.setProperty("/nonRackCount", aVisibleBins.filter(function (oBin) { return oBin.IsRackBin !== true; }).length);
        },

        _selectorOptions: function (aBins, sField) {
            var aValues = Array.from(new Set(aBins.map(function (oBin) { return String(oBin[sField] || ""); }).filter(Boolean)));
            aValues.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
            return aValues.map(function (sValue) { return { key: sValue, text: sValue }; });
        },

        _keepOrFirst: function (sCurrent, aOptions) {
            return aOptions.some(function (oOption) { return oOption.key === sCurrent; }) ? sCurrent : (aOptions[0] ? aOptions[0].key : "");
        },

        onWarehouseChange: function (oEvent) {
            this._oViewModel.setProperty("/selectedWarehouse", oEvent.getParameter("selectedItem").getKey());
            this._refreshRackGroups(this._oViewModel.getProperty("/bins") || [], this._oViewModel.getProperty("/filteredBins") || []);
        },

        onFloorChange: function (oEvent) {
            this._oViewModel.setProperty("/selectedFloor", oEvent.getParameter("selectedItem").getKey());
            this._refreshRackGroups(this._oViewModel.getProperty("/bins") || [], this._oViewModel.getProperty("/filteredBins") || []);
        },

        onRackChange: function (oEvent) {
            this._oViewModel.setProperty("/selectedRack", oEvent.getParameter("selectedItem").getKey());
            this._refreshRackGroups(this._oViewModel.getProperty("/bins") || [], this._oViewModel.getProperty("/filteredBins") || []);
        },

        onToggleMode: function () {
            this._oViewModel.setProperty("/mode", this._oViewModel.getProperty("/mode") === "rack" ? "table" : "rack");
        },

        onShowTable: function () {
            this._oViewModel.setProperty("/mode", "table");
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
        },

        onRouteToStandard311: function () {
            var sRes = this._oViewModel.getProperty("/reservationNo");
            var sItem = this._oViewModel.getProperty("/reservationItem") || "1";
            this.getRouter().navTo("wmReservationEntryDetail", {
                ReservationNo: sRes,
                ReservationItem: sItem
            });
        }
    });
});
