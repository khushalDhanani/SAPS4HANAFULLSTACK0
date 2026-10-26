'use strict';

/** Tier A read-only E2E: dashboard and login shell screens. */

const { runScreens } = require('../support/screenCheck');

const SIGNED_IN = [
    { name: 'Default route (dashboard)', hash: '', route: 'default' },
    { name: 'Dashboard', hash: 'dashboard', route: 'dashboard' }
];
const SIGNED_OUT = [
    { name: 'Login screen', hash: 'login', route: 'login' }
];

async function verifyShellScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const a = await runScreens({ baseUrl, title: 'Shell screens', steps: SIGNED_IN });
    const b = await runScreens({ baseUrl, user: null, title: 'Shell login', steps: SIGNED_OUT });
    const errors = a.errors.concat(b.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details) };
}

if (require.main === module) {
    verifyShellScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyShellScreens };
