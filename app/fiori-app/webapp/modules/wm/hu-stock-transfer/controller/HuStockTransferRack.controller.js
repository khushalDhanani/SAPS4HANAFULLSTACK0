sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, ODataClient, MessageToast, MessageBox) {
    "use strict";

    var SLOT_CONFIGS = [
        { level: 5, bay: 1, key: "L5-B1", prop: "L5_B1", zoneColor: "Pink", badgeText: "HAZARD / CORROSIVE" },
        { level: 5, bay: 2, key: "L5-B2", prop: "L5_B2", zoneColor: "Pink", badgeText: "HAZARD / CORROSIVE" },
        { level: 4, bay: 1, key: "L4-B1", prop: "L4_B1", zoneColor: "Green", badgeText: "FAST-MOVING" },
        { level: 4, bay: 2, key: "L4-B2", prop: "L4_B2", zoneColor: "Green", badgeText: "FAST-MOVING" },
        { level: 3, bay: 1, key: "L3-B1", prop: "L3_B1", zoneColor: "Green", badgeText: "FAST-MOVING" },
        { level: 3, bay: 2, key: "L3-B2", prop: "L3_B2", zoneColor: "Green", badgeText: "FAST-MOVING" },
        { level: 2, bay: 1, key: "L2-B1", prop: "L2_B1", zoneColor: "Blue", badgeText: "COLD STORAGE" },
        { level: 2, bay: 2, key: "L2-B2", prop: "L2_B2", zoneColor: "Blue", badgeText: "COLD STORAGE" },
        { level: 1, bay: 1, key: "L1-B1", prop: "L1_B1", zoneColor: "Orange", badgeText: "PRIORITY OUTBOUND" },
        { level: 1, bay: 2, key: "L1-B2", prop: "L1_B2", zoneColor: "Orange", badgeText: "PRIORITY OUTBOUND" }
    ];

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRack", {

        onInit: function () {
            this._aAllQuants = [];
            this._sSelectedSlotKey = "L5-B1";

            var oViewModel = new JSONModel({
                busy: false,
                reservationNo: "",
                reservationItem: "1",
                materialNumber: "",
                materialDesc: "",
                warehouse: "W01",
                modelName: "Heavy Duty Selective Pallet Rack",
                dimensions: "2.8m (W) × 5.5m (H) × 1.2m (D)",
                storageTypes: [],
                selectedStorageType: "",
                racks: [],
                selectedRack: "",
                hasPrevRack: false,
                hasNextRack: false,
                rackTitle: "Selective Pallet Rack",
                totalBinsCount: "10",
                occupiedBinsCount: "0",
                availableBinsCount: "10",
                selectedSlot: null,
                selectedSlotItems: [],
                slots: {}
            });
            this.setModel(oViewModel, "rackView");

            this.getRouter().getRoute("wmHuStockTransferRack").attachPatternMatched(this._onRouteMatched, this);
        },

        onAfterRendering: function () {
            var that = this;
            var oDom = this.getView().getDomRef();
            if (oDom && !oDom._rackClickBound) {
                oDom._rackClickBound = true;
                oDom.addEventListener("click", function (oEvt) {
                    var oTarget = oEvt.target;
                    if (!oTarget) return;
                    var oSlotElem = oTarget.closest ? oTarget.closest("[data-slotkey], [data-slot-key]") : null;
                    if (oSlotElem) {
                        var sKey = oSlotElem.getAttribute("data-slotkey") || oSlotElem.getAttribute("data-slot-key");
                        if (sKey) {
                            that.onSelectSlot(sKey);
                        }
                    }
                });
            }
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments") || {};
            var sRes = oArgs.reservation || "";
            var sItem = oArgs.item || "1";

            var oViewModel = this.getModel("rackView");
            oViewModel.setProperty("/reservationNo", sRes);
            oViewModel.setProperty("/reservationItem", sItem);
            this._sSelectedSlotKey = "L5-B1";

            this.loadRackData(sRes, sItem);
        },

        loadRackData: function (sRes, sItem) {
            if (!sRes) return;
            var oViewModel = this.getModel("rackView");
            oViewModel.setProperty("/busy", true);

            var sCockpitUrl = "/odata/v4/hu-stock-transfer/getCockpitDetail(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            var sRackUrl = "/odata/v4/hu-stock-transfer/getVisualRack(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            var that = this;
            Promise.all([
                ODataClient.get(sCockpitUrl).catch(function () { return null; }),
                ODataClient.get(sRackUrl).catch(function () { return null; })
            ]).then(function (aResults) {
                oViewModel.setProperty("/busy", false);

                var oCockpitData = (aResults[0] && aResults[0].value) ? aResults[0].value : (aResults[0] || {});
                var aRackData = (aResults[1] && aResults[1].value) ? aResults[1].value : (aResults[1] || []);

                if (!Array.isArray(aRackData) || aRackData.length === 0) {
                    // Fallback to getStorageBins if visual rack endpoint returned no bins
                    var sBinsUrl = "/odata/v4/hu-stock-transfer/getStorageBins(" +
                        "reservation='" + encodeURIComponent(sRes) + "'," +
                        "item='" + encodeURIComponent(sItem) + "')";
                    return ODataClient.get(sBinsUrl).then(function (binsRes) {
                        var aBins = (binsRes && binsRes.value) ? binsRes.value : (binsRes || []);
                        that._processBackendData(oCockpitData, aBins);
                    });
                }

                that._processBackendData(oCockpitData, aRackData);
            }).catch(function (err) {
                oViewModel.setProperty("/busy", false);
                MessageBox.error("Failed to load visual rack data: " + (err && err.message ? err.message : String(err)));
            });
        },

        _processBackendData: function (oCockpit, aQuants) {
            var oViewModel = this.getModel("rackView");
            this._aAllQuants = Array.isArray(aQuants) ? aQuants : [];

            var sMat = oCockpit.Material || (this._aAllQuants[0] && this._aAllQuants[0].Material) || "";
            var sDesc = oCockpit.MaterialDescription || (this._aAllQuants[0] && this._aAllQuants[0].MaterialDescription) || "Warehouse Material";
            var sWhse = oCockpit.Warehouse || (this._aAllQuants[0] && this._aAllQuants[0].Warehouse) || "W01";

            oViewModel.setProperty("/materialNumber", sMat);
            oViewModel.setProperty("/materialDesc", sDesc);
            oViewModel.setProperty("/warehouse", sWhse);

            // 1. Build distinct Storage Types
            var mTypes = {};
            var aTypes = [{ key: "", text: this.getText("rackAllStgTypes", null, "All Storage Types") }];
            if (oCockpit.PreferredStorageType) {
                mTypes[oCockpit.PreferredStorageType] = true;
                aTypes.push({
                    key: oCockpit.PreferredStorageType,
                    text: oCockpit.PreferredStorageType + " (Preferred)"
                });
            }
            this._aAllQuants.forEach(function (q) {
                var st = q.StorageType;
                if (st && !mTypes[st]) {
                    mTypes[st] = true;
                    aTypes.push({
                        key: st,
                        text: st + (q.StorageTypeDesc ? " - " + q.StorageTypeDesc : "")
                    });
                }
            });
            oViewModel.setProperty("/storageTypes", aTypes);
            oViewModel.setProperty("/selectedStorageType", "");

            // 2. Build distinct Racks
            var mRacks = {};
            var aRacks = [];
            this._aAllQuants.forEach(function (q) {
                var sRack = q.RackNumber || (q.ActualStorageBin && q.ActualStorageBin.split("-")[0]) || "01";
                if (!mRacks[sRack]) {
                    mRacks[sRack] = true;
                    aRacks.push({
                        rackId: sRack,
                        label: "Rack " + sRack
                    });
                }
            });
            if (aRacks.length === 0) {
                aRacks.push({ rackId: "01", label: "Rack 01" });
            }
            oViewModel.setProperty("/racks", aRacks);
            oViewModel.setProperty("/selectedRack", aRacks[0].rackId);

            this._rebuildRackView();
        },

        _rebuildRackView: function () {
            var oViewModel = this.getModel("rackView");
            var sSelectedStg = oViewModel.getProperty("/selectedStorageType") || "";
            var sSelectedRack = oViewModel.getProperty("/selectedRack") || "01";
            var aRacks = oViewModel.getProperty("/racks") || [];

            // Update rack pagination states
            var iRackIdx = 0;
            for (var r = 0; r < aRacks.length; r++) {
                if (aRacks[r].rackId === sSelectedRack) {
                    iRackIdx = r;
                    break;
                }
            }
            oViewModel.setProperty("/hasPrevRack", iRackIdx > 0);
            oViewModel.setProperty("/hasNextRack", iRackIdx < aRacks.length - 1);
            oViewModel.setProperty("/rackTitle", this.getText("rackSelectiveModelTitle", [sSelectedRack], "Selective Pallet Rack (Rack " + sSelectedRack + ")"));

            // Filter quants
            var aActiveQuants = this._aAllQuants.filter(function (q) {
                var matchStg = !sSelectedStg || q.StorageType === sSelectedStg;
                var sQRack = q.RackNumber || (q.ActualStorageBin && q.ActualStorageBin.split("-")[0]) || "01";
                var matchRack = !sSelectedRack || sQRack === sSelectedRack;
                return matchStg && matchRack;
            });

            // Map quants into 10 slots
            var mSlotQuants = {};
            SLOT_CONFIGS.forEach(function (cfg) {
                mSlotQuants[cfg.key] = [];
            });

            // Place quants that match level and bay
            var aUnassigned = [];
            aActiveQuants.forEach(function (q) {
                var iLvl = q.LevelNumber;
                if (typeof iLvl !== "number" || isNaN(iLvl)) {
                    var matchDigits = (q.ActualStorageBin || q.StorageBin || "").match(/\d+/g);
                    if (matchDigits && matchDigits[1]) {
                        iLvl = parseInt(matchDigits[1], 10);
                    } else {
                        iLvl = 1;
                    }
                }
                if (iLvl < 1) iLvl = 1;
                if (iLvl > 5) iLvl = 5;

                var iBay = 1;
                var sPos = q.BinPosition || (q.ActualStorageBin && q.ActualStorageBin.slice(-2)) || "01";
                var iPosNum = parseInt(sPos, 10);
                if (!isNaN(iPosNum) && iPosNum % 2 === 0) {
                    iBay = 2;
                }

                var sKey = "L" + iLvl + "-B" + iBay;
                if (mSlotQuants[sKey] && mSlotQuants[sKey].length < 2) {
                    mSlotQuants[sKey].push(q);
                } else {
                    aUnassigned.push(q);
                }
            });

            // If any unassigned remain, fill any remaining slots with capacity
            if (aUnassigned.length > 0) {
                SLOT_CONFIGS.forEach(function (cfg) {
                    while (aUnassigned.length > 0 && mSlotQuants[cfg.key].length < 2) {
                        mSlotQuants[cfg.key].push(aUnassigned.shift());
                    }
                });
            }

            var oSlotsData = {};
            var iOccupiedCount = 0;
            var that = this;

            SLOT_CONFIGS.forEach(function (cfg) {
                var aItems = mSlotQuants[cfg.key] || [];
                var bHasStock = aItems.length > 0;
                if (bHasStock) {
                    iOccupiedCount++;
                }

                var bSelected = (cfg.key === that._sSelectedSlotKey);

                var sSectionClass = "rackSectionBox " + (bHasStock ? ("rackZone" + cfg.zoneColor) : "rackZoneEmpty") +
                    (bSelected ? " rackSectionBoxActive" : "");
                var sBadgeClass = bHasStock ? ("rackBadge" + cfg.zoneColor) : "rackBadgeEmpty";
                var sBeamClass = "rackBeam" + cfg.zoneColor;

                var sActualBin = (aItems[0] && (aItems[0].ActualStorageBin || aItems[0].StorageBin)) ||
                    (sSelectedRack + "-0" + cfg.level + "-0" + cfg.bay);

                var oCarton1 = that._buildCartonData(aItems[0], cfg.zoneColor, sActualBin);
                var oCarton2 = that._buildCartonData(aItems[1], cfg.zoneColor, sActualBin);

                oSlotsData[cfg.prop] = {
                    slotKey: cfg.key,
                    levelNumber: cfg.level,
                    bayNumber: cfg.bay,
                    levelTitle: "LEVEL " + cfg.level,
                    badgeText: cfg.badgeText,
                    hasStock: bHasStock,
                    sectionClass: sSectionClass,
                    badgeClass: sBadgeClass,
                    beamClass: sBeamClass,
                    binTag: sActualBin,
                    carton1: oCarton1,
                    carton2: oCarton2,
                    items: aItems
                };
            });

            oViewModel.setProperty("/slots", oSlotsData);
            oViewModel.setProperty("/occupiedBinsCount", String(iOccupiedCount));
            oViewModel.setProperty("/availableBinsCount", String(10 - iOccupiedCount));

            // Select active slot
            this._updateSelectedSlotView();
        },

        _buildCartonData: function (oQuant, sZoneColor, sDefaultBin) {
            if (!oQuant) {
                return {
                    unitType: "",
                    serialNumber: "",
                    titleText: "-",
                    qtyText: "Empty",
                    sutCode: "",
                    hasSut: false,
                    hasUnit: false,
                    cartonClass: "rackCartonEmpty"
                };
            }

            var sUnit = oQuant.UnitNumber || oQuant.ActualStorageBin || oQuant.StorageBin || sDefaultBin;
            var sQty = (typeof oQuant.AvailableQuantity !== "undefined" ? oQuant.AvailableQuantity : (oQuant.AvailableStock || 0)) +
                " " + (oQuant.BaseUnit || "PC");

            return {
                unitType: oQuant.UnitType || oQuant.UnitCategory || "HU",
                serialNumber: oQuant.SerialNumber || "",
                titleText: sUnit,
                qtyText: sQty,
                sutCode: oQuant.SutCode || "",
                hasSut: Boolean(oQuant.SutCode),
                hasUnit: Boolean(oQuant.UnitNumber),
                cartonClass: "rackCargoCarton rackCarton" + sZoneColor
            };
        },

        _updateSelectedSlotView: function () {
            var oViewModel = this.getModel("rackView");
            var oSlots = oViewModel.getProperty("/slots") || {};

            // Find matching slot or fallback to first occupied or L5_B1
            var oTargetCfg = null;
            for (var i = 0; i < SLOT_CONFIGS.length; i++) {
                if (SLOT_CONFIGS[i].key === this._sSelectedSlotKey) {
                    oTargetCfg = SLOT_CONFIGS[i];
                    break;
                }
            }
            if (!oTargetCfg) {
                oTargetCfg = SLOT_CONFIGS[0];
                this._sSelectedSlotKey = oTargetCfg.key;
            }

            var oSlot = oSlots[oTargetCfg.prop];
            if (!oSlot) return;

            var aItems = oSlot.items || [];
            var oFirst = aItems[0];
            var sMatNum = oViewModel.getProperty("/materialNumber") || "";
            var sMatDesc = oViewModel.getProperty("/materialDesc") || "";

            var oInspectorData = {
                slotKey: oSlot.slotKey,
                headingText: oSlot.hasStock ?
                    this.getText("rackSlotOccupiedTitle", [oSlot.binTag, oSlot.levelNumber, oSlot.bayNumber], "Bin " + oSlot.binTag + " (Level " + oSlot.levelNumber + " Bay " + oSlot.bayNumber + ")") :
                    this.getText("rackSlotAvailableTitle", null, "Available Bin (Empty)"),
                sectionBadgeText: oSlot.badgeText,
                sectionState: oSlot.hasStock ? "Information" : "None",
                storageSectionDesc: (oFirst && (oFirst.StorageSectionDesc || oFirst.StorageTypeDesc)) || oSlot.badgeText,
                storageType: (oFirst && (oFirst.StorageType + (oFirst.StorageTypeDesc ? " (" + oFirst.StorageTypeDesc + ")" : ""))) || (oViewModel.getProperty("/selectedStorageType") || "001"),
                binType: (oFirst && (oFirst.LevelCode || "B" + oSlot.levelNumber)) || ("B" + oSlot.levelNumber),
                actualStorageBin: oSlot.binTag,
                palletCapacity: "2 Pallets (Euro/Standard)",
                assignedMaterial: oFirst ? (sMatNum + (sMatDesc ? " - " + sMatDesc : "")) : "-",
                unitNumber: (oFirst && oFirst.UnitNumber) || (oSlot.hasStock ? oSlot.binTag : "-"),
                availableStock: (oFirst && (typeof oFirst.AvailableQuantity !== "undefined" ? oFirst.AvailableQuantity : oFirst.AvailableStock) + " " + (oFirst.BaseUnit || "PC")) || "-",
                batch: (oFirst && oFirst.Batch) || "-",
                serialNumber: (oFirst && oFirst.SerialNumber) || "-",
                storageStatus: (oFirst && oFirst.StorageStatus) || (oSlot.hasStock ? "Available" : "Empty"),
                hasUnit: Boolean(oFirst && (oFirst.UnitNumber || oFirst.ActualStorageBin || oFirst.StorageBin))
            };

            oViewModel.setProperty("/selectedSlot", oInspectorData);
            oViewModel.setProperty("/selectedSlotItems", aItems);
        },

        onSelectSlot: function (sSlotKey) {
            if (!sSlotKey) return;
            this._sSelectedSlotKey = sSlotKey;

            var oViewModel = this.getModel("rackView");
            var oSlots = oViewModel.getProperty("/slots") || {};

            // Update active highlight classes on all 10 slots
            SLOT_CONFIGS.forEach(function (cfg) {
                var oS = oSlots[cfg.prop];
                if (oS) {
                    var bSelected = (cfg.key === sSlotKey);
                    var sBaseClass = "rackSectionBox " + (oS.hasStock ? ("rackZone" + cfg.zoneColor) : "rackZoneEmpty");
                    oS.sectionClass = sBaseClass + (bSelected ? " rackSectionBoxActive" : "");
                }
            });

            oViewModel.setProperty("/slots", oSlots);
            this._updateSelectedSlotView();
        },

        onSlotBeamPress: function (oEvent) {
            var oSource = oEvent.getSource();
            var sKey = oSource.data ? oSource.data("slotKey") : null;
            if (!sKey) {
                sKey = oSource.getCustomData ? oSource.getCustomData().reduce(function (acc, cd) {
                    return cd.getKey() === "slotKey" ? cd.getValue() : acc;
                }, null) : null;
            }
            if (sKey) {
                this.onSelectSlot(sKey);
            }
        },

        onSelectSlotUnitForTransfer: function () {
            var oViewModel = this.getModel("rackView");
            var oSlot = oViewModel.getProperty("/selectedSlot");
            var aItems = oViewModel.getProperty("/selectedSlotItems") || [];

            var sUnit = (oSlot && oSlot.unitNumber && oSlot.unitNumber !== "-") ? oSlot.unitNumber : "";
            if (!sUnit && aItems[0]) {
                sUnit = aItems[0].UnitNumber || aItems[0].ActualStorageBin || aItems[0].StorageBin;
            }

            if (!sUnit) {
                MessageToast.show(this.getText("rackNoUnitSelected", null, "No unit selected in this bin"));
                return;
            }

            this._handoffUnitToCockpit(sUnit);
        },

        onSelectRowUnit: function (oEvent) {
            var oItem = oEvent.getSource ? oEvent.getSource().getParent() : null;
            if (!oItem || !oItem.getBindingContext) return;
            var oCtx = oItem.getBindingContext("rackView");
            if (!oCtx) return;

            var sUnit = oCtx.getProperty("UnitNumber") || oCtx.getProperty("ActualStorageBin") || oCtx.getProperty("StorageBin");
            if (!sUnit) {
                MessageToast.show(this.getText("rackNoUnitSelected", null, "No unit selected in this bin"));
                return;
            }

            this._handoffUnitToCockpit(sUnit);
        },

        _handoffUnitToCockpit: function (sUnitNumber) {
            var oShared = this.getOwnerComponent().getModel("cockpitShared");
            if (!oShared) {
                oShared = new JSONModel();
                this.getOwnerComponent().setModel(oShared, "cockpitShared");
            }
            oShared.setProperty("/preselectedUnit", sUnitNumber);

            MessageToast.show(this.getText("rackUnitSelectedToast", [sUnitNumber], "Unit " + sUnitNumber + " selected for transfer"));
            this.onNavBackToCockpit();
        },

        onPrevRack: function () {
            var oViewModel = this.getModel("rackView");
            var aRacks = oViewModel.getProperty("/racks") || [];
            var sCurrent = oViewModel.getProperty("/selectedRack");
            for (var i = 0; i < aRacks.length; i++) {
                if (aRacks[i].rackId === sCurrent && i > 0) {
                    oViewModel.setProperty("/selectedRack", aRacks[i - 1].rackId);
                    this._rebuildRackView();
                    break;
                }
            }
        },

        onNextRack: function () {
            var oViewModel = this.getModel("rackView");
            var aRacks = oViewModel.getProperty("/racks") || [];
            var sCurrent = oViewModel.getProperty("/selectedRack");
            for (var i = 0; i < aRacks.length; i++) {
                if (aRacks[i].rackId === sCurrent && i < aRacks.length - 1) {
                    oViewModel.setProperty("/selectedRack", aRacks[i + 1].rackId);
                    this._rebuildRackView();
                    break;
                }
            }
        },

        onRackSelectChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                this.getModel("rackView").setProperty("/selectedRack", oItem.getKey());
                this._rebuildRackView();
            }
        },

        onStorageTypeChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                this.getModel("rackView").setProperty("/selectedStorageType", oItem.getKey());
                this._rebuildRackView();
            }
        },

        onNavBackToCockpit: function () {
            var oViewModel = this.getModel("rackView");
            var sRes = oViewModel.getProperty("/reservationNo") || "";
            var sItem = oViewModel.getProperty("/reservationItem") || "1";

            this.getRouter().navTo("wmHuStockTransferDetail", {
                reservation: sRes,
                item: sItem
            });
        }
    });
});
