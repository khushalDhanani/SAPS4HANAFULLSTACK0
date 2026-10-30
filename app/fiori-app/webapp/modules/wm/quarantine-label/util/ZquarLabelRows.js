sap.ui.define([], function () {
    "use strict";

    /*
     * CAP label rows (QuarantineLabelService.labelRows, read-only SAP table reads) -> ZQUAR label fields.
     * Mapping decided with the user on 2026-10-27; formats MEASURED in the current label
     * (docs/label/zquar-4x6-same-label.md):
     *   GRN No. = material document, GRN Date = posting date, Qty. Received = "999.99 UoM" (MENGE, 2 decimals),
     *   Container No = "n OF total", Supplier = supplier name, Mfg. / Expiry Date = HSDAT / retest-or-expiry date,
     *   dates DD/MM/YYYY, Net Weight = TO quantity at 2 decimals + unit without a space ("99.99UoM"),
     *   barcode = storage unit without leading zeros (user: "Yes, use them");
     *   INW. No = the Label Text input ("The Label Text input"); Batch No = supplier batch ("Supplier batch (LICHA)");
     *   Manufacturer = batch characteristics ("Batch characteristics").
     */

    /** "2026-10-27" -> "27/10/2026" (the current label prints DD/MM/YYYY); anything else -> "". */
    function date(sIso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sIso || ""));
        return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
    }

    /** Decimal text -> 2 decimals, half up, like the report's QUAN 13,2 field; non-numbers unchanged. */
    function twoDecimals(v) {
        var s = String(v == null ? "" : v).trim();
        var n = Number(s);
        if (!s || !isFinite(n)) {
            return s;
        }
        var r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
        return (n < 0 && r ? "-" : "") + r.toFixed(2);
    }

    /** Numeric storage unit "0000000000990000001" -> "990000001"; alphanumeric values unchanged. */
    function withoutLeadingZeros(v) {
        var s = String(v == null ? "" : v).trim();
        return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
    }

    /** Numeric or padded material code "000000008000009753" -> "8000009753" (trim leading zeros, keep up to last 10 digits). */
    function formatMaterialCode(v) {
        var s = String(v == null ? "" : v).trim();
        if (!s) {
            return "";
        }
        if (/^\d+$/.test(s)) {
            var unpadded = s.replace(/^0+(?=\d)/, "");
            return unpadded.length > 10 ? unpadded.slice(-10) : unpadded;
        }
        return s;
    }

    /** Returns trimmed string or "-" when empty / missing. */
    function dash(v) {
        var s = String(v == null ? "" : v).trim();
        return s || "-";
    }

    /**
     * One label per CAP row (one row per container). mTexts.retestDate replaces the "Expiry Date" caption when the
     * row's date is a retest date (the report sends that caption as data, ZDATE).
     */
    function toLabels(aRows, mTexts, sPreparedBy) {
        return (aRows || []).map(function (r) {
            var sQty = twoDecimals(r.ContainerQuantity);
            var sUnit = r.Unit ? " " + String(r.Unit).trim() : "";
            var matCode = formatMaterialCode(r.Material);
            var prepBy = (r.PreparedBy !== undefined && r.PreparedBy !== null && String(r.PreparedBy).trim())
                ? String(r.PreparedBy).trim()
                : (sPreparedBy ? String(sPreparedBy).trim() : "");
            return {
                materialName: dash(r.MaterialDescription),
                itemCode: dash(matCode),
                materialCode: dash(matCode),
                preparedBy: dash(prepBy),
                grnNo: dash(r.MaterialDocument),
                grnDate: dash(date(r.PostingDate)),
                inwNo: dash(r.InwardNo || r.Text),
                inspectionLot: dash(r.InspectionLot),
                qtyReceived: dash(r.PostedQuantity),
                containerNo: dash(r.Container),
                manufacturer: dash(r.BatchCharacteristics),
                supplier: dash(r.SupplierName),
                batchNo: dash(r.SupplierBatch),
                mfgDate: dash(date(r.ManufacturingDate)),
                expiryDate: dash(date(r.DateValue)),
                netWeight: dash(sQty ? (sQty + sUnit) : ""),
                barcode: withoutLeadingZeros(r.StorageUnit),
                captions: r.DateKind === "RETEST" && mTexts && mTexts.retestDate ? { expiryDate: mTexts.retestDate } : undefined
            };
        });
    }

    return { toLabels: toLabels, date: date, twoDecimals: twoDecimals, withoutLeadingZeros: withoutLeadingZeros, formatMaterialCode: formatMaterialCode, dash: dash };
});
