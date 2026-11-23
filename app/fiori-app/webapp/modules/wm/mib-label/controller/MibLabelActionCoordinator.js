(function () {
    "use strict";

    var BULK_MAX_ORDERS = 20;

    function createMibLabelActionCoordinator(deps) {
        deps = deps || {};
        var MibLabelService = deps.MibLabelService;
        var MibLabelPdf = deps.MibLabelPdf;

        return {
            /** Row "4x6 Labels": populate Transfer Order into the form, run preview, and scroll down to the PDF. */
            onRowLabels: function (oEvent) {
                var oOrder = oEvent.getSource().getBindingContext("mibList").getObject();
                var oVm = this.getModel("mibView");
                oVm.setProperty("/warehouseNumber", oOrder.WarehouseNumber);
                oVm.setProperty("/transferOrderNumber", oOrder.TransferOrderNumber);
                var that = this;
                return Promise.resolve(this.on4x6Labels()).then(function () {
                    if (oVm.getProperty("/pdfSource")) {
                        that._scrollTo("mibActions");
                    } else {
                        that._notifyResult();
                    }
                });
            },

            onRowDownload: function (oEvent) {
                return this._listLabels([oEvent.getSource().getBindingContext("mibList").getObject()], "download");
            },

            onRowPrint: function (oEvent) {
                return this._listLabels([oEvent.getSource().getBindingContext("mibList").getObject()], "print");
            },

            /** Ticked transfer orders -> one combined PDF with all their 4 x 6 sticker labels. */
            onDownloadSelected: function () {
                var aOrders = this.byId("mibToTable").getSelectedItems().map(function (oItem) {
                    return oItem.getBindingContext("mibList").getObject();
                });
                return this._listLabels(aOrders, "download");
            },

            _listLabels: function (aOrders, sMode) {
                var oVm = this.getModel("mibView");
                if (oVm.getProperty("/busy") || !aOrders.length) {
                    return;
                }
                if (aOrders.length > BULK_MAX_ORDERS) {
                    oVm.setProperty("/message", this.getText("mibBulkTooMany", [BULK_MAX_ORDERS]));
                    oVm.setProperty("/messageType", "Error");
                    this._notifyResult();
                    return;
                }

                var that = this;
                oVm.setProperty("/busy", true);
                oVm.setProperty("/message", "");

                return this._buildLabels(aOrders).then(function (aAllRows) {
                    var oMeta = {
                        variant: oVm.getProperty("/variant") || "vertical",
                        warehouseNumber: aOrders[0].WarehouseNumber
                    };
                    if (sMode === "print") {
                        return MibLabelPdf.print(aAllRows, oMeta).then(function () {
                            return { rows: aAllRows };
                        });
                    }
                    return MibLabelPdf.generateBlob(aAllRows, oMeta).then(function (oBlob) {
                        var d = aOrders[0];
                        that._saveBlob(oBlob, aOrders.length === 1
                            ? "MIB-Sticker-" + d.WarehouseNumber + "-" + d.TransferOrderNumber + ".pdf"
                            : "MIB-Stickers-" + d.WarehouseNumber + "-" + aOrders.length + "docs.pdf");
                        return { rows: aAllRows };
                    });
                }).then(function (oDone) {
                    var sReady = that.getText("mibReady", [oDone.rows.length], "{0} label(s) ready.");
                    oVm.setProperty("/message", sReady);
                    oVm.setProperty("/messageType", "Success");
                }).catch(function (oError) {
                    oVm.setProperty("/message", (oError && oError.message) || that.getText("mibFailed", null, "Batch issue stickers could not be generated."));
                    oVm.setProperty("/messageType", "Error");
                }).finally(function () {
                    oVm.setProperty("/busy", false);
                    that._notifyResult();
                });
            },

            _buildLabels: function (aOrders) {
                var that = this;
                var aAllRows = [];
                return aOrders.reduce(function (p, order) {
                    return p.then(function () {
                        return MibLabelService.readMibStickerData({
                            warehouseNumber: order.WarehouseNumber,
                            transferOrderNumber: order.TransferOrderNumber
                        }).then(function (oResponse) {
                            var aRows = Array.isArray(oResponse) ? oResponse : ((oResponse && oResponse.value) || []);
                            aAllRows = aAllRows.concat(aRows);
                        }, function (oError) {
                            throw new Error(that.getText("mibDocFailed", [order.TransferOrderNumber, (oError && oError.message) || ""]));
                        });
                    });
                }, Promise.resolve()).then(function () {
                    if (!aAllRows.length) {
                        throw new Error(that.getText("mibNoRowsFound"));
                    }
                    return aAllRows;
                });
            },

            _saveBlob: function (oBlob, sName) {
                var sUrl = URL.createObjectURL(oBlob);
                var oLink = document.createElement("a");
                oLink.href = sUrl;
                oLink.download = sName;
                document.body.appendChild(oLink);
                oLink.click();
                document.body.removeChild(oLink);
                setTimeout(function () {
                    URL.revokeObjectURL(sUrl);
                }, 1000);
            },

            onPrint: function () {
                if (!this._pdfBlobUrl) {
                    return;
                }
                var oIframe = document.getElementById("mibPrintIframe");
                if (!oIframe) {
                    oIframe = document.createElement("iframe");
                    oIframe.id = "mibPrintIframe";
                    oIframe.style.position = "fixed";
                    oIframe.style.right = "0";
                    oIframe.style.bottom = "0";
                    oIframe.style.width = "0";
                    oIframe.style.height = "0";
                    oIframe.style.border = "0";
                    document.body.appendChild(oIframe);
                }
                oIframe.src = this._pdfBlobUrl;
                oIframe.onload = function () {
                    try {
                        oIframe.contentWindow.focus();
                        oIframe.contentWindow.print();
                    } catch {
                        window.open(oIframe.src, "_blank");
                    }
                };
            },

            onDownload: function () {
                if (!this._pdfBlobUrl) {
                    return;
                }
                var sFileName = this.getModel("mibView").getProperty("/fileName") || "MIB-Sticker.pdf";
                var oLink = document.createElement("a");
                oLink.href = this._pdfBlobUrl;
                oLink.download = sFileName;
                document.body.appendChild(oLink);
                oLink.click();
                document.body.removeChild(oLink);
            }
        };
    }

    var oExports = {
        createMibLabelActionCoordinator: createMibLabelActionCoordinator,
        BULK_MAX_ORDERS: BULK_MAX_ORDERS
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
