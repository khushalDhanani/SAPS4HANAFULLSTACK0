/**
 * goodsIssue311.validation.js
 * ISOLATED business rules for Movement Type 311 ONLY (Storage Location Transfer).
 * Serves no other movement type; contains no MovementType branching.
 *
 * 311 rules: Reservation No + Item mandatory, ReceivingStorageLocation mandatory,
 * ReceivingPlant (if supplied) must match issuing Plant, no Cost Center, no G/L account.
 * Uses movementConfig.js as the canonical authoritative policy.
 */

const C = require('./common');
const {
  validateMovement311Destination,
  verifyReceivingLocationInSap
} = require('../../../common/movementConfig');

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

  // Canonical central Movement 311 destination validation (ReceivingStorageLocation = REQUIRED):
  const destVal = validateMovement311Destination(
    data.Plant,
    data.StorageLocation,
    data.ReceivingPlant,
    data.ReceivingStorageLocation
  );
  destVal.errors.forEach(push);

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

/**
 * Verifies Receiving Storage Location against SAP WM configuration (T320), T001L, and MARD.
 * Authoritative policy delegates to verifyReceivingLocationInSap in movementConfig.js.
 *
 * @param {object} rfc - SAP RFC client
 * @param {object} data - Goods issue payload with Plant, StorageLocation, ReceivingStorageLocation, Material
 * @returns {Promise<{ valid: boolean, error?: string, initialDestStock?: number }>}
 */
async function verifyGoodsIssue311InSap(rfc, data = {}) {
  return verifyReceivingLocationInSap(rfc, {
    movementType: '311',
    plant: data.Plant || data.plant,
    storageLocation: data.StorageLocation || data.storageLocation,
    receivingPlant: data.ReceivingPlant || data.receivingPlant || data.Plant || data.plant,
    receivingStorageLocation: data.ReceivingStorageLocation || data.receivingStorageLocation,
    material: data.Material || data.material,
    checkT320: true,
    checkT001L: true,
    checkMard: true
  });
}

module.exports = {
  validateGoodsIssue311Payload,
  validateMovement311Destination,
  verifyGoodsIssue311InSap,
  verifyReceivingLocationInSap
};
