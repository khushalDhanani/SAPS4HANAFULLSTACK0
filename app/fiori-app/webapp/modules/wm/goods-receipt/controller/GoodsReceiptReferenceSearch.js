(function () {
    "use strict";

    function createGoodsReceiptReferenceSearch(deps) {
        deps = deps || {};
        var MessageBox = deps.MessageBox;
        var MessageToast = deps.MessageToast;
        var GoodsReceiptService = deps.GoodsReceiptService;
        var BarcodeScanService = deps.BarcodeScanService;

        return {
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
             * Trigger camera scan
             */
            onCameraScanStorageUnit: function () {
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
                this._loadOpenDeliveries();
            },

            /**
             * Handle row press in the open Inbound Deliveries list
             */
            onSelectInboundDelivery: function (oEvent) {
                if (this.getView().getModel("grView").getProperty("/isDetail")) {
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
            }
        };
    }

    var oExports = {
        createGoodsReceiptReferenceSearch: createGoodsReceiptReferenceSearch
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oExports;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oExports;
        });
    }
})();
