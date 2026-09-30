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

  // 311 is a storage-location-to-storage-location transfer WITHIN one plant. When a receiving plant
  // is supplied it must equal the issuing plant; when a receiving storage location is supplied it
  // must differ from the issuing one (a transfer to the same bin is a no-op). These are conditional
  // invariants (they never make the fields required) so reservation-derived postings are unaffected.
  const sPlant311 = String(data.Plant || '').trim().toUpperCase();
  const sRecvPlant311 = String(data.ReceivingPlant || '').trim().toUpperCase();
  if (sRecvPlant311 && sPlant311 && sRecvPlant311 !== sPlant311) {
    push({ field: 'ReceivingPlant', message: `Movement 311 is a storage-location transfer within one plant: receiving plant '${sRecvPlant311}' must equal issuing plant '${sPlant311}'` });
  }
  const sSLoc311 = String(data.StorageLocation || '').trim().toUpperCase();
  const sRecvSLoc311 = String(data.ReceivingStorageLocation || '').trim().toUpperCase();
  if (sRecvSLoc311 && sSLoc311 && sRecvSLoc311 === sSLoc311) {
    push({ field: 'ReceivingStorageLocation', message: `Receiving storage location '${sRecvSLoc311}' must differ from the issuing storage location for a 311 transfer` });
  }

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

module.exports = { validateGoodsIssue311Payload };
