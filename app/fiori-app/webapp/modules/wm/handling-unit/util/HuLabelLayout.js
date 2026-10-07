sap.ui.define([
    "saps4hana/fiori/modules/wm/handling-unit/util/Barcode"
], function (Barcode) {
    "use strict";

    // Single source of truth for label sizes. One geometry spec (mm positions, pt fonts) feeds BOTH the HTML
    // print builder and the jsPDF renderer, so the two outputs are identical. Replaces the old fixed 4x4 label.
    var MM2PT = 72 / 25.4; // pdfinfo reports pt; a <w>x<h> mm page prints as (w*MM2PT)x(h*MM2PT) pt

    // Font ratios: pt per mm of label HEIGHT (so a custom size interpolates); 6pt hard floor applied in fontPt().
    var R = {
        A: { caption: 0, material: 0.24, huNumber: 0.32, meta: 0.24 },
        B: { caption: 0.12, material: 0.18, huNumber: 0.26, meta: 0.18 },
        C: { caption: 0.07, material: 0.11, huNumber: 0.18, meta: 0.11 },
        D: { caption: 0.07, material: 0.11, huNumber: 0.32, meta: 0.09 }, // D: big distance-reading HU number
        E: { caption: 0.07, material: 0.11, huNumber: 0.18, meta: 0.11 } // E: square, same vertical scale as C
    };

    // Baked per-size geometry (mm). yTop values are the top of each block; captions sit at *.yTop / meta.captionY.
    var GEOM = {
        A: { widthMm: 50, heightMm: 25, pad: 1.5, showCaptions: false, materialYTop: 1.5, materialLines: 1, barcodeYTop: 5, barcodeH: 10, huNumberYTop: 15.5, metaCaptionY: null, metaValueY: 19, minBarMm: 0.25, nextLarger: "B" },
        B: { widthMm: 100, heightMm: 50, pad: 3, showCaptions: true, materialYTop: 6, materialLines: 2, barcodeYTop: 16, barcodeH: 18, huNumberYTop: 35, metaCaptionY: 42, metaValueY: 44, minBarMm: 0.25, nextLarger: "C" },
        C: { widthMm: 150, heightMm: 100, pad: 5, showCaptions: true, materialYTop: 9, materialLines: 3, barcodeYTop: 27, barcodeH: 37, huNumberYTop: 66, metaCaptionY: 77, metaValueY: 81, minBarMm: 0.33, nextLarger: "D" },
        D: { widthMm: 200, heightMm: 100, pad: 5, showCaptions: true, materialYTop: 9, materialLines: 2, barcodeYTop: 23, barcodeH: 45, huNumberYTop: 69, metaCaptionY: 83, metaValueY: 86, minBarMm: 0.40, nextLarger: null },
        // E Square 100x100: same width class as B (innerW 90), so a barcode too dense for it points at C (wider), not back to B.
        E: { widthMm: 100, heightMm: 100, pad: 5, showCaptions: true, materialYTop: 9, materialLines: 3, barcodeYTop: 27, barcodeH: 37, huNumberYTop: 66, metaCaptionY: 77, metaValueY: 81, minBarMm: 0.25, nextLarger: "C" }
    };

    var ORDER = ["A", "B", "E", "C", "D"];
    var DEFAULT = "B";

    // i18n-ready size descriptors for the picker dialog.
    var SIZES = {};
    ORDER.forEach(function (k) {
        SIZES[k] = { key: k, widthMm: GEOM[k].widthMm, heightMm: GEOM[k].heightMm, nameKey: "huSize" + k, descKey: "huSize" + k + "Desc" };
    });

    function byKey(key) { return GEOM[key] ? key : DEFAULT; }
    function round2(n) { return Math.round(n * 2) / 2; } // nearest 0.5pt
    function fontPt(key, field, heightMm) { var r = R[key][field]; return r ? Math.max(6, round2(heightMm * r)) : 0; }

    /** Geometry spec for a size (key string or a size object). Positions/dimensions in mm; fonts in pt. */
    function layout(sizeOrKey) {
        var key = byKey(typeof sizeOrKey === "string" ? sizeOrKey : (sizeOrKey && sizeOrKey.key));
        var g = GEOM[key];
        var innerW = g.widthMm - 2 * g.pad;
        var innerH = g.heightMm - 2 * g.pad;
        return {
            key: key,
            page: { wMm: g.widthMm, hMm: g.heightMm },
            pad: g.pad, innerW: innerW, innerH: innerH,
            showCaptions: g.showCaptions,
            fonts: {
                caption: fontPt(key, "caption", g.heightMm),
                material: fontPt(key, "material", g.heightMm),
                huNumber: fontPt(key, "huNumber", g.heightMm),
                meta: fontPt(key, "meta", g.heightMm)
            },
            material: { x: g.pad, yTop: g.materialYTop, w: innerW, maxLines: g.materialLines, lineHeightFactor: 1.15 },
            barcode: { x: g.pad, yTop: g.barcodeYTop, w: innerW, h: g.barcodeH },
            huNumber: { yTop: g.huNumberYTop, align: "center" },
            meta: {
                captionY: g.metaCaptionY, valueY: g.metaValueY,
                date: { x: g.pad, align: "left" },
                srNo: { x: g.widthMm - g.pad, align: "right" } // right edge of the content area
            },
            minBarMm: g.minBarMm, nextLarger: g.nextLarger
        };
    }

    /**
     * Gate 1 scannability: the barcode always fills innerW, so narrow-bar width = innerW / totalModules.
     * An HU whose narrow bar would fall below the size's minimum cannot be printed scannably at that size.
     * @returns {{ok:boolean, narrowMm:number, nextLarger:(string|null)}}
     */
    function fits(huNumber, sizeKey) {
        var L = layout(sizeKey);
        var total;
        try { total = Barcode.bars(String(huNumber)).total; } catch (e) { return { ok: false, narrowMm: 0, nextLarger: L.nextLarger }; }
        var narrow = L.barcode.w / total;
        return { ok: narrow >= L.minBarMm, narrowMm: narrow, nextLarger: L.nextLarger };
    }

    return { SIZES: SIZES, ORDER: ORDER, DEFAULT: DEFAULT, byKey: byKey, layout: layout, fits: fits, MM2PT: MM2PT };
});
