const cds = require('@sap/cds');
const WarehouseManagementHandler = require('./handlers/warehouseManagement.handler');

/**
 * WarehouseManagementService Implementation for SAP EWM module.
 * Binds domain handlers to S/4HANA EWM integration adapter.
 */
module.exports = cds.service.impl(async function() {
    WarehouseManagementHandler.init(this);
});
