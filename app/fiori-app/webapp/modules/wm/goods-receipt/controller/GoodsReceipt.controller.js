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
                    Quantity: 1,
                    Unit: "KG",
                    Supplier: "",
                    SupplierName: "",
                    SupplierCityName: ""
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

            // Fetch open inbound deliveries for selection list
            this._loadOpenDeliveries();
        },

        onExit: function () {
            if (this._scannerHandler) {
                BarcodeScanService.detachHardwareScanner(this._scannerHandler);
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
            var oModel = this.getView().getModel("grView");
            GoodsReceiptService.fetchOpenInboundDeliveries()
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
            var oModel = this.getView().getModel("grView");
            var bCurrent = oModel.getProperty("/audioEnabled");
            oModel.setProperty("/audioEnabled", !bCurrent);
            MessageToast.show(!bCurrent ? "Audio cues enabled" : "Audio cues muted");
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
            } catch (_) {}
        },

        /**
         * Trigger camera scan
         */
        onCameraScanStorageUnit: function () {
            var that = this;
            BarcodeScanService.openCameraScanner("Scan Storage Unit Barcode", function (sScanned) {
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

        /**
         * Handle Inbound Delivery dropdown selection
         */
        onSelectInboundDelivery: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (!oSelectedItem) return;

            var sKey = oSelectedItem.getKey();
            if (sKey) {
                this.getView().getModel("grView").setProperty("/storageUnitBarcode", sKey);
                this.onScanStorageUnit();
            }
        },

        /**
         * Primary Handler: Resolve Storage Unit Number into authentic SAP details
         */
        onScanStorageUnit: function () {
            var oModel = this.getView().getModel("grView");
            var sBarcode = (oModel.getProperty("/storageUnitBarcode") || "").trim();

            if (!sBarcode) {
                this._playBeep(false);
                MessageBox.error("Please scan or enter a Storage Unit Number.");
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
                        ScannedType: oSU.ScannedType || "STORAGE_UNIT",
                        ScannedTypeLabel: oSU.ScannedTypeLabel || "Storage Unit",
                        DeliveryDocument: oSU.DeliveryDocument || "",
                        DeliveryDocumentItem: oSU.DeliveryDocumentItem || "000010",
                        PurchaseOrder: oSU.PurchaseOrder || "",
                        PurchaseOrderItem: oSU.PurchaseOrderItem || "00010",
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
                        Quantity: Number(oSU.Quantity) || 1,
                        Unit: oSU.Unit || "KG",
                        Supplier: oSU.Supplier || "",
                        SupplierName: oSU.SupplierName || "",
                        SupplierCityName: oSU.SupplierCityName || ""
                    });

                    oModel.setProperty("/availableStorageLocations", oSU.AvailableStorageLocations || []);
                    oModel.setProperty("/availableBatches", oSU.AvailableBatches || []);
                    oModel.setProperty("/hasActiveSU", true);

                    var sLabel = oSU.ScannedTypeLabel || "Storage Unit";
                    var sToastTpl = that.getText("grResolvedToast");
                    var sToastMsg = (sToastTpl && sToastTpl.includes("{0}"))
                        ? sToastTpl.replace("{0}", sLabel).replace("{1}", sBarcode).replace("{2}", oSU.Material || "")
                        : (sLabel + " " + sBarcode + " resolved from SAP.");
                    MessageToast.show(sToastMsg);
                })
                .catch(function (err) {
                    that._playBeep(false);
                    oModel.setProperty("/hasActiveSU", false);
                    var sRawMsg = err.message || err || "";
                    var sGuidance = that.getText("grNotFoundGuidance");
                    if (sGuidance && sGuidance.includes("{0}")) {
                        sGuidance = sGuidance.replace("{0}", sBarcode);
                    }
                    var sOpenVHTitle = that.getText("grBtnOpenValueHelp") || "Open Value Help";
                    MessageBox.error(sRawMsg, {
                        title: "Validation Error: Document Not Found",
                        details: sGuidance || undefined,
                        actions: [MessageBox.Action.CLOSE, sOpenVHTitle],
                        emphasizedAction: sOpenVHTitle,
                        onClose: function (sAction) {
                            if (sAction === sOpenVHTitle) {
                                that.onStorageUnitValueHelp();
                            }
                        }
                    });
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        /**
         * Handle change of destination Storage Location from dropdown
         */
        onStorageLocationChange: function (oEvent) {
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
                        "Batch " + found.Batch + " expired on " + (found.ExpiryDate || "unknown date") + " (SLED exceeded).\n\nReceiving expired materials is strictly prohibited by quality control rules.",
                        { title: "Expired Batch Blocked" }
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
            var oModel = this.getView().getModel("grView");
            var oActive = oModel.getProperty("/activeSU");

            if (!oActive.StorageUnit && !oActive.DeliveryDocument) {
                this._playBeep(false);
                MessageBox.error("No active Storage Unit selected for Goods Receipt.");
                return Promise.resolve();
            }

            var nQty = Number(oActive.Quantity);
            if (isNaN(nQty) || nQty <= 0) {
                this._playBeep(false);
                MessageBox.error("Quantity must be greater than zero.");
                return Promise.resolve();
            }

            // HARD-STOP: Expired batch validation
            if (oActive.BatchStatusState === "Error" || oActive.BatchStatusText === "EXPIRED") {
                this._playBeep(false);
                MessageBox.error(
                    "Goods Receipt blocked: Batch " + oActive.Batch + " has expired (SLED exceeded). Receiving expired chemicals or reagents is strictly prohibited.",
                    { title: "Expired Batch Blocked" }
                );
                return Promise.resolve();
            }

            var that = this;
            var sDoc = oActive.DeliveryDocument || oActive.StorageUnit;

            return new Promise(function (resolve) {
                MessageBox.confirm("Post Goods Receipt (101) in SAP for Storage Unit " + oActive.StorageUnit + " (Delivery " + sDoc + ")?", {
                    title: "Confirm Goods Receipt",
                    actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                    emphasizedAction: MessageBox.Action.YES,
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.YES) {
                            that.setBusy(true);
                            oModel.setProperty("/isPosting", true);

                            var oPayload = {
                                StorageUnit: oActive.StorageUnit,
                                DeliveryDocument: oActive.DeliveryDocument,
                                Material: oActive.Material,
                                Plant: oActive.Plant,
                                StorageLocation: oActive.StorageLocation,
                                Batch: oActive.Batch,
                                Quantity: nQty,
                                ExpiryDate: oActive.ExpiryDate
                            };

                            GoodsReceiptService.postGoodsReceipt(oPayload)
                                .then(function (oResult) {
                                    that._playBeep(true);
                                    var sSuccessMsg = (oResult && oResult.Message) ? oResult.Message : "Goods Receipt posted successfully in SAP.";
                                    MessageBox.success(sSuccessMsg, {
                                        title: "Goods Receipt Posted",
                                        onClose: function () {
                                            that.onResetWorkflow();
                                        }
                                    });
                                    resolve(oResult);
                                })
                                .catch(function (err) {
                                    that._playBeep(false);
                                    MessageBox.error("Goods Receipt Failed: " + (err.message || err));
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
                Quantity: 1,
                Unit: "KG",
                Supplier: "",
                SupplierName: "",
                SupplierCityName: ""
            });
            MessageToast.show("Workflow reset");
        },

        /**
         * Navigation back
         */
        onNavBack: function () {
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
