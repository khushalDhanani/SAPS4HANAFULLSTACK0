/**
 * goodsIssue301.validation.js
 * ISOLATED business rules for Movement Type 301 ONLY (Plant-to-Plant Transfer).
 * Serves no other movement type; contains no MovementType branching.
 *
 * Consumes the central canonical movementConfig.js policy for destination and posting validation.
 */

const {
  validateMovementPostingPayload,
  verifyReceivingLocationInSap
} = require('../../../common/movementConfig');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue301Payload(data) {
  return validateMovementPostingPayload('301', data);
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
