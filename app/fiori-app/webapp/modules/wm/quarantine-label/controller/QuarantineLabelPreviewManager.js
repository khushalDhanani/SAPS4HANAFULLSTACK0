(function () {
    "use strict";

    /** Same rules as the server (QuarantineLabelAdapter.normalizeInput); the server stays authoritative. */
    function validate(oData) {
        var mErrors = {};
        if (!/^\d{1,10}$/.test(String(oData.materialDocument || "").trim())) {
            mErrors.materialDocument = "qlDocInvalid";
        }
        if (!/^\d{4}$/.test(String(oData.year || "").trim())) {
            mErrors.year = "qlYearInvalid";
        }
        if (String(oData.text || "").length > 50) {
            mErrors.text = "qlTextTooLong";
        }
        return mErrors;
    }

    /** base64 PDF -> object URL the PDFViewer, download and print share. */
    function toObjectUrl(sBase64) {
        var sBinary = window.atob(sBase64);
        var aBytes = new Uint8Array(sBinary.length);
        for (var i = 0; i < sBinary.length; i++) {
            aBytes[i] = sBinary.charCodeAt(i);
        }
        return URL.createObjectURL(new Blob([aBytes], { type: "application/pdf" }));
    }

    function createQuarantineLabelPreviewManager(deps) {
        deps = deps || {};
        var QuarantineLabelService = deps.QuarantineLabelService;
        var ZquarLabelLayout = deps.ZquarLabelLayout;
        var ZquarLabelPdf = deps.ZquarLabelPdf;
        var ZquarLabelRows = deps.ZquarLabelRows;
        var AuthService = deps.AuthService;

        return {
            /** Static texts and captions of the 4 x 6 label, resolved from i18n by the layout's keys. */
            _labelTexts: function () {
                var that = this;
                var mKeys = Object.assign({}, ZquarLabelLayout.STATIC_KEYS, ZquarLabelLayout.CAPTION_KEYS, ZquarLabelLayout.EXTRA_KEYS);
                var mTexts = {};
                Object.keys(mKeys).forEach(function (k) {
                    mTexts[k] = that.getText(mKeys[k]);
                });
                return mTexts;
            },

            _clearPreview: function () {
                var oVm = this.getModel && this.getModel("qlView");
                if (!oVm) {
                    return;
                }
                this._oPrintJob = null;
                var sUrl = oVm.getProperty("/pdfUrl");
                if (sUrl) {
                    URL.revokeObjectURL(sUrl);
                }
                oVm.setProperty("/pdfUrl", "");
                oVm.setProperty("/fileName", "");
                oVm.setProperty("/labelCount", 0);
            },

            /** Any input change makes the shown preview stale: drop it and ignore an in-flight answer. */
            onInputChange: function () {
                this._iRequest++;
                this._clearPreview();
                var oVm = this.getModel("qlView");
                oVm.setProperty("/busy", false);
                oVm.setProperty("/message", "");
            },

            onPreview: function () {
                var oVm = this.getModel("qlView");
                if (oVm.getProperty("/busy")) {
                    return; // one request at a time
                }
                var oData = oVm.getData();
                var mErrors = validate(oData);
                this._setState("doc", mErrors.materialDocument);
                this._setState("year", mErrors.year);
                this._setState("text", mErrors.text);
                if (Object.keys(mErrors).length) {
                    oVm.setProperty("/message", this.getText("qlFixInput", null, "Please correct the highlighted fields."));
                    oVm.setProperty("/messageType", "Error");
                    return;
                }

                this._clearPreview();
                var iRequest = ++this._iRequest;
                var that = this;
                oVm.setProperty("/busy", true);
                oVm.setProperty("/message", "");
                return QuarantineLabelService.generateLabels({
                    materialDocument: String(oData.materialDocument).trim(),
                    year: String(oData.year).trim(),
                    text: String(oData.text || "").trim()
                }).then(function (oResult) {
                    if (iRequest !== that._iRequest) {
                        return; // inputs changed meanwhile: never show an old answer as the current one
                    }
                    if (!oResult || !oResult.PdfBase64) {
                        throw new Error(that.getText("qlNoPdf", null, "SAP did not return a PDF."));
                    }
                    oVm.setProperty("/pdfUrl", toObjectUrl(oResult.PdfBase64));
                    oVm.setProperty("/fileName", oResult.FileName || "QuarantineLabels.pdf");
                    oVm.setProperty("/labelCount", oResult.LabelCount || 0);
                    var sReady = that.getText("qlReady", [oResult.LabelCount || 0], "{0} label(s) ready.");
                    var sSizeWarning = that._pageSizeWarning(oResult);
                    oVm.setProperty("/message", sSizeWarning ? sReady + " " + sSizeWarning : sReady);
                    oVm.setProperty("/messageType", sSizeWarning ? "Warning" : "Success");
                }).catch(function (oError) {
                    if (iRequest !== that._iRequest) {
                        return;
                    }
                    oVm.setProperty("/message", (oError && oError.message) || that.getText("qlFailed", null, "Quarantine labels could not be generated."));
                    oVm.setProperty("/messageType", oError && oError.status === 503 ? "Warning" : "Error");
                }).finally(function () {
                    if (iRequest === that._iRequest) {
                        oVm.setProperty("/busy", false);
                    }
                });
            },

            /**
             * App-drawn 4 x 6 ZQUAR labels (same layout as the SAP label, bigger barcode): SAP label rows -> label fields ->
             * jsPDF in the browser; shown, printed and downloaded like the SAP PDF. Printer dpi: the layout's 203 default.
             */
            on4x6Labels: function () {
                var oVm = this.getModel("qlView");
                if (oVm.getProperty("/busy")) {
                    return;
                }
                var oData = oVm.getData();
                var mErrors = validate(oData);
                this._setState("doc", mErrors.materialDocument);
                this._setState("year", mErrors.year);
                this._setState("text", mErrors.text);
                if (Object.keys(mErrors).length) {
                    oVm.setProperty("/message", this.getText("qlFixInput", null, "Please correct the highlighted fields."));
                    oVm.setProperty("/messageType", "Error");
                    return;
                }

                this._clearPreview();
                var iRequest = ++this._iRequest;
                var that = this;
                oVm.setProperty("/busy", true);
                oVm.setProperty("/message", "");
                return QuarantineLabelService.labelRows({
                    materialDocument: String(oData.materialDocument).trim(),
                    year: String(oData.year).trim(),
                    text: String(oData.text || "").trim()
                }).then(function (oResult) {
                    if (iRequest !== that._iRequest) {
                        return null;
                    }
                    if (!oResult || !oResult.Rows || !oResult.Rows.length) {
                        throw new Error(that.getText("qlFailed", null, "Quarantine labels could not be generated."));
                    }
                    // The layout's default size (4x6)
                    var mTexts = that._labelTexts();
                    var aLabels = ZquarLabelRows.toLabels(oResult.Rows, mTexts, AuthService.getCurrentUserName(that.getOwnerComponent()));
                    var sVariant = oVm.getProperty("/variant") || "vertical";
                    var oOpts = { size: oResult.LabelSize || ZquarLabelLayout.DEFAULT_SIZE, variant: sVariant };
                    return ZquarLabelPdf.toBlob(aLabels, mTexts, oOpts)
                        .then(function (oPdf) {
                            if (iRequest !== that._iRequest) {
                                return;
                            }
                            that._oPrintJob = { labels: aLabels, texts: mTexts, opts: oOpts };
                            oVm.setProperty("/pdfUrl", URL.createObjectURL(oPdf.blob));
                            oVm.setProperty("/fileName", "QuarantineLabels4x6_" + oResult.MaterialDocument + "_" + oResult.MaterialDocumentYear + ".pdf");
                            oVm.setProperty("/labelCount", oResult.Rows.length);
                            var sReady = that.getText("ql4x6Ready", [oResult.Rows.length]);
                            var aWarn = oPdf.warnings.map(function (w) { return that.getText("qlLabelWarn_" + w.code, [w.label]); });
                            oVm.setProperty("/message", aWarn.length ? sReady + " " + that.getText("ql4x6Warnings", [aWarn.join("; ")]) : sReady);
                            oVm.setProperty("/messageType", aWarn.length ? "Warning" : "Success");
                        });
                }).catch(function (oError) {
                    if (iRequest !== that._iRequest) {
                        return;
                    }
                    // A render error names the label (e.g. a storage unit too long for the barcode); nothing is shown
                    var sRenderError = oError && oError.code && oError.label ? that.getText("ql4x6Error_" + oError.code, [oError.label]) : "";
                    oVm.setProperty("/message", sRenderError || (oError && oError.message) || that.getText("qlFailed", null, "Quarantine labels could not be generated."));
                    oVm.setProperty("/messageType", oError && oError.status === 503 ? "Warning" : "Error");
                }).finally(function () {
                    if (iRequest === that._iRequest) {
                        oVm.setProperty("/busy", false);
                    }
                });
            },

            /** The server decides whether the size matches (PageSizeOk); this only words the warning. */
            _pageSizeWarning: function (oResult) {
                if (oResult.PageSizeOk !== false) {
                    return "";
                }
                if (oResult.PageWidthPt === null || oResult.PageWidthPt === undefined) {
                    return this.getText("qlPageSizeUnknown", [oResult.LabelSize]);
                }
                return this.getText("qlPageSizeMismatch", [oResult.PageWidthPt, oResult.PageHeightPt, oResult.LabelSize]);
            },

            _setState: function (sPrefix, sErrorKey) {
                var oVm = this.getModel("qlView");
                oVm.setProperty("/" + sPrefix + "State", sErrorKey ? "Error" : "None");
                oVm.setProperty("/" + sPrefix + "StateText", sErrorKey ? this.getText(sErrorKey) : "");
            }
        };
    }

    var oExports = {
        createQuarantineLabelPreviewManager: createQuarantineLabelPreviewManager,
        validate: validate,
        toObjectUrl: toObjectUrl
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
