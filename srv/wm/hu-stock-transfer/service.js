'use strict';

const cds = require('@sap/cds');
const HuStockTransferHandler = require('./handlers/huStockTransfer.handler');

class HuStockTransferService extends cds.ApplicationService {
  async init() {
    HuStockTransferHandler.init(this);
    await super.init();
  }
}

module.exports = HuStockTransferService;
