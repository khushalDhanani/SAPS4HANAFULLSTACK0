sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelLayout",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPdf",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPrinter"
], function (Layout, HuLabelPdf, HuLabelPrinter) {
    "use strict";

    /** Plays one label's draw list (pt, top-left origin) onto the current jsPDF page (unit pt). */
    function drawItems(doc, aItems) {
        doc.setFillColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);
        aItems.forEach(function (it) {
            if (it.kind === "sep") {
                // Hairline at a fraction of black; the opacity stays in the graphics state, so isolate it
                doc.saveGraphicsState();
                doc.setGState(new doc.GState({ opacity: it.opacity }));
                doc.rect(it.x, it.y, it.w, it.h, "F");
                doc.restoreGraphicsState();
            } else if (it.kind === "bar" || it.kind === "rule") {
                doc.rect(it.x, it.y, it.w, it.h, "F");
            } else {
                doc.setFont("helvetica", it.bold ? "bold" : "normal").setFontSize(it.pt);
                var o = {};
                if (it.align === "center") { o.align = "center"; }
                if (it.angle) { o.angle = it.angle; }
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
        var L = Layout.layout((oOpts && oOpts.size) || Layout.DEFAULT_SIZE, { dpi: oOpts && oOpts.dpi, variant: oOpts && oOpts.variant });
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

    /** One label's draw list as an SVG page in pt (same coordinates and baselines as the PDF). */
    function svgPage(L, aItems) {
        var esc = HuLabelPrinter.esc;
        var out = aItems.map(function (it) {
            if (it.kind === "bar" || it.kind === "rule" || it.kind === "sep") {
                return '<rect x="' + it.x + '" y="' + it.y + '" width="' + it.w + '" height="' + it.h + '" fill="#000"' +
                    (it.opacity ? ' fill-opacity="' + it.opacity + '"' : "") + ' shape-rendering="crispEdges"/>';
            }
            var sTransform = "translate(" + it.x + " " + it.y + ")" + (it.angle ? " rotate(" + (-it.angle) + ")" : "") +
                (it.hScale && it.hScale !== 1 ? " scale(" + it.hScale + " 1)" : "");
            return '<text transform="' + sTransform + '" font-size="' + it.pt + '" font-weight="' + (it.bold ? "bold" : "normal") + '"' +
                (it.align === "center" ? ' text-anchor="middle"' : "") + ">" + esc(it.text) + "</text>";
        }).join("");
        return '<svg class="zq" xmlns="http://www.w3.org/2000/svg" width="' + L.page.wPt + 'pt" height="' + L.page.hPt + 'pt" viewBox="0 0 ' +
            L.page.wPt + " " + L.page.hPt + '" font-family="Helvetica, Arial, sans-serif" fill="#000">' + out + "</svg>";
    }

    /**
     * Print document for the labels: one SVG page per row with @page = label size and no margin, so the browser
     * prints at 100 % on the label stock (a PDF in an iframe is fitted to the printer's default paper instead).
     */
    function buildHtml(aRows, oTexts, oOpts) {
        if (!aRows || !aRows.length) { throw new Error("No labels to render"); }
        var L = Layout.layout((oOpts && oOpts.size) || Layout.DEFAULT_SIZE, { dpi: oOpts && oOpts.dpi, variant: oOpts && oOpts.variant });
        var aPages = aRows.map(function (row, i) {
            try {
                return svgPage(L, Layout.render(L, row, oTexts).items);
            } catch (e) {
                throw Object.assign(new Error(e.message), { code: e.code || "renderFailed", label: i + 1 });
            }
        });
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Quarantine Labels</title><style>" +
            "@page{size:" + L.page.wPt + "pt " + L.page.hPt + "pt;margin:0}" +
            "html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
            // No kerning/ligatures: glyphs advance by the AFM widths the layout measured, as in the PDF
            ".zq{display:block;break-after:page;page-break-after:always;font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision}" +
            ".zq:last-child{break-after:auto;page-break-after:auto}" +
            "</style></head><body>" + aPages.join("") + "</body></html>";
    }

    /** Opens the browser print dialog for the labels at their exact size. */
    function print(aRows, oTexts, oOpts) {
        var sHtml;
        try {
            sHtml = buildHtml(aRows, oTexts, oOpts);
        } catch (e) {
            return Promise.reject(e);
        }
        return HuLabelPrinter.printHtml(sHtml);
    }

    return { generate: generate, toBlob: toBlob, drawItems: drawItems, buildHtml: buildHtml, print: print };
});
