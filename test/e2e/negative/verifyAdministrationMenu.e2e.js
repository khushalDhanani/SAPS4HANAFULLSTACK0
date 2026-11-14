'use strict';

/** Verifies the admin navigation labels without loading SAP data or performing writes. */

const { openSession, openHash } = require('../support/screenCheck');

async function verifyAdministrationMenu(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const errors = [];
    const details = [];
    const record = (name, problems) => {
        details.push({ step: name, status: problems.length ? 'FAIL' : 'PASS', errors: problems });
        problems.forEach((problem) => errors.push(`${name}: ${problem}`));
        console.log(`  [${problems.length ? 'FAIL' : 'PASS'}] ${name}`);
        problems.forEach((problem) => console.log(`      - ${problem}`));
    };
    const session = await openSession({ baseUrl });

    try {
        await openHash(session, 'dashboard');
        const group = session.page.locator('[id$="--sideNavAdministration"]');
        const groupCount = await group.count();
        if (groupCount !== 1) {
            record('Admin sees the Administration group', [`found ${groupCount} matching groups`]);
            return { status: 'FAIL', errors, details };
        }

        const parentText = await group.locator('.sapTntNLIText').textContent();
        const parentProblems = parentText.trim() === 'Administration' ? [] : [`expected Administration, got ${parentText.trim()}`];
        await group.click();
        const child = session.page.locator('.sapMPopover').getByText('User Master', { exact: true });
        await child.waitFor({ timeout: 10000 });
        const hash = await session.page.evaluate(() => window.location.hash);
        if (hash !== '#/dashboard') parentProblems.push(`opening the group navigated to ${hash}`);
        record('Admin sees Administration with User Master nested beneath it', parentProblems);

        const problems = [];
        if (session.blocked.length) problems.push(`write guard blocked ${session.blocked.length} request(s)`);
        record('Menu check sends no write request', problems);
    } catch (err) {
        record('Administration menu', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }

    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifyAdministrationMenu().then((result) => process.exit(result.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyAdministrationMenu };
