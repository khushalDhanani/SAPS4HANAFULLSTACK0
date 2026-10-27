sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, HuLayout) {
    "use strict";

    // Quarantine label (fully customised, user decision 2026-10-27). One spec drives geometry, type and the draw
    // list; QuarLabelPdf only plays the draw list into jsPDF. Text metrics and wrapping are the HU label's
    // (Helvetica AFM), so line breaks are identical to what jsPDF prints.
    var MM_PER_INCH = 25.4;
    var PT_PER_INCH = 72;
    function inchToMm(n) { return Math.round(n * MM_PER_INCH * 1000) / 1000; } // 6 * 25.4 is 152.39999999999998 in JS
    var PT2MM = HuLayout.PT2MM;

    // Page sizes in inches, portrait (source of truth; mm and pt are derived, so the PDF page is exactly
    // 288 x 432 pt for 4x6). Add a size here; the layout scales to it.
    var SIZES = {
        "4x6": { key: "4x6", widthIn: 4, heightIn: 6 }
    };
    var DEFAULT_SIZE = "4x6";
    // Thermal printer resolution: change here only (203 default, 300 allowed). Code 128 bars snap to whole dots.
    var PRINTER_DPI = 203;
    var ALLOWED_DPI = [203, 300];
    var MIN_DOTS = 3;          // narrowest reliable bar in whole printer dots (same rule as the HU label)

    // Design base: every mm and pt below is for the 4x6 page and scales with the page.
    var BASE = { widthMm: inchToMm(SIZES["4x6"].widthIn), heightMm: inchToMm(SIZES["4x6"].heightIn) };
    var SAFE_MM = 5;           // safe area on every side
    var MIN_SAFE_MM = 4;       // never less, at any size
    var GAP = 1.6;             // between blocks
    var COL_GAP = 3;           // between the two columns
    var TITLE_H = 11;          // inverted title band
    var BARCODE_H = { min: 12, max: 26 };
    var LH = 1.15;             // multi-line values
    var SINGLE_LH = 1.1;       // captions, single lines
    var ASCENT = 0.8;          // ascent fraction of the font size (Helvetica), as in HuLabelPdf
    var MIN_VALUE_PT = 6;      // values shrink to this before "…"
    var MIN_CAPTION_PT = 5;
    var TYPE = { title: 20, caption: 7, material: 14, storageUnit: 16, value: 10 };

    // Field order. Captions are i18n keys; DateValue's caption follows the row's DateKind (RETEST / EXPIRY) and falls
    // back to the generic date caption.
    var CAPTION_KEYS = {
        title: "qlLabelTitle",
        MaterialDescription: "qlLabelMaterial",
        StorageUnit: "qlLabelStorageUnit",
        MaterialDocument: "qlLabelMaterialDocument",
        PostingDate: "qlLabelPostingDate",
        Batch: "qlLabelBatch",
        SupplierBatch: "qlLabelSupplierBatch",
        SupplierName: "qlLabelSupplier",
        BatchCharacteristics: "qlLabelBatchCharacteristics",
        ManufacturingDate: "qlLabelMfgDate",
        DateValue: "qlLabelDate",
        retestDate: "qlLabelRetestDate",
        expiryDate: "qlLabelExpiryDate",
        PostedQuantity: "qlLabelPostedQuantity",
        ContainerQuantity: "qlLabelContainerQuantity",
        Container: "qlLabelContainer",
        Text: "qlLabelRemark",
        empty: "qlLabelEmpty"
    };
    var GRID = [
        [{ key: "MaterialDocument" }, { key: "PostingDate" }],
        [{ key: "Batch" }, { key: "SupplierBatch" }],
        [{ key: "SupplierName", lines: 2 }],
        [{ key: "BatchCharacteristics", lines: 2 }],
        [{ key: "ManufacturingDate" }, { key: "DateValue" }],
        [{ key: "PostedQuantity" }, { key: "ContainerQuantity" }],
        [{ key: "Container" }],
        [{ key: "Text", lines: 2 }]
    ];

    function half(n) { return Math.round(n * 2) / 2; }
    function lineH(pt, lh) { return pt * PT2MM * lh; }

    /** Size key or {key, widthMm, heightMm} -> {key, widthMm, heightMm, widthPt, heightPt}. */
    function resolveSize(sizeOrKey) {
        if (sizeOrKey && typeof sizeOrKey === "object") {
            if (!(sizeOrKey.widthMm > 0 && sizeOrKey.heightMm > 0)) { throw new Error("Label size needs widthMm and heightMm"); }
            return {
                key: sizeOrKey.key || "custom", widthMm: sizeOrKey.widthMm, heightMm: sizeOrKey.heightMm,
                widthPt: sizeOrKey.widthMm / MM_PER_INCH * PT_PER_INCH, heightPt: sizeOrKey.heightMm / MM_PER_INCH * PT_PER_INCH
            };
        }
        var size = SIZES[sizeOrKey || DEFAULT_SIZE];
        if (!size) { throw new Error("Unknown label size: " + sizeOrKey); }
        return {
            key: size.key, widthMm: inchToMm(size.widthIn), heightMm: inchToMm(size.heightIn),
            widthPt: size.widthIn * PT_PER_INCH, heightPt: size.heightIn * PT_PER_INCH
        };
    }

    /** Geometry for a page size (key or {widthMm, heightMm}). All positions mm, fonts pt. Throws if the page is too small. */
    function layout(sizeOrKey, opts) {
        var size = resolveSize(sizeOrKey);
        var dpi = (opts && opts.dpi) || PRINTER_DPI;
        if (ALLOWED_DPI.indexOf(dpi) < 0) { throw new Error("Printer dpi must be one of " + ALLOWED_DPI.join(", ")); }
        var s = Math.min(size.widthMm / BASE.widthMm, size.heightMm / BASE.heightMm);
        var pad = Math.max(MIN_SAFE_MM, SAFE_MM * s);
        var w = size.widthMm - 2 * pad;
        var innerH = size.heightMm - 2 * pad;
        var gap = GAP * s;
        var capPt = Math.max(MIN_CAPTION_PT, half(TYPE.caption * s));
        var capH = lineH(capPt, SINGLE_LH);
        var valPt = half(TYPE.value * s);
        var colW = (w - COL_GAP * s) / 2;
        var blocks = [];
        var y = pad;

        var title = { x: pad, y: y, w: w, h: TITLE_H * s, pt: half(TYPE.title * s) };
        y += title.h + gap;

        var matPt = half(TYPE.material * s);
        blocks.push({ key: "MaterialDescription", x: pad, y: y, w: w, h: capH + 2 * lineH(matPt, LH), captionPt: capPt, valuePt: matPt, maxLines: 2, bold: true });
        y += blocks[0].h + gap;

        // Grid height first: the barcode takes what is left, within its min/max.
        var gridH = 0;
        var gridRows = GRID.map(function (cells) {
            var lines = Math.max.apply(null, cells.map(function (c) { return c.lines || 1; }));
            var h = capH + lines * lineH(valPt, LH);
            gridH += h;
            return { cells: cells, h: h };
        });
        gridH += gap * (GRID.length - 1);

        var suPt = half(TYPE.storageUnit * s);
        var suH = lineH(suPt, SINGLE_LH);
        var free = innerH - (y - pad) - capH - suH - 2 * gap - gridH;
        if (free < BARCODE_H.min * s) { throw new Error("Label size too small for the quarantine label layout"); }
        var barH = Math.min(free, BARCODE_H.max * s);
        var slack = free - barH; // spread above and below the barcode block

        y += slack / 2;
        var barcode = { key: "StorageUnit", x: pad, y: y, w: w, captionY: y, captionPt: capPt, barY: y + capH, barH: barH, textPt: suPt };
        barcode.textY = barcode.barY + barH + gap / 2;
        barcode.h = capH + barH + gap / 2 + suH;
        y += barcode.h + gap + slack / 2;

        gridRows.forEach(function (r) {
            r.cells.forEach(function (c, i) {
                var cw = r.cells.length === 1 ? w : colW;
                blocks.push({ key: c.key, x: pad + i * (colW + COL_GAP * s), y: y, w: cw, h: r.h, captionPt: capPt, valuePt: valPt, maxLines: c.lines || 1, bold: false });
            });
            y += r.h + gap;
        });

        return {
            key: size.key, scale: s, dpi: dpi, dotMm: MM_PER_INCH / dpi,
            page: { wMm: size.widthMm, hMm: size.heightMm, wPt: size.widthPt, hPt: size.heightPt },
            safe: { x: pad, y: pad, w: w, h: innerH },
            title: title, blocks: blocks, barcode: barcode, captionH: capH
        };
    }

    /**
     * Wrap first, then shrink to minPt, then cut with "…" (HU wrap adds it). Returns {pt, lines, truncated}.
     */
    function fitText(sText, wMm, pt, minPt, maxLines, bBold) {
        var floor = Math.min(minPt, pt);
        for (var p = pt; p >= floor; p = half(p - 0.5)) {
            var r = HuLayout.wrap(sText, wMm, p, maxLines, bBold);
            if (!r.truncated) { return { pt: p, lines: r.lines, truncated: false }; }
            if (p === floor) { return { pt: p, lines: r.lines, truncated: true }; }
        }
        var last = HuLayout.wrap(sText, wMm, floor, maxLines, bBold);
        return { pt: floor, lines: last.lines, truncated: last.truncated };
    }

    /** Code 128 bars snapped to whole printer dots, centred in the safe width. null when nothing can be drawn. */
    function snapBars(L, sValue) {
        var g = Barcode.bars(String(sValue));
        var narrowDots = Math.floor(L.barcode.w / L.dotMm / g.total);
        if (narrowDots < 1) { return null; }
        var narrowMm = narrowDots * L.dotMm;
        var widthMm = narrowMm * g.total;
        var x = Math.round((L.barcode.x + (L.barcode.w - widthMm) / 2) / L.dotMm) * L.dotMm;
        return { x: x, narrowMm: narrowMm, narrowDots: narrowDots, widthMm: widthMm, bars: g.bars, total: g.total };
    }

    function dateCaption(row, texts) {
        return { RETEST: texts.retestDate, EXPIRY: texts.expiryDate }[row.DateKind] || null;
    }

    function textValue(row, key) {
        var v = row[key] == null ? "" : String(row[key]).trim();
        if (key === "ContainerQuantity" && v && row.Unit) { v += " " + String(row.Unit).trim(); }
        return v;
    }

    /**
     * Draw list for one label row: { items:[{kind:"fill",x,y,w,h} | {kind:"text",text,x,y,pt,bold,white,align}],
     * warnings:[{code}] }. y of a text item is its baseline. texts: resolved captions keyed like CAPTION_KEYS.
     */
    function render(L, row, texts) {
        Object.keys(CAPTION_KEYS).forEach(function (k) {
            if (!texts || !texts[k]) { throw new Error("Missing label text: " + CAPTION_KEYS[k]); }
        });
        var items = [];
        var warnings = [];
        function text(s, x, yTop, pt, bold, opt) {
            items.push({ kind: "text", text: s, x: x, y: yTop + pt * PT2MM * ASCENT, pt: pt, bold: bold, white: !!(opt && opt.white), align: (opt && opt.align) || "left" });
        }
        function caption(sKey, x, y, w, pt, sOverride) {
            var c = fitText(String(sOverride || texts[sKey]).toUpperCase(), w, pt, MIN_CAPTION_PT, 1, true);
            text(c.lines[0] || "", x, y, c.pt, true);
        }

        // Title band, inverted for visibility (pure black, no grey)
        items.push({ kind: "fill", x: L.title.x, y: L.title.y, w: L.title.w, h: L.title.h });
        var t = fitText(texts.title, L.title.w - 2, L.title.pt, MIN_VALUE_PT, 1, true);
        text(t.lines[0], L.title.x + L.title.w / 2, L.title.y + (L.title.h - t.pt * PT2MM) / 2, t.pt, true, { white: true, align: "center" });

        L.blocks.forEach(function (b) {
            caption(b.key, b.x, b.y, b.w, b.captionPt, b.key === "DateValue" ? dateCaption(row, texts) : null);
            var v = textValue(row, b.key);
            var f = v ? fitText(v, b.w, b.valuePt, MIN_VALUE_PT, b.maxLines, b.bold) : { pt: b.valuePt, lines: [texts.empty], truncated: false };
            if (f.truncated) { warnings.push({ code: "truncated", field: b.key }); }
            var yv = b.y + L.captionH;
            f.lines.forEach(function (line, i) { text(line, b.x, yv + i * f.pt * PT2MM * LH, f.pt, b.bold); });
        });

        // Storage unit: caption, Code 128, human-readable value under the bars
        var B = L.barcode;
        caption("StorageUnit", B.x, B.captionY, B.w, B.captionPt);
        var su = textValue(row, "StorageUnit");
        var snap = null;
        if (su) {
            try { snap = snapBars(L, su); } catch (e) { warnings.push({ code: "barcodeInvalid", field: "StorageUnit" }); }
            if (snap) {
                snap.bars.forEach(function (bar) { items.push({ kind: "fill", x: snap.x + bar.x * snap.narrowMm, y: B.barY, w: bar.w * snap.narrowMm, h: B.barH }); });
                if (snap.narrowDots < MIN_DOTS) { warnings.push({ code: "barcodeDense", field: "StorageUnit" }); }
            } else if (!warnings.some(function (x) { return x.code === "barcodeInvalid"; })) {
                warnings.push({ code: "barcodeTooLong", field: "StorageUnit" });
            }
        } else {
            warnings.push({ code: "barcodeMissing", field: "StorageUnit" });
        }
        var hr = su ? fitText(su, B.w, B.textPt, MIN_VALUE_PT, 1, true) : { pt: B.textPt, lines: [texts.empty], truncated: false };
        if (hr.truncated) { warnings.push({ code: "truncated", field: "StorageUnit" }); }
        text(hr.lines[0], B.x + B.w / 2, B.textY, hr.pt, true, { align: "center" });

        return { items: items, warnings: warnings, barcode: snap };
    }

    return {
        SIZES: SIZES, MM_PER_INCH: MM_PER_INCH, PT_PER_INCH: PT_PER_INCH, DEFAULT_SIZE: DEFAULT_SIZE, PRINTER_DPI: PRINTER_DPI, ALLOWED_DPI: ALLOWED_DPI, MIN_DOTS: MIN_DOTS,
        MIN_SAFE_MM: MIN_SAFE_MM, MIN_VALUE_PT: MIN_VALUE_PT, CAPTION_KEYS: CAPTION_KEYS, GRID: GRID, PT2MM: PT2MM,
        ASCENT: ASCENT, LH: LH, layout: layout, fitText: fitText, snapBars: snapBars, render: render, measureMm: HuLayout.measureMm
    };
});
