sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History",
    "saps4hana/fiori/modules/wm/goods-receipt/service/GoodsReceiptService",
    "saps4hana/fiori/service/BarcodeScanService",
    "saps4hana/fiori/modules/wm/goods-receipt/controller/GoodsReceiptPostingCoordinator",
    "saps4hana/fiori/modules/wm/goods-receipt/controller/GoodsReceiptReferenceSearch",
    "saps4hana/fiori/modules/wm/goods-receipt/controller/GoodsReceiptItemManager"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    History,
    GoodsReceiptService,
    BarcodeScanService,
    GoodsReceiptPostingCoordinator,
    GoodsReceiptReferenceSearch,
    GoodsReceiptItemManager
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modPosting = req(GoodsReceiptPostingCoordinator, "./GoodsReceiptPostingCoordinator");
    var modSearch = req(GoodsReceiptReferenceSearch, "./GoodsReceiptReferenceSearch");
    var modItem = req(GoodsReceiptItemManager, "./GoodsReceiptItemManager");

    var fnPosting = typeof createGoodsReceiptPostingCoordinator === "function" ? createGoodsReceiptPostingCoordinator : (modPosting && modPosting.createGoodsReceiptPostingCoordinator);
    var fnSearch = typeof createGoodsReceiptReferenceSearch === "function" ? createGoodsReceiptReferenceSearch : (modSearch && modSearch.createGoodsReceiptReferenceSearch);
    var fnItem = typeof createGoodsReceiptItemManager === "function" ? createGoodsReceiptItemManager : (modItem && modItem.createGoodsReceiptItemManager);

    var mPosting = typeof fnPosting === "function" ? fnPosting({
        MessageBox: MessageBox,
        GoodsReceiptService: GoodsReceiptService
    }) : {};

    var mSearch = typeof fnSearch === "function" ? fnSearch({
        MessageBox: MessageBox,
        MessageToast: MessageToast,
        GoodsReceiptService: GoodsReceiptService,
        BarcodeScanService: BarcodeScanService
    }) : {};

    var mItem = typeof fnItem === "function" ? fnItem({
        MessageBox: MessageBox
    }) : {};

    var oMembers = {

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

            // List route shows the open deliveries; detail route resolves one document on its own page
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsReceipt").attachPatternMatched(this._onListRouteMatched, this);
                oRouter.getRoute("wmGoodsReceiptDetail").attachPatternMatched(this._onDetailRouteMatched, this);
                if (typeof oRouter.attachRouteMatched === "function") {
                    oRouter.attachRouteMatched(this._onAnyRouteMatched, this);
                }
            }
        },

        /** The scanner belongs to this screen only: the view stays alive after navigation, so detach on other routes. */
        _onAnyRouteMatched: function (oEvent) {
            var sRoute = oEvent.getParameter("name");
            if (sRoute === "wmGoodsReceipt" || sRoute === "wmGoodsReceiptDetail") {
                BarcodeScanService.attachHardwareScanner(this._scannerHandler);
            } else {
                BarcodeScanService.detachHardwareScanner(this._scannerHandler);
            }
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
            this.getRouter().navTo("wmGoodsReceiptDetail", { delivery: sKey });
        },

        onExit: function () {
            if (this._scannerHandler) {
                BarcodeScanService.detachHardwareScanner(this._scannerHandler);
            }
            var oRouter = this.getRouter();
            if (oRouter && typeof oRouter.detachRouteMatched === "function") {
                oRouter.detachRouteMatched(this._onAnyRouteMatched, this);
            }
            if (this._oSUValueHelpDialog) {
                this._oSUValueHelpDialog.destroy();
                this._oSUValueHelpDialog = null;
            }
        },

        /**
         * Toggle audio cues
         */
        onToggleAudio: function () {
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
         * Reset form and workflow state
         */
        onResetWorkflow: function () {
            this._resetState();
            MessageToast.show(this.getText("grWorkflowReset"));
            if (this.getView().getModel("grView").getProperty("/isDetail")) {
                this.getRouter().navTo("wmGoodsReceipt");
            }
        },

        _resetState: function () {
            var oModel = this.getView().getModel("grView");
            oModel.setProperty("/postIdempotencyKey", ""); // a reset form is a new posting intent
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
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined && typeof window !== "undefined" && window.history && typeof window.history.go === "function") {
                window.history.go(-1);
            } else {
                this.getRouter().navTo("dashboard", {}, true);
            }
        }
    };

    Object.assign(oMembers, mPosting, mSearch, mItem);

    var Controller = BaseController.extend("saps4hana.fiori.modules.wm.goods-receipt.controller.GoodsReceipt", oMembers);

    var oTargetProto = Controller.prototype || Controller;
    Object.assign(oTargetProto, mPosting, mSearch, mItem);

    return Controller;
});
