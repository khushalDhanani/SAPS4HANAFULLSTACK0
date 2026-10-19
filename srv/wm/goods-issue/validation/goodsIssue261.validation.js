/**
 * goodsIssue261.validation.js
 * ISOLATED business rules for Movement Type 261 ONLY (Goods Issue to Order).
 * Serves no other movement type; contains no MovementType branching.
 *
 * Consumes the central canonical movementConfig.js policy.
 */

const {
  validateMovementPostingPayload,
  validateMovement261Payload
} = require('../../../common/movementConfig');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue261Payload(data) {
  return validateMovement261Payload(data);
}

module.exports = {
  validateGoodsIssue261Payload,
  validateMovementPostingPayload
};
