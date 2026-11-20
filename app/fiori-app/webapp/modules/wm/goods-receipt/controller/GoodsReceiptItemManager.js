(function () {
    "use strict";

    function createGoodsReceiptItemManager(deps) {
        deps = deps || {};
        var MessageBox = deps.MessageBox;

        return {
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
            }
        };
    }

    var oExports = {
        createGoodsReceiptItemManager: createGoodsReceiptItemManager
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
