(function () {
    "use strict";

    /** One key per posting intent. The server returns the earlier result for a repeat with the same key. */
    function newIdempotencyKey() {
        var oCrypto = typeof window !== "undefined" ? window.crypto : null;
        if (oCrypto && typeof oCrypto.randomUUID === "function") {
            return oCrypto.randomUUID();
        }
        return "gr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    }

    function createGoodsReceiptPostingCoordinator(deps) {
        deps = deps || {};
        var MessageBox = deps.MessageBox;
        var GoodsReceiptService = deps.GoodsReceiptService;

        return {
            /**
             * Execute Goods Receipt (101) Transaction in SAP
             */
            onPostGoodsReceipt: function () {
                var oModel = this.getView().getModel("grView");
                if (oModel.getProperty("/isPosting")) return Promise.resolve(null);
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

                                var sETag = oActive.ETag || oActive["@odata.etag"] || oActive.etag || "";
                                var oPayload = {
                                    StorageUnit: oActive.StorageUnit || "",
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
                                // Kept until the post succeeds or the form is reset, so a retry after a lost
                                // answer repeats the same request instead of posting a second receipt.
                                var sKey = oModel.getProperty("/postIdempotencyKey");
                                if (!sKey) {
                                    sKey = newIdempotencyKey();
                                    oModel.setProperty("/postIdempotencyKey", sKey);
                                }
                                oPayload.IdempotencyKey = sKey;

                                var fnPost = (oActive.StorageUnit && typeof GoodsReceiptService.postGoodsReceiptWithStorageUnit === "function")
                                    ? GoodsReceiptService.postGoodsReceiptWithStorageUnit.bind(GoodsReceiptService)
                                    : GoodsReceiptService.postGoodsReceipt.bind(GoodsReceiptService);

                                var pPost = sETag
                                    ? fnPost(oPayload, { etag: sETag })
                                    : fnPost(oPayload);

                                pPost
                                    .then(function (oResult) {
                                        oModel.setProperty("/postIdempotencyKey", "");
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
                                        if (err && (err.status === 409 || err.statusCode === 409 || err.code === "STALE_DATA")) {
                                            var sStaleMsg = (err.message || that.getText("grErrStaleData", null, "This document was modified by another user or session in SAP S/4HANA (stale data).")) +
                                                "\n\n" + that.getText("grPromptReloadData", null, "Please refresh and reload the latest data from SAP before retrying.");
                                            MessageBox.error(sStaleMsg, {
                                                title: that.getText("titleStaleDataConflict", null, "Document Changed / Stale Data"),
                                                onClose: function () {
                                                    that.onResetWorkflow();
                                                }
                                            });
                                        } else {
                                            MessageBox.error(that.getText("grPostFailed", [err.message || err]));
                                        }
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
            }
        };
    }

    var oExports = {
        createGoodsReceiptPostingCoordinator: createGoodsReceiptPostingCoordinator
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
