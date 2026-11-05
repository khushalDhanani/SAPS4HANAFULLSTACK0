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
            await click(ITEM[key]);
            step(errors, details, `Sidebar item ${key} opens its section`, await expectSection(`dashboard/${key}`, key));
            if (key === 'admin') {
                const adminList = await page.evaluate(() => {
                    const Element = window.sap.ui.require('sap/ui/core/Element');
                    const table = Element.registry.filter((control) => control.getId().endsWith('--adminUsersTable'))[0];
                    if (!table) return null;
                    const row = table.getItems().find((item) => item.getBindingContext('adminView'));
                    const cells = row ? row.getCells() : [];
                    const context = row && row.getBindingContext('adminView');
                    const actions = cells[6] && cells[6].getItems ? cells[6].getItems() : [];
                    return {
                        headers: table.getColumns().map((column) => column.getHeader().getText()),
                        detailsAvailable: context ? context.getProperty('detailsAvailable') : null,
                        fullName: context ? context.getProperty('fullName') : '',
                        displayedFullName: cells[1] && cells[1].getText ? cells[1].getText() : '',
                        status: cells[2] && cells[2].getText ? cells[2].getText() : '',
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
                    if (adminList.detailsAvailable === true
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
        if (seen.selected !== 'overview') problems.push(`expected highlight overview, got ${seen.selected}`);
        if (seen.sections.join() !== 'overview') problems.push(`expected only section overview, got [${seen.sections}]`);
        step(errors, details, 'A non-admin sees no Administrator item, and its URL shows the Overview', problems);
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
        rows: table.getItems().map((item) => item.getBindingContext('adminView').getProperty('username')),
        indicator: table.getColumns()[0].getSortIndicator(),
        busy: table.getBusy(),
        noData: table.getNoDataText()
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
        ['adminLockStatusFilter', 'adminUserSearchField', 'btnRefreshUsers'].forEach((id) => {
            if (!initial.toolbarIds.includes(id)) problems.push(`${id} is not in the table toolbar`);
        });
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
        const searching = [];
        await page.waitForTimeout(100);
        if (!(await adminTableState(page)).busy) searching.push('table is not busy while the search runs');
        await session.settle();
        const empty = await adminTableState(page);
        searching.push(...expectRows(empty, 'Sub-User Master (0)', []));
        if (empty.noData !== 'No SAP users found.') searching.push(`empty text is "${empty.noData}"`);
        if (searches[searches.length - 1] !== 'NOMATCH') searching.push('search did not reach listUsers');
        step(errors, details, 'Search uses listUsers, shows the busy state and the empty text', searching);

        await search('');
        await session.settle();
        await chooseFilter('Locked');
        await page.locator('[id$="--btnRefreshUsers"]').click();
        await session.settle();
        step(errors, details, 'The filter still applies after a refresh', expectRows(await adminTableState(page), 'Sub-User Master (1)', ['BETA']));

        const header = await page.evaluate(() => ({
            greeting: document.body.innerText.includes('Welcome back'),
            kept: ['dashboardConnectionStatus', 'btnQuickCreatePO', 'btnQuickManagePOs', 'btnRefreshDashboard']
                .filter((id) => !document.querySelector(`[id$="--${id}"]`))
        }));
        const headerProblems = header.kept.map((id) => `${id} is missing`);
        if (header.greeting) headerProblems.push('the Welcome greeting is still shown');
        step(errors, details, 'The dashboard header has no greeting and keeps its status and actions', headerProblems);

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
    const errors = a.errors.concat(b.errors, c.errors, d.errors, e.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details, c.details, d.details, e.details) };
}

if (require.main === module) {
    verifyShellScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyShellScreens };
