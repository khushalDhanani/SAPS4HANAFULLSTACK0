const cds = require('@sap/cds');
const WarehouseManagementHandler = require('./handlers/warehouseManagement.handler');

/**
 * WarehouseManagementService Implementation for SAP EWM module.
 * Binds domain handlers to S/4HANA EWM integration adapter.
 */
module.exports = class WarehouseManagementService extends cds.ApplicationService {
    async init() {
        if (typeof WarehouseManagementHandler.init === 'function') {
            WarehouseManagementHandler.init(this);
        } else {
            WarehouseManagementHandler(this);
        }
        return super.init();
    }
};
