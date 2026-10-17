sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (Barcode) {
    "use strict";

    // Single source of truth for label sizes. One geometry + type spec (mm positions, pt fonts, weights)
    // feeds BOTH the HTML print builder and the jsPDF renderer, so the two outputs are identical.
    var MM2PT = 72 / 25.4; // pdfinfo reports pt; a <w>x<h> mm page prints as (w*MM2PT)x(h*MM2PT) pt
    var PT2MM = 25.4 / 72;
    var SINGLE_LH = 1.1;   // line box factor for single-line fields (HU number, meta, caption)
    var GAP_MIN = 0.8;     // minimum gap between stacked blocks (mm)
    var GAP_TIGHT = 1.0;   // the HU number hugs the barcode (human-readable line stays with its code)

    // Printer config — single source of truth for dot snapping. A Code 128 narrow bar must be a WHOLE number of
    // printer dots or the printer rounds each bar unevenly and distorts the bar/space ratios (cheap scanners fail).
    var TARGET_DPI = 203;  // thermal printer resolution; allowed 203 or 300 (change here only, never hard-code dpi)
    var DOT_MM = 25.4 / TARGET_DPI;          // one printer dot in mm
    var MIN_DOTS = { A: 3, B: 3, E: 3, C: 3, D: 4 }; // minimum whole dots per narrow bar for a reliable scan

    // Explicit per-size TYPE SCALE (pt + weight). Deliberate 4-level hierarchy, same order on every size:
    //   L1 HU number (bold) > L2 material (bold) > L3 meta values (regular) >= L4 captions (bold uppercase).
    // Sizes scale with the usable text AREA (width via barcode/geometry choices, height via the stack model),
    // not height alone: D/C get visibly larger type than B/E; D has the largest HU number. Pure #000 only
    // (thermal printers dither gray). Invariants enforced in huLabelLayout.test.js:
    //   HU/material >= 1.25 (A) / 1.4 (B,E,C,D); material/meta >= 1.15; floor 6pt (6 only on A meta);
    //   captions >= 6.5pt where shown.
    var TYPE = {
        A: { huNumber: { pt: 9, weight: "bold" }, material: { pt: 7, weight: "bold", lh: 1.15 }, meta: { pt: 6, weight: "normal" }, caption: { pt: 0, weight: "bold" } },
        B: { huNumber: { pt: 14, weight: "bold" }, material: { pt: 10, weight: "bold", lh: 1.15 }, meta: { pt: 8, weight: "normal" }, caption: { pt: 6.5, weight: "bold" } },
        E: { huNumber: { pt: 20, weight: "bold" }, material: { pt: 13, weight: "bold", lh: 1.15 }, meta: { pt: 10, weight: "normal" }, caption: { pt: 7.5, weight: "bold" } },
        C: { huNumber: { pt: 26, weight: "bold" }, material: { pt: 14, weight: "bold", lh: 1.15 }, meta: { pt: 11, weight: "normal" }, caption: { pt: 8, weight: "bold" } },
        D: { huNumber: { pt: 36, weight: "bold" }, material: { pt: 16, weight: "bold", lh: 1.15 }, meta: { pt: 12, weight: "normal" }, caption: { pt: 8.5, weight: "bold" } }
    };

    // Baked per-size geometry (mm). barcodeH is the protected vertical anchor (STEP 3). yTop positions are
    // COMPUTED by the stack model in layout(); only the fixed budget inputs live here.
    var GEOM = {
        A: { widthMm: 50, heightMm: 25, pad: 1.5, showCaptions: false, materialLines: 1, barcodeH: 10, minBarMm: 0.25, nextLarger: "B" },
        B: { widthMm: 100, heightMm: 50, pad: 3, showCaptions: true, materialLines: 2, barcodeH: 18, minBarMm: 0.25, nextLarger: "C" },
        C: { widthMm: 150, heightMm: 100, pad: 5, showCaptions: true, materialLines: 3, barcodeH: 37, minBarMm: 0.33, nextLarger: "D" },
        D: { widthMm: 200, heightMm: 100, pad: 5, showCaptions: true, materialLines: 2, barcodeH: 45, minBarMm: 0.40, nextLarger: null },
        // E Square 100x100: same width class as B (barcode narrower than C), so a too-dense barcode points at C.
        E: { widthMm: 100, heightMm: 100, pad: 5, showCaptions: true, materialLines: 3, barcodeH: 37, minBarMm: 0.25, nextLarger: "C" }
    };

    var ORDER = ["A", "B", "E", "C", "D"];
    var DEFAULT = "B";

    // Helvetica Core-14 advance widths (1000-unit em) for ASCII 32-126. Arial is metric-compatible, so the
    // SAME table drives both the HTML (Arial) and PDF (Helvetica) wrap/measure -> identical line breaks.
    var AFM_REG = ("278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 " +
        "556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 " +
        "722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 " +
        "833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584").split(" ").map(Number);
    var AFM_BOLD = ("278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 " +
        "556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 " +
        "667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 " +
        "611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584").split(" ").map(Number);

    function round2(n) { return Math.round(n * 2) / 2; } // nearest 0.5pt
    function byKey(key) { return GEOM[key] ? key : DEFAULT; }

    /** Text advance width in mm for a pt size and weight, using the shared Helvetica/Arial metrics. */
    function measureMm(sText, pt, bBold) {
        var t = String(sText == null ? "" : sText);
        var tbl = bBold ? AFM_BOLD : AFM_REG;
        var units = 0;
        for (var i = 0; i < t.length; i++) {
            var c = t.charCodeAt(i) - 32;
            units += (c >= 0 && c < tbl.length) ? tbl[c] : 556; // 556 = digit/avg width for anything off-table
        }
        return (units / 1000) * pt * PT2MM;
    }

    /** Longest prefix of sText that fits wMm at (pt, weight), with "…" appended, or sText unchanged when it fits. */
    function ellipsize(sText, wMm, pt, bBold) {
        var s = String(sText == null ? "" : sText);
        if (!s || measureMm(s, pt, bBold) <= wMm) { return s; }
        while (s.length > 1 && measureMm(s + "…", pt, bBold) > wMm) { s = s.slice(0, -1); }
        return s + "…";
    }

    /**
     * Greedy word-wrap to at most maxLines lines of width wMm at (pt, weight). Words longer than the line are
     * broken by character; the last line is ellipsized when content is truncated. Font is NEVER shrunk here.
     * Shared by both renderers so print and PDF break identically. @returns {{lines:string[], truncated:boolean}}
     */
    function wrap(sText, wMm, pt, maxLines, bBold) {
        var s = String(sText == null ? "" : sText).replace(/\s+/g, " ").trim();
        if (!s) { return { lines: [], truncated: false }; }
        var tokens = s.split(" ");
        var lines = [];
        var cur = "";
        var i = 0;
        while (i < tokens.length && lines.length < maxLines) {
            var word = tokens[i];
            var trial = cur ? cur + " " + word : word;
            if (measureMm(trial, pt, bBold) <= wMm) { cur = trial; i++; continue; }
            if (cur) { lines.push(cur); cur = ""; continue; }  // flush the line, retry the word fresh
            var n = word.length;                                // word alone too wide: hard-break by char
            while (n > 1 && measureMm(word.slice(0, n), pt, bBold) > wMm) { n--; }
            lines.push(word.slice(0, n));
            tokens[i] = word.slice(n);
            if (!tokens[i]) { i++; }
        }
        if (cur && lines.length < maxLines) { lines.push(cur); cur = ""; i = tokens.length; }
        var truncated = (i < tokens.length) || (cur !== "");
        if (truncated && lines.length) {
            lines[lines.length - 1] = ellipsize(lines[lines.length - 1] + "…", wMm, pt, bBold); // force a trailing "…"
        }
        return { lines: lines, truncated: truncated };
    }

    /** Serial value with the size's prefix (e.g. "SR " on caption-less A), unless it already starts with it. */
    function srNoText(L, sr) {
        var p = L.meta.srNoPrefix;
        if (!p || !sr) { return sr; }
        return String(sr).toUpperCase().indexOf(p.trim().toUpperCase()) === 0 ? sr : p + sr;
    }

    /**
     * Actual HU-number font size: nominal, shrunk toward 70% of nominal (floor 6.5pt) to fit usableMm, never
     * below. fits=false when it overflows even at the floor (the barcode/digits are NEVER shrunk or truncated).
     * @returns {{pt:number, fits:boolean}}
     */
    function huNumberPt(huNumber, nominalPt, usableMm) {
        var floor = Math.max(6.5, round2(nominalPt * 0.7));
        var pt = nominalPt;
        while (pt > floor && measureMm(huNumber, pt, true) > usableMm) { pt = round2(pt - 0.5); }
        return { pt: pt, fits: measureMm(huNumber, pt, true) <= usableMm };
    }

    /** Geometry + type spec for a size (key string or a size object). Positions/dimensions mm; fonts pt. */
    function layout(sizeOrKey) {
        var key = byKey(typeof sizeOrKey === "string" ? sizeOrKey : (sizeOrKey && sizeOrKey.key));
        var g = GEOM[key];
        var t = TYPE[key];
        var innerW = g.widthMm - 2 * g.pad;
        var innerH = g.heightMm - 2 * g.pad;

        // --- Stack model: material, barcode, HU number, meta top-to-bottom; reserve max material lines so
        //     positions are stable regardless of data. Leftover is spread evenly into the two flexible gaps
        //     (material->barcode, HU->meta); the HU hugs the barcode with GAP_TIGHT; bottom slack = pad. ---
        var capLH = g.showCaptions && t.caption.pt ? t.caption.pt * PT2MM * SINGLE_LH : 0;
        var matLineH = t.material.pt * PT2MM * t.material.lh;
        var huLineH = t.huNumber.pt * PT2MM * SINGLE_LH;
        var metaLineH = t.meta.pt * PT2MM * SINGLE_LH;
        var matBlock = capLH + g.materialLines * matLineH;
        var huBlock = huLineH;
        var metaBlock = capLH + metaLineH;
        var used = matBlock + g.barcodeH + huBlock + metaBlock;
        var flex = Math.max(GAP_MIN, (innerH - used - GAP_TIGHT) / 2); // even flexible gap (>= GAP_MIN)

        var matCaptionY = g.showCaptions ? g.pad : null;
        var matValueY = g.pad + capLH;
        var barcodeYTop = g.pad + matBlock + flex;
        var huYTop = barcodeYTop + g.barcodeH + GAP_TIGHT;
        var metaTop = huYTop + huBlock + flex;
        var metaCaptionY = g.showCaptions ? metaTop : null;
        var metaValueY = metaTop + capLH;
        var bottomSlackMm = g.heightMm - (metaValueY + metaLineH); // content bottom -> page bottom

        return {
            key: key,
            page: { wMm: g.widthMm, hMm: g.heightMm },
            pad: g.pad, innerW: innerW, innerH: innerH,
            showCaptions: g.showCaptions,
            fonts: {
                huNumber: { pt: t.huNumber.pt, weight: t.huNumber.weight },
                material: { pt: t.material.pt, weight: t.material.weight, lh: t.material.lh },
                meta: { pt: t.meta.pt, weight: t.meta.weight },
                caption: { pt: t.caption.pt, weight: t.caption.weight }
            },
            material: { x: g.pad, captionY: matCaptionY, valueY: matValueY, w: innerW, maxLines: g.materialLines, lh: t.material.lh },
            barcode: { x: g.pad, yTop: barcodeYTop, w: innerW, h: g.barcodeH },
            huNumber: { yTop: huYTop, align: "center", usableMm: g.widthMm - 2 * g.pad },
            meta: {
                captionY: metaCaptionY, valueY: metaValueY,
                srNoPrefix: g.showCaptions ? "" : "SR ", // A has no caption -> label the serial so it is not a bare value
                date: { x: g.pad, align: "left" },
                srNo: { x: g.widthMm - g.pad, align: "right" }
            },
            minBarMm: g.minBarMm, nextLarger: g.nextLarger,
            // Exposed for tests: block rhythm (top-to-bottom) + gaps + bottom slack.
            stack: {
                blocks: [
                    { name: "material", yTop: g.pad, h: matBlock },
                    { name: "barcode", yTop: barcodeYTop, h: g.barcodeH },
                    { name: "huNumber", yTop: huYTop, h: huBlock },
                    { name: "meta", yTop: metaTop, h: metaBlock }
                ],
                gaps: [flex, GAP_TIGHT, flex], bottomSlackMm: bottomSlackMm
            }
        };
    }

    /**
     * Snap the barcode to whole printer dots: the widest narrow bar that is an integer number of dots and still
     * fits innerW, centered on a dot boundary so EVERY bar edge lands on a dot. Shared by both renderers so the
     * HTML print and the PDF use identical bar positions. @returns {{xMm, narrowMm, narrowDots, widthMm, dpi}}
     */
    function snapBarcode(L, totalModules) {
        var narrowDots = Math.floor(L.innerW / DOT_MM / totalModules);
        var narrowMm = narrowDots * DOT_MM;
        var widthMm = narrowMm * totalModules;               // <= innerW by construction
        var xDots = Math.round((L.pad + (L.innerW - widthMm) / 2) / DOT_MM); // centre, then snap the left edge to a dot
        return { xMm: xDots * DOT_MM, narrowMm: narrowMm, narrowDots: narrowDots, widthMm: widthMm, dpi: TARGET_DPI };
    }

    /**
     * Gate 1 scannability (dot-snapped) + Gate 2 HU-number fit. The barcode's snapped narrow bar must be at least
     * MIN_DOTS whole dots AND at least minBarMm; additionally the human-readable HU number must fit the content
     * width down to its 6.5pt floor. Digits/bars are never shrunk or truncated — too dense routes to nextLarger.
     * @returns {{ok:boolean, narrowMm:number, narrowDots:number, nextLarger:(string|null)}}
     */
    function fits(huNumber, sizeKey) {
        var L = layout(sizeKey);
        var total;
        try { total = Barcode.bars(String(huNumber)).total; } catch (e) { return { ok: false, narrowMm: 0, narrowDots: 0, nextLarger: L.nextLarger }; }
        var snap = snapBarcode(L, total);
        var barcodeOk = snap.narrowDots >= MIN_DOTS[L.key] && snap.narrowMm >= L.minBarMm;
        var huOk = huNumberPt(String(huNumber), L.fonts.huNumber.pt, L.huNumber.usableMm).fits;
        return { ok: barcodeOk && huOk, narrowMm: snap.narrowMm, narrowDots: snap.narrowDots, nextLarger: L.nextLarger };
    }

    return {
        SIZES: (function () { var m = {}; ORDER.forEach(function (k) { m[k] = { key: k, widthMm: GEOM[k].widthMm, heightMm: GEOM[k].heightMm, nameKey: "huSize" + k, descKey: "huSize" + k + "Desc" }; }); return m; })(),
        ORDER: ORDER, DEFAULT: DEFAULT, byKey: byKey, layout: layout, fits: fits,
        measureMm: measureMm, wrap: wrap, ellipsize: ellipsize, huNumberPt: huNumberPt, srNoText: srNoText,
        snapBarcode: snapBarcode, TARGET_DPI: TARGET_DPI, DOT_MM: DOT_MM, MIN_DOTS: MIN_DOTS,
        MM2PT: MM2PT, PT2MM: PT2MM
    };
});
