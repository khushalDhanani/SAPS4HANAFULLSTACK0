sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, Layout) {
    "use strict";

    var PT2MM = 25.4 / 72; // jsPDF text y is the baseline; CSS top is the box top. Convert per font size.
    function ascentMm(pt) { return pt * PT2MM * 0.8; } // ~cap/ascent fraction for Helvetica

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

    /** Draws one clean label onto the current jsPDF page (unit:mm) from the shared layout spec L — same geometry + wrap as the HTML. */
    function drawLabel(doc, d, L) {
        var f = L.fonts;
        doc.setTextColor(0, 0, 0);

        // MATERIAL NAME (caption where shown) + bold lines from the shared wrap (identical breaks to the HTML)
        if (d.materialName) {
            if (L.material.captionY !== null) {
                doc.setFont("helvetica", f.caption.weight).setFontSize(f.caption.pt);
                doc.text("MATERIAL NAME", L.material.x, L.material.captionY + ascentMm(f.caption.pt));
            }
            doc.setFont("helvetica", f.material.weight).setFontSize(f.material.pt);
            var oWrap = Layout.wrap(d.materialName, L.material.w, f.material.pt, L.material.maxLines, f.material.weight === "bold");
            var mlh = f.material.pt * PT2MM * L.material.lh;
            oWrap.lines.forEach(function (s, i) { doc.text(s, L.material.x, L.material.valueY + ascentMm(f.material.pt) + i * mlh); });
        }

        // Barcode (vector bars, snapped to whole printer dots, centered in innerW) + HU number (fit-to-width, centered)
        if (d.huNumber) {
            var oBc = Barcode.bars(d.huNumber);
            var snap = Layout.snapBarcode(L, oBc.total);
            doc.setFillColor(0, 0, 0);
            oBc.bars.forEach(function (b) { doc.rect(snap.xMm + b.x * snap.narrowMm, L.barcode.yTop, b.w * snap.narrowMm, L.barcode.h, "F"); });
            var huPt = Layout.huNumberPt(d.huNumber, f.huNumber.pt, L.huNumber.usableMm).pt;
            doc.setFont("helvetica", f.huNumber.weight).setFontSize(huPt);
            doc.text(d.huNumber, L.page.wMm / 2, L.huNumber.yTop + ascentMm(huPt), { align: "center" });
        }

        // CREATED DATE (left) + SR NO (right); shared ellipsize keeps a long value inside its half. A gets a "SR " prefix.
        var halfW = L.innerW / 2;
        if (d.createdDate) {
            if (L.meta.captionY !== null) { doc.setFont("helvetica", f.caption.weight).setFontSize(f.caption.pt); doc.text("CREATED DATE", L.meta.date.x, L.meta.captionY + ascentMm(f.caption.pt)); }
            doc.setFont("helvetica", f.meta.weight).setFontSize(f.meta.pt);
            doc.text(Layout.ellipsize(d.createdDate, halfW, f.meta.pt, false), L.meta.date.x, L.meta.valueY + ascentMm(f.meta.pt));
        }
        if (d.srNo) {
            if (L.meta.captionY !== null) { doc.setFont("helvetica", f.caption.weight).setFontSize(f.caption.pt); doc.text("SR NO", L.meta.srNo.x, L.meta.captionY + ascentMm(f.caption.pt), { align: "right" }); }
            doc.setFont("helvetica", f.meta.weight).setFontSize(f.meta.pt);
            doc.text(Layout.ellipsize(Layout.srNoText(L, d.srNo), halfW, f.meta.pt, false), L.meta.srNo.x, L.meta.valueY + ascentMm(f.meta.pt), { align: "right" });
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
