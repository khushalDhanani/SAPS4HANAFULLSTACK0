const cds = require('@sap/cds');
const GoodsIssueHandler = require('./handlers/goodsIssue.handler');

/**
 * GoodsIssueService Implementation for LE-WM Goods Issue against Order/Reservation (Movement 261).
 * Binds CAP service handlers to S/4HANA GoodsIssueAdapter.
 */
module.exports = cds.service.impl(async function() {
    GoodsIssueHandler.init(this);
});
