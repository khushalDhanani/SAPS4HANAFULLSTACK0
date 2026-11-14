'use strict';

/** Verifies the Purchase Orders Ask AI panel renders and closes without submitting a prompt. */

const { openSession, openHash } = require('../support/screenCheck');

async function verifyPurchaseOrderAskAI(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const errors = [];
    const session = await openSession({ baseUrl });
    const aiRequests = [];

    try {
        await openHash(session, 'mm/purchase-orders');
        const page = session.page;
        // The isolated SAP-free server deliberately cannot serve the PO list; dismiss its expected load-error dialog.
        const loadError = page.locator('.sapMDialog').filter({ hasText: 'Error Loading Purchase Orders' });
        if (await loadError.isVisible()) {
            await loadError.getByRole('button', { name: 'Close', exact: true }).click();
            await loadError.waitFor({ state: 'hidden', timeout: 10000 });
        }
        page.on('request', (request) => {
            if (/\/odata\/v4\/ai\/chat(?:\?|$)/.test(request.url())) {
                aiRequests.push(`${request.method()} ${request.url()}`);
            }
        });

        const launcher = page.locator('[id$="--btnAskAI"]');
        await launcher.waitFor({ state: 'visible', timeout: 15000 });
        await launcher.click();

        const widget = page.locator('[id$="--aiWidget"]');
        await widget.waitFor({ state: 'visible', timeout: 15000 });
        if (!(await widget.locator('.aiHeaderTitle').isVisible())) errors.push('Ask AI title is not visible');
        if (!(await page.locator('[id$="--aiInput"]').isVisible())) errors.push('Ask AI input is not visible');

        const close = widget.locator('.aiWidgetHeader button').nth(1);
        await close.click();
        await widget.waitFor({ state: 'hidden', timeout: 10000 });
        if (!(await launcher.isVisible())) errors.push('Ask AI launcher did not return after closing the panel');
        if (aiRequests.length) errors.push(`opening/closing the panel sent an AI chat request: ${aiRequests.join(', ')}`);
        if (session.blocked.length) errors.push(`write guard blocked request(s): ${session.blocked.map((r) => r.reason).join(', ')}`);
        session.consoleErrors.filter((e) => e.startsWith('PAGEERROR')).forEach((e) => errors.push(`uncaught page error: ${e}`));
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        await session.close();
    }

    const status = errors.length ? 'FAIL' : 'PASS';
    console.log(`  [${status}] Purchase Orders Ask AI panel renders/closes without a chat request`);
    errors.forEach((error) => console.log(`      - ${error}`));
    return { status, errors, details: [{ step: 'Ask AI panel open/render/close', status, errors }] };
}

if (require.main === module) {
    verifyPurchaseOrderAskAI().then((result) => process.exit(result.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyPurchaseOrderAskAI };
