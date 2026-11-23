const { S4HttpClient } = require('../../S4HttpClient');
const { RfcClient } = require('../../RfcClient');
const CustomerReturnReader = require('./CustomerReturnReader');
const CustomerReturnValueHelp = require('./CustomerReturnValueHelp');
const CustomerReturnWriter = require('./CustomerReturnWriter');
const {
  _cleanOptions,
  _parseODataV2Date,
  _formatReturnHeaderRow,
  _formatReturnItemRow
} = require('./customerReturnUtils');

class CustomerReturnAdapter {
  constructor(client) {
    this.client = client?.client || client || new S4HttpClient();
    this.rfc = client?.rfcClient || new RfcClient(); // READ-ONLY master data (KNVV, T001W)
    this.reader = new CustomerReturnReader(this);
    this.valueHelp = new CustomerReturnValueHelp(this);
    this.writer = new CustomerReturnWriter(this);
  }

  async getCustomerReturns(options = {}) {
    return (this.reader || new CustomerReturnReader(this)).getCustomerReturns(options);
  }

  async getCustomerReturn(customerReturn, options = {}) {
    return (this.reader || new CustomerReturnReader(this)).getCustomerReturn(customerReturn, options);
  }

  async getCustomerReturnItems(customerReturn, options = {}) {
    return (this.reader || new CustomerReturnReader(this)).getCustomerReturnItems(customerReturn, options);
  }

  async getReturnReasons(options = {}) {
    return (this.valueHelp || new CustomerReturnValueHelp(this)).getReturnReasons(options);
  }

  async getCustomers(options = {}) {
    return (this.valueHelp || new CustomerReturnValueHelp(this)).getCustomers(options);
  }

  async getMaterials(options = {}) {
    return (this.valueHelp || new CustomerReturnValueHelp(this)).getMaterials(options);
  }

  async getPlants(options = {}) {
    return (this.valueHelp || new CustomerReturnValueHelp(this)).getPlants(options);
  }

  async getDocumentTypes(options = {}) {
    return (this.valueHelp || new CustomerReturnValueHelp(this)).getDocumentTypes(options);
  }

  async getReferenceDocuments(options = {}) {
    return (this.valueHelp || new CustomerReturnValueHelp(this)).getReferenceDocuments(options);
  }

  async createCustomerReturn(payload = {}, options = {}) {
    return (this.writer || new CustomerReturnWriter(this)).createCustomerReturn(payload, options);
  }

  async createCustomerReturnViaRfc(payload = {}, options = {}) {
    return (this.writer || new CustomerReturnWriter(this)).createCustomerReturnViaRfc(payload, options);
  }
}

module.exports = new CustomerReturnAdapter();
module.exports.CustomerReturnAdapter = CustomerReturnAdapter;
module.exports._parseODataV2Date = _parseODataV2Date;
module.exports._formatReturnHeaderRow = _formatReturnHeaderRow;
module.exports._formatReturnItemRow = _formatReturnItemRow;
module.exports._cleanOptions = _cleanOptions;
