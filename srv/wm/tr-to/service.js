const cds = require('@sap/cds');
const TrToHandler = require('./handlers/trTo.handler');

/**
 * TrToService Implementation
 * Binds CAP service handlers to S/4HANA TrToAdapter.
 * Supports synchronous TR lookup, SU validation, and Transfer Order creation.
 */
module.exports = class TrToService extends cds.ApplicationService {
  async init() {
    if (typeof TrToHandler.init === 'function') {
      TrToHandler.init(this);
    } else {
      TrToHandler(this);
    }
    return super.init();
  }
};
