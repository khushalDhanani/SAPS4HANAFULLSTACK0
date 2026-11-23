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

    it('dry-run stub answers the action POST with the respond() result and records the call', async () => {
        const routes = [];
        const page = { route: async (match, handler) => { routes.push({ match, handler }); } };
        const calls = await interceptAction(page, {
            flow: 'customerInvoice',
            service: '/odata/v4/customer-invoice',
            action: 'releaseInvoiceToAccounting',
            respond: (body) => ({ BillingDocument: body.BillingDocument, Success: true })
        });

        const request = {
            method: () => 'POST',
            url: () => 'http://localhost:4004/odata/v4/customer-invoice/releaseInvoiceToAccounting',
            postDataJSON: () => ({ BillingDocument: '31000111' })
        };
        const fulfilled = [];
        await routes[0].handler({ request: () => request, fulfill: async (answer) => { fulfilled.push(answer); } });

        expect(fulfilled).toHaveLength(1);
        expect(fulfilled[0].status).toBe(200);
        expect(JSON.parse(fulfilled[0].body)).toEqual({ BillingDocument: '31000111', Success: true });
        expect(calls).toEqual([{ via: 'direct', body: { BillingDocument: '31000111' }, status: 200, result: { BillingDocument: '31000111', Success: true } }]);
    });
});
