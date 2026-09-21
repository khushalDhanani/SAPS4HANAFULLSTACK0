const cds = require('@sap/cds');
const registerSalesOrderHandlers = require('./handlers/salesOrder.handler');
const registerValueHelpHandlers = require('../../handlers/valueHelp.handler');
const { soValueHelpConfig } = require('./handlers/valueHelp.config');

/**
 * SalesOrderService Implementation for SAP SD Sales Order module.
 * Binds domain business handlers and SD value help configuration.
 */
module.exports = class SalesOrderService extends cds.ApplicationService {
    async init() {
        registerValueHelpHandlers(this, soValueHelpConfig);
        registerSalesOrderHandlers(this);
        return super.init();
    }
};
