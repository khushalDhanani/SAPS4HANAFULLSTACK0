const cds = require('@sap/cds');
const HandlingUnitAdapter = require('../../integration/s4hana/wm/HandlingUnitAdapter');

/** Thin CAP binding; validation, the SAP reads and the BAPI writes live in HandlingUnitAdapter. */
module.exports = class HandlingUnitService extends cds.ApplicationService {
  async init() {
    const adapter = new HandlingUnitAdapter();
    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {});
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };
    this.on('list', run((data) => adapter.list(data)));
    this.on('detail', run((data) => adapter.detail(data)));
    this.on('hierarchy', run((data) => adapter.hierarchy(data)));
    this.on('valueHelp', run((data) => adapter.valueHelp(data)));
    this.on('statusKpis', run(() => adapter.statusKpis()));
    this.on('serials', run((data) => adapter.serials(data)));
    this.on('labels', run((data) => adapter.labels(data)));
    this.on('create', run((data) => adapter.create(data)));
    this.on('pack', run((data) => adapter.pack(data)));
    this.on('unpack', run((data) => adapter.unpack(data)));
    this.on('remove', run((data) => adapter.remove(data)));
    return super.init();
  }
};
