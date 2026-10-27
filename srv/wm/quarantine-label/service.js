const cds = require('@sap/cds');
const QuarantineLabelAdapter = require('../../integration/s4hana/wm/QuarantineLabelAdapter');
const plantScope = require('../handling-unit/plantScope');
const businessConfigResolver = require('../../common/BusinessConfigResolver');
const { resolveOutputForPlants, addPageCheck } = require('./labelOutput');

/** Thin CAP binding; validation, plant authorization and the SAP calls live in QuarantineLabelAdapter. */
module.exports = class QuarantineLabelService extends cds.ApplicationService {
  async init() {
    const adapter = new QuarantineLabelAdapter();
    this.on('generateLabels', async (req) => {
      try {
        // Plant authorization is server-side from the authenticated user (null = Admin, unrestricted)
        const result = await adapter.generate({
          ...(req.data || {}),
          allowedPlants: plantScope(req.user),
          resolveOutput: (plants) => resolveOutputForPlants(plants, businessConfigResolver)
        });
        return addPageCheck(result);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Quarantine labels could not be generated');
      }
    });
    return super.init();
  }
};
