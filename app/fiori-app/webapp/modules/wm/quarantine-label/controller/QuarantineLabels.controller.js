sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/quarantine-label/service/QuarantineLabelService",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelLayout",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelPdf",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelRows"
], function (BaseController, JSONModel, QuarantineLabelService, ZquarLabelLayout, ZquarLabelPdf, ZquarLabelRows) {
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

    return BaseController.extend("saps4hana.fiori.modules.wm.quarantine-label.controller.QuarantineLabels", {

        onInit: function () {
            this.setModel(new JSONModel({
                materialDocument: "",
                year: String(new Date().getFullYear()),
                text: "",
                busy: false,
                message: "",
                messageType: "Information",
                docState: "None", docStateText: "",
                yearState: "None", yearStateText: "",
                textState: "None", textStateText: "",
                pdfUrl: "",
                fileName: "",
                labelCount: 0
            }), "qlView");
            this._iRequest = 0;
            var oRouter = this.getRouter && this.getRouter();
            if (oRouter && oRouter.getRoute("wmQuarantineLabels")) {
                oRouter.getRoute("wmQuarantineLabels").attachPatternMatched(this._clearPreview, this);
            }
        },

        onExit: function () {
            this._clearPreview();
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
                // Size from the plant's BusinessConfig; the layout's default (4x6) when none is configured
                var mTexts = that._labelTexts();
                var aLabels = ZquarLabelRows.toLabels(oResult.Rows, mTexts);
                var oOpts = { size: oResult.LabelSize || ZquarLabelLayout.DEFAULT_SIZE };
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
        }
    });
});
