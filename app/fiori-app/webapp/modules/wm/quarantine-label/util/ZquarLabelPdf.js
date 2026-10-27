sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelLayout",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPdf"
], function (Layout, HuLabelPdf) {
    "use strict";

    /** Plays one label's draw list (pt, top-left origin) onto the current jsPDF page (unit pt). */
    function drawItems(doc, aItems) {
        doc.setDrawColor(0, 0, 0);
        doc.setFillColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);
        aItems.forEach(function (it) {
            if (it.kind === "line") {
                doc.setLineWidth(it.w);
                doc.line(it.x1, it.y1, it.x2, it.y2);
            } else if (it.kind === "bar") {
                doc.rect(it.x, it.y, it.w, it.h, "F");
            } else {
                doc.setFont("helvetica", it.bold ? "bold" : "normal").setFontSize(it.pt);
                var o = {};
                if (it.align === "center") { o.align = "center"; }
                if (it.angle) { o.angle = it.angle; }
                // Horizontal scaling (Tz) stays in the graphics state: isolate it so later texts are not stretched
                var bScaled = it.hScale && it.hScale !== 1;
                if (bScaled) { o.horizontalScale = it.hScale; doc.saveGraphicsState(); }
                doc.text(it.text, it.x, it.y, o);
                if (bScaled) { doc.restoreGraphicsState(); }
            }
        });
    }

    /**
     * One label per page (one page per row = per container), page = label size exactly (288 x 432 pt for 4x6);
     * PrintScaling None asks the viewer to print at 100 %. @returns {{doc, warnings:[{label, code, field}]}}
     */
    function generate(JsPDF, aRows, oTexts, oOpts) {
        if (!aRows || !aRows.length) { throw new Error("No labels to render"); }
        var L = Layout.layout((oOpts && oOpts.size) || Layout.DEFAULT_SIZE, { dpi: oOpts && oOpts.dpi });
        var doc = new JsPDF({ orientation: "portrait", unit: "pt", format: [L.page.wPt, L.page.hPt] });
        if (typeof doc.viewerPreferences === "function") { doc.viewerPreferences({ PrintScaling: "None" }); }
        var aWarnings = [];
        aRows.forEach(function (row, i) {
            if (i) { doc.addPage([L.page.wPt, L.page.hPt], "portrait"); }
            var r;
            try {
                r = Layout.render(L, row, oTexts);
            } catch (e) {
                // e.g. a storage unit too long for the barcode: name the label, never squeeze the bars
                throw Object.assign(new Error(e.message), { code: e.code || "renderFailed", label: i + 1 });
            }
            drawItems(doc, r.items);
            r.warnings.forEach(function (w) { aWarnings.push({ label: i + 1, code: w.code, field: w.field }); });
        });
        return { doc: doc, warnings: aWarnings };
    }

    /** Lazily loads jsPDF (shared loader of the HU label) and returns the PDF as a Blob plus render warnings. */
    function toBlob(aRows, oTexts, oOpts) {
        return HuLabelPdf.loadJsPdf().then(function (JsPDF) {
            var r = generate(JsPDF, aRows, oTexts, oOpts);
            return { blob: r.doc.output("blob"), warnings: r.warnings };
        });
    }

    return { generate: generate, toBlob: toBlob, drawItems: drawItems };
});
