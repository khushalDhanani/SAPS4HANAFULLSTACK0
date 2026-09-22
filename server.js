const cds = require('@sap/cds');
require('./srv/common/logger');

// In local development, load .env.local / .env once via dotenv (no-op in production)
if (process.env.NODE_ENV !== 'production') {
    const fs = require('fs');
    const path = require('path');
    const dotenv = require('dotenv');

    const localEnvPath = path.resolve(__dirname, '.env.local');
    if (fs.existsSync(localEnvPath)) {
        dotenv.config({ path: localEnvPath });
    }
    dotenv.config({ path: path.resolve(__dirname, '.env') });
}

// Register local development S4_USERNAME in mock auth users if running in development
if (process.env.NODE_ENV !== 'production' && process.env.S4_USERNAME) {
    const s4User = process.env.S4_USERNAME.trim();
    cds.env.requires = cds.env.requires || {};
    cds.env.requires.auth = cds.env.requires.auth || {};
    cds.env.requires.auth.users = cds.env.requires.auth.users || {};
    const devRoles = ['Admin', 'Viewer', 'PurchasingManager', 'FinanceViewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager'];
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

    const credsFS = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV`,
        authentication: 'BasicAuthentication',
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    const credsMaint = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV`,
        authentication: 'BasicAuthentication',
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    const credsFI = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/FAC_GL_JOURNALENTRY_VER_SRV`,
        authentication: 'BasicAuthentication',
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    const credsSDWL = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/SD_F2370_INQY_WL_SRV`,
        authentication: 'BasicAuthentication',
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    const credsSDFS = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/SD_F2369_INQY_FS_SRV`,
        authentication: 'BasicAuthentication',
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    const credsSDSO = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/SD_F1873_SO_WL_SRV`,
        authentication: 'BasicAuthentication',
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    cds.env.requires = cds.env.requires || {};
    cds.env.requires.C_PURCHASEORDER_FS_SRV = Object.assign(cds.env.requires.C_PURCHASEORDER_FS_SRV || { kind: 'odata-v2', model: 'srv/external/C_PURCHASEORDER_FS_SRV' }, { credentials: credsFS });
    cds.env.requires.MM_PUR_PO_MAINT_V2_SRV = Object.assign(cds.env.requires.MM_PUR_PO_MAINT_V2_SRV || { kind: 'odata-v2', model: 'srv/external/MM_PUR_PO_MAINT_V2_SRV' }, { credentials: credsMaint });
    cds.env.requires.FAC_GL_JOURNALENTRY_VER_SRV = Object.assign(cds.env.requires.FAC_GL_JOURNALENTRY_VER_SRV || { kind: 'odata-v2', model: 'srv/external/FAC_GL_JOURNALENTRY_VER_SRV' }, { credentials: credsFI });
    cds.env.requires.SD_F2370_INQY_WL_SRV = Object.assign(cds.env.requires.SD_F2370_INQY_WL_SRV || { kind: 'odata-v2', model: 'srv/external/SD_F2370_INQY_WL_SRV' }, { credentials: credsSDWL });
    cds.env.requires.SD_F2369_INQY_FS_SRV = Object.assign(cds.env.requires.SD_F2369_INQY_FS_SRV || { kind: 'odata-v2', model: 'srv/external/SD_F2369_INQY_FS_SRV' }, { credentials: credsSDFS });
    cds.env.requires.SD_F1873_SO_WL_SRV = Object.assign(cds.env.requires.SD_F1873_SO_WL_SRV || { kind: 'odata-v2', model: 'srv/external/SD_F1873_SO_WL_SRV' }, { credentials: credsSDSO });

    if (cds.requires) {
        if (cds.requires.C_PURCHASEORDER_FS_SRV) cds.requires.C_PURCHASEORDER_FS_SRV.credentials = credsFS;
        if (cds.requires.MM_PUR_PO_MAINT_V2_SRV) cds.requires.MM_PUR_PO_MAINT_V2_SRV.credentials = credsMaint;
        if (cds.requires.FAC_GL_JOURNALENTRY_VER_SRV) cds.requires.FAC_GL_JOURNALENTRY_VER_SRV.credentials = credsFI;
        if (cds.requires.SD_F2370_INQY_WL_SRV) cds.requires.SD_F2370_INQY_WL_SRV.credentials = credsSDWL;
        if (cds.requires.SD_F2369_INQY_FS_SRV) cds.requires.SD_F2369_INQY_FS_SRV.credentials = credsSDFS;
        if (cds.requires.SD_F1873_SO_WL_SRV) cds.requires.SD_F1873_SO_WL_SRV.credentials = credsSDSO;
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
    app.use((req, res, next) => {
        if (process.env.NODE_ENV !== 'production' && localTokenUtil.isDevTokenIssuerEnabled()) {
            const auth = req.headers.authorization;
            if (auth && auth.match(/^bearer\s+/i)) {
                const token = auth.replace(/^bearer\s+/i, '').trim();
                const u = localTokenUtil.verifyToken(token);
                if (u) {
                    req.user = u;
                }
            }
        }
        next();
    });

    // AI assistant streaming endpoint (SSE). Runs behind the CAP auth middlewares so cds.context.user is set.
    const express = require('express');
    app.post('/ai/chat/stream', express.json({ limit: '2mb' }), ...cds.middlewares.before, require('./srv/ai/service').streamHandler);

    // Serve Component-preload.js from dist if available, or return empty JS comment with HTTP 200 in development
    // to eliminate 404 net::ERR_ABORTED and module system loading failure warnings
    app.get(/Component-preload\.js$/, (req, res) => {
        const fs = require('fs');
        const path = require('path');
        const preloadDist = path.resolve(__dirname, 'app/fiori-app/dist/Component-preload.js');
        if (fs.existsSync(preloadDist)) {
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
cds.middlewares.add((req, res, next) => {
    if (process.env.NODE_ENV !== 'production' && localTokenUtil.isDevTokenIssuerEnabled()) {
        const auth = req.headers.authorization;
        if (auth && auth.match(/^bearer\s+/i)) {
            const token = auth.replace(/^bearer\s+/i, '').trim();
            const u = localTokenUtil.verifyToken(token);
            if (u) {
                req.user = u;
                if (cds.context) {
                    cds.context.user = u;
                }
            }
        }
    }
    next();
}, { before: 'auth' });

// Delegate to default CAP server bootstrap
module.exports = cds.server;
