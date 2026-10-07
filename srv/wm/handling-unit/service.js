const cds = require('@sap/cds');
const HandlingUnitAdapter = require('../../integration/s4hana/wm/HandlingUnitAdapter');
const plantScope = require('./plantScope');

/** Thin CAP binding; validation, the SAP reads and the BAPI writes live in HandlingUnitAdapter. */
module.exports = class HandlingUnitService extends cds.ApplicationService {
  async init() {
    const adapter = new HandlingUnitAdapter();
    // Plant authorization (server-side; never from the browser) — see ./plantScope.
    const scope = (req) => plantScope(req.user);
    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {}, req);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };
    this.on('list', run((data, req) => adapter.list({ ...data, allowedPlants: scope(req) })));
    this.on('detail', run((data, req) => adapter.detail({ ...data, allowedPlants: scope(req) })));
    this.on('hierarchy', run((data, req) => adapter.hierarchy({ ...data, allowedPlants: scope(req) })));
    this.on('valueHelp', run((data, req) => adapter.valueHelp({ ...data, allowedPlants: scope(req) })));
    this.on('statusKpis', run((data, req) => adapter.statusKpis({ allowedPlants: scope(req) })));
    this.on('serials', run((data, req) => adapter.serials({ ...data, allowedPlants: scope(req) })));
    this.on('labels', run((data, req) => adapter.labels({ ...data, allowedPlants: scope(req) })));
    // Write actions keep their role guards; plant scope is applied additively (403 for an HU/plant outside scope).
    this.on('create', run((data, req) => adapter.create({ ...data, allowedPlants: scope(req) })));
    this.on('pack', run((data, req) => adapter.pack({ ...data, allowedPlants: scope(req) })));
    this.on('unpack', run((data, req) => adapter.unpack({ ...data, allowedPlants: scope(req) })));
    this.on('remove', run((data, req) => adapter.remove({ ...data, allowedPlants: scope(req) })));
    return super.init();
  }
};
