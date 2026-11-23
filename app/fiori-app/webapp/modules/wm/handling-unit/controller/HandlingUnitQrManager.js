(function () {
    "use strict";

    function createHandlingUnitQrManager(deps) {
        deps = deps || {};
        var JSONModel = deps.JSONModel;
        var Fragment = deps.Fragment;
        var MessageToast = deps.MessageToast;
        var MessageBox = deps.MessageBox;
        var QrCode = deps.QrCode;
        var HuQrPdf = deps.HuQrPdf;
        var HuQrLayoutDialog = deps.HuQrLayoutDialog;

        return {
            /**
             * Row QR Code: shows a dialog with a QR code for the row's HU number.
             * The dialog is lazily created once and reused. The SVG is injected into the
             * div directly so no binding to a raw SVG string is needed.
             */
            onRowQr: function (oEvent) {
                var oView = this.getView();
                var oCtx = oEvent.getSource().getBindingContext("huView");
                var sHuNumber = String(oCtx.getProperty("HandlingUnitExternalID") || "").trim();
                var sMaterial = oCtx.getProperty("PackagingMaterialName") || oCtx.getProperty("PackagingMaterialDescription") || oCtx.getProperty("PackagingMaterial") || "";
                if (!sHuNumber) { MessageToast.show(this.getText("huNoData")); return; }

                if (!this.getModel("huQr")) {
                    this.setModel(new JSONModel({ huNumber: "", materialName: "" }), "huQr");
                }
                this.getModel("huQr").setProperty("/huNumber", sHuNumber);
                this.getModel("huQr").setProperty("/materialName", sMaterial);

                if (!this._pQrDialog) {
                    this._pQrDialog = Fragment.load({
                        id: oView.getId(),
                        name: "saps4hana.fiori.modules.wm.handling-unit.view.QrCodeDialog",
                        controller: this
                    }).then(function (oDialog) {
                        oView.addDependent(oDialog);
                        return oDialog;
                    });
                }
                this._pQrDialog.then(function (oDialog) {
                    var fnInjectSvg = function () {
                        var oHtml = oView.byId("huQrSvgHtml");
                        if (oHtml) {
                            var sSvg = QrCode.toSvg(sHuNumber, { size: 8, quiet: 4 });
                            oHtml.setContent('<div style="display:flex;align-items:center;justify-content:center;padding:16px;background:#ffffff;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,0.12);">' + sSvg + "</div>");
                        }
                    };
                    oDialog.attachEventOnce("afterOpen", fnInjectSvg);
                    fnInjectSvg();
                    if (!oDialog.isOpen()) {
                        oDialog.open();
                    }
                });
            },

            onCloseQr: function () {
                if (this._pQrDialog) {
                    this._pQrDialog.then(function (oDialog) { oDialog.close(); });
                }
            },

            /**
             * Download QR code as vector SVG for the current dialog's HU.
             */
            onDownloadQrSvg: function () {
                var oModel = this.getModel("huQr");
                var sHuNumber = oModel ? oModel.getProperty("/huNumber") : "";
                if (!sHuNumber) { return; }
                HuQrPdf.downloadSvg(sHuNumber, "QR_" + sHuNumber + ".svg");
                MessageToast.show(this.getText("huQrDownloaded", [sHuNumber]));
            },

            /**
             * Download QR code as single-page PDF for the current dialog's HU.
             */
            onDownloadQrPdf: function () {
                var oModel = this.getModel("huQr");
                var sHuNumber = oModel ? oModel.getProperty("/huNumber") : "";
                if (!sHuNumber) { return; }
                var sMaterial = oModel.getProperty("/materialName") || "";
                var self = this;
                HuQrPdf.download([{ huNumber: sHuNumber, materialName: sMaterial }], "QR_" + sHuNumber + ".pdf", "A4single")
                    .then(function () {
                        MessageToast.show(self.getText("huQrDownloaded", [sHuNumber]));
                    })
                    .catch(function (e) {
                        MessageBox.error((e && e.message) || self.getText("huLoadError"));
                    });
            },

            /**
             * Download Selected QR Codes: opens combine options dialog, then downloads combined PDF for ticked HUs.
             */
            onDownloadQrSelected: function () {
                var aRows = this._rowsToObjects(this.byId("huTable").getSelectedItems());
                if (!aRows.length) {
                    MessageToast.show(this.getText("huNoSelection"));
                    return undefined;
                }
                return this._pickQrLayoutThenDownload(aRows);
            },

            /**
             * Download All QR Codes: opens combine options dialog, then downloads combined PDF for all filtered HUs.
             */
            onDownloadQrAll: function () {
                var aRows = this.getModel("huView").getProperty("/items") || [];
                if (!aRows.length) {
                    MessageToast.show(this.getText("huNoData"));
                    return undefined;
                }
                return this._pickQrLayoutThenDownload(aRows);
            },

            /**
             * Opens the combine layout picker dialog (12-up, 6-up, 20-up, 1-up) and downloads combined PDF.
             */
            _pickQrLayoutThenDownload: function (aRows) {
                var self = this;
                var aItems = aRows.map(function (r) {
                    return {
                        huNumber: String(r.HandlingUnitExternalID || r.huNumber || "").trim(),
                        materialName: r.PackagingMaterialName || r.PackagingMaterialDescription || r.PackagingMaterial || "",
                        createdDate: r.CreationDateTime || ""
                    };
                }).filter(function (it) { return !!it.huNumber; });

                if (!aItems.length) {
                    MessageToast.show(this.getText("huNoData"));
                    return undefined;
                }

                return HuQrLayoutDialog.open(this, { count: aItems.length }).then(function (oChoice) {
                    if (!oChoice) { return undefined; }
                    MessageToast.show(self.getText("huQrGenerating"));
                    var sFilename = "HU_QR_combined_" + self._fileStamp() + "_" + oChoice.layout + ".pdf";
                    return HuQrPdf.download(aItems, sFilename, oChoice.layout, { includeMaterial: oChoice.includeMaterial })
                        .then(function () {
                            MessageToast.show(self.getText("huQrCombinedDownloaded", [aItems.length]));
                        })
                        .catch(function (oError) {
                            MessageBox.error((oError && oError.message) || self.getText("huLoadError"));
                        });
                });
            }
        };
    }

    var oExports = {
        createHandlingUnitQrManager: createHandlingUnitQrManager
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
