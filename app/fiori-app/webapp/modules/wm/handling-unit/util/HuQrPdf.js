/**
 * HuQrPdf.js — Renders HU QR-code labels to a jsPDF document.
 *
 * Each label contains:
 *   - QR code (modules drawn as filled rectangles — no external image dependencies)
 *   - HU number (bold, centered below the QR)
 *   - Optional: material name + created date (if provided & enabled)
 *
 * Combine Layout modes (sLayout argument):
 *   "A4grid"     : 3×4 grid on A4 portrait (12 labels per page — standard sticker sheet)
 *   "A4grid6"    : 2×3 grid on A4 portrait (6 large labels per page — carton / pallet)
 *   "A4grid20"   : 4×5 grid on A4 portrait (20 mini labels per page — bin / tote tags)
 *   "A4single"   : 1 label on A4 portrait (full page placard — high visibility)
 *
 * Public API:
 *   HuQrPdf.download(aItems, sFilename, sLayout, oOptions)
 *     aItems   : [{ huNumber, materialName?, createdDate? }, ...]
 *     returns  : Promise (resolves after save)
 *
 *   HuQrPdf.downloadSvg(sHuNumber, sFilename)
 *     Downloads a single HU's QR code as an SVG file.
 *
 *   HuQrPdf.LAYOUTS : { key, nameKey, descKey, cols, rows, ... }
 *   HuQrPdf.ORDER   : ["A4grid", "A4grid6", "A4grid20", "A4single"]
 */
sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/QrCode"
], function (QrCode) {
    "use strict";

    var PT2MM = 25.4 / 72;

    // ─── Layout definitions ────────────────────────────────────────────────────
    var LAYOUTS = {
        A4grid: {
            key: "A4grid",
            nameKey: "huQrLayoutGrid",
            descKey: "huQrLayoutGridDesc",
            pageW: 210, pageH: 297,
            cols: 3, rows: 4,
            padX: 8, padY: 12,
            gapX: 4, gapY: 6,
            labelW: 0, labelH: 0,
            qrFraction: 0.68
        },
        A4grid6: {
            key: "A4grid6",
            nameKey: "huQrLayoutGrid6",
            descKey: "huQrLayoutGrid6Desc",
            pageW: 210, pageH: 297,
            cols: 2, rows: 3,
            padX: 12, padY: 15,
            gapX: 8, gapY: 10,
            labelW: 0, labelH: 0,
            qrFraction: 0.70
        },
        A4grid20: {
            key: "A4grid20",
            nameKey: "huQrLayoutGrid20",
            descKey: "huQrLayoutGrid20Desc",
            pageW: 210, pageH: 297,
            cols: 4, rows: 5,
            padX: 6, padY: 10,
            gapX: 3, gapY: 4,
            labelW: 0, labelH: 0,
            qrFraction: 0.65
        },
        A4single: {
            key: "A4single",
            nameKey: "huQrLayoutSingle",
            descKey: "huQrLayoutSingleDesc",
            pageW: 210, pageH: 297,
            cols: 1, rows: 1,
            padX: 20, padY: 20,
            gapX: 0, gapY: 0,
            labelW: 170, labelH: 257,
            qrFraction: 0.75
        }
    };

    // Compute cell dimensions dynamically
    Object.keys(LAYOUTS).forEach(function (k) {
        var g = LAYOUTS[k];
        if (!g.labelW || g.labelW === 0) {
            g.labelW = (g.pageW - 2 * g.padX - (g.cols - 1) * g.gapX) / g.cols;
            g.labelH = (g.pageH - 2 * g.padY - (g.rows - 1) * g.gapY) / g.rows;
        }
    });

    var ORDER = ["A4grid", "A4grid6", "A4grid20", "A4single"];

    // ─── jsPDF lazy loader (reuses HuLabelPdf approach) ──────────────────────
    var _pJsPdf = null;
    function loadJsPdf() {
        if (_pJsPdf) { return _pJsPdf; }
        _pJsPdf = new Promise(function (resolve, reject) {
            if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); return; }
            var oScript = document.createElement("script");
            oScript.src = sap.ui.require.toUrl("saps4hana/fiori/thirdparty/jspdf.umd.min.js");
            oScript.onload = function () {
                if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); }
                else { reject(new Error("jsPDF global not found after load")); }
            };
            oScript.onerror = function () { reject(new Error("Failed to load the PDF library")); };
            document.head.appendChild(oScript);
        });
        return _pJsPdf;
    }

    // ─── QR drawing ────────────────────────────────────────────────────────────
    /**
     * Draws a QR code onto a jsPDF doc at (xMm, yMm) fitting inside sizeMm×sizeMm.
     * Each module is a filled rectangle.
     */
    function drawQr(doc, sHuNumber, xMm, yMm, sizeMm) {
        var qr = QrCode.encode(sHuNumber);
        var n = qr.size;
        var quietMod = 2; // quiet zone in modules
        var totalMod = n + 2 * quietMod;
        var modMm = sizeMm / totalMod;
        var startX = xMm + quietMod * modMm;
        var startY = yMm + quietMod * modMm;
        doc.setFillColor(0, 0, 0);
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (qr.matrix[r][c]) {
                    doc.rect(startX + c * modMm, startY + r * modMm, modMm, modMm, "F");
                }
            }
        }
    }

    /**
     * Draw a single label at the given top-left (xMm, yMm) within labelW×labelH mm.
     * Layout: QR (top) + HU number (below) + optional material text line.
     */
    function drawLabel(doc, item, xMm, yMm, L, oOptions) {
        var bIncludeMat = !oOptions || oOptions.includeMaterial !== false;

        // Subtle cut boundary for grid layouts
        if (L.cols > 1 || L.rows > 1) {
            doc.setDrawColor(210, 210, 210);
            doc.setLineWidth(0.2);
            doc.rect(xMm, yMm, L.labelW, L.labelH, "S");
        }

        var textReserve = bIncludeMat && item.materialName ? (L.cols >= 4 ? 12 : 16) : 10;
        var maxQrH = Math.max(15, (L.labelH - textReserve) * L.qrFraction);
        var qrSize = Math.min(L.labelW - 6, maxQrH);
        var qrX = xMm + (L.labelW - qrSize) / 2;
        var qrY = yMm + Math.max(1.5, (L.labelH - textReserve - qrSize) / 2);

        // QR code
        drawQr(doc, item.huNumber, qrX, qrY, qrSize);

        // HU number (bold, centered below QR)
        var textY = qrY + qrSize + 1.5;
        doc.setFont("helvetica", "bold");
        var baseFs = (L.labelW - 4) / Math.max(8, item.huNumber.length) * 3.8;
        var fontSize = Math.max(5, Math.min(L.cols === 1 ? 14 : 10, baseFs));
        doc.setFontSize(fontSize);
        doc.setTextColor(0, 0, 0);
        doc.text(item.huNumber, xMm + L.labelW / 2, textY + fontSize * PT2MM * 0.8, { align: "center" });

        // Optional material name (smaller, regular, grey)
        if (bIncludeMat && item.materialName && item.materialName !== "-") {
            var matY = textY + fontSize * PT2MM * 1.35;
            var matFs = Math.max(4.5, fontSize - 2);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(matFs);
            doc.setTextColor(90, 90, 90);
            var sMatText = String(item.materialName);
            while (sMatText.length > 3 && doc.getStringUnitWidth(sMatText) * matFs * PT2MM > L.labelW - 4) {
                sMatText = sMatText.slice(0, -1);
            }
            if (sMatText !== item.materialName) { sMatText += "…"; }
            doc.text(sMatText, xMm + L.labelW / 2, matY + matFs * PT2MM * 0.8, { align: "center" });
        }
    }

    /**
     * Generates a jsPDF document with QR code labels at the chosen layout.
     * Returns the doc instance.
     */
    function generate(jsPDF, aItems, sLayout, oOptions) {
        var L = LAYOUTS[sLayout] || LAYOUTS.A4grid;
        var doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [L.pageW, L.pageH], compress: true });
        var perPage = L.cols * L.rows;
        aItems.forEach(function (item, idx) {
            if (idx > 0 && idx % perPage === 0) {
                doc.addPage([L.pageW, L.pageH], "portrait");
            }
            var posOnPage = idx % perPage;
            var col = posOnPage % L.cols;
            var row = Math.floor(posOnPage / L.cols);
            var xMm = L.padX + col * (L.labelW + L.gapX);
            var yMm = L.padY + row * (L.labelH + L.gapY);
            drawLabel(doc, item, xMm, yMm, L, oOptions);
        });
        return doc;
    }

    /**
     * Validates that each item has a non-empty huNumber.
     * Returns { valid: [], skipped: [] }
     */
    function validate(aItems) {
        var valid = [], skipped = [];
        (aItems || []).forEach(function (item) {
            var s = String((item && item.huNumber) || "").trim();
            if (!s) { skipped.push(item); return; }
            valid.push({ huNumber: s, materialName: item.materialName || "", createdDate: item.createdDate || "" });
        });
        return { valid: valid, skipped: skipped };
    }

    /**
     * Lazily loads jsPDF, generates the QR label PDF, and saves it.
     * aItems: [{ huNumber, materialName?, createdDate? }]
     */
    function download(aItems, sFilename, sLayout, oOptions) {
        var vr = validate(aItems);
        if (!vr.valid.length) { return Promise.reject(new Error("No valid HU numbers to generate QR codes")); }
        return loadJsPdf().then(function (jsPDF) {
            generate(jsPDF, vr.valid, sLayout || "A4grid", oOptions).save(sFilename);
        });
    }

    /**
     * Downloads a single HU's QR code as a standalone SVG file.
     * This does NOT require jsPDF — uses the QrCode.toSvg() output directly.
     */
    function downloadSvg(sHuNumber, sFilename) {
        if (!sHuNumber) { return; }
        var sSvg = QrCode.toSvg(sHuNumber, { size: 8, quiet: 4, bg: "#ffffff", fg: "#000000" });
        var blob = new Blob([sSvg], { type: "image/svg+xml" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = sFilename || ("QR_" + sHuNumber + ".svg");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    return {
        LAYOUTS: LAYOUTS,
        ORDER: ORDER,
        download: download,
        downloadSvg: downloadSvg,
        generate: generate,
        validate: validate
    };
});
