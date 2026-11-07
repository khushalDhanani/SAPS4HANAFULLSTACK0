sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/mib-label/service/MibLabelService",
    "saps4hana/fiori/modules/wm/mib-label/util/MibLabelPdf",
    "saps4hana/fiori/service/AuthService",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, MibLabelService, MibLabelPdf, AuthService, MessageBox, MessageToast) {
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

    return BaseController.extend("saps4hana.fiori.modules.wm.mib-label.controller.MibLabel", {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                warehouseNumber: "W01",
                transferOrderNumber: "",
                weightedBy: "",
                checkedBy: "",
                variant: "standard",
                hasPdf: false,
                pdfSource: "",
                pdfTitle: "",
                fileName: "MIB-Sticker.pdf",
                message: "",
                messageType: "Information",
                warehouseState: "None",
                warehouseStateText: "",
                toState: "None",
                toStateText: "",
                weightedByState: "None",
                weightedByStateText: "",
                checkedByState: "None",
                checkedByStateText: ""
            });
            this.setModel(oViewModel, "mibView");

            var oDataModel = new JSONModel({
                items: []
            });
            this.setModel(oDataModel, "mibData");

            this.getRouter().getRoute("wmMibLabel").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oModel = this.getModel("mibView");
            var oUser = AuthService.getCurrentUser();
            if (oUser && oUser.username && !oModel.getProperty("/weightedBy")) {
                oModel.setProperty("/weightedBy", oUser.username.toUpperCase());
            }

            MibLabelService.getWarehouseContext().then(function (oContext) {
                if (oContext && oContext.warehouses && oContext.warehouses.length > 0) {
                    var sCurrent = oModel.getProperty("/warehouseNumber");
                    if (!sCurrent) {
                        oModel.setProperty("/warehouseNumber", oContext.warehouses[0]);
                    }
                }
            }).catch(function () {
                // Ignore context lookup failures
            });
        },

        onInputChange: function () {
            var oModel = this.getModel("mibView");
            oModel.setProperty("/warehouseState", "None");
            oModel.setProperty("/warehouseStateText", "");
            oModel.setProperty("/toState", "None");
            oModel.setProperty("/toStateText", "");
            oModel.setProperty("/weightedByState", "None");
            oModel.setProperty("/weightedByStateText", "");
            oModel.setProperty("/checkedByState", "None");
            oModel.setProperty("/checkedByStateText", "");
            oModel.setProperty("/message", "");
            this._revokePdfUrl();
            oModel.setProperty("/hasPdf", false);
            oModel.setProperty("/pdfSource", "");
        },

        onPreview: function () {
            var oModel = this.getModel("mibView");
            var oData = {
                warehouseNumber: oModel.getProperty("/warehouseNumber"),
                transferOrderNumber: oModel.getProperty("/transferOrderNumber"),
                weightedBy: oModel.getProperty("/weightedBy"),
                checkedBy: oModel.getProperty("/checkedBy"),
                variant: oModel.getProperty("/variant") || "standard"
            };

            var mErrors = validateInput(oData);
            if (Object.keys(mErrors).length > 0) {
                this._applyValidationErrors(mErrors);
                return;
            }

            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            this._revokePdfUrl();

            var that = this;
            MibLabelService.generateMibSticker(oData).then(function (oResult) {
                oModel.setProperty("/busy", false);
                if (oResult && oResult.PdfBase64) {
                    var oBlobInfo = base64ToBlobUrl(oResult.PdfBase64);
                    that._pdfBlobUrl = oBlobInfo.url;
                    that._pdfBlob = oBlobInfo.blob;

                    oModel.setProperty("/pdfSource", oBlobInfo.url);
                    oModel.setProperty("/pdfTitle", oResult.FileName || "MIB-Sticker.pdf");
                    oModel.setProperty("/fileName", oResult.FileName || "MIB-Sticker.pdf");
                    oModel.setProperty("/hasPdf", true);

                    MessageToast.show(that.getText("mibStickerGeneratedSuccess"));
                }
                // Also load data rows for the inspection table
                that._loadStickerData(oData);
            }).catch(function (oErr) {
                var sMessage = oErr && oErr.message ? oErr.message : "Error generating sticker";
                var iStatus = oErr && oErr.status ? oErr.status : 500;

                if (iStatus === 503) {
                    oModel.setProperty("/messageType", "Warning");
                    oModel.setProperty("/message", sMessage + " " + that.getText("mibFallbackInspectionNote"));
                    // Fallback to table data inspect and client-side PDF preview; keep busy true
                    that._loadStickerData(oData, false, true);
                } else {
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/messageType", "Error");
                    oModel.setProperty("/message", sMessage);
                    MessageBox.error(sMessage);
                }
            });
        },

        onVariantChange: function () {
            var oViewModel = this.getModel("mibView");
            var oDataModel = this.getModel("mibData");
            var aRows = oDataModel.getProperty("/items");

            if (oViewModel.getProperty("/hasPdf") && aRows && aRows.length > 0) {
                var oData = {
                    warehouseNumber: oViewModel.getProperty("/warehouseNumber"),
                    transferOrderNumber: oViewModel.getProperty("/transferOrderNumber"),
                    weightedBy: oViewModel.getProperty("/weightedBy"),
                    checkedBy: oViewModel.getProperty("/checkedBy"),
                    variant: oViewModel.getProperty("/variant") || "standard"
                };
                var that = this;
                oViewModel.setProperty("/busy", true);
                MibLabelPdf.generateBlob(aRows, oData).then(function (oBlob) {
                    that._revokePdfUrl();
                    that._pdfBlobUrl = URL.createObjectURL(oBlob);
                    that._pdfBlob = oBlob;

                    var sVariantSuffix = oData.variant === "vertical" ? "-Vertical" : "";
                    var sFileName = "MIB-Sticker-" + oData.warehouseNumber + "-" + oData.transferOrderNumber + sVariantSuffix + ".pdf";
                    oViewModel.setProperty("/pdfSource", that._pdfBlobUrl);
                    oViewModel.setProperty("/pdfTitle", sFileName);
                    oViewModel.setProperty("/fileName", sFileName);
                    oViewModel.setProperty("/busy", false);
                }).catch(function () {
                    oViewModel.setProperty("/busy", false);
                });
            }
        },

        onInspectData: function () {
            var oModel = this.getModel("mibView");
            var oData = {
                warehouseNumber: oModel.getProperty("/warehouseNumber"),
                transferOrderNumber: oModel.getProperty("/transferOrderNumber"),
                weightedBy: oModel.getProperty("/weightedBy"),
                checkedBy: oModel.getProperty("/checkedBy"),
                variant: oModel.getProperty("/variant") || "standard"
            };

            var mErrors = validateInput(oData);
            if (Object.keys(mErrors).length > 0) {
                this._applyValidationErrors(mErrors);
                return;
            }

            oModel.setProperty("/busy", true);
            this._loadStickerData(oData, true);
        },

        _loadStickerData: function (oData, bShowSuccessToast, bGenerateFallbackPdf) {
            var oViewModel = this.getModel("mibView");
            var oDataModel = this.getModel("mibData");
            var that = this;

            MibLabelService.readMibStickerData(oData).then(function (oResponse) {
                var aRows = Array.isArray(oResponse) ? oResponse : ((oResponse && oResponse.value) || []);
                oDataModel.setProperty("/items", aRows);

                if (bGenerateFallbackPdf && aRows && aRows.length > 0) {
                    return MibLabelPdf.generateBlob(aRows, oData).then(function (oBlob) {
                        that._revokePdfUrl();
                        that._pdfBlobUrl = URL.createObjectURL(oBlob);
                        that._pdfBlob = oBlob;

                        var sVariantSuffix = oData.variant === "vertical" ? "-Vertical" : "";
                        var sFileName = "MIB-Sticker-" + oData.warehouseNumber + "-" + oData.transferOrderNumber + sVariantSuffix + ".pdf";
                        oViewModel.setProperty("/pdfSource", that._pdfBlobUrl);
                        oViewModel.setProperty("/pdfTitle", sFileName);
                        oViewModel.setProperty("/fileName", sFileName);
                        oViewModel.setProperty("/hasPdf", true);
                        oViewModel.setProperty("/messageType", "Warning");
                        oViewModel.setProperty("/message", that.getText("mibClientFallbackNote"));
                        oViewModel.setProperty("/busy", false);
                        MessageToast.show(that.getText("mibStickerGeneratedSuccess"));
                    }).catch(function () {
                        oViewModel.setProperty("/busy", false);
                        // PDF generation error: message remains table inspection note
                    });
                }

                oViewModel.setProperty("/busy", false);
                if (bShowSuccessToast) {
                    if (aRows && aRows.length > 0) {
                        MessageToast.show(that.getText("mibDataLoadedSuccess", [aRows.length]));
                    } else {
                        oViewModel.setProperty("/messageType", "Warning");
                        oViewModel.setProperty("/message", that.getText("mibNoRowsFound"));
                    }
                }
            }).catch(function (oErr) {
                oViewModel.setProperty("/busy", false);
                var sMessage = oErr && oErr.message ? oErr.message : "Failed to load sticker data";
                oViewModel.setProperty("/messageType", "Error");
                oViewModel.setProperty("/message", sMessage);
            });
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
        },

        onExit: function () {
            this._revokePdfUrl();
        }
    });
});
