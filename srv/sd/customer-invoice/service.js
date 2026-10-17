const cds = require('@sap/cds');
const registerCustomerInvoiceHandlers = require('./handlers/customerInvoice.handler');

/**
 * CustomerInvoiceService Implementation for SAP SD Customer Invoices Management.
 * Binds customer billing documents reading, accounting release, and cancellation handlers.
 */
module.exports = class CustomerInvoiceService extends cds.ApplicationService {
  async init() {
    registerCustomerInvoiceHandlers(this);
    return super.init();
  }
};
