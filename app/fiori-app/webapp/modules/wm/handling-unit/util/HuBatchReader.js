sap.ui.define([], function () {
    "use strict";

    /** Rejects if oPromise does not settle within nMs. */
    function withTimeout(oPromise, nMs) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { reject(new Error("Read timed out after " + (nMs / 1000) + "s")); }, nMs);
            oPromise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
        });
    }

    /**
     * Reads items in chunks (bounded concurrency), each with a timeout and retries, reporting progress
     * and stopping when cancelled. On an item that still fails after all retries the whole read rejects
     * (caller aborts — nothing is printed); a cancel resolves early with whatever was read so far.
     *
     * @param {Array} aItems items to read
     * @param {function} fnRead item -> Promise(result)
     * @param {object} [oOpts] { chunk=8, timeoutMs=30000, retries=1, onProgress(done), isCancelled()->bool }
     * @returns {Promise<Array>} results in item order (short when cancelled)
     */
    function read(aItems, fnRead, oOpts) {
        oOpts = oOpts || {};
        var nChunk = oOpts.chunk || 8;
        var nTimeout = oOpts.timeoutMs || 30000;
        var nRetries = oOpts.retries == null ? 1 : oOpts.retries;
        var fnProgress = oOpts.onProgress || function () { };
        var fnCancelled = oOpts.isCancelled || function () { return false; };

        function readOne(oItem) {
            function attempt(nLeft) {
                return withTimeout(Promise.resolve().then(function () { return fnRead(oItem); }), nTimeout)
                    .catch(function (e) { if (nLeft <= 0) { throw e; } return attempt(nLeft - 1); });
            }
            return attempt(nRetries);
        }

        var aOut = [];
        function next(i) {
            if (fnCancelled() || i >= aItems.length) { return Promise.resolve(aOut); }
            return Promise.all(aItems.slice(i, i + nChunk).map(readOne)).then(function (a) {
                aOut = aOut.concat(a);
                fnProgress(aOut.length);
                return next(i + nChunk);
            });
        }
        return next(0);
    }

    return { withTimeout: withTimeout, read: read };
});
