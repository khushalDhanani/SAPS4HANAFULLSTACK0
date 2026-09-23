const cds = require('@sap/cds');
const registerCustomerReturnHandlers = require('./handlers/customerReturn.handler');

/**
 * CustomerReturnService Implementation for SAP SD Customer Returns Management.
 * Binds customer returns reading, metrics, value helps, and creation handlers.
 */
module.exports = class CustomerReturnService extends cds.ApplicationService {
  async init() {
    registerCustomerReturnHandlers(this);
    return super.init();
  }
};
