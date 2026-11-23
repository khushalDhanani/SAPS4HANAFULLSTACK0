(function () {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";
    var READ_CHUNK = 8;
    var READ_TIMEOUT = 30000;
    var LABEL_CHUNK = 200;
    var LABEL_CONCURRENCY = 3;
    var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };

    function createHandlingUnitLabelReader(deps) {
        deps = deps || {};
        var ODataClient = deps.ODataClient;
        var MessageToast = deps.MessageToast;
        var HuBatchReader = deps.HuBatchReader;
        var HuLabelPrinter = deps.HuLabelPrinter;

        return {
            /** Fast path: labels() in parallel chunks of LABEL_CHUNK ids, LABEL_CONCURRENCY at a time; results kept in original table order. */
            _readLabelRecords: function (aRows, fnProgress, fnCancelled, aAbort) {
                var self = this;
                var aChunks = [];
                for (var i = 0; i < aRows.length; i += LABEL_CHUNK) { aChunks.push(aRows.slice(i, i + LABEL_CHUNK)); }
                var aResults = new Array(aChunks.length);
                var oState = { warned: false, stop: false };
                var nDone = 0;
                var iNext = 0;
                function abortAll() { (aAbort || []).forEach(function (c) { try { c.abort(); } catch (e) { /* settled */ } }); }
                function stopped() { return oState.stop || fnCancelled(); }
                function runNext() {
                    if (stopped() || iNext >= aChunks.length) { return Promise.resolve(); }
                    var idx = iNext++;
                    return self._readLabelChunk(aChunks[idx], oState, aAbort, stopped).then(function (aRecs) {
                        aResults[idx] = aRecs;
                        nDone += aChunks[idx].length;
                        fnProgress(nDone);
                        return runNext();
                    }, function (oErr) {
                        oState.stop = true; abortAll();
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
                    .catch(function (e) { if (fnStopped() || (e && e.name === "AbortError")) { throw e; } return fnPost(); })
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
                        if (fnStopped() || (oErr && oErr.name === "AbortError")) { return []; }
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
            }
        };
    }

    var oExports = {
        createHandlingUnitLabelReader: createHandlingUnitLabelReader
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
