(function () {
    "use strict";

    var BULK_MAX_DOCUMENTS = 20; // documents per combined PDF, so the browser stays responsive

    function createQuarantineLabelActionCoordinator(deps) {
        deps = deps || {};
        var QuarantineLabelService = deps.QuarantineLabelService;
        var ZquarLabelLayout = deps.ZquarLabelLayout;
        var ZquarLabelPdf = deps.ZquarLabelPdf;
        var ZquarLabelRows = deps.ZquarLabelRows;
        var AuthService = deps.AuthService;

        return {
            /** Row "4x6 Labels": the document goes into the form and the existing preview runs (print/download there). */
            onRowLabels: function (oEvent) {
                var oDoc = oEvent.getSource().getBindingContext("qlList").getObject();
                var oVm = this.getModel("qlView");
                oVm.setProperty("/materialDocument", oDoc.MaterialDocument);
                oVm.setProperty("/year", oDoc.MaterialDocumentYear);
                var that = this;
                return Promise.resolve(this.on4x6Labels()).then(function () {
                    if (oVm.getProperty("/pdfUrl")) {
                        that._scrollTo("qlActions"); // the preview opens below the list
                    } else {
                        that._notifyResult();
                    }
                });
            },

            onRowDownload: function (oEvent) {
                return this._listLabels([oEvent.getSource().getBindingContext("qlList").getObject()], "download");
            },

            onRowPrint: function (oEvent) {
                return this._listLabels([oEvent.getSource().getBindingContext("qlList").getObject()], "print");
            },

            /** Ticked documents -> one PDF with all their 4 x 6 labels. */
            onDownloadSelected: function () {
                var aDocs = this.byId("qlDocTable").getSelectedItems().map(function (oItem) {
                    return oItem.getBindingContext("qlList").getObject();
                });
                return this._listLabels(aDocs, "download");
            },

            /**
             * 4 x 6 labels of list documents, downloaded as one PDF or printed at the exact label size. Label rows are read
             * one document after the other (read only in SAP); any failure stops it and nothing is produced.
             */
            _listLabels: function (aDocs, sMode) {
                var oVm = this.getModel("qlView");
                if (oVm.getProperty("/busy") || !aDocs.length) {
                    return;
                }
                if (aDocs.length > BULK_MAX_DOCUMENTS) {
                    oVm.setProperty("/message", this.getText("qlBulkTooMany", [BULK_MAX_DOCUMENTS]));
                    oVm.setProperty("/messageType", "Error");
                    this._notifyResult();
                    return;
                }
                var sText = String(oVm.getProperty("/text") || "").trim();
                if (sText.length > 50) {
                    this._setState("text", "qlTextTooLong");
                    return;
                }
                var that = this;
                oVm.setProperty("/busy", true);
                oVm.setProperty("/message", "");
                return this._buildLabels(aDocs, sText).then(function (oJob) {
                    if (sMode === "print") {
                        return ZquarLabelPdf.print(oJob.labels, oJob.texts, oJob.opts).then(function () { return { job: oJob, warnings: [] }; });
                    }
                    return ZquarLabelPdf.toBlob(oJob.labels, oJob.texts, oJob.opts).then(function (oPdf) {
                        var d = aDocs[0];
                        that._saveBlob(oPdf.blob, aDocs.length === 1
                            ? "QuarantineLabels4x6_" + d.MaterialDocument + "_" + d.MaterialDocumentYear + ".pdf"
                            : "QuarantineLabels4x6_" + d.Plant + "_" + aDocs.length + "docs.pdf");
                        return { job: oJob, warnings: oPdf.warnings };
                    });
                }).then(function (oDone) {
                    var sReady = that.getText("qlListLabelsReady", [oDone.job.labels.length, aDocs.length]);
                    var aWarn = oDone.warnings.map(function (w) { return that.getText("qlLabelWarn_" + w.code, [w.label]); });
                    oVm.setProperty("/message", aWarn.length ? sReady + " " + that.getText("ql4x6Warnings", [aWarn.join("; ")]) : sReady);
                    oVm.setProperty("/messageType", aWarn.length ? "Warning" : "Success");
                }).catch(function (oError) {
                    var sRenderError = oError && oError.code && oError.label ? that.getText("ql4x6Error_" + oError.code, [oError.label]) : "";
                    oVm.setProperty("/message", sRenderError || (oError && oError.message) || that.getText("qlFailed", null, "Quarantine labels could not be generated."));
                    oVm.setProperty("/messageType", "Error");
                }).finally(function () {
                    oVm.setProperty("/busy", false);
                    that._notifyResult();
                });
            },

            /** Label rows of the documents, in list order, as one label set; all documents must share one label size. */
            _buildLabels: function (aDocs, sText) {
                var that = this;
                var aRows = [];
                var aSizes = [];
                return aDocs.reduce(function (p, d) {
                    return p.then(function () {
                        return QuarantineLabelService.labelRows({ materialDocument: d.MaterialDocument, year: d.MaterialDocumentYear, text: sText })
                            .then(function (oResult) {
                                aRows = aRows.concat((oResult && oResult.Rows) || []);
                                aSizes.push((oResult && oResult.LabelSize) || ZquarLabelLayout.DEFAULT_SIZE);
                            }, function (oError) {
                                throw new Error(that.getText("qlDocFailed", [d.MaterialDocument, d.MaterialDocumentYear, (oError && oError.message) || ""]));
                            });
                    });
                }, Promise.resolve()).then(function () {
                    if (!aRows.length) {
                        throw new Error(that.getText("qlNoLabelRows"));
                    }
                    if (aSizes.some(function (s) { return s !== aSizes[0]; })) {
                        throw new Error(that.getText("qlMixedSizes"));
                    }
                    var mTexts = that._labelTexts();
                    var sVariant = that.getModel("qlView").getProperty("/variant") || "vertical";
                    return { labels: ZquarLabelRows.toLabels(aRows, mTexts, AuthService.getCurrentUserName(that.getOwnerComponent())), texts: mTexts, opts: { size: aSizes[0], variant: sVariant } };
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
                setTimeout(function () { URL.revokeObjectURL(sUrl); }, 60000);
            },

            onDownload: function () {
                var oVm = this.getModel("qlView");
                var sUrl = oVm.getProperty("/pdfUrl");
                if (!sUrl) {
                    return;
                }
                var oLink = document.createElement("a");
                oLink.href = sUrl;
                oLink.download = oVm.getProperty("/fileName");
                document.body.appendChild(oLink);
                oLink.click();
                document.body.removeChild(oLink);
            },

            /**
             * Opens the browser print dialog; whether it is printed is up to the user and printer. App-drawn labels print
             * from an HTML page with @page = label size (exact size, 100 %); the SAP PDF prints as the PDF itself.
             */
            onPrint: function () {
                var oVm = this.getModel("qlView");
                var sUrl = oVm.getProperty("/pdfUrl");
                if (!sUrl) {
                    return;
                }
                if (this._oPrintJob) {
                    var that = this;
                    return ZquarLabelPdf.print(this._oPrintJob.labels, this._oPrintJob.texts, this._oPrintJob.opts).catch(function (oError) {
                        oVm.setProperty("/message", (oError && oError.message) || that.getText("qlFailed", null, "Quarantine labels could not be generated."));
                        oVm.setProperty("/messageType", "Error");
                    });
                }
                var oFrame = document.createElement("iframe");
                oFrame.style.display = "none";
                oFrame.src = sUrl;
                oFrame.onload = function () {
                    oFrame.contentWindow.focus();
                    oFrame.contentWindow.print();
                    setTimeout(function () { document.body.removeChild(oFrame); }, 60000);
                };
                document.body.appendChild(oFrame);
            }
        };
    }

    var oExports = {
        createQuarantineLabelActionCoordinator: createQuarantineLabelActionCoordinator,
        BULK_MAX_DOCUMENTS: BULK_MAX_DOCUMENTS
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
