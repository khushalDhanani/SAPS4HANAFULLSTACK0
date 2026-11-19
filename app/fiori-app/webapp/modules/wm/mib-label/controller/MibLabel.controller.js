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

    var LIST_MAX_DAYS = 31;
    var BULK_MAX_ORDERS = 20;

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

    /** Date -> "yyyy-MM-dd" in local time ("" for no date). */
    function isoDay(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) {
            return "";
        }
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }

    function validateList(oList) {
        if (!/^[A-Za-z0-9]{1,3}$/.test(String(oList.warehouseNumber || "").trim())) {
            return "mibListWarehouseInvalid";
        }
        if (String(oList.transferOrderNumber || "").trim()) {
            return /^\d{1,10}$/.test(String(oList.transferOrderNumber).trim()) ? "" : "mibToInvalid";
        }
        if (!isoDay(oList.dateFrom) || !isoDay(oList.dateTo)) {
            return "mibListDatesMissing";
        }
        var iDays = Math.round((Date.UTC(oList.dateTo.getFullYear(), oList.dateTo.getMonth(), oList.dateTo.getDate())
            - Date.UTC(oList.dateFrom.getFullYear(), oList.dateFrom.getMonth(), oList.dateFrom.getDate())) / 86400000) + 1;
        return iDays > LIST_MAX_DAYS ? "mibListRangeTooLong" : "";
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
                variant: "vertical",
                pdfSource: "",
                pdfTitle: "",
                fileName: "",
                labelCount: 0,
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

            var dTo = new Date();
            var dFrom = new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate() - 6);
            var oListModel = new JSONModel({
                warehouseNumber: "W01",
                dateFrom: dFrom,
                dateTo: dTo,
                transferOrderNumber: "",
                transferOrders: [],
                listed: false,
                more: false,
                selectedCount: 0
            });
            this.setModel(oListModel, "mibList");

            this._iRequest = 0;
            var oRouter = this.getRouter && this.getRouter();
            if (oRouter && oRouter.getRoute("wmMibLabel")) {
                oRouter.getRoute("wmMibLabel").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._clearPreview();
            var oVm = this.getModel("mibView");
            var oList = this.getModel("mibList");
            var oUser = AuthService.getCurrentUser();
            if (oUser && oUser.username && !oVm.getProperty("/weightedBy")) {
                oVm.setProperty("/weightedBy", oUser.username.toUpperCase());
            }

            MibLabelService.getWarehouseContext().then(function (oContext) {
                if (oContext && oContext.warehouses && oContext.warehouses.length > 0) {
                    var sCurrent = oVm.getProperty("/warehouseNumber");
                    if (!sCurrent) {
                        oVm.setProperty("/warehouseNumber", oContext.warehouses[0]);
                    }
                    var sListWh = oList.getProperty("/warehouseNumber");
                    if (!sListWh) {
                        oList.setProperty("/warehouseNumber", oContext.warehouses[0]);
                    }
                }
            }).catch(function () {
                // Ignore context lookup failures
            });
        },

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

        onListGo: function () {
            var oVm = this.getModel("mibView");
            if (oVm.getProperty("/busy")) {
                return;
            }
            var oList = this.getModel("mibList");
            var sError = validateList(oList.getData());
            if (sError) {
                oVm.setProperty("/message", this.getText(sError));
                oVm.setProperty("/messageType", "Error");
                return;
            }
            var oData = oList.getData();
            var bTo = !!String(oData.transferOrderNumber || "").trim();
            var that = this;
            oVm.setProperty("/busy", true);
            oVm.setProperty("/message", "");

            return MibLabelService.listTransferOrders({
                warehouseNumber: String(oData.warehouseNumber).trim().toUpperCase(),
                dateFrom: bTo ? "" : isoDay(oData.dateFrom),
                dateTo: bTo ? "" : isoDay(oData.dateTo),
                transferOrderNumber: bTo ? String(oData.transferOrderNumber).trim() : ""
            }).then(function (oResult) {
                var aOrders = (oResult && oResult.TransferOrders) || [];
                oList.setProperty("/transferOrders", aOrders);
                oList.setProperty("/more", !!(oResult && oResult.More));
                oList.setProperty("/listed", true);
                oList.setProperty("/selectedCount", 0);
                var oTable = that.byId && that.byId("mibToTable");
                if (oTable) {
                    oTable.removeSelections(true);
                }
                if (oResult && oResult.More) {
                    oVm.setProperty("/message", that.getText("mibListMore", [aOrders.length]));
                    oVm.setProperty("/messageType", "Warning");
                }
            }).catch(function (oError) {
                oList.setProperty("/transferOrders", []);
                oList.setProperty("/listed", false);
                oVm.setProperty("/message", (oError && oError.message) || that.getText("mibListFailed"));
                oVm.setProperty("/messageType", "Error");
            }).finally(function () {
                oVm.setProperty("/busy", false);
            });
        },

        formatCount: function (sPattern, aOrders) {
            return String(sPattern || "").replace("{0}", (aOrders || []).length);
        },

        formatSelected: function (sPattern, iCount) {
            return String(sPattern || "").replace("{0}", iCount || 0);
        },

        onListSelectionChange: function (oEvent) {
            this.getModel("mibList").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
        },

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

        _notifyResult: function () {
            var oVm = this.getModel("mibView");
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
