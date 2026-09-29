/**
 * goodsIssue311.validation.js
 * ISOLATED business rules for Movement Type 311 ONLY (Storage Location Transfer).
 * Serves no other movement type; contains no MovementType branching.
 *
 * 311 rules: Reservation No + Item mandatory, receiving Plant / Storage Location optional,
 * no Cost Center, no G/L account.
 */

const C = require('./common');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue311Payload(data) {
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

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

module.exports = { validateGoodsIssue311Payload };
