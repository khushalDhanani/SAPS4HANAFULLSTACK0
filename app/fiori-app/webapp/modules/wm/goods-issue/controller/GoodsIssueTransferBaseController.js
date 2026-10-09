sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    Filter,
    FilterOperator
) {
    "use strict";

    /**
     * GoodsIssueTransferBaseController
     * Shared controller logic for the reservation-based transfer-posting movement types 301 (plant-to-
     * plant) and 311 (storage-location-to-storage-location). These two screens are behaviourally
     * identical apart from their movement number, so each concrete controller supplies only a small
     * config via _getConfig() and inherits all behaviour here.
     *
     * A subclass MUST implement:
     *   _getConfig() -> { type, modelName, i18nPrefix, route, Model, Service }
     *
     * For every movement type other than 201 the backend requires ReservationNo + ReservationItem, so
     * Material/Plant/Storage Location/Unit/Order are always DERIVED from the resolved reservation item,
     * never freely entered.
     */
    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssueTransferBase", {

        /** Subclasses override this. */
        _getConfig: function () {
            throw new Error("GoodsIssueTransferBaseController subclass must implement _getConfig()");
        },

        /** Prefixed getText: resolves an i18n key under the movement type's prefix (e.g. gi301/gi311). */
        _t: function (sKey, aArgs) {
            return this.getText(this._c.i18nPrefix + sKey, aArgs);
        },

        onInit: function () {
            this._c = this._getConfig();
            this._oModel = this._c.Model.createInitialModel();
            this.getView().setModel(this._oModel, this._c.modelName);

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute(this._c.route).attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function (oEvent) {
            this._resetModel();
            var oArgs = oEvent && oEvent.getParameter("arguments");
            var oQuery = oArgs && oArgs["?query"];
            var sResv = oQuery && oQuery.resv;
            if (sResv) {
                this._prefillFromReservation(sResv, oQuery.item);
            }
        },

        _resetModel: function () {
            var oInitData = this._c.Model.getInitialData();
            this._oModel.setData(oInitData);
            this._aResolvedItems = [];
            this._validateLive();
        },

        /**
         * Pre-fill the transfer form from an open reservation (e.g. from the Open Transfers list page).
         * @param {string} sResv - Reservation Number
         * @param {string} [sItem] - Optional specific Reservation Item
         */
        _prefillFromReservation: function (sResv, sItem) {
            var that = this;
            var cfg = this._c;
            var oModel = this._oModel;
            oModel.setProperty("/busy", true);
            oModel.setProperty("/fromReservation", true);
            oModel.setProperty("/reservationNo", sResv);

            return cfg.Service.fetchReservationItems(sResv)
                .then(function (aItems) {
                    that._aResolvedItems = aItems || [];
                    var oTargetItem = null;
                    if (sItem) {
                        var sPadded = String(sItem).padStart(4, "0");
                        oTargetItem = that._aResolvedItems.find(function (i) {
                            return String(i.ReservationItem) === String(sItem) || String(i.ReservationItem) === sPadded;
                        });
                    }
                    if (!oTargetItem) {
                        oTargetItem = that._aResolvedItems.find(function (i) {
                            return Number(i.OpenQty) > 0;
                        }) || that._aResolvedItems[0];
                    }

                    if (!oTargetItem) {
                        // Missing, closed or unknown reservation: say so and leave the form empty and editable.
                        that._resetModel();
                        MessageBox.error(that._t("PrefillNoOpenItem", [sResv]));
                        return;
                    }

                    cfg.Model.applyReservationItem(oModel.getData(), oTargetItem);
                    var nOpen = Number(oTargetItem.OpenQty);
                    if (!isNaN(nOpen) && nOpen > 0) {
                        oModel.setProperty("/quantity", nOpen);
                        oModel.setProperty("/openQty", nOpen);
                    }
                    that._oModel.refresh(true);
                    that._loadStockUnits(sResv, oTargetItem.ReservationItem);
                    that._validateLive();
                })
                .catch(function (err) {
                    that._resetModel();
                    MessageBox.error((err && err.message) || that._t("PrefillError"));
                })
                .finally(function () {
                    oModel.setProperty("/busy", false);
                });
        },

        // =============================================================
        // FORMATTERS
        // =============================================================

        formatSuccessBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this._t("SuccessBannerText", [sDoc, sYear || ""]);
        },

        formatReversalBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this._t("ReversalBannerText", [sDoc, sYear || ""]);
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
            var oResult = this._c.Model.validate(oData);
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
        // RESERVATION VALUE HELP & ITEM RESOLUTION
        // =============================================================

        onReservationValueHelp: function () {
            var that = this;
            var cfg = this._c;
            var oDialog = new SelectDialog({
                title: this._t("SelectReservation"),
                noDataText: this._t("NoReservationsFound"),
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

            cfg.Service.fetchOpenReservations()
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

        /**
         * Load and cache the open items of a Reservation. Auto-applies the item when exactly one
         * is open; otherwise lets the user pick one via a second Value Help (or via typing the
         * Reservation Item number directly and triggering onReservationItemChange).
         */
        _loadReservationItems: function (sReservationNo) {
            var that = this;
            var cfg = this._c;
            this._oModel.setProperty("/itemLoading", true);

            return cfg.Service.fetchReservationItems(sReservationNo)
                .then(function (aItems) {
                    that._aResolvedItems = aItems || [];
                    if (that._aResolvedItems.length === 1) {
                        cfg.Model.applyReservationItem(that._oModel.getData(), that._aResolvedItems[0]);
                        that._oModel.refresh(true);
                        that._loadStockUnits(sReservationNo, that._aResolvedItems[0].ReservationItem);
                    } else if (that._aResolvedItems.length > 1) {
                        that._openReservationItemPicker();
                    } else {
                        MessageToast.show(that._t("NoItemsFound"));
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
            var cfg = this._c;
            var oDialog = new SelectDialog({
                title: this._t("SelectReservationItem"),
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var oCtx = oSelectedItem.getBindingContext();
                        var oRow = oCtx ? oCtx.getObject() : null;
                        if (oRow) {
                            cfg.Model.applyReservationItem(that._oModel.getData(), oRow);
                            that._oModel.refresh(true);
                            that._loadStockUnits(that._oModel.getProperty("/reservationNo"), oRow.ReservationItem);
                            that._validateLive();
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

        /**
         * Manual entry path: the user typed a Reservation Item number directly (already knows the
         * combination) instead of using the picker. Matches it against the cached items for the
         * current Reservation, fetching them first if the cache is empty.
         */
        onReservationItemChange: function (oEvent) {
            var that = this;
            var cfg = this._c;
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
                    cfg.Model.applyReservationItem(that._oModel.getData(), oMatch);
                    that._oModel.refresh(true);
                    that._loadStockUnits(sResv, oMatch.ReservationItem);
                } else {
                    MessageToast.show(that._t("NoItemsFound"));
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
        // SERIAL NUMBERS SCAN & MANAGEMENT
        // =============================================================

        /**
         * A scanned serial number is accepted only after SAP confirmed it for the current reservation
         * item (material, plant, storage location, unrestricted stock). The status shown per serial is
         * the SAP answer; when SAP cannot be asked the scan is rejected as "unable to verify".
         * @returns {Promise<void>|undefined}
         */
        onAddSerialPress: function () {
            var that = this;
            var cfg = this._c;
            var oModel = this._oModel;
            var oData = oModel.getData();
            var sInput = oModel.getProperty("/serialInput") || "";
            if (oData.serialVerifying) {
                return; // one SAP verification at a time: no duplicate requests, no out-of-order answers
            }

            var sInputTrim = (sInput || "").trim();
            if (sInputTrim) {
                // Check if user scanned or typed a Storage Unit into the Serial input field:
                var oKnownSu = (oData.storageUnits || []).find(function (u) {
                    var uId = String(u.StorageUnit || "").trim();
                    return uId === sInputTrim || uId === sInputTrim.replace(/^0+/, "");
                });
                if (oKnownSu) {
                    oModel.setProperty("/selectedStorageUnit", oKnownSu.StorageUnit);
                    oModel.setProperty("/suScanState", "Success");
                    var sBinText = (oKnownSu.StorageType && oKnownSu.StorageBin) ? (oKnownSu.StorageType + "/" + oKnownSu.StorageBin) : "";
                    oModel.setProperty("/suScanText", that._t("SuRecognizedAndSelected", [oKnownSu.StorageUnit, sBinText]));
                    oModel.setProperty("/serialInput", "");
                    that._setSerialScan("Information", that._t("BarcodeIsStorageUnit", [sInputTrim, oKnownSu.StorageUnit]));
                    MessageToast.show(that._t("BarcodeIsStorageUnitToast", [sInputTrim]));
                    that._validateLive();
                    return;
                }
            }

            // Local checks first (empty, length, duplicate, quantity reached) on a copy: nothing is added yet.
            var oProbe = { quantity: oData.quantity, serialNumbers: (oData.serialNumbers || []).slice() };
            var oCheck = cfg.Model.addSerialNumber(oProbe, sInput);
            if (!oCheck.success) {
                MessageToast.show(oCheck.message);
                return;
            }
            var sSerial = oProbe.serialNumbers[oProbe.serialNumbers.length - 1];
            var sResv = oData.reservationNo;
            var sItem = oData.reservationItem;
            if (!sResv || !sItem) {
                this._setSerialScan("Error", this._t("SerialNeedsReservation"));
                return;
            }

            oModel.setProperty("/serialVerifying", true);
            this._setSerialScan("None", "");
            return cfg.Service.verifySerial(sSerial, sResv, sItem, oData.storageLocation)
                .then(function (oRes) {
                    var oNow = oModel.getData();
                    if (oNow.reservationNo !== sResv || oNow.reservationItem !== sItem) {
                        return; // the reservation item changed while SAP was answering: the answer no longer applies
                    }
                    if (oRes && (oRes.Status === "IS_STORAGE_UNIT" || oRes.IsStorageUnit)) {
                        var sSu = oRes.StorageUnit || sSerial;
                        oModel.setProperty("/selectedStorageUnit", sSu);
                        oModel.setProperty("/suScanState", "Success");
                        var sTypeBin = (oRes.StorageType && oRes.StorageBin) ? (oRes.StorageType + "/" + oRes.StorageBin) : "";
                        oModel.setProperty("/suScanText", that._t("SuRecognizedAndSelected", [sSu, sTypeBin]));
                        oModel.setProperty("/serialInput", "");
                        that._setSerialScan("Information", that._t("BarcodeIsStorageUnit", [sSerial, sSu]));
                        MessageToast.show(that._t("BarcodeIsStorageUnitToast", [sSerial]));
                        return;
                    }
                    if (!oRes || !oRes.Status || oRes.Status === "UNVERIFIED") {
                        that._setSerialScan("Warning", that._t("SerialUnableToVerify", [sSerial, (oRes && oRes.Message) || ""]));
                        return;
                    }
                    if (oRes.Available !== true) {
                        that._setSerialScan("Error", oRes.Message || that._t("SerialNotAvailable", [sSerial, oRes.Status]));
                        return;
                    }
                    var oAdd = cfg.Model.addSerialNumber(oNow, sSerial);
                    if (!oAdd.success) {
                        that._setSerialScan("Error", oAdd.message);
                        return;
                    }
                    var mStatus = Object.assign({}, oNow.serialStatus);
                    mStatus[sSerial] = {
                        available: true,
                        status: oRes.Status,
                        text: that._t("SerialAvailable", [oRes.Plant, oRes.StorageLocation, oRes.StockTypeText || oRes.StockType]),
                        verifiedAt: oRes.VerifiedAt || ""
                    };
                    oNow.serialStatus = mStatus;
                    that._setSerialScan("Success", oRes.Message || that._t("SerialAdded", [sSerial]));
                })
                .catch(function (err) {
                    that._setSerialScan("Warning", that._t("SerialUnableToVerify", [sSerial, (err && err.message) || ""]));
                })
                .finally(function () {
                    oModel.setProperty("/serialVerifying", false);
                    oModel.refresh(true);
                    that._validateLive();
                });
        },

        /**
         * Open Value Help dialog for Available Serial Numbers from live SAP stock.
         */
        onSerialValueHelp: function () {
            var that = this;
            var cfg = this._c;
            var oModel = this._oModel;
            var oData = oModel.getData();
            var sResv = oData.reservationNo;
            var sItem = oData.reservationItem;

            if (!sResv || !sItem) {
                MessageBox.information(that._t("SerialNeedsReservation"));
                return;
            }

            var oDialog = new SelectDialog({
                title: that._t("SerialValueHelpTitle"),
                noDataText: that._t("SerialValueHelpNoData"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value");
                    var oFilter = new Filter("SerialNumber", FilterOperator.Contains, sVal);
                    oEvt.getSource().getBinding("items").filter(sVal ? [oFilter] : []);
                },
                liveChange: function (oEvt) {
                    var sVal = oEvt.getParameter("value");
                    var oFilter = new Filter("SerialNumber", FilterOperator.Contains, sVal);
                    oEvt.getSource().getBinding("items").filter(sVal ? [oFilter] : []);
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var oCtx = oSelectedItem.getBindingContext();
                        var oRow = oCtx ? oCtx.getObject() : null;
                        var sPickedSerial = (oRow && oRow.SerialNumber) || oSelectedItem.getTitle();
                        oModel.setProperty("/serialInput", sPickedSerial);
                        that.onAddSerialPress();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{SerialNumber}",
                description: "{StorageLocationName} ({StorageLocation})",
                info: "{StockTypeText}",
                infoState: "Success",
                icon: "sap-icon://bar-code"
            });

            oDialog.setBusy(true);
            oDialog.open();

            cfg.Service.getAvailableSerialNumbers(sResv, sItem, oData.material, oData.plant, oData.storageLocation)
                .then(function (aSerials) {
                    var aList = Array.isArray(aSerials) ? aSerials : [];
                    var oListModel = new JSONModel(aList);
                    oDialog.setModel(oListModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                })
                .catch(function (err) {
                    MessageBox.error(err.message || "Failed to load serial numbers from SAP");
                })
                .finally(function () {
                    oDialog.setBusy(false);
                });
        },

        _setSerialScan: function (sState, sText) {
            this._oModel.setProperty("/serialScanState", sState);
            this._oModel.setProperty("/serialScanText", sText);
        },

        /** Status text of one listed serial: the SAP answer stored at verification, never a default. */
        formatSerialStatusText: function (sSerial, mStatus) {
            var o = mStatus && mStatus[sSerial];
            return (o && o.available) ? o.text : this._t("SerialNotVerified");
        },

        formatSerialStatusState: function (sSerial, mStatus) {
            var o = mStatus && mStatus[sSerial];
            return (o && o.available) ? "Success" : "Error";
        },

        onSerialInputSubmit: function () {
            this.onAddSerialPress();
        },

        onDeleteSerial: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext(this._c.modelName);
            if (!oCtx) return;

            var sPath = oCtx.getPath();
            var nIndex = parseInt(sPath.split("/").pop(), 10);
            var oData = this._oModel.getData();
            this._c.Model.removeSerialNumber(oData, nIndex);

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this._t("SerialRemoved"));
        },

        // =============================================================
        // STORAGE UNIT (SU) MANAGEMENT & SUGGESTED SCAN
        // =============================================================

        _loadStockUnits: function (sResv, sItem) {
            var that = this;
            var cfg = this._c;
            if (!cfg.Service || typeof cfg.Service.fetchStockUnitsForItem !== "function") {
                return Promise.resolve();
            }
            if (!sResv || !sItem) {
                return Promise.resolve();
            }
            this._oModel.setProperty("/suLoading", true);
            return cfg.Service.fetchStockUnitsForItem(sResv, sItem)
                .then(function (oRes) {
                    var aUnits = (oRes && oRes.StockUnits) || [];
                    var sSuggested = (oRes && oRes.SuggestedStorageUnit) || (aUnits.length > 0 ? aUnits[0].StorageUnit : "");
                    if (cfg.Model && typeof cfg.Model.applyStockUnits === "function") {
                        cfg.Model.applyStockUnits(that._oModel.getData(), aUnits, sSuggested);
                    } else {
                        that._oModel.setProperty("/storageUnits", aUnits);
                        that._oModel.setProperty("/suggestedStorageUnit", sSuggested);
                        that._oModel.setProperty("/hasSuggestedSU", !!sSuggested);
                    }
                    that._oModel.refresh(true);
                })
                .catch(function () {
                    if (cfg.Model && typeof cfg.Model.applyStockUnits === "function") {
                        cfg.Model.applyStockUnits(that._oModel.getData(), [], "");
                    }
                    that._oModel.refresh(true);
                })
                .finally(function () {
                    that._oModel.setProperty("/suLoading", false);
                });
        },

        onUseSuggestedSU: function () {
            var sSuggested = this._oModel.getProperty("/suggestedStorageUnit");
            if (!sSuggested) {
                return;
            }
            this._oModel.setProperty("/selectedStorageUnit", sSuggested);
            this._oModel.setProperty("/suScanInput", sSuggested);
            this._oModel.setProperty("/suScanState", "Success");
            this._oModel.setProperty("/suScanText", this._t("SuSelectedSuccess", [sSuggested]));
            MessageToast.show(this._t("SuSelectedToast", [sSuggested]));
            this._validateLive();
        },

        onScanStorageUnit: function () {
            var sRaw = String(this._oModel.getProperty("/suScanInput") || "").trim();
            if (!sRaw) {
                this._oModel.setProperty("/suScanState", "None");
                this._oModel.setProperty("/suScanText", "");
                return;
            }
            var sClean = sRaw.toUpperCase();
            var aUnits = this._oModel.getProperty("/storageUnits") || [];
            var oMatch = aUnits.find(function (u) {
                var su = String(u.StorageUnit || "").trim().toUpperCase();
                return su === sClean || su.replace(/^0+/, "") === sClean.replace(/^0+/, "");
            });

            if (oMatch) {
                var sMatchedSU = oMatch.StorageUnit;
                this._oModel.setProperty("/selectedStorageUnit", sMatchedSU);
                this._oModel.setProperty("/suScanInput", sMatchedSU);
                this._oModel.setProperty("/suScanState", "Success");
                this._oModel.setProperty("/suScanText", this._t("SuVerified", [
                    sMatchedSU,
                    oMatch.AvailableStock !== undefined ? oMatch.AvailableStock : (oMatch.StockQty || ""),
                    oMatch.Unit || oMatch.BaseUnit || ""
                ]));
                MessageToast.show(this._t("SuSelectedToast", [sMatchedSU]));
            } else {
                this._oModel.setProperty("/selectedStorageUnit", sClean);
                this._oModel.setProperty("/suScanState", "Warning");
                this._oModel.setProperty("/suScanText", this._t("SuNotMatched", [sClean]));
            }
            this._validateLive();
        },

        onScanStorageUnitSubmit: function () {
            this.onScanStorageUnit();
        },

        onSelectStorageUnitRow: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext(this._c.modelName);
            if (!oCtx) return;
            var oSU = oCtx.getObject();
            if (oSU && oSU.StorageUnit) {
                this._oModel.setProperty("/selectedStorageUnit", oSU.StorageUnit);
                this._oModel.setProperty("/suScanInput", oSU.StorageUnit);
                this._oModel.setProperty("/suScanState", "Success");
                this._oModel.setProperty("/suScanText", this._t("SuSelectedSuccess", [oSU.StorageUnit]));
                MessageToast.show(this._t("SuSelectedToast", [oSU.StorageUnit]));
                this._validateLive();
            }
        },

        onClearSelectedSU: function () {
            this._oModel.setProperty("/selectedStorageUnit", "");
            this._oModel.setProperty("/suScanInput", "");
            this._oModel.setProperty("/suScanState", "None");
            this._oModel.setProperty("/suScanText", "");
            this._validateLive();
        },

        formatStorageTypeBin: function (sType, sBin) {
            if (!sType && !sBin) return "-";
            if (sType && sBin) return sType + " / " + sBin;
            return sType || sBin;
        },

        // =============================================================
        // RECEIVING PLANT / STORAGE LOCATION VALUE HELP (optional fields)
        // =============================================================

        onReceivingPlantValueHelp: function () {
            var that = this;
            var cfg = this._c;
            var oDialog = new SelectDialog({
                title: this._t("SelectReceivingPlant"),
                confirm: function (oEvt) {
                    var oItem = oEvt.getParameter("selectedItem");
                    if (oItem) {
                        that._oModel.setProperty("/receivingPlant", oItem.getTitle());
                        that._oModel.setProperty("/receivingPlantName", oItem.getDescription());
                        that._validateLive();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{Plant}",
                description: "{PlantName}"
            });

            cfg.Service.fetchPlants()
                .then(function (aPlants) {
                    var oModel = new JSONModel(aPlants);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                })
                .catch(function (err) {
                    // Never seed the value help with invented plants — surface the real SAP error.
                    MessageBox.error(that.getText("giLoadReceivingPlantsError", [(err && err.message) || err]));
                });
        },

        onReceivingStorageLocationValueHelp: function () {
            this._storageLocationValueHelp(
                this._oModel.getProperty("/receivingPlant") || "1120",
                "SelectReceivingStorageLocation", "/receivingStorageLocation", "giLoadReceivingStorageLocationsError");
        },

        /** Issuing storage location: only offered when the reservation item carries none. */
        onStorageLocationValueHelp: function () {
            this._storageLocationValueHelp(
                this._oModel.getProperty("/plant"),
                "SelectStorageLocation", "/storageLocation", "gi201LoadStorageLocationsError");
        },

        _storageLocationValueHelp: function (sPlant, sTitleKey, sProp, sErrorKey) {
            var that = this;
            var cfg = this._c;

            var oDialog = new SelectDialog({
                title: this._t(sTitleKey),
                confirm: function (oEvt) {
                    var oItem = oEvt.getParameter("selectedItem");
                    if (oItem) {
                        that._oModel.setProperty(sProp, oItem.getTitle());
                        that._oModel.setProperty(sProp + "Name", oItem.getDescription());
                        that._validateLive();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{StorageLocation}",
                description: "{StorageLocationName}",
                info: "{Plant}"
            });

            cfg.Service.fetchStorageLocations(sPlant)
                .then(function (aLocations) {
                    var oModel = new JSONModel(aLocations);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                })
                .catch(function (err) {
                    // Never seed the value help with invented storage locations — surface the real SAP error.
                    MessageBox.error(that.getText(sErrorKey, [(err && err.message) || err]));
                });
        },

        // =============================================================
        // SUBMIT POST GOODS ISSUE (301/311)
        // =============================================================

        onPostGoodsIssue: function () {
            if (!this._validateLive()) {
                MessageBox.error(this._t("ValidationErrorsSummary"));
                return;
            }

            var that = this;
            var cfg = this._c;
            var oData = this._oModel.getData();
            var oPayload = cfg.Model.toBackendPayload(oData);

            this._oModel.setProperty("/busy", true);

            cfg.Service.postGoodsIssue(oPayload)
                .then(function (res) {
                    that._oModel.setProperty("/busy", false);

                    if (!res || !res.MaterialDocument) {
                        that._oModel.setProperty("/hasPosted", false);
                        var sMsg = (res && res.Message) || "Goods Issue was not posted in SAP S/4HANA.";
                        MessageBox.error(sMsg);
                        return;
                    }

                    // Open/Pending list workflow: return to the pending list page carrying completion outcome
                    if (that._oModel.getProperty("/fromReservation") && cfg.pendingRoute) {
                        var oOutcome = {
                            resv: that._oModel.getProperty("/reservationNo"),
                            item: that._oModel.getProperty("/reservationItem"),
                            doc: res.MaterialDocument,
                            year: res.MaterialDocYear || ""
                        };
                        that.getRouter().navTo(cfg.pendingRoute, { "?query": oOutcome });
                        return;
                    }

                    that._oModel.setProperty("/hasPosted", true);
                    that._oModel.setProperty("/postedDocument", res.MaterialDocument || "");
                    that._oModel.setProperty("/postedYear", res.MaterialDocYear || "");

                    var sDocMsg = that._t("PostSuccessMsg", [
                        res.MaterialDocument || "",
                        res.MaterialDocYear || ""
                    ]);
                    if (res && (res.Confirmed === false || res.ConfirmationStatus === 'POSTED_CONFIRMATION_PENDING')) {
                        sDocMsg += " (" + that._t("ConfirmationPending", null, "posted, confirmation pending") + ")";
                    }

                    MessageBox.success(sDocMsg, {
                        title: that._t("PostSuccessTitle"),
                        actions: [that._t("ActionReverseNow"), MessageBox.Action.CLOSE],
                        emphasizedAction: MessageBox.Action.CLOSE,
                        onClose: function (sAction) {
                            if (sAction === that._t("ActionReverseNow")) {
                                that.onReverseGoodsIssue();
                            }
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/busy", false);
                    // Backend surfaces the real SAP business error (sap-message severity, or a
                    // reclassified 400/409/422) as err.message - see GoodsIssuePostingClient.
                    var sErrMsg = err.message || that._t("PostGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that._t("PostFailedTitle")
                    });
                });
        },

        // =============================================================
        // REVERSAL (via Cancel)
        // =============================================================

        onReverseGoodsIssue: function () {
            var sDoc = this._oModel.getProperty("/postedDocument");
            var sYear = this._oModel.getProperty("/postedYear") || "";
            var sPostingDate = this._oModel.getProperty("/postingDate");

            if (!sDoc) {
                MessageToast.show(this._t("NoDocumentToReverse"));
                return;
            }

            var that = this;
            var sConfirmMsg = this._t("ReverseConfirmPrompt", [sDoc, sYear]);

            MessageBox.confirm(sConfirmMsg, {
                title: this._t("ReverseConfirmTitle"),
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
            var cfg = this._c;
            this._oModel.setProperty("/reversalBusy", true);

            cfg.Service.reverseGoodsIssue(sDoc, sYear, sPostingDate, "01")
                .then(function (res) {
                    that._oModel.setProperty("/reversalBusy", false);
                    that._oModel.setProperty("/hasReversed", true);
                    that._oModel.setProperty("/reversalDocument", res.ReversalMaterialDocument || "");
                    that._oModel.setProperty("/reversalYear", res.ReversalMaterialDocYear || sYear);

                    var sSuccess = that._t("ReverseSuccessMsg", [
                        sDoc,
                        res.ReversalMaterialDocument || ""
                    ]);

                    MessageBox.success(sSuccess, {
                        title: that._t("ReverseSuccessTitle"),
                        onClose: function () {
                            that._resetModel();
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/reversalBusy", false);
                    var sErrMsg = err.message || that._t("ReverseGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that._t("ReverseFailedTitle")
                    });
                });
        },

        onResetForm: function () {
            var that = this;
            MessageBox.confirm(this._t("ResetConfirm"), {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        MessageToast.show(that._t("FormReset"));
                    }
                }
            });
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                if (this._oModel && this._oModel.getProperty("/fromReservation") && this._c && this._c.pendingRoute) {
                    oRouter.navTo(this._c.pendingRoute);
                    return;
                }
                oRouter.navTo("dashboard");
            }
        }
    });
});
