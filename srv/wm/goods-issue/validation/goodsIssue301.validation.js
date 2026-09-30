/**
 * goodsIssue301.validation.js
 * ISOLATED business rules for Movement Type 301 ONLY (Plant-to-Plant Transfer).
 * Serves no other movement type; contains no MovementType branching.
 *
 * 301 rules: Reservation No + Item mandatory, receiving Plant / Storage Location optional,
 * no Cost Center, no G/L account.
 */

const C = require('./common');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue301Payload(data) {
  if (!data || typeof data !== 'object') {
    return C.buildResult([{ field: 'body', message: 'Request body must be a valid JSON object' }]);
  }

  const errors = [];
  const push = (e) => { if (e) errors.push(e); };

  const hasReservation = C.checkReservationRequired(data, errors);

  push(C.checkQuantity(data.IssueQty));
  push(C.checkMaterial(data.Material, !hasReservation));
  push(C.checkPlant(data.Plant, !hasReservation));
  push(C.checkStorageLocation(data.StorageLocation, !hasReservation));
  push(C.checkUnit(data.Unit));

  // Receiving plant / storage location are OPTIONAL for transfers; validate format if supplied.
  push(C.checkOptionalFourChar(data.ReceivingPlant, 'ReceivingPlant'));
  push(C.checkOptionalFourChar(data.ReceivingStorageLocation, 'ReceivingStorageLocation'));

  // 301 is a plant-to-plant transfer. When a receiving plant is supplied it must differ from the
  // issuing plant (a 301 into the same plant is contradictory). Conditional invariant only — it never
  // makes the field required, so reservation-derived postings are unaffected.
  const sPlant301 = String(data.Plant || '').trim().toUpperCase();
  const sRecvPlant301 = String(data.ReceivingPlant || '').trim().toUpperCase();
  if (sRecvPlant301 && sPlant301 && sRecvPlant301 === sPlant301) {
    push({ field: 'ReceivingPlant', message: `Movement 301 is a plant-to-plant transfer: receiving plant '${sRecvPlant301}' must differ from issuing plant '${sPlant301}'` });
  }

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

module.exports = { validateGoodsIssue301Payload };
