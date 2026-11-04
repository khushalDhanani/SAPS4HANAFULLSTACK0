'use strict';

const cds = require('@sap/cds');
const HuStockTransferHandler = require('./handlers/huStockTransfer.handler');
const GoodsIssueAttemptStore = require('../goods-issue/GoodsIssueAttemptStore');
const GoodsIssueAdapter = require('../../integration/s4hana/wm/GoodsIssueAdapter');
const LOG = require('../../common/logger')('hu-stock-transfer-service');

class HuStockTransferService extends cds.ApplicationService {
  async init() {
    HuStockTransferHandler.init(this);

    // Background re-check of posting attempts whose outcome SAP has not confirmed.
    // Not started under test or when the interval is 0.
    const every = GoodsIssueAttemptStore.GoodsIssueAttemptStore.recheckIntervalMs();
    if (every > 0 && process.env.NODE_ENV !== 'test') {
      const timer = setInterval(() => {
        GoodsIssueAttemptStore.recheck(GoodsIssueAdapter)
          .catch((err) => LOG.error('Posting-attempt re-check failed:', err.message || err));
      }, every);
      timer.unref();
    }

    await super.init();
  }
}

module.exports = HuStockTransferService;
