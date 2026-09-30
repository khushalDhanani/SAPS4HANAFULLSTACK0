sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/wm/tr-to/service/TrToService",
    "saps4hana/fiori/service/BarcodeScanService"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    Fragment,
    Filter,
    FilterOperator,
    TrToService,
    BarcodeScanService
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.tr-to.controller.TrTo", {

        onInit: function () {
            var oViewModel = new JSONModel({
                warehouse: "W01",
                trNumber: "",
                storageUnit: "",
                selectedItem: null,
                items: [],
                openTRs: [],
                isLoadingTRs: false,
                hasActiveTR: false,
                hasActiveSU: false,
                canCreateTO: false,
                material: "",
                materialDesc: "",
                batch: "",
                openQty: "0.000",
                scanQty: "0.000",
                unit: "",
                destBin: "",
                destType: "",
                audioEnabled: true,
                hasMessage: false,
                messageText: "",
                messageType: "Information",
                stepBadgeText: "1. ENTER TR",
                stepBadgeState: "None"
            });

            this.getView().setModel(oViewModel, "trToView");

            // Attach route matched listener
            var oRouter = this.getRouter();
            if (oRouter) {
                var oRoute = oRouter.getRoute("wmTrTo");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onRouteMatched, this);
                }
            }

            // Hardware scanner handler for Zebra DataWedge & laser wedge
            this._scannerHandler = this._onHardwareScan.bind(this);
            // Keyboard listener for physical Zebra MC220 F-keys (F1, F2, F3)
            this._keyHandler = this._onPhysicalKeyDown.bind(this);
        },

        _onRouteMatched: function () {
            BarcodeScanService.attachHardwareScanner(this._scannerHandler);
            if (typeof window !== "undefined") {
                window.addEventListener("keydown", this._keyHandler, true);
            }
            this._focusTR();
        },

        onExit: function () {
            BarcodeScanService.detachHardwareScanner(this._scannerHandler);
            if (typeof window !== "undefined") {
                window.removeEventListener("keydown", this._keyHandler, true);
            }
            if (this._oTrSelectDialog) {
                this._oTrSelectDialog.destroy();
                this._oTrSelectDialog = null;
            }
        },

        /**
         * Physical Keyboard Accelerators for Zebra MC220 Keypad
         */
        _onPhysicalKeyDown: function (oEvent) {
            var sKey = oEvent.key;
            var nCode = oEvent.keyCode;

            // F1: Clear All
            if (sKey === "F1" || nCode === 112) {
                oEvent.preventDefault();
                oEvent.stopPropagation();
                this.onClearAll();
                return;
            }

            // F2: Create Transfer Order
            if (sKey === "F2" || nCode === 113) {
                oEvent.preventDefault();
                oEvent.stopPropagation();
                var oModel = this.getModel("trToView");
                if (oModel.getProperty("/canCreateTO")) {
                    this.onCreateTO();
                }
                return;
            }

            // F3: Back
            if (sKey === "F3" || nCode === 114) {
                oEvent.preventDefault();
                oEvent.stopPropagation();
                this.onNavBack();
                return;
            }
        },

        /**
         * Automatic hardware laser barcode routing
         */
        _onHardwareScan: function (sBarcode) {
            if (!sBarcode) return;
            var oModel = this.getModel("trToView");
            var bHasTR = oModel.getProperty("/hasActiveTR");

            if (!bHasTR) {
                // Route to TR field
                oModel.setProperty("/trNumber", sBarcode.trim());
                this.onFetchTR();
            } else {
                // Route to SU field
                oModel.setProperty("/storageUnit", sBarcode.trim());
                this.onScanSU();
            }
        },

        _focusTR: function () {
            var oInput = this.byId("inputTR");
            if (oInput) {
                setTimeout(function () { oInput.focus(); }, 100);
            }
        },

        _focusSU: function () {
            var oInput = this.byId("inputSU");
            if (oInput) {
                setTimeout(function () { oInput.focus(); }, 100);
            }
        },

        onTRLiveChange: function () {
            var oModel = this.getModel("trToView");
            if (oModel.getProperty("/hasActiveTR")) {
                this.onClearAll();
            }
        },

        /**
         * Open Value Help dialog to select an open Transfer Requirement
         */
        onValueHelpTR: function () {
            var oView = this.getView();
            var oModel = this.getModel("trToView");
            var sWh = oModel.getProperty("/warehouse") || "W01";
            var that = this;

            oModel.setProperty("/isLoadingTRs", true);
            return this._loadOpenTRs(sWh).then(function () {
                if (!that._oTrSelectDialog) {
                    return Fragment.load({
                        id: oView.getId(),
                        name: "saps4hana.fiori.modules.wm.tr-to.view.TrSelectDialog",
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
            });
        },

        _loadOpenTRs: function (sWh) {
            var oModel = this.getModel("trToView");
            var that = this;
            return TrToService.getOpenTRs(sWh).then(function (aTRs) {
                oModel.setProperty("/openTRs", aTRs || []);
                oModel.setProperty("/isLoadingTRs", false);
            }).catch(function (oErr) {
                oModel.setProperty("/isLoadingTRs", false);
                that._showMessage(oErr.message || "Failed to load open Transfer Requirements.", "Error");
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

            var aFilters = [
                new Filter("DisplayText", FilterOperator.Contains, sQuery),
                new Filter("Tbnum", FilterOperator.Contains, sQuery),
                new Filter("Bwlvs", FilterOperator.Contains, sQuery),
                new Filter("Benum", FilterOperator.Contains, sQuery),
                new Filter("Description", FilterOperator.Contains, sQuery)
            ];
            oBinding.filter(new Filter({
                filters: aFilters,
                and: false
            }));
        },

        onConfirmTRValueHelp: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (oSelectedItem) {
                var oContext = oSelectedItem.getBindingContext("trToView");
                if (oContext) {
                    var sTbnum = oContext.getProperty("Tbnum") || "";
                    var sDisplayTR = sTbnum.replace(/^0+(?=\d)/, "");
                    var oModel = this.getModel("trToView");
                    oModel.setProperty("/trNumber", sDisplayTR);
                    this.onFetchTR();
                }
            }
        },

        onCancelTRValueHelp: function (oEvent) {
            var oBinding = oEvent.getSource().getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
            }
        },

        /**
         * Step 1: Fetch Transfer Requirement Details
         */
        onFetchTR: function () {
            var oModel = this.getModel("trToView");
            var sTbnum = (oModel.getProperty("/trNumber") || "").trim();
            var sLgnum = oModel.getProperty("/warehouse") || "W01";

            if (!sTbnum) {
                this._showMessage("Please enter or scan a Transfer Requirement number.", "Warning");
                this._playAudio("warn");
                this._focusTR();
                return;
            }

            this._clearMessage();
            var that = this;

            return TrToService.getTR(sTbnum, sLgnum).then(function (oData) {
                if (!oData || (!oData.Tbnum && !oData.Items)) {
                    throw new Error("Transfer Requirement " + sTbnum + " not found in warehouse " + sLgnum);
                }

                var aItems = oData.Items || [];
                if (aItems.length === 0) {
                    throw new Error("No open items found in Transfer Requirement " + sTbnum);
                }

                var oFirstItem = aItems[0];
                oModel.setProperty("/hasActiveTR", true);
                oModel.setProperty("/trNumber", oData.Tbnum || sTbnum);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/selectedItem", oFirstItem);
                oModel.setProperty("/material", oFirstItem.Material);
                oModel.setProperty("/materialDesc", oFirstItem.MaterialDesc);
                oModel.setProperty("/batch", oFirstItem.Batch || "");
                oModel.setProperty("/openQty", parseFloat(oFirstItem.OpenQty || 0).toFixed(3));
                oModel.setProperty("/unit", oFirstItem.Unit || "");
                oModel.setProperty("/destBin", oFirstItem.DestStorageBin || oData.Nlpla || "");
                oModel.setProperty("/destType", oFirstItem.DestStorageType || oData.Nltyp || "");
                oModel.setProperty("/stepBadgeText", "2. SCAN SU");
                oModel.setProperty("/stepBadgeState", "Information");

                that._showMessage("TR " + (oData.Tbnum || sTbnum) + " loaded. Please scan Storage Unit (SU).", "Information");
                that._playAudio("success");
                that._focusSU();
            }).catch(function (oErr) {
                var sErrorMsg = oErr.message || "Failed to load Transfer Requirement.";
                that._showMessage(sErrorMsg, "Error");
                that._playAudio("error");
                that._focusTR();
            });
        },

        onItemSelectionChange: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (!oItem) return;
            var oCtx = oItem.getBindingContext("trToView");
            if (!oCtx) return;

            var oSelected = oCtx.getObject();
            var oModel = this.getModel("trToView");
            oModel.setProperty("/selectedItem", oSelected);
            oModel.setProperty("/material", oSelected.Material);
            oModel.setProperty("/materialDesc", oSelected.MaterialDesc);
            oModel.setProperty("/batch", oSelected.Batch || "");
            oModel.setProperty("/openQty", parseFloat(oSelected.OpenQty || 0).toFixed(3));
            oModel.setProperty("/unit", oSelected.Unit || "");
            oModel.setProperty("/destBin", oSelected.DestStorageBin || "");
            oModel.setProperty("/destType", oSelected.DestStorageType || "");

            // If SU was already scanned, re-evaluate quantity against new item
            if (oModel.getProperty("/hasActiveSU")) {
                this.onScanSU();
            }
        },

        /**
         * Step 2: Validate Scanned Storage Unit
         */
        onScanSU: function () {
            var oModel = this.getModel("trToView");
            var sLenum = (oModel.getProperty("/storageUnit") || "").trim();
            var sTbnum = (oModel.getProperty("/trNumber") || "").trim();
            var sLgnum = oModel.getProperty("/warehouse") || "W01";

            if (!sLenum) {
                this._showMessage("Please scan a Storage Unit (SU) barcode.", "Warning");
                this._playAudio("warn");
                this._focusSU();
                return;
            }

            var that = this;
            this._clearMessage();

            return TrToService.checkSU(sLenum, sTbnum, sLgnum).then(function (oSU) {
                if (!oSU || oSU.IsValid === false) {
                    var sFailMsg = (oSU && oSU.ErrorMessage) ? oSU.ErrorMessage : ("Storage Unit " + sLenum + " is invalid or does not match TR.");
                    oModel.setProperty("/hasActiveSU", false);
                    oModel.setProperty("/canCreateTO", false);
                    oModel.setProperty("/scanQty", "0.000");
                    oModel.setProperty("/stepBadgeText", "INVALID SU");
                    oModel.setProperty("/stepBadgeState", "Error");
                    that._showMessage(sFailMsg, "Error");
                    that._playAudio("error");
                    that._focusSU();
                    return;
                }

                var aQuants = oSU.Quants || [];
                var nAvailableStock = 0;
                if (aQuants.length > 0) {
                    nAvailableStock = parseFloat(aQuants[0].AvailableStock || 0);
                    if (aQuants[0].Batch && !oModel.getProperty("/batch")) {
                        oModel.setProperty("/batch", aQuants[0].Batch);
                    }
                }

                var nOpenQty = parseFloat(oModel.getProperty("/openQty") || 0);
                // Default to min(AvailableStock, OpenQty)
                var nProposedQty = Math.min(nAvailableStock, nOpenQty);

                oModel.setProperty("/hasActiveSU", true);
                oModel.setProperty("/scanQty", nProposedQty > 0 ? nProposedQty.toFixed(3) : nAvailableStock.toFixed(3));
                oModel.setProperty("/canCreateTO", true);
                oModel.setProperty("/stepBadgeText", "3. READY TO CREATE");
                oModel.setProperty("/stepBadgeState", "Success");

                that._showMessage("SU verified (" + nAvailableStock.toFixed(3) + " " + oModel.getProperty("/unit") + " available). Press F2 to Create TO.", "Success");
                that._playAudio("success");
            }).catch(function (oErr) {
                var sErrorMsg = oErr.message || "Failed to validate Storage Unit.";
                oModel.setProperty("/hasActiveSU", false);
                oModel.setProperty("/canCreateTO", false);
                oModel.setProperty("/stepBadgeText", "SCAN FAILED");
                oModel.setProperty("/stepBadgeState", "Error");
                that._showMessage(sErrorMsg, "Error");
                that._playAudio("error");
                that._focusSU();
            });
        },

        onCameraScanSU: function () {
            var that = this;
            BarcodeScanService.openCameraScanner("Scan Storage Unit Barcode", function (sBarcode) {
                if (sBarcode) {
                    that.getModel("trToView").setProperty("/storageUnit", sBarcode.trim());
                    that.onScanSU();
                }
            });
        },

        onQtyChange: function (oEvent) {
            var oModel = this.getModel("trToView");
            var sVal = oEvent.getParameter("value");
            var nQty = parseFloat(sVal || 0);
            var nOpen = parseFloat(oModel.getProperty("/openQty") || 0);

            if (nQty <= 0) {
                this._showMessage("Quantity must be greater than zero.", "Warning");
                oModel.setProperty("/canCreateTO", false);
                return;
            }

            if (nQty > nOpen) {
                this._showMessage("Warning: Requested quantity (" + nQty.toFixed(3) + ") exceeds open TR quantity (" + nOpen.toFixed(3) + ").", "Warning");
                this._playAudio("warn");
            } else {
                this._clearMessage();
            }
            oModel.setProperty("/canCreateTO", true);
        },

        onFillOpenQty: function () {
            var oModel = this.getModel("trToView");
            var sOpen = oModel.getProperty("/openQty");
            oModel.setProperty("/scanQty", sOpen);
            this.onQtyChange({ getParameter: function () { return sOpen; } });
        },

        /**
         * Step 3: Synchronously Create Transfer Order
         * No offline queue. Failures are reported immediately to operator.
         */
        onCreateTO: function () {
            var oModel = this.getModel("trToView");
            var sTbnum = oModel.getProperty("/trNumber");
            var sLenum = oModel.getProperty("/storageUnit");
            var nQty = parseFloat(oModel.getProperty("/scanQty") || 0);
            var nOpen = parseFloat(oModel.getProperty("/openQty") || 0);
            var sUnit = oModel.getProperty("/unit") || "";
            var sLgnum = oModel.getProperty("/warehouse") || "W01";

            if (!sTbnum || !sLenum || nQty <= 0) {
                this._showMessage("Mandatory fields missing. Please scan TR and SU.", "Error");
                this._playAudio("error");
                return;
            }

            if (nQty > nOpen) {
                this._showMessage("Requested quantity exceeds open TR quantity (" + nOpen.toFixed(3) + " " + sUnit + ").", "Error");
                this._playAudio("error");
                return;
            }

            // Server re-derives TR item, unit and limits from SAP; only the operator's input is sent.
            var oPayload = {
                lgnum: sLgnum,
                tbnum: sTbnum,
                lenum: sLenum,
                qty: nQty
            };

            var that = this;
            this.getView().setBusy(true);

            return TrToService.createTO(oPayload).then(function (oResult) {
                that.getView().setBusy(false);
                that._playAudio("success");

                var sTanum = oResult.TransferOrder || "CREATED";
                var sMsg = "Transfer Order " + sTanum + " created successfully" + (oResult.Confirmed ? " and confirmed." : ".");

                MessageBox.success(sMsg, {
                    title: "TO Created (" + sTanum + ")",
                    onClose: function () {
                        that.onClearAll();
                    }
                });
            }).catch(function (oErr) {
                that.getView().setBusy(false);
                that._playAudio("error");
                var sErrorMsg = oErr.message || "Failed to create Transfer Order in SAP S/4HANA.";
                MessageBox.error(sErrorMsg, {
                    title: "TO Creation Failed"
                });
            });
        },

        /**
         * F1: Clear All Input Fields
         */
        onClearAll: function () {
            var oModel = this.getModel("trToView");
            oModel.setProperty("/trNumber", "");
            oModel.setProperty("/storageUnit", "");
            oModel.setProperty("/items", []);
            oModel.setProperty("/selectedItem", null);
            oModel.setProperty("/hasActiveTR", false);
            oModel.setProperty("/hasActiveSU", false);
            oModel.setProperty("/canCreateTO", false);
            oModel.setProperty("/material", "");
            oModel.setProperty("/materialDesc", "");
            oModel.setProperty("/batch", "");
            oModel.setProperty("/openQty", "0.000");
            oModel.setProperty("/scanQty", "0.000");
            oModel.setProperty("/destBin", "");
            oModel.setProperty("/destType", "");
            oModel.setProperty("/hasMessage", false);
            oModel.setProperty("/messageText", "");
            oModel.setProperty("/stepBadgeText", "1. ENTER TR");
            oModel.setProperty("/stepBadgeState", "None");

            this._playAudio("warn");
            this._focusTR();
        },

        /**
         * F3: Back to Dashboard
         */
        onNavBack: function () {
            this.onClearAll();
            this.getRouter().navTo("dashboard");
        },

        onToggleAudio: function () {
            var oModel = this.getModel("trToView");
            var bEnabled = !oModel.getProperty("/audioEnabled");
            oModel.setProperty("/audioEnabled", bEnabled);
            MessageToast.show(bEnabled ? "Audio cues enabled" : "Audio cues muted");
        },

        onCloseMessage: function () {
            this._clearMessage();
        },

        _showMessage: function (sText, sType) {
            var oModel = this.getModel("trToView");
            oModel.setProperty("/hasMessage", true);
            oModel.setProperty("/messageText", sText);
            oModel.setProperty("/messageType", sType || "Information");
        },

        _clearMessage: function () {
            var oModel = this.getModel("trToView");
            oModel.setProperty("/hasMessage", false);
            oModel.setProperty("/messageText", "");
        },

        _playAudio: function (sType) {
            var oModel = this.getModel("trToView");
            if (!oModel || !oModel.getProperty("/audioEnabled")) return;
            if (typeof window === "undefined" || !window.AudioContext) return;

            try {
                var ctx = new (window.AudioContext || window.webkitAudioContext)();
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);

                if (sType === "success") {
                    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 high beep
                    gain.gain.setValueAtTime(0.15, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.12);
                } else if (sType === "warn") {
                    osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
                    gain.gain.setValueAtTime(0.15, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.18);
                } else if (sType === "error") {
                    osc.frequency.setValueAtTime(220, ctx.currentTime); // Low buzz
                    gain.gain.setValueAtTime(0.2, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.35);
                }
            } catch (e) {
                // AudioContext blocked or not supported
            }
        }
    });
});
