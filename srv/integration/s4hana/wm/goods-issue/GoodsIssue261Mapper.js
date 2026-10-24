/**
 * Isolated S/4HANA payload mapper for movement type 261 (Goods Issue to Order).
 * Maps the verified API_MATERIAL_DOCUMENT_SRV material document fields only.
 */

const { buildBaseItem, buildHeaderEnvelope } = require('./s4common');
const { validateMovement261Payload } = require('../../../../common/movementConfig');
const { getGmCode } = require('../../../../common/movementConfig');

function mapToMaterialDocumentPayload(data) {
  const validation = validateMovement261Payload(data);
  if (!validation.isValid) {
    const error = new Error(validation.errors[0].message);
    error.status = 400;
    throw error;
  }

  const item = buildBaseItem({
    ...data,
    ReservationNo: data.ReservationNo || data.reservation,
    ReservationItem: data.ReservationItem || data.item,
    IssueQty: data.IssueQty !== undefined ? data.IssueQty : data.quantity,
    OrderNo: data.OrderNo || data.OrderID || data.orderId
  }, '261');

  return buildHeaderEnvelope({
    gmCode: getGmCode('261'),
    headerText: `GI Resv ${data.ReservationNo || data.reservation}`,
    postingDate: data.PostingDate || data.postingDate,
    documentDate: data.DocumentDate || data.documentDate,
    item,
    referenceDocument: data.ReferenceDocument || data.referenceDocument
  });
}

module.exports = { mapToMaterialDocumentPayload };
