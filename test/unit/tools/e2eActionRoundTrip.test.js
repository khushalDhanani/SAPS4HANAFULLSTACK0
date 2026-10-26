'use strict';

const { interceptAction } = require('../../e2e/support/actionRoundTrip');

describe('actionRoundTrip.interceptAction live gate', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });

    it('refuses to install live forwarding when the live gate is not satisfied, without touching the page', async () => {
        delete process.env.ALLOW_LIVE_SAP_TOOLS;
        delete process.env.E2E_SAP_WRITE_FLOWS;
        const page = { route: jest.fn() };
        await expect(interceptAction(page, { flow: 'customerInvoice', service: '/odata/v4/customer-invoice', action: 'releaseInvoiceToAccounting', live: true }))
            .rejects.toThrow(/Blocked: live forwarding .* flow "customerInvoice"/);
        expect(page.route).not.toHaveBeenCalled();
    });

    it('installs the dry-run stub route when live is not requested', async () => {
        const page = { route: jest.fn().mockResolvedValue() };
        await interceptAction(page, { flow: 'customerInvoice', service: '/odata/v4/customer-invoice', action: 'releaseInvoiceToAccounting', respond: () => ({}) });
        expect(page.route).toHaveBeenCalledTimes(1);
    });
});
