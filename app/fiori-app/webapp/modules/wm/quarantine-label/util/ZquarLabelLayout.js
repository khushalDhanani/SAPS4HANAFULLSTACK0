sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Barcode, HuLayout) {
    "use strict";

    // ZQUAR quarantine label, 4 x 6 in: supports two layout variants:
    // 1) TOP (default): centred company title, hairline, QUARANTINE title with SOP no. directly below, hairline, 15 single-field rows with 5% hairlines, barcode.
    // 2) VERTICAL: QUARANTINE and SOP no. on the left strip in vertical write-up (rotated 90° counter-clockwise), vertical rule, horizontal title rule, 15 single-field rows, barcode.
    var PT_PER_INCH = 72;
    var MM_PER_INCH = 25.4;
    var MM2PT = PT_PER_INCH / MM_PER_INCH;

    var VARIANTS = { TOP: "top", VERTICAL: "vertical" };
    var DEFAULT_VARIANT = VARIANTS.VERTICAL;

    // Page sizes in inches (source of truth; pt derived, so 4x6 is exactly 288 x 432 pt).
    var SIZES = { "4x6": { key: "4x6", widthIn: 4, heightIn: 6 } };
    var DEFAULT_SIZE = "4x6";
    // Printer resolution: 203 default, 300 allowed; the barcode module is a whole number of printer dots.
    var PRINTER_DPI = 203;
    var ALLOWED_DPI = [203, 300];

    // Design coordinates for vertical strip variant (pt)
    var BASE_V = {
        ruleV: { x: 36.7 },
        captionX: 38.8,
        barcodeX: 38.8
    };
    var EM = 0.925;          // Helvetica ascender + descender: band of rotated strip text
    var STRIP_GAP = 1.5;     // between the two strip texts and the rule
    var RULE_DOTS = 2;       // rule thickness in whole printer dots

    // 4 x 6 design sizes (pt); on other pages heights scale with the page height, fonts with the smaller page ratio,
    // never below MIN_PT.
    var DESIGN_PAGE = { w: 288, h: 432 };
    var TYPE = { title: 16, caption: 9, value: 10, quarantine: 18, formNumber: 9, humanReadable: 13 };
    var MIN_PT = 9;
    var MAX_LINES = 40;      // wrap limit for one value; far beyond what a label can hold (the label check fails first)
    var ROW_PAD = 1.8;        // glyph box (cap + descender) -> hairlines; a slot below glyph box + this is refused instead of overlapping
    var DESCENT = 0.21;      // Helvetica descender
    var LH = 1.15;           // line height of wrapped values
    var ASCENT = 0.79;       // text-box top -> baseline, measured in the sample (title, GRN No., barcode text: 0.789)
    var CAP_ASCENT = 0.718;  // Helvetica cap height
    var GAP = 4;             // minimum caption -> value
    var COL_GAP = 8;         // widest caption -> value column
    var SEP = { dots: 2, opacity: 0.05 }; // row hairlines: whole printer dots thick, 5 % black
    var EXTRA_EDGE_PT = 2 * 72 / 96; // extra 2 CSS px of breathing room inside the unchanged page
    var EDGE_MM = 4;         // safe margin on the page edge
    // Vertical design numbers (pt at 432): title top, hairline under the title, white space above QUARANTINE, QUARANTINE ->
    // SOP no., SOP no. -> second hairline, barcode bars, number gap/pad, last row -> bars
    var V = { titleTop: 14, titleRule: 34, quarGap: 8, sopGap: 5, sopRule: 4, barH: 100, hrGap: 3, bottomPad: 14, barGap: 6 };
    var BARCODE = { targetModuleMm: 0.5, minModuleMm: 0.375 };

    // One field per row, in label order (keys of the label row and of the caption texts)
    var FIELDS = [
        { key: "materialName", lines: 2 }, { key: "itemCode" }, { key: "grnNo" }, { key: "grnDate" }, { key: "inwNo" },
        { key: "inspectionLot" }, { key: "qtyReceived" },
        { key: "containerNo" }, { key: "manufacturer", lines: 2 }, { key: "supplier", lines: 2 }, { key: "batchNo" },
        { key: "mfgDate" }, { key: "expiryDate" }, { key: "netWeight" }, { key: "preparedBy" }
    ];
    var ROW_COUNT = FIELDS.length;
    var STATIC_KEYS = { title: "zqTitle", quarantine: "zqQuarantine", formNumber: "zqFormNumber" };
    // Texts used only for some rows (a row may replace a caption via row.captions[fieldKey])
    var EXTRA_KEYS = { retestDate: "zqRetestDate", materialCode: "zqMaterialCode", inspectionLotNo: "zqInspectionLotNo", inwBatchNo: "zqInwBatchNo", logo: "zqLogo" };
    var CAPTION_KEYS = {
        materialName: "zqMaterialName", itemCode: "zqItemCode", grnNo: "zqGrnNo", grnDate: "zqGrnDate", inwNo: "zqInwNo",
        inspectionLot: "zqInspectionLot", qtyReceived: "zqQtyReceived",
        containerNo: "zqContainerNo", manufacturer: "zqManufacturer", supplier: "zqSupplier", batchNo: "zqBatchNo",
        mfgDate: "zqMfgDate", expiryDate: "zqExpiryDate", netWeight: "zqNetWeight", preparedBy: "zqPreparedBy"
    };

    function widthPt(s, pt, bold) { return HuLayout.measureMm(s, pt, bold) * MM2PT; }
    function minSlot(pt) { return pt * (CAP_ASCENT + DESCENT) + ROW_PAD; }

    /** Numeric or padded material code "000000008000009753" -> "8000009753" (trim leading zeros, keep up to last 10 digits). */
    function formatMaterialCode(v) {
        var s = String(v == null ? "" : v).trim();
        if (!s) {
            return "";
        }
        if (/^\d+$/.test(s)) {
            var unpadded = s.replace(/^0+(?=\d)/, "");
            return unpadded.length > 10 ? unpadded.slice(-10) : unpadded;
        }
        return s;
    }
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
        var f = Math.min(W / DESIGN_PAGE.w, H / DESIGN_PAGE.h);
        var k = H / DESIGN_PAGE.h;
        var pt = function (n) { return Math.max(MIN_PT, n * f); };
        var edge = EDGE_MM * MM2PT + EXTRA_EDGE_PT;
        var dotPt = PT_PER_INCH / dpi;
        var snap = function (n) { return Math.round(n / dotPt) * dotPt; };

        var variant = (opts && opts.variant) || VARIANTS.TOP;
        if (variant === VARIANTS.VERTICAL) {
            var ruleVx = snap(BASE_V.ruleV.x * f);
            var titleRuleY = snap(V.titleRule * k + EXTRA_EDGE_PT);
            var qPtV = pt(14);
            var fPtV = pt(TYPE.formNumber);
            var qBand = edge;
            var fBand = qBand + EM * qPtV + STRIP_GAP;
            var hrPtV = pt(TYPE.humanReadable);
            var hrTopV = H - V.bottomPad * k - hrPtV - EXTRA_EDGE_PT;
            var barHV = snap(84 * k);
            var barTopV = snap(hrTopV - V.hrGap * k - barHV);
            var rowsTopV = titleRuleY + V.sopRule * k;
            var rowsEndV = barTopV - V.barGap * k;
            var valPtV = pt(TYPE.value);
            var slotV = (rowsEndV - rowsTopV) / ROW_COUNT;
            if (slotV < minSlot(valPtV)) { throw new Error("Label size too small for the quarantine label layout"); }
            var axisV = (ruleVx + W - edge) / 2;

            var barRightV = snap(edge + snap(178 * f));
            var barAxisV = (edge + barRightV) / 2;
            var logoLeftV = snap(barRightV + snap(6 * f));
            var logoRightV = snap(W - edge);
            var logoWV = logoRightV - logoLeftV;
            var logoHV = snap((hrTopV + hrPtV) - barTopV);

            return {
                key: size.key, variant: VARIANTS.VERTICAL, dpi: dpi, axis: axisV, dotPt: dotPt,
                sepW: SEP.dots * dotPt, ruleW: RULE_DOTS * dotPt, edge: edge,
                page: { wPt: W, hPt: H },
                ruleV: { x: ruleVx, y0: 0, y1: rowsEndV },
                ruleH: { y: titleRuleY, x0: ruleVx, x1: W },
                title: { x0: ruleVx, x1: W - edge, top: V.titleTop * k + EXTRA_EDGE_PT, pt: pt(TYPE.title), rule: titleRuleY },
                strip: {
                    center: rowsEndV / 2, length: rowsEndV - 2 * edge, hScale: 1,
                    quarantine: { band: qBand, pt: qPtV },
                    formNumber: { band: fBand, pt: fPtV }
                },
                content: { x0: ruleVx + GAP, x1: W - edge },
                type: { caption: pt(TYPE.caption), value: valPtV },
                rows: { top: rowsTopV, end: rowsEndV, slot: slotV },
                barcode: { x0: edge, right: barRightV, axis: barAxisV, top: barTopV, h: barHV, hrTop: hrTopV, hrPt: hrPtV },
                logo: { x: logoLeftV, y: barTopV, w: logoWV, h: logoHV, pt: pt(11) }
            };
        }

        // Top-down: title, hairline, QUARANTINE, SOP no., hairline; bottom-up: number, bars; rows fill the space between
        var hrPt = pt(TYPE.humanReadable);
        var hrTop = H - V.bottomPad * k - hrPt - EXTRA_EDGE_PT;
        var barH = snap(V.barH * k);
        var barTop = snap(hrTop - V.hrGap * k - barH);
        var qPt = pt(TYPE.quarantine);
        var fPt = pt(TYPE.formNumber);
        var titleRule = V.titleRule * k + EXTRA_EDGE_PT;
        var quarBase = titleRule + V.quarGap * k + CAP_ASCENT * qPt;
        var sopBase = quarBase + V.sopGap * k + CAP_ASCENT * fPt;
        var rowsTop = sopBase + (DESCENT * fPt) + V.sopRule * k;
        var rowsEnd = barTop - V.barGap * k;
        var valPt = pt(TYPE.value);
        var slot = (rowsEnd - rowsTop) / ROW_COUNT;
        if (slot < minSlot(valPt)) { throw new Error("Label size too small for the quarantine label layout"); }

        return {
            key: size.key, variant: VARIANTS.TOP, dpi: dpi, axis: W / 2, dotPt: dotPt, sepW: SEP.dots * dotPt, edge: edge,
            page: { wPt: W, hPt: H },
            title: { x0: edge, x1: W - edge, top: V.titleTop * k + EXTRA_EDGE_PT, pt: pt(TYPE.title), rule: titleRule },
            content: { x0: edge, x1: W - edge },
            type: { caption: pt(TYPE.caption), value: valPt },
            rows: { top: rowsTop, end: rowsEnd, slot: slot },
            quarantine: { y: quarBase, pt: qPt },
            formNumber: { y: sopBase, pt: fPt },
            barcode: { x0: edge, right: W - edge, top: barTop, h: barH, hrTop: hrTop, hrPt: hrPt }
        };
    }

    /**
     * Fits a text without ever cutting it (user decision 2026-10-27: every detail must print in full): wrap at pt
     * within maxLines; if more lines are needed, shrink toward MIN_PT; if still more, keep MIN_PT and use as many
     * lines as the text needs. Width in pt. Returns {pt, lines, truncated} (truncated only past MAX_LINES).
     */
    function fitText(s, wPt, pt, maxLines, bold) {
        var wMm = wPt / MM2PT;
        var floor = Math.min(MIN_PT, pt);
        for (var p = pt; p >= floor; p = half(p - 0.5)) {
            var r = HuLayout.wrap(s, wMm, p, maxLines, bold);
            if (!r.truncated) { return { pt: p, lines: r.lines, truncated: false }; }
            if (p === floor) { break; }
        }
        var all = HuLayout.wrap(s, wMm, floor, MAX_LINES, bold);
        return { pt: floor, lines: all.lines, truncated: all.truncated };
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
        var axis = (L.barcode && L.barcode.axis != null) ? L.barcode.axis : L.axis;
        for (var dots = target; dots >= minDots; dots--) {
            var m = dots * L.dotPt;
            if (g.total * m <= avail + 1e-9) {
                var x0 = Math.round((axis - g.total * m / 2) / L.dotPt) * L.dotPt;
                return { x0: x0, modulePt: m, moduleDots: dots, totalModules: g.total, widthPt: g.total * m, bars: g.bars };
            }
        }
        throw Object.assign(new Error("Barcode value '" + sValue + "' is too long for the label: " + g.total + " modules need "
            + (g.total * minDots * L.dotPt).toFixed(1) + " pt at the minimum module (" + BARCODE.minModuleMm + " mm), "
            + avail.toFixed(1) + " pt available."), { code: "barcodeTooLong" });
    }

    function tooFull(sField) {
        return Object.assign(new Error("The label details do not fit on one label" + (sField ? " (" + sField + ")" : "") + "."),
            { code: "labelTooFull", field: sField });
    }

    /**
     * Field geometry, one field per row: caption left, values in one column right of the widest caption. Caption and
     * value share a baseline; each row is vertically centred in its slot between two hairlines. Returns
     * [{key, row, caption:{text,x,y,pt,end,align}, value:{x,y,end,pt,lines}, slot:{y0,y1}}] (pitch = slot height of a
     * one-line row).
     */
    function placeFields(L, row, texts) {
        var C = L.content;
        var capPt = L.type.caption;
        var valPt = L.type.value;
        var capText = function (d) {
            return (row.captions && row.captions[d.key]) || texts[d.key]
                || (d.key === "itemCode" ? (texts.materialCode || texts.itemCode) : "")
                || (d.key === "inwNo" ? (texts.inwBatchNo || texts.inwNo) : "")
                || (d.key === "inspectionLot" ? (texts.inspectionLot || texts.inspectionLotNo) : "");
        };
        var valueX = C.x0 + Math.max.apply(null, FIELDS.map(function (d) { return widthPt(capText(d), capPt, true); })) + COL_GAP;

        var fields = FIELDS.map(function (d, i) {
            var c = fitText(capText(d), valueX - GAP - C.x0, capPt, 1, true);
            var rawVal = d.key === "itemCode" ? (row.itemCode != null && row.itemCode !== "" ? row.itemCode : row.materialCode)
                : (d.key === "inspectionLot" ? (row.inspectionLot != null && row.inspectionLot !== "" ? row.inspectionLot : row.InspectionLot) : row[d.key]);
            if (d.key === "itemCode" && rawVal) {
                rawVal = formatMaterialCode(rawVal);
            }
            var s = rawVal == null ? "" : String(rawVal).trim();
            if (!s) {
                s = "-";
            }
            // Every value may wrap (never cut); d.lines = lines allowed before shrinking
            var r = fitText(s, C.x1 - valueX, valPt, d.lines || 1, false);
            if (r.truncated) { throw tooFull(d.key); }
            return {
                key: d.key, row: i,
                caption: { text: c.lines[0] || "", x: C.x0, end: valueX - GAP, pt: c.pt, align: "left" },
                value: { x: valueX, end: C.x1, pt: r.pt, lines: r.lines }
            };
        });

        // Extra slot height beyond one line: wrapped value lines; the rest of the block is shared evenly
        var extra = fields.map(function (f) { return Math.max(0, f.value.lines.length - 1) * f.value.pt * LH; });
        var pitch = (L.rows.end - L.rows.top - extra.reduce(function (a, b) { return a + b; }, 0)) / ROW_COUNT;
        // Too much text for one label: refuse it (named by ZquarLabelPdf) rather than overlap or cut anything
        if (pitch < minSlot(valPt)) { throw tooFull(); }
        var y = L.rows.top;
        fields.forEach(function (f, i) {
            var h = pitch + extra[i];
            var block = (CAP_ASCENT + DESCENT) * f.value.pt + extra[i]; // full glyph box (cap to descender)
            f.slot = { y0: y, y1: y + h };
            f.caption.y = f.value.y = y + (h - block) / 2 + CAP_ASCENT * f.value.pt;
            y += h;
        });
        fields.pitch = pitch;
        return fields;
    }

    /**
     * Draw list for one label: items {kind:"sep",x,y,w,h,opacity} | {kind:"bar",x,y,w,h} |
     * {kind:"text",text,x,y(baseline),pt,bold,align}. texts: static texts + captions (STATIC_KEYS, CAPTION_KEYS).
     */
    function render(L, row, texts) {
        Object.keys(STATIC_KEYS).concat(Object.keys(CAPTION_KEYS)).forEach(function (kk) {
            if (!texts || !texts[kk]) { throw new Error("Missing label text: " + (STATIC_KEYS[kk] || CAPTION_KEYS[kk])); }
        });
        var items = [];
        var warnings = [];
        var snap = function (n) { return Math.round(n / L.dotPt) * L.dotPt; };
        function centered(s, y, p, bold) {
            var t = fitText(s, L.content.x1 - L.content.x0, p, 1, bold);
            items.push({ kind: "text", text: t.lines[0], x: L.axis, y: y, pt: t.pt, bold: bold, align: "center" });
        }
        function sep(y) {
            items.push({ kind: "sep", x: snap(L.content.x0), y: snap(y - L.sepW / 2), w: snap(L.content.x1) - snap(L.content.x0), h: L.sepW, opacity: SEP.opacity });
        }

        if (L.variant === VARIANTS.VERTICAL) {
            var vx = snap(L.ruleV.x - L.ruleW / 2);
            var vy = snap(L.ruleV.y0);
            items.push({ kind: "rule", x: vx, y: vy, w: L.ruleW, h: snap(L.ruleV.y1) - vy });
            items.push({ kind: "rule", x: vx, y: snap(L.ruleH.y - L.ruleW / 2), w: snap(L.page.wPt) - vx, h: L.ruleW });

            var tV = fitText(texts.title, L.title.x1 - L.title.x0, L.title.pt, 1, true);
            items.push({ kind: "text", text: tV.lines[0], x: L.axis, y: L.title.top + tV.pt * ASCENT, pt: tV.pt, bold: true, align: "center" });

            // Strip texts: QUARANTINE and SOP no. rotated 90 degrees counter-clockwise
            [["quarantine", true], ["formNumber", false]].forEach(function (e) {
                var S = L.strip[e[0]];
                var len = widthPt(texts[e[0]], S.pt, e[1]);
                var hScale = Math.min(L.strip.hScale, L.strip.length / len);
                items.push({
                    kind: "text", text: texts[e[0]], x: S.band + CAP_ASCENT * S.pt, y: L.strip.center + len * hScale / 2,
                    pt: S.pt, bold: e[1], align: "left", angle: 90, hScale: hScale, len: len * hScale, band: [S.band, S.band + EM * S.pt]
                });
            });

            var fieldsV = placeFields(L, row, texts);
            sep(L.rows.top);
            fieldsV.forEach(function (fd) {
                items.push({ kind: "text", text: fd.caption.text, x: fd.caption.x, y: fd.caption.y, pt: fd.caption.pt, bold: true, align: "left" });
                fd.value.lines.forEach(function (line, i) {
                    items.push({ kind: "text", text: line, x: fd.value.x, y: fd.value.y + i * fd.value.pt * LH, pt: fd.value.pt, bold: false, align: "left" });
                });
                if (fd.row < ROW_COUNT - 1) { sep(fd.slot.y1); }
            });

            var codeV = row.barcode == null ? "" : String(row.barcode).trim();
            var geoV = null;
            if (codeV) {
                geoV = barcodeGeometry(L, codeV);
                geoV.bars.forEach(function (b) { items.push({ kind: "bar", x: geoV.x0 + b.x * geoV.modulePt, y: L.barcode.top, w: b.w * geoV.modulePt, h: L.barcode.h }); });
                var barsWV = (geoV.totalModules - 20) * geoV.modulePt;
                var hrV = fitText(codeV, barsWV, L.barcode.hrPt, 1, false);
                items.push({ kind: "text", text: hrV.lines[0], x: geoV.x0 + geoV.widthPt / 2, y: L.barcode.hrTop + hrV.pt * ASCENT, pt: hrV.pt, bold: false, align: "center" });
            } else {
                warnings.push({ code: "barcodeMissing", field: "barcode" });
            }

            if (L.logo) {
                var logoLineWidth = snap(SEP.dots * L.dotPt);
                items.push({ kind: "box", x: L.logo.x, y: L.logo.y, w: L.logo.w, h: L.logo.h, lineWidth: logoLineWidth });
                var sLogo = (texts && texts.logo) || "LOGO";
                var logoPt = (L.logo && L.logo.pt) || 11;
                var logoText = fitText(sLogo, L.logo.w - 8, logoPt, 1, true);
                var logoY = L.logo.y + (L.logo.h + CAP_ASCENT * logoText.pt) / 2;
                items.push({ kind: "text", text: logoText.lines[0], x: L.logo.x + L.logo.w / 2, y: logoY, pt: logoText.pt, bold: true, align: "center" });
            }

            return { items: items, warnings: warnings, barcode: geoV, fields: fieldsV };
        }

        var t = fitText(texts.title, L.title.x1 - L.title.x0, L.title.pt, 1, true);
        items.push({ kind: "text", text: t.lines[0], x: L.axis, y: L.title.top + t.pt * ASCENT, pt: t.pt, bold: true, align: "center" });

        sep(L.title.rule);
        centered(texts.quarantine, L.quarantine.y, L.quarantine.pt, true);
        centered(texts.formNumber, L.formNumber.y, L.formNumber.pt, false);
        var fields = placeFields(L, row, texts);
        sep(L.rows.top);
        fields.forEach(function (fd) {
            items.push({ kind: "text", text: fd.caption.text, x: fd.caption.x, y: fd.caption.y, pt: fd.caption.pt, bold: true, align: "left" });
            fd.value.lines.forEach(function (line, i) {
                items.push({ kind: "text", text: line, x: fd.value.x, y: fd.value.y + i * fd.value.pt * LH, pt: fd.value.pt, bold: false, align: "left" });
            });
            if (fd.row < ROW_COUNT - 1) { sep(fd.slot.y1); } // none after the last row: white space before the barcode
        });

        var code = row.barcode == null ? "" : String(row.barcode).trim();
        var geo = null;
        if (code) {
            geo = barcodeGeometry(L, code);
            geo.bars.forEach(function (b) { items.push({ kind: "bar", x: geo.x0 + b.x * geo.modulePt, y: L.barcode.top, w: b.w * geo.modulePt, h: L.barcode.h }); });
            // Human-readable number centred under the bars (quiet zones excluded)
            var barsW = (geo.totalModules - 20) * geo.modulePt;
            var hr = fitText(code, barsW, L.barcode.hrPt, 1, false);
            items.push({ kind: "text", text: hr.lines[0], x: geo.x0 + geo.widthPt / 2, y: L.barcode.hrTop + hr.pt * ASCENT, pt: hr.pt, bold: false, align: "center" });
        } else {
            warnings.push({ code: "barcodeMissing", field: "barcode" });
        }
        return { items: items, warnings: warnings, barcode: geo, fields: fields };
    }

    return {
        SIZES: SIZES, DEFAULT_SIZE: DEFAULT_SIZE, VARIANTS: VARIANTS, DEFAULT_VARIANT: DEFAULT_VARIANT,
        PRINTER_DPI: PRINTER_DPI, ALLOWED_DPI: ALLOWED_DPI, PT_PER_INCH: PT_PER_INCH,
        MM_PER_INCH: MM_PER_INCH, MIN_PT: MIN_PT, GAP: GAP, ASCENT: ASCENT, LH: LH, BARCODE: BARCODE, SEP: SEP,
        FIELDS: FIELDS, STATIC_KEYS: STATIC_KEYS, CAPTION_KEYS: CAPTION_KEYS, EXTRA_KEYS: EXTRA_KEYS,
        layout: layout, fitText: fitText, barcodeGeometry: barcodeGeometry, render: render, widthPt: widthPt,
        formatMaterialCode: formatMaterialCode
    };
});
