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


// Register local development S4_USERNAME in mock auth users if running in development
if (process.env.NODE_ENV !== 'production' && process.env.S4_USERNAME) {
    const s4User = process.env.S4_USERNAME.trim();
    cds.env.requires = cds.env.requires || {};
    cds.env.requires.auth = cds.env.requires.auth || {};
    cds.env.requires.auth.users = cds.env.requires.auth.users || {};
    const devRoles = ['Admin', 'Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager'];
    cds.env.requires.auth.users[s4User] = { roles: devRoles };
    cds.env.requires.auth.users[s4User.toLowerCase()] = { roles: devRoles };
    cds.env.requires.auth.users[s4User.toUpperCase()] = { roles: devRoles };
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
    // Readiness endpoint for the Cloud Foundry HTTP health check declared in mta.yaml
    // (readiness-health-check-http-endpoint: /health). Registered before CAP mounts its
    // protocol adapters and auth middleware, so it needs no credentials and never touches S/4HANA.
    app.get('/health', (req, res) => {
        res.set('Cache-Control', 'no-store').status(200).json({ status: 'UP' });
    });

    // Set Permissions-Policy header to eliminate Chromium 'unload is not allowed' violation warnings
    app.use((req, res, next) => {
        res.setHeader('Permissions-Policy', 'unload=*');
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
        next();
    });

    // In local development, verify Bearer tokens (JWT with standard XSUAA claims) when dev issuer is explicitly enabled
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

// Register local development Bearer token verification into CAP OData middleware chain when dev issuer is enabled
cds.middlewares.add(localTokenUtil.applyBearerToken, { before: 'auth' });

// Auto-seed local development SQLite database from db/data if BusinessConfig is empty
cds.on('served', async () => {
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        try {
            const db = cds.db;
            if (db) {
                const countResult = await db.run(cds.ql.SELECT.from('saps4hana.wm.BusinessConfig').columns('count(*) as count'));
                const count = countResult?.[0]?.count || 0;
                if (!count) {
                    const fs = require('fs');
                    const path = require('path');
                    const csvPath = path.resolve(__dirname, 'db/data/saps4hana.wm-BusinessConfig.csv');
                    if (fs.existsSync(csvPath)) {
                        const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n').filter(Boolean);
                        if (lines.length > 1) {
                            const headers = lines[0].split(';');
                            for (let i = 1; i < lines.length; i++) {
                                const values = lines[i].split(';');
                                const entry = {};
                                headers.forEach((h, idx) => {
                                    const val = (values[idx] || '').trim();
                                    if (h === 'Active') {
                                        entry[h] = val === 'true' || val === '1';
                                    } else if (val) {
                                        entry[h] = val;
                                    }
                                });
                                await db.run(cds.ql.INSERT.into('saps4hana.wm.BusinessConfig').entries(entry));
                            }
                        }
                    }
                }
            }
        } catch (_) {
            // Table may not exist yet or not initialized; no-op
        }
    }
});

// Delegate to default CAP server bootstrap
module.exports = cds.server;
