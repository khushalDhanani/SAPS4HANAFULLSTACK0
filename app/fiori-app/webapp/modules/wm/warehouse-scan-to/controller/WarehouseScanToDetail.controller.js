sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "saps4hana/fiori/service/BarcodeScanService",
    "saps4hana/fiori/modules/wm/warehouse-scan-to/service/WarehouseScanToService",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    History,
    BarcodeScanService,
    WarehouseScanToService,
    SelectDialog,
    StandardListItem
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.warehouse-scan-to.controller.WarehouseScanToDetail", {

        onInit: function () {
            var oViewModel = new JSONModel(this._getInitialState());
            this.setModel(oViewModel, "scanView");

            var oRouter = this.getRouter();
            if (oRouter) {
                var oRoute = oRouter.getRoute("wmWarehouseScanToDetail");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onRouteMatched, this);
                }
                var oRouteWithWh = oRouter.getRoute("wmWarehouseScanToDetailWithWh");
                if (oRouteWithWh) {
                    oRouteWithWh.attachPatternMatched(this._onRouteMatched, this);
                }
            }

            this._scannerHandler = this._onHardwareScan.bind(this);
        },

        _getInitialState: function () {
            return {
                lgnum: "",
                docType: "TR",
                scannedTR: "",
                trItems: [],
                selectedTbpos: "",
                completeReservation: false,
                autoConfirm: true,
                autoPostMigo: true,
                canRetryMigo: false,
                audioEnabled: true,
                receivingPlant: "",
                receivingPlantSource: "",
                receivingStorageLocation: "",
                receivingStorageLocationSource: "",
                costCenter: "",
                costCenterValueState: "None",
                costCenterValueStateText: "",
                assetNo: "",
                assetValueState: "None",
                assetValueStateText: "",
                subNumber: "",
                orderId: "",
                orderIdValueState: "None",
                orderIdValueStateText: "",
                isBackflush: false,
                hasTR: false,
                effectiveMovementType: "",
                reservationMovementType: "",
                allowMismatchedTR: false,
                isMovementMismatched: false,
                hasMessage: false,
                messageText: "",
                messageType: "Information",
                tr: null,
                pickQty: 0,
                qtyValueState: "None",
                qtyValueStateText: "",
                batch: "",
                batchValueState: "None",
                batchValueStateText: "",
                sourceStorageType: "",
                sourceStorageBin: "",
                suggestedBatches: [],
                fifoBatch: "",
                fifoBatchRecommendation: "",
                isFifoApplied: false,
                suggestedSerials: [],
                serialInput: "",
                serials: [],
                serialsCount: 0,
                serialsStatusText: "",
                serialsStatusState: "None",
                canSubmit: false,
                scanVerificationStatusText: "READY FOR TO",
                scanVerificationStatusState: "Success",
                hasResult: false,
                resultMessage: "",
                result: null
            };
        },

        _onRouteMatched: function (oEvent) {
            if (BarcodeScanService && typeof BarcodeScanService.attachHardwareScanner === "function") {
                BarcodeScanService.attachHardwareScanner(this._scannerHandler);
            }

            var oArgs = (oEvent && typeof oEvent.getParameter === "function") ? (oEvent.getParameter("arguments") || {}) : {};
            var sLgnum = (oArgs.lgnum || "").trim().toUpperCase();
            var sDocType = (oArgs.docType || "").trim().toUpperCase();
            var sNumber = (oArgs.number || "").trim();

            this._resetState();

            // Validate docType (TR or RES)
            if (sDocType !== "TR" && sDocType !== "RES") {
                this._showError(this.getText("scanToErrSelectDocType"));
                return;
            }

            // Validate number (digits only, max 10)
            if (!/^\d{1,10}$/.test(sNumber)) {
                this._showError(this.getText("scanToErrNotANumber"));
                return;
            }

            var oModel = this.getModel("scanView");
            oModel.setProperty("/docType", sDocType);
            oModel.setProperty("/scannedTR", sNumber);
            oModel.setProperty("/lgnum", sLgnum);

            return this.loadDetail(sDocType, sNumber);
        },

        _resetState: function () {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/lgnum", "");
            oModel.setProperty("/hasTR", false);
            oModel.setProperty("/tr", null);
            oModel.setProperty("/trItems", []);
            oModel.setProperty("/selectedTbpos", "");
            oModel.setProperty("/pickQty", 0);
            oModel.setProperty("/qtyValueState", "None");
            oModel.setProperty("/qtyValueStateText", "");
            oModel.setProperty("/batch", "");
            oModel.setProperty("/batchValueState", "None");
            oModel.setProperty("/batchValueStateText", "");
            oModel.setProperty("/sourceStorageType", "");
            oModel.setProperty("/sourceStorageBin", "");
            oModel.setProperty("/suggestedBatches", []);
            oModel.setProperty("/fifoBatch", "");
            oModel.setProperty("/fifoBatchRecommendation", "");
            oModel.setProperty("/isFifoApplied", false);
            oModel.setProperty("/suggestedSerials", []);
            oModel.setProperty("/serialInput", "");
            oModel.setProperty("/serials", []);
            oModel.setProperty("/serialsCount", 0);
            oModel.setProperty("/canSubmit", false);
            oModel.setProperty("/scanVerificationStatusText", "");
            oModel.setProperty("/scanVerificationStatusState", "None");
            oModel.setProperty("/hasResult", false);
            oModel.setProperty("/result", null);
            oModel.setProperty("/resultMessage", "");
            oModel.setProperty("/receivingPlant", "");
            oModel.setProperty("/receivingPlantSource", "");
            oModel.setProperty("/receivingStorageLocation", "");
            oModel.setProperty("/receivingStorageLocationSource", "");
            oModel.setProperty("/effectiveMovementType", "");
            oModel.setProperty("/reservationMovementType", "");
            oModel.setProperty("/allowMismatchedTR", false);
            oModel.setProperty("/isMovementMismatched", false);
            oModel.setProperty("/canRetryMigo", false);
            this.onCloseMessage();
        },

        _showWarning: function (sText) {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/hasMessage", true);
            oModel.setProperty("/messageText", sText);
            oModel.setProperty("/messageType", "Warning");
        },

        _showError: function (sText) {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/hasMessage", true);
            oModel.setProperty("/messageText", sText);
            oModel.setProperty("/messageType", "Error");
            oModel.setProperty("/hasTR", false);
            oModel.setProperty("/tr", null);
            oModel.setProperty("/canSubmit", false);
            oModel.setProperty("/scanVerificationStatusText", "REJECTED");
            oModel.setProperty("/scanVerificationStatusState", "Error");
            this._playAudio("error");
        },

        loadDetail: function (sDocType, sNumber, sTbposArg) {
            var oModel = this.getModel("scanView");
            var sLgnum = oModel.getProperty("/lgnum") || "";
            var sTbpos = typeof sTbposArg === "string" ? sTbposArg : "";
            var that = this;

            this.onCloseMessage();

            return WarehouseScanToService.lookupTR(sNumber, sLgnum, sDocType, sTbpos).then(function (oDetail) {
                var sTRNumber = oDetail ? (oDetail.TRNumber || oDetail.TransferRequirement) : null;
                if (!oDetail || !sTRNumber) {
                    throw new Error(that.getText("scanToErrNotFound"));
                }

                // Normalize properties
                oDetail.TRNumber = sTRNumber;
                oDetail.TransferRequirement = sTRNumber;
                if (oDetail.OpenQty === undefined && oDetail.OpenQuantity !== undefined) {
                    oDetail.OpenQty = parseFloat(oDetail.OpenQuantity);
                }
                if (oDetail.MaterialDescription === undefined && oDetail.MaterialName !== undefined) {
                    oDetail.MaterialDescription = oDetail.MaterialName;
                }
                if (oDetail.TargetQty === undefined && oDetail.RequiredQuantity !== undefined) {
                    oDetail.TargetQty = parseFloat(oDetail.RequiredQuantity);
                }
                if (oDetail.DestinationType === undefined && oDetail.DestinationStorageType !== undefined) {
                    oDetail.DestinationType = oDetail.DestinationStorageType;
                }
                if (oDetail.DestinationBin === undefined && oDetail.DestinationStorageBin !== undefined) {
                    oDetail.DestinationBin = oDetail.DestinationStorageBin;
                }

                // Validate SAP TR data (do not simply trust frontend payload)
                if (sLgnum && oDetail.WarehouseNumber && oDetail.WarehouseNumber !== sLgnum) {
                    throw new Error(that.getText("scanToErrWrongWarehouse", [oDetail.WarehouseNumber, sLgnum]));
                }
                if (oDetail.Status === "E" || oDetail.Status === "04" || oDetail.Status === "05" || oDetail.DeliveryCompleted) {
                    throw new Error(that.getText("scanToErrTrCompleted"));
                }
                var nOpenQtyCheck = parseFloat(oDetail.OpenQty !== undefined ? oDetail.OpenQty : (oDetail.OpenQuantity !== undefined ? oDetail.OpenQuantity : 0));
                if (oDetail.TRItem && nOpenQtyCheck <= 0) {
                    throw new Error(that.getText("scanToErrTrCompleted"));
                }
                if (oDetail.TRItem && oDetail.Material !== undefined && !String(oDetail.Material).trim()) {
                    throw new Error(that.getText("scanToErrWrongMaterial"));
                }
                if (oDetail.TRItem && oDetail.RequiredQuantity !== undefined && !(oDetail.RequiredQuantity > 0) && !(oDetail.TargetQty > 0)) {
                    throw new Error(that.getText("scanToErrQtyZero"));
                }

                oModel.setProperty("/tr", oDetail);
                oModel.setProperty("/hasTR", true);
                oModel.setProperty("/scanVerificationStatusText", "READY FOR TO");
                oModel.setProperty("/scanVerificationStatusState", "Success");
                oModel.setProperty("/hasResult", false);
                oModel.setProperty("/result", null);
                oModel.setProperty("/trItems", oDetail.Items || []);
                oModel.setProperty("/selectedTbpos", oDetail.TRItem || "");
                oModel.setProperty("/scannedTR", oDetail.TRNumber || sNumber);
                oModel.setProperty("/docType", "TR");

                var sEffectiveMvt = oDetail.ReservationMovementType || oDetail.MovementType;
                oModel.setProperty("/effectiveMovementType", sEffectiveMvt);
                oModel.setProperty("/reservationMovementType", oDetail.ReservationMovementType || "");
                oModel.setProperty("/allowMismatchedTR", Boolean(oDetail.AllowMismatchedTR));

                var bMismatch = Boolean(oDetail.ReservationMovementType && oDetail.MovementType && oDetail.ReservationMovementType !== oDetail.MovementType);
                oModel.setProperty("/isMovementMismatched", bMismatch);

                if (oDetail.Warning) {
                    that._showWarning(oDetail.Warning);
                } else if (bMismatch) {
                    that._showWarning("TR movement " + oDetail.MovementType + " does not match reservation movement " + oDetail.ReservationMovementType);
                }

                // Initialize pick quantity to open TR quantity
                var nOpenQty = parseFloat(oDetail.OpenQty || 0);
                oModel.setProperty("/pickQty", nOpenQty);
                oModel.setProperty("/qtyValueState", "None");
                oModel.setProperty("/qtyValueStateText", "");

                // Initialize FIFO suggested batches and serials
                var aSuggestedBatches = oDetail.SuggestedBatches || [];
                var sFifoBatch = oDetail.FifoBatch || (aSuggestedBatches[0] ? aSuggestedBatches[0].Batch : "");
                var aSuggestedSerials = oDetail.SuggestedSerials || [];

                oModel.setProperty("/suggestedBatches", aSuggestedBatches);
                oModel.setProperty("/fifoBatch", sFifoBatch);
                oModel.setProperty("/fifoBatchRecommendation", aSuggestedBatches[0] ? aSuggestedBatches[0].Recommendation : "");
                oModel.setProperty("/suggestedSerials", aSuggestedSerials);

                // Initialize batch: if TR specifies a batch use it, else auto-suggest FIFO batch
                var sInitialBatch = oDetail.Batch || sFifoBatch || "";
                var oInitialMatch = aSuggestedBatches.find(function (b) { return b.Batch === sInitialBatch; });
                oModel.setProperty("/batch", sInitialBatch);
                oModel.setProperty("/sourceStorageType", oInitialMatch ? oInitialMatch.StorageType : (oDetail.SourceStorageType || ""));
                oModel.setProperty("/sourceStorageBin", oInitialMatch ? oInitialMatch.StorageBin : (oDetail.SourceStorageBin || ""));
                oModel.setProperty("/isFifoApplied", Boolean(!oDetail.Batch && sFifoBatch));
                oModel.setProperty("/batchValueState", "None");
                oModel.setProperty("/batchValueStateText", "");

                // Reset serials
                oModel.setProperty("/serials", []);
                oModel.setProperty("/serialInput", "");
                oModel.setProperty("/serialsCount", 0);

                // Initialize destination & account assignment
                oModel.setProperty("/receivingPlant", oDetail.ReceivingPlant || "");
                oModel.setProperty("/receivingPlantSource", oDetail.ReceivingPlantSource || "");
                oModel.setProperty("/recPlantValueState", "None");
                oModel.setProperty("/recPlantValueStateText", "");
                oModel.setProperty("/receivingStorageLocation", oDetail.ReceivingStorageLocation || "");
                oModel.setProperty("/receivingStorageLocationSource", oDetail.ReceivingStorageLocationSource || "");
                oModel.setProperty("/recSLocValueState", "None");
                oModel.setProperty("/recSLocValueStateText", "");
                oModel.setProperty("/costCenter", oDetail.CostCenter || "");
                oModel.setProperty("/costCenterValueState", "None");
                oModel.setProperty("/costCenterValueStateText", "");
                oModel.setProperty("/assetNo", oDetail.AssetNo || "");
                oModel.setProperty("/assetValueState", "None");
                oModel.setProperty("/assetValueStateText", "");
                oModel.setProperty("/subNumber", oDetail.SubNumber || "0000");
                oModel.setProperty("/orderId", oDetail.OrderID || "");
                oModel.setProperty("/orderIdValueState", "None");
                oModel.setProperty("/orderIdValueStateText", "");
                oModel.setProperty("/isBackflush", Boolean(oDetail.Backflush));

                that._updateSerialsStatus();
                that._validateForm();
                that._playAudio("success");
                MessageToast.show(that.getText(oDetail.TRItem ? "scanToMsgTRLoaded" : "scanToMsgSelectItem"));

                if (oDetail.WarehouseNumber) {
                    oModel.setProperty("/lgnum", oDetail.WarehouseNumber);
                    var oRouter = that.getRouter();
                    if (oRouter && !sLgnum) {
                        oRouter.navTo("wmWarehouseScanToDetailWithWh", {
                            lgnum: oDetail.WarehouseNumber,
                            docType: sDocType,
                            number: sNumber
                        }, true /* bNoHistory */);
                    }
                }

                return oDetail;
            }).catch(function (oErr) {
                var aRaw = oErr.details || (oErr.errorJson && oErr.errorJson.error && oErr.errorJson.error.details) || [];
                var aCandidates = (Array.isArray(aRaw) ? aRaw : []).map(function (d) {
                    if (d && d.lgnum) return d;
                    if (d && d.message) {
                        try {
                            var parsed = JSON.parse(d.message);
                            if (parsed && parsed.lgnum) return parsed;
                        } catch (e) {
                            // not JSON string
                        }
                    }
                    if (d && d.innererror && d.innererror.lgnum) return d.innererror;
                    return d;
                });
                if ((oErr.status === 409 || oErr.code === "409" || oErr.status === 300 || oErr.code === "300") && aCandidates && aCandidates.length > 1) {
                    that._showWarehousePicker(aCandidates, sDocType, sNumber);
                    return;
                }
                that._showError(oErr.message || that.getText("scanToErrLookupFailed"));
            });
        },

        _destroyWarehouseDialog: function () {
            if (this._oWarehouseDialog) {
                this._oWarehouseDialog.destroy();
                this._oWarehouseDialog = null;
            }
        },

        _showWarehousePicker: function (aCandidates, sDocType, sNumber) {
            var that = this;
            this._destroyWarehouseDialog();

            var oSelectDialog = new SelectDialog({
                title: this.getText("scanToWarehousePickerTitle"),
                noDataText: this.getText("scanToNoWarehousesFound"),
                rememberSelections: false,
                confirm: function (oEvent) {
                    var oSelectedItem = oEvent.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sStatusCode = oSelectedItem.data("statusCode");
                        if (sStatusCode === "E") {
                            MessageToast.show(that.getText("scanToErrTrCompletedNonSelectable"));
                            setTimeout(function () {
                                that._showWarehousePicker(aCandidates, sDocType, sNumber);
                            }, 300);
                            return;
                        }
                        var sChosenWh = oSelectedItem.data("lgnum") || oSelectedItem.getTitle();
                        that._destroyWarehouseDialog();
                        that._onWarehouseChosen(sChosenWh, sDocType, sNumber);
                    } else {
                        that._destroyWarehouseDialog();
                    }
                },
                cancel: function () {
                    that._destroyWarehouseDialog();
                    that._showError(that.getText("scanToErrWarehouseSelectionCancelled"));
                }
            });

            aCandidates.forEach(function (c) {
                var bCompleted = c.statusCode === "E";
                var sStatusText = bCompleted ? that.getText("scanToStatusCompleted") : that.getText("scanToStatusOpen");
                var sDesc = (c.movementType ? "Mvt: " + c.movementType + " | " : "") +
                            (c.createdDate ? "Date: " + c.createdDate + " | " : "") +
                            sStatusText;
                var oItem = new StandardListItem({
                    title: c.lgnum + (c.plant ? " (Plant " + c.plant + ")" : ""),
                    description: sDesc,
                    info: sStatusText,
                    infoState: bCompleted ? "None" : "Success",
                    icon: bCompleted ? "sap-icon://status-completed" : "sap-icon://factory",
                    type: bCompleted ? "Inactive" : "Active"
                });
                oItem.data("lgnum", c.lgnum);
                oItem.data("statusCode", c.statusCode);
                oSelectDialog.addItem(oItem);
            });

            this.getView().addDependent(oSelectDialog);
            this._oWarehouseDialog = oSelectDialog;
            oSelectDialog.open();
        },

        _onWarehouseChosen: function (sChosenWh, sDocType, sNumber) {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/lgnum", sChosenWh);
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("wmWarehouseScanToDetailWithWh", {
                    lgnum: sChosenWh,
                    docType: sDocType,
                    number: sNumber
                }, true /* bNoHistory */);
            }
            return this.loadDetail(sDocType, sNumber);
        },

        onExit: function () {
            if (this._oWarehouseDialog) {
                this._oWarehouseDialog.destroy();
                this._oWarehouseDialog = null;
            }
            if (BarcodeScanService && typeof BarcodeScanService.detachHardwareScanner === "function") {
                BarcodeScanService.detachHardwareScanner(this._scannerHandler);
            }
        },

        _onHardwareScan: function (sScanned) {
            if (!sScanned) return;
            var sVal = sScanned.trim();
            var oModel = this.getModel("scanView");
            var bHasTR = oModel.getProperty("/hasTR");
            var oTR = oModel.getProperty("/tr");

            // If TR is loaded and material is serial-managed, capture scan as serial
            if (bHasTR && oTR && oTR.IsSerialManaged) {
                oModel.setProperty("/serialInput", sVal);
                this.onAddSerial();
            }
        },

        onNavBack: function () {
            var oHistory = History ? History.getInstance() : null;
            var sPreviousHash = oHistory && typeof oHistory.getPreviousHash === "function" ? oHistory.getPreviousHash() : undefined;

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                var oRouter = this.getRouter();
                if (oRouter) {
                    oRouter.navTo("wmWarehouseScanTo", {}, true /*no history*/);
                }
            }
        },

        onReset: function () {
            this.onNavBack();
        },

        onScanNextTR: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("wmWarehouseScanTo", {}, true);
            }
        },

        onToggleAudio: function () {
            var oModel = this.getModel("scanView");
            var bEnabled = !oModel.getProperty("/audioEnabled");
            oModel.setProperty("/audioEnabled", bEnabled);
            MessageToast.show(this.getText(bEnabled ? "trToAudioEnabled" : "trToAudioMuted"));
        },

        onCloseMessage: function () {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/hasMessage", false);
            oModel.setProperty("/messageText", "");
        },

        onAutoConfirmChange: function (oEvent) {
            var bState = oEvent.getParameter("state");
            this.getModel("scanView").setProperty("/autoConfirm", bState);
        },

        onAutoMigoChange: function (oEvent) {
            var bState = oEvent.getParameter("state");
            this.getModel("scanView").setProperty("/autoPostMigo", bState);
        },

        onTRItemChange: function (oEvent) {
            var sTbpos = oEvent.getParameter("selectedItem") ? oEvent.getParameter("selectedItem").getKey() : oEvent.getSource().getSelectedKey();
            this.getModel("scanView").setProperty("/selectedTbpos", sTbpos);
            var sNumber = this.getModel("scanView").getProperty("/scannedTR");
            var sDocType = this.getModel("scanView").getProperty("/docType") || "TR";
            if (sTbpos && sNumber) {
                this.loadDetail(sDocType, sNumber, sTbpos);
            }
        },

        onPickQtyChange: function (oEvent) {
            var oModel = this.getModel("scanView");
            var sVal = oEvent.getParameter("value");
            var nQty = parseFloat(sVal || 0);
            oModel.setProperty("/pickQty", nQty);
            var oTR = oModel.getProperty("/tr");
            var nOpen = oTR ? parseFloat(oTR.OpenQty || 0) : 0;

            if (isNaN(nQty) || nQty <= 0) {
                oModel.setProperty("/qtyValueState", "Error");
                oModel.setProperty("/qtyValueStateText", this.getText("scanToErrQtyZero"));
                oModel.setProperty("/scanVerificationStatusText", "INVALID QUANTITY");
                oModel.setProperty("/scanVerificationStatusState", "Error");
            } else if (nQty > nOpen) {
                oModel.setProperty("/qtyValueState", "Error");
                oModel.setProperty("/qtyValueStateText", this.getText("scanToErrQtyExceeds", [nOpen]));
                oModel.setProperty("/scanVerificationStatusText", "QUANTITY EXCEEDS OPEN TR");
                oModel.setProperty("/scanVerificationStatusState", "Error");
            } else {
                oModel.setProperty("/qtyValueState", "None");
                oModel.setProperty("/qtyValueStateText", "");
                oModel.setProperty("/scanVerificationStatusText", "READY FOR TO");
                oModel.setProperty("/scanVerificationStatusState", "Success");
            }

            this._updateSerialsStatus();
            this._validateForm();
        },

        onSetMaxQty: function () {
            var oModel = this.getModel("scanView");
            var oTR = oModel.getProperty("/tr");
            if (oTR) {
                var nOpen = parseFloat(oTR.OpenQty || 0);
                oModel.setProperty("/pickQty", nOpen);
                oModel.setProperty("/qtyValueState", "None");
                oModel.setProperty("/qtyValueStateText", "");
                oModel.setProperty("/scanVerificationStatusText", "READY FOR TO");
                oModel.setProperty("/scanVerificationStatusState", "Success");
                this._updateSerialsStatus();
                this._validateForm();
            }
        },

        onBatchLiveChange: function (oEvent) {
            var sVal = (oEvent.getParameter("value") || "").trim();
            var oModel = this.getModel("scanView");
            oModel.setProperty("/batch", sVal);
            oModel.setProperty("/isFifoApplied", sVal && sVal === oModel.getProperty("/fifoBatch"));

            var oTR = oModel.getProperty("/tr");
            if (oTR && oTR.IsBatchManaged && !sVal) {
                oModel.setProperty("/batchValueState", "Error");
                oModel.setProperty("/batchValueStateText", this.getText("scanToErrBatchRequired"));
            } else {
                oModel.setProperty("/batchValueState", "None");
                oModel.setProperty("/batchValueStateText", "");
            }

            this._validateForm();
        },

        onApplyFifoBatch: function () {
            var oModel = this.getModel("scanView");
            var sFifo = oModel.getProperty("/fifoBatch");
            var aSuggested = oModel.getProperty("/suggestedBatches") || [];
            var oMatch = aSuggested.find(function (b) { return b.Batch === sFifo; });
            if (sFifo) {
                oModel.setProperty("/batch", sFifo);
                oModel.setProperty("/sourceStorageType", oMatch ? oMatch.StorageType : "");
                oModel.setProperty("/sourceStorageBin", oMatch ? oMatch.StorageBin : "");
                oModel.setProperty("/batchValueState", "None");
                oModel.setProperty("/batchValueStateText", "");
                oModel.setProperty("/isFifoApplied", true);
                this._validateForm();
                MessageToast.show(this.getText("scanToMsgFifoApplied", [sFifo]));
                this._playAudio("success");
            }
        },

        onSuggestionBatchSelected: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (oSelectedItem) {
                var sBatch = oSelectedItem.getKey() || oSelectedItem.getText();
                var oModel = this.getModel("scanView");
                var aSuggested = oModel.getProperty("/suggestedBatches") || [];
                var oMatch = aSuggested.find(function (b) { return b.Batch === sBatch; });
                oModel.setProperty("/batch", sBatch);
                oModel.setProperty("/sourceStorageType", oMatch ? oMatch.StorageType : "");
                oModel.setProperty("/sourceStorageBin", oMatch ? oMatch.StorageBin : "");
                oModel.setProperty("/batchValueState", "None");
                oModel.setProperty("/batchValueStateText", "");
                oModel.setProperty("/isFifoApplied", sBatch === oModel.getProperty("/fifoBatch"));
                this._validateForm();
                MessageToast.show(this.getText("scanToMsgFifoApplied", [sBatch]));
                this._playAudio("success");
            }
        },

        onSelectBatchSuggestion: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext("scanView");
            if (oCtx) {
                var sBatch = oCtx.getProperty("Batch");
                var sType = oCtx.getProperty("StorageType");
                var sBin = oCtx.getProperty("StorageBin");
                var oModel = this.getModel("scanView");
                oModel.setProperty("/batch", sBatch);
                oModel.setProperty("/sourceStorageType", sType || "");
                oModel.setProperty("/sourceStorageBin", sBin || "");
                oModel.setProperty("/batchValueState", "None");
                oModel.setProperty("/batchValueStateText", "");
                oModel.setProperty("/isFifoApplied", sBatch === oModel.getProperty("/fifoBatch"));
                this._validateForm();
                MessageToast.show(this.getText("scanToMsgFifoApplied", [sBatch]));
                this._playAudio("success");
            }
        },

        onAutoFillSerials: function () {
            var oModel = this.getModel("scanView");
            var aSuggested = oModel.getProperty("/suggestedSerials") || [];
            var aSerials = oModel.getProperty("/serials") || [];
            var nPickQty = parseFloat(oModel.getProperty("/pickQty") || 0);
            var nRequired = Math.round(nPickQty);

            if (!aSuggested.length) {
                MessageToast.show(this.getText("scanToNoSerialsAvailable"));
                return;
            }

            var aExistingSet = new Set(aSerials.map(function (s) { return (s.serial || "").toUpperCase(); }));
            var nAddedCount = 0;

            for (var i = 0; i < aSuggested.length && aSerials.length < nRequired; i++) {
                var sCand = aSuggested[i];
                if (!aExistingSet.has(sCand.toUpperCase())) {
                    aSerials.push({
                        index: aSerials.length + 1,
                        serial: sCand
                    });
                    aExistingSet.add(sCand.toUpperCase());
                    nAddedCount++;
                }
            }

            oModel.setProperty("/serials", aSerials);
            oModel.setProperty("/serialsCount", aSerials.length);
            this._updateSerialsStatus();
            this._validateForm();

            if (nAddedCount > 0) {
                MessageToast.show(this.getText("scanToMsgSerialsAutoFilled", [nAddedCount]));
                this._playAudio("success");
            } else {
                MessageToast.show(this.getText("scanToErrSerialLimitReached", [nRequired]));
            }
        },

        onAddSuggestedSerial: function (oEvent) {
            var oSource = oEvent.getSource();
            var sSerial = oSource.getText();
            if (sSerial) {
                var oModel = this.getModel("scanView");
                oModel.setProperty("/serialInput", sSerial);
                this.onAddSerial();
            }
        },

        onAddSerial: function () {
            var oModel = this.getModel("scanView");
            var sSerial = (oModel.getProperty("/serialInput") || "").trim();
            if (!sSerial) return;

            var aSerials = oModel.getProperty("/serials") || [];
            var nPickQty = parseFloat(oModel.getProperty("/pickQty") || 0);
            var nRequired = Math.round(nPickQty);

            // Duplicate check
            var bDuplicate = aSerials.some(function (item) {
                return item.serial.toUpperCase() === sSerial.toUpperCase();
            });

            if (bDuplicate) {
                MessageToast.show(this.getText("scanToErrSerialDuplicate", [sSerial]));
                this._playAudio("warn");
                return;
            }

            if (aSerials.length >= nRequired) {
                MessageToast.show(this.getText("scanToErrSerialLimitReached", [nRequired]));
                this._playAudio("warn");
                return;
            }

            aSerials.push({
                index: aSerials.length + 1,
                serial: sSerial
            });

            oModel.setProperty("/serials", aSerials);
            oModel.setProperty("/serialInput", "");
            oModel.setProperty("/serialsCount", aSerials.length);

            this._updateSerialsStatus();
            this._validateForm();
            this._playAudio("success");
        },

        onRemoveSerial: function (oEvent) {
            var oItem = oEvent.getSource().getParent();
            var oCtx = oItem.getBindingContext("scanView");
            var sPath = oCtx.getPath();
            var nIdx = parseInt(sPath.split("/").pop(), 10);

            var oModel = this.getModel("scanView");
            var aSerials = oModel.getProperty("/serials") || [];
            aSerials.splice(nIdx, 1);

            // Reindex
            aSerials.forEach(function (item, index) {
                item.index = index + 1;
            });

            oModel.setProperty("/serials", aSerials);
            oModel.setProperty("/serialsCount", aSerials.length);

            this._updateSerialsStatus();
            this._validateForm();
        },

        _updateSerialsStatus: function () {
            var oModel = this.getModel("scanView");
            var oTR = oModel.getProperty("/tr");
            if (!oTR || !oTR.IsSerialManaged) return;

            var aSerials = oModel.getProperty("/serials") || [];
            var nPickQty = parseFloat(oModel.getProperty("/pickQty") || 0);
            var nRequired = Math.round(nPickQty);

            var sText = this.getText("scanToSerialsCountText", [aSerials.length, nRequired]);
            var sState = "None";

            if (aSerials.length === nRequired && nRequired > 0) {
                sState = "Success";
            } else if (aSerials.length < nRequired) {
                sState = "Warning";
            } else {
                sState = "Error";
            }

            oModel.setProperty("/serialsStatusText", sText);
            oModel.setProperty("/serialsStatusState", sState);
        },

        _validateForm: function () {
            var oModel = this.getModel("scanView");
            var bHasTR = oModel.getProperty("/hasTR");
            var oTR = oModel.getProperty("/tr");
            if (!bHasTR || !oTR || !oTR.TRItem) {
                oModel.setProperty("/canSubmit", false);
                return false;
            }

            var bMismatch = Boolean(oTR.ReservationMovementType && oTR.MovementType && oTR.ReservationMovementType !== oTR.MovementType);
            var bAllowMismatch = Boolean(oModel.getProperty("/allowMismatchedTR"));
            if (bMismatch && !bAllowMismatch) {
                oModel.setProperty("/canSubmit", false);
                return false;
            }

            // Stock deficit check: if issuing storage location has no physical WM stock and no source bin can be resolved
            if (oTR.StockWarning && !oModel.getProperty("/sourceStorageBin")) {
                oModel.setProperty("/canSubmit", false);
                oModel.setProperty("/scanVerificationStatusText", "STOCK DEFICIT");
                oModel.setProperty("/scanVerificationStatusState", "Error");
                return false;
            }

            var nQty = parseFloat(oModel.getProperty("/pickQty") || 0);
            var nOpen = parseFloat(oTR.OpenQty || 0);

            if (isNaN(nQty) || nQty <= 0) {
                oModel.setProperty("/canSubmit", false);
                oModel.setProperty("/scanVerificationStatusText", "INVALID QUANTITY");
                oModel.setProperty("/scanVerificationStatusState", "Error");
                return false;
            }

            if (nQty > nOpen) {
                oModel.setProperty("/canSubmit", false);
                oModel.setProperty("/scanVerificationStatusText", "QUANTITY EXCEEDS OPEN TR");
                oModel.setProperty("/scanVerificationStatusState", "Error");
                return false;
            }

            if (oTR.IsBatchManaged) {
                var sBatch = (oModel.getProperty("/batch") || "").trim();
                if (!sBatch) {
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING BATCH");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
            }

            if (oTR.IsSerialManaged) {
                var aSerials = oModel.getProperty("/serials") || [];
                var nRequired = Math.round(nQty);
                if (aSerials.length !== nRequired) {
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING SERIALS");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
            }

            var sEffectiveMvt = (oModel.getProperty("/effectiveMovementType") || oTR.MovementType || "").trim();

            // Movement 301 (Plant to Plant Transfer) requires Receiving Plant
            if (sEffectiveMvt === "301") {
                var sRecPlant = (oModel.getProperty("/receivingPlant") || "").trim();
                if (!sRecPlant) {
                    oModel.setProperty("/recPlantValueState", "Error");
                    oModel.setProperty("/recPlantValueStateText", this.getText("scanToErrReceivingPlantRequired"));
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                if (sRecPlant === (oTR.Plant || "").trim()) {
                    oModel.setProperty("/recPlantValueState", "Error");
                    oModel.setProperty("/recPlantValueStateText", this.getText("scanToErrReceivingPlantSame"));
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                oModel.setProperty("/recPlantValueState", "None");
                oModel.setProperty("/recPlantValueStateText", "");
            }

            // Movement 311 (Storage Location Transfer) requires Receiving Storage Location
            if (sEffectiveMvt === "311") {
                var sRecSLoc = (oModel.getProperty("/receivingStorageLocation") || "").trim();
                if (!sRecSLoc) {
                    oModel.setProperty("/recSLocValueState", "Error");
                    oModel.setProperty("/recSLocValueStateText", this.getText("scanToErrReceivingSLocRequired"));
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                if (sRecSLoc === (oTR.StorageLocation || "").trim()) {
                    oModel.setProperty("/recSLocValueState", "Error");
                    oModel.setProperty("/recSLocValueStateText", "Receiving Storage Location must be different from Issuing Storage Location");
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                oModel.setProperty("/recSLocValueState", "None");
                oModel.setProperty("/recSLocValueStateText", "");
            }

            // Movement 201 (Goods Issue to Cost Center) requires Cost Center
            if (sEffectiveMvt === "201") {
                var sCostCenter = (oModel.getProperty("/costCenter") || "").trim();
                if (!sCostCenter) {
                    oModel.setProperty("/costCenterValueState", "Error");
                    oModel.setProperty("/costCenterValueStateText", this.getText("scanToErrCostCenterRequired"));
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                oModel.setProperty("/costCenterValueState", "None");
                oModel.setProperty("/costCenterValueStateText", "");
            }

            // Movement 241 (GI to Asset) requires Asset Number
            if (sEffectiveMvt === "241") {
                var sAssetNo = (oModel.getProperty("/assetNo") || "").trim();
                if (!sAssetNo) {
                    oModel.setProperty("/assetValueState", "Error");
                    oModel.setProperty("/assetValueStateText", this.getText("scanToErrAssetNoRequired"));
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                oModel.setProperty("/assetValueState", "None");
                oModel.setProperty("/assetValueStateText", "");
            }

            // Movement 261 (Goods Issue to Order) requires Order Number
            if (sEffectiveMvt === "261") {
                var sOrderId = (oModel.getProperty("/orderId") || "").trim();
                if (!sOrderId) {
                    oModel.setProperty("/orderIdValueState", "Error");
                    oModel.setProperty("/orderIdValueStateText", this.getText("resErrOrderMandatory"));
                    oModel.setProperty("/canSubmit", false);
                    oModel.setProperty("/scanVerificationStatusText", "PENDING DESTINATION");
                    oModel.setProperty("/scanVerificationStatusState", "Warning");
                    return false;
                }
                oModel.setProperty("/orderIdValueState", "None");
                oModel.setProperty("/orderIdValueStateText", "");
            }

            oModel.setProperty("/canSubmit", true);
            oModel.setProperty("/scanVerificationStatusText", "READY FOR TO");
            oModel.setProperty("/scanVerificationStatusState", "Success");
            return true;
        },

        onReceivingPlantLiveChange: function (oEvent) {
            if (oEvent && typeof oEvent.getParameter === "function") {
                var sVal = (oEvent.getParameter("value") || "").trim().toUpperCase();
                this.getModel("scanView").setProperty("/receivingPlant", sVal);
            }
            this._validateForm();
        },

        onReceivingSLocLiveChange: function (oEvent) {
            if (oEvent && typeof oEvent.getParameter === "function") {
                var sVal = (oEvent.getParameter("value") || "").trim().toUpperCase();
                this.getModel("scanView").setProperty("/receivingStorageLocation", sVal);
            }
            this._validateForm();
        },

        onCostCenterLiveChange: function (oEvent) {
            if (oEvent && typeof oEvent.getParameter === "function") {
                var sVal = (oEvent.getParameter("value") || "").trim().toUpperCase();
                this.getModel("scanView").setProperty("/costCenter", sVal);
            }
            this._validateForm();
        },

        onAssetNoLiveChange: function (oEvent) {
            if (oEvent && typeof oEvent.getParameter === "function") {
                var sVal = (oEvent.getParameter("value") || "").trim();
                this.getModel("scanView").setProperty("/assetNo", sVal);
            }
            this._validateForm();
        },

        onOrderIdLiveChange: function (oEvent) {
            if (oEvent && typeof oEvent.getParameter === "function") {
                var sVal = (oEvent.getParameter("value") || "").trim();
                this.getModel("scanView").setProperty("/orderId", sVal);
            }
            this._validateForm();
        },

        onCameraScanBatch: function () {
            var that = this;
            if (BarcodeScanService && typeof BarcodeScanService.openCameraScanner === "function") {
                BarcodeScanService.openCameraScanner(this.getText("scanToBtnCameraBatch"), function (sBarcode) {
                    if (sBarcode) {
                        that.getModel("scanView").setProperty("/batch", sBarcode.trim());
                        that._validateForm();
                    }
                });
            }
        },

        onCameraScanSerial: function () {
            var that = this;
            if (BarcodeScanService && typeof BarcodeScanService.openCameraScanner === "function") {
                BarcodeScanService.openCameraScanner(this.getText("scanToBtnCameraSerial"), function (sBarcode) {
                    if (sBarcode) {
                        that.getModel("scanView").setProperty("/serialInput", sBarcode.trim());
                        that.onAddSerial();
                    }
                });
            }
        },

        onProcessTO: function () {
            if (!this._validateForm()) {
                this._showError(this.getText("scanToErrValidationFailed"));
                return Promise.resolve(null);
            }

            var oModel = this.getModel("scanView");
            var oTR = oModel.getProperty("/tr");
            var sLgnum = oModel.getProperty("/lgnum") || "";
            var nQty = parseFloat(oModel.getProperty("/pickQty"));
            var bAutoConfirm = oModel.getProperty("/autoConfirm");
            var bAutoPostMigo = oModel.getProperty("/autoPostMigo");
            var sBatch = oModel.getProperty("/batch");
            var aSerials = (oModel.getProperty("/serials") || []).map(function (item) {
                return item.serial;
            });

            var oPayload = {
                lgnum: sLgnum,
                tbnum: oTR.TRNumber || oTR.TransferRequirement,
                tbpos: oTR.TRItem,
                qty: nQty,
                unit: oTR.Unit,
                batch: sBatch,
                serials: aSerials,
                sourceStorageType: oModel.getProperty("/sourceStorageType") || "",
                sourceStorageBin: oModel.getProperty("/sourceStorageBin") || "",
                receivingPlant: (oModel.getProperty("/receivingPlant") || "").trim(),
                receivingStorageLocation: (oModel.getProperty("/receivingStorageLocation") || "").trim(),
                costCenter: (oModel.getProperty("/costCenter") || "").trim(),
                assetNo: (oModel.getProperty("/assetNo") || "").trim(),
                subNumber: (oModel.getProperty("/subNumber") || "").trim(),
                orderId: (oModel.getProperty("/orderId") || "").trim(),
                autoConfirm: bAutoConfirm,
                autoPostMigo: bAutoPostMigo,
                CompleteReservation: oModel.getProperty("/completeReservation") === true,
                storageUnit: "",
                ReservationMovementType: oTR.ReservationMovementType || "",
                ReservationNo: oTR.ReservationNo || "",
                ReservationItem: oTR.ReservationItem || ""
            };

            var that = this;
            oModel.setProperty("/canSubmit", false);

            return WarehouseScanToService.createTOFromTR(oPayload).then(function (oResult) {
                that._playAudio("success");

                // Normalize and enrich properties for UI panelResult
                oResult.Confirmed = Boolean(oResult.Confirmed);
                oResult.IsConfirmed = Boolean(oResult.Confirmed || oResult.IsConfirmed || oResult.Status === "04" || oResult.Status === "05");
                oResult.StatusText = oResult.StatusText || (oResult.Status === "05" ? "Goods Issue Posted" : (oResult.Status === "04" ? "TO Confirmed" : (oResult.Status === "90" ? "Goods Issue Error" : (oResult.Status === "13" ? "TO Confirmation Error" : "TO Created"))));
                oResult.Material = oResult.Material || (oTR ? oTR.Material : "");
                oResult.MaterialName = oResult.MaterialName || (oTR ? (oTR.MaterialDescription || oTR.MaterialName) : "");
                oResult.Quantity = (oResult.Quantity !== undefined && oResult.Quantity !== null) ? oResult.Quantity : nQty;
                oResult.Unit = oResult.Unit || (oTR ? oTR.Unit : "");
                oResult.Batch = oResult.Batch || sBatch || (oTR ? oTR.Batch : "");
                oResult.MovementType = oResult.ReservationMovementType || oResult.MovementType || (oTR ? (oTR.ReservationMovementType || oTR.MovementType) : "");
                oResult.ReceivingPlant = oResult.ReceivingPlant || oModel.getProperty("/receivingPlant") || "";
                oResult.ReceivingStorageLocation = oResult.ReceivingStorageLocation || oModel.getProperty("/receivingStorageLocation") || "";
                oResult.CostCenter = oResult.CostCenter || oModel.getProperty("/costCenter") || "";
                oResult.AssetNo = oResult.AssetNo || oModel.getProperty("/assetNo") || "";
                oResult.SubNumber = oResult.SubNumber || oModel.getProperty("/subNumber") || "";
                oResult.OrderID = oResult.OrderID || oModel.getProperty("/orderId") || "";
                oResult.TransferRequirement = oResult.TransferRequirement || (oTR ? (oTR.TRNumber || oTR.TransferRequirement) : oPayload.tbnum);
                oResult.ReservationNo = oResult.ReservationNo || (oTR ? oTR.ReservationNo : "");
                oResult.ConfirmedBy = oResult.ConfirmedBy || "";
                oResult.ConfirmationNumber = oResult.ConfirmationNumber || oResult.TransferOrder;
                oResult.Plant = oResult.Plant || (oTR ? (oTR.Plant || oTR.Werks) : "");
                oResult.StorageLocation = oResult.StorageLocation || (oTR ? (oTR.StorageLocation || oTR.Lgort) : "");
                oResult.Serials = (oResult.Serials && oResult.Serials.length > 0) ? oResult.Serials : aSerials;

                var sActionText;
                if (oResult.MaterialDocument) {
                    sActionText = that.getText("scanToMsgSuccessMigoPosted", [
                        oResult.TransferOrder,
                        oResult.MaterialDocument,
                        oResult.MaterialDocYear || ""
                    ]);
                    oModel.setProperty("/canRetryMigo", false);
                } else if (oResult.Status === "90") {
                    sActionText = that.getText("scanToMsgToConfirmedMigoFailed", [
                        oResult.TransferOrder,
                        oResult.ErrorMessage || ""
                    ]);
                    oModel.setProperty("/canRetryMigo", true);
                } else if (oResult.IsConfirmed) {
                    sActionText = that.getText("scanToMsgSuccessConfirmed", [oResult.TransferOrder, oResult.ConfirmationNumber || oResult.TransferOrder]);
                    oModel.setProperty("/canRetryMigo", false);
                } else {
                    sActionText = that.getText("scanToMsgSuccessCreated", [oResult.TransferOrder]);
                    oModel.setProperty("/canRetryMigo", false);
                }

                oModel.setProperty("/hasResult", true);
                oModel.setProperty("/result", oResult);
                oModel.setProperty("/resultMessage", sActionText);
                oModel.setProperty("/hasTR", false);
                oModel.setProperty("/tr", null);

                MessageToast.show(sActionText);
                return oResult;
            }).catch(function (oErr) {
                that._playAudio("error");
                oModel.setProperty("/canSubmit", true);
                MessageBox.error(oErr.message || that.getText("scanToErrCreateFailed"));
            });
        },

        onRetryMigo: function () {
            var oModel = this.getModel("scanView");
            if (oModel.getProperty("/busy")) return Promise.resolve(null);
            var oResult = oModel.getProperty("/result");
            if (!oResult) return Promise.resolve(null);

            var sMvt = (oResult.MovementType || "").trim();
            var sRecPlant = (oResult.ReceivingPlant || oModel.getProperty("/receivingPlant") || "").trim().toUpperCase();
            var sRecSLoc = (oResult.ReceivingStorageLocation || oModel.getProperty("/receivingStorageLocation") || "").trim().toUpperCase();
            var sCostCenter = (oResult.CostCenter || oModel.getProperty("/costCenter") || "").trim().toUpperCase();
            var sAssetNo = (oResult.AssetNo || oModel.getProperty("/assetNo") || "").trim();
            var sSubNo = (oResult.SubNumber || oModel.getProperty("/subNumber") || "").trim();
            var sOrderId = (oResult.OrderID || oModel.getProperty("/orderId") || "").trim();

            if (sMvt === "301") {
                if (!sRecPlant) {
                    this._showError(this.getText("scanToErrReceivingPlantRequired"));
                    return Promise.resolve(null);
                }
                if (sRecPlant === (oResult.Plant || "").trim()) {
                    this._showError(this.getText("scanToErrReceivingPlantSame"));
                    return Promise.resolve(null);
                }
            }
            if (sMvt === "311") {
                if (!sRecSLoc) {
                    this._showError(this.getText("scanToErrReceivingSLocRequired"));
                    return Promise.resolve(null);
                }
                if (sRecSLoc === (oResult.StorageLocation || "").trim()) {
                    this._showError("Receiving Storage Location must be different from Issuing Storage Location");
                    return Promise.resolve(null);
                }
            }
            if (sMvt === "201" && !sCostCenter) {
                this._showError(this.getText("scanToErrCostCenterRequired"));
                return Promise.resolve(null);
            }
            if (sMvt === "241" && !sAssetNo) {
                this._showError(this.getText("scanToErrAssetNoRequired"));
                return Promise.resolve(null);
            }
            if (sMvt === "261" && !sOrderId) {
                this._showError(this.getText("resErrOrderMandatory"));
                return Promise.resolve(null);
            }

            var that = this;
            oModel.setProperty("/busy", true);
            oModel.setProperty("/canRetryMigo", false);

            var oPayload = {
                ReservationNo: oResult.ReservationNo,
                ReservationItem: oResult.ReservationItem || "0001",
                TransferOrder: oResult.TransferOrder,
                MovementType: oResult.MovementType,
                Material: oResult.Material,
                Quantity: oResult.Quantity,
                Unit: oResult.Unit,
                Plant: oResult.Plant || (oResult.IssuingPlant || ""),
                StorageLocation: oResult.StorageLocation || (oResult.IssuingStorageLocation || ""),
                receivingPlant: sRecPlant,
                ReceivingPlant: sRecPlant,
                receivingStorageLocation: sRecSLoc,
                ReceivingStorageLocation: sRecSLoc,
                costCenter: sCostCenter,
                CostCenter: sCostCenter,
                assetNo: sAssetNo,
                AssetNo: sAssetNo,
                subNumber: sSubNo,
                SubNumber: sSubNo,
                orderId: sOrderId,
                OrderID: sOrderId,
                CompleteReservation: oModel.getProperty("/completeReservation") === true,
                ProcessId: oResult.ProcessId || ""
            };
            var sBatch = oResult.Batch || oModel.getProperty("/batch");
            if (sBatch) {
                oPayload.Batch = sBatch;
                oPayload.batch = sBatch;
            }
            var aSerials = oResult.Serials || (oModel.getProperty("/serials") || []).map(function (item) { return item.serial; });
            if (aSerials && aSerials.length > 0) {
                oPayload.Serials = aSerials;
                oPayload.serials = aSerials;
            }

            return WarehouseScanToService.postMigoGoodsMovement(oPayload).then(function (oMigoRes) {
                // Check if backend returned an error status or missing material document
                if (!oMigoRes || !oMigoRes.MaterialDocument || oMigoRes.Status === "90" || oMigoRes.Status_code === "90" || oMigoRes.success === false) {
                    that._playAudio("error");
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/canRetryMigo", true);
                    var sErrMsg = (oMigoRes && (oMigoRes.ErrorMessage || oMigoRes.error || oMigoRes.Message)) || that.getText("scanToErrMigoFailed");
                    var oFailedResult = Object.assign({}, oResult, {
                        ReceivingPlant: sRecPlant,
                        ReceivingStorageLocation: sRecSLoc,
                        CostCenter: sCostCenter,
                        AssetNo: sAssetNo,
                        SubNumber: sSubNo,
                        Status: "90",
                        StatusText: "Goods Issue Error",
                        ErrorMessage: sErrMsg
                    });
                    oModel.setProperty("/result", oFailedResult);
                    MessageBox.error(sErrMsg);
                    return oMigoRes;
                }

                that._playAudio("success");
                oModel.setProperty("/busy", false);
                var sText = that.getText("scanToMsgSuccessMigoPosted", [
                    oResult.TransferOrder,
                    oMigoRes.MaterialDocument,
                    oMigoRes.MaterialDocYear || ""
                ]);

                var oUpdatedResult = Object.assign({}, oResult, {
                    ProcessId: oMigoRes.ProcessId || oResult.ProcessId,
                    MaterialDocument: oMigoRes.MaterialDocument,
                    MaterialDocYear: oMigoRes.MaterialDocYear,
                    Status: oMigoRes.Status || "05",
                    StatusText: oMigoRes.StatusText || "Goods Issue Posted",
                    StockEffect: oMigoRes.StockEffect,
                    Batch: oMigoRes.Batch || oResult.Batch,
                    ReservationNo: oMigoRes.ReservationNo || oResult.ReservationNo,
                    MovementType: oMigoRes.MovementType || oResult.MovementType,
                    ReceivingPlant: sRecPlant,
                    ReceivingStorageLocation: sRecSLoc,
                    CostCenter: sCostCenter,
                    AssetNo: sAssetNo,
                    SubNumber: sSubNo,
                    Confirmed: true,
                    IsConfirmed: true,
                    ConfirmedBy: oResult.ConfirmedBy || "",
                    ConfirmationNumber: oResult.ConfirmationNumber || oResult.TransferOrder,
                    ErrorMessage: ""
                });
                oModel.setProperty("/result", oUpdatedResult);
                oModel.setProperty("/resultMessage", sText);
                oModel.setProperty("/canRetryMigo", false);
                MessageToast.show(sText);
                return oMigoRes;
            }).catch(function (oErr) {
                that._playAudio("error");
                oModel.setProperty("/busy", false);
                oModel.setProperty("/canRetryMigo", true);
                var oUpdatedResult = Object.assign({}, oResult, {
                    ReceivingPlant: sRecPlant,
                    ReceivingStorageLocation: sRecSLoc,
                    CostCenter: sCostCenter,
                    AssetNo: sAssetNo,
                    SubNumber: sSubNo,
                    ErrorMessage: oErr.message
                });
                oModel.setProperty("/result", oUpdatedResult);
                MessageBox.error(oErr.message || that.getText("scanToErrMigoFailed"));
            });
        },

        _playAudio: function (sType) {
            var oModel = this.getModel("scanView");
            if (!oModel || !oModel.getProperty("/audioEnabled")) return;
            if (typeof window === "undefined" || !window.AudioContext) return;

            try {
                var ctx = new (window.AudioContext || window.webkitAudioContext)();
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);

                if (sType === "success") {
                    osc.frequency.setValueAtTime(880, ctx.currentTime);
                    gain.gain.setValueAtTime(0.15, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.12);
                } else if (sType === "warn") {
                    osc.frequency.setValueAtTime(440, ctx.currentTime);
                    gain.gain.setValueAtTime(0.15, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.18);
                } else if (sType === "error") {
                    osc.frequency.setValueAtTime(220, ctx.currentTime);
                    gain.gain.setValueAtTime(0.2, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.35);
                }
            } catch (e) {
                // AudioContext not available or blocked
            }
        },

        formatMovementDisplay: function (sEffMvt, sTrMvt) {
            var sMvt = sEffMvt || sTrMvt || "";
            if (!sMvt) return "";
            var sDesc = "";
            switch (sMvt) {
                case "311": sDesc = "Storage Location Transfer"; break;
                case "201": sDesc = "Goods Issue to Cost Center"; break;
                case "241": sDesc = "Goods Issue to Asset"; break;
                case "301": sDesc = "Plant to Plant Transfer"; break;
                case "261": sDesc = "Goods Issue to Order"; break;
                default: sDesc = ""; break;
            }
            return sDesc ? (sMvt + " - " + sDesc) : sMvt;
        }
    });
});
