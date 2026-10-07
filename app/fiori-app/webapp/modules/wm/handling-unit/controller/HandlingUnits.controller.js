sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/BusyDialog",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPrinter",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPdf",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuBatchReader"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast, MessageBox, BusyDialog, HuLabelPrinter, HuLabelPdf, HuBatchReader) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";
    var PRINT_SAFE_LIMIT = 500; // Print All asks for extra confirmation above this many labels
    var READ_CHUNK = 8; // each label costs a detail (+ serials) read; cap concurrent reads
    var READ_TIMEOUT = 30000; // ms per HU read before one retry, then abort
    var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
    // Value-help input kind -> model path for its suggestion list.
    var VALUE_HELPS = { plant: "/vhPlant", packaging: "/vhPackaging", status: "/vhStatus", shippingpoint: "/vhShippingPoint", storagelocation: "/vhStorageLocation" };
    // Export columns: i18n label key -> result property (-> type), in table order. Same shape as Open261.
    var EXPORT_COLUMNS = [
        ["huColHandlingUnit", "HandlingUnitExternalID"], ["huColPackaging", "PackagingMaterial"], ["huPackagingMaterial", "PackagingMaterialName"],
        ["huPlant", "Plant"], ["huStorageLocation", "StorageLocation"], ["huColGrossWeight", "GrossWeight", "Number"], ["huColGrossWeight", "WeightUnit"],
        ["huColStatus", "StatusText"], ["huColReference", "ReferenceDocument"], ["huCreatedBy", "CreatedByUser"], ["huColCreated", "CreationDateTime"]
    ];

    return BaseController.extend("saps4hana.fiori.modules.wm.handling-unit.controller.HandlingUnits", {

        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                storageLocation: "",
                packagingMaterial: "",
                handlingUnitExternalID: "",
                status: "",
                shippingPoint: "",
                busy: false,
                printing: false,
                message: "",
                messageType: "Information",
                items: [],
                selectedCount: 0,
                vhPlant: [],
                vhPackaging: [],
                vhStatus: [],
                vhShippingPoint: [],
                vhStorageLocation: [],
                kpiTotal: 0,
                kpis: []
            }), "huView");
            this.getModel("huView").setSizeLimit(2000);
            this.setModel(new JSONModel({ packagingMaterial: "", plant: "", storageLocation: "", content: "", busy: false, error: "" }), "huCreate");
            this._loadValueHelps();
            this._loadKpis();
            this.getRouter().getRoute("wmHandlingUnits").attachPatternMatched(this.onRouteMatched, this);
        },

        _loadKpis: function () {
            var oModel = this.getModel("huView");
            ODataClient.get(BASE_PATH + "/statusKpis()").then(function (oResult) {
                oModel.setProperty("/kpiTotal", (oResult && oResult.Total) || 0);
                oModel.setProperty("/kpis", (oResult && oResult.Items) || []);
            }).catch(function () {
                // KPI cards are informational; a failure must not break the list.
            });
        },

        _loadValueHelps: function () {
            var oModel = this.getModel("huView");
            Object.keys(VALUE_HELPS).forEach(function (sKind) {
                ODataClient.get(BASE_PATH + "/valueHelp(kind='" + sKind + "')").then(function (oResult) {
                    oModel.setProperty(VALUE_HELPS[sKind], (oResult && oResult.Items) || []);
                }).catch(function () {
                    // A value-help failure must not break the filter bar; the input stays a plain text field.
                });
            });
        },

        // Entry via route: load the list straight away (no Go click). The adapter caps the result
        // at MAX_LIST (1000) server-side, so an unfiltered load is bounded; Go re-filters manually.
        onRouteMatched: function () {
            this.onGo();
        },

        onGo: function () {
            var oModel = this.getModel("huView");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/list(plant=" + q(o.plant) + ",storageLocation=" + q(o.storageLocation) +
                ",warehouse=" + q("") + ",packagingMaterial=" + q(o.packagingMaterial) +
                ",handlingUnitExternalID=" + q(o.handlingUnitExternalID) + ",status=" + q(o.status) +
                ",shippingPoint=" + q(o.shippingPoint) + ")";

            oModel.setProperty("/selectedCount", 0);
            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/items", oResult.Items || []);
                oModel.setProperty("/messageType", oResult.Truncated ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(oResult.Truncated ? "huTruncated" : "huSummary", [oResult.TotalCount, oResult.SapCount]));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/items", []);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("huLoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        onSelectionChange: function (oEvent) {
            this.getModel("huView").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
        },

        _rowsToObjects: function (aItems) {
            return aItems.map(function (i) { return i.getBindingContext("huView").getObject(); });
        },

        /** Fast path: one batched labels() action returns materialName + srNo for every chosen HU (no per-HU detail/serials). */
        _readLabelRecords: function (aRows, fnProgress, fnCancelled) {
            var self = this;
            var aIds = aRows.map(function (o) { return o.HandlingUnitExternalID; });
            return ODataClient.post(BASE_PATH + "/labels", { handlingUnitExternalIDs: aIds })
                .then(function (oResult) {
                    var aItems = (oResult && oResult.Items) || [];
                    if (!aItems.length) { return self._fallback(aRows, fnProgress, fnCancelled, "labels() returned no data"); }
                    var mByHu = {};
                    aItems.forEach(function (x) { mByHu[x.HandlingUnitExternalID] = x; });
                    fnProgress(aRows.length);
                    return aRows.map(function (o) {
                        var l = mByHu[o.HandlingUnitExternalID] || {};
                        return { huNumber: o.HandlingUnitExternalID, createdDate: o.CreationDateTime, materialName: l.MaterialName || "", srNo: l.SerialNumber || "" };
                    });
                })
                .catch(function (oErr) { return self._fallback(aRows, fnProgress, fnCancelled, (oErr && oErr.message) || "labels() request failed"); });
        },

        /** Fallback is never silent: warn with the reason and tell the user before the slow per-HU path runs. */
        _fallback: function (aRows, fnProgress, fnCancelled, sReason) {
            // eslint-disable-next-line no-console
            console.warn("[HU print] fast label service unavailable (" + sReason + "); using slow per-HU mode");
            MessageToast.show(this.getText("huPrintFallback"));
            return this._readLabelRecordsFallback(aRows, fnProgress, fnCancelled);
        },

        /** Fallback (labels() unavailable): the old per-HU detail(+serials) reads, chunked, then reduced to records. */
        _readLabelRecordsFallback: function (aRows, fnProgress, fnCancelled) {
            var fnRead = function (o) {
                return ODataClient.get(BASE_PATH + "/detail(handlingUnitExternalID=" + q(o.HandlingUnitExternalID) + ",warehouse=" + q(o.Warehouse) + ")")
                    .then(function (h) {
                        var p = h.HandlingUnitInternalNumber
                            ? ODataClient.get(BASE_PATH + "/serials(handlingUnitInternalNumber=" + q(h.HandlingUnitInternalNumber) + ")").catch(function () { return {}; })
                            : Promise.resolve({});
                        return p.then(function (s) { return { header: h, items: h.Items || [], serials: s.Items || [] }; });
                    });
            };
            return HuBatchReader.read(aRows, fnRead, {
                chunk: READ_CHUNK, timeoutMs: READ_TIMEOUT, retries: 1, onProgress: fnProgress, isCancelled: fnCancelled
            }).then(function (aWrappers) { return aWrappers.map(HuLabelPrinter.toRecord); });
        },

        /** Shared bulk job (Print All/Selected/Current Page, Download Selected): progress + cancel dialog, batched read, validation, then fnOutput(labels). */
        _runLabelJob: function (aRows, fnOutput, sSummaryKey) {
            if (!aRows.length) { return; }
            var self = this;
            var oModel = this.getModel("huView");
            var nTotal = aRows.length;
            var bCancel = false;
            oModel.setProperty("/printing", true); // disables every print/download button until the job ends
            var oDialog = new BusyDialog({
                title: this.getText("huPrintMenu"),
                text: this.getText("huPrintProgress", [0, nTotal]),
                showCancelButton: true,
                // BusyDialog has no 'cancel' event; the Cancel button fires 'close' with cancelPressed=true.
                close: function (oEvent) { if (oEvent.getParameter("cancelPressed")) { bCancel = true; } }
            });
            oDialog.open();
            var tFetch = performance.now();
            return this._readLabelRecords(aRows, function (nDone) {
                oDialog.setText(self.getText("huPrintProgress", [nDone, nTotal]));
            }, function () { return bCancel; })
                .then(function (aRecords) {
                    oDialog.close();
                    if (bCancel) { MessageToast.show(self.getText("huPrintCancelled")); return undefined; }
                    // eslint-disable-next-line no-console
                    console.log("[HU labels] fetch " + Math.round(performance.now() - tFetch) + "ms for " + nTotal + " HUs");
                    var oPrep = HuLabelPrinter.prepare(aRecords);
                    var tOut = performance.now();
                    return Promise.resolve(fnOutput(oPrep.labels)).then(function () {
                        // eslint-disable-next-line no-console
                        console.log("[HU labels] render/output " + Math.round(performance.now() - tOut) + "ms, " + oPrep.labels.length + " labels");
                        self._showJobSummary({ printed: oPrep.labels.length, skipped: oPrep.skipped, duplicatesRemoved: oPrep.duplicatesRemoved }, nTotal, sSummaryKey);
                    });
                })
                .catch(function (oError) {
                    oDialog.close();
                    MessageBox.error((oError && oError.message) || self.getText("huLoadError"));
                })
                .then(function () { oDialog.destroy(); oModel.setProperty("/printing", false); });
        },

        /** One-HU print/download from a row button: reads just that HU, busy-spins that button, no confirmation dialog. */
        _runRowJob: function (oButton, fnOutput) {
            if (oButton.getBusy()) { return undefined; } // ignore a rapid second click while this row's job runs (the busy spinner does not block the click itself)
            var self = this;
            var o = oButton.getBindingContext("huView").getObject(); // the row's HU from its context, never a row index
            oButton.setBusyIndicatorDelay(0);
            oButton.setBusy(true);
            return this._readLabelRecords([o], function () { }, function () { return false; })
                .then(function (aRecords) {
                    var oPrep = HuLabelPrinter.prepare(aRecords);
                    if (!oPrep.labels.length) {
                        var sReason = (oPrep.skipped[0] && oPrep.skipped[0].reason) || self.getText("huNoData");
                        MessageToast.show(self.getText("huPrintBadData", [sReason]));
                        return undefined;
                    }
                    return fnOutput(oPrep.labels);
                })
                .catch(function (oError) { MessageBox.error((oError && oError.message) || self.getText("huLoadError")); })
                .then(function () { oButton.setBusy(false); });
        },

        /** Confirms before a large job: always for Print All, otherwise only above the safety limit. fnGo runs on OK. */
        _confirmCount: function (nCount, bAlwaysConfirm, fnGo) {
            if (!nCount) { return; }
            var fnOnClose = function (a) { if (a === MessageBox.Action.OK) { fnGo(); } };
            if (nCount > PRINT_SAFE_LIMIT) {
                MessageBox.warning(this.getText("huPrintAllLarge", [nCount, PRINT_SAFE_LIMIT]), { onClose: fnOnClose });
            } else if (bAlwaysConfirm) {
                MessageBox.confirm(this.getText("huPrintAllConfirm", [nCount]), { onClose: fnOnClose });
            } else {
                fnGo();
            }
        },

        _fileStamp: function () {
            var d = new Date();
            var p = function (n) { return (n < 10 ? "0" : "") + n; };
            return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
        },

        /** "Printed/Downloaded X of Y" + removed-duplicates note + skipped list (with a CSV download when any were skipped). */
        _showJobSummary: function (oRes, nRequested, sSummaryKey) {
            var aSkipped = oRes.skipped || [];
            var sMsg = this.getText(sSummaryKey || "huPrintSummary", [oRes.printed, nRequested]);
            if (oRes.duplicatesRemoved) { sMsg += "\n" + this.getText("huPrintDupes", [oRes.duplicatesRemoved]); }
            if (!aSkipped.length) {
                if (oRes.duplicatesRemoved) { MessageToast.show(sMsg); }
                return; // all good, no skips: the print dialog is enough
            }
            sMsg += "\n" + this.getText("huPrintSkipped", [aSkipped.length]) + "\n" +
                aSkipped.slice(0, 10).map(function (s) { return "• " + (s.huNumber || "(blank)") + " - " + s.reason; }).join("\n");
            var sDownload = this.getText("huPrintDownloadSkipped");
            MessageBox.warning(sMsg, {
                actions: [sDownload, MessageBox.Action.CLOSE],
                emphasizedAction: MessageBox.Action.CLOSE,
                onClose: function (a) { if (a === sDownload) { this._downloadSkipped(aSkipped); } }.bind(this)
            });
        },

        _downloadSkipped: function (aSkipped) {
            var sCsv = "HU Number,Reason\n" + aSkipped.map(function (s) {
                return '"' + String(s.huNumber || "").replace(/"/g, '""') + '","' + String(s.reason).replace(/"/g, '""') + '"';
            }).join("\n");
            var sUrl = URL.createObjectURL(new Blob([sCsv], { type: "text/csv" }));
            var oA = document.createElement("a");
            oA.href = sUrl;
            oA.download = "skipped-handling-units.csv";
            document.body.appendChild(oA);
            oA.click();
            document.body.removeChild(oA);
            setTimeout(function () { URL.revokeObjectURL(sUrl); }, 1000);
        },

        _print: function (labels) { return HuLabelPrinter.print(labels, this._labelTexts()); },

        /** Print All: every HU matching the current filters (the full /items set, server-capped at MAX_LIST), with a confirm. */
        onPrintAll: function () {
            var self = this;
            var aAll = this.getModel("huView").getProperty("/items") || [];
            this._confirmCount(aAll.length, true, function () {
                self._runLabelJob(aAll, self._print.bind(self), "huPrintSummary");
            });
        },

        /** Print Selected: only the ticked rows. */
        onPrintSelected: function () {
            this._runLabelJob(this._rowsToObjects(this.byId("huTable").getSelectedItems()), this._print.bind(this), "huPrintSummary");
        },

        /** Print Current Page: only the rows currently rendered (the current growing page). */
        onPrintCurrentPage: function () {
            this._runLabelJob(this._rowsToObjects(this.byId("huTable").getItems()), this._print.bind(this), "huPrintSummary");
        },

        /** Download Selected: one PDF (one 4x4 page per ticked HU), same 500 safety limit + progress/Cancel. */
        onDownloadSelected: function () {
            var self = this;
            var aRows = this._rowsToObjects(this.byId("huTable").getSelectedItems());
            this._confirmCount(aRows.length, false, function () {
                var sFile = "HU_labels_" + self._fileStamp() + ".pdf";
                self._runLabelJob(aRows, function (labels) { return HuLabelPdf.download(labels, sFile); }, "huDownloadSummary");
            });
        },

        /** Row Print: print just this row's HU (1 POST, one 4x4 page, no confirm). */
        onRowPrint: function (oEvent) {
            var self = this;
            this._runRowJob(oEvent.getSource(), function (labels) { return self._print(labels); });
        },

        /** Row Download: PDF of just this row's HU as HU_<huNumber>.pdf. */
        onRowDownload: function (oEvent) {
            this._runRowJob(oEvent.getSource(), function (labels) { return HuLabelPdf.download(labels, "HU_" + labels[0].huNumber + ".pdf"); });
        },

        _labelTexts: function () {
            var m = {};
            HuLabelPrinter.TEXT_KEYS.forEach(function (k) { m[k] = this.getText(k); }, this);
            return m;
        },

        onOpenDetail: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("huView").getObject();
            this.getRouter().navTo("wmHandlingUnitDetail", {
                hu: encodeURIComponent(o.HandlingUnitExternalID),
                "?query": { wh: o.Warehouse || "", char32: o.HandlingUnitIDChar32 || "", origin: o.HandlingUnitOrigin || "ERP" }
            });
        },

        // Create HU (CAP action create -> BAPI_HU_CREATE + commit). Plant / SLoc / packaging prefilled from the filter bar.
        onOpenCreate: function () {
            var oView = this.getView();
            var o = this.getModel("huView").getData();
            this.getModel("huCreate").setData({
                packagingMaterial: o.packagingMaterial || "", plant: o.plant || "", storageLocation: o.storageLocation || "",
                content: "", busy: false, error: ""
            });
            if (!this._pCreateDialog) {
                this._pCreateDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.handling-unit.view.CreateHandlingUnitDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pCreateDialog.then(function (oDialog) { oDialog.open(); });
        },

        onCancelCreate: function () {
            this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
        },

        onSubmitCreate: function () {
            var oModel = this.getModel("huCreate");
            var o = oModel.getData();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            ODataClient.post(BASE_PATH + "/create", { packagingMaterial: o.packagingMaterial, plant: o.plant, storageLocation: o.storageLocation, content: o.content })
                .then(function (oResult) {
                    MessageToast.show(this.getText("huCreateOk", [oResult.HandlingUnitExternalID]));
                    this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
                    // detail() resolves the monitor key itself, so no char32 is needed for a fresh HU
                    this.getRouter().navTo("wmHandlingUnitDetail", {
                        hu: encodeURIComponent(oResult.HandlingUnitExternalID),
                        "?query": { wh: "", char32: "", origin: "ERP" }
                    });
                }.bind(this))
                .catch(function (oError) {
                    oModel.setProperty("/error", (oError && oError.message) || this.getText("huCreateError"));
                }.bind(this))
                .then(function () { oModel.setProperty("/busy", false); });
        },

        onExport: function () {
            var that = this;
            sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
                var oSheet = new Spreadsheet({
                    workbook: {
                        columns: EXPORT_COLUMNS.map(function (a) {
                            return { label: that.getText(a[0]), property: a[1], type: a[2] || "String" };
                        })
                    },
                    dataSource: that.getModel("huView").getProperty("/items"),
                    fileName: that.getText("huExportFile") + ".xlsx"
                });
                oSheet.build().finally(function () { oSheet.destroy(); });
            });
        }
    });
});
