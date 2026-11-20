sap.ui.define([], function () {
    "use strict";

    /**
     * Builds the body table row items and hairline dividers for the MIB vertical 4" x 6" sticker.
     *
     * @param {object} oItem - Line item data
     * @param {object} oMeta - Header parameters
     * @param {object} V_LAYOUT - Layout constants
     * @param {Function} snap - Coordinate snapping function
     * @param {Function} formatDate - Date formatter
     * @param {Function} measureTextPt - Font metric width calculator
     * @param {number} sepOpacity - Hairline divider opacity (e.g. 0.05)
     * @returns {object[]} Array of draw items (captions, colons, values, separators)
     */
    function buildRowItems(oItem, oMeta, V_LAYOUT, snap, formatDate, measureTextPt, sepOpacity) {
        var items = [];
        var dotPt = V_LAYOUT.ptPerInch / V_LAYOUT.dpi;
        var ruleW = V_LAYOUT.ruleDots * dotPt;
        var ruleVx = snap(V_LAYOUT.ruleVx);
        var pX = snap(ruleVx + V_LAYOUT.gap);
        var contentX0 = pX;
        var contentX1 = V_LAYOUT.page.w - V_LAYOUT.edge;
        var sepW = ruleW;
        var rowsTop = V_LAYOUT.rowsTop;
        var rowsEndV = V_LAYOUT.rowsEnd;
        var sBatch = oItem.Batch || "-";

        function addSep(y) {
            items.push({
                kind: "sep",
                x: snap(contentX0),
                y: snap(y - sepW / 2),
                w: snap(contentX1) - snap(contentX0),
                h: sepW,
                opacity: sepOpacity
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

        return items;
    }

    return {
        buildRowItems: buildRowItems
    };
});
