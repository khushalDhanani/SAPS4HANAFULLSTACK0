/**
 * goodsIssue201.validation.js
 * ISOLATED business rules for Movement Type 201 ONLY (Goods Issue to Cost Center).
 * Serves no other movement type; contains no MovementType branching.
 *
 * Consumes the central canonical movementConfig.js policy.
 */

const { validateMovementPostingPayload } = require('../../../common/movementConfig');

/**
 * @param {Object} data
 * @returns {{isValid:boolean,errors:Array<{field:string,message:string}>,message:string}}
 */
function validateGoodsIssue201Payload(data) {
  return validateMovementPostingPayload('201', data);
}

module.exports = { validateGoodsIssue201Payload };
