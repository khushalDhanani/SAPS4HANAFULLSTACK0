/** Compatibility exports; the canonical 261 validator lives in movementConfig. */
const {
  validateMovementPostingPayload,
  validateMovement261Payload
} = require('../../../common/movementConfig');

module.exports = {
  validateGoodsIssue261Payload: validateMovement261Payload,
  validateMovementPostingPayload
};
