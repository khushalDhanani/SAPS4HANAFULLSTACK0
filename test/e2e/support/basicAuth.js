'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
let cached;

/**
 * The password a development server gives its mocked users (srv/auth/mockUserPasswords.js): LOCAL_DEV_PASSWORD from
 * the environment, else from .env.local, else from .env — the order server.js loads them in. Empty when none is set.
 * A test-profile server has passwordless mocked users and takes any password, so sending this one is harmless.
 */
function localDevPassword() {
    if (cached !== undefined) return cached;
    let value = process.env.LOCAL_DEV_PASSWORD;
    for (const file of ['.env.local', '.env']) {
        if (value !== undefined) break;
        try {
            value = require('dotenv').parse(fs.readFileSync(path.join(ROOT, file))).LOCAL_DEV_PASSWORD;
        } catch (_) { /* file not present */ }
    }
    cached = String(value || '').trim();
    return cached;
}

/** Authorization header value for a CAP mocked user. */
function basicAuth(user) {
    return 'Basic ' + Buffer.from(`${user}:${localDevPassword()}`).toString('base64');
}

module.exports = { basicAuth, localDevPassword };
