const cds = require('@sap/cds');
const registerPurchaseOrderHandlers = require('./handlers/purchaseOrder.handler');
const registerValueHelpHandlers = require('../../handlers/valueHelp.handler');
const { poValueHelpConfig } = require('./handlers/valueHelp.config');

/**
 * PurchaseOrderService Implementation for SAP MM Purchase Order module.
 * Binds domain business handlers and PO value help configuration.
 */
module.exports = cds.service.impl(async function() {
    registerValueHelpHandlers(this, poValueHelpConfig);
    registerPurchaseOrderHandlers(this);
});
