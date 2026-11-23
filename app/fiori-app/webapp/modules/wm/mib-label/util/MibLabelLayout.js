sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/AetherLogo",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout",
    "saps4hana/fiori/modules/wm/mib-label/util/MibBarcodeLayout",
    "saps4hana/fiori/modules/wm/mib-label/util/MibLabelRows"
], function (AetherLogo, HuLabelLayout, MibBarcodeLayout, MibLabelRows) {
    "use strict";

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
     * Numeric storage unit or barcode text "00000000001000057539" -> "1000057539".
     * Alphanumeric values unchanged.
     * Matches Quarantine Labels convention.
     *
     * @param {string} v
     * @returns {string}
     */
    function withoutLeadingZeros(v) {
        var s = String(v == null ? "" : v).trim();
        return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s;
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
        if (MibLabelRows && typeof MibLabelRows.buildRowItems === "function") {
            var aRowItems = MibLabelRows.buildRowItems(oItem, oMeta, V_LAYOUT, snap, formatDate, measureTextPt, SEP.opacity);
            items.push.apply(items, aRowItems);
        }

        // 5. Code 128 B Vector Barcode & Centered Human-Readable Number
        var pX = snap(ruleVx + V_LAYOUT.gap); // ~40.43 pt
        var contentX0 = pX;
        var contentX1 = V_LAYOUT.page.w - V_LAYOUT.edge; // ~275.16 pt
        var sRawBarcode = (oItem.StorageUnit && oItem.StorageUnit !== "N/A" && oItem.StorageUnit !== "-")
            ? oItem.StorageUnit
            : (oItem.TransferOrder || oMeta.transferOrderNumber || "1000058465");
        var sBarcodeText = withoutLeadingZeros(sRawBarcode);

        var barRight = snap(pX + snap(166)); // ~206.42 pt
        var availW = barRight - pX;
        var fallbackCenterX = (contentX0 + contentX1) / 2;

        if (MibBarcodeLayout && typeof MibBarcodeLayout.buildBarcodeItems === "function") {
            var aBarcodeItems = MibBarcodeLayout.buildBarcodeItems(sBarcodeText, V_LAYOUT, pX, availW, fallbackCenterX);
            items.push.apply(items, aBarcodeItems);
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

    return {
        VARIANTS: VARIANTS,
        SEP: SEP,
        V_LAYOUT: V_LAYOUT,
        measureTextPt: measureTextPt,
        formatDate: formatDate,
        withoutLeadingZeros: withoutLeadingZeros,
        getVerticalItems: getVerticalItems
    };
});
