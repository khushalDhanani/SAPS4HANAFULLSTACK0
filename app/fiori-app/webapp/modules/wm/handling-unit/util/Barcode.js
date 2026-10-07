sap.ui.define([], function () {
    "use strict";

    // Code 128 element widths (bar,space,bar,space,bar,space) for symbols 0-105; 106 = stop (7 elements).
    var PATTERNS = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 " +
        "113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 " +
        "212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 " +
        "133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 " +
        "111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 " +
        "134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 " +
        "114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(" ");
    var START_B = 104;
    var START_C = 105;
    var CODE_B = 100; // switch-to-Code-B symbol (used inside Code C for a trailing odd digit)
    var STOP = 106;
    var MODULE_MM = 0.4;
    var HEIGHT_MM = 15;
    var QUIET = 10;

    /**
     * Code 128 symbol values for a text: start, data, checksum, stop.
     * All-digit strings use subset C (two digits per symbol, ~half the modules → wider bars); an odd trailing
     * digit switches to Code B for that one digit. Any non-digit content uses subset B throughout.
     */
    function encode(sText) {
        var s = String(sText === undefined || sText === null ? "" : sText);
        if (!s) {
            throw new Error("Barcode text is empty");
        }
        var aValues = [];
        var nStart;
        if (/^\d+$/.test(s) && s.length >= 2) {
            nStart = START_C;
            var nEven = s.length - (s.length % 2); // digits encoded as Code C pairs
            for (var i = 0; i < nEven; i += 2) {
                aValues.push(Number(s.substr(i, 2)));
            }
            if (s.length % 2 === 1) { // trailing odd digit: switch to Code B for it
                aValues.push(CODE_B);
                aValues.push(s.charCodeAt(s.length - 1) - 32);
            }
        } else {
            nStart = START_B;
            for (var j = 0; j < s.length; j++) {
                var nCode = s.charCodeAt(j);
                if (nCode < 32 || nCode > 126) {
                    throw new Error("Barcode text contains a character outside Code 128 B: " + s.charAt(j));
                }
                aValues.push(nCode - 32);
            }
        }
        var nSum = nStart;
        aValues.forEach(function (v, idx) { nSum += v * (idx + 1); });
        return [nStart].concat(aValues, [nSum % 103, STOP]);
    }

    /** Bar geometry in module units: { total, bars:[{x,w}] } with 10-module quiet zones. Shared by toSvg and the PDF renderer. */
    function bars(sText) {
        var aSymbols = encode(sText);
        var aBars = [];
        var x = QUIET;
        aSymbols.forEach(function (v) {
            var sPattern = PATTERNS[v];
            for (var i = 0; i < sPattern.length; i++) {
                var w = Number(sPattern.charAt(i));
                if (i % 2 === 0) { aBars.push({ x: x, w: w }); }
                x += w;
            }
        });
        return { total: x + QUIET, bars: aBars };
    }

    /**
     * Inline SVG of the barcode: one <rect> per bar, 10-module quiet zones. Sized in mm for scanners.
     * wMm/hMm override the default (module width 0.4mm, height 15mm); preserveAspectRatio="none" stretches
     * the modules to exactly fill wMm, so on-page narrow-bar width = wMm / total modules.
     */
    function toSvg(sText, wMm, hMm) {
        var o = bars(sText);
        var aRects = o.bars.map(function (b) { return '<rect x="' + b.x + '" y="0" width="' + b.w + '" height="1"/>'; });
        var sW = (wMm === undefined || wMm === null) ? (o.total * MODULE_MM).toFixed(1) : wMm;
        var sH = (hMm === undefined || hMm === null) ? HEIGHT_MM : hMm;
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + o.total + ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" ' +
            'width="' + sW + 'mm" height="' + sH + 'mm" fill="#000">' + aRects.join("") + "</svg>";
    }

    return { encode: encode, toSvg: toSvg, bars: bars };
});
