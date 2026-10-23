/**
 * QrCode.js — Compact QR Code generator (byte mode, ECC level M, versions 1–10).
 * Produces an inline SVG string. No external dependencies.
 *
 * Public API:
 *   QrCode.toSvg(text, opts?)  → SVG string
 *     opts.size   : rendered pixel size per module (default 4)
 *     opts.quiet  : quiet-zone modules (default 4)
 *     opts.fg     : foreground color (default "#000000")
 *     opts.bg     : background color (default "#ffffff")
 *
 * Limitations (sufficient for HU numbers):
 *   - UTF-8 byte mode only (works for all printable ASCII HU numbers)
 *   - Error correction level M (≥15% recovery)
 *   - Versions 1–10 (up to 154 bytes at M; HU numbers are ≤20 chars)
 */
sap.ui.define([], function () {
    "use strict";

    // ─── Reed-Solomon GF(256) with primitive polynomial x^8+x^4+x^3+x^2+1 ─────

    var GF_SIZE = 256;
    var GF_EXP = new Array(GF_SIZE * 2);
    var GF_LOG = new Array(GF_SIZE);
    (function () {
        var x = 1;
        for (var i = 0; i < GF_SIZE; i++) {
            GF_EXP[i] = x; GF_EXP[i + GF_SIZE] = x; GF_LOG[x] = i;
            x = x << 1; if (x & 256) { x ^= 285; } x &= 255;
        }
    })();

    function gfMul(a, b) {
        if (!a || !b) { return 0; }
        return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
    }
    function gfPow(a, p) {
        return GF_EXP[(GF_LOG[a] * p) % 255];
    }

    function rsGenPoly(n) {
        var p = [1];
        for (var i = 0; i < n; i++) {
            var pn = new Array(p.length + 1);
            var ai = gfPow(2, i);
            pn[0] = 0;
            for (var j = 0; j < p.length; j++) {
                pn[j] ^= gfMul(p[j], ai);
                pn[j + 1] = p[j];
            }
            p = pn;
        }
        return p.reverse();
    }

    function rsEncode(data, n) {
        var gen = rsGenPoly(n);
        var msg = data.concat(new Array(n).fill(0));
        for (var i = 0; i < data.length; i++) {
            var c = msg[i];
            if (!c) { continue; }
            for (var j = 0; j < gen.length; j++) {
                msg[i + j] ^= gfMul(gen[j], c);
            }
        }
        return msg.slice(data.length);
    }

    // ─── Version / capacity tables (byte mode, ECC M) ────────────────────────────
    // [version-1]: { capacity, ecWords, blocks: [{count, dataWords, ecWords}] }
    // Derived from ISO 18004-2015 Table 9 and Table 14.
    var VER_M = [
        { cap: 11,  ecw: 10, bl: [{ c: 1, dw: 11, ew: 10 }] },                          // v1
        { cap: 20,  ecw: 16, bl: [{ c: 1, dw: 20, ew: 16 }] },                          // v2
        { cap: 32,  ecw: 26, bl: [{ c: 1, dw: 32, ew: 26 }] },                          // v3
        { cap: 64,  ecw: 18, bl: [{ c: 2, dw: 24, ew: 18 }] },                          // v4
        { cap: 86,  ecw: 24, bl: [{ c: 2, dw: 43, ew: 24 }] },                          // v5
        { cap: 108, ecw: 16, bl: [{ c: 4, dw: 27, ew: 16 }] },                          // v6
        { cap: 124, ecw: 18, bl: [{ c: 4, dw: 31, ew: 18 }] },                          // v7
        { cap: 154, ecw: 22, bl: [{ c: 2, dw: 38, ew: 22 }, { c: 2, dw: 39, ew: 22 }] }, // v8
        { cap: 182, ecw: 22, bl: [{ c: 3, dw: 36, ew: 20 }, { c: 2, dw: 37, ew: 20 }] }, // v9
        { cap: 255, ecw: 26, bl: [{ c: 4, dw: 43, ew: 24 }, { c: 1, dw: 44, ew: 24 }] }  // v10
    ];

    function pickVersion(byteLen) {
        for (var i = 0; i < VER_M.length; i++) {
            if (VER_M[i].cap >= byteLen) { return i + 1; }
        }
        throw new Error("QR: text too long for versions 1-10 (max 255 bytes, ECC M)");
    }

    // ─── Bit stream builder ───────────────────────────────────────────────────────
    function BitStream() { this._data = []; this._len = 0; }
    BitStream.prototype.push = function (val, bits) {
        for (var i = bits - 1; i >= 0; i--) {
            var byteIdx = this._len >> 3;
            if (this._data.length <= byteIdx) { this._data.push(0); }
            if ((val >> i) & 1) { this._data[byteIdx] |= 1 << (7 - (this._len & 7)); }
            this._len++;
        }
    };
    BitStream.prototype.bytes = function () { return this._data; };
    BitStream.prototype.length = function () { return this._len; };

    // ─── Data codeword builder ────────────────────────────────────────────────────
    var PAD1 = 0xEC, PAD2 = 0x11;

    function buildData(text, version) {
        var vinfo = VER_M[version - 1];
        var bytes = [];
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            // UTF-8 encode for multi-byte chars (HU numbers are ASCII only so typically just one byte each)
            if (c < 0x80) {
                bytes.push(c);
            } else if (c < 0x800) {
                bytes.push(0xC0 | (c >> 6));
                bytes.push(0x80 | (c & 0x3F));
            } else {
                bytes.push(0xE0 | (c >> 12));
                bytes.push(0x80 | ((c >> 6) & 0x3F));
                bytes.push(0x80 | (c & 0x3F));
            }
        }
        var ccBits = version < 10 ? 8 : 16;
        var bs = new BitStream();
        bs.push(0x4, 4);           // mode: byte
        bs.push(bytes.length, ccBits);
        for (var j = 0; j < bytes.length; j++) { bs.push(bytes[j], 8); }
        bs.push(0, 4);             // terminator
        // byte-align
        while (bs.length() % 8) { bs.push(0, 1); }
        // compute total data capacity (all blocks combined)
        var totalDataWords = 0;
        vinfo.bl.forEach(function (b) { totalDataWords += b.c * b.dw; });
        var raw = bs.bytes();
        var pad = 0;
        while (raw.length < totalDataWords) { raw.push(pad === 0 ? PAD1 : PAD2); pad ^= 1; }
        return raw;
    }

    // ─── Interleave data + EC codewords ──────────────────────────────────────────
    function buildCodewords(data, version) {
        var vinfo = VER_M[version - 1];
        var dbBlocks = [], ecBlocks = [];
        var offset = 0;
        vinfo.bl.forEach(function (b) {
            for (var i = 0; i < b.c; i++) {
                var slice = data.slice(offset, offset + b.dw);
                dbBlocks.push(slice);
                ecBlocks.push(rsEncode(slice, b.ew));
                offset += b.dw;
            }
        });
        var result = [];
        // interleave data codewords
        var maxDw = Math.max.apply(null, dbBlocks.map(function (b) { return b.length; }));
        for (var di = 0; di < maxDw; di++) {
            dbBlocks.forEach(function (b) { if (di < b.length) { result.push(b[di]); } });
        }
        // interleave EC codewords
        var maxEw = Math.max.apply(null, ecBlocks.map(function (b) { return b.length; }));
        for (var ei = 0; ei < maxEw; ei++) {
            ecBlocks.forEach(function (b) { if (ei < b.length) { result.push(b[ei]); } });
        }
        return result;
    }

    // ─── Matrix helpers ───────────────────────────────────────────────────────────
    function makeMatrix(size) {
        var m = [];
        for (var i = 0; i < size; i++) { m.push(new Int8Array(size).fill(-1)); } // -1 = unfilled
        return m;
    }

    function setBlock(m, r, c, pattern) {
        for (var i = 0; i < pattern.length; i++) {
            for (var j = 0; j < pattern[i].length; j++) {
                m[r + i][c + j] = pattern[i][j];
            }
        }
    }

    // Finder pattern (7x7 including border)
    var FINDER = [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 1],
        [1, 0, 1, 1, 1, 0, 1],
        [1, 0, 1, 1, 1, 0, 1],
        [1, 0, 1, 1, 1, 0, 1],
        [1, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1]
    ];

    // Alignment pattern (5x5)
    var ALIGN = [
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 1, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1]
    ];

    // Alignment pattern center positions (for versions 2+)
    var ALIGN_POS = [
        [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
        [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
    ];

    function placeFinderPatterns(m, size) {
        // TL, TR, BL
        [[0, 0], [0, size - 7], [size - 7, 0]].forEach(function (rc) {
            setBlock(m, rc[0], rc[1], FINDER);
        });
        // Separators + format info area cleared (set to 0 so they stay reserved)
        // Row/col separators
        for (var i = 0; i <= 7; i++) {
            if (m[7][i] < 0)  { m[7][i] = 0; }
            if (m[i][7] < 0)  { m[i][7] = 0; }
            if (m[7][size - 1 - i] < 0) { m[7][size - 1 - i] = 0; }
            if (m[i][size - 8] < 0)     { m[i][size - 8] = 0; }
            if (m[size - 8][i] < 0)     { m[size - 8][i] = 0; }
            if (m[size - 1 - i][7] < 0) { m[size - 1 - i][7] = 0; }
        }
    }

    function placeAlignmentPatterns(m, version) {
        var pos = ALIGN_POS[version - 1];
        if (!pos || pos.length < 2) { return; }
        for (var a = 0; a < pos.length; a++) {
            for (var b = 0; b < pos.length; b++) {
                var r = pos[a] - 2, c = pos[b] - 2;
                if (m[r + 2][c + 2] >= 0) { continue; } // overlaps finder: skip
                setBlock(m, r, c, ALIGN);
            }
        }
    }

    function placeTimingPatterns(m, size) {
        for (var i = 8; i < size - 8; i++) {
            if (m[6][i] < 0) { m[6][i] = (i & 1) === 0 ? 1 : 0; }
            if (m[i][6] < 0) { m[i][6] = (i & 1) === 0 ? 1 : 0; }
        }
    }

    function placeDarkModule(m, version) {
        m[4 * version + 9][8] = 1;
    }

    function reserveFormatArea(m, size) {
        // Format info strips (2 copies), set to 0 as placeholder
        for (var i = 0; i <= 8; i++) {
            if (m[8][i] < 0) { m[8][i] = 0; }
            if (m[i][8] < 0) { m[i][8] = 0; }
            if (m[8][size - 1 - i] < 0) { m[8][size - 1 - i] = 0; }
            if (m[size - 1 - i][8] < 0) { m[size - 1 - i][8] = 0; }
        }
    }

    // ─── Data placement (zigzag) ──────────────────────────────────────────────────
    function placeData(m, size, bits) {
        var bitIdx = 0;
        var col = size - 1;
        var goUp = true;
        while (col > 0) {
            if (col === 6) { col--; } // skip timing column
            var rows = goUp
                ? (function () { var a = []; for (var r = size - 1; r >= 0; r--) { a.push(r); } return a; }())
                : (function () { var a = []; for (var r = 0; r < size; r++) { a.push(r); } return a; }());
            rows.forEach(function (r) {
                for (var dc = 0; dc < 2; dc++) {
                    var c = col - dc;
                    if (m[r][c] < 0) {
                        m[r][c] = (bitIdx < bits.length) ? bits[bitIdx++] : 0;
                    }
                }
            });
            col -= 2;
            goUp = !goUp;
        }
    }

    function codewordsToBits(codewords) {
        var bits = [];
        for (var i = 0; i < codewords.length; i++) {
            var b = codewords[i];
            for (var j = 7; j >= 0; j--) { bits.push((b >> j) & 1); }
        }
        return bits;
    }

    // ─── Masking (ISO 18004 Table 10) ─────────────────────────────────────────────
    var MASK_FNS = [
        function (r, c) { return (r + c) % 2 === 0; },
        function (r)    { return r % 2 === 0; },
        function (r, c) { return c % 3 === 0; },   // eslint-disable-line no-unused-vars
        function (r, c) { return (r + c) % 3 === 0; },
        function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
        function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
        function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
        function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
    ];

    function applyMask(m, size, maskId) {
        var fn = MASK_FNS[maskId];
        var out = m.map(function (row) { return row.slice(); });
        for (var r = 0; r < size; r++) {
            for (var c = 0; c < size; c++) {
                if (m[r][c] === 0 || m[r][c] === 1) {
                    // Only mask data modules (value 0 or 1); fixed patterns stay fixed
                    // We track fixed modules by having set them ≥ 0 before data placement
                    // — actually by this point everything is 0/1; use a separate isFixed matrix
                }
            }
        }
        // Re-implement with fixed-module tracking via the original matrix
        for (var rr = 0; rr < size; rr++) {
            for (var cc = 0; cc < size; cc++) {
                if (m[rr][cc] >= 2) { continue; } // reserved (won't appear; placeholder)
                out[rr][cc] ^= (fn(rr, cc) ? 1 : 0);
            }
        }
        return out;
    }

    function penaltyScore(m, size) {
        var p = 0;
        // Rule 1: 5+ consecutive same-color modules in row/col
        function runRule(arr) {
            var prev = -1, run = 0;
            arr.forEach(function (v) {
                if (v === prev) { run++; } else { run = 1; prev = v; }
                if (run === 5) { p += 3; } else if (run > 5) { p++; }
            });
        }
        for (var r = 0; r < size; r++) {
            runRule(Array.from(m[r]));
            runRule(m.map(function (row) { return row[r]; }));
        }
        // Rule 2: 2x2 blocks
        for (var i = 0; i < size - 1; i++) {
            for (var j = 0; j < size - 1; j++) {
                var v = m[i][j];
                if (m[i][j + 1] === v && m[i + 1][j] === v && m[i + 1][j + 1] === v) { p += 3; }
            }
        }
        // Rule 4: proportion of dark modules
        var dark = 0, total = size * size;
        for (var rr = 0; rr < size; rr++) { for (var cc = 0; cc < size; cc++) { if (m[rr][cc]) { dark++; } } }
        var pct = dark / total * 100;
        p += Math.abs(Math.floor(pct / 5) * 5 - 50) / 5 * 10;
        return p;
    }

    function selectBestMask(m, size, isFixed) {
        var best = -1, bestScore = Infinity, bestMask = 0;
        for (var k = 0; k < 8; k++) {
            var masked = applyMaskWithFixed(m, size, k, isFixed);
            writeFormatInfo(masked, size, k);
            var s = penaltyScore(masked, size);
            if (s < bestScore) { bestScore = s; bestMask = k; best = k; }
        }
        void best;
        return bestMask;
    }

    function applyMaskWithFixed(m, size, maskId, isFixed) {
        var fn = MASK_FNS[maskId];
        var out = m.map(function (row) { return row.slice(); });
        for (var r = 0; r < size; r++) {
            for (var c = 0; c < size; c++) {
                if (!isFixed[r][c]) { out[r][c] ^= fn(r, c) ? 1 : 0; }
            }
        }
        return out;
    }

    // ─── Format information ────────────────────────────────────────────────────────
    var FORMAT_M_MASK = [
        0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0 // ECC M, masks 0-7
    ];

    function writeFormatInfo(m, size, maskId) {
        var fmt = FORMAT_M_MASK[maskId];
        var bits = [];
        for (var i = 14; i >= 0; i--) { bits.push((fmt >> i) & 1); }
        // Format around TL finder
        var tl = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 7];
        var tlc = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
        // copy1: horizontal (row 8, cols 0-8) + vertical (rows 0-8, col 8)
        for (var j = 0; j < 6; j++) { m[8][j] = bits[j]; }
        m[8][7] = bits[6]; m[8][8] = bits[7]; m[7][8] = bits[8];
        for (var k = 9; k < 15; k++) { m[14 - k][8] = bits[k]; }
        // copy2: bottom-left + top-right
        for (var l = 0; l < 7; l++) { m[size - 1 - l][8] = bits[l]; }
        for (var n = 7; n < 15; n++) { m[8][size - 15 + n] = bits[n]; }
        void tl; void tlc; // keep linter quiet
    }

    // ─── Main encode function ──────────────────────────────────────────────────────
    function encode(text) {
        if (!text || !text.length) { throw new Error("QR: text is empty"); }
        var byteLen = 0;
        for (var ci = 0; ci < text.length; ci++) {
            var cp = text.charCodeAt(ci);
            if (cp < 0x80) { byteLen++; }
            else if (cp < 0x800) { byteLen += 2; }
            else { byteLen += 3; }
        }
        var version = pickVersion(byteLen);
        var size = version * 4 + 17;
        var m = makeMatrix(size);
        placeFinderPatterns(m, size);
        placeAlignmentPatterns(m, version);
        placeTimingPatterns(m, size);
        placeDarkModule(m, version);
        reserveFormatArea(m, size);

        // Mark fixed modules for mask exclusion
        var isFixed = [];
        for (var i = 0; i < size; i++) {
            isFixed.push([]);
            for (var j = 0; j < size; j++) { isFixed[i].push(m[i][j] >= 0); }
        }

        var data = buildData(text, version);
        var codewords = buildCodewords(data, version);
        var bits = codewordsToBits(codewords);
        placeData(m, size, bits);

        // Mask remaining -1s (shouldn't exist after placement) to 0
        for (var r = 0; r < size; r++) {
            for (var c = 0; c < size; c++) { if (m[r][c] < 0) { m[r][c] = 0; } }
        }

        var bestMask = selectBestMask(m, size, isFixed);
        var final = applyMaskWithFixed(m, size, bestMask, isFixed);
        writeFormatInfo(final, size, bestMask);

        return { matrix: final, size: size };
    }

    // ─── SVG renderer ─────────────────────────────────────────────────────────────
    function toSvg(text, opts) {
        opts = opts || {};
        var px   = opts.size  || 4;
        var quiet = opts.quiet !== undefined ? opts.quiet : 4;
        var fg   = opts.fg   || "#000000";
        var bg   = opts.bg   || "#ffffff";
        var qr   = encode(text);
        var m    = qr.matrix;
        var n    = qr.size;
        var total = (n + 2 * quiet) * px;
        var rects = [];
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (m[r][c]) {
                    rects.push('<rect x="' + ((c + quiet) * px) + '" y="' + ((r + quiet) * px) + '" width="' + px + '" height="' + px + '"/>');
                }
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
            'width="' + total + '" height="' + total + '" ' +
            'viewBox="0 0 ' + total + ' ' + total + '" ' +
            'shape-rendering="crispEdges">' +
            '<rect width="' + total + '" height="' + total + '" fill="' + bg + '"/>' +
            '<g fill="' + fg + '">' + rects.join("") + '</g>' +
            '</svg>';
    }

    return { toSvg: toSvg, encode: encode };
});
