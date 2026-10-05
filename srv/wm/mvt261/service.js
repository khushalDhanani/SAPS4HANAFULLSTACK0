const cds = require('@sap/cds');
const Mvt261Adapter = require('../../integration/s4hana/wm/Mvt261Adapter');

/** Thin CAP binding; validation and the SAP query live in Mvt261Adapter. */
module.exports = class Mvt261Service extends cds.ApplicationService {
  async init() {
    const adapter = new Mvt261Adapter();
    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {});
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };
    this.on('findFirst', run((data) => adapter.findFirst(data)));
    this.on('openItems', run((data) => adapter.openItems(data)));
    return super.init();
  }
};
