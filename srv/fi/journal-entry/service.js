const cds = require('@sap/cds');
const { getLogger } = require('../../common/logger');
const LOG = getLogger('journal-entry');

/**
 * JournalEntryService Implementation for SAP FI Financial Accounting module.
 * Read-only projections are automatically delegated to the external S/4HANA service by CAP.
 */
module.exports = class JournalEntryService extends cds.ApplicationService {
    async init() {
        const external = await cds.connect.to('FAC_GL_JOURNALENTRY_VER_SRV');

        this.on('READ', 'JournalEntryItems', async (req) => {
            try {
                return await external.run(req.query);
            } catch (error) {
                LOG.error(`Failed to read JournalEntryItems: ${error.message}`);
                const status = typeof error.code === 'number' ? error.code : (error.status || error.statusCode || 502);
                req.error(status, error.message);
            }
        });

        return super.init();
    }
};
