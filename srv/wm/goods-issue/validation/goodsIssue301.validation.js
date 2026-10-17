/**
 * goodsIssue301.validation.js
 * ISOLATED business rules for Movement Type 301 ONLY (Plant-to-Plant Transfer).
 * Serves no other movement type; contains no MovementType branching.
 *
 * 301 rules: Reservation No + Item mandatory, Receiving Plant REQUIRED,
 * Receiving Storage Location REQUIRED, no Cost Center, no G/L account.
 * Uses movementConfig.js as the authoritative policy for destination requirements.
 */

const C = require('./common');
const {
  validateMovement301Destination,
  verifyReceivingLocationInSap
} = require('../../../common/movementConfig');

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

  // Canonical destination validation from movementConfig.js (Authoritative policy)
  // Enforces:
  // - ReceivingPlant = REQUIRED: rejects missing, empty, whitespace, invalid plant format, same as issuing plant
  // - ReceivingStorageLocation = REQUIRED: rejects missing, empty, whitespace, invalid storage location format
  const destVal = validateMovement301Destination(data.Plant, data.ReceivingPlant, data.ReceivingStorageLocation);
  destVal.errors.forEach(push);

  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch));

  return C.buildResult(errors);
}

/**
 * Verifies ReceivingPlant + ReceivingStorageLocation in SAP backend.
 * Checks T001L (SLoc in Plant), and MARC/MARD if material is provided.
 * Authoritative policy delegates to verifyReceivingLocationInSap in movementConfig.js.
 *
 * @param {object} rfc - SAP RFC client
 * @param {object} data - Goods issue payload with ReceivingPlant, ReceivingStorageLocation, Plant, Material
 * @returns {Promise<{ valid: boolean, error?: string, initialDestStock?: number }>}
 */
async function verifyGoodsIssue301InSap(rfc, data = {}) {
  return verifyReceivingLocationInSap(rfc, {
    receivingPlant: data.ReceivingPlant || data.receivingPlant,
    receivingStorageLocation: data.ReceivingStorageLocation || data.receivingStorageLocation,
    plant: data.Plant || data.plant,
    material: data.Material || data.material
  });
}

module.exports = {
  validateGoodsIssue301Payload,
  verifyGoodsIssue301InSap,
  verifyReceivingLocationInSap
};
