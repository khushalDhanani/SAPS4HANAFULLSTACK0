const cds = require('@sap/cds');

/**
 * JournalEntryService Implementation for SAP FI Financial Accounting module.
 * Read-only projections are automatically delegated to the external S/4HANA service by CAP.
 */
module.exports = cds.service.impl(async function() {
    const external = await cds.connect.to('FAC_GLV_GL_ACCOUNT_LINE_ITEMS_SRV');

    this.on('READ', 'JournalEntryItems', async (req) => {
        try {
            return await external.run(req.query);
        } catch (error) {
            req.error(error.code || 500, error.message);
        }
    });
});
