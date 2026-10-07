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
    "saps4hana/fiori/modules/wm/handling-unit/util/HuBatchReader",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelSizeDialog"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast, MessageBox, BusyDialog, HuLabelPrinter, HuLabelPdf, HuBatchReader, HuLabelLayout, HuLabelSizeDialog) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";
    var PRINT_SAFE_LIMIT = 500; // Print All asks for extra confirmation above this many labels
    var READ_CHUNK = 8; // fallback path: each label costs a detail (+ serials) read; cap concurrent reads
    var READ_TIMEOUT = 30000; // ms per HU read before one retry, then abort
    var LABEL_CHUNK = 200; // fast path: HU ids per labels() POST
    var LABEL_CONCURRENCY = 3; // fast path: labels() chunks in flight at once
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
                kpis: [],
                kpiBusy: false
            }), "huView");
            this.getModel("huView").setSizeLimit(2000);
            this.setModel(new JSONModel({ packagingMaterial: "", plant: "", storageLocation: "", content: "", busy: false, error: "" }), "huCreate");
            this._loadValueHelps();
            this._loadKpis();
            this.getRouter().getRoute("wmHandlingUnits").attachPatternMatched(this.onRouteMatched, this);
        },

        formatCount: function (v) {
            if (v === null || v === undefined || v === "" || isNaN(v)) {
                return "-";
            }
            return Number(v).toLocaleString();
        },

        _loadKpis: function () {
            var oModel = this.getModel("huView");
            oModel.setProperty("/kpiBusy", true);
            return ODataClient.get(BASE_PATH + "/statusKpis()").then(function (oResult) {
                oModel.setProperty("/kpiTotal", (oResult && oResult.Total) || 0);
                oModel.setProperty("/kpis", (oResult && oResult.Items) || []);
            }).catch(function () {
                // KPI cards are informational; a failure must not break the list.
            }).then(function () {
                oModel.setProperty("/kpiBusy", false);
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

        /** Fast path: labels() in parallel chunks of LABEL_CHUNK ids, LABEL_CONCURRENCY at a time; results kept in original table order. */
        _readLabelRecords: function (aRows, fnProgress, fnCancelled, aAbort) {
            var self = this;
            var aChunks = [];
            for (var i = 0; i < aRows.length; i += LABEL_CHUNK) { aChunks.push(aRows.slice(i, i + LABEL_CHUNK)); }
            var aResults = new Array(aChunks.length); // index -> records, preserves order on flatten
            var oState = { warned: false, stop: false };
            var nDone = 0;
            var iNext = 0;
            function abortAll() { (aAbort || []).forEach(function (c) { try { c.abort(); } catch (e) { /* already settled */ } }); }
            function stopped() { return oState.stop || fnCancelled(); }
            function runNext() {
                if (stopped() || iNext >= aChunks.length) { return Promise.resolve(); }
                var idx = iNext++;
                return self._readLabelChunk(aChunks[idx], oState, aAbort, stopped).then(function (aRecs) {
                    aResults[idx] = aRecs;
                    nDone += aChunks[idx].length;
                    fnProgress(nDone); // progress after each chunk
                    return runNext();
                }, function (oErr) {
                    oState.stop = true; abortAll(); // a chunk failed after retry + fallback -> abort the whole job (never a partial print)
                    throw oErr;
                });
            }
            var aWorkers = [];
            for (var w = 0; w < Math.min(LABEL_CONCURRENCY, aChunks.length); w++) { aWorkers.push(runNext()); }
            return Promise.all(aWorkers).then(function () {
                var aOut = [];
                aResults.forEach(function (a) { if (a) { aOut = aOut.concat(a); } });
                return aOut;
            });
        },

        /** One labels() chunk with a retry and an AbortSignal; on failure, the per-chunk fallback runs the slow per-HU path. */
        _readLabelChunk: function (aChunkRows, oState, aAbort, fnStopped) {
            var self = this;
            var aIds = aChunkRows.map(function (o) { return o.HandlingUnitExternalID; });
            var oCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;
            if (oCtrl && aAbort) { aAbort.push(oCtrl); }
            var oOpts = oCtrl ? { signal: oCtrl.signal } : undefined;
            var fnPost = function () { return ODataClient.post(BASE_PATH + "/labels", { handlingUnitExternalIDs: aIds }, undefined, oOpts); };
            return fnPost()
                .catch(function (e) { if (fnStopped() || (e && e.name === "AbortError")) { throw e; } return fnPost(); }) // one retry, never on cancel
                .then(function (oResult) {
                    var aItems = (oResult && oResult.Items) || [];
                    if (!aItems.length) { return self._fallbackChunk(aChunkRows, oState, fnStopped, "labels() returned no data"); }
                    var mByHu = {};
                    aItems.forEach(function (x) { mByHu[x.HandlingUnitExternalID] = x; });
                    return aChunkRows.map(function (o) {
                        var l = mByHu[o.HandlingUnitExternalID] || {};
                        return { huNumber: o.HandlingUnitExternalID, createdDate: o.CreationDateTime, materialName: l.MaterialName || "", srNo: l.SerialNumber || "" };
                    });
                }, function (oErr) {
                    if (fnStopped() || (oErr && oErr.name === "AbortError")) { return []; } // cancelled/aborting: discard, do not fall back or fail
                    return self._fallbackChunk(aChunkRows, oState, fnStopped, (oErr && oErr.message) || "labels() request failed");
                });
        },

        /** Per-chunk fallback: console.warn per chunk, one toast per job, then the slow per-HU path for this chunk. */
        _fallbackChunk: function (aChunkRows, oState, fnStopped, sReason) {
            // eslint-disable-next-line no-console
            console.warn("[HU print] fast label service unavailable (" + sReason + "); using slow per-HU mode");
            if (!oState.warned) { oState.warned = true; MessageToast.show(this.getText("huPrintFallback")); }
            return this._readLabelRecordsFallback(aChunkRows, function () { }, fnStopped);
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

        /**
         * Gate 1 (scannability): split prepared labels by whether their barcode stays above the chosen size's
         * minimum narrow-bar width. Unscannable HUs become skipped entries naming the next-larger size.
         * @returns {{fit: object[], skipped: {huNumber:string, reason:string}[]}}
         */
        _partitionByFit: function (aLabels, sizeKey) {
            var self = this;
            var aFit = [], aSkipped = [];
            aLabels.forEach(function (l) {
                var r = HuLabelLayout.fits(l.huNumber, sizeKey);
                if (r.ok) { aFit.push(l); return; }
                var sSizeName = self.getText(HuLabelLayout.SIZES[HuLabelLayout.byKey(sizeKey)].nameKey);
                var sReason = r.nextLarger
                    ? self.getText("huLabelTooSmall", [sSizeName, self.getText(HuLabelLayout.SIZES[r.nextLarger].nameKey)])
                    : self.getText("huLabelTooSmallMax", [sSizeName]);
                aSkipped.push({ huNumber: l.huNumber, reason: sReason });
            });
            return { fit: aFit, skipped: aSkipped };
        },

        /** Shared bulk job (Print All/Selected/Current Page, Download Selected): progress + cancel dialog, batched read, validation, then fnOutput(labels). */
        _runLabelJob: function (aRows, fnOutput, sSummaryKey, sizeKey) {
            if (!aRows.length) { return; }
            var self = this;
            var oModel = this.getModel("huView");
            var nTotal = aRows.length;
            var bCancel = false;
            var aAbort = []; // AbortControllers of in-flight labels() chunks, aborted on Cancel
            oModel.setProperty("/printing", true); // disables every print/download button until the job ends
            var oDialog = new BusyDialog({
                title: this.getText("huPrintMenu"),
                text: this.getText("huPrintProgress", [0, nTotal]),
                showCancelButton: true,
                // BusyDialog has no 'cancel' event; the Cancel button fires 'close' with cancelPressed=true.
                close: function (oEvent) {
                    if (oEvent.getParameter("cancelPressed")) {
                        bCancel = true;
                        aAbort.forEach(function (c) { try { c.abort(); } catch (e) { /* settled */ } });
                    }
                }
            });
            oDialog.open();
            var tFetch = performance.now();
            return this._readLabelRecords(aRows, function (nDone) {
                oDialog.setText(self.getText("huPrintProgress", [nDone, nTotal]));
            }, function () { return bCancel; }, aAbort)
                .then(function (aRecords) {
                    oDialog.close();
                    if (bCancel) { MessageToast.show(self.getText("huPrintCancelled")); return undefined; }
                    // eslint-disable-next-line no-console
                    console.log("[HU labels] fetch " + Math.round(performance.now() - tFetch) + "ms for " + nTotal + " HUs");
                    var oPrep = HuLabelPrinter.prepare(aRecords);
                    var oPart = self._partitionByFit(oPrep.labels, sizeKey);
                    var aSkipped = oPrep.skipped.concat(oPart.skipped);
                    if (!oPart.fit.length) { // nothing scannable at this size: report the skips, print nothing
                        self._showJobSummary({ printed: 0, skipped: aSkipped, duplicatesRemoved: oPrep.duplicatesRemoved }, nTotal, sSummaryKey);
                        return undefined;
                    }
                    var tOut = performance.now();
                    return Promise.resolve(fnOutput(oPart.fit)).then(function () {
                        // eslint-disable-next-line no-console
                        console.log("[HU labels] render/output " + Math.round(performance.now() - tOut) + "ms, " + oPart.fit.length + " labels");
                        self._showJobSummary({ printed: oPart.fit.length, skipped: aSkipped, duplicatesRemoved: oPrep.duplicatesRemoved }, nTotal, sSummaryKey);
                    });
                })
                .catch(function (oError) {
                    oDialog.close();
                    MessageBox.error((oError && oError.message) || self.getText("huLoadError"));
                })
                .then(function () { oDialog.destroy(); oModel.setProperty("/printing", false); });
        },

        /** One-HU print/download from a row button: reads just that HU, busy-spins that button, no confirmation dialog. */
        _runRowJob: function (oButton, fnOutput, sizeKey) {
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
                    var oPart = self._partitionByFit(oPrep.labels, sizeKey);
                    if (!oPart.fit.length) { // barcode too dense for this size: name the next-larger size, print nothing
                        MessageToast.show(self.getText("huPrintBadData", [oPart.skipped[0].reason]));
                        return undefined;
                    }
                    return fnOutput(oPart.fit);
                })
                .catch(function (oError) { MessageBox.error((oError && oError.message) || self.getText("huLoadError")); })
                .then(function () { oButton.setBusy(false); });
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

        _print: function (labels, sizeKey) { return HuLabelPrinter.print(labels, this._labelTexts(), sizeKey); },

        /** Opens the size picker for a bulk job, then runs it at the chosen size (Cancel = no-op, no read/print). */
        _pickSizeThenBulk: function (aRows, sVerb, fnOutput, sSummaryKey) {
            if (!aRows.length) { return undefined; }
            var self = this;
            return HuLabelSizeDialog.open(this, { verb: sVerb, count: aRows.length, limit: PRINT_SAFE_LIMIT }).then(function (sKey) {
                if (!sKey) { return undefined; } // cancelled
                return self._runLabelJob(aRows, function (labels) { return fnOutput(labels, sKey); }, sSummaryKey, sKey);
            });
        },

        /** Print All: every HU matching the current filters (the full /items set, server-capped at MAX_LIST). */
        onPrintAll: function () {
            var self = this;
            return this._pickSizeThenBulk(this.getModel("huView").getProperty("/items") || [], "print",
                function (labels, sKey) { return self._print(labels, sKey); }, "huPrintSummary");
        },

        /** Print Selected: only the ticked rows. */
        onPrintSelected: function () {
            var self = this;
            return this._pickSizeThenBulk(this._rowsToObjects(this.byId("huTable").getSelectedItems()), "print",
                function (labels, sKey) { return self._print(labels, sKey); }, "huPrintSummary");
        },

        /** Print Current Page: only the rows currently rendered (the current growing page). */
        onPrintCurrentPage: function () {
            var self = this;
            return this._pickSizeThenBulk(this._rowsToObjects(this.byId("huTable").getItems()), "print",
                function (labels, sKey) { return self._print(labels, sKey); }, "huPrintSummary");
        },

        /** Download Selected: one PDF (one page per ticked HU at the chosen size), same 500 safety warning + progress/Cancel. */
        onDownloadSelected: function () {
            var self = this;
            return this._pickSizeThenBulk(this._rowsToObjects(this.byId("huTable").getSelectedItems()), "download",
                function (labels, sKey) { return HuLabelPdf.download(labels, "HU_labels_" + self._fileStamp() + "_" + sKey + ".pdf", sKey); },
                "huDownloadSummary");
        },

        /** Row Print: pick a size, then print just this row's HU (1 POST, one page). */
        onRowPrint: function (oEvent) {
            var self = this;
            var oButton = oEvent.getSource();
            return HuLabelSizeDialog.open(this, { verb: "print", count: 1 }).then(function (sKey) {
                if (!sKey) { return undefined; }
                return self._runRowJob(oButton, function (labels) { return self._print(labels, sKey); }, sKey);
            });
        },

        /** Row Download: pick a size, then PDF of just this row's HU as HU_<huNumber>_<size>.pdf. */
        onRowDownload: function (oEvent) {
            var self = this;
            var oButton = oEvent.getSource();
            return HuLabelSizeDialog.open(this, { verb: "download", count: 1 }).then(function (sKey) {
                if (!sKey) { return undefined; }
                return self._runRowJob(oButton, function (labels) { return HuLabelPdf.download(labels, "HU_" + labels[0].huNumber + "_" + sKey + ".pdf", sKey); }, sKey);
            });
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
