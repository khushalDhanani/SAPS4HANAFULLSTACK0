sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast, MessageBox) {
    "use strict";

    var LEVEL_ZONE_CONFIGS = {
        6: { levelCode: "B6", zoneColor: "Pink", badgeText: "HAZARD / CORROSIVE", shelfDesc: "6th Shelf Level (Top)" },
        5: { levelCode: "B5", zoneColor: "Pink", badgeText: "HAZARD / CORROSIVE", shelfDesc: "5th Shelf Level (Upper)" },
        4: { levelCode: "B4", zoneColor: "Green", badgeText: "FAST-MOVING", shelfDesc: "4th Shelf Level (Mid-High)" },
        3: { levelCode: "B3", zoneColor: "Green", badgeText: "FAST-MOVING", shelfDesc: "3rd Shelf Level (Mid)" },
        2: { levelCode: "B2", zoneColor: "Blue", badgeText: "COLD STORAGE", shelfDesc: "2nd Shelf Level (Lower)" },
        1: { levelCode: "B1", zoneColor: "Orange", badgeText: "PRIORITY OUTBOUND", shelfDesc: "1st Shelf Level (Ground)" },
        0: { levelCode: "B0", zoneColor: "Orange", badgeText: "BUFFER / RECEIVING", shelfDesc: "Ground Floor (B0)" }
    };

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferRack", {

        onInit: function () {
            this._aAllQuants = [];
            this._sSelectedSlotKey = "L6-B1";

            var oViewModel = new JSONModel({
                busy: false,
                reservationNo: "",
                reservationItem: "1",
                materialNumber: "",
                materialBadgeText: "MATERIAL",
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
                rackTitle: "Rack L0001",
                rackCounterInfo: "Rack 1 of 1 (001)",
                tableGridBins: [],
                allTableGridBins: [],
                totalBinsCount: "14",
                occupiedBinsCount: "0",
                availableBinsCount: "14",
                binsHintText: "14 Bins per Rack (7 Levels × 2 Bays)",
                baysHeader: [
                    { bayNumber: 1, label: "BAY 1" },
                    { bayNumber: 2, label: "BAY 2" }
                ],
                selectedSlot: null,
                selectedSlotItems: [],
                slots: {},
                tiers: []
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
            this._sSelectedSlotKey = "L6-B1";

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
            oViewModel.setProperty("/materialBadgeText", sMat ? ("[MATERIAL " + sMat + "]") : "[MATERIAL]");
            oViewModel.setProperty("/materialDesc", sDesc);
            oViewModel.setProperty("/warehouse", sWhse);
            this._oCockpitData = oCockpit;

            // 1. Build distinct Storage Types
            var mTypes = {};
            var aTypes = [];
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
            aTypes.push({ key: "", text: this.getText("rackAllStgTypes", null, "All Storage Types") });
            oViewModel.setProperty("/storageTypes", aTypes);

            // Default to Preferred Storage Type if available
            var sInitialStg = oCockpit.PreferredStorageType || "";
            oViewModel.setProperty("/selectedStorageType", sInitialStg);

            // 2. Build distinct Racks based on quants or cockpit available unit count
            var mRacks = {};
            var aRacks = [];
            this._aAllQuants.forEach(function (q) {
                var sRack = q.RackNumber || (q.ActualStorageBin && q.ActualStorageBin.split("-")[0]);
                if (sRack && sRack !== "TRANSFER" && !mRacks[sRack]) {
                    mRacks[sRack] = true;
                    aRacks.push({
                        rackId: sRack,
                        label: "Rack " + sRack
                    });
                }
            });

            // If no racks were found, default to reference structure Rack L0001
            if (aRacks.length === 0) {
                mRacks["L0001"] = true;
                aRacks.push({
                    rackId: "L0001",
                    label: "Rack L0001"
                });
            }

            // Ensure rack count reflects available unit count from cockpit (e.g. 3 available units = 3 racks)
            var iExpectedRacks = (typeof oCockpit.AvailableUnitCount === "number" && oCockpit.AvailableUnitCount > 0) ?
                oCockpit.AvailableUnitCount :
                (aRacks.length > 0 ? aRacks.length : 1);

            if (aRacks.length < iExpectedRacks) {
                for (var r = 1; r <= iExpectedRacks; r++) {
                    var sFallbackRack = "L000" + r;
                    if (!mRacks[sFallbackRack]) {
                        mRacks[sFallbackRack] = true;
                        aRacks.push({
                            rackId: sFallbackRack,
                            label: "Rack " + sFallbackRack
                        });
                    }
                }
            }
            aRacks.sort(function (a, b) {
                return a.rackId.localeCompare(b.rackId, undefined, { numeric: true });
            });

            oViewModel.setProperty("/racks", aRacks);
            oViewModel.setProperty("/selectedRack", aRacks[0].rackId);

            this._rebuildRackView();
        },

        _rebuildRackView: function () {
            var oViewModel = this.getModel("rackView");
            var sSelectedStg = oViewModel.getProperty("/selectedStorageType") || "";
            var sSelectedRack = oViewModel.getProperty("/selectedRack") || "L0001";
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
            oViewModel.setProperty("/rackTitle", this.getText("rackSelectiveModelTitle", [sSelectedRack], "Rack " + sSelectedRack));

            // Filter quants
            var aActiveQuants = this._aAllQuants.filter(function (q) {
                var matchStg = !sSelectedStg || q.StorageType === sSelectedStg;
                var sQRack = q.RackNumber || (q.ActualStorageBin && q.ActualStorageBin.split("-")[0]) || "L0001";
                var matchRack = !sSelectedRack || sQRack === sSelectedRack;
                return matchStg && matchRack;
            });

            // Derive active storage type code for rack counter
            var sActiveStg = sSelectedStg ||
                (this._oCockpitData && this._oCockpitData.PreferredStorageType) ||
                (aActiveQuants[0] && aActiveQuants[0].StorageType) ||
                (this._aAllQuants[0] && this._aAllQuants[0].StorageType) ||
                "EN1";
            var iTotalRacks = aRacks.length || 1;
            var sCounterInfo = "Rack " + (iRackIdx + 1) + " of " + iTotalRacks + " (" + sActiveStg + ")";
            oViewModel.setProperty("/rackCounterInfo", sCounterInfo);

            // Extract distinct level numbers and bays from backend quants
            var aParsedLevels = [];
            var mSeenLevel = {};
            var aParsedBays = [];
            var mSeenBay = {};

            aActiveQuants.forEach(function (q) {
                // Determine level number
                var lvl = q.LevelNumber;
                if (typeof lvl !== "number" || isNaN(lvl)) {
                    if (q.LevelCode && /^B(\d+)$/i.test(q.LevelCode)) {
                        lvl = parseInt(q.LevelCode.replace(/\D/g, ""), 10);
                    } else {
                        var matchDigits = (q.ActualStorageBin || q.StorageBin || "").match(/\d+/g);
                        if (matchDigits && matchDigits.length >= 2) {
                            var candidate = parseInt(matchDigits[1], 10);
                            if (candidate >= 0 && candidate <= 10) {
                                lvl = candidate;
                            }
                        }
                    }
                }
                if (typeof lvl === "number" && !isNaN(lvl)) {
                    q._computedLevel = lvl;
                    if (!mSeenLevel[lvl]) {
                        mSeenLevel[lvl] = true;
                        aParsedLevels.push(lvl);
                    }
                }

                // Determine bay number
                var iBay = 1;
                if (q.BinPosition) {
                    var numBay = parseInt(q.BinPosition, 10);
                    if (!isNaN(numBay) && numBay > 0) {
                        iBay = numBay;
                    }
                } else if (q.ActualStorageBin || q.StorageBin) {
                    var matchBayDigits = (q.ActualStorageBin || q.StorageBin).match(/\d+/g);
                    if (matchBayDigits && matchBayDigits.length >= 3) {
                        var candidateBay = parseInt(matchBayDigits[2], 10);
                        if (!isNaN(candidateBay) && candidateBay > 0) {
                            iBay = candidateBay;
                        }
                    }
                }
                q._computedBay = iBay;
                if (!mSeenBay[iBay]) {
                    mSeenBay[iBay] = true;
                    aParsedBays.push(iBay);
                }
            });

            // Determine dynamic levels:
            // The reference image contains B0–B6 levels. Preserve this structure when actual rack data represents it.
            // Do not assume every rack has exactly seven levels.
            var aLevels = [];
            var bHasLevel6Or0 = mSeenLevel[6] || mSeenLevel[0] || aActiveQuants.some(function (q) {
                return (q.LevelCode === "B6" || q.LevelCode === "B0" ||
                    (q.ShelfLevelDesc && (q.ShelfLevelDesc.includes("B0") || q.ShelfLevelDesc.includes("B6"))));
            });

            if (bHasLevel6Or0 || aParsedLevels.length === 0) {
                // Reference structure: 7 levels (LEVEL 6 down to LEVEL 0)
                aLevels = [6, 5, 4, 3, 2, 1, 0];
            } else {
                // Dynamic levels from backend data
                var iMinLvl = Math.min.apply(null, aParsedLevels);
                var iMaxLvl = Math.max.apply(null, aParsedLevels);
                if (iMinLvl > 1) {
                    iMinLvl = 1;
                }
                for (var l = iMaxLvl; l >= iMinLvl; l--) {
                    aLevels.push(l);
                }
            }

            // Determine dynamic bays:
            aParsedBays.sort(function (a, b) { return a - b; });
            var aBays = aParsedBays.length > 0 ? aParsedBays : [1, 2];
            if (aBays.length === 1 && aBays[0] === 1) {
                aBays = [1, 2];
            }

            var aBaysHeader = aBays.map(function (iBay) {
                return {
                    bayNumber: iBay,
                    label: "BAY " + iBay
                };
            });
            oViewModel.setProperty("/baysHeader", aBaysHeader);

            // Map quants into slots
            var mSlotQuants = {};
            aLevels.forEach(function (lvl) {
                aBays.forEach(function (iBay) {
                    mSlotQuants["L" + lvl + "-B" + iBay] = [];
                });
            });

            var aUnassigned = [];
            aActiveQuants.forEach(function (q) {
                var lvl = typeof q._computedLevel === "number" ? q._computedLevel : aLevels[0];
                var iBay = typeof q._computedBay === "number" ? q._computedBay : aBays[0];
                var sKey = "L" + lvl + "-B" + iBay;
                if (mSlotQuants[sKey] && mSlotQuants[sKey].length < 2) {
                    mSlotQuants[sKey].push(q);
                } else {
                    aUnassigned.push(q);
                }
            });

            // Distribute any unassigned quants into available slots
            if (aUnassigned.length > 0) {
                aLevels.forEach(function (lvl) {
                    aBays.forEach(function (iBay) {
                        var sKey = "L" + lvl + "-B" + iBay;
                        while (aUnassigned.length > 0 && mSlotQuants[sKey].length < 2) {
                            mSlotQuants[sKey].push(aUnassigned.shift());
                        }
                    });
                });
            }

            // Build hierarchical data-driven structure:
            // Warehouse -> Storage Type -> Rack -> Level/Tier -> Bay -> Storage Bin -> Slot -> HU/SU
            var aTiersData = [];
            var oSlotsData = {};
            var iOccupiedCount = 0;
            var that = this;

            aLevels.forEach(function (lvl) {
                var lvlDef = LEVEL_ZONE_CONFIGS[lvl] || {
                    levelCode: "B" + lvl,
                    zoneColor: lvl >= 5 ? "Pink" : lvl >= 3 ? "Green" : lvl === 2 ? "Blue" : "Orange",
                    badgeText: lvl >= 5 ? "HAZARD / CORROSIVE" : lvl >= 3 ? "FAST-MOVING" : lvl === 2 ? "COLD STORAGE" : "PRIORITY OUTBOUND",
                    shelfDesc: "Shelf Level " + lvl + " (B" + lvl + ")"
                };

                var aBaysData = [];
                aBays.forEach(function (iBay) {
                    var sKey = "L" + lvl + "-B" + iBay;
                    var sProp = "L" + lvl + "_B" + iBay;
                    var aItems = mSlotQuants[sKey] || [];
                    var bHasStock = aItems.length > 0;
                    if (bHasStock) {
                        iOccupiedCount++;
                    }

                    var bSelected = (sKey === that._sSelectedSlotKey);

                    var sSectionClass = "rackSectionBox " + (bHasStock ? ("rackZone" + lvlDef.zoneColor) : "rackZoneEmpty") +
                        (bSelected ? " rackSectionBoxActive" : "");
                    var sBadgeClass = bHasStock ? ("rackBadge" + lvlDef.zoneColor) : "rackBadgeEmpty";
                    var sBeamClass = "rackStepBeam rackBeam" + lvlDef.zoneColor;

                    var sActualBin = (aItems[0] && (aItems[0].ActualStorageBin || aItems[0].StorageBin)) ||
                        (sSelectedRack + "-0" + lvl + "-0" + iBay);

                    // Build 2 pallet slots per storage bin
                    var oCarton1 = that._buildCartonData(aItems[0], lvlDef.zoneColor, sActualBin, 1);
                    var oCarton2 = that._buildCartonData(aItems[1], lvlDef.zoneColor, sActualBin, 2);

                    var oBayData = {
                        slotKey: sKey,
                        levelNumber: lvl,
                        levelCode: lvlDef.levelCode,
                        bayNumber: iBay,
                        levelTitle: "LEVEL " + lvl,
                        badgeText: lvlDef.badgeText,
                        hasStock: bHasStock,
                        sectionClass: sSectionClass,
                        badgeClass: sBadgeClass,
                        beamClass: sBeamClass,
                        binTag: sActualBin,
                        actualStorageBin: sActualBin,
                        storageType: sActiveStg,
                        rackId: sSelectedRack,
                        warehouse: oViewModel.getProperty("/warehouse") || "W01",
                        shelfLevelDesc: lvlDef.shelfDesc,
                        zoneColor: lvlDef.zoneColor,
                        carton1: oCarton1,
                        carton2: oCarton2,
                        slots: [oCarton1, oCarton2],
                        items: aItems
                    };

                    aBaysData.push(oBayData);
                    oSlotsData[sKey] = oBayData;
                    oSlotsData[sProp] = oBayData;
                });

                aTiersData.push({
                    levelNumber: lvl,
                    levelCode: lvlDef.levelCode,
                    levelTitle: "LEVEL " + lvl,
                    zoneColor: lvlDef.zoneColor,
                    badgeText: lvlDef.badgeText,
                    shelfDesc: lvlDef.shelfDesc,
                    bays: aBaysData
                });
            });

            var iTotalBins = aTiersData.length * aBays.length;
            oViewModel.setProperty("/tiers", aTiersData);
            oViewModel.setProperty("/slots", oSlotsData);
            oViewModel.setProperty("/totalBinsCount", String(iTotalBins));
            oViewModel.setProperty("/occupiedBinsCount", String(iOccupiedCount));
            oViewModel.setProperty("/availableBinsCount", String(iTotalBins - iOccupiedCount));

            var sBinsHint = this.getText("rackDynamicBinsHint", [iTotalBins, aTiersData.length, aBays.length], iTotalBins + " Bins per Rack (" + aTiersData.length + " Levels × " + aBays.length + " Bays)");
            oViewModel.setProperty("/binsHintText", sBinsHint);

            // Ensure selected slot key is valid
            if (!oSlotsData[this._sSelectedSlotKey]) {
                if (aTiersData.length > 0 && aTiersData[0].bays.length > 0) {
                    this._sSelectedSlotKey = aTiersData[0].bays[0].slotKey;
                }
            }
            this._updateSelectedSlotView();
        },

        _buildCartonData: function (oQuant, sZoneColor, sDefaultBin, iSlotIndex) {
            if (!oQuant) {
                return {
                    slotIndex: iSlotIndex || 1,
                    unitType: "",
                    serialNumber: "",
                    titleText: "-",
                    qtyText: "Empty",
                    sutCode: "",
                    hasSut: false,
                    hasUnit: false,
                    batch: "",
                    storageStatus: "Empty",
                    cartonClass: "rackCargoCarton rackCartonEmpty"
                };
            }

            var sUnit = oQuant.UnitNumber || oQuant.ActualStorageBin || oQuant.StorageBin || sDefaultBin;
            var sQty = (typeof oQuant.AvailableQuantity !== "undefined" ? oQuant.AvailableQuantity : (oQuant.AvailableStock || 0)) +
                " " + (oQuant.BaseUnit || "PC");

            return {
                slotIndex: iSlotIndex || 1,
                unitType: oQuant.UnitType || oQuant.UnitCategory || "HU",
                serialNumber: oQuant.SerialNumber || "",
                titleText: sUnit,
                unitNumber: sUnit,
                qtyText: sQty,
                sutCode: oQuant.SutCode || "",
                hasSut: Boolean(oQuant.SutCode),
                hasUnit: Boolean(oQuant.UnitNumber),
                batch: oQuant.Batch || "",
                storageStatus: oQuant.StorageStatus || "Available",
                cartonClass: "rackCargoCarton rackCarton" + sZoneColor
            };
        },

        _updateSelectedSlotView: function () {
            var oViewModel = this.getModel("rackView");
            var oSlots = oViewModel.getProperty("/slots") || {};

            var oSlot = oSlots[this._sSelectedSlotKey] || oSlots[this._sSelectedSlotKey.replace("-", "_")];
            if (!oSlot) {
                var aKeys = Object.keys(oSlots);
                if (aKeys.length > 0) {
                    oSlot = oSlots[aKeys[0]];
                    if (oSlot) {
                        this._sSelectedSlotKey = oSlot.slotKey;
                    }
                }
            }
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
            var aTiers = oViewModel.getProperty("/tiers") || [];
            var oSlots = oViewModel.getProperty("/slots") || {};

            // Update active highlight classes on all bays in tiers
            aTiers.forEach(function (tier) {
                (tier.bays || []).forEach(function (bay) {
                    var bSelected = (bay.slotKey === sSlotKey);
                    var sBaseClass = "rackSectionBox " + (bay.hasStock ? ("rackZone" + bay.zoneColor) : "rackZoneEmpty");
                    bay.sectionClass = sBaseClass + (bSelected ? " rackSectionBoxActive" : "");
                });
            });

            // Update map entries
            Object.keys(oSlots).forEach(function (k) {
                var oS = oSlots[k];
                if (oS && oS.slotKey) {
                    var bSelected = (oS.slotKey === sSlotKey);
                    var sBaseClass = "rackSectionBox " + (oS.hasStock ? ("rackZone" + oS.zoneColor) : "rackZoneEmpty");
                    oS.sectionClass = sBaseClass + (bSelected ? " rackSectionBoxActive" : "");
                }
            });

            oViewModel.setProperty("/tiers", aTiers);
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

        onOpenTableGrid: function () {
            var oViewModel = this.getModel("rackView");
            var sRes = oViewModel.getProperty("/reservationNo");
            var sItem = oViewModel.getProperty("/reservationItem") || "1";
            var that = this;

            oViewModel.setProperty("/busy", true);

            var sUrl = "/odata/v4/hu-stock-transfer/getStorageBins(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            ODataClient.get(sUrl).then(function (data) {
                oViewModel.setProperty("/busy", false);
                var aBins = (data && data.value) ? data.value : (data || []);
                oViewModel.setProperty("/allTableGridBins", aBins);
                oViewModel.setProperty("/tableGridBins", aBins);

                if (!that._pTableGridDialog) {
                    that._pTableGridDialog = Fragment.load({
                        id: that.getView().getId(),
                        name: "saps4hana.fiori.modules.wm.hu-stock-transfer.view.fragment.TableGridDialog",
                        controller: that
                    }).then(function (oDialog) {
                        that.getView().addDependent(oDialog);
                        return oDialog;
                    });
                }

                that._pTableGridDialog.then(function (oDialog) {
                    oDialog.open();
                });
            }).catch(function (err) {
                oViewModel.setProperty("/busy", false);
                MessageBox.error("Failed to load storage bins for table grid: " + (err && err.message ? err.message : String(err)));
            });
        },

        onSearchTableGrid: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var oViewModel = this.getModel("rackView");
            var aAll = oViewModel.getProperty("/allTableGridBins") || [];

            if (!sQuery.trim()) {
                oViewModel.setProperty("/tableGridBins", aAll);
                return;
            }

            var sLower = sQuery.toLowerCase();
            var aFiltered = aAll.filter(function (it) {
                return (it.UnitNumber && it.UnitNumber.toLowerCase().includes(sLower)) ||
                       (it.StorageBin && it.StorageBin.toLowerCase().includes(sLower)) ||
                       (it.ActualStorageBin && it.ActualStorageBin.toLowerCase().includes(sLower)) ||
                       (it.StorageType && it.StorageType.toLowerCase().includes(sLower)) ||
                       (it.Batch && it.Batch.toLowerCase().includes(sLower)) ||
                       (it.SutCode && it.SutCode.toLowerCase().includes(sLower));
            });
            oViewModel.setProperty("/tableGridBins", aFiltered);
        },

        onCloseTableGridDialog: function () {
            if (this._pTableGridDialog) {
                this._pTableGridDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onSelectTableGridItem: function (oEvent) {
            var oItem = (oEvent && typeof oEvent.getParameter === "function" && oEvent.getParameter("listItem")) ||
                        (oEvent && oEvent.getSource ? oEvent.getSource() : null);
            if (!oItem || typeof oItem.getBindingContext !== "function") return;
            var oCtx = oItem.getBindingContext("rackView");
            if (!oCtx) return;

            var sUnit = oCtx.getProperty("UnitNumber") || oCtx.getProperty("StorageBin") || oCtx.getProperty("ActualStorageBin");
            if (sUnit) {
                this.onCloseTableGridDialog();
                this._handoffUnitToCockpit(sUnit);
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
