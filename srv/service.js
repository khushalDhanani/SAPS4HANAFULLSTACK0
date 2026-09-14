const purchaseOrderService = require('./mm/purchase-order/service');

/**
 * CAP Application Bootstrap & Service Registration Entry Point
 *
 * Serves as the application-level bootstrap entry point, delegating to business domain
 * service modules (SAP MM -> Purchase Order) without hosting domain business logic.
 */
module.exports = purchaseOrderService;
