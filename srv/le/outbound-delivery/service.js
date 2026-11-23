const cds = require('@sap/cds');
const registerOutboundDeliveryHandlers = require('./handlers/outboundDelivery.handler');

/**
 * OutboundDeliveryService Implementation for SAP LE Outbound Delivery module.
 * Binds due orders reading, shipping points value help, and delivery creation handlers.
 */
module.exports = class OutboundDeliveryService extends cds.ApplicationService {
  async init() {
    registerOutboundDeliveryHandlers(this);
    return super.init();
  }
};
