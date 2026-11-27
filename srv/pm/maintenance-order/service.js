'use strict';

const cds = require('@sap/cds');
const { throwIfTextMustShow } = require('../../common/visibleError');
const MaintenanceOrderAdapter = require('../../integration/s4hana/pm/maintenance-order/MaintenanceOrderAdapter');

/** Thin CAP binding; all SAP reads live in MaintenanceOrderAdapter. */
module.exports = class MaintenanceOrderService extends cds.ApplicationService {
    async init() {
        const adapter = new MaintenanceOrderAdapter();
        const run = (fn) => async (req) => {
            try {
                return await fn(req.data || {}, req);
            } catch (err) {
                throwIfTextMustShow(err);
                return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
            }
        };
        this.on('list', run((data) => adapter.list(data)));
        this.on('getMetrics', run(() => adapter.getMetrics()));
        return super.init();
    }
};
