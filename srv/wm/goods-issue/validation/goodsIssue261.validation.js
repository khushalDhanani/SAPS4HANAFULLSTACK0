/**
 * goodsIssue261.validation.js
 * ISOLATED business rules for Movement Type 261 ONLY (Goods Issue for Order / Reservation).
 * Serves no other movement type; contains no MovementType branching.
 *
 * 261 rules: Reservation No + Item mandatory, no Cost Center, optional G/L account,
 * no receiving plant/storage location. Material/Plant/StorageLocation are supplied by the
 * reservation and therefore optional on the request when a reservation is present.
 */

const C = require('./common');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue261Payload(data) {
  if (!data || typeof data !== 'object') {
    return C.buildResult([{ field: 'body', message: 'Request body must be a valid JSON object' }]);
  }

  const errors = [];
  const push = (e) => { if (e) errors.push(e); };

  const sResv = String(data.ReservationNo || '').trim();
  const rawItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
  const sItem = rawItem ? rawItem.padStart(4, '0') : '';
  const sOrder = String(data.OrderNo || data.OrderID || '').trim();

  const hasReservation = Boolean(sResv && sItem);
  const hasOrder = Boolean(sOrder);

  if (!hasReservation && !hasOrder) {
    errors.push({ field: 'ReservationNo', message: 'ReservationNo and ReservationItem are required (or OrderNo for unplanned Movement 261)' });
    errors.push({ field: 'OrderNo', message: 'Either (ReservationNo and ReservationItem) or OrderNo is required for Movement 261' });
  } else if (!hasReservation && hasOrder) {
    if (sOrder.length > 12) {
      errors.push({ field: 'OrderNo', message: 'OrderNo exceeds maximum length of 12 characters' });
    }
  } else if (hasReservation) {
    if (sResv.length > 10) {
      errors.push({ field: 'ReservationNo', message: 'ReservationNo exceeds maximum length of 10 characters' });
    }
    if (sItem.length > 4) {
      errors.push({ field: 'ReservationItem', message: 'ReservationItem exceeds maximum length of 4 characters' });
    }
  }

  push(C.checkQuantity(data.IssueQty));
  push(C.checkMaterial(data.Material, !hasReservation));
  push(C.checkPlant(data.Plant, !hasReservation));
  push(C.checkStorageLocation(data.StorageLocation, !hasReservation));
  push(C.checkUnit(data.Unit));

  // G/L Account optional; if supplied, must be well-formed. (No Cost Center for 261.)
  if (data.GLAccount !== undefined && data.GLAccount !== null && String(data.GLAccount).trim() !== '') {
    const sGL = String(data.GLAccount).trim();
    if (!C.GL_ACCOUNT_REGEX.test(sGL)) {
      push({ field: 'GLAccount', message: `GLAccount '${sGL}' must be 1 to 10 alphanumeric characters` });
    }
  }

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

module.exports = { validateGoodsIssue261Payload };
