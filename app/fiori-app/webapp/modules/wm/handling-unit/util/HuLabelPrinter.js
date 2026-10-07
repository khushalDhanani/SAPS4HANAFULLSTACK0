sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (Barcode) {
    "use strict";

    var PAGE_SIZE = "4in 4in"; // 4x4 label (101.6mm x 101.6mm / 4in x 4in)
    // Minimal label needs no i18n labels (rows are bare values); kept so controllers' TEXT_KEYS.forEach stays valid.
    var TEXT_KEYS = [];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function esc(v) {
        return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    /** DD-MMM-YYYY for a Date / ISO string / epoch; "-" for blank or unparseable (never "Invalid Date"/"NaN"). */
    function fmtDate(v) {
        if (v === undefined || v === null || v === "") {
            return "-";
        }
        var d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) {
            return "-";
        }
        return ("0" + d.getDate()).slice(-2) + "-" + MONTHS[d.getMonth()] + "-" + d.getFullYear();
    }

    function collapse(s) {
        return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
    }

    /** Code 128 encodes printable ASCII only (0x20-0x7E). */
    function encodable(s) {
        return /^[\x20-\x7E]+$/.test(s);
    }

    /** Reduce a { header, items, serials } detail object to a raw { materialName, createdDate, srNo, huNumber } record. */
    function toRecord(o) {
        var h = (o && o.header) || {};
        var aItems = (o && o.items) || [];
        var aSerials = (o && o.serials) || [];
        var sMat = aItems.length ? (aItems[0].MaterialName || aItems[0].Material || "") : "";
        if (aItems.length > 1) {
            sMat += " +" + (aItems.length - 1) + " more";
        }
        return {
            materialName: sMat,
            createdDate: h.CreationDateTime || "",
            srNo: aSerials.length ? (aSerials[0].SerialNumber || "") : "",
            huNumber: h.HandlingUnitExternalID || ""
        };
    }

    /**
     * Validate + clean raw records into print-ready labels.
     *  - huNumber: required, trimmed, Code 128 encodable; kept as a string (leading zeros preserved).
     *  - materialName: whitespace-collapsed, falls back to "-".
     *  - createdDate: formatted DD-MMM-YYYY, or "-".
     *  - srNo: string, never "undefined"/"null".
     *  - duplicates by huNumber removed (first kept).
     * @returns {{labels: object[], skipped: {huNumber: string, reason: string}[], duplicatesRemoved: number}}
     */
    function prepare(aRecords) {
        var aLabels = [];
        var aSkipped = [];
        var mSeen = {};
        var nDup = 0;
        (aRecords || []).forEach(function (r) {
            r = r || {};
            var sHu = String(r.huNumber === undefined || r.huNumber === null ? "" : r.huNumber).trim();
            if (!sHu) {
                aSkipped.push({ huNumber: "", reason: "empty HU number" });
                return;
            }
            if (!encodable(sHu)) {
                aSkipped.push({ huNumber: sHu, reason: "HU number not Code 128 encodable" });
                return;
            }
            if (mSeen[sHu]) {
                nDup++;
                return;
            }
            mSeen[sHu] = true;
            var sSr = r.srNo === undefined || r.srNo === null ? "" : String(r.srNo).trim();
            if (sSr === "undefined" || sSr === "null") {
                sSr = "";
            }
            aLabels.push({
                huNumber: sHu,
                materialName: collapse(r.materialName) || "-",
                createdDate: fmtDate(r.createdDate),
                srNo: sSr
            });
        });
        return { labels: aLabels, skipped: aSkipped, duplicatesRemoved: nDup };
    }

    /** A captioned value column; "" when the value is blank so the field (and its caption) is hidden. */
    function col(sCap, sVal, sCls) {
        return sVal ? '<div class="col' + (sCls ? " " + sCls : "") + '"><div class="cap">' + sCap + '</div><div class="val">' + esc(sVal) + "</div></div>" : "";
    }

    function section(d) {
        var sMat = d.materialName ? '<div class="sec mat"><div class="cap">MATERIAL NAME</div><div class="val name">' + esc(d.materialName) + "</div></div>" : "";
        var sCode = d.huNumber ? '<div class="sec code"><div class="bc">' + Barcode.toSvg(d.huNumber) + '</div><div class="hunum">' + esc(d.huNumber) + "</div></div>" : "";
        var sMeta = (d.createdDate || d.srNo) ? '<div class="sec meta">' + col("CREATED DATE", d.createdDate) + col("SR NO", d.srNo, "right") + "</div>" : "";
        return '<section class="hu">' + sMat + sCode + sMeta + "</section>";
    }

    /** Builds the print document from ALREADY-CLEAN labels (see prepare()). One 4x4 page per label; barcodes are inline SVG. */
    function buildHtml(aLabels, oTexts, sPageSize) {
        var aData = aLabels || [];
        var sSize = sPageSize || PAGE_SIZE;
        var sTitle = aData.length === 1 ? (aData[0].huNumber || "") : "Handling Units (" + aData.length + ")";
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(sTitle) + "</title><style>" +
            "@page{size:" + sSize + ";margin:0}" +
            "html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
            ".hu{box-sizing:border-box;width:4in;height:4in;padding:0.2in;display:flex;flex-direction:column;overflow:hidden;break-after:page;page-break-after:always}" +
            ".hu:last-child{break-after:auto;page-break-after:auto}" +
            ".sec{padding:0.08in 0;border-bottom:1px solid #000}.sec:last-child{border-bottom:0}" +
            ".cap{font-size:3pt;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase}" +
            ".val{font-size:6pt;line-height:1.1}" +
            ".name{font-size:6pt;font-weight:bold;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}" +
            ".meta{display:flex;justify-content:space-between}.meta .right{text-align:right}" +
            ".code{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center}" +
            ".bc{width:100%;text-align:center}.bc svg{display:block;width:100%;height:1.4in}" +
            ".hunum{font-size:10pt;font-weight:bold;line-height:1.05;text-align:center;word-break:break-all;padding-top:0.06in}" +
            "</style></head><body>" + aData.map(section).join("") + "</body></html>";
    }

    /** Pages (.hu) and barcodes (<svg) must each equal the label count, or the document is not printed. */
    function integrity(sHtml, nLabels) {
        var nPages = (sHtml.match(/class="hu"/g) || []).length;
        var nBars = (sHtml.match(/<svg/g) || []).length;
        if (nPages !== nLabels || nBars !== nLabels) {
            return "Label integrity check failed: " + nPages + " pages / " + nBars + " barcodes for " + nLabels + " labels";
        }
        if (/>\s*(undefined|NaN|Invalid Date)\s*</.test(sHtml)) {
            return "Label content check failed: placeholder value leaked into a label";
        }
        return "";
    }

    /**
     * Prints clean labels via a hidden iframe (no popup blocker). Resolves once print() is invoked.
     * Rejects on an empty set or a failed integrity check (nothing is printed).
     */
    function print(aLabels, oTexts, sPageSize) {
        return new Promise(function (resolve, reject) {
            if (!aLabels || !aLabels.length) {
                reject(new Error("No labels to print"));
                return;
            }
            var sHtml = buildHtml(aLabels, oTexts, sPageSize);
            var sErr = integrity(sHtml, aLabels.length);
            if (sErr) {
                reject(new Error(sErr));
                return;
            }
            var oFrame = document.createElement("iframe");
            oFrame.setAttribute("aria-hidden", "true");
            oFrame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
            oFrame.onload = function () {
                try {
                    oFrame.contentWindow.focus();
                    oFrame.contentWindow.print();
                    resolve();
                } catch (e) {
                    reject(e);
                } finally {
                    // Keep the frame alive briefly so the print dialog can read the document, then clean up.
                    setTimeout(function () { if (oFrame.parentNode) { oFrame.parentNode.removeChild(oFrame); } }, 2000);
                }
            };
            oFrame.srcdoc = sHtml;
            document.body.appendChild(oFrame);
        });
    }

    /** Convenience: detail records (+serials) -> validate -> print. Resolves with the print summary. */
    function printRecords(aRecords, oTexts, sPageSize) {
        var oPrep = prepare((aRecords || []).map(toRecord));
        return print(oPrep.labels, oTexts, sPageSize).then(function () {
            return { printed: oPrep.labels.length, skipped: oPrep.skipped, duplicatesRemoved: oPrep.duplicatesRemoved };
        });
    }

    return {
        PAGE_SIZE: PAGE_SIZE,
        TEXT_KEYS: TEXT_KEYS,
        esc: esc,
        fmtDate: fmtDate,
        toRecord: toRecord,
        prepare: prepare,
        buildHtml: buildHtml,
        integrity: integrity,
        print: print,
        printRecords: printRecords
    };
});
