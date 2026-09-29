/**
 * GoodsIssueMapper.js
 * Technical mapping between CAP domain models and SAP S/4HANA API_MATERIAL_DOCUMENT_SRV OData V2 structures.
 *
 * Strict AGENTS.md compliance:
 * - Technical translation only.
 * - No mock persistence, no synthetic documents.
 */

const { odataString } = require('../../../../common/filterUtils');

/**
 * Converts a date string or Date object to SAP OData V2 JSON timestamp '/Date(epoch_ms)/'.
 * Evaluates at UTC midnight to avoid local timezone drift.
 *
 * @param {string|Date} dateInput
 * @returns {string}
 */
function formatDateToODataV2(dateInput) {
  if (!dateInput) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return `/Date(${today.getTime()})/`;
  }
  if (dateInput instanceof Date) {
    const d = new Date(dateInput.getTime());
    d.setUTCHours(0, 0, 0, 0);
    return `/Date(${d.getTime()})/`;
  }
  const s = String(dateInput).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const utcDate = new Date(Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10)));
    return `/Date(${utcDate.getTime()})/`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    parsed.setUTCHours(0, 0, 0, 0);
    return `/Date(${parsed.getTime()})/`;
  }
  const fallback = new Date();
  fallback.setUTCHours(0, 0, 0, 0);
  return `/Date(${fallback.getTime()})/`;
}

/**
 * Builds FunctionImport URL for CancelHeader on API_MATERIAL_DOCUMENT_SRV.
 *
 * @param {string} materialDocument - 10-digit material document
 * @param {string} materialDocYear - 4-digit material document year
 * @param {string} [postingDate] - Optional posting date (YYYY-MM-DD)
 * @returns {string}
 */
function mapToCancelHeaderUrl(materialDocument, materialDocYear, postingDate) {
  const doc = String(materialDocument || '').trim();
  const year = String(materialDocYear || '').trim();
  if (!doc || !year) {
    throw new Error('MaterialDocument and MaterialDocYear are required for CancelHeader');
  }

  let url = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/CancelHeader?MaterialDocument=${odataString(doc)}&MaterialDocumentYear=${odataString(year)}`;
  if (postingDate) {
    // OData V2 FunctionImport parameters of type Edm.DateTime use the literal `datetime'...'`
    // form directly in the URL (unlike the JSON body's `/Date(epoch)/` form produced by
    // formatDateToODataV2 above, which does not apply to URL literals) - postingDate is already
    // validated as YYYY-MM-DD upstream by isValidCalendarDate before reaching this function.
    url += `&PostingDate=datetime'${postingDate}T00:00:00'`;
  }
  return url;
}

module.exports = {
  formatDateToODataV2,
  mapToCancelHeaderUrl
};
