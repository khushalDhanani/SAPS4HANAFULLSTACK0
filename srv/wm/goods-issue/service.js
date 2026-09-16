const cds = require('@sap/cds');
const GoodsIssueHandler = require('./handlers/goodsIssue.handler');

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
        return super.init();
    }
};
