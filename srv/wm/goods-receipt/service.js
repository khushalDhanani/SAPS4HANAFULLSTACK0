'use strict';

const cds = require('@sap/cds');
const GoodsReceiptHandler = require('./handlers/goodsReceipt.handler');
const GoodsReceiptAdapter = require('../../integration/s4hana/wm/GoodsReceiptAdapter');
const GoodsIssueAttemptStore = require('../goods-issue/GoodsIssueAttemptStore');
const LOG = require('../../common/logger')('goods-receipt');

/**
 * Single-worker guard: only instance 0 (primary worker) runs scheduled background timers.
 * In Cloud Foundry, CF_INSTANCE_INDEX is "0" for the primary instance and "1", "2", ... for secondary instances.
 * In local development, CF_INSTANCE_INDEX is undefined (treated as instance "0").
 */
const isWorker = (env = process.env) => (env.CF_INSTANCE_INDEX ?? '0') === '0';

/**
 * Starts the background recheck timer for unresolved goods receipt attempts.
 * Protected by single-worker scheduling to prevent dual-instance polling in 2-instance Cloud Foundry deployments.
 *
 * @param {Object} [options]
 * @param {Function} [options.getStore] - returns GoodsIssueAttemptStore
 * @param {Function} [options.getAdapter] - returns GoodsReceiptAdapter
 * @param {Object} [options.env] - environment variables (default: process.env)
 * @returns {NodeJS.Timeout|null}
 */
function startRecheckJob({
    getStore = () => GoodsIssueAttemptStore,
    getAdapter = () => GoodsReceiptAdapter,
    env = process.env
} = {}) {
    const every = GoodsIssueAttemptStore.GoodsIssueAttemptStore.recheckIntervalMs();
    const isTest = env.NODE_ENV === 'test' && String(env.RECEIPT_RECHECK_IN_TEST || '').trim() !== '1';

    if (isTest || every <= 0) {
        return null;
    }

    if (!isWorker(env)) {
        LOG.info('Goods receipt attempt re-check timer disabled on secondary Cloud Foundry instance (CF_INSTANCE_INDEX != 0)');
        return null;
    }

    const timer = setInterval(() => {
        getStore().recheckReceipts(getAdapter())
            .catch((err) => LOG.error('Receipt-attempt re-check failed:', err.message || err));
    }, every);
    timer.unref();
    return timer;
}

function stopRecheckJob(timer) {
    if (timer) {
        clearInterval(timer);
    }
}

/**
 * GoodsReceiptService Implementation for LE-WM Goods Receipt against Purchase Order/Inbound Delivery (Movement 101).
 * Binds CAP service handlers to S/4HANA GoodsReceiptAdapter.
 */
class GoodsReceiptService extends cds.ApplicationService {
    async init() {
        if (typeof GoodsReceiptHandler.init === 'function') {
            GoodsReceiptHandler.init(this);
        } else {
            GoodsReceiptHandler(this);
        }

        // Background re-check of receipt attempts whose outcome SAP has not confirmed.
        // Single-worker guarded: only instance 0 schedules the recheck timer.
        this._recheckTimer = startRecheckJob({ env: process.env });

        return super.init();
    }
}

GoodsReceiptService.isWorker = isWorker;
GoodsReceiptService.startRecheckJob = startRecheckJob;
GoodsReceiptService.stopRecheckJob = stopRecheckJob;

module.exports = GoodsReceiptService;
module.exports.isWorker = isWorker;
module.exports.startRecheckJob = startRecheckJob;
module.exports.stopRecheckJob = stopRecheckJob;
