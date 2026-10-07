sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (Barcode) {
    "use strict";

    var PAGE_SIZE = "4in 4in"; // 4x4 label (101.6mm x 101.6mm / 4in x 4in)
    var WINDOW_NAME = "huLabelPrint";
    // i18n keys used on the label; the controller resolves them, this module never touches the bundle.
    var TEXT_KEYS = ["huDetailTitle", "huPackagingMaterial", "huLabelPlant", "huLabelSloc", "huColPlantSloc", "huLabelWarehouse", "huLabelBin", "huColStatus",
        "huColGrossWeight", "huNetWeight", "huTareWeight", "huGrossVolume", "huDimDimensions", "huCreatedBy", "huColReference",
        "huItemsTitle", "huItemCol", "huItemMaterial", "huItemBatch", "huItemQuantity", "huItemGrDate", "huItemShelfLife", "huSerialsTitle"];

    function esc(v) {
        return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function num(v) {
        return v !== undefined && v !== null && v !== "" && Number(v) > 0 ? Number(v) : 0;
    }

    function row(sLabel, sValue) {
        return sValue ? "<dt>" + esc(sLabel) + "</dt><dd>" + esc(sValue) + "</dd>" : "";
    }

    function section(oLabel, t) {
        var h = oLabel.header || {};
        var aItems = oLabel.items || [];
        var aSerials = oLabel.serials || [];
        var sHu = h.HandlingUnitExternalID || "";
        var sDims = (num(h.Length) || num(h.Width) || num(h.Height)) ? [h.Length, h.Width, h.Height].map(function (d) { return num(d) || 0; }).join(" x ") + " " + (h.DimensionUnit || "") : "";
        var sPlant = [h.Plant, h.PlantName].filter(Boolean).join(" / ");
        var sSloc = [h.StorageLocation, h.StorageLocationName].filter(Boolean).join(" / ");
        var sFacts = "<dl>" +
            row(t.huPackagingMaterial, h.PackagingMaterial ? h.PackagingMaterial + (h.PackagingMaterialName ? " (" + h.PackagingMaterialName + ")" : "") : "") +
            row(t.huLabelPlant || "Plant / Plant Name", sPlant) +
            row(t.huLabelSloc || "SLOC / SL Name", sSloc) +
            row(t.huLabelWarehouse, [h.Warehouse, h.WarehouseName].filter(Boolean).join(" ")) +
            row(t.huLabelBin, [h.StorageType, h.StorageBin].filter(Boolean).join(" / ")) +
            row(t.huColStatus, h.StatusText || h.Status) +
            row(t.huColGrossWeight, num(h.GrossWeight) ? h.GrossWeight + " " + (h.WeightUnit || "") : "") +
            row(t.huNetWeight, num(h.NetWeight) ? h.NetWeight + " " + (h.WeightUnit || "") : "") +
            row(t.huTareWeight, num(h.TareWeight) ? h.TareWeight + " " + (h.WeightUnit || "") : "") +
            row(t.huGrossVolume, num(h.GrossVolume) ? h.GrossVolume + " " + (h.VolumeUnit || "") : "") +
            row(t.huDimDimensions, sDims) +
            row(t.huCreatedBy, [h.CreatedByUser, h.CreationDateTime].filter(Boolean).join(" · ")) +
            row(t.huColReference, h.ReferenceDocument ? h.ReferenceDocument + (h.ReferenceDocumentType ? " (" + h.ReferenceDocumentType + ")" : "") : "") +
            "</dl>";
        var sItems = "";
        if (aItems.length) {
            sItems = "<h2>" + esc(t.huItemsTitle) + "</h2><table><thead><tr><th>" + esc(t.huItemCol) + "</th><th>" + esc(t.huItemMaterial) + "</th><th>" +
                esc(t.huItemBatch) + "</th><th>" + esc(t.huItemQuantity) + "</th><th>" + esc(t.huItemGrDate) + "</th><th>" + esc(t.huItemShelfLife) + "</th></tr></thead><tbody>" +
                aItems.map(function (it) {
                    return "<tr><td>" + esc(it.HandlingUnitItem) + "</td><td>" + esc(it.Material) + (it.MaterialName ? "<br>" + esc(it.MaterialName) : "") + "</td><td>" +
                        esc(it.Batch || "-") + '</td><td class="q">' + esc(it.Quantity) + " " + esc(it.Unit) + "</td><td>" + esc(it.GoodsReceiptDate || "-") + "</td><td>" +
                        esc(it.ShelfLifeExpirationDate || "-") + "</td></tr>";
                }).join("") + "</tbody></table>";
        }
        var sSerials = aSerials.length ? "<p><b>" + esc(t.huSerialsTitle) + ":</b> " + esc(aSerials.map(function (s) { return s.SerialNumber; }).join(", ")) + "</p>" : "";
        return '<section class="hu"><div class="bc">' + Barcode.toSvg(sHu) + '<div class="num">' + esc(sHu) + "</div></div>" +
            "<h1>" + esc(t.huDetailTitle) + " " + esc(sHu) + "</h1>" + sFacts + sItems + sSerials + "</section>";
    }

    /** aLabels: [{ header: HandlingUnitDetail, items: HandlingUnitItem[], serials: SerialNumber[] }]; oTexts: i18n key -> text. */
    function buildHtml(aLabels, oTexts, sPageSize) {
        var t = oTexts || {};
        var aL = aLabels || [];
        var sSize = sPageSize || PAGE_SIZE;
        var sTitle = aL.length === 1 ? ((aL[0].header || {}).HandlingUnitExternalID || "") : "Handling Units (" + aL.length + ")";
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(sTitle) + "</title><style>" +
            "@page{size:" + sSize + ";margin:3mm}body{font:8pt/1.25 Arial,sans-serif;margin:0;color:#000}" +
            ".hu{break-after:page;page-break-after:always;padding:1mm 2mm;box-sizing:border-box;max-width:4in}.hu:last-child{break-after:auto;page-break-after:auto}" +
            ".bc{text-align:center;margin-bottom:2mm}.bc svg{max-width:90%;height:14mm}.num{font:bold 11pt monospace;letter-spacing:.12em;margin-top:1mm}h1{font-size:10pt;margin:0 0 2mm;text-align:center;border-bottom:1px solid #000;padding-bottom:1mm}h2{font-size:8pt;margin:2mm 0 1mm}" +
            "dl{display:grid;grid-template-columns:30mm 1fr;gap:0.8mm 2mm;margin:0 0 2mm;font-size:7.5pt}dt{font-weight:bold;color:#111}dd{margin:0;word-break:break-word}" +
            "table{width:100%;border-collapse:collapse;font-size:7pt}th,td{border:1px solid #000;padding:0.5mm 1mm;text-align:left;vertical-align:top}th{background:#f0f0f0;font-weight:bold}td.q{text-align:right;white-space:nowrap}" +
            "</style></head><body>" + aL.map(function (l) { return section(l, t); }).join("") + "</body></html>";
    }

    /** Opens the (blank) print window synchronously - call it inside the click handler, before any async work. null when blocked. */
    function openWindow() {
        return window.open("", WINDOW_NAME);
    }

    /** Writes the label document into an open window and prints it. */
    function print(oWin, aLabels, oTexts, sPageSize) {
        oWin.document.open();
        oWin.document.write(buildHtml(aLabels, oTexts, sPageSize));
        oWin.document.close();
        oWin.focus();
        oWin.print();
    }

    return { PAGE_SIZE: PAGE_SIZE, TEXT_KEYS: TEXT_KEYS, esc: esc, buildHtml: buildHtml, openWindow: openWindow, print: print };
});
