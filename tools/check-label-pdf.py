#!/usr/bin/env python3
"""
Acceptance check for the 4 x 6 in ZQUAR quarantine label PDF (spec: docs/abap/zmm_af_017_4x6-spec.md, section 3).

Local only: no SAP, no network, standard library only. Measures a PDF -- page size, fonts, every text box with
position and size, row pitch, caption/value baseline per row, the barcode (bar count, height, narrow bar, quiet
zones, Code 128 decode) -- and reports PASS/FAIL against the spec with the measured numbers.

    python3 tools/check-label-pdf.py label.pdf [--page N] [--json] [--mask] [--dpi 203]

--mask prints value texts as shapes (digits -> 9, letters -> A) so a real PDF can be checked without showing values.
Never commit a PDF with real values; test PDFs must be synthetic.
Exit code: 0 = PASS, 1 = FAIL, 2 = the PDF could not be read.
"""
import json
import math
import re
import sys
import zlib

PT_PER_MM = 72 / 25.4

# ---- Spec (mm, origin top-left, "top" = baseline - ASCENT x size) ---------------------------------------------
SPEC = {
    'page_pt': (288.0, 432.0), 'page_tol_pt': 1.0,
    'strip': {'x0': 0.0, 'x1': 12.7, 'center_y': 56.0, 'center_tol': 2.0},
    'rule_v': {'x': 12.9, 'y0': 0.0, 'y1': 112.0, 'tol': 0.5, 'len_tol': 1.5},
    'rule_h': {'y': 18.0, 'x0': 13.7, 'x1': 96.7, 'tol': 0.5, 'len_tol': 1.5},
    'content': (13.7, 96.7),
    'title': {'text': 'Aether Industries Limited', 'pt': 18.0, 'top': 4.5},
    'caption_pt': 10.0, 'value_pt': 10.0, 'min_pt': 9.0, 'size_tol': 0.25,
    'x_tol': 0.5, 'top_tol': 1.0, 'baseline_tol_pt': 0.5, 'gap_pt': 4.0, 'margin_mm': 4.0,
    # caption text, caption x, value x, top, value lines
    'rows': [
        ('Material Name', 13.7, 39.1, 21.0, 2), ('GRN No.', 13.7, 39.1, 33.0, 1), ('GRN Date', 60.2, 78.1, 33.0, 1),
        ('INW. No', 13.7, 39.1, 40.5, 1), ('Qty. Received', 13.7, 39.1, 48.0, 1), ('Container No', 57.6, 81.2, 48.0, 1),
        ('Manufacturer', 13.7, 39.1, 55.5, 2), ('Supplier', 13.7, 39.1, 66.5, 2), ('Batch No', 13.7, 39.1, 77.5, 1),
    ],
    # date columns: caption, x, header top, value top
    'columns': [('Mfg. Date', 13.7, 86.0, 91.5), ('Expiry Date', 39.1, 86.0, 91.5), ('Net Weight', 66.0, 86.0, 91.5)],
    'alt_captions': {'Expiry Date': ['Retest Date']},
    'blank': ('Prepared by', 13.7, 102.0),
    'strip_texts': ['QUARANTINE', 'F-06-01-SOP-WH-002-04/04/202'],
    'alt_strip_texts': {'F-06-01-SOP-WH-002-04/04/202': ['F-06-00-SOP-WH-002-01/09/2016']},
    'barcode': {'top': 117.0, 'height': 22.0, 'module': 0.5, 'module_tol': 0.03, 'module_min': 0.375, 'quiet': 5.0,
                'pos_tol': 0.5, 'subset': 'B', 'hr_pt': 13.0, 'hr_gap_max': 3.0, 'hr_center_tol': 1.0},
}
ASCENT = 0.789  # baseline offset of the text-box top, measured on the current SAP label

# Helvetica / Helvetica-Bold advance widths (ASCII 32..126), for standard fonts without /Widths
AFM = {
    False: [int(x) for x in (
        '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 '
        '584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 '
        '667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 '
        '278 556 500 722 500 500 500 334 260 334 584').split()],
    True: [int(x) for x in (
        '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 '
        '584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 '
        '667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 '
        '333 611 556 778 556 556 500 389 280 389 584').split()],
}
# Code 128 element widths for symbol values 0..106 (106 = stop, 7 elements)
C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 '
        '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 '
        '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 '
        '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 '
        '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
        '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 '
        '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split()


# ---- PDF reading ----------------------------------------------------------------------------------------------
class Ref:
    def __init__(self, n):
        self.n = n

    def __repr__(self):
        return f'R{self.n}'


class Name(str):
    pass


class Lexer:
    """Tokenizer for PDF objects and content streams."""
    DELIM = b'()<>[]{}/%'

    def __init__(self, data, pos=0):
        self.d = data
        self.i = pos

    def skip_ws(self):
        d = self.d
        while self.i < len(d):
            c = d[self.i]
            if c in b' \t\r\n\f\x00':
                self.i += 1
            elif c == 0x25:  # % comment
                while self.i < len(d) and d[self.i] not in b'\r\n':
                    self.i += 1
            else:
                break

    def token(self):
        self.skip_ws()
        d = self.d
        if self.i >= len(d):
            return None
        c = d[self.i:self.i + 1]
        if c == b'(':
            return ('str', self.literal())
        if d[self.i:self.i + 2] == b'<<':
            self.i += 2
            return ('<<', None)
        if d[self.i:self.i + 2] == b'>>':
            self.i += 2
            return ('>>', None)
        if c == b'<':
            j = d.index(b'>', self.i)
            h = re.sub(rb'\s', b'', d[self.i + 1:j])
            self.i = j + 1
            if len(h) % 2:
                h += b'0'
            return ('str', bytes.fromhex(h.decode('ascii')))
        if c in (b'[', b']', b'{', b'}'):
            self.i += 1
            return (c.decode(), None)
        if c == b'/':
            j = self.i + 1
            while j < len(d) and d[j] not in b' \t\r\n\f\x00' and d[j:j + 1] not in [bytes([x]) for x in self.DELIM]:
                j += 1
            name = re.sub(rb'#([0-9A-Fa-f]{2})', lambda m: bytes([int(m.group(1), 16)]), d[self.i + 1:j]).decode('latin1')
            self.i = j
            return ('name', Name(name))
        j = self.i
        while j < len(d) and d[j] not in b' \t\r\n\f\x00' and d[j:j + 1] not in [bytes([x]) for x in self.DELIM]:
            j += 1
        if j == self.i:
            j += 1
        w = d[self.i:j].decode('latin1')
        self.i = j
        if re.fullmatch(r'[+-]?(\d+\.?\d*|\.\d+)', w):
            return ('num', float(w))
        return ('kw', w)

    def literal(self):
        d = self.d
        self.i += 1
        out = bytearray()
        depth = 1
        while self.i < len(d):
            c = d[self.i]
            if c == 0x5C:  # backslash
                self.i += 1
                e = d[self.i]
                m = {ord('n'): 10, ord('r'): 13, ord('t'): 9, ord('b'): 8, ord('f'): 12}
                if e in m:
                    out.append(m[e])
                elif 0x30 <= e <= 0x37:
                    k = self.i
                    while k < self.i + 3 and k < len(d) and 0x30 <= d[k] <= 0x37:
                        k += 1
                    out.append(int(d[self.i:k], 8) & 0xFF)
                    self.i = k - 1
                elif e in b'\r\n':
                    if e == 13 and self.i + 1 < len(d) and d[self.i + 1] == 10:
                        self.i += 1
                else:
                    out.append(e)
            elif c == 0x28:
                depth += 1
                out.append(c)
            elif c == 0x29:
                depth -= 1
                if depth == 0:
                    self.i += 1
                    return bytes(out)
                out.append(c)
            else:
                out.append(c)
            self.i += 1
        return bytes(out)

    def obj(self, tok=None):
        """Parse one object (dict, array, ref, number, name, string, keyword)."""
        t = tok or self.token()
        if t is None:
            return None
        kind, v = t
        if kind == '<<':
            res = {}
            while True:
                k = self.token()
                if k is None or k[0] == '>>':
                    return res
                res[k[1]] = self.obj()
        if kind == '[':
            arr = []
            while True:
                t2 = self.token()
                if t2 is None or t2[0] == ']':
                    return arr
                arr.append(self.obj(t2))
        if kind == 'num':
            save = self.i
            t2 = self.token()
            if t2 and t2[0] == 'num':
                t3 = self.token()
                if t3 and t3 == ('kw', 'R'):
                    return Ref(int(v))
            self.i = save
            return v
        return v if kind != 'kw' else ('kw', v)


class Pdf:
    def __init__(self, data):
        self.d = data
        self.objs = {}
        self.streams = {}
        for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj\b', data):
            n = int(m.group(1))
            lx = Lexer(data, m.end())
            try:
                o = lx.obj()
            except Exception:
                continue
            self.objs[n] = o
            lx.skip_ws()
            if isinstance(o, dict) and data[lx.i:lx.i + 6] == b'stream':
                s = lx.i + 6
                if data[s:s + 2] == b'\r\n':
                    s += 2
                elif data[s:s + 1] in (b'\n', b'\r'):
                    s += 1
                length = self.get(o.get('Length'))
                if isinstance(length, (int, float)) and data[s + int(length):s + int(length) + 20].lstrip().startswith(b'endstream'):
                    raw = data[s:s + int(length)]
                else:
                    raw = data[s:data.index(b'endstream', s)]
                self.streams[n] = (o, raw)
        for n, (o, _) in list(self.streams.items()):
            if self.get(o.get('Type')) == 'ObjStm':
                self._objstm(n)

    def _objstm(self, n):
        o, _ = self.streams[n]
        data = self.stream(n)
        first = int(self.get(o['First']))
        nums = [int(x) for x in data[:first].split()]
        for k in range(0, len(nums), 2):
            on, off = nums[k], nums[k + 1]
            if on not in self.objs:
                self.objs[on] = Lexer(data, first + off).obj()

    def get(self, v):
        seen = 0
        while isinstance(v, Ref) and seen < 50:
            v = self.objs.get(v.n)
            seen += 1
        return v

    def stream(self, n_or_ref):
        n = n_or_ref.n if isinstance(n_or_ref, Ref) else n_or_ref
        o, raw = self.streams[n]
        filt = self.get(o.get('Filter'))
        filters = filt if isinstance(filt, list) else ([filt] if filt else [])
        for f in filters:
            f = self.get(f)
            if f == 'FlateDecode':
                raw = zlib.decompress(raw)
            elif f:
                raise ValueError(f'unsupported stream filter {f}')
        return raw

    def pages(self):
        root = self.get(self.get(self._trailer_root()))
        out = []

        def walk(node, inherited):
            node = self.get(node)
            inh = dict(inherited)
            for k in ('MediaBox', 'Resources', 'CropBox'):
                if k in node:
                    inh[k] = self.get(node[k])
            if self.get(node.get('Type')) == 'Pages':
                for kid in self.get(node['Kids']):
                    walk(kid, inh)
            else:
                out.append((node, inh))
        walk(root['Pages'], {})
        return out

    def _trailer_root(self):
        m = list(re.finditer(rb'/Root\s+(\d+)\s+\d+\s+R', self.d))
        if not m:
            raise ValueError('no /Root found')
        return Ref(int(m[-1].group(1)))


class Font:
    def __init__(self, pdf, fdict):
        f = pdf.get(fdict) or {}
        self.base = str(pdf.get(f.get('BaseFont')) or '?')
        if '+' in self.base:
            self.base = self.base.split('+', 1)[1]
        self.bold = bool(re.search(r'bold|black|heavy', self.base, re.I))
        self.two_byte = pdf.get(f.get('Subtype')) == 'Type0'
        self.first = int(pdf.get(f.get('FirstChar')) or 0)
        self.widths = [pdf.get(w) for w in (pdf.get(f.get('Widths')) or [])]
        self.cid_widths = {}
        if self.two_byte:
            desc = pdf.get((pdf.get(f.get('DescendantFonts')) or [None])[0]) or {}
            self.dw = pdf.get(desc.get('DW')) or 1000
            w = [pdf.get(x) for x in (pdf.get(desc.get('W')) or [])]
            i = 0
            while i < len(w):
                if i + 1 < len(w) and isinstance(w[i + 1], list):
                    for k, val in enumerate(w[i + 1]):
                        self.cid_widths[int(w[i]) + k] = pdf.get(val)
                    i += 2
                else:
                    for c in range(int(w[i]), int(w[i + 1]) + 1):
                        self.cid_widths[c] = w[i + 2]
                    i += 3
        self.cmap = {}
        tu = f.get('ToUnicode')
        if isinstance(tu, Ref) and tu.n in pdf.streams:
            self._parse_cmap(pdf.stream(tu).decode('latin1'))

    def _parse_cmap(self, s):
        def u(h):
            b = bytes.fromhex(h)
            return b.decode('utf-16-be', 'replace')
        for blk in re.findall(r'beginbfchar(.*?)endbfchar', s, re.S):
            for a, b in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>', blk):
                self.cmap[int(a, 16)] = u(b)
        for blk in re.findall(r'beginbfrange(.*?)endbfrange', s, re.S):
            for a, b, rest in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]*>)', blk):
                lo, hi = int(a, 16), int(b, 16)
                if rest.startswith('['):
                    for k, h in enumerate(re.findall(r'<([0-9A-Fa-f]*)>', rest)):
                        self.cmap[lo + k] = u(h)
                else:
                    start = int(rest[1:-1], 16)
                    width = len(rest[1:-1])
                    for c in range(lo, hi + 1):
                        self.cmap[c] = u(format(start + c - lo, f'0{width}x'))

    def codes(self, b):
        if self.two_byte:
            return [int.from_bytes(b[i:i + 2], 'big') for i in range(0, len(b) - 1, 2)]
        return list(b)

    def text(self, codes):
        return ''.join(self.cmap.get(c, chr(c) if not self.two_byte else '?') for c in codes)

    def width(self, code):
        if self.two_byte:
            return (self.cid_widths.get(code, self.dw)) / 1000
        if self.widths and 0 <= code - self.first < len(self.widths):
            return (self.widths[code - self.first] or 0) / 1000
        tbl = AFM[self.bold]
        return (tbl[code - 32] if 32 <= code <= 126 else 556) / 1000


def mul(a, b):
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def interpret(pdf, content, resources, ctm, out, depth=0):
    """Collect texts, stroked segments and filled rectangles in PDF user space (y up)."""
    res = pdf.get(resources) or {}
    fonts = pdf.get(res.get('Font')) or {}
    xobjs = pdf.get(res.get('XObject')) or {}
    lx = Lexer(content)
    stack = []
    gs = {'ctm': ctm, 'lw': 1.0}
    path = []
    cur = None
    ts = {'font': None, 'fs': 0, 'tc': 0, 'tw': 0, 'tz': 1, 'tl': 0, 'rise': 0}
    tm = lm = [1, 0, 0, 1, 0, 0]
    font_cache = {}
    ops = []
    while True:
        t = lx.token()
        if t is None:
            break
        kind, v = t
        if kind != 'kw':
            if kind in ('<<', '['):
                ops.append(lx.obj(t))
            else:
                ops.append(v)
            continue
        op = v
        a = ops
        ops = []
        if op == 'q':
            stack.append((dict(gs), dict(ts)))
        elif op == 'Q' and stack:
            gs, ts2 = stack.pop()
            ts.update(ts2)
        elif op == 'cm':
            gs['ctm'] = mul([float(x) for x in a[-6:]], gs['ctm'])
        elif op == 'w':
            gs['lw'] = float(a[-1])
        elif op == 'm':
            cur = (float(a[-2]), float(a[-1]))
            path.append(['m', cur])
        elif op == 'l':
            p = (float(a[-2]), float(a[-1]))
            path.append(['l', cur, p])
            cur = p
        elif op == 're':
            x, y, w, h = [float(z) for z in a[-4:]]
            path.append(['re', x, y, w, h])
        elif op in ('S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'):
            m = gs['ctm']
            for seg in path:
                if seg[0] == 'l' and op in ('S', 's', 'B', 'B*', 'b', 'b*'):
                    p0, p1 = apply(m, *seg[1]), apply(m, *seg[2])
                    scale = math.sqrt(abs(m[0] * m[3] - m[1] * m[2]))
                    out['segments'].append({'p0': p0, 'p1': p1, 'w': gs['lw'] * scale})
                elif seg[0] == 're':
                    x, y, w, h = seg[1:]
                    pts = [apply(m, x, y), apply(m, x + w, y + h)]
                    box = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
                    if op in ('f', 'F', 'f*', 'B', 'B*', 'b', 'b*'):
                        out['fills'].append(box)
                    elif op in ('S', 's'):
                        out['strokes'].append(box)
            path = []
        elif op == 'BT':
            tm = lm = [1, 0, 0, 1, 0, 0]
        elif op == 'Tf':
            name = a[-2]
            if name not in font_cache:
                font_cache[name] = Font(pdf, fonts.get(name))
            ts['font'] = font_cache[name]
            ts['fs'] = float(a[-1])
        elif op == 'Tc':
            ts['tc'] = float(a[-1])
        elif op == 'Tw':
            ts['tw'] = float(a[-1])
        elif op == 'Tz':
            ts['tz'] = float(a[-1]) / 100
        elif op == 'TL':
            ts['tl'] = float(a[-1])
        elif op == 'Ts':
            ts['rise'] = float(a[-1])
        elif op == 'Tm':
            tm = lm = [float(x) for x in a[-6:]]
        elif op in ('Td', 'TD'):
            if op == 'TD':
                ts['tl'] = -float(a[-1])
            lm = mul([1, 0, 0, 1, float(a[-2]), float(a[-1])], lm)
            tm = lm
        elif op == 'T*':
            lm = mul([1, 0, 0, 1, 0, -ts['tl']], lm)
            tm = lm
        elif op in ('Tj', 'TJ', "'", '"'):
            if op in ("'", '"'):
                lm = mul([1, 0, 0, 1, 0, -ts['tl']], lm)
                tm = lm
                if op == '"':
                    ts['tw'], ts['tc'] = float(a[-3]), float(a[-2])
            items = a[-1] if op == 'TJ' else [a[-1]]
            f = ts['font']
            if f is None:
                continue
            start = mul([ts['fs'] * ts['tz'], 0, 0, ts['fs'], 0, ts['rise']], mul(tm, gs['ctm']))
            txt = ''
            for it in (items if isinstance(items, list) else [items]):
                if isinstance(it, (int, float)):
                    tx = -it / 1000 * ts['fs'] * ts['tz']
                    tm = mul([1, 0, 0, 1, tx, 0], tm)
                    continue
                codes = f.codes(it)
                txt += f.text(codes)
                for c in codes:
                    tx = (f.width(c) * ts['fs'] + ts['tc'] + (ts['tw'] if (c == 32 and not f.two_byte) else 0)) * ts['tz']
                    tm = mul([1, 0, 0, 1, tx, 0], tm)
            end = mul([ts['fs'] * ts['tz'], 0, 0, ts['fs'], 0, ts['rise']], mul(tm, gs['ctm']))
            if txt.strip():
                size = math.hypot(start[2], start[3])
                angle = round(math.degrees(math.atan2(start[1], start[0]))) % 360
                out['texts'].append({'text': txt, 'font': f.base, 'bold': f.bold, 'size': size, 'angle': angle,
                                     'x0': start[4], 'y0': start[5], 'x1': end[4], 'y1': end[5]})
        elif op == 'Do' and depth < 8:
            xo = xobjs.get(a[-1])
            if isinstance(xo, Ref) and xo.n in pdf.streams:
                d, _ = pdf.streams[xo.n]
                if pdf.get(d.get('Subtype')) == 'Form':
                    mtx = [float(pdf.get(z)) for z in (pdf.get(d.get('Matrix')) or [1, 0, 0, 1, 0, 0])]
                    interpret(pdf, pdf.stream(xo), d.get('Resources') or resources, mul(mtx, gs['ctm']), out, depth + 1)


def read_page(path, page_no):
    data = open(path, 'rb').read()
    if not data.startswith(b'%PDF'):
        raise ValueError('not a PDF file')
    pdf = Pdf(data)
    pages = pdf.pages()
    if not 1 <= page_no <= len(pages):
        raise ValueError(f'page {page_no} not in 1..{len(pages)}')
    node, inh = pages[page_no - 1]
    mb = [float(pdf.get(v)) for v in inh['MediaBox']]
    content = pdf.get(node.get('Contents'))
    refs = content if isinstance(content, list) else [node.get('Contents')]
    stream = b'\n'.join(pdf.stream(r) for r in refs if isinstance(r, Ref))
    out = {'texts': [], 'segments': [], 'fills': [], 'strokes': []}
    interpret(pdf, stream, inh.get('Resources'), [1, 0, 0, 1, 0, 0], out)
    fonts = sorted({t['font'] for t in out['texts']})
    return {'pages': len(pages), 'media_box': mb, 'fonts': fonts, **out}


# ---- Measurement ----------------------------------------------------------------------------------------------
def to_top_left(m, h):
    """Text items in mm, origin top-left: x (start), baseline, top, width, size, angle."""
    res = []
    for t in m['texts']:
        if t['angle'] == 0:
            x, base = t['x0'], h - t['y0']
            w = t['x1'] - t['x0']
            res.append({**t, 'x': x / PT_PER_MM, 'base': base / PT_PER_MM, 'top': (base - ASCENT * t['size']) / PT_PER_MM,
                        'w': w / PT_PER_MM, 'h': t['size'] / PT_PER_MM})
        else:  # rotated (strip): box from the ink band
            xs = [t['x0'], t['x1']]
            ys = [h - t['y0'], h - t['y1']]
            res.append({**t, 'x': min(xs) / PT_PER_MM - (ASCENT * t['size'] / PT_PER_MM if t['angle'] == 90 else 0),
                        'base': None, 'top': min(ys) / PT_PER_MM, 'w': (max(xs) - min(xs)) / PT_PER_MM + t['size'] / PT_PER_MM,
                        'h': (max(ys) - min(ys)) / PT_PER_MM, 'cy': (sum(ys) / 2) / PT_PER_MM})
    return res


def find_bars(m, h):
    """Vertical bars: filled rects or stroked vertical segments taller than 5 mm and narrower than 3 mm."""
    cand = []
    for x0, y0, x1, y1 in m['fills']:
        if (y1 - y0) >= 5 * PT_PER_MM and (x1 - x0) <= 3 * PT_PER_MM and (x1 - x0) > 0:
            cand.append((x0, h - y1, x1, h - y0))
    for s in m['segments']:
        (ax, ay), (bx, by) = s['p0'], s['p1']
        if abs(ax - bx) < 0.01 and abs(ay - by) >= 5 * PT_PER_MM and s['w'] <= 3 * PT_PER_MM:
            cand.append((ax - s['w'] / 2, h - max(ay, by), ax + s['w'] / 2, h - min(ay, by)))
    groups = {}
    for b in cand:
        key = (round(b[1], 0), round(b[3], 0))
        groups.setdefault(key, []).append(b)
    best = max(groups.values(), key=len) if groups else []
    return sorted(best) if len(best) >= 10 else []


def decode_c128(widths):
    s = ''.join(str(w) for w in widths)
    if len(s) < 13 or (len(s) - 7) % 6:
        return None
    syms = [s[i:i + 6] for i in range(0, len(s) - 7, 6)]
    if s[len(syms) * 6:] != C128[106]:
        return None
    try:
        vals = [C128.index(x) for x in syms]
    except ValueError:
        return None
    start = {103: 'A', 104: 'B', 105: 'C'}.get(vals[0])
    data, chk = vals[1:-1], vals[-1]
    ok = (vals[0] + sum((i + 1) * v for i, v in enumerate(data))) % 103 == chk
    text = ''.join(chr(v + 32) for v in data) if start == 'B' and all(v < 95 for v in data) else None
    return {'subset': start, 'chars': len(data), 'checksum_ok': ok, 'text': text}


def mask(s):
    return re.sub(r'[A-Za-z]', 'A', re.sub(r'\d', '9', s))


def check(path, page_no=1, dpi=203, masked=False):
    m = read_page(path, page_no)
    mb = m['media_box']
    W, H = mb[2] - mb[0], mb[3] - mb[1]
    S = SPEC
    results = []

    def res(name, ok, detail, level='FAIL'):
        results.append({'check': name, 'status': 'PASS' if ok else level, 'detail': detail})

    res('page size', abs(W - S['page_pt'][0]) <= S['page_tol_pt'] and abs(H - S['page_pt'][1]) <= S['page_tol_pt'],
        f'{W:.2f} x {H:.2f} pt (spec {S["page_pt"][0]:.0f} x {S["page_pt"][1]:.0f} +/- {S["page_tol_pt"]})')
    res('fonts Helvetica/Arial family', all(re.search(r'helvetica|arial', f, re.I) for f in m['fonts']), ', '.join(m['fonts']) or 'none', 'WARN')

    texts = to_top_left(m, H)
    statics = {S['title']['text'], *S['strip_texts'], S['blank'][0], *[r[0] for r in S['rows']], *[c[0] for c in S['columns']],
               *[a for v in S['alt_captions'].values() for a in v],
               *[a for v in S.get('alt_strip_texts', {}).values() for a in v]}
    used = set()

    def find_text(s):
        for i, t in enumerate(texts):
            if t['text'].strip() == s and i not in used:
                used.add(i)
                return t
        return None

    # minimum size, margin
    small = [t for t in texts if t['size'] < S['min_pt'] - 0.01]
    res('minimum font size 9 pt', not small, f'smallest {min((t["size"] for t in texts), default=0):.2f} pt')
    mg = S['margin_mm']
    out_m = [t for t in texts if t['x'] < mg - 0.05 or t['x'] + t['w'] > W / PT_PER_MM - mg + 0.05 or t['top'] < mg - 0.05
             or t['top'] + t['h'] > H / PT_PER_MM - mg + 0.05]
    res('4 mm safe margin (texts)', not out_m, f'{len(out_m)} text(s) inside the margin'
        + (': ' + '; '.join(f'"{(mask(t["text"]) if masked else t["text"])[:20]}" x {t["x"]:.1f} top {t["top"]:.1f}' for t in out_m[:4]) if out_m else ''))

    # title
    t = find_text(S['title']['text'])
    if t:
        cx = t['x'] + t['w'] / 2
        c0 = sum(S['content']) / 2
        res('title', t['bold'] and abs(t['size'] - S['title']['pt']) <= 0.5 and abs(t['top'] - S['title']['top']) <= S['top_tol']
            and abs(cx - c0) <= 1.0, f'bold={t["bold"]} {t["size"]:.1f} pt top {t["top"]:.2f} mm centre {cx:.2f} (content centre {c0:.2f})')
    else:
        res('title', False, 'title text not found')

    # rules
    def rule(kind):
        r = S['rule_v' if kind == 'v' else 'rule_h']
        best = None
        for sgm in m['segments']:
            (ax, ay), (bx, by) = sgm['p0'], sgm['p1']
            if kind == 'v' and abs(ax - bx) < 0.05 and abs(ay - by) > 20 * PT_PER_MM:
                cand = (ax / PT_PER_MM, (H - max(ay, by)) / PT_PER_MM, (H - min(ay, by)) / PT_PER_MM)
                if best is None or abs(cand[0] - r['x']) < abs(best[0] - r['x']):
                    best = cand
            if kind == 'h' and abs(ay - by) < 0.05 and abs(ax - bx) > 20 * PT_PER_MM:
                cand = ((H - ay) / PT_PER_MM, min(ax, bx) / PT_PER_MM, max(ax, bx) / PT_PER_MM)
                if best is None or abs(cand[0] - r['y']) < abs(best[0] - r['y']):
                    best = cand
        if kind == 'v':
            ok = best and abs(best[0] - r['x']) <= r['tol'] and abs(best[1] - r['y0']) <= r['len_tol'] and abs(best[2] - r['y1']) <= r['len_tol']
            res('vertical rule', bool(ok), f'x {best[0]:.2f}, y {best[1]:.2f}..{best[2]:.2f} mm (spec x {r["x"]}, y {r["y0"]}..{r["y1"]})' if best else 'not found')
        else:
            ok = best and abs(best[0] - r['y']) <= r['tol'] and abs(best[1] - r['x0']) <= r['len_tol'] and abs(best[2] - r['x1']) <= r['len_tol']
            res('horizontal rule', bool(ok), f'y {best[0]:.2f}, x {best[1]:.2f}..{best[2]:.2f} mm (spec y {r["y"]}, x {r["x0"]}..{r["x1"]})' if best else 'not found')
    rule('v')
    rule('h')

    # strip texts
    for s in S['strip_texts']:
        t = find_text(s)
        if not t and s in S.get('alt_strip_texts', {}):
            for alt in S['alt_strip_texts'][s]:
                t = find_text(alt)
                if t:
                    break
        if not t:
            res(f'strip "{s[:12]}"', False, 'not found')
            continue
        ok = t['angle'] == 90 and t['x'] >= max(S['strip']['x0'], mg) - 0.3 and t['x'] + t['w'] <= S['strip']['x1'] + 0.3 \
            and abs(t.get('cy', 0) - S['strip']['center_y']) <= S['strip']['center_tol']
        res(f'strip "{s[:12]}"', ok, f'angle {t["angle"]}, x {t["x"]:.2f}..{t["x"] + t["w"]:.2f} mm, centre y {t.get("cy", 0):.2f} '
            f'(spec rotated 90, x {max(S["strip"]["x0"], mg)}..{S["strip"]["x1"]}, centre {S["strip"]["center_y"]})')

    # caption/value rows
    tops = []

    def caption_value(cap, cx, vx, top, lines, value_below=None):
        alts = [cap] + S['alt_captions'].get(cap, [])
        c = None
        for a in alts:
            c = find_text(a)
            if c:
                break
        if not c:
            res(f'{cap}', False, 'caption not found')
            return
        tops.append((cap, c['top']))
        ok_cap = c['bold'] and abs(c['size'] - S['caption_pt']) <= S['size_tol'] and abs(c['x'] - cx) <= S['x_tol'] \
            and abs(c['top'] - top) <= S['top_tol']
        res(f'{cap}: caption', ok_cap, f'bold={c["bold"]} {c["size"]:.2f} pt x {c["x"]:.2f} top {c["top"]:.2f} mm '
            f'(spec {S["caption_pt"]} pt bold, x {cx}, top {top})')
        vals = []
        for i, t in enumerate(texts):
            if i in used or t['angle'] != 0 or abs(t['x'] - vx) > S['x_tol'] + 0.3:
                continue
            if value_below is None:
                if -S['baseline_tol_pt'] / PT_PER_MM <= t['base'] - c['base'] <= (lines - 1) * S['value_pt'] * 1.3 / PT_PER_MM + 0.3:
                    vals.append((i, t))
            elif abs(t['top'] - value_below) <= S['top_tol'] + 0.5:
                vals.append((i, t))
        if not vals:
            # nothing at the exact position: take the nearest free text in the row as a misplaced value
            near = []
            for i, t in enumerate(texts):
                if i in used or t['angle'] != 0 or t['text'].strip() in statics or abs(t['x'] - vx) > 8.0:
                    continue
                dy = abs(t['base'] - c['base']) if value_below is None else abs(t['top'] - value_below)
                if dy <= 3.0:
                    near.append((abs(t['x'] - vx) + dy, i, t))
            if not near:
                res(f'{cap}: value', True, 'no value at the value position (empty values keep their space)', 'WARN')
                results[-1]['status'] = 'WARN'
                return
            vals = [min(near)[1:]]
        for i, _ in vals:
            used.add(i)
        v = vals[0][1]
        shown = '; '.join((mask(t['text']) if masked else t['text']) for _, t in vals)
        if value_below is None:
            dbase = (v['base'] - c['base']) * PT_PER_MM
            gap = (v['x'] - (c['x'] + c['w'])) * PT_PER_MM
            ok = (not v['bold']) and S['min_pt'] - 0.01 <= v['size'] <= S['value_pt'] + S['size_tol'] and abs(dbase) <= S['baseline_tol_pt'] \
                and gap >= S['gap_pt'] - 0.05 and len(vals) <= lines and abs(v['x'] - vx) <= S['x_tol']
            res(f'{cap}: value', ok, f'"{shown}" {v["size"]:.2f} pt x {v["x"]:.2f} mm; baseline diff {dbase:+.2f} pt; '
                f'caption->value gap {gap:.2f} pt; lines {len(vals)}/{lines} (spec x {vx}, gap >= {S["gap_pt"]} pt)')
        else:
            ok = (not v['bold']) and S['min_pt'] - 0.01 <= v['size'] <= S['value_pt'] + S['size_tol'] and abs(v['x'] - c['x']) * PT_PER_MM <= 0.5 \
                and abs(v['top'] - value_below) <= S['top_tol']
            res(f'{cap}: value', ok, f'"{shown}" {v["size"]:.2f} pt x {v["x"]:.2f} mm top {v["top"]:.2f} (spec top {value_below}) '
                f'(header and value same x: {abs(v["x"] - c["x"]) * PT_PER_MM:.2f} pt apart)')

    for cap, cx, vx, top, lines in S['rows']:
        caption_value(cap, cx, vx, top, lines)
    for cap, x, htop, vtop in S['columns']:
        caption_value(cap, x, x, htop, 1, value_below=vtop)
    b = find_text(S['blank'][0])
    res('Prepared by', bool(b) and abs(b['x'] - S['blank'][1]) <= S['x_tol'] and abs(b['top'] - S['blank'][2]) <= S['top_tol'],
        f'x {b["x"]:.2f} top {b["top"]:.2f} mm (spec x {S["blank"][1]}, top {S["blank"][2]})' if b else 'not found')

    # row pitch (informative)
    rows_sorted = sorted({round(tp, 2) for _, tp in tops})
    pitch = [round(b2 - a2, 2) for a2, b2 in zip(rows_sorted, rows_sorted[1:])]
    results.append({'check': 'row pitch', 'status': 'INFO', 'detail': f'row tops {rows_sorted} mm; pitch {pitch} mm'})

    # overlaps between horizontal text boxes
    hz = [t for t in texts if t['angle'] == 0]
    ov = []
    for i in range(len(hz)):
        for j in range(i + 1, len(hz)):
            a, c = hz[i], hz[j]
            if a['x'] < c['x'] + c['w'] - 0.05 and c['x'] < a['x'] + a['w'] - 0.05 and a['top'] < c['top'] + c['h'] - 0.05 and c['top'] < a['top'] + a['h'] - 0.05:
                ov.append((a, c))
    res('no overlapping texts', not ov, f'{len(ov)} overlap(s)' + (': ' + '; '.join(
        f'"{(mask(a["text"]) if masked else a["text"])[:14]}" / "{(mask(c["text"]) if masked else c["text"])[:14]}"' for a, c in ov[:3]) if ov else ''))

    # barcode
    bars = find_bars(m, H)
    B = S['barcode']
    if not bars:
        res('barcode', False, 'no barcode bars found')
    else:
        x0s = [bb[0] for bb in bars]
        edges = [(bb[0], bb[2]) for bb in bars]
        elems = []
        for i, (l, r) in enumerate(edges):
            elems.append(r - l)
            if i + 1 < len(edges):
                elems.append(edges[i + 1][0] - r)
        module = min(elems)
        widths = [max(1, round(e / module)) for e in elems]
        dec = decode_c128(widths)
        top = bars[0][1] / PT_PER_MM
        height = (bars[0][3] - bars[0][1]) / PT_PER_MM
        mod_mm = module / PT_PER_MM
        dots = mod_mm / (25.4 / dpi)
        total_modules = sum(widths)
        left = min(x0s) / PT_PER_MM
        right = max(bb[2] for bb in bars) / PT_PER_MM
        res('barcode bars', bool(dec) and dec['checksum_ok'] and dec['subset'] == B['subset'],
            f'{len(bars)} bars, {total_modules} modules, Code 128 subset {dec["subset"] if dec else "?"}, '
            f'{dec["chars"] if dec else "?"} characters, checksum {"ok" if dec and dec["checksum_ok"] else "BAD"}')
        if dec:
            exp = 11 * (dec['chars'] + 2) + 13
            res('barcode width formula', total_modules == exp and len(bars) == 3 * (dec['chars'] + 3) + 1,
                f'{total_modules} modules (expected 11 x ({dec["chars"]} + 2) + 13 = {exp}); width {right - left:.2f} mm')
        res('barcode top / height', abs(top - B['top']) <= B['pos_tol'] and abs(height - B['height']) <= B['pos_tol'],
            f'top {top:.2f} mm, height {height:.2f} mm (spec {B["top"]}, {B["height"]})')
        res('barcode narrow bar', abs(mod_mm - B['module']) <= B['module_tol'] and mod_mm >= B['module_min'] - 0.001
            and abs(dots - round(dots)) <= 0.05,
            f'{mod_mm:.3f} mm = {dots:.2f} dots at {dpi} dpi (spec {B["module"]} mm, >= {B["module_min"]}, whole dots)')
        # quiet zones: nothing else within the zone at the bar height, and zone inside the content width
        band = (bars[0][1], bars[0][3])
        others = [t for t in texts if t['angle'] == 0 and not (t['top'] * PT_PER_MM > band[1] or (t['top'] + t['h']) * PT_PER_MM < band[0])]
        lefts = [t['x'] + t['w'] for t in others if t['x'] + t['w'] <= left]
        rights = [t['x'] for t in others if t['x'] >= right]
        for sg in m['segments']:
            (ax, ay), (bx, by) = sg['p0'], sg['p1']
            ya, yb = sorted((H - ay, H - by))
            if not (ya > band[1] or yb < band[0]) and abs(ax - bx) < 0.05 and (ax / PT_PER_MM < left - 0.01 or ax / PT_PER_MM > right + 0.01) \
                    and (abs(ay - by) < 5 * PT_PER_MM or sg['w'] > 3 * PT_PER_MM):
                (lefts if ax / PT_PER_MM < left else rights).append(ax / PT_PER_MM)
        ql = left - max([S['content'][0]] + lefts)
        qr = min([S['content'][1]] + rights) - right
        res('barcode quiet zones', ql >= B['quiet'] - 0.05 and qr >= B['quiet'] - 0.05,
            f'left {ql:.2f} mm, right {qr:.2f} mm free inside the content x {S["content"][0]}..{S["content"][1]} (spec >= {B["quiet"]} mm)')
        hr = [t for t in texts if t['angle'] == 0 and t['top'] * PT_PER_MM >= band[1] - 0.5]
        hr = sorted(hr, key=lambda t: t['top'])
        if hr:
            t = hr[0]
            gap = t['top'] - band[1] / PT_PER_MM
            cdiff = (t['x'] + t['w'] / 2) - (left + right) / 2
            same = dec and dec['text'] is not None and t['text'].strip() == dec['text']
            res('human-readable number', abs(t['size'] - B['hr_pt']) <= 0.5 and 0 <= gap <= B['hr_gap_max'] and abs(cdiff) <= B['hr_center_tol'] and bool(same),
                f'{t["size"]:.2f} pt, {gap:.2f} mm below the bars, centre offset {cdiff:+.2f} mm, equals the encoded value: {bool(same)}')
            used.add(texts.index(t))
        else:
            res('human-readable number', False, 'no text below the bars')

    extra = [t for i, t in enumerate(texts) if i not in used and t['text'].strip() not in statics]
    res('no unplaced texts', not extra, f'{len(extra)} text(s) not at any spec position'
        + (': ' + '; '.join(f'"{(mask(t["text"]) if masked else t["text"])[:20]}" x {t["x"]:.1f} top {t["top"]:.1f}' for t in extra[:5]) if extra else ''))

    boxes = [{'text': mask(t['text']) if (masked and t['text'].strip() not in statics) else t['text'], 'font': t['font'],
              'size_pt': round(t['size'], 2), 'angle': t['angle'], 'x_mm': round(t['x'], 2), 'top_mm': round(t['top'], 2),
              'w_mm': round(t['w'], 2)} for t in texts]
    status = 'FAIL' if any(r['status'] == 'FAIL' for r in results) else 'PASS'
    return {'file': path.split('/')[-1], 'page': page_no, 'pages': m['pages'], 'status': status, 'checks': results, 'texts': boxes}


def main(argv):
    args = argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return 2
    path = args[0]
    page = int(args[args.index('--page') + 1]) if '--page' in args else 1
    dpi = int(args[args.index('--dpi') + 1]) if '--dpi' in args else 203
    try:
        rep = check(path, page, dpi, '--mask' in args)
    except Exception as e:  # unreadable or unsupported PDF
        print(f'ERROR: cannot read {path}: {e}', file=sys.stderr)
        return 2
    if '--json' in args:
        print(json.dumps(rep, indent=2, ensure_ascii=False))
    else:
        print(f'{rep["file"]} page {rep["page"]}/{rep["pages"]}: {rep["status"]}')
        for r in rep['checks']:
            print(f'  [{r["status"]:4}] {r["check"]}: {r["detail"]}')
        print('  text boxes (mm, top-left):')
        for t in rep['texts']:
            print(f'    {t["font"]:<22} {t["size_pt"]:5.2f} pt  angle {t["angle"]:3}  x {t["x_mm"]:6.2f}  top {t["top_mm"]:6.2f}  '
                  f'w {t["w_mm"]:6.2f}  "{t["text"]}"')
    return 0 if rep['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
