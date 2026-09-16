const cds = require('@sap/cds');
const registerPurchaseOrderHandlers = require('./handlers/purchaseOrder.handler');
const registerValueHelpHandlers = require('../../handlers/valueHelp.handler');
const { poValueHelpConfig } = require('./handlers/valueHelp.config');

/**
 * PurchaseOrderService Implementation for SAP MM Purchase Order module.
 * Binds domain business handlers and PO value help configuration.
 */
module.exports = class PurchaseOrderService extends cds.ApplicationService {
    async init() {
        registerValueHelpHandlers(this, poValueHelpConfig);
        registerPurchaseOrderHandlers(this);
        return super.init();
    }
};
