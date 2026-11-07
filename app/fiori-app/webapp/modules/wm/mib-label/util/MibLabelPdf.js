sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/AetherLogo",
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (AetherLogo, Barcode, HuLabelLayout) {
    "use strict";

    var _pJsPdf = null;

    var VARIANTS = {
        STANDARD: "standard",
        VERTICAL: "vertical"
    };

    // ZQURAN vertical theme parameters: 5% black hairlines (2 printer dots thick at 203 DPI)
    var SEP = {
        dots: 2,
        opacity: 0.05
    };

    // Layout constants for 4 x 6 vertical sticker (in pt on 288 x 432 MediaBox at 203 DPI)
    var V_LAYOUT = {
        dpi: 203,
        ptPerInch: 72,
        mmPerInch: 25.4,
        page: { w: 288, h: 432 },
        ruleVx: 36.532,
        ruleDots: 2,
        titleRuleY: 35.468,
        titleTop: 15.5,
        titlePt: 16,
        primaryStripPt: 14,
        sopStripPt: 9,
        captionPt: 9,
        colonPt: 9,
        valuePt: 10,
        hrPt: 13,
        rowsTop: 39.468,
        rowsEnd: 310.374,
        barTop: 316.374,
        barH: 84.059,
        hrTop: 403.5,
        logo: {
            x: 209.261,
            y: 316.374,
            w: 63.133,
            h: 100.02,
            padding: 3.901
        },
        em: 0.925,
        stripGap: 1.5,
        gap: 4,
        colonGapBefore: 3.5,
        colonGapAfter: 5.5,
        ascent: 0.79,
        capAscent: 0.718,
        descent: 0.21,
        edge: 12.839
    };

    /**
     * Lazily load the locally bundled jsPDF (UMD global window.jspdf.jsPDF).
     *
     * @returns {Promise<any>}
     */
    function loadJsPdf() {
        if (_pJsPdf) {
            return _pJsPdf;
        }
        _pJsPdf = new Promise(function (resolve, reject) {
            if (typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF) {
                resolve(window.jspdf.jsPDF);
                return;
            }
            if (typeof document === "undefined") {
                reject(new Error("Document is undefined"));
                return;
            }
            var oScript = document.createElement("script");
            oScript.src = sap.ui.require.toUrl("saps4hana/fiori/thirdparty/jspdf.umd.min.js");
            oScript.onload = function () {
                if (window.jspdf && window.jspdf.jsPDF) {
                    resolve(window.jspdf.jsPDF);
                } else {
                    reject(new Error("jsPDF global not found after load"));
                }
            };
            oScript.onerror = function () {
                reject(new Error("Failed to load the PDF library"));
            };
            document.head.appendChild(oScript);
        });
        return _pJsPdf;
    }

    /**
     * Measures text width in points using standard Helvetica font metrics.
     *
     * @param {string} sText
     * @param {number} nPt
     * @param {boolean} bBold
     * @returns {number} Width in pt
     */
    function measureTextPt(sText, nPt, bBold) {
        if (!sText) {
            return 0;
        }
        if (HuLabelLayout && typeof HuLabelLayout.measureMm === "function") {
            return HuLabelLayout.measureMm(sText, nPt, bBold) * (72 / 25.4);
        }
        return String(sText).length * nPt * (bBold ? 0.58 : 0.52);
    }

    /**
     * Formats SAP date strings (YYYY-MM-DD or YYYYMMDD) into DD/MM/YYYY matching the physical label.
     *
     * @param {string} val
     * @returns {string}
     */
    function formatDate(val) {
        if (!val) {
            return "-";
        }
        var s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            var parts = s.split("-");
            return parts[2] + "/" + parts[1] + "/" + parts[0];
        }
        if (/^\d{8}$/.test(s)) {
            return s.substring(6, 8) + "/" + s.substring(4, 6) + "/" + s.substring(0, 4);
        }
        return s;
    }

    /**
     * Draws one 100 x 100 mm standard sticker matching the physical label from Adobe Form ZMM_AF_021 / TCode ZMIB.
     *
     * @param {any} doc - jsPDF instance (unit: mm)
     * @param {object} item - Line item data
     * @param {object} meta - Header parameters (transferOrderNumber, etc.)
     */
    function drawStandardSticker(doc, item, meta) {
        var oItem = item || {};
        var oMeta = meta || {};

        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
        doc.setFillColor(0, 0, 0);

        // Header Title (centered, prominent bold sans-serif)
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("MATERIAL ISSUED TO BATCH", 50, 7.5, { align: "center" });

        // Sub-header: Batch Number (centered bold)
        var sBatch = oItem.Batch || "-";
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(sBatch, 50, 13, { align: "center" });

        // Divider 1
        doc.setLineWidth(0.4);
        doc.line(4, 15.5, 96, 15.5);

        // Row 1: TO Date (Left) & TO Number (Right)
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text("TO Date :  ", 4, 20.5);
        var wToDate = doc.getTextWidth("TO Date :  ");
        doc.setFont("helvetica", "normal");
        doc.text(formatDate(oItem.TransferDate || oMeta.transferDate), 4 + wToDate, 20.5);

        doc.setFont("helvetica", "bold");
        doc.text("TO Number : ", 46, 20.5);
        var wToNum = doc.getTextWidth("TO Number : ");
        doc.setFont("helvetica", "normal");
        doc.text(oItem.TransferOrder || oMeta.transferOrderNumber || "-", 46 + wToNum, 20.5);

        // Divider 2
        doc.line(4, 23.5, 96, 23.5);

        // Row 2: TR Number (Left) & TR Date (Right)
        doc.setFont("helvetica", "bold");
        doc.text("TR Number : ", 4, 28.5);
        var wTrNum = doc.getTextWidth("TR Number : ");
        doc.setFont("helvetica", "normal");
        doc.text(oItem.TransferRequirement || "-", 4 + wTrNum, 28.5);

        doc.setFont("helvetica", "bold");
        doc.text("TR Date :   ", 46, 28.5);
        var wTrDate = doc.getTextWidth("TR Date :   ");
        doc.setFont("helvetica", "normal");
        doc.text(formatDate(oItem.TransferRequirementDate || oItem.TransferDate || oMeta.transferDate), 46 + wTrDate, 28.5);

        // Divider 3
        doc.line(4, 31.5, 96, 31.5);

        // Row 3: Material Code (no divider below)
        doc.setFont("helvetica", "bold");
        doc.text("Material Code :  ", 4, 36.5);
        var wMatCode = doc.getTextWidth("Material Code :  ");
        doc.setFont("helvetica", "normal");
        doc.text(oItem.Material || "-", 4 + wMatCode, 36.5);

        // Row 4: Material Name
        doc.setFont("helvetica", "bold");
        doc.text("Material Name :  ", 4, 43.5);
        var wMatName = doc.getTextWidth("Material Name :  ");
        doc.setFont("helvetica", "normal");
        var sName = oItem.MaterialDescription || "-";
        if (doc.getTextWidth(sName) > 66) {
            sName = sName.substring(0, 36) + "...";
        }
        doc.text(sName, 4 + wMatName, 43.5);

        // Divider 4
        doc.line(4, 46.5, 96, 46.5);

        // Row 5: INW No (Inward Lot / Batch)
        doc.setFont("helvetica", "bold");
        doc.text("INW No :  ", 4, 52);
        var wInw = doc.getTextWidth("INW No :  ");
        doc.setFont("helvetica", "normal");
        doc.text(sBatch, 4 + wInw, 52);

        // Divider 5
        doc.line(4, 55, 96, 55);

        // Row 6: Net weight (Left) & ARN No (Right)
        doc.setFont("helvetica", "bold");
        doc.text("Net weight : ", 4, 60.5);
        var wWeight = doc.getTextWidth("Net weight : ");
        doc.setFont("helvetica", "normal");
        doc.text(oItem.QuantityWithUom || oItem.Quantity || "-", 4 + wWeight, 60.5);

        doc.setFont("helvetica", "bold");
        doc.text("ARN No : ", 46, 60.5);
        var wArn = doc.getTextWidth("ARN No : ");
        doc.setFont("helvetica", "normal");
        doc.text(oItem.ArnNo || "", 46 + wArn, 60.5);

        // Divider 6
        doc.line(4, 63.5, 96, 63.5);

        // Row 7: Signatures (Checked By & Weighted By)
        doc.setFont("helvetica", "bold");
        doc.text("Checked By", 4, 68);
        doc.text("Weighted By", 30, 68);

        // Underline below Checked By and Weighted By
        doc.setLineWidth(0.35);
        doc.line(4, 70.5, 58, 70.5);

        // Names
        doc.setFont("helvetica", "bold");
        var sChecked = String(oItem.CheckedBy || oMeta.checkedBy || "-").toUpperCase();
        var sWeighted = String(oItem.WeightedBy || oMeta.weightedBy || "-").toUpperCase();
        doc.text(sChecked, 4, 74.5);
        doc.text(sWeighted, 30, 74.5);

        // Row 8: Bottom Left Barcode & SOP Footer
        var sBarcodeText = (oItem.StorageUnit && oItem.StorageUnit !== "N/A" && oItem.StorageUnit !== "-")
            ? oItem.StorageUnit
            : (oItem.TransferOrder || oMeta.transferOrderNumber || "1000058465");

        if (Barcode && typeof Barcode.bars === "function") {
            try {
                var oBars = Barcode.bars(sBarcodeText);
                var nBarW = 38;
                var nBarH = 7.5;
                var nBarX = 4;
                var nBarY = 78;
                var nBarScale = nBarW / oBars.total;

                oBars.bars.forEach(function (b) {
                    doc.rect(nBarX + b.x * nBarScale, nBarY, b.w * nBarScale, nBarH, "F");
                });

                // Human-readable barcode number centered under the bars
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.text(sBarcodeText, nBarX + nBarW / 2, nBarY + nBarH + 3.2, { align: "center" });
            } catch {
                // If barcode generation fails, print plain text
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.text(sBarcodeText, 23, 85, { align: "center" });
            }
        }

        // SOP document code (bottom left)
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text("F-03-00-SOP-WH-003-10/10/2016", 4, 94);

        // Row 8: Bottom Right Aether Corporate Logo
        if (AetherLogo && typeof AetherLogo.fit === "function" && typeof AetherLogo.parsePath === "function") {
            var oLogoBox = { x: 58, y: 72, w: 38, h: 22 };
            var oFitted = AetherLogo.fit(oLogoBox, 0);
            doc.setFillColor(0, 0, 0);
            oFitted.paths.forEach(function (d) {
                var ops = AetherLogo.parsePath(d, oFitted.scale, oFitted.x, oFitted.y);
                doc.path(ops);
                doc.fill();
            });
        }
    }

    /**
     * Builds the draw items list for one 4" x 6" portrait (288 x 432 pt) vertical sticker layout
     * matching the architectural design, geometry, typography scale, and 5% black hairlines of ZQURAN vertical variant.
     *
     * @param {object} item - Line item data
     * @param {object} meta - Header parameters
     * @returns {object[]} Array of draw items
     */
    function getVerticalItems(item, meta) {
        var oItem = item || {};
        var oMeta = meta || {};
        var dotPt = V_LAYOUT.ptPerInch / V_LAYOUT.dpi; // 72 / 203 ≈ 0.3547 pt
        var snap = function (n) { return Math.round(n / dotPt) * dotPt; };

        var items = [];
        var sBatch = oItem.Batch || "-";

        var ruleW = V_LAYOUT.ruleDots * dotPt;
        var ruleVx = snap(V_LAYOUT.ruleVx);
        var vx = snap(ruleVx - ruleW / 2);
        var vy = 0;
        var rowsEndV = V_LAYOUT.rowsEnd;
        var titleRuleY = snap(V_LAYOUT.titleRuleY);
        var ruleH_y = snap(titleRuleY - ruleW / 2);

        // 1. Rules
        // Vertical rule: extends only up to the end of rows (terminating cleanly before the barcode)
        items.push({ kind: "rule", x: vx, y: vy, w: ruleW, h: snap(rowsEndV) - vy });
        // Horizontal title rule under company title
        items.push({ kind: "rule", x: vx, y: ruleH_y, w: snap(V_LAYOUT.page.w) - vx, h: ruleW });

        // 2. Company Title (ZQURAN 16 pt bold, centered in right header block, baseline = titleTop + 16 * ascent)
        var axis = (ruleVx + V_LAYOUT.page.w - V_LAYOUT.edge) / 2;
        var titleBaselineY = V_LAYOUT.titleTop + V_LAYOUT.titlePt * V_LAYOUT.ascent;
        items.push({
            kind: "text",
            text: "Aether Industries Limited",
            x: axis,
            y: titleBaselineY,
            pt: V_LAYOUT.titlePt,
            bold: true,
            align: "center"
        });

        // 3. Left Rotated Strip Texts (rotated 90° counter-clockwise)
        var stripCenter = rowsEndV / 2;
        var priPt = V_LAYOUT.primaryStripPt; // 14 pt bold
        var secPt = V_LAYOUT.sopStripPt;     // 9 pt normal

        var sPriText = "MATERIAL ISSUED TO BATCH";
        var nPriLen = measureTextPt(sPriText, priPt, true);
        var priBand = V_LAYOUT.edge;
        var priX = priBand + V_LAYOUT.capAscent * priPt;
        var priY = stripCenter + nPriLen / 2;

        items.push({
            kind: "text",
            text: sPriText,
            x: priX,
            y: priY,
            pt: priPt,
            bold: true,
            align: "left",
            angle: 90,
            hScale: 1,
            len: nPriLen,
            band: [priBand, priBand + V_LAYOUT.em * priPt]
        });

        var sSecText = "F-03-00-SOP-WH-003-10/10/2016";
        var nSecLen = measureTextPt(sSecText, secPt, false);
        var secBand = priBand + V_LAYOUT.em * priPt + V_LAYOUT.stripGap;
        var secX = secBand + V_LAYOUT.capAscent * secPt;
        var secY = stripCenter + nSecLen / 2;

        items.push({
            kind: "text",
            text: sSecText,
            x: secX,
            y: secY,
            pt: secPt,
            bold: false,
            align: "left",
            angle: 90,
            hScale: 1,
            len: nSecLen,
            band: [secBand, secBand + V_LAYOUT.em * secPt]
        });

        // 4. Body Content Area & Rows
        var pX = snap(ruleVx + V_LAYOUT.gap); // ~40.43 pt
        var contentX0 = pX;
        var contentX1 = V_LAYOUT.page.w - V_LAYOUT.edge; // ~275.16 pt
        var sepW = ruleW;

        function addSep(y) {
            items.push({
                kind: "sep",
                x: snap(contentX0),
                y: snap(y - sepW / 2),
                w: snap(contentX1) - snap(contentX0),
                h: sepW,
                opacity: SEP.opacity
            });
        }

        var aRows = [
            { label: "TO Date", value: formatDate(oItem.TransferDate || oMeta.transferDate) },
            { label: "TO Number", value: oItem.TransferOrder || oMeta.transferOrderNumber || "-" },
            { label: "TR Number", value: oItem.TransferRequirement || "-" },
            { label: "TR Date", value: formatDate(oItem.TransferRequirementDate || oItem.TransferDate || oMeta.transferDate) },
            { label: "Material Code", value: oItem.Material || "-" },
            { label: "Material Name", value: oItem.MaterialDescription || "-" },
            { label: "INW No", value: sBatch },
            { label: "Net weight", value: oItem.QuantityWithUom || oItem.Quantity || "-" },
            { label: "ARN No", value: oItem.ArnNo || "-" },
            { label: "Checked By", value: String(oItem.CheckedBy || oMeta.checkedBy || "-").toUpperCase() },
            { label: "Weighted By", value: String(oItem.WeightedBy || oMeta.weightedBy || "-").toUpperCase() }
        ];

        var colonW = measureTextPt(":", V_LAYOUT.captionPt, true);
        var colonGapBefore = snap(V_LAYOUT.colonGapBefore);
        var colonGapAfter = snap(V_LAYOUT.colonGapAfter);
        var maxCapW = 0;
        aRows.forEach(function (r) {
            var w = measureTextPt(r.label, V_LAYOUT.captionPt, true);
            if (w > maxCapW) {
                maxCapW = w;
            }
        });
        var colonX = snap(contentX0 + maxCapW + colonGapBefore);
        var valueX = snap(colonX + colonW + colonGapAfter);

        var rowsTop = V_LAYOUT.rowsTop;
        var slotV = (rowsEndV - rowsTop) / aRows.length;

        // Hairline under title rule (at top of rows, Y = 39.47 pt)
        addSep(rowsTop);

        aRows.forEach(function (r, idx) {
            var y0 = rowsTop + idx * slotV;
            var y1 = y0 + slotV;
            var block = (V_LAYOUT.capAscent + V_LAYOUT.descent) * V_LAYOUT.valuePt;
            var yBase = y0 + (slotV - block) / 2 + V_LAYOUT.capAscent * V_LAYOUT.valuePt;

            // Caption (ZQURAN 9 pt bold)
            items.push({
                kind: "text",
                text: r.label,
                x: contentX0,
                y: yBase,
                pt: V_LAYOUT.captionPt,
                bold: true,
                align: "left"
            });

            // Colon (ZQURAN 9 pt bold)
            items.push({
                kind: "text",
                text: ":",
                x: colonX,
                y: yBase,
                pt: V_LAYOUT.colonPt,
                bold: true,
                align: "left"
            });

            // Value (ZQURAN 10 pt normal, with wrapping / ellipsis if too wide)
            var sVal = r.value || "-";
            var maxValW = contentX1 - valueX;
            var valW = measureTextPt(sVal, V_LAYOUT.valuePt, false);
            if (valW > maxValW) {
                while (sVal.length > 3 && measureTextPt(sVal + "...", V_LAYOUT.valuePt, false) > maxValW) {
                    sVal = sVal.substring(0, sVal.length - 1);
                }
                sVal = sVal + "...";
            }
            items.push({
                kind: "text",
                text: sVal,
                x: valueX,
                y: yBase,
                pt: V_LAYOUT.valuePt,
                bold: false,
                align: "left"
            });

            // Separator hairline between rows (none after last row: white space before barcode)
            if (idx < aRows.length - 1) {
                addSep(y1);
            }
        });

        // 5. Code 128 B Vector Barcode & Centered Human-Readable Number
        var sBarcodeText = (oItem.StorageUnit && oItem.StorageUnit !== "N/A" && oItem.StorageUnit !== "-")
            ? oItem.StorageUnit
            : (oItem.TransferOrder || oMeta.transferOrderNumber || "1000058465");

        if (Barcode && typeof Barcode.bars === "function") {
            try {
                var oBars = Barcode.bars(String(sBarcodeText), "B");
                var dotMm = V_LAYOUT.mmPerInch / V_LAYOUT.dpi;
                var targetModuleDots = Math.round(0.5 / dotMm); // 4 dots @ 203 DPI
                var minModuleDots = Math.ceil(0.375 / dotMm - 1e-9); // 3 dots @ 203 DPI
                var barRight = snap(pX + snap(166)); // ~206.42 pt
                var availW = barRight - pX;

                var chosenDots = minModuleDots;
                for (var d = targetModuleDots; d >= minModuleDots; d--) {
                    var mTest = d * dotPt;
                    var barsWTest = (oBars.total - 10) * mTest;
                    if (barsWTest <= availW + 1e-9) {
                        chosenDots = d;
                        break;
                    }
                }

                var modulePt = chosenDots * dotPt;
                var x0 = Math.round((pX - 10 * modulePt) / dotPt) * dotPt;
                var totalW = oBars.total * modulePt;

                oBars.bars.forEach(function (b) {
                    items.push({
                        kind: "bar",
                        x: x0 + b.x * modulePt,
                        y: V_LAYOUT.barTop,
                        w: b.w * modulePt,
                        h: V_LAYOUT.barH
                    });
                });

                // Centered prominent human-readable document number directly under barcode bars (ZQURAN 13 pt)
                var hrBaselineY = V_LAYOUT.hrTop + V_LAYOUT.hrPt * V_LAYOUT.ascent;
                items.push({
                    kind: "text",
                    text: sBarcodeText,
                    x: x0 + totalW / 2,
                    y: hrBaselineY,
                    pt: V_LAYOUT.hrPt,
                    bold: false,
                    align: "center"
                });
            } catch {
                items.push({
                    kind: "text",
                    text: sBarcodeText,
                    x: (contentX0 + contentX1) / 2,
                    y: V_LAYOUT.barTop + 20,
                    pt: V_LAYOUT.hrPt,
                    bold: true,
                    align: "center"
                });
            }
        }

        // 6. Corporate Vector Logo on the Right
        if (AetherLogo && typeof AetherLogo.fit === "function") {
            var fittedLogo = AetherLogo.fit(V_LAYOUT.logo, V_LAYOUT.logo.padding);
            items.push({
                kind: "logo",
                x: fittedLogo.x,
                y: fittedLogo.y,
                w: fittedLogo.w,
                h: fittedLogo.h,
                scale: fittedLogo.scale,
                paths: AetherLogo.paths,
                viewBox: AetherLogo.viewBox
            });
        }

        return items;
    }

    /**
     * Plays one label's draw list onto the current jsPDF page (unit: pt).
     *
     * @param {any} doc - jsPDF instance
     * @param {object[]} aItems - Draw items
     */
    function drawItems(doc, aItems) {
        doc.setFillColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);
        aItems.forEach(function (it) {
            if (it.kind === "sep") {
                // Hairline at 5% fraction of black (ZQURAN SEP.opacity = 0.05)
                if (typeof doc.GState === "function" && typeof doc.saveGraphicsState === "function") {
                    doc.saveGraphicsState();
                    doc.setGState(new doc.GState({ opacity: it.opacity }));
                    doc.setFillColor(0, 0, 0);
                    doc.rect(it.x, it.y, it.w, it.h, "F");
                    doc.restoreGraphicsState();
                } else {
                    doc.setFillColor(242, 242, 242);
                    doc.rect(it.x, it.y, it.w, it.h, "F");
                }
            } else if (it.kind === "bar" || it.kind === "rule") {
                doc.rect(it.x, it.y, it.w, it.h, "F");
            } else if (it.kind === "box") {
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(it.lineWidth || 0.5);
                doc.rect(it.x, it.y, it.w, it.h, "S");
            } else if (it.kind === "logo") {
                doc.setFillColor(0, 0, 0);
                var fnParse = AetherLogo && AetherLogo.parsePath;
                if (fnParse && it.paths) {
                    it.paths.forEach(function (d) {
                        var ops = fnParse(d, it.scale, it.x, it.y);
                        doc.path(ops);
                        doc.fill();
                    });
                }
            } else {
                doc.setFont("helvetica", it.bold ? "bold" : "normal").setFontSize(it.pt);
                var o = {};
                if (it.align === "center") {
                    o.align = "center";
                }
                if (it.angle) {
                    o.angle = it.angle;
                }
                var bScaled = it.hScale && it.hScale !== 1;
                if (bScaled) {
                    o.horizontalScale = it.hScale;
                    doc.saveGraphicsState();
                }
                doc.text(it.text, it.x, it.y, o);
                if (bScaled) {
                    doc.restoreGraphicsState();
                }
            }
        });
    }

    /**
     * Draws one 4" x 6" vertical sticker layout onto the jsPDF document.
     *
     * @param {any} doc - jsPDF instance (unit: pt, format: [288, 432])
     * @param {object} item - Line item data
     * @param {object} meta - Header parameters
     */
    function drawVerticalSticker(doc, item, meta) {
        var aItems = getVerticalItems(item, meta);
        drawItems(doc, aItems);
    }

    /**
     * Dispatcher drawing either standard (100x100 mm) or vertical (288x432 pt) sticker.
     *
     * @param {any} doc
     * @param {object} item
     * @param {object} meta
     */
    function drawSticker(doc, item, meta) {
        var sVariant = (meta && meta.variant) || VARIANTS.STANDARD;
        if (sVariant === VARIANTS.VERTICAL) {
            drawVerticalSticker(doc, item, meta);
        } else {
            drawStandardSticker(doc, item, meta);
        }
    }

    /**
     * Builds a jsPDF document for the given sticker items according to the chosen variant.
     *
     * @param {any} JsPdfClass
     * @param {object[]} aItems
     * @param {object} [oMeta]
     * @returns {any}
     */
    function generateDoc(JsPdfClass, aItems, oMeta) {
        var meta = oMeta || {};
        var sVariant = meta.variant || VARIANTS.STANDARD;
        var bIsVertical = sVariant === VARIANTS.VERTICAL;
        var aFormat = bIsVertical ? [288, 432] : [100, 100];
        var sUnit = bIsVertical ? "pt" : "mm";

        var doc = new JsPdfClass({
            orientation: "portrait",
            unit: sUnit,
            format: aFormat,
            compress: true
        });

        if (typeof doc.viewerPreferences === "function") {
            doc.viewerPreferences({ PrintScaling: "None" });
        }

        var aRows = (aItems && aItems.length > 0) ? aItems : [{}];
        aRows.forEach(function (item, index) {
            if (index > 0) {
                doc.addPage(aFormat, "portrait");
            }
            drawSticker(doc, item, meta);
        });

        return doc;
    }

    /**
     * Generates a PDF Blob asynchronously.
     *
     * @param {object[]} aItems
     * @param {object} [oMeta]
     * @returns {Promise<Blob>}
     */
    function generateBlob(aItems, oMeta) {
        return loadJsPdf().then(function (JsPdfClass) {
            var doc = generateDoc(JsPdfClass, aItems, oMeta);
            return doc.output("blob");
        });
    }

    /**
     * Downloads the PDF file directly.
     *
     * @param {object[]} aItems
     * @param {string} sFileName
     * @param {object} [oMeta]
     * @returns {Promise<void>}
     */
    function download(aItems, sFileName, oMeta) {
        return loadJsPdf().then(function (JsPdfClass) {
            var doc = generateDoc(JsPdfClass, aItems, oMeta);
            doc.save(sFileName || "MIB-Sticker.pdf");
        });
    }

    return {
        VARIANTS: VARIANTS,
        SEP: SEP,
        V_LAYOUT: V_LAYOUT,
        loadJsPdf: loadJsPdf,
        measureTextPt: measureTextPt,
        formatDate: formatDate,
        getVerticalItems: getVerticalItems,
        drawItems: drawItems,
        drawStandardSticker: drawStandardSticker,
        drawVerticalSticker: drawVerticalSticker,
        drawSticker: drawSticker,
        generateDoc: generateDoc,
        generateBlob: generateBlob,
        download: download
    };
});
