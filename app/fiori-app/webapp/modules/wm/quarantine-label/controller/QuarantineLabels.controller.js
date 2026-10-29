sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/quarantine-label/service/QuarantineLabelService",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelLayout",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelPdf",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelRows",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService"
], function (BaseController, JSONModel, QuarantineLabelService, ZquarLabelLayout, ZquarLabelPdf, ZquarLabelRows, MessageBox, MessageToast, AuthService) {
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

    var LIST_MAX_DAYS = 31;      // same limit as the server (QuarantineLabelAdapter.normalizeListInput)
    var BULK_MAX_DOCUMENTS = 20; // documents per combined PDF, so the browser stays responsive

    /** Date -> "yyyy-MM-dd" in local time ("" for no date). */
    function isoDay(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) {
            return "";
        }
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }

    /** Same rules as the server; the server stays authoritative. Returns an i18n key or "". */
    function validateList(oList) {
        if (!/^[A-Za-z0-9]{4}$/.test(String(oList.plant || "").trim())) {
            return "qlListPlantInvalid";
        }
        if (String(oList.materialDocument || "").trim()) {
            return /^\d{1,10}$/.test(String(oList.materialDocument).trim()) && /^\d{4}$/.test(String(oList.year || "").trim())
                ? "" : "qlListDocInvalid";
        }
        if (!isoDay(oList.dateFrom) || !isoDay(oList.dateTo)) {
            return "qlListDatesMissing";
        }
        var iDays = Math.round((Date.UTC(oList.dateTo.getFullYear(), oList.dateTo.getMonth(), oList.dateTo.getDate())
            - Date.UTC(oList.dateFrom.getFullYear(), oList.dateFrom.getMonth(), oList.dateFrom.getDate())) / 86400000) + 1;
        return iDays > LIST_MAX_DAYS ? "qlListRangeTooLong" : "";
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
            // Goods-receipt list (movement type 101): plant + posting-date range (default last 7 days) or one document
            var dTo = new Date();
            var dFrom = new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate() - 6);
            this.setModel(new JSONModel({
                plant: "", dateFrom: dFrom, dateTo: dTo, materialDocument: "", year: String(dTo.getFullYear()),
                documents: [], listed: false, more: false, selectedCount: 0
            }), "qlList");
            this._iRequest = 0;
            this._initPlant();
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
                var aLabels = ZquarLabelRows.toLabels(oResult.Rows, mTexts, AuthService.getCurrentUserName(that.getOwnerComponent()));
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

        /** Pre-fills the plant with the user's first plant; the server checks the plant on every list read. */
        _initPlant: function () {
            var that = this;
            return QuarantineLabelService.getPlantContext().then(function (oCtx) {
                var oList = that.getModel("qlList");
                if (!String(oList.getProperty("/plant") || "").trim() && oCtx.plants[0]) {
                    oList.setProperty("/plant", oCtx.plants[0]);
                }
            }).catch(function () {
                // the user types the plant instead; the list read still checks it on the server
            });
        },

        onListGo: function () {
            var oVm = this.getModel("qlView");
            if (oVm.getProperty("/busy")) {
                return;
            }
            var oList = this.getModel("qlList");
            var sError = validateList(oList.getData());
            if (sError) {
                oVm.setProperty("/message", this.getText(sError));
                oVm.setProperty("/messageType", "Error");
                return;
            }
            var oData = oList.getData();
            var bDoc = !!String(oData.materialDocument || "").trim();
            var that = this;
            oVm.setProperty("/busy", true);
            oVm.setProperty("/message", "");
            return QuarantineLabelService.listDocuments({
                plant: String(oData.plant).trim().toUpperCase(),
                dateFrom: bDoc ? "" : isoDay(oData.dateFrom),
                dateTo: bDoc ? "" : isoDay(oData.dateTo),
                materialDocument: bDoc ? String(oData.materialDocument).trim() : "",
                year: bDoc ? String(oData.year).trim() : ""
            }).then(function (oResult) {
                var aDocs = (oResult && oResult.Documents) || [];
                oList.setProperty("/documents", aDocs);
                oList.setProperty("/more", !!(oResult && oResult.More));
                oList.setProperty("/listed", true);
                oList.setProperty("/selectedCount", 0);
                var oTable = that.byId && that.byId("qlDocTable");
                if (oTable) {
                    oTable.removeSelections(true);
                }
                if (oResult && oResult.More) {
                    oVm.setProperty("/message", that.getText("qlListMore", [aDocs.length]));
                    oVm.setProperty("/messageType", "Warning");
                }
            }).catch(function (oError) {
                oList.setProperty("/documents", []);
                oList.setProperty("/listed", false);
                oVm.setProperty("/message", (oError && oError.message) || that.getText("qlListFailed"));
                oVm.setProperty("/messageType", "Error");
            }).finally(function () {
                oVm.setProperty("/busy", false);
            });
        },

        formatCount: function (sPattern, aDocs) {
            return String(sPattern || "").replace("{0}", (aDocs || []).length);
        },

        formatSelected: function (sPattern, iCount) {
            return String(sPattern || "").replace("{0}", iCount || 0);
        },

        onListSelectionChange: function (oEvent) {
            this.getModel("qlList").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
        },

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

        /**
         * List actions run far from the page-top message strip (a long list scrolls it out of view): repeat the result
         * where the user is — errors and warnings in a dialog, success as a toast. The strip keeps the same text.
         */
        _notifyResult: function () {
            var oVm = this.getModel("qlView");
            var sText = oVm.getProperty("/message");
            if (!sText) {
                return;
            }
            var sType = oVm.getProperty("/messageType");
            if (sType === "Error") {
                MessageBox.error(sText);
            } else if (sType === "Warning") {
                MessageBox.warning(sText);
            } else {
                MessageToast.show(sText);
            }
        },

        _scrollTo: function (sId) {
            var oCtrl = this.byId && this.byId(sId);
            var oDom = oCtrl && oCtrl.getDomRef && oCtrl.getDomRef();
            if (oDom && oDom.scrollIntoView) {
                oDom.scrollIntoView({ behavior: "smooth", block: "start" });
            }
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
                return { labels: ZquarLabelRows.toLabels(aRows, mTexts, AuthService.getCurrentUserName(that.getOwnerComponent())), texts: mTexts, opts: { size: aSizes[0] } };
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
