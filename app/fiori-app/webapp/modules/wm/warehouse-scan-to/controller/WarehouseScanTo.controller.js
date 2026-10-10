sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/service/BarcodeScanService",
    "saps4hana/fiori/modules/wm/warehouse-scan-to/service/WarehouseScanToService"
], function (
    BaseController,
    JSONModel,
    Fragment,
    MessageBox,
    MessageToast,
    Filter,
    FilterOperator,
    BarcodeScanService,
    WarehouseScanToService
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.warehouse-scan-to.controller.WarehouseScanTo", {

        onInit: function () {
            var oViewModel = new JSONModel({
                lgnum: "W01",
                scannedTR: "",
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
                serialInput: "",
                serials: [],
                serialsCount: 0,
                serialsStatusText: "",
                serialsStatusState: "None",
                canSubmit: false,
                hasResult: false,
                resultMessage: "",
                result: null,
                openTRs: [],
                isLoadingTRs: false
            });

            this.setModel(oViewModel, "scanView");

            var oRouter = this.getRouter();
            if (oRouter) {
                var oRoute = oRouter.getRoute("wmWarehouseScanTo");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onRouteMatched, this);
                }
            }

            this._scannerHandler = this._onHardwareScan.bind(this);
        },

        _onRouteMatched: function () {
            if (BarcodeScanService && typeof BarcodeScanService.attachHardwareScanner === "function") {
                BarcodeScanService.attachHardwareScanner(this._scannerHandler);
            }
            this._focusTRInput();
        },

        onExit: function () {
            if (BarcodeScanService && typeof BarcodeScanService.detachHardwareScanner === "function") {
                BarcodeScanService.detachHardwareScanner(this._scannerHandler);
            }
            if (this._oTrSelectDialog) {
                this._oTrSelectDialog.destroy();
                this._oTrSelectDialog = null;
            }
        },

        _focusTRInput: function () {
            var that = this;
            setTimeout(function () {
                var oInput = that.byId("inputBarcodeTR");
                if (oInput && typeof oInput.focus === "function") {
                    oInput.focus();
                }
            }, 300);
        },

        _onHardwareScan: function (sScanned) {
            if (!sScanned) return;
            var sVal = sScanned.trim();
            var oModel = this.getModel("scanView");
            var bHasTR = oModel.getProperty("/hasTR");
            var oTR = oModel.getProperty("/tr");

            // If TR is already loaded and material is serial-managed, capture scan as serial
            if (bHasTR && oTR && oTR.IsSerialManaged) {
                oModel.setProperty("/serialInput", sVal);
                this.onAddSerial();
                return;
            }

            // Otherwise, treat as TR scan
            oModel.setProperty("/scannedTR", sVal);
            this.onLookupTR();
        },

        onTRLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            this.getModel("scanView").setProperty("/scannedTR", sVal);
            if (!sVal) {
                this.onReset();
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

        _showMessage: function (sText, sType) {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/hasMessage", true);
            oModel.setProperty("/messageText", sText);
            oModel.setProperty("/messageType", sType || "Information");
        },

        onCameraScanTR: function () {
            var that = this;
            if (BarcodeScanService && typeof BarcodeScanService.openCameraScanner === "function") {
                BarcodeScanService.openCameraScanner(this.getText("scanToBtnCameraTR"), function (sBarcode) {
                    if (sBarcode) {
                        that.getModel("scanView").setProperty("/scannedTR", sBarcode.trim());
                        that.onLookupTR();
                    }
                });
            }
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

        onValueHelpTR: function () {
            var oView = this.getView();
            var oModel = this.getModel("scanView");
            var sWh = oModel.getProperty("/lgnum") || "W01";
            var that = this;

            oModel.setProperty("/isLoadingTRs", true);
            WarehouseScanToService.getOpenTRs(sWh).then(function (aTRs) {
                oModel.setProperty("/openTRs", aTRs || []);
                oModel.setProperty("/isLoadingTRs", false);

                if (!that._oTrSelectDialog) {
                    return Fragment.load({
                        id: oView.getId(),
                        name: "saps4hana.fiori.modules.wm.warehouse-scan-to.view.TrSelectDialog",
                        controller: that
                    }).then(function (oDialog) {
                        that._oTrSelectDialog = oDialog;
                        oView.addDependent(oDialog);
                        oDialog.open();
                        return oDialog;
                    });
                } else {
                    that._oTrSelectDialog.open();
                    return that._oTrSelectDialog;
                }
            }).catch(function (oErr) {
                oModel.setProperty("/isLoadingTRs", false);
                that._showMessage(oErr.message || that.getText("scanToErrLoadTRs"), "Error");
            });
        },

        onSearchTRValueHelp: function (oEvent) {
            var sQuery = (oEvent.getParameter("value") || "").trim().toLowerCase();
            var oBinding = oEvent.getSource().getBinding("items");
            if (!oBinding) return;

            if (!sQuery) {
                oBinding.filter([]);
                return;
            }

            var oFilter = new Filter({
                filters: [
                    new Filter("Tbnum", FilterOperator.Contains, sQuery),
                    new Filter("DisplayText", FilterOperator.Contains, sQuery),
                    new Filter("Description", FilterOperator.Contains, sQuery)
                ],
                and: false
            });
            oBinding.filter([oFilter]);
        },

        onConfirmTRValueHelp: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (oSelectedItem) {
                var oCtx = oSelectedItem.getBindingContext("scanView");
                var sTbnum = oCtx ? oCtx.getProperty("Tbnum") : oSelectedItem.getTitle();
                if (sTbnum) {
                    this.getModel("scanView").setProperty("/scannedTR", sTbnum);
                    this.onLookupTR();
                }
            }
        },

        onCancelTRValueHelp: function () {
            // Cancelled
        },

        onLookupTR: function () {
            var oModel = this.getModel("scanView");
            var sScanned = (oModel.getProperty("/scannedTR") || "").trim();
            var sLgnum = oModel.getProperty("/lgnum") || "W01";
            var that = this;

            if (!sScanned) {
                this._showMessage(this.getText("scanToErrEmptyTR"), "Warning");
                this._playAudio("warn");
                return Promise.resolve(null);
            }

            this.onCloseMessage();

            return WarehouseScanToService.lookupTR(sScanned, sLgnum).then(function (oDetail) {
                if (!oDetail || !oDetail.TRNumber) {
                    throw new Error(that.getText("scanToErrNotFound"));
                }

                oModel.setProperty("/tr", oDetail);
                oModel.setProperty("/hasTR", true);
                oModel.setProperty("/hasResult", false);
                oModel.setProperty("/result", null);

                // Initialize pick quantity to open TR quantity
                var nOpenQty = parseFloat(oDetail.OpenQty || 0);
                oModel.setProperty("/pickQty", nOpenQty);
                oModel.setProperty("/qtyValueState", "None");
                oModel.setProperty("/qtyValueStateText", "");

                // Initialize batch
                oModel.setProperty("/batch", oDetail.Batch || "");
                oModel.setProperty("/batchValueState", "None");
                oModel.setProperty("/batchValueStateText", "");

                // Reset serials
                oModel.setProperty("/serials", []);
                oModel.setProperty("/serialInput", "");
                oModel.setProperty("/serialsCount", 0);

                that._updateSerialsStatus();
                that._validateForm();
                that._playAudio("success");
                MessageToast.show(that.getText("scanToMsgTRLoaded"));
                return oDetail;
            }).catch(function (oErr) {
                oModel.setProperty("/hasTR", false);
                oModel.setProperty("/tr", null);
                that._showMessage(oErr.message || that.getText("scanToErrLookupFailed"), "Error");
                that._playAudio("error");
            });
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

        onAutoConfirmChange: function (oEvent) {
            var bState = oEvent.getParameter("state");
            this.getModel("scanView").setProperty("/autoConfirm", bState);
        },

        onAutoMigoChange: function (oEvent) {
            var bState = oEvent.getParameter("state");
            this.getModel("scanView").setProperty("/autoPostMigo", bState);
        },

        _validateForm: function () {
            var oModel = this.getModel("scanView");
            var bHasTR = oModel.getProperty("/hasTR");
            var oTR = oModel.getProperty("/tr");
            if (!bHasTR || !oTR) {
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

        onProcessTO: function () {
            if (!this._validateForm()) {
                this._showMessage(this.getText("scanToErrValidationFailed"), "Warning");
                this._playAudio("warn");
                return Promise.resolve(null);
            }

            var oModel = this.getModel("scanView");
            var oTR = oModel.getProperty("/tr");
            var sLgnum = oModel.getProperty("/lgnum") || "W01";
            var nQty = parseFloat(oModel.getProperty("/pickQty"));
            var bAutoConfirm = oModel.getProperty("/autoConfirm");
            var bAutoPostMigo = oModel.getProperty("/autoPostMigo");
            var sBatch = oModel.getProperty("/batch");
            var aSerials = (oModel.getProperty("/serials") || []).map(function (item) {
                return item.serial;
            });

            var oPayload = {
                lgnum: sLgnum,
                tbnum: oTR.TRNumber,
                tbpos: oTR.TRItem || "0001",
                qty: nQty,
                unit: oTR.Unit || "KG",
                batch: sBatch,
                serials: aSerials,
                autoConfirm: bAutoConfirm,
                autoPostMigo: bAutoPostMigo,
                storageUnit: ""
            };

            var that = this;
            oModel.setProperty("/canSubmit", false);

            return WarehouseScanToService.createTOFromTR(oPayload).then(function (oResult) {
                that._playAudio("success");

                var sActionText;
                if (oResult.MaterialDocument) {
                    sActionText = that.getText("scanToMsgSuccessMigoPosted", [
                        oResult.TransferOrder,
                        oResult.MaterialDocument,
                        oResult.MaterialDocYear || ""
                    ]);
                    oModel.setProperty("/canRetryMigo", false);
                } else if (oResult.Status === "99") {
                    sActionText = that.getText("scanToMsgToConfirmedMigoFailed", [
                        oResult.TransferOrder,
                        oResult.ErrorMessage || ""
                    ]);
                    oModel.setProperty("/canRetryMigo", true);
                } else if (oResult.IsConfirmed) {
                    sActionText = that.getText("scanToMsgSuccessConfirmed", [oResult.TransferOrder, oResult.ConfirmationNumber]);
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
                oModel.setProperty("/scannedTR", "");

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
                Unit: oResult.Unit
            };

            return WarehouseScanToService.postMigoGoodsMovement(oPayload).then(function (oMigoRes) {
                that._playAudio("success");
                var sText = that.getText("scanToMsgSuccessMigoPosted", [
                    oResult.TransferOrder,
                    oMigoRes.MaterialDocument,
                    oMigoRes.MaterialDocYear || ""
                ]);

                var oUpdatedResult = Object.assign({}, oResult, {
                    MaterialDocument: oMigoRes.MaterialDocument,
                    MaterialDocYear: oMigoRes.MaterialDocYear,
                    Status: oMigoRes.Status || "05",
                    StockEffect: oMigoRes.StockEffect
                });
                oModel.setProperty("/result", oUpdatedResult);
                oModel.setProperty("/resultMessage", sText);
                oModel.setProperty("/canRetryMigo", false);
                MessageToast.show(sText);
                return oMigoRes;
            }).catch(function (oErr) {
                that._playAudio("error");
                oModel.setProperty("/canRetryMigo", true);
                MessageBox.error(oErr.message || that.getText("scanToErrMigoFailed"));
            });
        },

        onScanNextTR: function () {
            this.onReset();
            this._focusTRInput();
        },

        onReset: function () {
            var oModel = this.getModel("scanView");
            oModel.setProperty("/scannedTR", "");
            oModel.setProperty("/hasTR", false);
            oModel.setProperty("/tr", null);
            oModel.setProperty("/pickQty", 0);
            oModel.setProperty("/qtyValueState", "None");
            oModel.setProperty("/qtyValueStateText", "");
            oModel.setProperty("/batch", "");
            oModel.setProperty("/batchValueState", "None");
            oModel.setProperty("/batchValueStateText", "");
            oModel.setProperty("/serialInput", "");
            oModel.setProperty("/serials", []);
            oModel.setProperty("/serialsCount", 0);
            oModel.setProperty("/canSubmit", false);
            oModel.setProperty("/canRetryMigo", false);
            oModel.setProperty("/hasResult", false);
            oModel.setProperty("/result", null);
            oModel.setProperty("/resultMessage", "");
            this.onCloseMessage();
            this._focusTRInput();
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("home", {}, true);
            }
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
