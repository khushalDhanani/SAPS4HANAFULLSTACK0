'use strict';

/**
 * Page size check of the SAP-rendered PDF. The PDF itself is never changed here.
 */

// PDF user space unit: 1 pt = 1/72 in (ISO 32000-1, 8.3.2.3)
const PT_PER_INCH = 72;
const SIZE_TOLERANCE_PT = 1;
// Label sizes a plant can configure, portrait, in inches
const LABEL_SIZES_IN = Object.freeze({ '4x6': Object.freeze({ width: 4, height: 6 }) });

/**
 * Size of the first MediaBox in the PDF, in points, or null when none is readable.
 * shortcut: first MediaBox in file order; one inside a compressed object stream is not seen (-> null, reported as
 * "could not be checked"), upgrade to a real PDF parser if SAP output turns out to use object streams.
 */
function pdfPageSize(buffer) {
  const m = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(Buffer.from(buffer).toString('latin1'));
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { widthPt: Math.abs(x2 - x1), heightPt: Math.abs(y2 - y1) };
}

/** null: no size configured; false: wrong or unreadable size; true: matches within 1 pt. */
function pageSizeMatches(size, labelSize) {
  if (!labelSize) return null;
  if (!size) return false;
  const want = LABEL_SIZES_IN[labelSize];
  return Math.abs(size.widthPt - want.width * PT_PER_INCH) <= SIZE_TOLERANCE_PT
    && Math.abs(size.heightPt - want.height * PT_PER_INCH) <= SIZE_TOLERANCE_PT;
}

/** Adds the page size and check result to the adapter's answer; the PDF stays as SAP returned it. */
function addPageCheck(result) {
  const size = pdfPageSize(Buffer.from(result.PdfBase64, 'base64'));
  return {
    ...result,
    PageWidthPt: size ? size.widthPt : null,
    PageHeightPt: size ? size.heightPt : null,
    PageSizeOk: pageSizeMatches(size, result.LabelSize)
  };
}

module.exports = { PT_PER_INCH, pdfPageSize, pageSizeMatches, addPageCheck };
