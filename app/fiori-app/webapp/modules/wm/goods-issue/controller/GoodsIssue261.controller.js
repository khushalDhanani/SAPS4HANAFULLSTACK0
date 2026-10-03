sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/wm/goods-issue/model/GoodsIssue261Model",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue261Service"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    Filter,
    FilterOperator,
    GoodsIssue261Model,
    GoodsIssue261Service
) {
    "use strict";

    function resolvePostingStatus(oResult) {
        if (!oResult || typeof oResult !== "object") {
            return "FAILED";
        }

        var sStatus = String(oResult.PostingStatus || "").trim().toUpperCase();
        if (sStatus === "POSTED") return oResult.MaterialDocument ? "POSTED" : "UNKNOWN";
        if (sStatus === "QUEUED" || sStatus === "FAILED" || sStatus === "UNKNOWN") return sStatus;

        var sConfirmation = String(oResult.ConfirmationStatus || "").trim().toUpperCase();
        if (oResult.Queued === true || sConfirmation === "QUEUED") return "QUEUED";
        if (oResult.MaterialDocument && (oResult.Confirmed === true || sConfirmation === "CONFIRMED")) return "POSTED";
        if (oResult.MaterialDocument || oResult.Confirmed === false || oResult.Success === true ||
            sConfirmation === "POSTING" || sConfirmation === "UNCONFIRMED" ||
            sConfirmation === "POSTED_CONFIRMATION_PENDING") {
            return "UNKNOWN";
        }
        return "FAILED";
    }

    function resolveErrorPostingStatus(oError) {
        var oApiError = oError && oError.response && oError.response.data && oError.response.data.error;
        var sCode = String((oApiError && oApiError.code) || (oError && oError.code) || "").toUpperCase();
        var sMessage = String((oApiError && oApiError.message) || (oError && oError.message) || "");
        if (sCode === "GI_POSTING_UNKNOWN" || sCode === "GI_POSTING_OUTCOME_UNKNOWN" ||
            sCode === "GI_POSTING_UNCONFIRMED" || /outcome unconfirmed|do not post again|may have been posted/i.test(sMessage)) {
            return "UNKNOWN";
        }
        return "FAILED";
    }

    function normalizeSapIdentifier(value) {
        var sValue = value == null ? "" : String(value).trim();
        return sValue.replace(/^0+/, "") || (sValue ? "0" : "");
    }

    function isSapTrue(value) {
        return value === true || String(value).trim().toLowerCase() === "true";
    }

    function eligible261ReservationItems(aItems, sReservationNo) {
        var sExpectedReservation = normalizeSapIdentifier(sReservationNo);
        return (Array.isArray(aItems) ? aItems : []).filter(function (oItem) {
            var nOpenQty = Number(oItem && oItem.OpenQty);
            return oItem &&
                normalizeSapIdentifier(oItem.ReservationNo) === sExpectedReservation &&
                String(oItem.MovementType || "").trim() === "261" &&
                Number.isFinite(nOpenQty) && nOpenQty > 0 &&
                !isSapTrue(oItem.ReservationItemIsFinallyIssued) &&
                !isSapTrue(oItem.ReservationItmIsMarkedForDeltn) &&
                !isSapTrue(oItem.IsFinallyIssued) &&
                !isSapTrue(oItem.IsDeleted);
        });
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue261", {

        onInit: function () {
            this._oModel = GoodsIssue261Model.createInitialModel();
            this.getView().setModel(this._oModel, "gi261");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue261").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function (oEvent) {
            this._resetModel();
            var oArgs = oEvent && oEvent.getParameter("arguments");
            var oQuery = oArgs && oArgs["?query"];
            var sResv = oQuery && (oQuery.resv || oQuery.reservation);
            var sItem = oQuery && (oQuery.item || oQuery.reservationItem);
            if (sResv) {
                this._prefillFromReservation(sResv, sItem);
            }
        },

        _resetModel: function () {
            var oInitData = GoodsIssue261Model.getInitialData();
            this._oModel.setData(oInitData);
            this._aResolvedItems = [];
            this._validateLive();
        },

        /**
         * Pre-fill the 261 review and complete form from an open reservation item.
         * Material, plant, storage location, unit, open quantity, and Order (OrderID)
         * are sourced directly from the reservation item — with no separate Order API call.
         */
        _prefillFromReservation: function (sResv, sItemParam) {
            var that = this;
            var oModel = this._oModel;
            oModel.setProperty("/busy", true);
            return GoodsIssue261Service.fetchReservationItems(sResv)
                .then(function (aItems) {
                    var aEligibleItems = eligible261ReservationItems(aItems, sResv);
                    that._aResolvedItems = aEligibleItems;
                    var oItem = null;
                    if (sItemParam) {
                        var sExpectedItem = normalizeSapIdentifier(sItemParam);
                        oItem = aEligibleItems.find(function (oCandidate) {
                            return normalizeSapIdentifier(oCandidate.ReservationItem) === sExpectedItem;
                        }) || null;
                        if (!oItem) {
                            MessageBox.error(that.getText("gi261PrefillNoOpenItem", [sResv]));
                            return;
                        }
                    } else if (aEligibleItems.length === 1) {
                        oItem = aEligibleItems[0];
                    } else if (aEligibleItems.length > 1) {
                        oModel.setProperty("/fromReservation", true);
                        oModel.setProperty("/reservationNo", sResv);
                        that._openReservationItemPicker();
                        return;
                    }
                    if (!oItem) {
                        MessageBox.error(that.getText("gi261PrefillNoOpenItem", [sResv]));
                        return;
                    }
                    oModel.setProperty("/fromReservation", true);
                    that._applyReservationPrefill(oItem, sResv);
                })
                .catch(function (err) {
                    MessageBox.error((err && err.message) || that.getText("gi261PrefillError"));
                })
                .finally(function () {
                    oModel.setProperty("/busy", false);
                });
        },

        _applyReservationPrefill: function (oItem, sReservationNo) {
            var oModel = this._oModel;
            var sResv = oItem.ReservationNo || sReservationNo;
            var sItem = oItem.ReservationItem == null ? "" : String(oItem.ReservationItem).trim().padStart(4, "0");
            var nOpen = Number(oItem.OpenQty);

            oModel.setProperty("/reservationNo", sResv);
            oModel.setProperty("/reservationItem", sItem);
            oModel.setProperty("/orderNo", oItem.OrderNo || "");
            oModel.setProperty("/material", oItem.Material || "");
            oModel.setProperty("/materialName", oItem.MaterialDesc || "");
            oModel.setProperty("/plant", oItem.Plant || "");
            oModel.setProperty("/storageLocation", oItem.StorageLocation || "");
            oModel.setProperty("/quantity", nOpen);
            oModel.setProperty("/openQty", nOpen);
            if (oItem.Unit) {
                oModel.setProperty("/unit", oItem.Unit);
            }
            this._loadMaterialInfo(oItem.Material || "", oItem.Plant || "");
            this._detectScanMode(sResv, sItem, nOpen);
            this._validateLive();
        },

        /**
         * Detect whether the reservation component is unit-managed (serial or storage unit).
         * If scannable units exist in S/4, enables scan-to-complete mode with pass/fail feedback.
         * Suggests SUs using FIFO/FEFO until required quantity is covered.
         * If no SU data exists: reports gap, allowing non-serial plain quantity confirmation.
         */
        _detectScanMode: function (sResv, sItem, nOpenQty) {
            var that = this;
            var oModel = this._oModel;
            oModel.setProperty("/scanEnabled", false);
            oModel.setProperty("/scannedUnits", []);
            oModel.setProperty("/suggestedUnits", []);
            oModel.setProperty("/suggestedUnitsCount", 0);
            oModel.setProperty("/availableUnits", []);
            oModel.setProperty("/noSuDataGap", "");
            oModel.setProperty("/partialInstruction", "");
            oModel.setProperty("/excludedUnconfirmedNote", "");
            oModel.setProperty("/excludedUnconfirmedCount", 0);
            oModel.setProperty("/lastScanState", "None");
            oModel.setProperty("/lastScanText", "");
            oModel.setProperty("/isStagingRequired", false);
            oModel.setProperty("/targetStorageType", "");
            oModel.setProperty("/targetStorageBin", "");
            oModel.setProperty("/stagedQty", 0);
            oModel.setProperty("/requiredStagingQty", 0);
            oModel.setProperty("/plannedUnconfirmedQty", 0);
            oModel.setProperty("/stagingStatusBadge", "");
            oModel.setProperty("/stagingStatusState", "None");
            oModel.setProperty("/stagingWarning", "");
            oModel.setProperty("/transferRequirement", "");
            oModel.setProperty("/canCompleteStaging", true);
            oModel.setProperty("/plannedUnconfirmedNote", "");
            if (!sResv || !sItem) {
                return;
            }
            GoodsIssue261Service.fetchStockUnitsForItem(sResv, sItem)
                .then(function (oData) {
                    var aUnits = (oData && oData.StockUnits) || [];
                    var nExcludedUnconfirmed = (oData && oData.ExcludedUnconfirmedCount) || 0;
                    oModel.setProperty("/excludedUnconfirmedCount", nExcludedUnconfirmed);
                    if (nExcludedUnconfirmed > 0) {
                        var sExcludedNote = nExcludedUnconfirmed + " Storage Unit(s) excluded due to unconfirmed posting / pending Transfer Order confirmation.";
                        oModel.setProperty("/excludedUnconfirmedNote", sExcludedNote);
                    } else {
                        oModel.setProperty("/excludedUnconfirmedNote", "");
                    }

                    var bStagingRequired = Boolean(oData && oData.IsStagingRequired);
                    var nStagedQty = (oData && Number(oData.StagedQty)) || 0;
                    var nRequiredQty = (oData && Number(oData.RequiredQty)) || (nOpenQty > 0 ? nOpenQty : 0);
                    var nPlannedUnconfirmedQty = (oData && Number(oData.PlannedUnconfirmedQty)) || 0;
                    var sTargetType = (oData && oData.TargetStorageType) || "";
                    var sTargetBin = (oData && oData.TargetStorageBin) || "";
                    var sTbnum = (oData && oData.TransferRequirement) || "";
                    var bIsFullyStaged = Boolean(oData && oData.IsFullyStaged);

                    var sStagingStatus = "Not Staged";
                    var sStagingState = "Error";
                    if (bIsFullyStaged || (!bStagingRequired && nStagedQty >= nRequiredQty)) {
                        sStagingStatus = "Staged";
                        sStagingState = "Success";
                    } else if (nStagedQty > 0) {
                        sStagingStatus = "Partially Staged";
                        sStagingState = "Warning";
                    }

                    var sStagingWarning = "";
                    var bCanComplete = true;
                    if (bStagingRequired && !bIsFullyStaged) {
                        bCanComplete = false;
                        var sUom = oModel.getProperty("/unit") || "PC";
                        var sBinLocation = sTargetType ? sTargetType + "/" + sTargetBin : sTargetBin;
                        sStagingWarning = "Only " + nStagedQty + " of " + nRequiredQty + " " + sUom + " staged in " + sBinLocation + ". Transfer requirement " + (sTbnum || "N/A") + " needs a confirmed transfer order (LT04/LT12) first.";
                    }

                    oModel.setProperty("/isStagingRequired", bStagingRequired);
                    oModel.setProperty("/targetStorageType", sTargetType);
                    oModel.setProperty("/targetStorageBin", sTargetBin);
                    oModel.setProperty("/stagedQty", nStagedQty);
                    oModel.setProperty("/requiredStagingQty", nRequiredQty);
                    oModel.setProperty("/plannedUnconfirmedQty", nPlannedUnconfirmedQty);
                    oModel.setProperty("/stagingStatusBadge", sStagingStatus);
                    oModel.setProperty("/stagingStatusState", sStagingState);
                    oModel.setProperty("/stagingWarning", sStagingWarning);
                    oModel.setProperty("/transferRequirement", sTbnum);
                    oModel.setProperty("/canCompleteStaging", bCanComplete);
                    if (nPlannedUnconfirmedQty > 0) {
                        oModel.setProperty("/plannedUnconfirmedNote", nPlannedUnconfirmedQty + " " + (oModel.getProperty("/unit") || "PC") + " (TO created, not confirmed)");
                    } else {
                        oModel.setProperty("/plannedUnconfirmedNote", "");
                    }

                    if (aUnits.length > 0) {
                        var aSuggested = GoodsIssue261Model.calculateSuggestedUnits(aUnits, nOpenQty > 0 ? nOpenQty : 1);
                        var sPartialInstruction = GoodsIssue261Model.getPartialInstruction(aSuggested);
                        oModel.setProperty("/scanEnabled", true);
                        oModel.setProperty("/requiredScanCount", nOpenQty > 0 ? nOpenQty : 1);
                        oModel.setProperty("/availableUnits", aUnits);
                        oModel.setProperty("/suggestedUnits", aSuggested);
                        oModel.setProperty("/suggestedUnitsCount", aSuggested.length);
                        oModel.setProperty("/partialInstruction", sPartialInstruction);
                        oModel.setProperty("/noSuDataGap", "");
                        // The scan section takes over from the manual serial entry table
                        oModel.setProperty("/isSerialManaged", false);
                    } else {
                        var sGapMsg = (oData && oData.Message) || that.getText("gi261NoSuDataGap", [sResv, sItem]);
                        oModel.setProperty("/noSuDataGap", sGapMsg);
                    }
                })
                .catch(function (err) {
                    var sGapMsg = (err && err.message) || that.getText("gi261NoSuDataGap", [sResv, sItem]);
                    oModel.setProperty("/noSuDataGap", sGapMsg);
                })
                .finally(function () { that._validateLive(); });
        },

        _setScanFeedback: function (sState, sText) {
            this._oModel.setProperty("/lastScanState", sState);
            this._oModel.setProperty("/lastScanText", sText);
        },

        /**
         * Handle one scanned unit barcode: auto-fetch + auto-match against S/4 via resolveStockUnit,
         * show clear pass/fail feedback, and on a match append to scannedUnits. Never a silent fill.
         */
        onScanUnit: function () {
            var that = this;
            var oModel = this._oModel;
            var sBarcode = String(oModel.getProperty("/scanInput") || "").trim();
            if (!sBarcode) {
                return;
            }
            var sResv = oModel.getProperty("/reservationNo");
            var sItem = oModel.getProperty("/reservationItem");
            oModel.setProperty("/scanInput", "");
            GoodsIssue261Service.resolveScanUnit(sBarcode, sResv, sItem)
                .then(function (oRes) {
                    var oData = oModel.getData();
                    if (oRes && !oRes.StorageLocation && Array.isArray(oData.availableUnits)) {
                        var foundSu = oData.availableUnits.find(function (u) {
                            return String(u.StorageUnit || "").trim().toUpperCase() === sBarcode.toUpperCase();
                        });
                        if (foundSu) {
                            oRes.Plant = oRes.Plant || foundSu.Plant;
                            oRes.StorageLocation = oRes.StorageLocation || foundSu.StorageLocation;
                            if (oRes.SuStockQty == null && oRes.CurrentStock == null) {
                                oRes.SuStockQty = foundSu.AvailableStock;
                            }
                        }
                    }
                    var oFb = GoodsIssue261Model.applyScanResolution(oData, oRes, sBarcode);
                    oModel.setProperty("/scannedUnits", oData.scannedUnits);
                    oModel.setProperty("/batch", oData.batch);
                    oModel.setProperty("/isBatchManaged", oData.isBatchManaged);
                    that._setScanFeedback(oFb.state, oFb.text);
                })
                .catch(function (err) {
                    // Hard SAP condition (no open qty, wrong plant, etc.) - surface the real message
                    that._setScanFeedback("Error", (err && err.message) || that.getText("giScanValidateError"));
                })
                .finally(function () { that._validateLive(); });
        },

        onScanSuggestedPress: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource && oSource.getBindingContext("gi261");
            if (!oCtx) return;
            var oSu = oCtx.getObject();
            var sBarcode = oSu && (oSu.StorageUnit || oSu.storageUnit || oSu.barcode || oSu.key);
            if (!sBarcode) return;
            this._oModel.setProperty("/scanInput", sBarcode);
            this.onScanUnit();
        },

        onScanInputSubmit: function () {
            this.onScanUnit();
        },

        onDeleteScannedUnit: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("gi261");
            if (!oCtx) {
                return;
            }
            var iIdx = parseInt(oCtx.getPath().split("/").pop(), 10);
            var aUnits = this._oModel.getProperty("/scannedUnits") || [];
            if (iIdx >= 0 && iIdx < aUnits.length) {
                aUnits.splice(iIdx, 1);
                this._oModel.setProperty("/scannedUnits", aUnits);
                this._setScanFeedback("None", "");
                this._validateLive();
            }
        },

        // =============================================================
        // FORMATTERS
        // =============================================================

        formatSuccessBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this.getText("gi261SuccessBannerText", [sDoc, sYear || ""]);
        },

        formatReversalBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this.getText("gi261ReversalBannerText", [sDoc, sYear || ""]);
        },

        formatOpenQty: function (nQty, sUnit) {
            if (nQty === null || nQty === undefined) return "";
            return nQty + " " + (sUnit || "");
        },

        // =============================================================
        // LIVE VALIDATION
        // =============================================================

        _validateLive: function () {
            var oData = this._oModel.getData();
            var oResult = GoodsIssue261Model.validate(oData);
            this._oModel.setProperty("/scannedQty", GoodsIssue261Model.scannedQty(oData));
            this._oModel.setProperty("/errors", oResult.errors);
            this._oModel.setProperty("/isValid", oResult.isValid);
            return oResult.isValid;
        },

        onFieldLiveChange: function () {
            this._validateLive();
        },

        onQuantityLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value") || "";
            var nVal = parseFloat(sVal);
            this._oModel.setProperty("/quantity", isNaN(nVal) ? sVal : nVal);
            this._validateLive();
        },

        // =============================================================
        // ISSUE MODE (PLANNED VS UNPLANNED) & ORDER VALUE HELP
        // =============================================================

        onIssueModeChange: function (oEvt) {
            var sKey = oEvt.getParameter("item") ? oEvt.getParameter("item").getKey() : oEvt.getParameter("key");
            var bUnplanned = sKey === "UNPLANNED";
            this._oModel.setProperty("/isUnplanned", bUnplanned);
            if (bUnplanned) {
                this._oModel.setProperty("/reservationNo", "");
                this._oModel.setProperty("/reservationItem", "");
                this._oModel.setProperty("/scanEnabled", false);
                this._oModel.setProperty("/scannedUnits", []);
                this._oModel.setProperty("/isUnitEditable", true);
            } else {
                this._oModel.setProperty("/orderNo", "");
                this._oModel.setProperty("/material", "");
                this._oModel.setProperty("/materialName", "");
                this._oModel.setProperty("/plant", "");
                this._oModel.setProperty("/storageLocation", "");
                this._oModel.setProperty("/unit", "");
                this._oModel.setProperty("/isUnitEditable", false);
            }
            this._validateLive();
        },

        onOrderValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi261SelectOrder"),
                noDataText: this.getText("gi261NoOrdersFound"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value") || "";
                    var oBinding = oEvt.getSource().getBinding("items");
                    if (oBinding) {
                        var aFilters = sVal ? [
                            new Filter({
                                filters: [
                                    new Filter("OrderNo", FilterOperator.Contains, sVal),
                                    new Filter("Description", FilterOperator.Contains, sVal)
                                ],
                                and: false
                            })
                        ] : [];
                        oBinding.filter(aFilters);
                    }
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sOrder = oSelectedItem.getTitle();
                        var sPlant = oSelectedItem.getInfo();
                        that._oModel.setProperty("/orderNo", sOrder);
                        if (sPlant && !that._oModel.getProperty("/plant")) {
                            that._oModel.setProperty("/plant", sPlant);
                        }
                        that._validateLive();
                    }
                }
            });

            var oItemTemplate = new StandardListItem({
                title: "{OrderNo}",
                description: "{Description}",
                info: "{Plant}"
            });

            GoodsIssue261Service.fetchDistinctOrders()
                .then(function (aOrders) {
                    var oHelpModel = new JSONModel(aOrders);
                    oDialog.setModel(oHelpModel);
                    oDialog.bindAggregation("items", "/", oItemTemplate);
                    oDialog.open();
                })
                .catch(function (err) {
                    MessageBox.error(that.getText("gi261LoadOrdersError", [err.message || err]));
                });
        },

        onMaterialValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi261SelectMaterial"),
                noDataText: this.getText("gi261NoMaterialsFound"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value") || "";
                    var oBinding = oEvt.getSource().getBinding("items");
                    if (oBinding) {
                        var aFilters = sVal ? [
                            new Filter({
                                filters: [
                                    new Filter("Material", FilterOperator.Contains, sVal),
                                    new Filter("MaterialName", FilterOperator.Contains, sVal)
                                ],
                                and: false
                            })
                        ] : [];
                        oBinding.filter(aFilters);
                    }
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sMat = oSelectedItem.getTitle();
                        var sDesc = oSelectedItem.getDescription();
                        that._oModel.setProperty("/material", sMat);
                        that._oModel.setProperty("/materialName", sDesc);
                        that._loadMaterialInfo(sMat);
                    }
                }
            });

            var oItemTemplate = new StandardListItem({
                title: "{Material}",
                description: "{MaterialName}",
                info: "{MaterialBaseUnit}"
            });

            var oODataModel = this.getModel();
            if (oODataModel) {
                oDialog.setModel(oODataModel);
                oDialog.bindAggregation("items", "/MaterialVH", oItemTemplate);
                oDialog.open();
            } else {
                var sMat = that._oModel.getProperty("/material") || "";
                GoodsIssue261Service.fetchMaterialDetails(sMat, that._oModel.getProperty("/plant") || "")
                    .then(function (oInfo) {
                        var aList = oInfo ? [oInfo] : [];
                        var oListModel = new JSONModel(aList);
                        oDialog.setModel(oListModel);
                        oDialog.bindAggregation("items", "/", oItemTemplate);
                        oDialog.open();
                    });
            }
        },

        _loadMaterialInfo: function (sMaterial, sPlant) {
            var that = this;
            if (!sMaterial) { return; }
            // Prefer an explicitly passed plant (e.g. the reservation item's own plant) over the form's.
            var sPlantVal = sPlant || this._oModel.getProperty("/plant") || "";
            GoodsIssue261Service.fetchMaterialDetails(sMaterial, sPlantVal)
                .then(function (oInfo) {
                    if (oInfo) {
                        that._oModel.setProperty("/materialName", oInfo.materialName || that._oModel.getProperty("/materialName"));
                        if (oInfo.unit && !that._oModel.getProperty("/unit")) {
                            that._oModel.setProperty("/unit", oInfo.unit);
                        }
                        that._oModel.setProperty("/isBatchManaged", !!oInfo.isBatchManaged);
                    }
                    that._validateLive();
                })
                .catch(function () {
                    that._validateLive();
                });
        },

        onMaterialLiveChange: function (oEvt) {
            var sVal = oEvt.getParameter("value") || "";
            this._oModel.setProperty("/material", sVal);
            if (sVal.length >= 8) {
                this._loadMaterialInfo(sVal);
            }
            this._validateLive();
        },

        // =============================================================
        // RESERVATION VALUE HELP & ITEM RESOLUTION
        // =============================================================

        onReservationValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi261SelectReservation"),
                noDataText: this.getText("gi261NoReservationsFound"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value") || "";
                    var oBinding = oEvt.getSource().getBinding("items");
                    if (oBinding) {
                        var aFilters = sVal ? [
                            new Filter({
                                filters: [
                                    new Filter("ReservationNo", FilterOperator.Contains, sVal),
                                    new Filter("OrderNo", FilterOperator.Contains, sVal),
                                    new Filter("DisplayText", FilterOperator.Contains, sVal)
                                ],
                                and: false
                            })
                        ] : [];
                        oBinding.filter(aFilters);
                    }
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sResv = oSelectedItem.getTitle();
                        that._oModel.setProperty("/reservationNo", sResv);
                        that._oModel.setProperty("/reservationItem", "");
                        that._oModel.setProperty("/orderNo", "");
                        that._oModel.setProperty("/material", "");
                        that._oModel.setProperty("/materialName", "");
                        that._loadReservationItems(sResv);
                    }
                }
            });

            var oItemTemplate = new StandardListItem({
                title: "{ReservationNo}",
                description: "{DisplayText}",
                info: "{OrderNo}"
            });

            GoodsIssue261Service.fetchOpenReservations()
                .then(function (aItems) {
                    var oHelpModel = new JSONModel(aItems);
                    oDialog.setModel(oHelpModel);
                    oDialog.bindAggregation("items", "/", oItemTemplate);
                    oDialog.open();
                })
                .catch(function (err) {
                    MessageBox.error(that.getText("giLoadReservationsError", [err.message || err]));
                });
        },

        _loadReservationItems: function (sReservationNo) {
            var that = this;
            this._oModel.setProperty("/itemLoading", true);

            return GoodsIssue261Service.fetchReservationItems(sReservationNo)
                .then(function (aItems) {
                    that._aResolvedItems = eligible261ReservationItems(aItems, sReservationNo);
                    if (that._aResolvedItems.length === 1) {
                        that._applyReservationPrefill(that._aResolvedItems[0], sReservationNo);
                    } else if (that._aResolvedItems.length > 1) {
                        that._openReservationItemPicker();
                    } else {
                        MessageToast.show(that.getText("gi261NoItemsFound"));
                    }
                    that._validateLive();
                })
                .catch(function (err) {
                    MessageBox.error(that.getText("giLoadReservationItemsError", [err.message || err]));
                })
                .finally(function () {
                    that._oModel.setProperty("/itemLoading", false);
                });
        },

        _openReservationItemPicker: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi261SelectReservationItem"),
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var oCtx = oSelectedItem.getBindingContext();
                        var oRow = oCtx ? oCtx.getObject() : null;
                        if (oRow) {
                            that._applyReservationPrefill(oRow, that._oModel.getProperty("/reservationNo"));
                        }
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{ReservationItem}",
                description: "{Material} - {MaterialDesc}",
                info: "{OpenQty} {Unit}"
            });

            var oListModel = new JSONModel(this._aResolvedItems);
            oDialog.setModel(oListModel);
            oDialog.bindAggregation("items", "/", oTemplate);
            oDialog.open();
        },

        onReservationItemChange: function (oEvent) {
            var that = this;
            var sTyped = (oEvent.getParameter("value") || "").trim();
            var sResv = this._oModel.getProperty("/reservationNo");
            if (!sTyped || !sResv) {
                this._validateLive();
                return;
            }

            var sPadded = sTyped.padStart(4, "0");

            var applyFromCache = function () {
                var oMatch = (that._aResolvedItems || []).filter(function (it) {
                    var sItemNo = it.ReservationItem != null ? String(it.ReservationItem).trim().padStart(4, "0") : "";
                    return sItemNo === sPadded;
                })[0];
                if (oMatch) {
                    GoodsIssue261Model.applyReservationItem(that._oModel.getData(), oMatch);
                    that._oModel.refresh(true);
                } else {
                    MessageToast.show(that.getText("gi261NoItemsFound"));
                }
                that._validateLive();
            };

            if (this._aResolvedItems && this._aResolvedItems.length > 0) {
                applyFromCache();
            } else {
                this._loadReservationItems(sResv).then(applyFromCache);
            }
        },

        // =============================================================
        // SERIAL NUMBERS SCAN & MANAGEMENT (manual/unplanned serials)
        // =============================================================

        onAddSerialPress: function () {
            var sInput = this._oModel.getProperty("/serialInput") || "";
            var oData = this._oModel.getData();
            var oRes = GoodsIssue261Model.addSerialNumber(oData, sInput);

            if (!oRes.success) {
                MessageToast.show(oRes.message);
                return;
            }

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this.getText("gi261SerialAdded", [sInput.trim().toUpperCase()]));
        },

        onSerialInputSubmit: function () {
            this.onAddSerialPress();
        },

        onDeleteSerial: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext("gi261");
            if (!oCtx) return;

            var sPath = oCtx.getPath();
            var nIndex = parseInt(sPath.split("/").pop(), 10);
            var oData = this._oModel.getData();
            GoodsIssue261Model.removeSerialNumber(oData, nIndex);

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this.getText("gi261SerialRemoved"));
        },

        // =============================================================
        // SUBMIT POST GOODS ISSUE 261
        // =============================================================

        onPostGoodsIssue: function () {
            var oData = this._oModel ? this._oModel.getData() : {};
            var sCurrentPostingStatus = String((oData && oData.postingStatus) || "").toUpperCase();
            if ((oData && oData.busy) || sCurrentPostingStatus === "POSTED" ||
                sCurrentPostingStatus === "QUEUED" || sCurrentPostingStatus === "UNKNOWN") {
                return;
            }
            var sMaterial = (oData && oData.material != null) ? String(oData.material).trim() : "";
            var sPlant = (oData && oData.plant != null) ? String(oData.plant).trim() : "";

            if (!sMaterial) {
                MessageBox.error(this.getText("gi261MaterialRequired"));
                return;
            }
            if (!sPlant) {
                MessageBox.error(this.getText("gi261PlantRequired"));
                return;
            }

            if (oData && oData.isStagingRequired && !oData.canCompleteStaging) {
                MessageBox.error(oData.stagingWarning || "Staged stock is insufficient for Goods Issue.");
                return;
            }

            if (!this._validateLive()) {
                MessageBox.error(this.getText("gi261ValidationErrorsSummary"));
                return;
            }

            var that = this;
            var oPayload = GoodsIssue261Model.toBackendPayload(oData);

            this._oModel.setProperty("/busy", true);

            GoodsIssue261Service.postGoodsIssue(oPayload)
                .then(function (res) {
                    that._oModel.setProperty("/busy", false);
                    var sPostingStatus = resolvePostingStatus(res);
                    that._oModel.setProperty("/postingStatus", sPostingStatus);
                    that._oModel.setProperty("/postingAttemptDocument",
                        sPostingStatus === "UNKNOWN" && res ? (res.MaterialDocument || "") : "");

                    if (sPostingStatus !== "POSTED") {
                        that._oModel.setProperty("/hasPosted", false);
                        that._oModel.setProperty("/postedDocument", "");
                        that._oModel.setProperty("/postedYear", "");
                        if (sPostingStatus === "QUEUED") {
                            MessageBox.information((res && res.Message) || that.getText("gi261QueuedMsg"), {
                                title: that.getText("gi261QueuedTitle")
                            });
                        } else if (sPostingStatus === "UNKNOWN") {
                            MessageBox.warning((res && res.Message) || that.getText("gi261UnknownMsg"), {
                                title: that.getText("gi261UnknownTitle")
                            });
                        } else {
                            MessageBox.error((res && res.Message) || that.getText("gi261PostGenericError"), {
                                title: that.getText("gi261PostFailedTitle")
                            });
                        }
                        return;
                    }

                    that._oModel.setProperty("/hasPosted", true);
                    that._oModel.setProperty("/postedDocument", res.MaterialDocument);
                    that._oModel.setProperty("/postedYear", res.MaterialDocYear || "");

                    // Workflow outcome: return to Open Reservations list carrying completion result
                    if (that._oModel.getProperty("/fromReservation")) {
                        var oOutcome = {
                            resv: that._oModel.getProperty("/reservationNo"),
                            item: that._oModel.getProperty("/reservationItem"),
                            doc: res.MaterialDocument,
                            year: res.MaterialDocYear || ""
                        };
                        that.getRouter().navTo("wmGoodsIssue261Pending", { "?query": oOutcome });
                        return;
                    }

                    var sDocMsg = that.getText("gi261PostSuccessMsg", [
                        res.MaterialDocument || "",
                        res.MaterialDocYear || ""
                    ]);

                    MessageBox.success(sDocMsg, {
                        title: that.getText("gi261PostSuccessTitle"),
                        actions: [that.getText("gi261ActionReverseNow"), MessageBox.Action.CLOSE],
                        emphasizedAction: MessageBox.Action.CLOSE,
                        onClose: function (sAction) {
                            if (sAction === that.getText("gi261ActionReverseNow")) {
                                that.onReverseGoodsIssue();
                            }
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/busy", false);
                    var sPostingStatus = resolveErrorPostingStatus(err);
                    that._oModel.setProperty("/postingStatus", sPostingStatus);
                    that._oModel.setProperty("/hasPosted", false);
                    that._oModel.setProperty("/postedDocument", "");
                    that._oModel.setProperty("/postedYear", "");
                    var sErrMsg = err.message || that.getText("gi261PostGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    if (sPostingStatus === "UNKNOWN") {
                        MessageBox.warning(sErrMsg, { title: that.getText("gi261UnknownTitle") });
                    } else {
                        MessageBox.error(sErrMsg, { title: that.getText("gi261PostFailedTitle") });
                    }
                });
        },

        // =============================================================
        // REVERSAL (via CancelHeader)
        // =============================================================

        onReverseGoodsIssue: function () {
            var sDoc = this._oModel.getProperty("/postedDocument");
            var sYear = this._oModel.getProperty("/postedYear") || "";
            var sPostingDate = this._oModel.getProperty("/postingDate");

            if (!sDoc) {
                MessageToast.show(this.getText("gi261NoDocumentToReverse"));
                return;
            }

            var that = this;
            var sConfirmMsg = this.getText("gi261ReverseConfirmPrompt", [sDoc, sYear]);

            MessageBox.confirm(sConfirmMsg, {
                title: this.getText("gi261ReverseConfirmTitle"),
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._executeReversal(sDoc, sYear, sPostingDate);
                    }
                }
            });
        },

        _executeReversal: function (sDoc, sYear, sPostingDate) {
            var that = this;
            this._oModel.setProperty("/reversalBusy", true);

            GoodsIssue261Service.reverseGoodsIssue(sDoc, sYear, sPostingDate, "01")
                .then(function (res) {
                    that._oModel.setProperty("/reversalBusy", false);
                    that._oModel.setProperty("/hasReversed", true);
                    that._oModel.setProperty("/reversalDocument", res.ReversalMaterialDocument || "");
                    that._oModel.setProperty("/reversalYear", res.ReversalMaterialDocYear || sYear);

                    var sSuccess = that.getText("gi261ReverseSuccessMsg", [
                        sDoc,
                        res.ReversalMaterialDocument || ""
                    ]);

                    MessageBox.success(sSuccess, {
                        title: that.getText("gi261ReverseSuccessTitle"),
                        onClose: function () {
                            that._resetModel();
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/reversalBusy", false);
                    var sErrMsg = err.message || that.getText("gi261ReverseGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that.getText("gi261ReverseFailedTitle")
                    });
                });
        },

        onResetForm: function () {
            var that = this;
            MessageBox.confirm(this.getText("gi261ResetConfirm"), {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        MessageToast.show(that.getText("gi261FormReset"));
                    }
                }
            });
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                if (this._oModel && this._oModel.getProperty("/fromReservation")) {
                    oRouter.navTo("wmGoodsIssue261Pending");
                } else {
                    oRouter.navTo("dashboard");
                }
            }
        }
    });
});
