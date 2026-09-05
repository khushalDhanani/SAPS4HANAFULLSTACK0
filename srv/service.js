const cds = require('@sap/cds');
const registerPurchaseOrderHandlers = require('./handlers/purchaseOrder.handler');
const registerValueHelpHandlers = require('./handlers/valueHelp.handler');

/**
 * PurchaseOrderService Implementation
 * Serves as the central dispatcher registering decoupled domain handlers.
 */
module.exports = cds.service.impl(async function() {
    registerValueHelpHandlers(this);
    registerPurchaseOrderHandlers(this);
});
