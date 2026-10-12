sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/service/BarcodeScanService",
    "saps4hana/fiori/modules/wm/warehouse-scan-to/service/WarehouseScanToService"
], function (
    BaseController,
    JSONModel,
    Fragment,
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
                lgnum: "",
                docType: "TR",
                scannedTR: "",
                audioEnabled: true,
                hasMessage: false,
                messageText: "",
                messageType: "Information",
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
            this._loadOpenTRs();
            this._focusTRInput();
        },

        /** Load the open TR list into the view model (shared by the inline list and the value-help dialog). */
        _loadOpenTRs: function () {
            var oModel = this.getModel("scanView");
            var sWh = oModel.getProperty("/lgnum") || "";
            var that = this;
            oModel.setProperty("/isLoadingTRs", true);
            return WarehouseScanToService.getOpenTRs(sWh).then(function (aTRs) {
                oModel.setProperty("/openTRs", aTRs || []);
                oModel.setProperty("/isLoadingTRs", false);
                return aTRs || [];
            }).catch(function (oErr) {
                oModel.setProperty("/isLoadingTRs", false);
                that._showMessage(oErr.message || that.getText("scanToErrLoadTRs"), "Error");
                return [];
            });
        },

        /** Direct selection from the inline open-TR list -> navigate to detail page. */
        onOpenTRPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("scanView");
            var sTbnum = oCtx ? oCtx.getProperty("Tbnum") : "";
            if (sTbnum) {
                this.getModel("scanView").setProperty("/docType", "TR");
                this.getModel("scanView").setProperty("/scannedTR", sTbnum);
                this._navigateToDetail("TR", sTbnum);
            }
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
            oModel.setProperty("/scannedTR", sVal);
            this.onLookupTR();
        },

        onTRLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            this.getModel("scanView").setProperty("/scannedTR", sVal);
            if (!sVal) {
                this.onCloseMessage();
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

        onValueHelpTR: function () {
            var oView = this.getView();
            var that = this;

            this._loadOpenTRs().then(function () {
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
                }
                that._oTrSelectDialog.open();
                return that._oTrSelectDialog;
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
                var sTbnum = oCtx ? oCtx.getProperty("Tbnum") : "";
                if (!sTbnum) {
                    var sRaw = oSelectedItem.getTitle() || "";
                    var mNum = sRaw.match(/\b\d{4,10}\b/);
                    sTbnum = mNum ? mNum[0] : sRaw.replace(/[^\d]/g, "");
                }
                if (sTbnum) {
                    this.getModel("scanView").setProperty("/docType", "TR");
                    this.getModel("scanView").setProperty("/scannedTR", sTbnum);
                    this._navigateToDetail("TR", sTbnum);
                }
            }
        },

        onCancelTRValueHelp: function () {
            // Cancelled
        },

        /**
         * Document type of a scanned value: an explicit "TR" / "RES" / "RS" prefix on the barcode decides;
         * a bare number takes the explicit selector (/docType). Anything else is rejected, never guessed.
         */
        _classifyScan: function (sRaw, sSelected) {
            var mPrefix = sRaw.match(/^(TR|RES|RS)[\s:-]*(\d{1,10})$/i);
            if (mPrefix) {
                return { docType: mPrefix[1].toUpperCase() === "TR" ? "TR" : "RES", number: mPrefix[2] };
            }
            if (!/^\d{1,10}$/.test(sRaw)) {
                return { error: this.getText("scanToErrNotANumber") };
            }
            if (sSelected !== "TR" && sSelected !== "RES") {
                return { error: this.getText("scanToErrSelectDocType") };
            }
            return { docType: sSelected, number: sRaw };
        },

        onDocTypeChange: function (oEvent) {
            var sKey = oEvent.getParameter("item") ? oEvent.getParameter("item").getKey() : oEvent.getSource().getSelectedKey();
            this.getModel("scanView").setProperty("/docType", sKey);
        },

        onLookupTR: function () {
            var oModel = this.getModel("scanView");
            var sRawScanned = (oModel.getProperty("/scannedTR") || "").trim();

            if (!sRawScanned) {
                this._showMessage(this.getText("scanToErrEmptyTR"), "Warning");
                this._playAudio("warn");
                return Promise.resolve(null);
            }

            var oClass = this._classifyScan(sRawScanned, oModel.getProperty("/docType"));
            if (oClass.error) {
                this._showMessage(oClass.error, "Error");
                this._playAudio("warn");
                return Promise.resolve(null);
            }

            var sScanned = oClass.number;
            oModel.setProperty("/docType", oClass.docType);
            oModel.setProperty("/scannedTR", sScanned);
            this.onCloseMessage();

            return this._navigateToDetail(oClass.docType, sScanned);
        },

        _navigateToDetail: function (sDocType, sNumber) {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("wmWarehouseScanToDetail", {
                    docType: sDocType,
                    number: sNumber
                });
                return Promise.resolve({ docType: sDocType, number: sNumber });
            }
            return Promise.resolve(null);
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "dashboard");
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
