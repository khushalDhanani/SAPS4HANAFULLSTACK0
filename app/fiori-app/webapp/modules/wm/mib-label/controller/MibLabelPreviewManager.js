(function () {
    "use strict";

    function validateInput(oData) {
        var mErrors = {};
        var sLgnum = String(oData.warehouseNumber || "").trim();
        var sTanum = String(oData.transferOrderNumber || "").trim();
        var sWeight = String(oData.weightedBy || "").trim();
        var sCheck = String(oData.checkedBy || "").trim();

        if (!sLgnum || !/^[A-Za-z0-9]{1,3}$/.test(sLgnum)) {
            mErrors.warehouseNumber = "mibWarehouseInvalid";
        }
        if (!sTanum || !/^\d{1,10}$/.test(sTanum)) {
            mErrors.transferOrderNumber = "mibToInvalid";
        }
        if (sWeight.length > 12) {
            mErrors.weightedBy = "mibUsernameTooLong";
        }
        if (sCheck.length > 12) {
            mErrors.checkedBy = "mibUsernameTooLong";
        }

        return mErrors;
    }

    function base64ToBlobUrl(sBase64) {
        var sBinary = window.atob(sBase64);
        var aBytes = new Uint8Array(sBinary.length);
        for (var i = 0; i < sBinary.length; i++) {
            aBytes[i] = sBinary.charCodeAt(i);
        }
        var oBlob = new Blob([aBytes], { type: "application/pdf" });
        return {
            blob: oBlob,
            url: URL.createObjectURL(oBlob)
        };
    }

    function createMibLabelPreviewManager(deps) {
        deps = deps || {};
        var MibLabelService = deps.MibLabelService;
        var MibLabelPdf = deps.MibLabelPdf;
        var MessageBox = deps.MessageBox;
        var MessageToast = deps.MessageToast;

        return {
            _clearPreview: function () {
                this._revokePdfUrl();
                var oModel = this.getModel("mibView");
                oModel.setProperty("/pdfSource", "");
                oModel.setProperty("/pdfTitle", "");
                oModel.setProperty("/fileName", "");
                oModel.setProperty("/labelCount", 0);
                oModel.setProperty("/message", "");
            },

            onInputChange: function () {
                this._iRequest++;
                this._clearPreview();
                var oModel = this.getModel("mibView");
                oModel.setProperty("/busy", false);
                oModel.setProperty("/warehouseState", "None");
                oModel.setProperty("/warehouseStateText", "");
                oModel.setProperty("/toState", "None");
                oModel.setProperty("/toStateText", "");
                oModel.setProperty("/weightedByState", "None");
                oModel.setProperty("/weightedByStateText", "");
                oModel.setProperty("/checkedByState", "None");
                oModel.setProperty("/checkedByStateText", "");
            },

            onVariantChange: function () {
                if (this._oCurrentRows && this._oCurrentRows.length > 0) {
                    this.on4x6Labels();
                }
            },

            onPreview: function () {
                var oModel = this.getModel("mibView");
                if (oModel.getProperty("/busy")) {
                    return;
                }
                var oData = {
                    warehouseNumber: oModel.getProperty("/warehouseNumber"),
                    transferOrderNumber: oModel.getProperty("/transferOrderNumber"),
                    weightedBy: oModel.getProperty("/weightedBy"),
                    checkedBy: oModel.getProperty("/checkedBy"),
                    variant: oModel.getProperty("/variant") || "vertical"
                };

                var mErrors = validateInput(oData);
                if (Object.keys(mErrors).length > 0) {
                    this._applyValidationErrors(mErrors);
                    oModel.setProperty("/message", this.getText("mibFixInput", null, "Please correct the highlighted fields."));
                    oModel.setProperty("/messageType", "Error");
                    return;
                }

                this._clearPreview();
                var iRequest = ++this._iRequest;
                var that = this;
                oModel.setProperty("/busy", true);
                oModel.setProperty("/message", "");

                return MibLabelService.generateMibSticker(oData).then(function (oResult) {
                    if (iRequest !== that._iRequest) {
                        return;
                    }
                    oModel.setProperty("/busy", false);
                    if (oResult && oResult.PdfBase64) {
                        var oBlobInfo = base64ToBlobUrl(oResult.PdfBase64);
                        that._pdfBlobUrl = oBlobInfo.url;
                        that._pdfBlob = oBlobInfo.blob;

                        oModel.setProperty("/pdfSource", oBlobInfo.url);
                        oModel.setProperty("/pdfTitle", oResult.FileName || "MIB-Sticker.pdf");
                        oModel.setProperty("/fileName", oResult.FileName || "MIB-Sticker.pdf");
                        oModel.setProperty("/labelCount", oResult.LabelCount || 1);
                        var sReady = that.getText("mibReady", [oResult.LabelCount || 1], "{0} label(s) ready.");
                        oModel.setProperty("/message", sReady);
                        oModel.setProperty("/messageType", "Success");
                        MessageToast.show(sReady);
                    }
                }).catch(function (oErr) {
                    if (iRequest !== that._iRequest) {
                        return;
                    }
                    var sMessage = oErr && oErr.message ? oErr.message : "Error generating sticker";
                    var iStatus = oErr && oErr.status ? oErr.status : 500;

                    if (iStatus === 503) {
                        oModel.setProperty("/busy", false);
                        // Fallback to table data inspect and client-side PDF preview
                        return that.on4x6Labels().then(function () {
                            oModel.setProperty("/messageType", "Warning");
                            oModel.setProperty("/message", sMessage + " " + that.getText("mibClientFallbackNote"));
                        });
                    } else {
                        oModel.setProperty("/busy", false);
                        oModel.setProperty("/messageType", "Error");
                        oModel.setProperty("/message", sMessage);
                        MessageBox.error(sMessage);
                    }
                });
            },

            /**
             * App-drawn 4 x 6 sticker labels from SAP table data (LTAK, LTAP, MAKT, AFPO).
             */
            on4x6Labels: function () {
                var oModel = this.getModel("mibView");
                if (oModel.getProperty("/busy")) {
                    return Promise.resolve();
                }
                var oData = {
                    warehouseNumber: oModel.getProperty("/warehouseNumber"),
                    transferOrderNumber: oModel.getProperty("/transferOrderNumber"),
                    weightedBy: oModel.getProperty("/weightedBy"),
                    checkedBy: oModel.getProperty("/checkedBy"),
                    variant: oModel.getProperty("/variant") || "vertical"
                };

                var mErrors = validateInput(oData);
                if (Object.keys(mErrors).length > 0) {
                    this._applyValidationErrors(mErrors);
                    oModel.setProperty("/message", this.getText("mibFixInput", null, "Please correct the highlighted fields."));
                    oModel.setProperty("/messageType", "Error");
                    return Promise.resolve();
                }

                this._clearPreview();
                var iRequest = ++this._iRequest;
                var that = this;
                oModel.setProperty("/busy", true);
                oModel.setProperty("/message", "");

                return MibLabelService.readMibStickerData(oData).then(function (oResponse) {
                    if (iRequest !== that._iRequest) {
                        return null;
                    }
                    var aRows = Array.isArray(oResponse) ? oResponse : ((oResponse && oResponse.value) || []);
                    if (!aRows.length) {
                        throw new Error(that.getText("mibNoRowsFound"));
                    }
                    that._oCurrentRows = aRows;
                    return MibLabelPdf.generateBlob(aRows, oData).then(function (oBlob) {
                        if (iRequest !== that._iRequest) {
                            return;
                        }
                        that._revokePdfUrl();
                        that._pdfBlobUrl = URL.createObjectURL(oBlob);
                        that._pdfBlob = oBlob;

                        var sVariantSuffix = oData.variant === "vertical" ? "-Vertical" : "";
                        var sFileName = "MIB-Sticker-" + oData.warehouseNumber + "-" + oData.transferOrderNumber + sVariantSuffix + ".pdf";
                        oModel.setProperty("/pdfSource", that._pdfBlobUrl);
                        oModel.setProperty("/pdfTitle", sFileName);
                        oModel.setProperty("/fileName", sFileName);
                        oModel.setProperty("/labelCount", aRows.length);
                        var sReady = that.getText("mib4x6Ready", [aRows.length], "{0} label(s) ready as 4 x 6 in labels.");
                        oModel.setProperty("/message", sReady);
                        oModel.setProperty("/messageType", "Success");
                        that._scrollTo("mibActions");
                    });
                }).catch(function (oError) {
                    if (iRequest !== that._iRequest) {
                        return;
                    }
                    oModel.setProperty("/message", (oError && oError.message) || that.getText("mibFailed", null, "Batch issue stickers could not be generated."));
                    oModel.setProperty("/messageType", "Error");
                }).finally(function () {
                    if (iRequest === that._iRequest) {
                        oModel.setProperty("/busy", false);
                    }
                });
            },

            _applyValidationErrors: function (mErrors) {
                var oModel = this.getModel("mibView");

                if (mErrors.warehouseNumber) {
                    oModel.setProperty("/warehouseState", "Error");
                    oModel.setProperty("/warehouseStateText", this.getText(mErrors.warehouseNumber));
                }
                if (mErrors.transferOrderNumber) {
                    oModel.setProperty("/toState", "Error");
                    oModel.setProperty("/toStateText", this.getText(mErrors.transferOrderNumber));
                }
                if (mErrors.weightedBy) {
                    oModel.setProperty("/weightedByState", "Error");
                    oModel.setProperty("/weightedByStateText", this.getText(mErrors.weightedBy));
                }
                if (mErrors.checkedBy) {
                    oModel.setProperty("/checkedByState", "Error");
                    oModel.setProperty("/checkedByStateText", this.getText(mErrors.checkedBy));
                }
            },

            _revokePdfUrl: function () {
                if (this._pdfBlobUrl) {
                    URL.revokeObjectURL(this._pdfBlobUrl);
                    this._pdfBlobUrl = null;
                    this._pdfBlob = null;
                }
            }
        };
    }

    var oExports = {
        createMibLabelPreviewManager: createMibLabelPreviewManager,
        validateInput: validateInput,
        base64ToBlobUrl: base64ToBlobUrl
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
