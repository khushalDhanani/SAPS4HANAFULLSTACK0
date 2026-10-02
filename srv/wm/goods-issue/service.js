const cds = require('@sap/cds');
const GoodsIssueHandler = require('./handlers/goodsIssue.handler');
const PerTypeGoodsIssueHandler = require('./handlers/goodsIssuePerType.handler');
const GoodsIssueAttemptStore = require('./GoodsIssueAttemptStore');
const GoodsIssueIssuedSuStore = require('./GoodsIssueIssuedSuStore');
const GoodsIssueAdapter = require('../../integration/s4hana/wm/GoodsIssueAdapter');
const LOG = require('../../common/logger')('goods-issue-service');

/**
 * GoodsIssueService Implementation for LE-WM Goods Issue against Order/Reservation (Movement 261).
 * Binds CAP service handlers to S/4HANA GoodsIssueAdapter.
 */
module.exports = class GoodsIssueService extends cds.ApplicationService {
    async init() {
        if (typeof GoodsIssueHandler.init === 'function') {
            GoodsIssueHandler.init(this);
        } else {
            GoodsIssueHandler(this);
        }
        // Isolated per-movement-type posting actions (Phase 1).
        PerTypeGoodsIssueHandler.init(this);

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

        // Background release of issued Storage Units upon TO confirmation (LQUA stock drop)
        // or Material Document reversal in SAP, plus resolution of stale claiming rows.
        const suReleaseEvery = GoodsIssueIssuedSuStore.GoodsIssueIssuedSuStore.releaseIntervalMs();
        if (suReleaseEvery > 0 && process.env.NODE_ENV !== 'test') {
            const suTimer = setInterval(() => {
                GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(GoodsIssueAdapter)
                    .catch((err) => LOG.error('Issued Storage Units release job failed:', err.message || err));
            }, suReleaseEvery);
            suTimer.unref();
        }

        return super.init();
    }
};
