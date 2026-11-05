'use strict';
/* global window, document */

/** Tier A read-only E2E: dashboard and login shell screens, and the sidebar every signed-in screen shares. */

const { runScreens, openSession, openHash, inspectScreen, waitForRoute } = require('../support/screenCheck');

const SIGNED_IN = [
    { name: 'Default route (dashboard)', hash: '', route: 'default' },
    { name: 'Dashboard', hash: 'dashboard', route: 'dashboard' },
    { name: 'Dashboard, Sales section URL', hash: 'dashboard/sd', route: 'dashboard' }
];
const SIGNED_OUT = [
    { name: 'Login screen', hash: 'login', route: 'login' }
];
// Device.system.phone needs a phone user agent with touch, not just a narrow window
const PHONE = {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
};
const ITEM = { overview: 'sideNavOverview', mm: 'sideNavMM', sd: 'sideNavSD', ewm: 'sideNavEWM', admin: 'sideNavAdmin' };
const SECTION = { overview: 'sectionOverview', mm: 'sectionMM', sd: 'sectionSD', ewm: 'sectionEWM', admin: 'sectionAdmin' };

/** The sidebar's highlighted key and the dashboard sections currently on screen. */
const shellState = (page) => page.evaluate((sections) => {
    const Element = window.sap.ui.require('sap/ui/core/Element');
    const byId = (suffix) => Element.registry.filter((c) => c.getId().endsWith('--' + suffix))[0];
    const shown = (dom) => !!dom && dom.getClientRects().length > 0;
    return {
        selected: byId('appSideNavigation').getSelectedKey(),
        sections: Object.keys(sections).filter((key) => shown(byId(sections[key]) && byId(sections[key]).getDomRef()))
    };
}, SECTION);

/** Collects failures into errors and logs one line, like runScreens. */
function step(errors, details, name, problems) {
    console.log(`  [${problems.length ? 'FAIL' : 'PASS'}] ${name}`);
    problems.forEach((p) => {
        console.log(`      - ${p}`);
        errors.push(`${name}: ${p}`);
    });
    details.push({ step: name, status: problems.length ? 'FAIL' : 'PASS', errors: problems });
}

async function verifySidebar(baseUrl) {
    console.log('\n=== Shell sidebar (READ-ONLY, write guard on) ===');
    const errors = [];
    const details = [];
    const session = await openSession({ baseUrl });
    const { page } = session;
    let metricsCalls = 0;
    page.on('request', (req) => { if (req.url().includes('getDashboardMetrics')) metricsCalls++; });

    const expectState = async (hash, key) => {
        const problems = [];
        const screen = await inspectScreen(page);
        const state = await shellState(page);
        if (screen.hash !== hash) problems.push(`expected hash "${hash}", got "${screen.hash}"`);
        if (state.selected !== key) problems.push(`expected highlight ${key}, got ${state.selected}`);
        return { problems, state };
    };
    const expectSection = async (hash, key) => {
        const { problems, state } = await expectState(hash, key);
        if (state.sections.join() !== key) problems.push(`expected only section ${key}, got [${state.sections}]`);
        return problems;
    };
    const click = async (suffix) => {
        await page.click(`[id$="--${suffix}"]`);
        await session.settle();
    };

    try {
        await openHash(session, 'dashboard');
        step(errors, details, 'Dashboard opens on Overview', await expectSection('dashboard', 'overview'));

        const sideWidth = () => page.evaluate(() => document.querySelector('.sapTntToolPageAside').getBoundingClientRect().width);
        const closedWidth = await sideWidth();
        step(errors, details, 'The sidebar starts closed, as an icon strip', closedWidth > 0 && closedWidth < 100 ? [] : [`sidebar width ${closedWidth}px`]);

        // Everything below also runs on the closed sidebar's icons, so the closed state stays usable
        const loaded = metricsCalls;
        for (const key of ['mm', 'sd', 'ewm', 'admin']) {
            if (key === 'admin') {
                await click('sideNavUserMaster');
                await page.locator('.sapMPopover').getByText('Administrator', { exact: true }).click();
                await session.settle();
            } else {
                await click(ITEM[key]);
            }
            step(errors, details, `Sidebar item ${key} opens its section`, await expectSection(`dashboard/${key}`, key));
            if (key === 'mm' && !(await page.locator('[id$="--btnMMCreatePO"]').isVisible() && await page.locator('[id$="--btnMMManagePOs"]').isVisible())) {
                step(errors, details, 'Procurement keeps Create PO and Manage Orders', ['a button is not visible']);
            }
            if (key === 'admin') {
                const adminList = await page.evaluate(() => {
                    const Element = window.sap.ui.require('sap/ui/core/Element');
                    const table = Element.registry.filter((control) => control.getId().endsWith('--adminUsersTable'))[0];
                    if (!table) return null;
                    const row = table.getItems().find((item) => item.getBindingContext('adminView'));
                    const cells = row ? row.getCells() : [];
                    const context = row && row.getBindingContext('adminView');
                    const actions = cells[7] && cells[7].getItems ? cells[7].getItems() : [];
                    return {
                        headers: table.getColumns().map((column) => column.getHeader().getText()),
                        detailsAvailable: context ? context.getProperty('detailsAvailable') : null,
                        fullName: context ? context.getProperty('fullName') : '',
                        displayedFullName: cells[2] && cells[2].getHtmlText ? cells[2].getDomRef().textContent : '',
                        protectedReason: context ? context.getProperty('protectedReason') : '',
                        status: cells[3] && cells[3].getText ? cells[3].getText() : '',
                        visibleActions: actions
                            .filter((control) => control.isA('sap.m.Button') && control.getVisible())
                            .map((control) => control.getText())
                    };
                });
                const problems = [];
                const requiredHeaders = ['Username', 'Full Name', 'Lock Status', 'User Type', 'Last Changed', 'Changed By', 'Actions'];
                if (!adminList) {
                    problems.push('Admin user table was not found');
                } else {
                    requiredHeaders.forEach((header) => {
                        if (!adminList.headers.includes(header)) problems.push(`missing ${header} column`);
                    });
                    if (adminList.headers.includes('Valid From') || adminList.headers.includes('Valid To')) {
                        problems.push('validity date columns should not be shown in the Admin list');
                    }
                    if (adminList.fullName && adminList.displayedFullName !== adminList.fullName) {
                        problems.push('Full Name cell does not display its bound value');
                    }
                    if (!adminList.status) problems.push('first row has no visible lock/detail status');
                    if (!adminList.visibleActions.includes('View Detail')) problems.push('first row has no View Detail action');
                    if (adminList.detailsAvailable === true && !adminList.protectedReason
                        && !adminList.visibleActions.some((action) => action === 'Lock User' || action === 'Unlock User')) {
                        problems.push('first row has no applicable Lock/Unlock action');
                    }
                    if (adminList.detailsAvailable === false
                        && adminList.visibleActions.some((action) => action === 'Lock User' || action === 'Unlock User')) {
                        problems.push('Lock/Unlock is enabled despite unavailable SAP detail');
                    }
                }
                step(errors, details, 'Admin user list shows status fields and safe row actions', problems);
            }
        }
        await click(ITEM.overview);
        step(errors, details, 'Sidebar Overview returns to the plain dashboard URL', await expectSection('dashboard', 'overview'));
        step(errors, details, 'Switching section does not reload the figures', metricsCalls === loaded ? [] : [`${metricsCalls - loaded} extra metrics call(s)`]);

        await click('tileOverviewEWM');
        step(errors, details, 'An Overview tile opens its section and moves the highlight', await expectSection('dashboard/ewm', 'ewm'));

        await click('tileGoodsReceipt');
        step(errors, details, 'A section tile opens its screen and keeps the highlight', (await expectState('wm/goods-receipt', 'ewm')).problems);

        const beforeReturn = metricsCalls;
        await click(ITEM.ewm);
        const back = await expectSection('dashboard/ewm', 'ewm');
        if (metricsCalls === beforeReturn) back.push('figures were not reloaded on returning from another screen');
        step(errors, details, 'The highlighted item returns from a screen to its section', back);

        for (const [hash, key] of [['mm/purchase-orders/create', 'mm'], ['sd/sales-orders', 'sd'], ['le/orders-due', 'sd'], ['wm/hu-stock-transfer', 'ewm']]) {
            await openHash(session, hash);
            step(errors, details, `Direct URL ${hash} highlights ${key}`, (await expectState(hash, key)).problems);
        }

        await openHash(session, 'dashboard/bogus');
        step(errors, details, 'An unknown section shows the Overview', await expectSection('dashboard/bogus', 'overview'));

        await page.click('.sapFShellBar button[title="Menu"]');
        await page.waitForTimeout(500); // the sidebar slides open
        const openWidth = await sideWidth();
        await click(ITEM.mm);
        const stillOpen = await sideWidth();
        const toggle = openWidth > 100 ? [] : [`menu button left the sidebar at ${openWidth}px`];
        if (stillOpen !== openWidth) toggle.push(`sidebar width changed from ${openWidth}px to ${stillOpen}px after a selection`);
        step(errors, details, 'Desktop: the menu button opens the sidebar and a selection keeps it open', toggle);

        const blockedOrFailed = session.consoleErrors.concat(session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), session.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'No console error, failed request or blocked write', blockedOrFailed);
    } catch (err) {
        step(errors, details, 'Sidebar flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }

    const viewer = await openSession({ baseUrl, user: 'test-viewer-1120' });
    try {
        await openHash(viewer, 'dashboard/admin');
        const seen = await shellState(viewer.page);
        const problems = [];
        if (await viewer.page.locator(`[id$="--${ITEM.admin}"]`).count()) problems.push('Administrator item is rendered for a non-admin');
        if (await viewer.page.locator('[id$="--sideNavUserMaster"]').count()) problems.push('User Master group is rendered for a non-admin');
        if (seen.selected !== 'overview') problems.push(`expected highlight overview, got ${seen.selected}`);
        if (seen.sections.join() !== 'overview') problems.push(`expected only section overview, got [${seen.sections}]`);
        step(errors, details, 'A non-admin sees no User Master group, and the Administrator URL shows the Overview', problems);
    } catch (err) {
        step(errors, details, 'Non-admin sidebar', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await viewer.close();
    }

    const signedOut = await openSession({ baseUrl, user: null });
    try {
        await openHash(signedOut, 'login');
        const hidden = await signedOut.page.evaluate(() => {
            const header = document.querySelector('.sapTntToolPageHeaderWrapper');
            return { aside: !!document.querySelector('.sapTntToolPageAside'), headerHeight: header ? header.getBoundingClientRect().height : 0 };
        });
        const problems = [];
        if (hidden.aside) problems.push('sidebar is rendered on the login screen');
        if (hidden.headerHeight > 0) problems.push(`empty header strip of ${hidden.headerHeight}px on the login screen`);
        step(errors, details, 'Login shows no sidebar and no header strip', problems);
    } catch (err) {
        step(errors, details, 'Login shell', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await signedOut.close();
    }

    const phone = await openSession({ baseUrl, contextOptions: PHONE });
    try {
        await openHash(phone, 'dashboard');
        const asideOnScreen = () => phone.page.evaluate(() => {
            const aside = document.querySelector('.sapTntToolPageAside');
            return !!aside && aside.getBoundingClientRect().right > 0;
        });
        const problems = [];
        if (await asideOnScreen()) problems.push('sidebar is open when the page opens');
        await phone.page.click('.sapFShellBar button[title="Menu"]');
        await phone.page.waitForTimeout(500); // the sidebar slides in
        if (!(await asideOnScreen())) problems.push('the menu button did not open the sidebar');
        await phone.page.click(`[id$="--${ITEM.sd}"]`);
        await phone.settle();
        await phone.page.waitForTimeout(500);
        if (await asideOnScreen()) problems.push('the sidebar stayed open after a selection');
        const screen = await inspectScreen(phone.page);
        if (screen.hash !== 'dashboard/sd') problems.push(`expected hash "dashboard/sd", got "${screen.hash}"`);
        step(errors, details, 'Phone: the menu button opens the sidebar and a selection closes it', problems);
    } catch (err) {
        step(errors, details, 'Phone sidebar', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await phone.close();
    }

    return { errors, details };
}

const adminLinkState = (page) => page.evaluate(() => {
    const Element = window.sap.ui.require('sap/ui/core/Element');
    const table = Element.registry.filter((c) => c.getId().endsWith('--adminUsersTable'))[0];
    return {
        search: table.getModel('adminView').getProperty('/filters/search'),
        rows: table.getItems().map((item) => item.getBindingContext('adminView').getProperty('username'))
    };
});

/** The Sub-User Master layout and the side pane as rendered. */
const paneState = (page) => page.evaluate(() => {
    const Element = window.sap.ui.require('sap/ui/core/Element');
    const byId = (suffix) => Element.registry.filter((c) => c.getId().endsWith('--' + suffix))[0];
    const shown = (control) => !!control && !!control.getDomRef() && control.getDomRef().getClientRects().length > 0;
    const pane = byId('userDetailPane');
    const table = byId('adminUsersTable');
    return {
        layout: byId('adminUserLayout').getLayout(),
        listShown: shown(table),
        paneShown: shown(pane),
        title: byId('userDetailTitle').getText(),
        text: shown(pane) ? pane.getDomRef().innerText : '',
        error: shown(byId('userDetailError')) ? byId('userDetailError').getText() : '',
        lockShown: shown(byId('btnLockUser')),
        unlockShown: shown(byId('btnUnlockUser')),
        navigated: table.getItems().filter((item) => item.getNavigated()).map((item) => item.getBindingContext('adminView').getProperty('username')),
        dialogOpen: !!document.querySelector('.sapMDialog'),
        actionInWindow: ['btnLockUser', 'btnUnlockUser'].some((id) => shown(byId(id)) && byId(id).getDomRef().getBoundingClientRect().bottom <= window.innerHeight)
    };
});

const PANE_ROWS = [
    { username: 'ALPHA', fullName: 'Alpha User', detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20261103', lastChangedBy: 'ADMIN' },
    { username: 'BETA', fullName: 'Beta User', detailsAvailable: true, isLocked: true, userType: 'A', lastChanged: '20261104', lastChangedBy: 'ADMIN' },
    { username: 'BROKEN', fullName: 'Broken User', detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20261104', lastChangedBy: 'ADMIN' }
];
const paneDetail = (username, isLocked) => ({
    username, fullName: `${username} Full Name`, email: `${username}@example.test`, phone: '555 100', department: 'IT', jobFunction: 'Admin', company: 'ACME',
    userType: 'A', userGroup: 'GRP', validFrom: '00000000', validTo: '99991231', lastLogonDate: '20261102', lastLogonTime: '101500', createdOn: '20250101', createdBy: 'CREATOR',
    lockedGlobal: isLocked ? 'L' : 'U', lockedLocal: 'U', lockedWrong: 'U', lockedNoPw: 'U', isLocked,
    language: 'E', dateFormat: '1', decimalFormat: 'X', timeZone: 'INDIA', costCenter: 'CC1',
    roleCount: 1, profileCount: 1, lastChanged: '20261103', lastChangedTime: '091500', lastChangedBy: 'ADMIN',
    roles: [{ name: 'Z_ROLE', description: 'Role text', validFrom: '20250101', validTo: '99991231' }],
    profiles: [{ name: 'Z_PROFILE', description: 'Profile text' }]
});

async function verifyUserDetailPane(baseUrl) {
    console.log('\n=== User detail side pane (controlled rows then one live read, write guard on) ===');
    const errors = [];
    const details = [];
    const session = await openSession({ baseUrl });
    const { page } = session;
    const posts = [];
    page.on('request', (req) => { if (req.method() === 'POST' && /lockUser|unlockUser/.test(req.url())) posts.push(req.url()); });

    const expect = (state, wanted) => Object.keys(wanted)
        .filter((key) => String(state[key]) !== String(wanted[key]))
        .map((key) => `expected ${key} ${wanted[key]}, got ${state[key]}`);
    const openRow = async (username) => {
        await page.locator('[id$="--adminUsersTable"] tr', { hasText: username }).locator('td').nth(2).click();
        await session.settle();
        await page.waitForTimeout(600); // the column animation
    };

    try {
        await page.route('**/odata/v4/user-management/listUsers*', (route) => route.fulfill({ json: { value: PANE_ROWS } }));
        await page.route('**/odata/v4/user-management/getUserDetail*', (route) => {
            const username = decodeURIComponent(route.request().url().match(/username='([^']*)'/)[1]);
            if (username === 'BROKEN') return route.fulfill({ status: 502, json: { error: { code: '502', message: 'SAP read failed' } } });
            return route.fulfill({ json: paneDetail(username, username === 'BETA') });
        });
        await openHash(session, 'dashboard/admin');

        step(errors, details, 'The list starts alone, with no pane', expect(await paneState(page), { layout: 'OneColumn', listShown: true, paneShown: false }));

        await openRow('ALPHA');
        const opened = await paneState(page);
        const openProblems = expect(opened, { layout: 'TwoColumnsBeginExpanded', listShown: true, paneShown: true, title: 'ALPHA', error: '', dialogOpen: false, lockShown: true, unlockShown: false, navigated: 'ALPHA', actionInWindow: true });
        ['ALPHA Full Name', 'ALPHA@example.test', '555 100', 'IT', 'ACME', 'Dialog', 'GRP', '31-12-9999', '02-11-2026 10:15:00', 'CREATOR', 'Not Locked',
            'DD.MM.YYYY (Gregorian Date)', '1,234,567.89', 'INDIA', 'CC1', 'Z_ROLE', 'Role text', 'Z_PROFILE', 'Profile text', '03-11-2026 09:15:00'].forEach((text) => {
            if (!opened.text.includes(text)) openProblems.push(`pane does not show "${text}"`);
        });
        step(errors, details, 'A row opens the right pane beside the list, with the SAP details and no dialog', openProblems);

        await openRow('BETA');
        const locked = await paneState(page);
        const lockedProblems = expect(locked, { title: 'BETA', lockShown: false, unlockShown: true, navigated: 'BETA' });
        if (locked.text.includes('ALPHA')) lockedProblems.push('the previous user is still shown');
        step(errors, details, 'Another row replaces the pane and offers Unlock for a locked user', lockedProblems);

        await page.locator('[id$="--btnUnlockUser"]').click();
        await page.locator('.sapMDialog').getByRole('button', { name: 'Cancel' }).click();
        await session.settle();
        step(errors, details, 'Unlock in the pane asks first, and Cancel sends nothing to SAP', posts.length ? [`sent ${posts}`] : []);

        const consoleBefore = session.consoleErrors.length;
        const networkBefore = session.networkErrors.length;
        await openRow('BROKEN');
        const failed = await paneState(page);
        const failedProblems = expect(failed, { title: 'BROKEN', lockShown: false, unlockShown: false, paneShown: true });
        if (!failed.error) failedProblems.push('no error is shown in the pane');
        if (failed.text.includes('BETA')) failedProblems.push('the previous user is still shown');
        step(errors, details, 'A failed SAP read shows the error, no old data and no lock action', failedProblems);
        session.consoleErrors.splice(consoleBefore);
        session.networkErrors.splice(networkBefore);

        await page.click('[id$="--btnCloseUserDetail"]');
        await page.waitForTimeout(600);
        step(errors, details, 'Close returns the list to full width', expect(await paneState(page), { layout: 'OneColumn', paneShown: false, navigated: '' }));

        await openHash(session, 'dashboard/admin?search=BETA');
        await session.settle();
        const searched = await adminLinkState(page);
        const linked = searched.search === 'BETA' && searched.rows.join() === 'BETA' ? [] : [`search "${searched.search}", rows [${searched.rows}]`];
        step(errors, details, 'A link with ?search= opens the list with that username searched', linked);
        await page.locator('[id$="--btnClearAdminFilters"]').click();
        await session.settle();

        const problems = session.consoleErrors.concat(session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), session.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'Side pane flow: no unexpected console error, failed request or blocked write', problems);
    } catch (err) {
        step(errors, details, 'Side pane flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }

    const live = await openSession({ baseUrl });
    try {
        await openHash(live, 'dashboard/admin');
        const username = await live.page.evaluate(() => {
            const Element = window.sap.ui.require('sap/ui/core/Element');
            const table = Element.registry.filter((c) => c.getId().endsWith('--adminUsersTable'))[0];
            return table.getItems()[0].getBindingContext('adminView').getProperty('username');
        });
        await live.page.locator('[id$="--adminUsersTable"] tr', { hasText: username }).first().locator('td').nth(2).click();
        await live.settle();
        await live.page.waitForTimeout(600);
        const state = await paneState(live.page);
        const problems = expect(state, { paneShown: true, title: username, error: '' });
        if (!state.lockShown && !state.unlockShown) problems.push('no lock action for a loaded user');
        if (!/Roles \(\d+\)/.test(state.text) || !/Profiles \(\d+\)/.test(state.text)) problems.push('the role and profile lists are missing');
        problems.push(...live.consoleErrors, ...live.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), ...live.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'READ-ONLY: a live row opens its BAPI_USER_GET_DETAIL details', problems);
    } catch (err) {
        step(errors, details, 'Live side pane', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await live.close();
    }
    return { errors, details };
}

const BULK_ROWS = [
    { username: 'ALPHA', fullName: 'Alpha User', detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20260101', lastChangedBy: 'ADMIN', protectedReason: '' },
    { username: 'BETA', fullName: 'Beta User', detailsAvailable: true, isLocked: true, userType: 'A', lastChanged: '20260102', lastChangedBy: 'DRATHOD', protectedReason: '' },
    { username: 'NOAUTH', fullName: '=Formula User', detailsAvailable: true, isLocked: false, userType: 'C', lastChanged: '20260103', lastChangedBy: 'ADMIN', protectedReason: '' },
    { username: 'SVC', fullName: 'Service User', detailsAvailable: true, isLocked: false, userType: 'S', lastChanged: '20260104', lastChangedBy: 'ADMIN', protectedReason: 'type' },
    { username: 'ME', fullName: 'Logged In', detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20260105', lastChangedBy: 'ADMIN', protectedReason: 'self' },
    { username: 'SLOW1', fullName: 'Slow One', detailsAvailable: true, isLocked: false, userType: 'L', lastChanged: '20260106', lastChangedBy: 'ADMIN', protectedReason: '' }
];

const bulkState = (page) => page.evaluate(() => {
    const Element = window.sap.ui.require('sap/ui/core/Element');
    const byId = (suffix) => Element.registry.filter((c) => c.getId().endsWith('--' + suffix))[0];
    const shown = (control) => !!control && !!control.getDomRef() && control.getDomRef().getClientRects().length > 0;
    const table = byId('adminUsersTable');
    const rowFor = (name) => table.getItems().find((item) => item.getBindingContext('adminView').getProperty('username') === name);
    return {
        rows: table.getItems().map((item) => item.getBindingContext('adminView').getProperty('username')),
        showing: byId('adminShowingText').getText(),
        kpis: Object.fromEntries(['Total', 'Active', 'Locked'].map((k) => [k, byId('adminKpi' + k).getDomRef().innerText.replace(/\D+/g, ' ').trim()])),
        lockedSelected: byId('adminKpiLocked').getDomRef().getAttribute('data-selected'),
        lockFilter: byId('adminLockStatusFilter').getSelectedKey(),
        chips: byId('adminFilterChips').getTokens().map((t) => t.getText()),
        selectionShown: shown(byId('adminSelectionToolbar')),
        selectionText: byId('adminSelectionCount').getText(),
        canLock: byId('btnBulkLock').getEnabled(),
        canUnlock: byId('btnBulkUnlock').getEnabled(),
        protectedBoxes: ['SVC', 'ME', 'ALPHA'].map((name) => { const box = rowFor(name) && rowFor(name).getCells()[0]; return box ? `${name}:${box.getEnabled()}:${box.getTooltip_AsString()}` : `${name}:none`; }),
        rowLock: ['SVC', 'ALPHA'].map((name) => { const row = rowFor(name); return row ? `${name}:${row.getCells()[7].getItems().filter((c) => c.getVisible()).map((c) => c.getText()).join('+')}` : `${name}:none`; }),
        confirmOpen: byId('userBulkConfirmDialog').isOpen(),
        preview: byId('userBulkPreview').getText(),
        progressOpen: byId('userBulkProgressDialog').isOpen(),
        progressText: byId('userBulkProgress').getDisplayValue(),
        resultOpen: byId('userBulkResultDialog').isOpen(),
        summary: byId('userBulkSummary').getText(),
        notify: byId('userBulkNotify').getText(),
        results: byId('userBulkResults').getItems().map((item) => { const r = item.getBindingContext('adminView').getObject(); return `${r.username}:${r.status}:${r.technical}`; }),
        retryShown: shown(byId('btnBulkRetry')),
        undoShown: shown(byId('adminUndoStrip')),
        highlighted: [...document.querySelectorAll('[id$="--adminUsersTable"] .adminSearchMatch')].map((e) => e.textContent),
        selected: table.getModel('adminView').getProperty('/users').filter((u) => u.selected).map((u) => u.username)
    };
});

async function verifyBulkFlow(baseUrl) {
    console.log('\n=== Sub-User Master KPIs, filters and bulk actions (SAP stubbed; nothing reaches SAP, write guard on) ===');
    const errors = [];
    const details = [];
    const session = await openSession({ baseUrl });
    const { page } = session;
    const lockState = Object.fromEntries(BULK_ROWS.map((row) => [row.username, row.isLocked]));
    const posts = [];
    let noAuthFails = true;
    let hold = null;

    const expect = (state, wanted) => Object.keys(wanted)
        .filter((key) => String(state[key]) !== String(wanted[key]))
        .map((key) => `expected ${key} "${wanted[key]}", got "${state[key]}"`);
    const tick = async (name) => {
        await page.locator('[id$="--adminUsersTable"] tr', { hasText: name }).locator('.sapMCb').first().click();
        await page.waitForTimeout(150);
    };
    const pressBtn = async (suffix) => {
        await page.locator(`[id$="--${suffix}"]`).click();
    };
    const waitDialog = (suffix) => page.waitForFunction((id) => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        return Element.registry.filter((c) => c.getId().endsWith('--' + id))[0].isOpen();
    }, suffix);

    try {
        await page.route('**/odata/v4/user-management/listUsers*', (route) => route.fulfill({
            json: { value: BULK_ROWS.map((row) => ({ ...row, isLocked: lockState[row.username] })) }
        }));
        await page.route('**/odata/v4/user-management/getUserDetail*', (route) => {
            const username = decodeURIComponent(route.request().url().match(/username='([^']*)'/)[1]);
            return route.fulfill({ json: { ...paneDetail(username, lockState[username]), protectedReason: '' } });
        });
        await page.route('**/odata/v4/user-management/getBulkLockEmailStatus*', (route) => route.fulfill({ json: { status: 'sent' } }));
        await page.route('**/odata/v4/user-management/getLockMonitor*', (route) => route.fulfill({
            json: { state: 'ok', lastCheckedAt: new Date().toISOString(), recipient: 'alerts@example.test', pollIntervalSec: 60, maxPerEmail: 50, pendingEmails: 0 }
        }));
        await page.route(/\/odata\/v4\/user-management\/(lock|unlock)User$/, async (route) => {
            const body = route.request().postDataJSON();
            const lock = route.request().url().endsWith('/lockUser');
            posts.push(`${lock ? 'lock' : 'unlock'}:${body.username}:${body.reason}`);
            if (hold && body.username === hold.name) await hold.gate;
            if (body.username === 'NOAUTH' && noAuthFails) {
                return route.fulfill({ status: 502, json: { error: { code: 'SU/001', message: 'SAP error: No authorization' } } });
            }
            lockState[body.username] = lock;
            return route.fulfill({ json: { success: true, status: 'success', messages: [], message: `User ${body.username} done` } });
        });
        await page.evaluate(() => window.sessionStorage.clear()).catch(() => {});
        await openHash(session, 'dashboard/admin');

        await page.waitForFunction(() => {
            const Element = window.sap.ui.require('sap/ui/core/Element');
            return /^Lock monitor: Active/.test(Element.registry.filter((c) => c.getId().endsWith('--adminLockMonitor'))[0].getText());
        });
        await page.locator('[id$="--btnNotifySettings"]').click();
        await page.locator('.sapMPopover').getByText('alerts@example.test').waitFor();
        const settingsProblems = (await page.locator('.sapMPopover').getByText('60 seconds').count()) ? [] : ['the interval is not shown'];
        const dot = await page.evaluate(() => window.sap.ui.require('sap/ui/core/Element').registry.filter((c) => c.getId().endsWith('--adminLockMonitor'))[0].getState());
        if (dot !== 'Success') settingsProblems.push(`status dot is ${dot}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        step(errors, details, 'The header shows the lock monitor with a green dot, and the settings show recipient and interval', settingsProblems);

        const start = await bulkState(page);
        step(errors, details, 'KPI cards count the whole list', expect({ ...start, t: start.kpis.Total, a: start.kpis.Active, l: start.kpis.Locked, s: start.showing }, { t: '6', a: '5', l: '1', s: 'Showing 6 of 6 users' }));

        const protectedProblems = [];
        if (!start.protectedBoxes[0].startsWith('SVC:false:System and Service')) protectedProblems.push(`SVC box: ${start.protectedBoxes[0]}`);
        if (!start.protectedBoxes[1].startsWith('ME:false:You cannot lock')) protectedProblems.push(`ME box: ${start.protectedBoxes[1]}`);
        if (!start.protectedBoxes[2].startsWith('ALPHA:true')) protectedProblems.push(`ALPHA box: ${start.protectedBoxes[2]}`);
        if (start.rowLock[0].includes('Lock User')) protectedProblems.push(`SVC row: ${start.rowLock[0]}`);
        if (!start.rowLock[1].includes('Lock User')) protectedProblems.push(`ALPHA row: ${start.rowLock[1]}`);
        step(errors, details, 'Protected users cannot be selected or row-locked, and say why', protectedProblems);

        await page.click('[id$="--adminKpiLocked"]');
        await session.settle();
        const carded = await bulkState(page);
        const cardProblems = expect(carded, { rows: 'BETA', lockedSelected: 'true', lockFilter: 'locked', showing: 'Showing 1 of 6 users' });
        if (carded.chips.join() !== 'Lock Status: Locked') cardProblems.push(`chips: ${carded.chips}`);
        await page.click('[id$="--adminKpiLocked"]');
        await session.settle();
        cardProblems.push(...expect(await bulkState(page), { lockedSelected: 'false', lockFilter: '', showing: 'Showing 6 of 6 users' }));
        step(errors, details, 'A KPI card filters, selects itself, syncs the filter and chip, and clears on a second click', cardProblems);

        const box = page.locator('[id$="--adminUserSearchField"] input');
        await box.fill('user');
        await page.waitForTimeout(450);
        const found = await bulkState(page);
        const foundProblems = expect(found, { showing: 'Showing 4 of 6 users' });
        if (!found.highlighted.length || !found.highlighted.every((text) => text.toLowerCase() === 'user')) foundProblems.push(`highlight: ${found.highlighted}`);
        await box.fill('');
        await page.waitForTimeout(450);
        step(errors, details, 'Search matches the full name after the debounce, and highlights the match', foundProblems);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.evaluate(() => window.sessionStorage.setItem('admin.userList.state', JSON.stringify({ filters: { lockStatus: 'locked', userTypes: [], changedBy: [], changedFrom: '', changedTo: '', search: '' }, sort: null })));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForRoute(page);
        await session.settle();
        await page.waitForFunction(() => document.querySelector('[id$="--adminUsersTable"] tbody'));
        await page.waitForTimeout(500);
        step(errors, details, 'A refresh keeps the saved filter', expect(await bulkState(page), { rows: 'BETA', lockFilter: 'locked' }));
        await page.locator('[id$="--btnClearAdminFilters"]').click();
        await session.settle();

        const [csvDownload] = await Promise.all([page.waitForEvent('download'), pressBtn('btnExportUsers')]);
        const csvText = require('fs').readFileSync(await csvDownload.path(), 'utf8');
        const csvProblems = [];
        if (!csvText.includes('\'=Formula User')) csvProblems.push('a formula-like name was not neutralized');
        if (csvText.trim().split('\r\n').length !== 7) csvProblems.push(`${csvText.trim().split('\r\n').length} lines`);
        step(errors, details, 'Export downloads the filtered rows as safe CSV', csvProblems);

        await tick('ALPHA');
        await tick('BETA');
        await tick('NOAUTH');
        const picked = await bulkState(page);
        step(errors, details, 'Selecting rows shows the toolbar with Lock and Unlock enabled', expect(picked, { selectionShown: true, selectionText: '3 selected', canLock: true, canUnlock: true }));

        await pressBtn('btnBulkLock');
        await waitDialog('userBulkConfirmDialog');
        const confirm = await bulkState(page);
        const confirmProblems = expect(confirm, { preview: 'ALPHA, NOAUTH' });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        if ((await bulkState(page)).confirmOpen) confirmProblems.push('Esc did not close the dialog');
        if (posts.length) confirmProblems.push(`calls before confirming: ${posts}`);
        step(errors, details, 'The confirm dialog previews the users, closes on Esc, and sends nothing until confirmed', confirmProblems);

        await pressBtn('btnBulkLock');
        await waitDialog('userBulkConfirmDialog');
        await page.locator('[id$="--userBulkReason"] textarea').fill('Offboarding');
        await pressBtn('btnBulkConfirm');
        await waitDialog('userBulkResultDialog');
        await page.waitForTimeout(300);
        const result = await bulkState(page);
        await page.waitForFunction(() => {
            const Element = window.sap.ui.require('sap/ui/core/Element');
            return Element.registry.filter((c) => c.getId().endsWith('--userBulkNotify'))[0].getText() === 'Sent';
        });
        const resultProblems = expect(await bulkState(page), { summary: '1 succeeded · 1 failed · 1 skipped', retryShown: true, selected: 'NOAUTH', undoShown: true, notify: 'Sent' });
        if (!posts.includes('lock:ALPHA:Offboarding') || posts.some((p) => p.includes('BETA'))) resultProblems.push(`posts: ${posts}`);
        if (!result.results.some((r) => r === 'NOAUTH:error:E SU/001: SAP error: No authorization')) resultProblems.push(`results: ${result.results}`);
        if (!result.results.some((r) => r.startsWith('BETA:skipped'))) resultProblems.push(`results: ${result.results}`);
        step(errors, details, 'The result shows per-user BAPI messages, skips the already locked, and keeps the failed selected', resultProblems);

        noAuthFails = false;
        posts.length = 0;
        await pressBtn('btnBulkRetry');
        await page.waitForFunction(() => {
            const Element = window.sap.ui.require('sap/ui/core/Element');
            const dialog = Element.registry.filter((c) => c.getId().endsWith('--userBulkSummary'))[0];
            return dialog.getText() === '1 succeeded · 0 failed · 0 skipped';
        });
        const retried = await bulkState(page);
        const retryProblems = expect(retried, { selected: '' });
        if (posts.join() !== 'lock:NOAUTH:Offboarding') retryProblems.push(`posts: ${posts}`);
        step(errors, details, 'Retry failed runs only the failed user', retryProblems);

        await page.locator('.sapMDialog:visible').getByRole('button', { name: 'Close' }).click();
        await page.waitForTimeout(400);
        posts.length = 0;
        await page.locator('[id$="--adminUndoLink"]').click();
        await page.waitForFunction(() => {
            const Element = window.sap.ui.require('sap/ui/core/Element');
            return Element.registry.filter((c) => c.getId().endsWith('--userBulkSummary'))[0].getText() === '2 succeeded · 0 failed · 0 skipped';
        });
        const undoProblems = [];
        if (posts.slice().sort().join() !== 'unlock:ALPHA:Undo of a bulk action,unlock:NOAUTH:Undo of a bulk action') undoProblems.push(`posts: ${posts}`);
        if ((await bulkState(page)).undoShown) undoProblems.push('undo is still offered after undoing');
        step(errors, details, 'Undo unlocks exactly the users the run succeeded on', undoProblems);
        await page.locator('.sapMDialog:visible').getByRole('button', { name: 'Close' }).click();
        await page.waitForTimeout(400);

        await page.locator('[id$="--adminSelectAll"]').click();
        await page.waitForTimeout(200);
        const all = await bulkState(page);
        step(errors, details, 'Select all takes only selectable filtered users', expect(all, { selected: 'ALPHA,BETA,NOAUTH,SLOW1', selectionText: '4 selected' }));

        let release;
        hold = { name: 'ALPHA', gate: new Promise((resolve) => { release = resolve; }) };
        posts.length = 0;
        await page.locator('[id$="--btnClearSelection"]').click();
        await page.waitForTimeout(150);
        await tick('ALPHA');
        await pressBtn('btnBulkLock');
        await waitDialog('userBulkConfirmDialog');
        await pressBtn('btnBulkConfirm');
        await waitDialog('userBulkProgressDialog');
        const running = await bulkState(page);
        const progressProblems = expect(running, { progressOpen: true, progressText: '0 / 1 processed' });
        await pressBtn('btnBulkCancel');
        release();
        await waitDialog('userBulkResultDialog');
        await page.waitForTimeout(300);
        progressProblems.push(...expect(await bulkState(page), { summary: '1 succeeded · 0 failed · 0 skipped', progressOpen: false }));
        step(errors, details, 'The progress dialog counts calls and lets the running call finish on Cancel', progressProblems);
        await page.locator('.sapMDialog:visible').getByRole('button', { name: 'Close' }).click();

        const problems = session.consoleErrors.filter((m) => !/502/.test(m)).concat(
            session.networkErrors.filter((e) => e.status !== 502).map((e) => `HTTP ${e.status} ${e.url}`),
            session.blocked.map((b) => `write guard blocked ${b.reason}`)
        );
        step(errors, details, 'Bulk flow: no unexpected console error, failed request or blocked write', problems);
    } catch (err) {
        step(errors, details, 'Bulk flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }
    return { errors, details };
}

/** The User Master group as rendered: its expansion, the child's visibility and both highlights. */
const groupState = (page) => page.evaluate(() => {
    const Element = window.sap.ui.require('sap/ui/core/Element');
    const group = document.querySelector('[id$="--sideNavUserMaster"]');
    const child = document.querySelector('[id$="--sideNavAdmin"]');
    return {
        hash: window.location.hash,
        // The control's state: on UI5 1.136.22 the link's aria-expanded stays "true" after a collapse
        expanded: Element.registry.filter((c) => c.getId().endsWith('--sideNavUserMaster'))[0].getExpanded(),
        childShown: !!child && child.getClientRects().length > 0,
        childSelected: !!child && child.classList.contains('sapTntNLISelected'),
        groupSelected: group.querySelector('.sapTntNLIFirstLevel').classList.contains('sapTntNLISelected'),
        focused: document.activeElement && document.activeElement.id
    };
});

async function verifyUserMasterGroup(baseUrl) {
    console.log('\n=== User Master group in the sidebar (READ-ONLY, write guard on) ===');
    const errors = [];
    const details = [];
    const session = await openSession({ baseUrl });
    const { page } = session;
    const popoverChild = page.locator('.sapMPopover').getByText('Administrator', { exact: true });
    const pressKey = async (key) => {
        await page.keyboard.press(key);
        await page.waitForTimeout(300); // the expand animation
    };
    const expectGroup = (state, wanted) => Object.keys(wanted)
        .filter((key) => state[key] !== wanted[key])
        .map((key) => `expected ${key} ${wanted[key]}, got ${state[key]}`);

    try {
        await openHash(session, 'dashboard');

        await page.click('[id$="--sideNavUserMaster"]');
        await popoverChild.waitFor();
        step(errors, details, 'Closed sidebar: the group opens a popover and does not navigate', expectGroup(await groupState(page), { hash: '#/dashboard' }));

        await popoverChild.click();
        await session.settle();
        const viaPopover = expectGroup(await groupState(page), { hash: '#/dashboard/admin', groupSelected: true });
        if (await page.locator('.sapMPopover:visible').count()) viaPopover.push('the popover stayed open');
        step(errors, details, 'Closed sidebar: the child routes to the Administrator section and highlights the group', viaPopover);

        await page.click('[id$="--sideNavOverview"]');
        await session.settle();
        await page.focus('[id$="--sideNavUserMaster-a"]');
        await pressKey('Enter');
        await popoverChild.waitFor();
        await pressKey('Escape');
        const escaped = (await page.locator('.sapMPopover:visible').count()) ? ['Escape left the popover open'] : [];
        await page.focus('[id$="--sideNavUserMaster-a"]');
        await pressKey('Enter');
        await popoverChild.waitFor();
        await pressKey('Enter');
        await session.settle();
        escaped.push(...expectGroup(await groupState(page), { hash: '#/dashboard/admin' }));
        step(errors, details, 'Closed sidebar: Enter opens the popover, Escape closes it, Enter selects the child', escaped);

        await page.click('.sapFShellBar button[title="Menu"]');
        await page.waitForTimeout(500); // the sidebar slides open
        step(errors, details, 'Open sidebar: the group shows its selected child with the child highlighted', expectGroup(await groupState(page), {
            hash: '#/dashboard/admin', expanded: true, childShown: true, childSelected: true, groupSelected: false
        }));

        await page.click('[id$="--sideNavUserMaster-a"]');
        await page.waitForTimeout(1000); // the collapse animation
        const toggled = expectGroup(await groupState(page), { hash: '#/dashboard/admin', expanded: false, childShown: false });
        await page.click('[id$="--sideNavUserMaster-a"]');
        await page.waitForTimeout(300);
        toggled.push(...expectGroup(await groupState(page), { hash: '#/dashboard/admin', expanded: true, childShown: true }));
        step(errors, details, 'Open sidebar: pressing the group only collapses and expands it', toggled);

        await page.click('[id$="--sideNavOverview"]');
        await session.settle();
        const cleared = expectGroup(await groupState(page), { hash: '#/dashboard', childSelected: false });
        await page.click('[id$="--sideNavAdmin"]');
        await session.settle();
        cleared.push(...expectGroup(await groupState(page), { hash: '#/dashboard/admin', childSelected: true }));
        step(errors, details, 'Open sidebar: the highlight follows the selection and the child routes by click', cleared);

        await page.click('[id$="--sideNavOverview"]');
        await session.settle();
        await page.focus('[id$="--sideNavUserMaster-a"]');
        await pressKey('Enter');
        const keys = expectGroup(await groupState(page), { hash: '#/dashboard', expanded: false });
        await pressKey('Space');
        keys.push(...expectGroup(await groupState(page), { hash: '#/dashboard', expanded: true }));
        await pressKey('ArrowLeft');
        keys.push(...expectGroup(await groupState(page), { hash: '#/dashboard', expanded: false }));
        await pressKey('ArrowRight');
        keys.push(...expectGroup(await groupState(page), { hash: '#/dashboard', expanded: true }));
        await pressKey('ArrowDown');
        const onChild = await groupState(page);
        if (!/--sideNavAdmin-a$/.test(onChild.focused || '')) keys.push(`ArrowDown moved focus to ${onChild.focused}`);
        await pressKey('Enter');
        await session.settle();
        keys.push(...expectGroup(await groupState(page), { hash: '#/dashboard/admin', childSelected: true }));
        step(errors, details, 'Open sidebar: Enter, Space and arrows work the group; Enter selects the child', keys);

        const failed = session.consoleErrors.concat(session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), session.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'User Master flow: no console error, failed request or blocked write', failed);
    } catch (err) {
        step(errors, details, 'User Master flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }
    return { errors, details };
}

// Controlled rows, so sort and filter are proven whatever SAP holds. UI proof only: listUsers itself is covered above.
const ADMIN_ROWS = [
    { username: 'BETA', fullName: 'Beta User', detailsAvailable: true, isLocked: true, userType: 'A', lastChanged: '20261104', lastChangedBy: 'ADMIN' },
    { username: 'ALPHA', fullName: 'Alpha User', detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20261103', lastChangedBy: 'ADMIN' },
    { username: 'GAMMA', fullName: 'GAMMA', detailsAvailable: false, isLocked: null, userType: null, lastChanged: null, lastChangedBy: null }
];

/** What the Sub-User Master table currently shows. */
const adminTableState = (page) => page.evaluate(() => {
    const Element = window.sap.ui.require('sap/ui/core/Element');
    const table = Element.registry.filter((c) => c.getId().endsWith('--adminUsersTable'))[0];
    const toolbar = table.getHeaderToolbar();
    return {
        title: toolbar.getContent()[0].getText(),
        toolbarIds: toolbar.getContent().map((c) => c.getId().split('--').pop()),
        filterBarIds: ['adminLockStatusFilter', 'adminUserTypeFilter', 'adminChangedByFilter', 'adminChangedRangeFilter', 'adminUserSearchField']
            .filter((id) => Element.registry.filter((c) => c.getId().endsWith('--' + id)).length),
        rows: table.getItems().map((item) => item.getBindingContext('adminView').getProperty('username')),
        indicator: table.getColumns()[1].getSortIndicator(),
        busy: table.getBusy(),
        noData: Element.registry.filter((c) => c.getId().endsWith('--adminNoDataText'))[0].getText()
    };
});

async function verifyAdminTable(baseUrl) {
    console.log('\n=== Sub-User Master table and dashboard header (UI proof with controlled rows, write guard on) ===');
    const errors = [];
    const details = [];
    const session = await openSession({ baseUrl });
    const { page } = session;
    const searches = [];

    const expectRows = (state, title, rows) => {
        const problems = [];
        if (state.title !== title) problems.push(`expected title "${title}", got "${state.title}"`);
        if (state.rows.join() !== rows.join()) problems.push(`expected rows [${rows}], got [${state.rows}]`);
        return problems;
    };
    const chooseFilter = async (text) => {
        await page.click('[id$="--adminLockStatusFilter"]');
        await page.locator('.sapMSelectList li:visible', { hasText: new RegExp(`^${text}$`) }).click();
        await session.settle();
    };
    const sortUsername = async () => {
        await page.locator('[id$="--adminUsersTable"] th a', { hasText: 'Username' }).click();
        await session.settle();
    };
    const search = async (text) => {
        await page.locator('[id$="--adminUserSearchField"] input').fill(text);
        await page.locator('[id$="--adminUserSearchField"] input').press('Enter');
    };

    try {
        await page.route('**/odata/v4/user-management/listUsers*', async (route) => {
            const query = decodeURIComponent(route.request().url().match(/search='([^']*)'/)[1]);
            searches.push(query);
            await new Promise((resolve) => setTimeout(resolve, 300)); // long enough to see the busy state
            await route.fulfill({ json: { value: ADMIN_ROWS.filter((row) => row.username.includes(query)) } });
        });
        await openHash(session, 'dashboard/admin');

        const initial = await adminTableState(page);
        const problems = expectRows(initial, 'Sub-User Master (3)', ['BETA', 'ALPHA', 'GAMMA']);
        ['btnExportUsers', 'btnRefreshUsers'].forEach((id) => {
            if (!initial.toolbarIds.includes(id)) problems.push(`${id} is not in the table toolbar`);
        });
        if (initial.filterBarIds.length !== 5) problems.push(`filter bar has only ${initial.filterBarIds}`);
        step(errors, details, 'Sub-User Master shows the bound rows, with its controls in the toolbar', problems);

        await sortUsername();
        const ascending = await adminTableState(page);
        const sorted = expectRows(ascending, 'Sub-User Master (3)', ['ALPHA', 'BETA', 'GAMMA']);
        if (ascending.indicator !== 'Ascending') sorted.push(`indicator is ${ascending.indicator}`);
        await sortUsername();
        const descending = await adminTableState(page);
        sorted.push(...expectRows(descending, 'Sub-User Master (3)', ['GAMMA', 'BETA', 'ALPHA']));
        if (descending.indicator !== 'Descending') sorted.push(`indicator is ${descending.indicator}`);
        step(errors, details, 'A column header sorts the rows and toggles direction', sorted);

        await chooseFilter('Locked');
        const locked = expectRows(await adminTableState(page), 'Sub-User Master (1)', ['BETA']);
        await chooseFilter('Active');
        locked.push(...expectRows(await adminTableState(page), 'Sub-User Master (1)', ['ALPHA']));
        await chooseFilter('Details unavailable');
        locked.push(...expectRows(await adminTableState(page), 'Sub-User Master (1)', ['GAMMA']));
        await chooseFilter('All');
        locked.push(...expectRows(await adminTableState(page), 'Sub-User Master (3)', ['GAMMA', 'BETA', 'ALPHA']));
        step(errors, details, 'The lock status filter narrows the rows and the toolbar count', locked);

        await search('NOMATCH');
        await page.waitForTimeout(400); // the search debounce
        const empty = await adminTableState(page);
        const searching = expectRows(empty, 'Sub-User Master (0)', []);
        if (empty.noData !== 'No users match your filters.') searching.push(`empty text is "${empty.noData}"`);
        if (searches.length !== 1) searching.push(`search called the server ${searches.length - 1} extra time(s)`);
        step(errors, details, 'Search filters on the page, and shows the no-match text', searching);

        await search('');
        await page.waitForTimeout(400);
        await chooseFilter('Locked');
        await page.locator('[id$="--btnRefreshUsers"]').click();
        await page.waitForTimeout(100);
        const refreshing = (await adminTableState(page)).busy ? [] : ['table is not busy during a refresh'];
        await session.settle();
        refreshing.push(...expectRows(await adminTableState(page), 'Sub-User Master (1)', ['BETA']));
        step(errors, details, 'A refresh shows the busy state, and the filter still applies after it', refreshing);

        const card = await page.evaluate(() => ({
            text: document.body.innerText.includes('Integrated S/4HANA business'),
            greeting: document.body.innerText.includes('Welcome back'),
            controls: ['dashboardConnectionStatus', 'btnQuickCreatePO', 'btnQuickManagePOs', 'btnRefreshDashboard']
                .filter((id) => document.querySelector(`[id$="--${id}"]`))
        }));
        const cardProblems = card.controls.map((id) => `${id} is still rendered`);
        if (card.text) cardProblems.push('the card text is still shown');
        if (card.greeting) cardProblems.push('the Welcome greeting is still shown');
        step(errors, details, 'The dashboard header card is gone', cardProblems);

        const failed = session.consoleErrors.concat(session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), session.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'Sub-User Master flow: no console error, failed request or blocked write', failed);
    } catch (err) {
        step(errors, details, 'Sub-User Master flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }
    return { errors, details };
}

/** The active theme, what is saved, and the page background as actually painted. */
const themeState = (page) => page.evaluate(() => ({
    active: window.sap.ui.require('sap/ui/core/Theming').getTheme(),
    saved: window.localStorage.getItem('app.theme'),
    background: window.getComputedStyle(document.body).backgroundColor
}));

async function verifyThemeSwitcher(baseUrl) {
    console.log('\n=== Theme switcher (READ-ONLY, write guard on) ===');
    const errors = [];
    const details = [];
    const session = await openSession({ baseUrl });
    const { page } = session;
    const defaultCss = [];
    const watchDefaultCss = (p) => p.on('request', (req) => { if (/\/themes\/sap_horizon\/.*\.css/.test(req.url())) defaultCss.push(req.url()); });
    watchDefaultCss(page);

    const expectTheme = (state, theme) => {
        const problems = [];
        if (state.active !== theme) problems.push(`expected active theme ${theme}, got ${state.active}`);
        if (state.saved !== theme) problems.push(`expected saved theme ${theme}, got ${state.saved}`);
        return problems;
    };
    const reload = async (p, s) => {
        await p.reload({ waitUntil: 'domcontentloaded' });
        await waitForRoute(p);
        await s.settle();
    };
    const menuActive = (p) => p.evaluate(() => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const menu = Element.registry.filter((c) => c.getId().endsWith('--shellThemeMenu'))[0];
        return menu.getItems()[0].getItems().filter((i) => i.getSelected()).map((i) => i.getKey());
    });

    try {
        await openHash(session, 'dashboard');
        const before = await themeState(page);
        const problems = before.active === 'sap_horizon' ? [] : [`first visit is on ${before.active}, not the default`];
        await page.evaluate(() => { window.__sameDocument = true; });

        await page.click('[id$="--shellThemeButton"]');
        await page.getByText('Evening Horizon', { exact: true }).click();
        await page.waitForFunction(() => window.sap.ui.require('sap/ui/core/Theming').getTheme() === 'sap_horizon_dark');
        await page.waitForFunction((bg) => window.getComputedStyle(document.body).backgroundColor !== bg, before.background, { timeout: 15000 });
        const selected = await themeState(page);
        problems.push(...expectTheme(selected, 'sap_horizon_dark'));
        if (!(await page.evaluate(() => window.__sameDocument))) problems.push('selecting a theme reloaded the page');
        const active = await menuActive(page);
        if (active.join() !== 'sap_horizon_dark') problems.push(`menu marks [${active}] as active`);
        step(errors, details, 'Selecting a theme applies it without a reload, saves it and marks it active', problems);

        defaultCss.length = 0;
        await reload(page, session);
        const refreshed = expectTheme(await themeState(page), 'sap_horizon_dark');
        if (defaultCss.length) refreshed.push(`default theme CSS was requested first: ${defaultCss[0]}`);
        const activeAfter = await menuActive(page);
        if (activeAfter.join() !== 'sap_horizon_dark') refreshed.push(`menu marks [${activeAfter}] as active after a refresh`);
        step(errors, details, 'The theme survives a refresh, and default theme CSS is never requested', refreshed);

        const tab = await page.context().newPage();
        watchDefaultCss(tab);
        defaultCss.length = 0;
        await tab.goto(`${baseUrl}/fiori-app/webapp/index.html#/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForRoute(tab);
        await tab.waitForLoadState('networkidle').catch(() => {});
        const newTab = expectTheme(await themeState(tab), 'sap_horizon_dark');
        if (defaultCss.length) newTab.push(`default theme CSS was requested first: ${defaultCss[0]}`);
        await tab.close();
        step(errors, details, 'The theme survives in a new tab', newTab);

        await page.evaluate(() => window.localStorage.setItem('app.theme', 'not_a_theme'));
        await reload(page, session);
        const invalid = await themeState(page);
        step(errors, details, 'An invalid saved value falls back to the default', invalid.active === 'sap_horizon' ? [] : [`active theme is ${invalid.active}`]);

        await page.evaluate(() => window.localStorage.removeItem('app.theme'));
        await reload(page, session);
        const missing = await themeState(page);
        step(errors, details, 'A missing saved value uses the default', missing.active === 'sap_horizon' ? [] : [`active theme is ${missing.active}`]);

        const failed = session.consoleErrors.concat(session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), session.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'Theme flow: no console error, failed request or blocked write', failed);
    } catch (err) {
        step(errors, details, 'Theme flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
    }
    return { errors, details };
}

async function verifyShellScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const a = await runScreens({ baseUrl, title: 'Shell screens', steps: SIGNED_IN });
    const b = await runScreens({ baseUrl, user: null, title: 'Shell login', steps: SIGNED_OUT });
    const c = await verifySidebar(baseUrl);
    const d = await verifyThemeSwitcher(baseUrl);
    const e = await verifyAdminTable(baseUrl);
    const f = await verifyUserMasterGroup(baseUrl);
    const g = await verifyUserDetailPane(baseUrl);
    const h = await verifyBulkFlow(baseUrl);
    const errors = a.errors.concat(b.errors, c.errors, d.errors, e.errors, f.errors, g.errors, h.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details, c.details, d.details, e.details, f.details, g.details, h.details) };
}

if (require.main === module) {
    verifyShellScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyShellScreens };
