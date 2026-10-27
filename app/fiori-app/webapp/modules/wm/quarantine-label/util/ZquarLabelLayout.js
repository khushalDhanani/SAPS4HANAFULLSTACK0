sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, HuLayout) {
    "use strict";

    // ZQUAR quarantine label, same layout as the SAP label, enlarged to 4 x 6 in with a bigger barcode.
    // All positions in pt, origin top-left. Field rows: caption and value share one baseline, one caption size and
    // one value size, rows evenly spaced between the title rule and "Prepared by" (user request 2026-10-27).
    // render() returns a draw list that ZquarLabelPdf plays into jsPDF and the print document.
    var PT_PER_INCH = 72;
    var MM_PER_INCH = 25.4;
    var MM2PT = PT_PER_INCH / MM_PER_INCH;

    // Page sizes in inches (source of truth; pt derived, so 4x6 is exactly 288 x 432 pt).
    var SIZES = { "4x6": { key: "4x6", widthIn: 4, heightIn: 6 } };
    var DEFAULT_SIZE = "4x6";
    // Printer resolution: 203 default, 300 allowed; the barcode module is a whole number of printer dots.
    var PRINTER_DPI = 203;
    var ALLOWED_DPI = [203, 300];

    // MEASURED current label, 288 x 288 pt (docs/label/zquar-current-layout.md): rules, title, left caption and
    // value columns (value column +1 pt: user decision "9 pt captions, +1 pt x"). Field rows are placed by render().
    var BASE = {
        page: { w: 288, h: 288 },
        content: { x1: 273.9 }, // right end of the measured barcode span
        ruleV: { x: 36.7 },
        ruleH: { y: 34.5 },
        titleTop: 13.2,
        captionX: 38.8,
        valueX: 102.9 + 1,
        barcodeX: 38.8
    };
    // 4 x 6 design sizes (pt); on other pages they scale with the page, never below MIN_PT.
    var DESIGN_PAGE = { w: 288, h: 432 };
    var TYPE = { caption: 9, value: 11, title: 18, quarantine: 14, formNumber: 9, humanReadable: 14 };
    var MIN_PT = 9;
    var LH = 1.15;           // line height of wrapped values
    var ASCENT = 0.79;       // text-box top -> baseline, measured in the sample (title, GRN No., barcode text: 0.789)
    var EM = 0.925;          // Helvetica ascender + descender: band of a rotated strip text
    var CAP_ASCENT = 0.718;  // Helvetica ascender
    var GAP = 4;             // caption -> value; rules -> barcode
    // rule -> first text top; "Prepared by" baseline -> rule end; date caption -> value
    var ROWS = { padTop: 6, padBottom: 10, dateGap: 3 };
    var RULE_DOTS = 2;       // rule thickness in whole printer dots (crisp edges on the label printer)
    // Widest value expected in the right-hand pairs, so their caption column clears it (GRN No. is 10 digits)
    var RIGHT_RESERVE = { grnDate: "00/00/0000", containerNo: "00 OF 00" };
    var LEFT_RESERVE = { grnNo: "0000000000" };
    var STRIP_GAP = 1.5;     // between the two strip texts and the rule
    var EDGE_MM = 4;         // safe margin on the page edge (bottom: BARCODE.bottomPad)
    // Bars 84 pt (≈ 30 mm; SAP label 62 pt): user asked for bigger, then "too big" at 129.5 pt
    var BARCODE = { barH: 84, hrGap: 3, bottomPad: 14, targetModuleMm: 0.5, minModuleMm: 0.375 };

    // Field order (keys of the label row and of the caption texts): row index, right-hand pair, date column.
    var FIELDS = [
        { key: "materialName", row: 0, lines: 2 },
        { key: "grnNo", row: 1 },
        { key: "grnDate", row: 1, right: true },
        { key: "inwNo", row: 2 },
        { key: "qtyReceived", row: 3 },
        { key: "containerNo", row: 3, right: true },
        { key: "manufacturer", row: 4, lines: 2 },
        { key: "supplier", row: 5, lines: 2 },
        { key: "batchNo", row: 6 },
        { key: "mfgDate", row: 7, col: 0 },
        { key: "expiryDate", row: 7, col: 1 },
        { key: "netWeight", row: 7, col: 2 },
        { key: "preparedBy", row: 8, noValue: true, center: true }
    ];
    var ROW_COUNT = 9;
    var DATE_COLS = 3;
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

        var dotPt = PT_PER_INCH / dpi;
        var snap = function (n) { return Math.round(n / dotPt) * dotPt; };

        // Barcode anchored at the bottom; "Prepared by" sits just above it (user: keep the three together) and the
        // field rows share the height above evenly
        var hrPt = pt(TYPE.humanReadable);
        var hrTop = H - BARCODE.bottomPad * k - hrPt;
        var barH = snap(BARCODE.barH * k);
        var barTop = snap(hrTop - BARCODE.hrGap * k - barH);
        var ruleEnd = snap(barTop - GAP * k);

        var capPt = pt(TYPE.caption);
        var valPt = pt(TYPE.value);
        var firstTop = BASE.ruleH.y * sy + ROWS.padTop * k;
        var dateExtra = capPt * LH + ROWS.dateGap * k;
        var rows = {
            firstTop: firstTop,                                  // top of the first row's value text
            lastBaseline: ruleEnd - ROWS.padBottom * k,          // baseline of "Prepared by"
            dateGap: ROWS.dateGap * k
        };
        // One-line rows need at least the line height + GAP between baselines
        var pitch = (rows.lastBaseline - firstTop - valPt * ASCENT - dateExtra) / (ROW_COUNT - 1);
        if (pitch < valPt * LH + GAP) { throw new Error("Label size too small for the quarantine label layout"); }

        // Left strip: QUARANTINE then the form number, rotated 90 degrees counter-clockwise (read bottom to top),
        // normal width (user decision 2026-10-27: x1.5 stretch removed); shrunk only if longer than the strip.
        var qPt = pt(TYPE.quarantine);
        var fPt = pt(TYPE.formNumber);
        var qBand = edge;
        var fBand = qBand + EM * qPt + STRIP_GAP;
        if (fBand + EM * fPt > X(BASE.ruleV.x) - STRIP_GAP) { throw new Error("Label too narrow for the strip texts"); }

        // One vertical centre axis for the title, "Prepared by", the barcode and its number: middle of the content
        var axis = (X(BASE.captionX) + W - edge) / 2;
        return {
            key: size.key, dpi: dpi, axis: axis, dotPt: dotPt, ruleW: RULE_DOTS * dotPt, edge: edge, sx: sx, sy: sy,
            page: { wPt: W, hPt: H },
            // Rules run edge to edge (vertical top to bottom, horizontal to the right edge; user request 2026-10-27
            // "lines not 100% fit"); the vertical rule passes left of the barcode quiet zone; the horizontal rule
            // starts exactly on the vertical one
            ruleV: { x: X(BASE.ruleV.x), y0: 0, y1: H },
            ruleH: { y: BASE.ruleH.y * sy, x0: X(BASE.ruleV.x), x1: W },
            title: { x0: X(BASE.captionX), x1: W - edge, top: BASE.titleTop * sy, pt: pt(TYPE.title) },
            strip: {
                center: H / 2, length: H - 2 * edge, hScale: 1, // centred on the full-height side rule
                quarantine: { band: qBand, pt: qPt },
                formNumber: { band: fBand, pt: fPt }
            },
            content: { x0: X(BASE.captionX), x1: W - edge, valueX: X(BASE.valueX) },
            type: { caption: capPt, value: valPt },
            rows: rows,
            barcode: { x0: X(BASE.barcodeX), right: X(BASE.content.x1), top: barTop, h: barH, hrTop: hrTop, hrPt: hrPt }
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
        // Module chosen for the measured barcode span; the symbol is then centred on the label axis, on a printer dot
        var avail = L.barcode.right - Math.round(L.barcode.x0 / L.dotPt) * L.dotPt;
        for (var dots = target; dots >= minDots; dots--) {
            var m = dots * L.dotPt;
            if (g.total * m <= avail + 1e-9) {
                var x0 = Math.round((L.axis - g.total * m / 2) / L.dotPt) * L.dotPt;
                return { x0: x0, modulePt: m, moduleDots: dots, totalModules: g.total, widthPt: g.total * m, bars: g.bars };
            }
        }
        throw Object.assign(new Error("Barcode value '" + sValue + "' is too long for the label: " + g.total + " modules need "
            + (g.total * minDots * L.dotPt).toFixed(1) + " pt at the minimum module (" + BARCODE.minModuleMm + " mm), "
            + avail.toFixed(1) + " pt available."), { code: "barcodeTooLong" });
    }

    /**
     * Field geometry for one label row: x columns from the caption widths, then fitted texts, then baselines.
     * Caption and value share a baseline; a second value line takes space only when used; the rows share the
     * remaining height evenly. Returns [{key, row, caption:{text,x,y,pt,end}, value:{x,y,end,pt,lines}|null}].
     */
    function placeFields(L, row, texts, warnings) {
        var C = L.content;
        var capPt = L.type.caption;
        var valPt = L.type.value;
        var capW = function (k) { return widthPt((row.captions && row.captions[k]) || texts[k], capPt, true); };
        // Right-hand pairs share one caption column, as far right as their widest expected value allows
        var rightX = C.x1 - Math.max.apply(null, Object.keys(RIGHT_RESERVE).map(function (k) {
            return capW(k) + GAP + widthPt(RIGHT_RESERVE[k], valPt, false);
        }));
        var leftEnd = rightX - GAP;
        if (C.valueX + widthPt(LEFT_RESERVE.grnNo, valPt, false) > leftEnd + 1e-9) {
            throw new Error("Label too narrow for the GRN row at " + valPt + " pt");
        }
        var colW = (C.x1 - C.x0) / DATE_COLS;

        var fields = FIELDS.map(function (d) {
            var cx;
            var vx;
            var vEnd;
            var cEnd;
            if (d.col !== undefined) {
                cx = vx = C.x0 + d.col * colW;
                vEnd = cEnd = d.col < DATE_COLS - 1 ? cx + colW - GAP : C.x1;
            } else if (d.right) {
                cx = rightX;
                vx = rightX + capW(d.key) + GAP;
                vEnd = C.x1;
                cEnd = vx - GAP + 0.01; // the column is sized from this caption's own width; allow float rounding
            } else {
                cx = C.x0;
                vx = C.valueX;
                vEnd = FIELDS.some(function (o) { return o.right && o.row === d.row; }) ? leftEnd : C.x1;
                cEnd = vx - GAP;
            }
            var sCaption = (row.captions && row.captions[d.key]) || texts[d.key];
            var c = fitText(sCaption, cEnd - cx, capPt, 1, true);
            if (c.truncated) { warnings.push({ code: "truncated", field: d.key + ".caption" }); }
            var v = null;
            if (!d.noValue) {
                var s = row[d.key] == null ? "" : String(row[d.key]).trim();
                var r = s ? fitText(s, vEnd - vx, valPt, d.lines || 1, false) : { pt: valPt, lines: [], truncated: false };
                if (r.truncated) { warnings.push({ code: "truncated", field: d.key }); }
                v = { x: vx, end: vEnd, pt: r.pt, lines: r.lines };
            }
            if (d.center) { cx = L.axis; } // centred caption (no value): drawn with align center
            return { key: d.key, row: d.row, col: d.col, caption: { text: c.lines[0] || "", x: cx, end: cEnd, pt: c.pt, align: d.center ? "center" : "left" }, value: v };
        });

        // Extra height per row beyond one line: wrapped value lines; the date row prints values under the captions
        var extra = [];
        for (var i = 0; i < ROW_COUNT; i++) { extra.push(0); }
        fields.forEach(function (f) {
            if (f.col !== undefined) {
                extra[f.row] = Math.max(extra[f.row], capPt * LH + L.rows.dateGap);
            } else if (f.value && f.value.lines.length > 1) {
                extra[f.row] = Math.max(extra[f.row], (f.value.lines.length - 1) * f.value.pt * LH);
            }
        });
        var first = L.rows.firstTop + valPt * ASCENT;
        var total = extra.reduce(function (a, b) { return a + b; }, 0) - extra[ROW_COUNT - 1];
        var pitch = (L.rows.lastBaseline - first - total) / (ROW_COUNT - 1);
        var base = [first];
        for (var j = 1; j < ROW_COUNT; j++) { base.push(base[j - 1] + extra[j - 1] + pitch); }

        fields.forEach(function (f) {
            f.caption.y = base[f.row];
            if (f.value) { f.value.y = f.col !== undefined ? base[f.row] + capPt * LH + L.rows.dateGap : base[f.row]; }
        });
        fields.pitch = pitch;
        return fields;
    }

    /**
     * Draw list for one label row: items {kind:"rule",x,y,w,h} | {kind:"bar",x,y,w,h} |
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

        // Rules as filled bars on the printer dot grid, whole dots thick; the horizontal one starts at the vertical
        // one's outer edge so the corner is solid
        var snap = function (n) { return Math.round(n / L.dotPt) * L.dotPt; };
        var vx = snap(L.ruleV.x - L.ruleW / 2);
        var vy = snap(L.ruleV.y0);
        items.push({ kind: "rule", x: vx, y: vy, w: L.ruleW, h: snap(L.ruleV.y1) - vy });
        items.push({ kind: "rule", x: vx, y: snap(L.ruleH.y - L.ruleW / 2), w: snap(L.ruleH.x1) - vx, h: L.ruleW });

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

        var fields = placeFields(L, row, texts, warnings);
        fields.forEach(function (fd) {
            items.push({ kind: "text", text: fd.caption.text, x: fd.caption.x, y: fd.caption.y, pt: fd.caption.pt, bold: true, align: fd.caption.align });
            if (!fd.value) { return; }
            fd.value.lines.forEach(function (line, i) {
                items.push({ kind: "text", text: line, x: fd.value.x, y: fd.value.y + i * fd.value.pt * LH, pt: fd.value.pt, bold: false, align: "left" });
            });
        });

        var code = row.barcode == null ? "" : String(row.barcode).trim();
        var geo = null;
        if (code) {
            geo = barcodeGeometry(L, code);
            geo.bars.forEach(function (b) { items.push({ kind: "bar", x: geo.x0 + b.x * geo.modulePt, y: L.barcode.top, w: b.w * geo.modulePt, h: L.barcode.h }); });
            // Human-readable number centred under the bars (quiet zones excluded)
            var barsW = (geo.totalModules - 20) * geo.modulePt;
            var hr = fitText(code, barsW, L.barcode.hrPt, 1, false);
            text(hr.lines[0], geo.x0 + geo.widthPt / 2, L.barcode.hrTop, hr.pt, false, { align: "center" });
        } else {
            warnings.push({ code: "barcodeMissing", field: "barcode" });
        }
        return { items: items, warnings: warnings, barcode: geo, fields: fields };
    }

    return {
        SIZES: SIZES, DEFAULT_SIZE: DEFAULT_SIZE, PRINTER_DPI: PRINTER_DPI, ALLOWED_DPI: ALLOWED_DPI, PT_PER_INCH: PT_PER_INCH,
        MM_PER_INCH: MM_PER_INCH, MIN_PT: MIN_PT, GAP: GAP, ASCENT: ASCENT, LH: LH, EM: EM, BARCODE: BARCODE, BASE: BASE,
        FIELDS: FIELDS, STATIC_KEYS: STATIC_KEYS, CAPTION_KEYS: CAPTION_KEYS, EXTRA_KEYS: EXTRA_KEYS,
        layout: layout, fitText: fitText, barcodeGeometry: barcodeGeometry, render: render, widthPt: widthPt
    };
});
