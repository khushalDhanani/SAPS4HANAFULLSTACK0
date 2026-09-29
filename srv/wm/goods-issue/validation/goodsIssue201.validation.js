/**
 * goodsIssue201.validation.js
 * ISOLATED business rules for Movement Type 201 ONLY (Goods Issue to Cost Center).
 * Serves no other movement type; contains no MovementType branching.
 *
 * 201 rules: Cost Center mandatory, G/L account is system-determined (never caller-supplied),
 * reservation optional, no receiving plant/storage location.
 */

const C = require('./common');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue201Payload(data) {
  if (!data || typeof data !== 'object') {
    return C.buildResult([{ field: 'body', message: 'Request body must be a valid JSON object' }]);
  }

  const errors = [];
  const push = (e) => { if (e) errors.push(e); };

  // Cost Center - MANDATORY for 201
  const sCostCenter = String(data.CostCenter || '').trim();
  if (!sCostCenter) {
    push({ field: 'CostCenter', message: 'Cost Center is mandatory for Movement Type 201 (Goods Issue to Cost Center)' });
  } else if (!C.COST_CENTER_REGEX.test(sCostCenter)) {
    push({ field: 'CostCenter', message: `Cost Center '${sCostCenter}' must be 1 to 10 alphanumeric characters` });
  }

  // Reservation - OPTIONAL for 201; if partially supplied, validate lengths
  const sResv = String(data.ReservationNo || '').trim();
  const sItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
  const hasReservation = Boolean(sResv && sItem);
  if (sResv && sResv.length > 10) {
    push({ field: 'ReservationNo', message: 'ReservationNo exceeds maximum length of 10 characters' });
  }
  if (sItem && sItem.length > 4) {
    push({ field: 'ReservationItem', message: 'ReservationItem exceeds maximum length of 4 characters' });
  }

  push(C.checkQuantity(data.IssueQty));
  push(C.checkMaterial(data.Material, !hasReservation));
  push(C.checkPlant(data.Plant, !hasReservation));
  push(C.checkStorageLocation(data.StorageLocation, !hasReservation));
  push(C.checkUnit(data.Unit));

  // G/L Account - never accepted for 201: the account is system-determined from Cost Center via
  // OBYC/GBB-VBR and is read-only. Reject any supplied value regardless of format.
  if (data.GLAccount !== undefined && data.GLAccount !== null && String(data.GLAccount).trim() !== '') {
    push({ field: 'GLAccount', message: 'GLAccount cannot be supplied for Movement Type 201: the G/L account is system-determined from Cost Center via OBYC/GBB-VBR and is read-only' });
  }

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

module.exports = { validateGoodsIssue201Payload };
