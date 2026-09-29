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
 * Builds the SAP S/4HANA API_MATERIAL_DOCUMENT_SRV deep insert payload for Goods Issue.
 *
 * @param {Object} data - Normalized CAP domain data
 * @returns {Object} S/4HANA OData V2 A_MaterialDocumentHeader payload
 */
function mapToMaterialDocumentPayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Data is required for Material Document mapping');
  }

  const sMvt = String(data.MovementType || '261').trim();
  const gmCode = (sMvt === '201' || sMvt === '261') ? '03' : '04';

  let headerText = '';
  if (sMvt === '201') {
    headerText = data.ReservationNo
      ? `GI CC Resv ${data.ReservationNo}`
      : `GI CC ${data.CostCenter || ''}`;
  } else if (sMvt === '261') {
    headerText = `GI Resv ${data.ReservationNo || data.OrderNo || ''}`;
  } else {
    headerText = `TP ${sMvt} Resv ${data.ReservationNo || ''}`;
  }
  headerText = headerText.trim().slice(0, 25);

  const itemPayload = {
    Material: String(data.Material || '').trim(),
    GoodsMovementType: sMvt,
    EntryUnit: String(data.Unit || '').trim().toUpperCase(),
    QuantityInEntryUnit: String(data.IssueQty),
    Plant: String(data.Plant || '').trim().toUpperCase(),
    StorageLocation: String(data.StorageLocation || '').trim().toUpperCase()
  };

  // Cost Center is mandatory for 201
  if (sMvt === '201' && data.CostCenter) {
    itemPayload.CostCenter = String(data.CostCenter).trim().toUpperCase();
  }

  // Optional G/L Account override - NEVER forwarded for movement 201: the account is
  // system-determined from Cost Center via OBYC/GBB-VBR and must stay read-only for cost-center
  // consumption postings, even if a caller-supplied value slipped past validation.
  if (sMvt !== '201' && data.GLAccount && String(data.GLAccount).trim() !== '') {
    itemPayload.GLAccount = String(data.GLAccount).trim();
  }

  // Reservation details (if planned against reservation)
  if (data.ReservationNo && String(data.ReservationNo).trim() !== '') {
    itemPayload.Reservation = String(data.ReservationNo).trim();
  }
  if (data.ReservationItem && String(data.ReservationItem).trim() !== '') {
    itemPayload.ReservationItem = String(data.ReservationItem).trim();
  }

  // Batch
  if (data.Batch && String(data.Batch).trim() !== '') {
    itemPayload.Batch = String(data.Batch).trim().toUpperCase();
  }

  // Transfer receiving plant/sloc (for 301/311)
  if (data.ReceivingPlant) {
    itemPayload.IssuingOrReceivingPlant = String(data.ReceivingPlant).trim().toUpperCase();
  }
  if (data.ReceivingStorageLocation) {
    itemPayload.IssuingOrReceivingStorageLoc = String(data.ReceivingStorageLocation).trim().toUpperCase();
  }

  // Serial numbers deep insert
  const serials = Array.isArray(data.SerialNumbers) && data.SerialNumbers.length > 0
    ? data.SerialNumbers
    : data.SerialNumber
      ? [data.SerialNumber]
      : [];

  if (serials.length > 0) {
    itemPayload.to_SerialNumbers = {
      results: serials.map(sn => ({ SerialNumber: String(sn).trim() }))
    };
  }

  return {
    GoodsMovementCode: gmCode,
    PostingDate: formatDateToODataV2(data.PostingDate),
    DocumentDate: formatDateToODataV2(data.DocumentDate || data.PostingDate),
    MaterialDocumentHeaderText: headerText,
    to_MaterialDocumentItem: {
      results: [itemPayload]
    }
  };
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
  mapToMaterialDocumentPayload,
  mapToCancelHeaderUrl
};
