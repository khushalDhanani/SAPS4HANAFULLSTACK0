const cds = require('@sap/cds');
const PackingInstructionAdapter = require('../../integration/s4hana/wm/PackingInstructionAdapter');

/** Thin CAP binding; validation and the SAP calls live in PackingInstructionAdapter. */
module.exports = class PackingInstructionService extends cds.ApplicationService {
  async init() {
    const adapter = new PackingInstructionAdapter();
    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {});
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };
    this.on('list', run((data) => adapter.list(data)));
    this.on('get', run((data) => adapter.get(data)));
    this.on('create', run((data) => adapter.create(data)));
    return super.init();
  }
};
