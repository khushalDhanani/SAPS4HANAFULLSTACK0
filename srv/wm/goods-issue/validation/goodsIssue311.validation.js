/**
 * goodsIssue311.validation.js
 * ISOLATED business rules for Movement Type 311 ONLY (Storage Location Transfer).
 * Serves no other movement type; contains no MovementType branching.
 *
 * Consumes the central canonical movementConfig.js policy for destination and posting validation.
 */

const {
  validateMovementPostingPayload,
  validateMovement311Destination,
  verifyReceivingLocationInSap
} = require('../../../common/movementConfig');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue311Payload(data) {
  return validateMovementPostingPayload('311', data);
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
