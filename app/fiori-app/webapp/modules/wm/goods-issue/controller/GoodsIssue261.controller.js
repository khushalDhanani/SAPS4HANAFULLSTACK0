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
            var sResv = oQuery && oQuery.resv;
            if (sResv) {
                this._prefillFromReservation(sResv);
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
        _prefillFromReservation: function (sResv) {
            var that = this;
            var oModel = this._oModel;
            oModel.setProperty("/busy", true);
            GoodsIssue261Service.fetchReservationItems(sResv)
                .then(function (aItems) {
                    var oItem = (aItems || []).find(function (i) { return Number(i.OpenQty) > 0; }) || (aItems || [])[0];
                    if (!oItem) {
                        MessageToast.show(that.getText("gi261PrefillNoOpenItem", [sResv]));
                        return;
                    }
                    oModel.setProperty("/fromReservation", true);
                    oModel.setProperty("/reservationNo", oItem.ReservationNo || sResv);
                    oModel.setProperty("/reservationItem", oItem.ReservationItem || "");
                    oModel.setProperty("/orderNo", oItem.OrderNo || "");
                    oModel.setProperty("/material", oItem.Material || "");
                    oModel.setProperty("/materialName", oItem.MaterialDesc || "");
                    oModel.setProperty("/plant", oItem.Plant || "");
                    oModel.setProperty("/storageLocation", oItem.StorageLocation || "");
                    var nOpen = Number(oItem.OpenQty);
                    if (!isNaN(nOpen) && nOpen > 0) {
                        oModel.setProperty("/quantity", nOpen);
                        oModel.setProperty("/openQty", nOpen);
                    }
                    if (oItem.Unit) {
                        oModel.setProperty("/unit", oItem.Unit);
                    }
                    that._loadMaterialInfo(oItem.Material || "", oItem.Plant || "");
                    // Detect unit/serial vs non-serial workflow
                    that._detectScanMode(oItem.ReservationNo || sResv, oItem.ReservationItem || "", nOpen || 0);
                    that._validateLive();
                })
                .catch(function (err) {
                    MessageBox.error((err && err.message) || that.getText("gi261PrefillError"));
                })
                .finally(function () {
                    oModel.setProperty("/busy", false);
                });
        },

        _loadMaterialInfo: function (sMaterial, sPlant) {
            var that = this;
            if (!sMaterial) return;
            GoodsIssue261Service.fetchMaterialDetails(sMaterial, sPlant)
                .then(function (oInfo) {
                    if (!oInfo) return;
                    if (oInfo.materialName && !that._oModel.getProperty("/materialName")) {
                        that._oModel.setProperty("/materialName", oInfo.materialName);
                    }
                    if (oInfo.unit && !that._oModel.getProperty("/unit")) {
                        that._oModel.setProperty("/unit", oInfo.unit);
                    }
                    if (oInfo.isBatchManaged !== undefined) {
                        that._oModel.setProperty("/isBatchManaged", oInfo.isBatchManaged);
                    }
                    that._validateLive();
                })
                .catch(function () { /* non-fatal enrichment */ });
        },

        /**
         * Detect whether the reservation component is unit-managed (serial or storage unit).
         * If scannable units exist in S/4, enables scan-to-complete mode with pass/fail feedback.
         * If non-serial: skips scan, proceeding directly to quantity/order confirmation.
         */
        _detectScanMode: function (sResv, sItem, nOpenQty) {
            var that = this;
            var oModel = this._oModel;
            oModel.setProperty("/scanEnabled", false);
            oModel.setProperty("/scannedUnits", []);
            oModel.setProperty("/lastScanState", "None");
            oModel.setProperty("/lastScanText", "");
            if (!sResv || !sItem) {
                return;
            }
            GoodsIssue261Service.fetchStockUnitsForItem(sResv, sItem)
                .then(function (oData) {
                    var aUnits = (oData && oData.StockUnits) || [];
                    if (aUnits.length > 0) {
                        oModel.setProperty("/scanEnabled", true);
                        oModel.setProperty("/requiredScanCount", Math.max(1, Math.floor(nOpenQty || 1)));
                        // The scan section takes over from the manual serial entry table
                        oModel.setProperty("/isSerialManaged", false);
                    }
                })
                .catch(function () { /* no scannable units -> non-serial plain quantity confirmation */ })
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
                    var oFb = GoodsIssue261Model.applyScanResolution(oData, oRes, sBarcode);
                    oModel.setProperty("/scannedUnits", oData.scannedUnits);
                    that._setScanFeedback(oFb.state, oFb.text);
                })
                .catch(function (err) {
                    // Hard SAP condition (no open qty, wrong plant, etc.) - surface the real message
                    that._setScanFeedback("Error", (err && err.message) || "Scan could not be validated in S/4HANA.");
                })
                .finally(function () { that._validateLive(); });
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
                    MessageBox.error("Failed to load open Reservations: " + (err.message || err));
                });
        },

        _loadReservationItems: function (sReservationNo) {
            var that = this;
            this._oModel.setProperty("/itemLoading", true);

            return GoodsIssue261Service.fetchReservationItems(sReservationNo)
                .then(function (aItems) {
                    that._aResolvedItems = aItems || [];
                    if (that._aResolvedItems.length === 1) {
                        GoodsIssue261Model.applyReservationItem(that._oModel.getData(), that._aResolvedItems[0]);
                        that._oModel.refresh(true);
                    } else if (that._aResolvedItems.length > 1) {
                        that._openReservationItemPicker();
                    } else {
                        MessageToast.show(that.getText("gi261NoItemsFound"));
                    }
                    that._validateLive();
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load Reservation Items: " + (err.message || err));
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
                            GoodsIssue261Model.applyReservationItem(that._oModel.getData(), oRow);
                            that._oModel.refresh(true);
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
            if (!this._validateLive()) {
                MessageBox.error(this.getText("gi261ValidationErrorsSummary"));
                return;
            }

            var that = this;
            var oData = this._oModel.getData();
            var oPayload = GoodsIssue261Model.toBackendPayload(oData);

            this._oModel.setProperty("/busy", true);

            GoodsIssue261Service.postGoodsIssue(oPayload)
                .then(function (res) {
                    that._oModel.setProperty("/busy", false);

                    // Workflow outcome: return to Open Reservations list carrying completion result
                    if (that._oModel.getProperty("/fromReservation")) {
                        var oOutcome = {
                            resv: that._oModel.getProperty("/reservationNo"),
                            item: that._oModel.getProperty("/reservationItem")
                        };
                        if (res && res.MaterialDocument) {
                            oOutcome.doc = res.MaterialDocument;
                            oOutcome.year = res.MaterialDocYear || new Date().getFullYear().toString();
                        } else {
                            oOutcome.queued = (res && res.QueueReference) || "1";
                        }
                        that.getRouter().navTo("wmGoodsIssue261Pending", { "?query": oOutcome });
                        return;
                    }

                    if (res && (res.Queued === true || !res.MaterialDocument)) {
                        that._oModel.setProperty("/hasPosted", false);
                        MessageBox.warning(res.Message || that.getText("giPostQueuedMsg"), {
                            title: that.getText("giPostQueuedTitle")
                        });
                        return;
                    }

                    that._oModel.setProperty("/hasPosted", true);
                    that._oModel.setProperty("/postedDocument", res.MaterialDocument || "");
                    that._oModel.setProperty("/postedYear", res.MaterialDocYear || new Date().getFullYear().toString());

                    var sDocMsg = that.getText("gi261PostSuccessMsg", [
                        res.MaterialDocument || "Document",
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
                    var sErrMsg = err.message || that.getText("gi261PostGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that.getText("gi261PostFailedTitle")
                    });
                });
        },

        // =============================================================
        // REVERSAL (via CancelHeader)
        // =============================================================

        onReverseGoodsIssue: function () {
            var sDoc = this._oModel.getProperty("/postedDocument");
            var sYear = this._oModel.getProperty("/postedYear") || new Date().getFullYear().toString();
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
                    oRouter.navTo("wmGoodsIssue");
                }
            }
        }
    });
});
