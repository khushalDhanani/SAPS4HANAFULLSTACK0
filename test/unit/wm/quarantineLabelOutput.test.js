'use strict';

const {
    PT_PER_INCH, pdfPageSize, pageSizeMatches, addPageCheck
} = require('../../../srv/wm/quarantine-label/labelOutput');

// Synthetic PDFs only (DEMO data); no SAP output
const pdf = (box) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Pages/Kids[2 0 R]/Count 1>>endobj\n2 0 obj<</Type/Page${box ? `/MediaBox [${box}]` : ''}>>endobj\n%%EOF`);
const demoResult = (labelSize, box) => ({
    MaterialDocument: '9900000001', MaterialDocumentYear: '2026', LabelCount: 1,
    FileName: 'QuarantineLabels_DEMO.pdf', LabelSize: labelSize, PdfBase64: pdf(box).toString('base64')
});

describe('quarantine label output', () => {
    describe('pdfPageSize', () => {
        it('reads a 4 x 6 in MediaBox in points', () => {
            expect(pdfPageSize(pdf('0 0 288 432'))).toEqual({ widthPt: 4 * PT_PER_INCH, heightPt: 6 * PT_PER_INCH });
        });
        it('uses the box extent when the origin is not 0', () => {
            expect(pdfPageSize(pdf('-10 -20 278.5 412'))).toEqual({ widthPt: 288.5, heightPt: 432 });
        });
        it('returns null when no MediaBox is readable', () => {
            expect(pdfPageSize(pdf(null))).toBeNull();
        });
    });

    describe('pageSizeMatches (4x6 = 288 x 432 pt, 1 pt tolerance)', () => {
        it.each([
            [{ widthPt: 288, heightPt: 432 }, true],
            [{ widthPt: 288.9, heightPt: 431.1 }, true],
            [{ widthPt: 289.5, heightPt: 432 }, false],
            [{ widthPt: 432, heightPt: 288 }, false], // landscape
            [{ widthPt: 595.28, heightPt: 841.89 }, false], // A4
            [null, false] // unreadable
        ])('%p -> %p', (size, ok) => {
            expect(pageSizeMatches(size, '4x6')).toBe(ok);
        });
        it('is null when no label size is configured', () => {
            expect(pageSizeMatches({ widthPt: 595.28, heightPt: 841.89 }, null)).toBeNull();
        });
    });

    describe('addPageCheck', () => {
        it('exact size: ok, PDF unchanged', () => {
            const r = demoResult('4x6', '0 0 288 432');
            expect(addPageCheck(r)).toEqual({ ...r, PageWidthPt: 288, PageHeightPt: 432, PageSizeOk: true });
        });
        it('wrong size: not ok, with the actual size', () => {
            expect(addPageCheck(demoResult('4x6', '0 0 595.28 841.89'))).toMatchObject({ PageWidthPt: 595.28, PageHeightPt: 841.89, PageSizeOk: false });
        });
        it('missing config: no check', () => {
            expect(addPageCheck(demoResult(null, '0 0 595.28 841.89'))).toMatchObject({ LabelSize: null, PageSizeOk: null });
        });
    });
});
