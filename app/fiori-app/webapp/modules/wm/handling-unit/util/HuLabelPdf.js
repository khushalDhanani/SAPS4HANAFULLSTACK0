sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, Layout) {
    "use strict";

    var PT2MM = 25.4 / 72; // jsPDF text y is the baseline; CSS top is the box top. Convert per font size.
    function ascentMm(pt) { return pt * PT2MM * 0.8; }      // ~cap/ascent fraction for Helvetica
    function lineHeightMm(pt) { return pt * PT2MM * 1.15; }  // same 1.15 factor as the HTML line-height

    /**
     * Truncate sText (at the font already set on doc) to at most wMm, adding "…" when it would overflow.
     * The HTML label clips single-line fields with overflow:hidden; jsPDF has no clip box, so a pathological
     * value (e.g. a very long serial) would otherwise overrun its half and collide with the neighbour field.
     */
    function fitText(doc, sText, wMm) {
        if (!sText || doc.getTextWidth(sText) <= wMm) { return sText; }
        var s = String(sText);
        while (s.length > 1 && doc.getTextWidth(s + "…") > wMm) { s = s.slice(0, -1); }
        return s + "…";
    }

    var _pJsPdf = null;

    /** Lazily load the locally bundled jsPDF (UMD global `jspdf.jsPDF`) on first use; never on app startup. */
    function loadJsPdf() {
        if (_pJsPdf) { return _pJsPdf; }
        _pJsPdf = new Promise(function (resolve, reject) {
            if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); return; }
            var oScript = document.createElement("script");
            oScript.src = sap.ui.require.toUrl("saps4hana/fiori/thirdparty/jspdf.umd.min.js");
            oScript.onload = function () {
                if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); } else { reject(new Error("jsPDF global not found after load")); }
            };
            oScript.onerror = function () { reject(new Error("Failed to load the PDF library")); };
            document.head.appendChild(oScript);
        });
        return _pJsPdf;
    }

    /** Draws one clean label onto the current jsPDF page (unit:mm) from the shared layout spec L — same geometry as the HTML. */
    function drawLabel(doc, d, L) {
        var f = L.fonts;
        doc.setTextColor(0, 0, 0);

        // MATERIAL NAME (caption on B/C/D, then up to maxLines clamped bold lines)
        if (d.materialName) {
            var yVal = L.material.yTop;
            if (L.showCaptions) {
                doc.setFont("helvetica", "bold").setFontSize(f.caption);
                doc.text("MATERIAL NAME", L.material.x, L.material.yTop + ascentMm(f.caption));
                yVal = L.material.yTop + lineHeightMm(f.caption);
            }
            doc.setFont("helvetica", "bold").setFontSize(f.material);
            var aLines = doc.splitTextToSize(d.materialName, L.material.w);
            if (aLines.length > L.material.maxLines) { aLines = aLines.slice(0, L.material.maxLines); aLines[aLines.length - 1] = aLines[aLines.length - 1].replace(/.$/, "…"); }
            aLines.forEach(function (s, i) { doc.text(s, L.material.x, yVal + ascentMm(f.material) + i * lineHeightMm(f.material)); });
        }

        // Barcode (vector bars, fills innerW) + HU number
        if (d.huNumber) {
            var oBc = Barcode.bars(d.huNumber);
            var fScale = L.barcode.w / oBc.total;
            doc.setFillColor(0, 0, 0);
            oBc.bars.forEach(function (b) { doc.rect(L.barcode.x + b.x * fScale, L.barcode.yTop, b.w * fScale, L.barcode.h, "F"); });
            doc.setFont("helvetica", "bold").setFontSize(f.huNumber);
            doc.text(d.huNumber, L.page.wMm / 2, L.huNumber.yTop + ascentMm(f.huNumber), { align: "center" });
        }

        // CREATED DATE (left) + SR NO (right); each omitted when blank (mirrors the HTML label).
        // Values are fit to their half-width so a long serial can't overrun into the neighbour field.
        var halfW = L.innerW / 2;
        if (d.createdDate) {
            if (L.showCaptions && L.meta.captionY !== null) { doc.setFont("helvetica", "bold").setFontSize(f.caption); doc.text("CREATED DATE", L.meta.date.x, L.meta.captionY + ascentMm(f.caption)); }
            doc.setFont("helvetica", "normal").setFontSize(f.meta); doc.text(fitText(doc, d.createdDate, halfW), L.meta.date.x, L.meta.valueY + ascentMm(f.meta));
        }
        if (d.srNo) {
            if (L.showCaptions && L.meta.captionY !== null) { doc.setFont("helvetica", "bold").setFontSize(f.caption); doc.text("SR NO", L.meta.srNo.x, L.meta.captionY + ascentMm(f.caption), { align: "right" }); }
            doc.setFont("helvetica", "normal").setFontSize(f.meta); doc.text(fitText(doc, d.srNo, halfW), L.meta.srNo.x, L.meta.valueY + ascentMm(f.meta), { align: "right" });
        }
    }

    /** Builds a jsPDF document (unit:mm): one page per clean label at the chosen size, no trailing blank page. */
    function generate(jsPDF, aLabels, sizeOrKey) {
        var L = Layout.layout(sizeOrKey);
        // All stock sizes are landscape (width > height); set orientation explicitly so jsPDF does not swap W/H.
        var sOrient = L.page.wMm >= L.page.hMm ? "landscape" : "portrait";
        var doc = new jsPDF({ orientation: sOrient, unit: "mm", format: [L.page.wMm, L.page.hMm], compress: true });
        aLabels.forEach(function (d, i) {
            if (i) { doc.addPage([L.page.wMm, L.page.hMm], sOrient); }
            drawLabel(doc, d, L);
        });
        return doc;
    }

    /** Lazily loads jsPDF, renders the clean labels at the chosen size and saves <sFilename>. */
    function download(aLabels, sFilename, sizeOrKey) {
        if (!aLabels || !aLabels.length) { return Promise.reject(new Error("No labels to download")); }
        return loadJsPdf().then(function (jsPDF) { generate(jsPDF, aLabels, sizeOrKey).save(sFilename); });
    }

    return { download: download, generate: generate, loadJsPdf: loadJsPdf, drawLabel: drawLabel };
});
