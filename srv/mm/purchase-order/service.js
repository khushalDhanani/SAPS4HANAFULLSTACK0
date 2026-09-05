const cds = require('@sap/cds');
const registerPurchaseOrderHandlers = require('./handlers/purchaseOrder.handler');
const registerValueHelpHandlers = require('../../handlers/valueHelp.handler');

/**
 * PurchaseOrderService Implementation for SAP MM Purchase Order module.
 */
module.exports = cds.service.impl(async function() {
    registerValueHelpHandlers(this);
    registerPurchaseOrderHandlers(this);
});
