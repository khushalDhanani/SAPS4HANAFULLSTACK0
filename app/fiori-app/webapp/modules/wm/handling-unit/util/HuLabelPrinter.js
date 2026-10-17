sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, Layout) {
    "use strict";

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

    // jsPDF draws text at baseline = boxTop + 0.8em; a CSS line box puts the baseline ~0.065em lower, and the
    // gap grows with font size. Lift the HTML box top by 0.065em so both baselines land together (<0.3mm, any size).
    var PT2MM_H = 25.4 / 72;
    var BASELINE_EM = 0.065;
    function topAdj(yMm, fontPt) { return +(yMm - BASELINE_EM * fontPt * PT2MM_H).toFixed(3); }

    /** One absolutely-positioned single-line field div (mm coords, pt font) — same geometry the PDF renderer uses. */
    function fieldDiv(xMm, yMm, wMm, fontPt, sWeight, sAlign, sText, bCaption) {
        var sStyle = "position:absolute;left:" + xMm + "mm;top:" + topAdj(yMm, fontPt) + "mm;width:" + wMm + "mm;color:#000;" +
            "font-size:" + fontPt + "pt;line-height:1.1;font-weight:" + (sWeight === "bold" ? "bold" : "normal") + ";" +
            (sAlign ? "text-align:" + sAlign + ";" : "") + "white-space:nowrap;overflow:hidden;";
        return '<div class="' + (bCaption ? "cap" : "fld") + '" style="' + sStyle + '">' + esc(sText) + "</div>";
    }

    /** One label <section> rendered from the shared layout spec L (see HuLabelLayout.layout). */
    function section(d, L) {
        var f = L.fonts;
        var PT2MM = 25.4 / 72;
        var out = "";
        // MATERIAL NAME (caption where shown) + one div per shared-wrap line (identical breaks to the PDF)
        if (d.materialName) {
            if (L.material.captionY !== null) {
                out += fieldDiv(L.material.x, L.material.captionY, L.material.w, f.caption.pt, f.caption.weight, "left", "MATERIAL NAME", true);
            }
            var oWrap = Layout.wrap(d.materialName, L.material.w, f.material.pt, L.material.maxLines, f.material.weight === "bold");
            var mlh = f.material.pt * PT2MM * L.material.lh;
            oWrap.lines.forEach(function (s, i) {
                out += fieldDiv(L.material.x, L.material.valueY + i * mlh, L.material.w, f.material.pt, f.material.weight, "left", s, false);
            });
        }
        // Barcode (snapped to whole printer dots, centered in innerW) + HU number (fit-to-width pt, centered)
        if (d.huNumber) {
            var snap = Layout.snapBarcode(L, Barcode.bars(d.huNumber).total);
            out += '<div style="position:absolute;left:' + snap.xMm + "mm;top:" + L.barcode.yTop + "mm;width:" + snap.widthMm + "mm;height:" + L.barcode.h + 'mm">' +
                Barcode.toSvg(d.huNumber, snap.widthMm, L.barcode.h) + "</div>";
            var huPt = Layout.huNumberPt(d.huNumber, f.huNumber.pt, L.huNumber.usableMm).pt;
            out += '<div class="fld" style="position:absolute;left:0;top:' + topAdj(L.huNumber.yTop, huPt) + "mm;width:" + L.page.wMm + "mm;font-size:" + huPt + "pt;line-height:1.05;font-weight:bold;color:#000;text-align:center;overflow:hidden;white-space:nowrap\">" + esc(d.huNumber) + "</div>";
        }
        // Meta row: CREATED DATE (left half) | SR NO (right half); shared ellipsize + "SR " prefix on A
        var halfW = L.innerW / 2;
        if (d.createdDate) {
            if (L.meta.captionY !== null) { out += fieldDiv(L.meta.date.x, L.meta.captionY, halfW, f.caption.pt, f.caption.weight, "left", "CREATED DATE", true); }
            out += fieldDiv(L.meta.date.x, L.meta.valueY, halfW, f.meta.pt, f.meta.weight, "left", Layout.ellipsize(d.createdDate, halfW, f.meta.pt, false), false);
        }
        if (d.srNo) {
            if (L.meta.captionY !== null) { out += fieldDiv(L.meta.srNo.x - halfW, L.meta.captionY, halfW, f.caption.pt, f.caption.weight, "right", "SR NO", true); }
            out += fieldDiv(L.meta.srNo.x - halfW, L.meta.valueY, halfW, f.meta.pt, f.meta.weight, "right", Layout.ellipsize(Layout.srNoText(L, d.srNo), halfW, f.meta.pt, false), false);
        }
        return '<section class="hu">' + out + "</section>";
    }

    /** Builds the print document from ALREADY-CLEAN labels (see prepare()) at the given size. One page per label. */
    function buildHtml(aLabels, oTexts, sizeOrKey) {
        var L = Layout.layout(sizeOrKey);
        var aData = aLabels || [];
        var sTitle = aData.length === 1 ? (aData[0].huNumber || "") : "Handling Units (" + aData.length + ")";
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(sTitle) + "</title><style>" +
            "@page{size:" + L.page.wMm + "mm " + L.page.hMm + "mm;margin:0}" +
            "html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
            ".hu{position:relative;box-sizing:border-box;width:" + L.page.wMm + "mm;height:" + L.page.hMm + "mm;overflow:hidden;break-after:page;page-break-after:always}" +
            ".hu:last-child{break-after:auto;page-break-after:auto}" +
            ".cap{font-weight:bold;letter-spacing:0.3px;text-transform:uppercase}" +
            "</style></head><body>" + aData.map(function (d) { return section(d, L); }).join("") + "</body></html>";
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
    function print(aLabels, oTexts, sizeOrKey) {
        return new Promise(function (resolve, reject) {
            if (!aLabels || !aLabels.length) {
                reject(new Error("No labels to print"));
                return;
            }
            var sHtml = buildHtml(aLabels, oTexts, sizeOrKey);
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

    /** Convenience: detail records (+serials) -> validate -> print at the given size. Resolves with the print summary. */
    function printRecords(aRecords, oTexts, sizeOrKey) {
        var oPrep = prepare((aRecords || []).map(toRecord));
        return print(oPrep.labels, oTexts, sizeOrKey).then(function () {
            return { printed: oPrep.labels.length, skipped: oPrep.skipped, duplicatesRemoved: oPrep.duplicatesRemoved };
        });
    }

    return {
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
