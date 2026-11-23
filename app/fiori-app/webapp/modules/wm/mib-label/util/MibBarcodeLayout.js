sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (Barcode) {
    "use strict";

    /**
     * Calculates Code 128 barcode bars and centered human-readable text items
     * for the MIB vertical 4" x 6" sticker layout.
     * Prevents barcode overlap with the corporate logo on the right side.
     *
     * @param {string} sBarcodeText - Formatted barcode text (e.g. without leading zeros)
     * @param {object} V_LAYOUT - Layout constants
     * @param {number} pX - Left start coordinate
     * @param {number} availW - Maximum available width for barcode
     * @param {number} fallbackCenterX - Horizontal center for fallback text
     * @returns {object[]} Array of draw items (bars and text)
     */
    function buildBarcodeItems(sBarcodeText, V_LAYOUT, pX, availW, fallbackCenterX) {
        var items = [];
        if (!Barcode || typeof Barcode.bars !== "function") {
            return items;
        }

        var dotPt = V_LAYOUT.ptPerInch / V_LAYOUT.dpi;
        var snap = function (n) { return Math.round(n / dotPt) * dotPt; };

        try {
            var oBars = Barcode.bars(String(sBarcodeText), "B");
            var dotMm = V_LAYOUT.mmPerInch / V_LAYOUT.dpi;
            var targetModuleDots = Math.round(0.5 / dotMm); // 4 dots @ 203 DPI
            var minModuleDots = Math.ceil(0.375 / dotMm - 1e-9); // 3 dots @ 203 DPI

            var chosenDots = minModuleDots;
            var bFits = false;
            for (var d = targetModuleDots; d >= minModuleDots; d--) {
                var mTest = d * dotPt;
                var barsWTest = (oBars.total - 10) * mTest;
                if (barsWTest <= availW + 1e-9) {
                    chosenDots = d;
                    bFits = true;
                    break;
                }
            }

            var modulePt = chosenDots * dotPt;
            // If even minModuleDots exceeds availW, scale modulePt to strictly fit inside availW
            // to guarantee the barcode never extends into the corporate logo on the right side.
            if (!bFits && (oBars.total - 10) * modulePt > availW) {
                modulePt = availW / (oBars.total - 10);
            }

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
                x: fallbackCenterX,
                y: V_LAYOUT.barTop + 20,
                pt: V_LAYOUT.hrPt,
                bold: true,
                align: "center"
            });
        }

        return items;
    }

    return {
        buildBarcodeItems: buildBarcodeItems
    };
});
