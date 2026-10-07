sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (Barcode) {
    "use strict";

    // 4x4 in label = 288 x 288 pt (72pt/in); 0.2in padding; 1.4in barcode. Same layout as the HTML print label.
    var PT = 288;
    var PAD = 14.4;
    var INNER = PT - 2 * PAD;
    var BARCODE_H = 100.8; // 1.4in

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

    /** Draws one clean label (see HuLabelPrinter.prepare) onto the current jsPDF page as a 4x4 vector label. */
    function drawLabel(doc, d) {
        doc.setTextColor(0, 0, 0);
        var y = PAD;

        // MATERIAL NAME (caption + up to 2 bold lines, clamped)
        doc.setFont("helvetica", "bold").setFontSize(6.5);
        doc.text("MATERIAL NAME", PAD, y + 6);
        y += 11;
        doc.setFont("helvetica", "bold").setFontSize(11);
        var aLines = doc.splitTextToSize(d.materialName || "-", INNER);
        if (aLines.length > 2) { aLines = aLines.slice(0, 2); aLines[1] = aLines[1].replace(/.$/, "…"); }
        aLines.forEach(function (sLine, i) { doc.text(sLine, PAD, y + 10 + i * 13); });
        y += 10 + aLines.length * 13 + 4;

        // divider
        doc.setLineWidth(0.5).line(PAD, y, PAD + INNER, y);
        y += 8;

        // barcode (vector bars from the Code 128 geometry) + HU number
        var oBc = Barcode.bars(d.huNumber);
        var fScale = INNER / oBc.total;
        doc.setFillColor(0, 0, 0);
        oBc.bars.forEach(function (b) { doc.rect(PAD + b.x * fScale, y, b.w * fScale, BARCODE_H, "F"); });
        y += BARCODE_H + 2;
        doc.setFont("helvetica", "bold").setFontSize(14);
        doc.text(d.huNumber, PT / 2, y + 13, { align: "center" });
        y += 22;

        // divider
        doc.setLineWidth(0.5).line(PAD, y, PAD + INNER, y);
        y += 8;

        // CREATED DATE (left) + SR NO (right); SR NO omitted when blank (mirrors the HTML label)
        doc.setFont("helvetica", "bold").setFontSize(6.5);
        doc.text("CREATED DATE", PAD, y + 6);
        doc.setFont("helvetica", "normal").setFontSize(10);
        doc.text(d.createdDate || "-", PAD, y + 17);
        if (d.srNo) {
            doc.setFont("helvetica", "bold").setFontSize(6.5);
            doc.text("SR NO", PAD + INNER, y + 6, { align: "right" });
            doc.setFont("helvetica", "normal").setFontSize(10);
            doc.text(d.srNo, PAD + INNER, y + 17, { align: "right" });
        }
    }

    /** Builds a jsPDF document: one 288x288pt page per clean label, no trailing blank page. */
    function generate(jsPDF, aLabels) {
        var doc = new jsPDF({ unit: "pt", format: [PT, PT], compress: true });
        aLabels.forEach(function (d, i) {
            if (i) { doc.addPage([PT, PT]); }
            drawLabel(doc, d);
        });
        return doc;
    }

    /** Lazily loads jsPDF, renders the clean labels and saves <sFilename>.pdf. Resolves when the file is handed to the browser. */
    function download(aLabels, sFilename) {
        if (!aLabels || !aLabels.length) { return Promise.reject(new Error("No labels to download")); }
        return loadJsPdf().then(function (jsPDF) { generate(jsPDF, aLabels).save(sFilename); });
    }

    return { download: download, generate: generate, loadJsPdf: loadJsPdf, drawLabel: drawLabel };
});
