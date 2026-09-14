const cds = require('@sap/cds');
const GoodsReceiptHandler = require('./handlers/goodsReceipt.handler');

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
        return super.init();
    }
};
