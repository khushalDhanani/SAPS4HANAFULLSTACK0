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

        for (const [hash, key] of [['mm/purchase-orders/create', 'mm'], ['sd/sales-orders', 'sd'], ['le/orders-due', 'sd'], ['wm/hu-stock-transfer/demo-rack', 'ewm']]) {
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
    const errors = a.errors.concat(b.errors, c.errors, d.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details, c.details, d.details) };
}

if (require.main === module) {
    verifyShellScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyShellScreens };
