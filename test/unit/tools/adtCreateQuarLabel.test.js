'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs, toAdtSource } = require('../../../tools/adt-create-quar-label');

const full = fs.readFileSync(path.join(__dirname, '../../../docs/abap/z_mm_quar_label.fugr.abap'), 'utf8');

describe('adt-create-quar-label (offline)', () => {
    it('turns the SE37 signature of Z_MM_QUAR_LABEL_PDF into the inline ADT signature', () => {
        const src = toAdtSource(full, 'Z_MM_QUAR_LABEL_PDF');
        expect(src.split('\n').slice(0, 12).join('\n')).toBe([
            'FUNCTION z_mm_quar_label_pdf',
            '  IMPORTING',
            '    VALUE(IV_MBLNR) TYPE MBLNR',
            '    VALUE(IV_MJAHR) TYPE MJAHR',
            '    VALUE(IV_TEXT) TYPE CHAR50 OPTIONAL',
            "    VALUE(IV_FORM) TYPE FPNAME DEFAULT 'ZMM_AF_017'",
            '  EXPORTING',
            '    VALUE(EV_RESULT) TYPE CHAR20',
            '    VALUE(EV_MESSAGE) TYPE STRING',
            '    VALUE(EV_PDF) TYPE XSTRING',
            '    VALUE(EV_LABEL_COUNT) TYPE I.',
            '* Read-only apart from Adobe rendering: no database update, no COMMIT,'
        ].join('\n'));
        expect(src).not.toMatch(/^\*"/m);
        expect(src.trimEnd().endsWith('ENDFUNCTION.')).toBe(true);
        expect(src.match(/^FUNCTION /gm)).toHaveLength(1);
    });

    it('extracts Z_MM_QUAR_LABEL_DATA alone, with its signature', () => {
        const src = toAdtSource(full, 'Z_MM_QUAR_LABEL_DATA');
        expect(src).toMatch(/^FUNCTION z_mm_quar_label_data\n {2}IMPORTING\n {4}VALUE\(IV_MBLNR\) TYPE MBLNR\n/);
        expect(src).toMatch(/ {4}VALUE\(ET_FINAL\) TYPE ZMM_TT_026\.\n/);
        expect(src).not.toMatch(/z_mm_quar_label_pdf/i);
    });

    it('fails for an unknown module', () => {
        expect(() => toAdtSource(full, 'Z_NOPE')).toThrow(/not found/);
    });

    it.each([
        [[], /--package/],
        [['--package', 'ZOTHER'], /--package/],
        [['--package', 'ZAMM'], /--transport/],
        [['--package', 'ZAMM', '--transport', 'xxxxx'], /--transport/],
        [['--package', '$TMP', '--transport', 'DS4K900001'], /no transport/]
    ])('refuses arguments %p', (argv, msg) => {
        expect(() => parseArgs(argv)).toThrow(msg);
    });

    it('accepts $TMP alone or ZAMM with a transport', () => {
        expect(parseArgs(['--package', '$TMP'])).toEqual({ pkg: '$TMP', transport: undefined });
        expect(parseArgs(['--package', 'ZAMM', '--transport', 'DS4K900001'])).toEqual({ pkg: 'ZAMM', transport: 'DS4K900001' });
    });

    it('is blocked without the live-SAP gate', () => {
        const { execFileSync } = require('child_process');
        const env = { ...process.env };
        delete env.ALLOW_LIVE_SAP_TOOLS;
        expect(() => execFileSync('node', [path.join(__dirname, '../../../tools/adt-create-quar-label.js'), '--package', '$TMP'], { env, stdio: 'pipe' }))
            .toThrow(/Blocked: live integration tool/);
    });
});
