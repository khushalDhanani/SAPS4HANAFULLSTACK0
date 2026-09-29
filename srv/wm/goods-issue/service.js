const cds = require('@sap/cds');
const GoodsIssueHandler = require('./handlers/goodsIssue.handler');
const PerTypeGoodsIssueHandler = require('./handlers/goodsIssuePerType.handler');

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
        return super.init();
    }
};
