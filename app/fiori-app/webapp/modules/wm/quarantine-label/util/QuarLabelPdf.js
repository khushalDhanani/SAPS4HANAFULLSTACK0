sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/QuarLabelLayout",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPdf"
], function (Layout, HuLabelPdf) {
    "use strict";

    // The document is in pt so the page size is exact; the layout is in mm.
    var MM2PT = Layout.PT_PER_INCH / Layout.MM_PER_INCH;

    /** Plays one label's draw list (mm) onto the current jsPDF page (unit pt). */
    function drawItems(doc, aItems) {
        aItems.forEach(function (it) {
            if (it.kind === "fill") {
                doc.setFillColor(0, 0, 0);
                doc.rect(it.x * MM2PT, it.y * MM2PT, it.w * MM2PT, it.h * MM2PT, "F");
                return;
            }
            doc.setFont("helvetica", it.bold ? "bold" : "normal").setFontSize(it.pt);
            if (it.white) { doc.setTextColor(255, 255, 255); } else { doc.setTextColor(0, 0, 0); }
            doc.text(it.text, it.x * MM2PT, it.y * MM2PT, it.align === "center" ? { align: "center" } : undefined);
        });
    }

    /**
     * One label per page, page = the label size exactly (MediaBox 288 x 432 pt for 4x6). PrintScaling None asks the
     * PDF viewer to print at 100 %. @returns {{doc, warnings:[{label, code, field}]}}
     */
    function generate(JsPDF, aRows, oTexts, oOpts) {
        if (!aRows || !aRows.length) { throw new Error("No labels to render"); }
        var L = Layout.layout((oOpts && oOpts.size) || Layout.DEFAULT_SIZE, { dpi: oOpts && oOpts.dpi });
        var doc = new JsPDF({ orientation: "portrait", unit: "pt", format: [L.page.wPt, L.page.hPt] });
        if (typeof doc.viewerPreferences === "function") { doc.viewerPreferences({ PrintScaling: "None" }); }
        var aWarnings = [];
        aRows.forEach(function (row, i) {
            if (i) { doc.addPage([L.page.wPt, L.page.hPt], "portrait"); }
            var r = Layout.render(L, row, oTexts);
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
