const cds = require('@sap/cds');
require('./srv/common/logger');

// In local development, load .env.local / .env once via dotenv (no-op in production)
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    const fs = require('fs');
    const path = require('path');
    const dotenv = require('dotenv');

    const localEnvPath = path.resolve(__dirname, '.env.local');
    if (fs.existsSync(localEnvPath)) {
        dotenv.config({ path: localEnvPath });
    }
    dotenv.config({ path: path.resolve(__dirname, '.env') });
}

require('./srv/common/wmMismatchOverrideGuard').assertMismatchOverrideAllowed();
require('./srv/common/productionGuard').assertDevFlagsOff(process.env, cds.env.requires && cds.env.requires.auth);
require('./srv/common/productionGuard').assertS4ConnectionConfig(process.env);


// Fail at startup on a malformed sign-in list (APP_USER_ROLES) instead of silently allowing nobody.
if (process.env.NODE_ENV !== 'production') {
    require('./srv/auth/appUsers').parseAppUserRoles(process.env);
}

// CAP accepts any password for a mocked user without one. Outside the test profile every mocked user gets
// LOCAL_DEV_PASSWORD, or a random password when that is not set. The SAP connection user (S4_USERNAME) is not an
// application user: it is listed in APP_USER_ROLES like anyone else if it has to sign in.
{
    const mockUsers = require('./srv/auth/mockUserPasswords').protectMockUsers(process.env, cds.env.requires && cds.env.requires.auth);
    if (mockUsers.applied && mockUsers.source === 'random') {
        require('./srv/common/logger')('auth').warn(
            // Worded without "Basic <word>": the log scrubber (srv/common/logger.js) treats that as a credential.
            `Mocked users have no usable password (${mockUsers.reason}), so user-and-password ("Basic") requests are refused. ` +
            'The login screen is not affected. Set LOCAL_DEV_PASSWORD to allow them.'
        );
    }
}

const { registerDestination } = require('@sap-cloud-sdk/connectivity');

// In local development, configure credentials and register local destination if running outside BTP
if (process.env.NODE_ENV !== 'production' && process.env.S4_DESTINATION_URL) {
    const s4Config = require('./srv/common/s4Config');
    const client = s4Config.getClient();
    const headers = { 'sap-client': client };

    cds.env.requires = cds.env.requires || {};
    for (const service of ['C_PURCHASEORDER_FS_SRV', 'MM_PUR_PO_MAINT_V2_SRV', 'SD_F2370_INQY_WL_SRV', 'SD_F2369_INQY_FS_SRV', 'SD_F1873_SO_WL_SRV']) {
        const credentials = {
            url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/${service}`,
            authentication: 'BasicAuthentication',
            username: process.env.S4_USERNAME,
            password: process.env.S4_PASSWORD,
            headers: headers
        };
        cds.env.requires[service] = Object.assign(cds.env.requires[service] || { kind: 'odata-v2', model: `srv/external/${service}` }, { credentials });
        if (cds.requires && cds.requires[service]) cds.requires[service].credentials = credentials;
    }

    registerDestination({
        name: process.env.S4_DESTINATION_NAME || 'S4HANA_PO_API',
        url: process.env.S4_DESTINATION_URL,
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        authentication: 'BasicAuthentication',
        headers: headers
    });
}

const localTokenUtil = require('./srv/auth/localTokenUtil');

// Local development bootstrap handlers
cds.on('bootstrap', (app) => {
    // Plain "the process answers" endpoint, used by Docker, CI and the smoke test. The Cloud Foundry readiness
    // check declared in mta.yaml uses /health/ready (srv/common/health.js). Registered before CAP mounts its
    // protocol adapters and auth middleware, so it needs no credentials and never touches S/4HANA.
    // Behind a reverse proxy the client address is in X-Forwarded-For. Trust it only for the configured number of
    // proxy hops (TRUST_PROXY_HOPS, default 0 = direct connections): otherwise a caller could forge the address
    // the sign-in limiter counts.
    const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10);
    if (Number.isFinite(proxyHops) && proxyHops > 0) app.set('trust proxy', proxyHops);

    app.get('/health', (req, res) => {
        res.set('Cache-Control', 'no-store').status(200).json({ status: 'UP' });
    });
    // /health/live, /health/ready and /health/dependencies; /health above stays as the process-level check.
    require('./srv/common/health').registerHealth(app);

    // Set Permissions-Policy header to eliminate Chromium 'unload is not allowed' violation warnings
    app.use((req, res, next) => {
        res.setHeader('Permissions-Policy', 'unload=*');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'same-origin');
        // Intercept WWW-Authenticate header to prevent native browser modal basic auth popups
        const originalSetHeader = res.setHeader;
        res.setHeader = function (name, value) {
            if (typeof name === 'string' && name.toLowerCase() === 'www-authenticate') {
                if (typeof value === 'string' && value.toLowerCase().startsWith('basic')) {
                    // Suppress Basic auth challenge so browsers never show native modal login dialogs
                    return originalSetHeader.call(this, name, 'Bearer realm="SAPS4HANA", error="invalid_token"');
                }
            }
            return originalSetHeader.apply(this, arguments);
        };
        // Issue CSRF security token when requested via standard SAP X-CSRF-Token: Fetch
        const csrfHeader = req.headers['x-csrf-token'];
        if (csrfHeader && csrfHeader.toLowerCase() === 'fetch') {
            const crypto = require('crypto');
            res.setHeader('X-CSRF-Token', crypto.randomBytes(16).toString('hex'));
        }
        next();
    });

    // Finding DEBT-02 (Boundary 1 - Express Bootstrap Layer):
    // Verifies Bearer tokens for all root Express endpoints mounted outside the CAP OData dispatcher
    // (such as /ai/chat/stream, /admin/diagnostics/sap, and /health/diagnostic).
    // applyBearerToken caches the verified token on req._verifiedBearerToken to eliminate duplicate
    // HMAC computations when requests later proceed into the CAP OData middleware chain.
    // Full specification: docs/architecture/authentication-middleware-ordering.md
    app.use(localTokenUtil.applyBearerToken);

    // AI assistant streaming endpoint (SSE). Runs behind the CAP auth middlewares so cds.context.user is set.
    const express = require('express');
    app.post('/ai/chat/stream', express.json({ limit: '4mb' }), ...cds.middlewares.before, require('./srv/ai/service').streamHandler);

    // Serve Component-preload.js from dist in production, or return empty JS comment with HTTP 200 in development
    // to eliminate 404 net::ERR_ABORTED and module system loading failure warnings
    app.get(/Component-preload\.js$/, (req, res) => {
        const fs = require('fs');
        const path = require('path');
        const preloadDist = path.resolve(__dirname, 'app/fiori-app/dist/Component-preload.js');
        // Development serves webapp/ sources: a stale dist bundle here silently overrode every source change.
        if (process.env.NODE_ENV === 'production' && fs.existsSync(preloadDist)) {
            return res.sendFile(preloadDist);
        }
        res.type('application/javascript').send('// Component-preload.js not available in development');
    });

    // Handle UI5 Layered Repository (LRep / Flexibility) requests in local dev to eliminate 404 console errors
    app.get('/sap/bc/lrep/flex/data/:appId', (req, res) => {
        res.json({
            changes: [],
            contexts: [],
            loadModules: false
        });
    });
    app.get('/sap/bc/lrep/flex/settings', (req, res) => {
        res.json({
            isKeyUser: false,
            isAtoAvailable: false,
            isAtoDone: false,
            isProductiveSystem: false
        });
    });
});

// Ensure CAP service request context inherits verified user from Express in local development
cds.on('serving', (srv) => {
    if (process.env.NODE_ENV !== 'production') {
        srv.prepend(() => {
            srv.before('*', (req) => {
                const rawReq = req._?.req;
                if (rawReq?.user && (!req.user || req.user._is_anonymous)) {
                    req.user = rawReq.user;
                }
            });
        });
    }
});

// Finding DEBT-02 (Boundary 2 - CAP Protocol Middleware Chain):
// Ensures that all CAP OData V4 services receive the verified user before CAP's built-in auth middleware
// ({ before: 'auth' }) evaluates declarative authorization annotations (@(requires: ...)).
// Reuses req._verifiedBearerToken from Boundary 1 in O(1) time without redundant HMAC SHA-256 calculation.
// Full specification: docs/architecture/authentication-middleware-ordering.md
cds.middlewares.add(localTokenUtil.applyBearerToken, { before: 'auth' });

// Delegate to default CAP server bootstrap
if (require.main === module) {
    cds.server();
} else {
    module.exports = cds.server;
}
