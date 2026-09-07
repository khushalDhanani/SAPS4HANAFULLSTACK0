const cds = require('@sap/cds');
const registerSalesInquiryHandlers = require('./handlers/salesInquiry.handler');
const registerValueHelpHandlers = require('../../handlers/valueHelp.handler');
const { sdValueHelpConfig } = require('./handlers/valueHelp.config');

/**
 * SalesInquiryService Implementation for SAP SD Sales Inquiry module.
 * Binds domain business handlers and SD value help configuration.
 */
module.exports = cds.service.impl(async function() {
    registerValueHelpHandlers(this, sdValueHelpConfig);
    registerSalesInquiryHandlers(this);
});
