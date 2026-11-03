'use strict';
/* global window, document */

/** Tier A read-only E2E: dashboard and login shell screens, and the sidebar every signed-in screen shares. */

const { runScreens, openSession, openHash, inspectScreen } = require('../support/screenCheck');

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
const ITEM = { overview: 'sideNavOverview', mm: 'sideNavMM', sd: 'sideNavSD', ewm: 'sideNavEWM' };
const SECTION = { overview: 'sectionOverview', mm: 'sectionMM', sd: 'sectionSD', ewm: 'sectionEWM' };

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

        const loaded = metricsCalls;
        for (const key of ['mm', 'sd', 'ewm']) {
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

        const blockedOrFailed = session.consoleErrors.concat(session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`), session.blocked.map((b) => `write guard blocked ${b.reason}`));
        step(errors, details, 'No console error, failed request or blocked write', blockedOrFailed);
    } catch (err) {
        step(errors, details, 'Sidebar flow', [`${err.name}: ${err.message.split('\n')[0]}`]);
    } finally {
        await session.close();
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

async function verifyShellScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const a = await runScreens({ baseUrl, title: 'Shell screens', steps: SIGNED_IN });
    const b = await runScreens({ baseUrl, user: null, title: 'Shell login', steps: SIGNED_OUT });
    const c = await verifySidebar(baseUrl);
    const errors = a.errors.concat(b.errors, c.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details, c.details) };
}

if (require.main === module) {
    verifyShellScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyShellScreens };
