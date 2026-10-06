sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "saps4hana/fiori/modules/wm/goods-receipt/service/GoodsReceiptService",
    "saps4hana/fiori/service/BarcodeScanService"
], function (BaseController, JSONModel, MessageBox, MessageToast, History, GoodsReceiptService, BarcodeScanService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-receipt.controller.GoodsReceipt", {

        onInit: function () {
            var oModel = new JSONModel({
                storageUnitBarcode: "",
                selectedDelivery: "",
                hasActiveSU: false,
                isDetail: false,
                audioEnabled: true,
                isPosting: false,
                openDeliveries: [],
                availableStorageLocations: [],
                availableBatches: [],
                activeSU: {
                    StorageUnit: "",
                    ScannedBarcode: "",
                    ScannedType: "",
                    ScannedTypeLabel: "",
                    DeliveryDocument: "",
                    DeliveryDocumentItem: "",
                    PurchaseOrder: "",
                    PurchaseOrderItem: "",
                    Material: "",
                    MaterialName: "",
                    Plant: "",
                    PlantName: "",
                    StorageLocation: "",
                    StorageLocationName: "",
                    WarehouseStorageBin: "",
                    Batch: "",
                    ExpiryDate: "",
                    BatchStatusState: "None",
                    BatchStatusText: "NO BATCH",
                    Quantity: "",
                    OpenQuantity: null,
                    OrderedQuantity: null,
                    QuantityInEntryUnit: null,
                    Unit: "",
                    Supplier: "",
                    SupplierName: "",
                    SupplierCityName: "",
                    PackagingMaterial: "",
                    StorageUnitType: "",
                    WarehouseNumber: "",
                    DeliveryQuantity: null,
                    DeliveryDate: "",
                    GoodsMovementStatus: ""
                }
            });
            this.getView().setModel(oModel, "grView");

            // Attach hardware barcode scanner listener
            var that = this;
            this._scannerHandler = function (sScanned) {
                if (sScanned && sScanned.trim()) {
                    oModel.setProperty("/storageUnitBarcode", sScanned.trim());
                    that.onScanStorageUnit();
                }
            };
            BarcodeScanService.attachHardwareScanner(this._scannerHandler);

            // A list row press is honoured only when a trusted pointer/keyboard event happened just before it.
            // ponytail: after some page reloads UI5 fired a row press with no user input (source not identified,
            // WORKSTATUS 2026-10-06 17:38 / 18:10); this blocks it, a real click or Enter always passes.
            this._lastUserInputTs = 0;
            this._userInputHandler = function (oEvent) {
                if (oEvent.isTrusted !== false) {
                    that._lastUserInputTs = Date.now();
                }
            };
            if (typeof window !== "undefined" && window.addEventListener) {
                ["pointerdown", "mousedown", "touchstart", "keydown"].forEach(function (sType) {
                    window.addEventListener(sType, that._userInputHandler, true);
                });
            }

            // List route shows the open deliveries; detail route resolves one document on its own page
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsReceipt").attachPatternMatched(this._onListRouteMatched, this);
                oRouter.getRoute("wmGoodsReceiptDetail").attachPatternMatched(this._onDetailRouteMatched, this);
            }

            // The open deliveries are loaded by the list route only (see _onListRouteMatched); a detail page
            // must never hold a list whose row press would navigate away from the document that was opened.
        },

        _onListRouteMatched: function () {
            this._resetState();
            this.getView().getModel("grView").setProperty("/isDetail", false);
            this._loadOpenDeliveries();
        },

        _onDetailRouteMatched: function (oEvent) {
            var oArgs = oEvent && oEvent.getParameter("arguments");
            var oModel = this.getView().getModel("grView");
            this._resetState();
            oModel.setProperty("/isDetail", true);
            oModel.setProperty("/storageUnitBarcode", (oArgs && oArgs.delivery) || "");
            return this.onScanStorageUnit();
        },

        /**
         * Open the selected document on its own page (wm/goods-receipt/{delivery})
         */
        _openDetail: function (sKey) {
            window.__evpush && window.__evpush("CTRL _openDetail active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            this.getRouter().navTo("wmGoodsReceiptDetail", { delivery: sKey });
        },

        onExit: function () {
            if (this._scannerHandler) {
                BarcodeScanService.detachHardwareScanner(this._scannerHandler);
            }
            if (this._userInputHandler && typeof window !== "undefined" && window.removeEventListener) {
                var fnHandler = this._userInputHandler;
                ["pointerdown", "mousedown", "touchstart", "keydown"].forEach(function (sType) {
                    window.removeEventListener(sType, fnHandler, true);
                });
            }
            if (this._oSUValueHelpDialog) {
                this._oSUValueHelpDialog.destroy();
                this._oSUValueHelpDialog = null;
            }
        },

        /**
         * Load open Inbound Deliveries from SAP
         */
        _loadOpenDeliveries: function () {
            var oAuthModel = this.getModel("auth");
            if (!oAuthModel && this.getOwnerComponent()) {
                oAuthModel = this.getOwnerComponent().getModel("auth");
            }
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
                return;
            }
            var oModel = this.getView().getModel("grView");
            var oDataModel = this.getModel("goodsReceipt");
            GoodsReceiptService.fetchOpenInboundDeliveries(oDataModel)
                .then(function (aList) {
                    oModel.setProperty("/openDeliveries", aList || []);
                })
                .catch(function (err) {
                    console.warn("[GoodsReceipt] Failed to pre-fetch open deliveries:", err.message || err);
                });
        },

        /**
         * Toggle audio cues
         */
        onToggleAudio: function () {
            window.__evpush && window.__evpush("CTRL onToggleAudio active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oModel = this.getView().getModel("grView");
            var bCurrent = oModel.getProperty("/audioEnabled");
            oModel.setProperty("/audioEnabled", !bCurrent);
            MessageToast.show(this.getText(!bCurrent ? "grAudioEnabled" : "grAudioMuted"));
        },

        /**
         * Plays audio feedback
         */
        _playBeep: function (bSuccess) {
            var oModel = this.getView().getModel("grView");
            if (!oModel.getProperty("/audioEnabled")) return;
            try {
                var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                if (bSuccess) {
                    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
                    osc.type = "sine";
                    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.15);
                } else {
                    osc.frequency.setValueAtTime(220, audioCtx.currentTime); // A3 note
                    osc.type = "sawtooth";
                    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.3);
                }
            } catch (_) { }
        },

        /**
         * Trigger camera scan
         */
        onCameraScanStorageUnit: function () {
            window.__evpush && window.__evpush("CTRL onCameraScanStorageUnit active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var that = this;
            BarcodeScanService.openCameraScanner("Scan Inbound Delivery / PO Barcode", function (sScanned) {
                if (sScanned && sScanned.trim()) {
                    that.getView().getModel("grView").setProperty("/storageUnitBarcode", sScanned.trim());
                    that.onScanStorageUnit();
                }
            });
        },

        /**
         * Storage Unit / Inbound Delivery Value Help Dialog
         */
        onStorageUnitValueHelp: function () {
            window.__evpush && window.__evpush("CTRL onStorageUnitValueHelp active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oView = this.getView();
            var oModel = oView.getModel("grView");
            var that = this;

            sap.ui.require([
                "sap/m/SelectDialog",
                "sap/m/StandardListItem",
                "sap/ui/model/Filter",
                "sap/ui/model/FilterOperator"
            ], function (SelectDialog, StandardListItem, Filter, FilterOperator) {
                if (!that._oSUValueHelpDialog) {
                    var oDialog = new SelectDialog({
                        title: that.getText("grVHSelectTitle") || "Select Inbound Delivery / Storage Unit from SAP S/4HANA",
                        noDataText: that.getText("grVHNoData") || "No open inbound deliveries found in SAP S/4HANA",
                        search: function (oEvt) {
                            var sVal = (oEvt.getParameter("value") || "").trim();
                            var oBinding = oEvt.getSource().getBinding("items");
                            if (!oBinding) return;
                            if (!sVal) {
                                oBinding.filter([]);
                                return;
                            }
                            var aFilters = [
                                new Filter("DeliveryDocument", FilterOperator.Contains, sVal),
                                new Filter("Material", FilterOperator.Contains, sVal),
                                new Filter("MaterialName", FilterOperator.Contains, sVal),
                                new Filter("PurchaseOrder", FilterOperator.Contains, sVal),
                                new Filter("SupplierName", FilterOperator.Contains, sVal)
                            ];
                            oBinding.filter(new Filter({ filters: aFilters, and: false }));
                        },
                        confirm: function (oEvt) {
                            var oSelectedItem = oEvt.getParameter("selectedItem");
                            if (oSelectedItem) {
                                var sKey = oSelectedItem.getTitle();
                                oModel.setProperty("/storageUnitBarcode", sKey);
                                that.onScanStorageUnit();
                            }
                        }
                    });

                    var oTemplate = new StandardListItem({
                        title: "{grView>DeliveryDocument}",
                        description: "{grView>Material} - {grView>MaterialName}",
                        info: "{grView>SupplierName}",
                        infoState: "Information"
                    });

                    oDialog.bindAggregation("items", {
                        path: "grView>/openDeliveries",
                        template: oTemplate
                    });

                    oView.addDependent(oDialog);
                    that._oSUValueHelpDialog = oDialog;
                }

                var aList = oModel.getProperty("/openDeliveries") || [];
                if (aList.length === 0) {
                    that._loadOpenDeliveries();
                }

                that._oSUValueHelpDialog.open();
            });
        },

        onRefreshDeliveries: function () {
            window.__evpush && window.__evpush("CTRL onRefreshDeliveries active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            this._loadOpenDeliveries();
        },

        /**
         * Handle row press in the open Inbound Deliveries list
         */
        onSelectInboundDelivery: function (oEvent) {
            window.__evpush && window.__evpush("CTRL onSelectInboundDelivery active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            if (this.getView().getModel("grView").getProperty("/isDetail") || Date.now() - this._lastUserInputTs > 2000) {
                return;
            }
            var oCtx = oEvent.getSource().getBindingContext("grView");
            var sKey = oCtx && oCtx.getProperty("DeliveryDocument");
            if (sKey) {
                this._openDetail(sKey);
            }
        },

        /**
         * Primary Handler: Resolve Storage Unit Number into authentic SAP details
         */
        onScanStorageUnit: function () {
            window.__evpush && window.__evpush("CTRL onScanStorageUnit active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oModel = this.getView().getModel("grView");
            var sBarcode = (oModel.getProperty("/storageUnitBarcode") || "").trim();

            if (!sBarcode) {
                this._playBeep(false);
                MessageBox.error(this.getText("grScanRequired"));
                return Promise.resolve();
            }

            if (!oModel.getProperty("/isDetail")) {
                this._openDetail(sBarcode);
                return Promise.resolve();
            }

            var that = this;
            this.setBusy(true);

            return GoodsReceiptService.resolveStorageUnit(sBarcode)
                .then(function (oSU) {
                    that._playBeep(true);
                    oModel.setProperty("/activeSU", {
                        StorageUnit: oSU.StorageUnit || sBarcode,
                        ScannedBarcode: oSU.ScannedBarcode || sBarcode,
                        ScannedType: oSU.ScannedType || (oSU.DeliveryDocument ? "INBOUND_DELIVERY" : (oSU.PurchaseOrder ? "PURCHASE_ORDER" : "DOCUMENT")),
                        ScannedTypeLabel: oSU.ScannedTypeLabel || (oSU.DeliveryDocument ? "Inbound Delivery" : (oSU.PurchaseOrder ? "Purchase Order" : "Document")),
                        DeliveryDocument: oSU.DeliveryDocument || "",
                        DeliveryDocumentItem: oSU.DeliveryDocumentItem || "",
                        PurchaseOrder: oSU.PurchaseOrder || "",
                        PurchaseOrderItem: oSU.PurchaseOrderItem || "",
                        Material: oSU.Material || "",
                        MaterialName: oSU.MaterialName || "",
                        Plant: oSU.Plant || "",
                        PlantName: oSU.PlantName || "",
                        StorageLocation: oSU.StorageLocation || "",
                        StorageLocationName: oSU.StorageLocationName || "",
                        WarehouseStorageBin: oSU.WarehouseStorageBin || "",
                        Batch: oSU.Batch || "",
                        ExpiryDate: oSU.ExpiryDate || "",
                        BatchStatusState: oSU.BatchStatusState || "None",
                        BatchStatusText: oSU.BatchStatusText || "NO BATCH",
                        Quantity: (oSU.Quantity !== undefined && oSU.Quantity !== null && !isNaN(Number(oSU.Quantity))) ? Number(oSU.Quantity) : "",
                        OpenQuantity: (oSU.OpenQuantity !== undefined && oSU.OpenQuantity !== null && !isNaN(Number(oSU.OpenQuantity))) ? Number(oSU.OpenQuantity) : null,
                        OrderedQuantity: (oSU.OrderedQuantity !== undefined && oSU.OrderedQuantity !== null && !isNaN(Number(oSU.OrderedQuantity))) ? Number(oSU.OrderedQuantity) : null,
                        QuantityInEntryUnit: (oSU.QuantityInEntryUnit !== undefined && oSU.QuantityInEntryUnit !== null && !isNaN(Number(oSU.QuantityInEntryUnit))) ? Number(oSU.QuantityInEntryUnit) : null,
                        Unit: oSU.Unit || "",
                        Supplier: oSU.Supplier || "",
                        SupplierName: oSU.SupplierName || "",
                        SupplierCityName: oSU.SupplierCityName || "",
                        PackagingMaterial: oSU.PackagingMaterial || "",
                        StorageUnitType: oSU.StorageUnitType || "",
                        WarehouseNumber: oSU.WarehouseNumber || "",
                        DeliveryQuantity: (oSU.DeliveryQuantity !== undefined && oSU.DeliveryQuantity !== null && !isNaN(Number(oSU.DeliveryQuantity))) ? Number(oSU.DeliveryQuantity) : null,
                        DeliveryDate: oSU.DeliveryDate || "",
                        GoodsMovementStatus: oSU.GoodsMovementStatus || ""
                    });

                    oModel.setProperty("/availableStorageLocations", oSU.AvailableStorageLocations || []);
                    oModel.setProperty("/availableBatches", oSU.AvailableBatches || []);
                    oModel.setProperty("/hasActiveSU", true);

                    var sLabel = oSU.ScannedTypeLabel || (oSU.DeliveryDocument ? "Inbound Delivery" : (oSU.PurchaseOrder ? "Purchase Order" : "Document"));
                    var sToastTpl = that.getText("grResolvedToast");
                    var sToastMsg = (sToastTpl && sToastTpl.includes("{0}"))
                        ? sToastTpl.replace("{0}", sLabel).replace("{1}", sBarcode).replace("{2}", oSU.Material || "")
                        : (sLabel + " " + sBarcode + " resolved from SAP.");
                    MessageToast.show(sToastMsg);
                    if (Array.isArray(oSU.LookupWarnings) && oSU.LookupWarnings.length > 0) {
                        MessageBox.warning(oSU.LookupWarnings.join("\n"), { title: that.getText("grLookupWarningsTitle") || "Some SAP data could not be read" });
                    }
                })
                .catch(function (err) {
                    that._playBeep(false);
                    oModel.setProperty("/hasActiveSU", false);
                    var sRawMsg = err.message || err || "";
                    var isOutage = err.statusCode === 502 || err.statusCode === 503 || err.statusCode === 504 || err.status === 502 || err.status === 503 || err.status === 504 ||
                        (sRawMsg && (sRawMsg.toLowerCase().includes("s/4hana outage") || sRawMsg.toLowerCase().includes("destination") || sRawMsg.toLowerCase().includes("econnrefused")));
                    if (isOutage) {
                        MessageBox.error(sRawMsg, {
                            title: that.getText("grOutageTitle"),
                            actions: [MessageBox.Action.CLOSE]
                        });
                    } else {
                        var sGuidance = that.getText("grNotFoundGuidance");
                        if (sGuidance && sGuidance.includes("{0}")) {
                            sGuidance = sGuidance.replace("{0}", sBarcode);
                        }
                        var sOpenVHTitle = that.getText("grBtnOpenValueHelp") || "Open Value Help";
                        MessageBox.error(sRawMsg, {
                            title: that.getText("grDocNotFoundTitle"),
                            details: sGuidance || undefined,
                            actions: [MessageBox.Action.CLOSE, sOpenVHTitle],
                            emphasizedAction: sOpenVHTitle,
                            onClose: function (sAction) {
                                if (sAction === sOpenVHTitle) {
                                    that.onStorageUnitValueHelp();
                                }
                            }
                        });
                    }
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        /**
         * Handle change of destination Storage Location from dropdown
         */
        onStorageLocationChange: function (oEvent) {
            window.__evpush && window.__evpush("CTRL onStorageLocationChange active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (!oSelectedItem) return;

            var sSLoc = oSelectedItem.getKey();
            var oModel = this.getView().getModel("grView");
            var aSLocs = oModel.getProperty("/availableStorageLocations") || [];
            var found = aSLocs.find(function (sl) { return sl.StorageLocation === sSLoc; });

            if (found) {
                oModel.setProperty("/activeSU/StorageLocation", found.StorageLocation);
                oModel.setProperty("/activeSU/StorageLocationName", found.StorageLocationName);
                oModel.setProperty("/activeSU/WarehouseStorageBin", found.WarehouseStorageBin || "");
            }
        },

        /**
         * Handle selection of batch from available usable batches
         */
        onBatchChange: function (oEvent) {
            window.__evpush && window.__evpush("CTRL onBatchChange active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (!oSelectedItem) return;

            var sBatch = oSelectedItem.getKey();
            var oModel = this.getView().getModel("grView");
            var aBatches = oModel.getProperty("/availableBatches") || [];
            var found = aBatches.find(function (b) { return b.Batch === sBatch; });

            if (found) {
                // HARD-STOP: Expired batch selection blocked
                if (found.StatusState === "Error" || found.StatusText === "EXPIRED") {
                    this._playBeep(false);
                    MessageBox.error(
                        this.getText("grBatchExpiredSelectMsg", [found.Batch, found.ExpiryDate || "unknown date"]),
                        { title: this.getText("grExpiredBatchTitle") }
                    );
                    return;
                }

                oModel.setProperty("/activeSU/Batch", found.Batch);
                oModel.setProperty("/activeSU/ExpiryDate", found.ExpiryDate);
                oModel.setProperty("/activeSU/BatchStatusState", found.StatusState);
                oModel.setProperty("/activeSU/BatchStatusText", found.StatusText);
            }
        },

        /**
         * Execute Goods Receipt (101) Transaction in SAP
         */
        onPostGoodsReceipt: function () {
            window.__evpush && window.__evpush("CTRL onPostGoodsReceipt active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oModel = this.getView().getModel("grView");
            var oActive = oModel.getProperty("/activeSU");

            if (!oActive.StorageUnit && !oActive.DeliveryDocument && !oActive.PurchaseOrder) {
                this._playBeep(false);
                MessageBox.error(this.getText("grNoActiveDoc"));
                return Promise.resolve();
            }

            var nQty = Number(oActive.Quantity);
            if (isNaN(nQty) || nQty <= 0) {
                this._playBeep(false);
                MessageBox.error(this.getText("grQtyPositive"));
                return Promise.resolve();
            }

            // HARD-STOP: Expired batch validation
            if (oActive.BatchStatusState === "Error" || oActive.BatchStatusText === "EXPIRED") {
                this._playBeep(false);
                MessageBox.error(
                    this.getText("grBatchExpiredPostMsg", [oActive.Batch]),
                    { title: this.getText("grExpiredBatchTitle") }
                );
                return Promise.resolve();
            }

            var that = this;
            var sDoc = oActive.DeliveryDocument || oActive.PurchaseOrder || oActive.StorageUnit;
            var sDocType = oActive.DeliveryDocument ? "Inbound Delivery " : (oActive.PurchaseOrder ? "Purchase Order " : "Document ");

            return new Promise(function (resolve) {
                MessageBox.confirm(that.getText("grPostConfirmPrompt", [sDocType, sDoc]), {
                    title: that.getText("grPostConfirmTitle"),
                    actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                    emphasizedAction: MessageBox.Action.YES,
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.YES) {
                            that.setBusy(true);
                            oModel.setProperty("/isPosting", true);

                            var oPayload = {
                                StorageUnit: oActive.StorageUnit,
                                DeliveryDocument: oActive.DeliveryDocument,
                                DeliveryDocumentItem: oActive.DeliveryDocumentItem,
                                PurchaseOrder: oActive.PurchaseOrder,
                                PurchaseOrderItem: oActive.PurchaseOrderItem,
                                Unit: oActive.Unit,
                                Material: oActive.Material,
                                Plant: oActive.Plant,
                                StorageLocation: oActive.StorageLocation,
                                Batch: oActive.Batch,
                                Quantity: nQty,
                                PackagingMaterial: oActive.PackagingMaterial || "",
                                ExpiryDate: oActive.ExpiryDate
                            };

                            var fnPost = (oActive.StorageUnit && typeof GoodsReceiptService.postGoodsReceiptWithStorageUnit === "function")
                                ? GoodsReceiptService.postGoodsReceiptWithStorageUnit.bind(GoodsReceiptService)
                                : GoodsReceiptService.postGoodsReceipt.bind(GoodsReceiptService);

                            fnPost(oPayload)
                                .then(function (oResult) {
                                    that._playBeep(true);
                                    var sSuccessMsg = (oResult && oResult.Message) ? oResult.Message : that.getText("grPostSuccessDefault");
                                    MessageBox.success(sSuccessMsg, {
                                        title: that.getText("grPostSuccessTitle"),
                                        onClose: function () {
                                            that.onResetWorkflow();
                                        }
                                    });
                                    resolve(oResult);
                                })
                                .catch(function (err) {
                                    that._playBeep(false);
                                    MessageBox.error(that.getText("grPostFailed", [err.message || err]));
                                    resolve(null);
                                })
                                .finally(function () {
                                    that.setBusy(false);
                                    oModel.setProperty("/isPosting", false);
                                });
                        } else {
                            resolve(null);
                        }
                    }
                });
            });
        },

        /**
         * Reset form and workflow state
         */
        onResetWorkflow: function () {
            window.__evpush && window.__evpush("CTRL onResetWorkflow active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            this._resetState();
            MessageToast.show(this.getText("grWorkflowReset"));
            if (this.getView().getModel("grView").getProperty("/isDetail")) {
                this.getRouter().navTo("wmGoodsReceipt");
            }
        },

        _resetState: function () {
            var oModel = this.getView().getModel("grView");
            oModel.setProperty("/storageUnitBarcode", "");
            oModel.setProperty("/selectedDelivery", "");
            oModel.setProperty("/hasActiveSU", false);
            oModel.setProperty("/availableStorageLocations", []);
            oModel.setProperty("/availableBatches", []);
            oModel.setProperty("/activeSU", {
                StorageUnit: "",
                ScannedBarcode: "",
                ScannedType: "",
                ScannedTypeLabel: "",
                DeliveryDocument: "",
                DeliveryDocumentItem: "",
                PurchaseOrder: "",
                PurchaseOrderItem: "",
                Material: "",
                MaterialName: "",
                Plant: "",
                PlantName: "",
                StorageLocation: "",
                StorageLocationName: "",
                WarehouseStorageBin: "",
                Batch: "",
                ExpiryDate: "",
                BatchStatusState: "None",
                BatchStatusText: "NO BATCH",
                Quantity: "",
                OpenQuantity: null,
                OrderedQuantity: null,
                QuantityInEntryUnit: null,
                Unit: "",
                Supplier: "",
                SupplierName: "",
                SupplierCityName: "",
                PackagingMaterial: "",
                StorageUnitType: "",
                WarehouseNumber: "",
                DeliveryQuantity: null,
                DeliveryDate: "",
                GoodsMovementStatus: ""
            });
        },

        /**
         * Navigation back
         */
        onNavBack: function () {
            window.__evpush && window.__evpush("CTRL onNavBack active=" + (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + " args=" + (arguments[0] && arguments[0].getSource ? arguments[0].getSource().getId() : "") + " :: " + new Error().stack.split("\n").slice(1, 22).join(" <- ")); // GRDBG-TEMP
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined && typeof window !== "undefined" && window.history && typeof window.history.go === "function") {
                window.history.go(-1);
            } else {
                this.getRouter().navTo("dashboard", {}, true);
            }
        }
    });
});
