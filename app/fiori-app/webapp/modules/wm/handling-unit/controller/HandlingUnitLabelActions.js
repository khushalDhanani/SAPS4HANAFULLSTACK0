(function () {
    "use strict";

    var PRINT_SAFE_LIMIT = 500;

    function createHandlingUnitLabelActions(deps) {
        deps = deps || {};
        var MessageBox = deps.MessageBox;
        var MessageToast = deps.MessageToast;
        var BusyDialog = deps.BusyDialog;
        var HuLabelPrinter = deps.HuLabelPrinter;
        var HuLabelPdf = deps.HuLabelPdf;
        var HuLabelLayout = deps.HuLabelLayout;
        var HuLabelSizeDialog = deps.HuLabelSizeDialog;

        return {
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
                var aAbort = [];
                oModel.setProperty("/printing", true);
                var oDialog = new BusyDialog({
                    title: this.getText("huPrintMenu"),
                    text: this.getText("huPrintProgress", [0, nTotal]),
                    showCancelButton: true,
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
                        if (!oPart.fit.length) {
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
                if (oButton.getBusy()) { return undefined; }
                var self = this;
                var o = oButton.getBindingContext("huView").getObject();
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
                        if (!oPart.fit.length) {
                            MessageToast.show(self.getText("huPrintBadData", [oPart.skipped[0].reason]));
                            return undefined;
                        }
                        return fnOutput(oPart.fit);
                    })
                    .catch(function (oError) { MessageBox.error((oError && oError.message) || self.getText("huLoadError")); })
                    .then(function () { oButton.setBusy(false); });
            },

            /** "Printed/Downloaded X of Y" + removed-duplicates note + skipped list (with a CSV download when any were skipped). */
            _showJobSummary: function (oRes, nRequested, sSummaryKey) {
                var aSkipped = oRes.skipped || [];
                var sMsg = this.getText(sSummaryKey || "huPrintSummary", [oRes.printed, nRequested]);
                if (oRes.duplicatesRemoved) { sMsg += "\n" + this.getText("huPrintDupes", [oRes.duplicatesRemoved]); }
                if (!aSkipped.length) {
                    if (oRes.duplicatesRemoved) { MessageToast.show(sMsg); }
                    return;
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
                    if (!sKey) { return undefined; }
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
            }
        };
    }

    var oExports = {
        createHandlingUnitLabelActions: createHandlingUnitLabelActions
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
