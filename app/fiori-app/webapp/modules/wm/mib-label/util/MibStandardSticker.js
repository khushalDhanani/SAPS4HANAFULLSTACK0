sap.ui.define([
    "saps4hana/fiori/modules/wm/quarantine-label/util/AetherLogo",
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (AetherLogo, Barcode) {
    "use strict";

    /**
     * Draws one 100 x 100 mm standard sticker matching the physical label from Adobe Form ZMM_AF_021 / TCode ZMIB.
     *
     * @param {any} doc - jsPDF instance (unit: mm)
     * @param {object} item - Line item data
     * @param {object} meta - Header parameters (transferOrderNumber, etc.)
     * @param {Function} formatDate - Date formatting helper
     * @param {Function} withoutLeadingZeros - Leading zeros removal helper
     */
    function drawStandardSticker(doc, item, meta, formatDate, withoutLeadingZeros) {
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
        var sRawBarcode = (oItem.StorageUnit && oItem.StorageUnit !== "N/A" && oItem.StorageUnit !== "-")
            ? oItem.StorageUnit
            : (oItem.TransferOrder || oMeta.transferOrderNumber || "1000058465");
        var sBarcodeText = withoutLeadingZeros(sRawBarcode);

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

    return {
        drawStandardSticker: drawStandardSticker
    };
});
