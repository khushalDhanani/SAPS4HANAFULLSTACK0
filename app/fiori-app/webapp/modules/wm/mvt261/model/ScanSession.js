sap.ui.define([], function () {
    "use strict";

    var round = function (n) { return Math.round(n * 1000) / 1000; };

    /**
     * Session rules of the 261 scan screen. Scanned rows exist only in the browser session; nothing
     * here talks to SAP. Rows: { StorageUnit, Accepted, Reason, Value1, Value2, Batch, Quantity,
     * MaxQuantity, Unit, StorageType, StorageBin, StorageLocation, Warehouse, Warnings }.
     */
    var ScanSession = {

        /** Quantity of all accepted rows. */
        total: function (aRows) {
            return round(aRows.reduce(function (n, r) { return n + (r.Accepted ? Number(r.Quantity) || 0 : 0); }, 0));
        },

        /** Number of distinct accepted storage units. */
        drums: function (aRows) {
            return aRows.filter(function (r, i) {
                return r.Accepted && aRows.findIndex(function (o) { return o.Accepted && o.StorageUnit === r.StorageUnit; }) === i;
            }).length;
        },

        /** Loaded | Scanning | Covered | Blocked */
        state: function (oContext, aRows) {
            if (!oContext || oContext.Blocked) { return "Blocked"; }
            if (ScanSession.total(aRows) === round(oContext.OpenQuantity)) { return "Covered"; }
            return aRows.length ? "Scanning" : "Loaded";
        },

        /**
         * Checks that need no SAP lookup. Returns a rejection { Reason, Value1, Value2 } or null.
         * invalidNumber: a storage unit number is 1-20 digits (no barcode parsing in this stage).
         */
        precheck: function (oContext, aRows, sValue) {
            var sUnit = String(sValue || "").trim().replace(/^0+(?=\d)/, "");
            if (!oContext || oContext.Blocked) { return { Reason: "itemBlocked", Value1: oContext ? oContext.BlockReason : "", Value2: "" }; }
            if (!/^\d{1,20}$/.test(sUnit)) { return { Reason: "invalidNumber", Value1: String(sValue || "").trim(), Value2: "" }; }
            if (aRows.some(function (r) { return r.Accepted && r.StorageUnit === sUnit; })) { return { Reason: "alreadyScanned", Value1: sUnit, Value2: "" }; }
            if (round(oContext.OpenQuantity) - ScanSession.total(aRows) <= 0) { return { Reason: "openCovered", Value1: sUnit, Value2: "" }; }
            return null;
        },

        /**
         * Applies the SAP check of one storage unit. Returns { rows, rejection }. Accepted quants take
         * the quant quantity, capped at the remaining open quantity (partial drums are allowed); a
         * rejected scan is kept as a rejected row so the operator sees it.
         */
        add: function (oContext, aRows, oResult) {
            var aNext = aRows.filter(function (r) { return r.StorageUnit !== oResult.StorageUnit; });
            var nRemaining = round(round(oContext.OpenQuantity) - ScanSession.total(aNext));
            var oRejection = oResult.Accepted ? null : { Reason: oResult.Reason, Value1: oResult.Value1, Value2: oResult.Value2 };
            if (!oRejection && nRemaining <= 0) { oRejection = { Reason: "openCovered", Value1: oResult.StorageUnit, Value2: "" }; }
            if (oRejection) {
                aNext.push({ StorageUnit: oResult.StorageUnit, Accepted: false, Reason: oRejection.Reason, Value1: oRejection.Value1, Value2: oRejection.Value2, Quantity: 0, MaxQuantity: 0, Warnings: [] });
                return { rows: aNext, rejection: oRejection };
            }
            var oOlder = ScanSession.olderAvailable(oContext, aNext, oResult.StorageUnit);
            (oResult.Rows || []).forEach(function (q) {
                var nQty = Math.min(Number(q.Quantity), nRemaining);
                if (nQty <= 0) { return; }
                nRemaining = round(nRemaining - nQty);
                aNext.push(Object.assign({}, q, {
                    StorageUnit: oResult.StorageUnit, Accepted: true, Reason: "", Quantity: round(nQty), MaxQuantity: Number(q.Quantity),
                    FifoDeviation: !!oOlder,
                    OlderUnit: oOlder ? oOlder.StorageUnit : "", OlderDate: oOlder ? oOlder.GoodsReceiptDate : "", OlderQuantity: oOlder ? oOlder.Quantity : 0
                }));
            });
            return { rows: aNext, rejection: null, older: oOlder };
        },

        /**
         * FIFO check: the oldest available, not yet scanned storage unit of the list whose goods-receipt
         * date is earlier than the scanned unit's. Units received on the same day are not "older", and
         * a unit without a date (or outside the list) cannot be compared. Returns the unit or null.
         */
        olderAvailable: function (oContext, aRows, sUnit) {
            var aUnits = (oContext && oContext.Units) || [];
            var oScanned = aUnits.find(function (u) { return u.StorageUnit === sUnit; });
            if (!oScanned || !oScanned.GoodsReceiptDate) { return null; }
            return aUnits.find(function (u) {
                return u.Status === "Available" && u.StorageUnit !== sUnit && u.GoodsReceiptDate && u.GoodsReceiptDate < oScanned.GoodsReceiptDate &&
                    !aRows.some(function (r) { return r.Accepted && r.StorageUnit === u.StorageUnit; });
            }) || null;
        },

        /** Number of accepted storage units scanned out of FIFO order. */
        deviations: function (aRows) {
            return aRows.filter(function (r, i) {
                return r.Accepted && r.FifoDeviation && aRows.findIndex(function (o) { return o.Accepted && o.StorageUnit === r.StorageUnit; }) === i;
            }).length;
        },

        /** FIFO list for display: status "Scanned" for units accepted in this session. */
        units: function (oContext, aRows) {
            return ((oContext && oContext.Units) || []).map(function (u) {
                var bScanned = aRows.some(function (r) { return r.Accepted && r.StorageUnit === u.StorageUnit; });
                return Object.assign({}, u, { DisplayStatus: bScanned ? "Scanned" : u.Status });
            });
        },

        /** Edited quantity of a row: above zero, capped at the quant quantity and at what is still open. */
        setQuantity: function (oContext, aRows, iIndex, vValue) {
            var oRow = aRows[iIndex];
            var nValue = Number(vValue);
            if (!oRow || !oRow.Accepted || !(nValue > 0)) { return aRows; }
            var nOthers = ScanSession.total(aRows.filter(function (r, i) { return i !== iIndex; }));
            var nCap = Math.min(oRow.MaxQuantity, round(round(oContext.OpenQuantity) - nOthers));
            return aRows.map(function (r, i) { return i === iIndex ? Object.assign({}, r, { Quantity: round(Math.min(nValue, nCap)) }) : r; });
        },

        remove: function (aRows, iIndex) {
            return aRows.filter(function (r, i) { return i !== iIndex; });
        }
    };

    return ScanSession;
});
