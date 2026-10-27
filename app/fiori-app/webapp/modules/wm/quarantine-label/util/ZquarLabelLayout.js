sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, HuLayout) {
    "use strict";

    // ZQUAR quarantine label, same layout as the SAP label, enlarged to 4 x 6 in with a bigger barcode.
    // All positions in pt, origin top-left, "top" = top of the text box (as measured). One spec drives the
    // geometry; render() returns a draw list that ZquarLabelPdf plays into jsPDF.
    var PT_PER_INCH = 72;
    var MM_PER_INCH = 25.4;
    var MM2PT = PT_PER_INCH / MM_PER_INCH;

    // Page sizes in inches (source of truth; pt derived, so 4x6 is exactly 288 x 432 pt).
    var SIZES = { "4x6": { key: "4x6", widthIn: 4, heightIn: 6 } };
    var DEFAULT_SIZE = "4x6";
    // Printer resolution: 203 default, 300 allowed; the barcode module is a whole number of printer dots.
    var PRINTER_DPI = 203;
    var ALLOWED_DPI = [203, 300];

    // MEASURED current label, 288 x 288 pt (docs/label/zquar-current-layout.md). Horizontal structure is kept;
    // row tops scale with the page height. Left value column +1 pt: user decision "9 pt captions, +1 pt x".
    var BASE = {
        page: { w: 288, h: 288 },
        content: { x0: 36, x1: 273.9 },
        ruleV: { x: 36.7 },
        ruleH: { y: 34.5, x0: 35.8, x1: 273.9 },
        titleTop: 13.2,
        captionX: 38.8,
        valueX: 102.9 + 1,
        grnDate: { captionX: 173.8, valueX: 226.2 },
        container: { captionX: 169.9, valueX: 230.7 },
        dateCols: [{ captionX: 38.8, valueX: 38.8 }, { captionX: 114.4, valueX: 119.8 }, { captionX: 208.4, valueX: 214.4 }],
        // 181.2: the task's 4x6 value 271.8 / 1.5 (measured as "181")
        top: {
            materialName: 38.8, grn: 67.6, grnDate: 68.4, inw: 83.4, qty: 100.8, manufacturer: 117.5,
            supplier: 144.0, batch: 166.2, dateCaptions: 181.2, dateValues: 193.9, preparedBy: 212.5
        },
        barcodeX: 38.8
    };
    // 4 x 6 design sizes (pt); on other pages they scale with the page, never below MIN_PT.
    var DESIGN_PAGE = { w: 288, h: 432 };
    var TYPE = { caption: 9, value: 11, valueSmall: 10.5, title: 18, quarantine: 14, formNumber: 9, humanReadable: 13 };
    var MIN_PT = 9;
    var LH = 1.15;           // line height of wrapped values
    var ASCENT = 0.79;       // text-box top -> baseline, measured in the sample (title, GRN No., barcode text: 0.789)
    var EM = 0.925;          // Helvetica ascender + descender: band of a rotated strip text
    var CAP_ASCENT = 0.718;  // Helvetica ascender
    var GAP = 4;             // caption -> value; rules -> barcode
    var STRIP_GAP = 1.5;     // between the two strip texts and the rule
    var EDGE_MM = 4;         // safe margin on the page edge (bottom: BARCODE.bottomPad)
    var BARCODE = { barH: 62, hrGap: 3, bottomPad: 14, targetModuleMm: 0.5, minModuleMm: 0.375, hrOffset: 10.6 };

    // Field order and placement (keys of the label row and of the caption texts).
    var FIELDS = [
        { key: "materialName", row: "materialName", lines: 2 },
        { key: "grnNo", row: "grn", small: true, valueEnd: "grnDateCaption" },
        { key: "grnDate", row: "grnDate", captionX: "grnDate", small: true },
        { key: "inwNo", row: "inw" },
        { key: "qtyReceived", row: "qty", valueEnd: "containerCaption" },
        { key: "containerNo", row: "qty", captionX: "container" },
        { key: "manufacturer", row: "manufacturer", lines: 2 },
        { key: "supplier", row: "supplier", lines: 2 },
        { key: "batchNo", row: "batch" },
        { key: "mfgDate", col: 0 },
        { key: "expiryDate", col: 1 },
        { key: "netWeight", col: 2, small: true },
        { key: "preparedBy", row: "preparedBy", noValue: true }
    ];
    var STATIC_KEYS = { title: "zqTitle", quarantine: "zqQuarantine", formNumber: "zqFormNumber" };
    // Texts used only for some rows (a row may replace a caption via row.captions[fieldKey])
    var EXTRA_KEYS = { retestDate: "zqRetestDate" };
    var CAPTION_KEYS = {
        materialName: "zqMaterialName", grnNo: "zqGrnNo", grnDate: "zqGrnDate", inwNo: "zqInwNo", qtyReceived: "zqQtyReceived",
        containerNo: "zqContainerNo", manufacturer: "zqManufacturer", supplier: "zqSupplier", batchNo: "zqBatchNo",
        mfgDate: "zqMfgDate", expiryDate: "zqExpiryDate", netWeight: "zqNetWeight", preparedBy: "zqPreparedBy"
    };

    function widthPt(s, pt, bold) { return HuLayout.measureMm(s, pt, bold) * MM2PT; }
    function half(n) { return Math.round(n * 2) / 2; }

    function resolveSize(sizeOrKey) {
        if (sizeOrKey && typeof sizeOrKey === "object") {
            if (!(sizeOrKey.widthIn > 0 && sizeOrKey.heightIn > 0)) { throw new Error("Label size needs widthIn and heightIn"); }
            return { key: sizeOrKey.key || "custom", wPt: sizeOrKey.widthIn * PT_PER_INCH, hPt: sizeOrKey.heightIn * PT_PER_INCH };
        }
        var s = SIZES[sizeOrKey || DEFAULT_SIZE];
        if (!s) { throw new Error("Unknown label size: " + sizeOrKey); }
        return { key: s.key, wPt: s.widthIn * PT_PER_INCH, hPt: s.heightIn * PT_PER_INCH };
    }

    /** Geometry for a page size (key or {widthIn, heightIn}) and printer dpi. Throws when the page cannot hold it. */
    function layout(sizeOrKey, opts) {
        var size = resolveSize(sizeOrKey);
        var dpi = (opts && opts.dpi) || PRINTER_DPI;
        if (ALLOWED_DPI.indexOf(dpi) < 0) { throw new Error("Printer dpi must be one of " + ALLOWED_DPI.join(", ")); }
        var W = size.wPt;
        var H = size.hPt;
        var sx = W / BASE.page.w;
        var sy = H / BASE.page.h;
        var f = Math.min(W / DESIGN_PAGE.w, H / DESIGN_PAGE.h);
        var k = H / DESIGN_PAGE.h;
        var pt = function (n) { return Math.max(MIN_PT, n * f); };
        var X = function (n) { return n * sx; };
        var edge = EDGE_MM * MM2PT;

        var hrPt = pt(TYPE.humanReadable);
        var hrTop = H - BARCODE.bottomPad * k - hrPt;
        var barH = BARCODE.barH * k;
        var barTop = hrTop - BARCODE.hrGap * k - barH;
        var ruleEnd = barTop - GAP * k;

        var capPt = pt(TYPE.caption);
        var rowTop = function (name) { return BASE.top[name] * sy; };
        var contentRight = X(BASE.content.x1);
        var fields = FIELDS.map(function (d) {
            var captionX = X(d.captionX ? BASE[d.captionX].captionX : (d.col !== undefined ? BASE.dateCols[d.col].captionX : BASE.captionX));
            var valueX = X(d.captionX ? BASE[d.captionX].valueX : (d.col !== undefined ? BASE.dateCols[d.col].valueX : BASE.valueX));
            var valueEnd = contentRight;
            if (d.valueEnd === "grnDateCaption") { valueEnd = X(BASE.grnDate.captionX) - GAP; }
            if (d.valueEnd === "containerCaption") { valueEnd = X(BASE.container.captionX) - GAP; }
            if (d.col !== undefined && d.col < BASE.dateCols.length - 1) { valueEnd = X(BASE.dateCols[d.col + 1].captionX) - GAP; }
            var top = d.col !== undefined ? rowTop("dateCaptions") : rowTop(d.row);
            return {
                key: d.key,
                caption: { x: captionX, top: top, pt: capPt, end: d.col !== undefined ? valueEnd : valueX - GAP },
                value: d.noValue ? null : {
                    x: valueX, top: d.col !== undefined ? rowTop("dateValues") : top, end: valueEnd,
                    pt: pt(d.small ? TYPE.valueSmall : TYPE.value), maxLines: d.lines || 1
                }
            };
        });
        var last = fields[fields.length - 1].caption;
        if (last.top + last.pt > ruleEnd - GAP * k) { throw new Error("Label size too small for the quarantine label layout"); }

        // Left strip: QUARANTINE then the form number, rotated 90 degrees counter-clockwise (read bottom to top),
        // glyph height as designed, stretched along the strip by the page's height ratio (user decision).
        var qPt = pt(TYPE.quarantine);
        var fPt = pt(TYPE.formNumber);
        var qBand = edge;
        var fBand = qBand + EM * qPt + STRIP_GAP;
        if (fBand + EM * fPt > X(BASE.ruleV.x) - STRIP_GAP) { throw new Error("Label too narrow for the strip texts"); }

        return {
            key: size.key, dpi: dpi, dotPt: PT_PER_INCH / dpi, edge: edge, sx: sx, sy: sy,
            page: { wPt: W, hPt: H },
            ruleV: { x: X(BASE.ruleV.x), y0: 0, y1: ruleEnd },
            ruleH: { y: BASE.ruleH.y * sy, x0: X(BASE.ruleH.x0), x1: X(BASE.ruleH.x1) },
            title: { x0: X(BASE.content.x0), x1: X(274), top: BASE.titleTop * sy, pt: pt(TYPE.title) },
            strip: {
                center: ruleEnd / 2, length: ruleEnd - 2 * edge, hScale: sy,
                quarantine: { band: qBand, pt: qPt },
                formNumber: { band: fBand, pt: fPt }
            },
            fields: fields,
            barcode: { x0: X(BASE.barcodeX), right: contentRight, top: barTop, h: barH, hrTop: hrTop, hrPt: hrPt, hrOffset: BARCODE.hrOffset * sx }
        };
    }

    /** Wrap first, then shrink to MIN_PT, then cut with "…". Width in pt. Returns {pt, lines, truncated}. */
    function fitText(s, wPt, pt, maxLines, bold) {
        var wMm = wPt / MM2PT;
        var floor = Math.min(MIN_PT, pt);
        for (var p = pt; p >= floor; p = half(p - 0.5)) {
            var r = HuLayout.wrap(s, wMm, p, maxLines, bold);
            if (!r.truncated) { return { pt: p, lines: r.lines, truncated: false }; }
            if (p === floor) { return { pt: p, lines: r.lines, truncated: true }; }
        }
        var last = HuLayout.wrap(s, wMm, floor, maxLines, bold);
        return { pt: floor, lines: last.lines, truncated: last.truncated };
    }

    /**
     * Code 128 B bars at a whole-dot module: the target (0.5 mm) when it fits the width, else the largest whole-dot
     * module that fits, never below 0.375 mm. Never scaled or squeezed: throws when even that does not fit.
     */
    function barcodeGeometry(L, sValue) {
        var g = Barcode.bars(String(sValue), "B");
        var dotMm = MM_PER_INCH / L.dpi;
        var target = Math.round(BARCODE.targetModuleMm / dotMm);
        var minDots = Math.ceil(BARCODE.minModuleMm / dotMm - 1e-9);
        var x0 = Math.round(L.barcode.x0 / L.dotPt) * L.dotPt; // quiet zone starts on a printer dot
        var avail = L.barcode.right - x0;
        for (var dots = target; dots >= minDots; dots--) {
            var m = dots * L.dotPt;
            if (g.total * m <= avail + 1e-9) {
                return { x0: x0, modulePt: m, moduleDots: dots, totalModules: g.total, widthPt: g.total * m, bars: g.bars };
            }
        }
        throw Object.assign(new Error("Barcode value '" + sValue + "' is too long for the label: " + g.total + " modules need "
            + (g.total * minDots * L.dotPt).toFixed(1) + " pt at the minimum module (" + BARCODE.minModuleMm + " mm), "
            + avail.toFixed(1) + " pt available."), { code: "barcodeTooLong" });
    }

    /**
     * Draw list for one label row: items {kind:"line",x1,y1,x2,y2,w} | {kind:"bar",x,y,w,h} |
     * {kind:"text",text,x,y(baseline),pt,bold,align,angle,hScale}. texts: static texts + captions (STATIC_KEYS, CAPTION_KEYS).
     */
    function render(L, row, texts) {
        Object.keys(STATIC_KEYS).concat(Object.keys(CAPTION_KEYS)).forEach(function (kk) {
            if (!texts || !texts[kk]) { throw new Error("Missing label text: " + (STATIC_KEYS[kk] || CAPTION_KEYS[kk])); }
        });
        var items = [];
        var warnings = [];
        function text(s, x, top, p, bold, extra) {
            items.push(Object.assign({ kind: "text", text: s, x: x, y: top + p * ASCENT, pt: p, bold: bold, align: "left" }, extra || {}));
        }

        items.push({ kind: "line", x1: L.ruleV.x, y1: L.ruleV.y0, x2: L.ruleV.x, y2: L.ruleV.y1, w: 0.5 });
        items.push({ kind: "line", x1: L.ruleH.x0, y1: L.ruleH.y, x2: L.ruleH.x1, y2: L.ruleH.y, w: 0.5 });

        var t = fitText(texts.title, L.title.x1 - L.title.x0, L.title.pt, 1, true);
        text(t.lines[0], (L.title.x0 + L.title.x1) / 2, L.title.top, t.pt, true, { align: "center" });

        // Strip texts: baseline sits CAP_ASCENT below the band's left edge (glyph tops point left when rotated)
        [["quarantine", true], ["formNumber", false]].forEach(function (e) {
            var S = L.strip[e[0]];
            var len = widthPt(texts[e[0]], S.pt, e[1]);
            var hScale = Math.min(L.strip.hScale, L.strip.length / len);
            items.push({
                kind: "text", text: texts[e[0]], x: S.band + CAP_ASCENT * S.pt, y: L.strip.center + len * hScale / 2,
                pt: S.pt, bold: e[1], align: "left", angle: 90, hScale: hScale, len: len * hScale, band: [S.band, S.band + EM * S.pt]
            });
        });

        L.fields.forEach(function (fd) {
            var sCaption = (row.captions && row.captions[fd.key]) || texts[fd.key];
            var c = fitText(sCaption, fd.caption.end - fd.caption.x, fd.caption.pt, 1, true);
            if (c.truncated) { warnings.push({ code: "truncated", field: fd.key + ".caption" }); }
            text(c.lines[0] || "", fd.caption.x, fd.caption.top, c.pt, true);
            if (!fd.value) { return; }
            var v = row[fd.key] == null ? "" : String(row[fd.key]).trim();
            if (!v) { return; } // empty values keep their space
            var r = fitText(v, fd.value.end - fd.value.x, fd.value.pt, fd.value.maxLines, false);
            if (r.truncated) { warnings.push({ code: "truncated", field: fd.key }); }
            r.lines.forEach(function (line, i) { text(line, fd.value.x, fd.value.top + i * r.pt * LH, r.pt, false); });
        });

        var code = row.barcode == null ? "" : String(row.barcode).trim();
        var geo = null;
        if (code) {
            geo = barcodeGeometry(L, code);
            geo.bars.forEach(function (b) { items.push({ kind: "bar", x: geo.x0 + b.x * geo.modulePt, y: L.barcode.top, w: b.w * geo.modulePt, h: L.barcode.h }); });
            var hrX = geo.x0 + 10 * geo.modulePt + L.barcode.hrOffset;
            var hr = fitText(code, L.barcode.right - hrX, L.barcode.hrPt, 1, false);
            text(hr.lines[0], hrX, L.barcode.hrTop, hr.pt, false);
        } else {
            warnings.push({ code: "barcodeMissing", field: "barcode" });
        }
        return { items: items, warnings: warnings, barcode: geo };
    }

    return {
        SIZES: SIZES, DEFAULT_SIZE: DEFAULT_SIZE, PRINTER_DPI: PRINTER_DPI, ALLOWED_DPI: ALLOWED_DPI, PT_PER_INCH: PT_PER_INCH,
        MM_PER_INCH: MM_PER_INCH, MIN_PT: MIN_PT, GAP: GAP, ASCENT: ASCENT, LH: LH, EM: EM, BARCODE: BARCODE, BASE: BASE,
        FIELDS: FIELDS, STATIC_KEYS: STATIC_KEYS, CAPTION_KEYS: CAPTION_KEYS, EXTRA_KEYS: EXTRA_KEYS,
        layout: layout, fitText: fitText, barcodeGeometry: barcodeGeometry, render: render, widthPt: widthPt
    };
});
