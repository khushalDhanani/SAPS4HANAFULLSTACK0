sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "saps4hana/fiori/service/BarcodeScanService",
    "saps4hana/fiori/modules/wm/warehouse-scan-to/service/WarehouseScanToService"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    History,
    BarcodeScanService,
    WarehouseScanToService
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
                hasTR: false,
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

            return this.loadDetail(sDocType, sNumber);
        },

        _resetState: function () {
            var oModel = this.getModel("scanView");
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
            oModel.setProperty("/hasResult", false);
            oModel.setProperty("/result", null);
            oModel.setProperty("/resultMessage", "");
            oModel.setProperty("/canRetryMigo", false);
            this.onCloseMessage();
        },

        _showError: function (sText) {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/hasMessage", true);
            oModel.setProperty("/messageText", sText);
            oModel.setProperty("/messageType", "Error");
            oModel.setProperty("/hasTR", false);
            oModel.setProperty("/tr", null);
            oModel.setProperty("/canSubmit", false);
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

                oModel.setProperty("/tr", oDetail);
                oModel.setProperty("/hasTR", true);
                oModel.setProperty("/hasResult", false);
                oModel.setProperty("/result", null);
                oModel.setProperty("/trItems", oDetail.Items || []);
                oModel.setProperty("/selectedTbpos", oDetail.TRItem || "");
                oModel.setProperty("/scannedTR", oDetail.TRNumber || sNumber);
                oModel.setProperty("/docType", "TR");

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

                that._updateSerialsStatus();
                that._validateForm();
                that._playAudio("success");
                MessageToast.show(that.getText(oDetail.TRItem ? "scanToMsgTRLoaded" : "scanToMsgSelectItem"));
                return oDetail;
            }).catch(function (oErr) {
                that._showError(oErr.message || that.getText("scanToErrLookupFailed"));
            });
        },

        onExit: function () {
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
            } else if (nQty > nOpen) {
                oModel.setProperty("/qtyValueState", "Error");
                oModel.setProperty("/qtyValueStateText", this.getText("scanToErrQtyExceeds", [nOpen]));
            } else {
                oModel.setProperty("/qtyValueState", "None");
                oModel.setProperty("/qtyValueStateText", "");
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

            var nQty = parseFloat(oModel.getProperty("/pickQty") || 0);
            var nOpen = parseFloat(oTR.OpenQty || 0);

            if (isNaN(nQty) || nQty <= 0 || nQty > nOpen) {
                oModel.setProperty("/canSubmit", false);
                return false;
            }

            if (oTR.IsBatchManaged) {
                var sBatch = (oModel.getProperty("/batch") || "").trim();
                if (!sBatch) {
                    oModel.setProperty("/canSubmit", false);
                    return false;
                }
            }

            if (oTR.IsSerialManaged) {
                var aSerials = oModel.getProperty("/serials") || [];
                var nRequired = Math.round(nQty);
                if (aSerials.length !== nRequired) {
                    oModel.setProperty("/canSubmit", false);
                    return false;
                }
            }

            oModel.setProperty("/canSubmit", true);
            return true;
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
                autoConfirm: bAutoConfirm,
                autoPostMigo: bAutoPostMigo,
                CompleteReservation: oModel.getProperty("/completeReservation") === true,
                storageUnit: ""
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
                oResult.MovementType = oResult.MovementType || (oTR ? oTR.MovementType : "");
                oResult.TransferRequirement = oResult.TransferRequirement || (oTR ? (oTR.TRNumber || oTR.TransferRequirement) : oPayload.tbnum);
                oResult.ReservationNo = oResult.ReservationNo || (oTR ? oTR.ReservationNo : "");
                oResult.ConfirmedBy = oResult.ConfirmedBy || "";
                oResult.ConfirmationNumber = oResult.ConfirmationNumber || oResult.TransferOrder;

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
            var oResult = oModel.getProperty("/result");
            if (!oResult) return Promise.resolve(null);

            var that = this;
            oModel.setProperty("/canRetryMigo", false);

            var oPayload = {
                ReservationNo: oResult.ReservationNo,
                ReservationItem: oResult.ReservationItem || "0001",
                TransferOrder: oResult.TransferOrder,
                MovementType: oResult.MovementType,
                Material: oResult.Material,
                Quantity: oResult.Quantity,
                Unit: oResult.Unit,
                CompleteReservation: oModel.getProperty("/completeReservation") === true,
                ProcessId: oResult.ProcessId || ""
            };
            var sBatch = oResult.Batch || oModel.getProperty("/batch");
            if (sBatch) {
                oPayload.Batch = sBatch;
            }
            var aSerials = oResult.Serials || (oModel.getProperty("/serials") || []).map(function (item) { return item.serial; });
            if (aSerials && aSerials.length > 0) {
                oPayload.Serials = aSerials;
            }

            return WarehouseScanToService.postMigoGoodsMovement(oPayload).then(function (oMigoRes) {
                that._playAudio("success");
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
                oModel.setProperty("/canRetryMigo", true);
                var oUpdatedResult = Object.assign({}, oResult, {
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
        }
    });
});
