const cds = require('@sap/cds');
const GoodsReceiptHandler = require('./handlers/goodsReceipt.handler');
const GoodsReceiptAdapter = require('../../integration/s4hana/wm/GoodsReceiptAdapter');
const GoodsIssueAttemptStore = require('../goods-issue/GoodsIssueAttemptStore');
const LOG = require('../../common/logger')('goods-receipt');

/**
 * GoodsReceiptService Implementation for LE-WM Goods Receipt against Purchase Order/Inbound Delivery (Movement 101).
 * Binds CAP service handlers to S/4HANA GoodsReceiptAdapter.
 */
module.exports = class GoodsReceiptService extends cds.ApplicationService {
    async init() {
        if (typeof GoodsReceiptHandler.init === 'function') {
            GoodsReceiptHandler.init(this);
        } else {
            GoodsReceiptHandler(this);
        }

        // Background re-check of receipt attempts whose outcome SAP has not confirmed.
        const every = GoodsIssueAttemptStore.GoodsIssueAttemptStore.recheckIntervalMs();
        if (every > 0 && process.env.NODE_ENV !== 'test') {
            const timer = setInterval(() => {
                GoodsIssueAttemptStore.recheckReceipts(GoodsReceiptAdapter)
                    .catch((err) => LOG.error('Receipt-attempt re-check failed:', err.message || err));
            }, every);
            timer.unref();
        }

        return super.init();
    }
};
