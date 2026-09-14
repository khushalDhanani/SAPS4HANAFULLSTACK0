const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

// In local development, load local environment configuration if present
if (process.env.NODE_ENV !== 'production') {
    try {
        const envFile = fs.existsSync(path.resolve(__dirname, '.env'))
            ? path.resolve(__dirname, '.env')
            : (fs.existsSync(path.resolve(__dirname, '.env.local')) ? path.resolve(__dirname, '.env.local') : null);
        if (envFile) {
            const lines = fs.readFileSync(envFile, 'utf8').split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const key = trimmed.substring(0, eqIdx).trim();
                    let val = trimmed.substring(eqIdx + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (!process.env[key]) {
                        process.env[key] = val;
                    }
                }
            }
        }
    } catch (e) {}
}

// Register local development S4_USERNAME in mock auth users if running in development
if (process.env.NODE_ENV !== 'production' && process.env.S4_USERNAME) {
    const s4User = process.env.S4_USERNAME.trim();
    cds.env.requires = cds.env.requires || {};
    cds.env.requires.auth = cds.env.requires.auth || {};
    cds.env.requires.auth.users = cds.env.requires.auth.users || {};
    const devRoles = ['User', 'Admin', 'Viewer', 'PurchasingManager', 'FinanceViewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager'];
    cds.env.requires.auth.users[s4User] = { roles: devRoles };
    cds.env.requires.auth.users[s4User.toLowerCase()] = { roles: devRoles };
    cds.env.requires.auth.users[s4User.toUpperCase()] = { roles: devRoles };
}

const { registerDestination } = require('@sap-cloud-sdk/connectivity');

// In local development, configure credentials and register local destination if running outside BTP
if (process.env.NODE_ENV !== 'production' && process.env.S4_DESTINATION_URL) {
    const client = process.env.S4_CLIENT || '220';
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

    cds.env.requires = cds.env.requires || {};
    cds.env.requires.C_PURCHASEORDER_FS_SRV = Object.assign(cds.env.requires.C_PURCHASEORDER_FS_SRV || { kind: 'odata-v2', model: 'srv/external/C_PURCHASEORDER_FS_SRV' }, { credentials: credsFS });
    cds.env.requires.MM_PUR_PO_MAINT_V2_SRV = Object.assign(cds.env.requires.MM_PUR_PO_MAINT_V2_SRV || { kind: 'odata-v2', model: 'srv/external/MM_PUR_PO_MAINT_V2_SRV' }, { credentials: credsMaint });
    cds.env.requires.FAC_GL_JOURNALENTRY_VER_SRV = Object.assign(cds.env.requires.FAC_GL_JOURNALENTRY_VER_SRV || { kind: 'odata-v2', model: 'srv/external/FAC_GL_JOURNALENTRY_VER_SRV' }, { credentials: credsFI });
    cds.env.requires.SD_F2370_INQY_WL_SRV = Object.assign(cds.env.requires.SD_F2370_INQY_WL_SRV || { kind: 'odata-v2', model: 'srv/external/SD_F2370_INQY_WL_SRV' }, { credentials: credsSDWL });
    cds.env.requires.SD_F2369_INQY_FS_SRV = Object.assign(cds.env.requires.SD_F2369_INQY_FS_SRV || { kind: 'odata-v2', model: 'srv/external/SD_F2369_INQY_FS_SRV' }, { credentials: credsSDFS });

    if (cds.requires) {
        if (cds.requires.C_PURCHASEORDER_FS_SRV) cds.requires.C_PURCHASEORDER_FS_SRV.credentials = credsFS;
        if (cds.requires.MM_PUR_PO_MAINT_V2_SRV) cds.requires.MM_PUR_PO_MAINT_V2_SRV.credentials = credsMaint;
        if (cds.requires.FAC_GL_JOURNALENTRY_VER_SRV) cds.requires.FAC_GL_JOURNALENTRY_VER_SRV.credentials = credsFI;
        if (cds.requires.SD_F2370_INQY_WL_SRV) cds.requires.SD_F2370_INQY_WL_SRV.credentials = credsSDWL;
        if (cds.requires.SD_F2369_INQY_FS_SRV) cds.requires.SD_F2369_INQY_FS_SRV.credentials = credsSDFS;
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

    // In local development, verify Bearer tokens (JWT with standard XSUAA claims)
    if (process.env.NODE_ENV !== 'production') {
        app.use((req, res, next) => {
            const auth = req.headers.authorization;
            if (auth && auth.match(/^bearer\s+/i)) {
                const token = auth.replace(/^bearer\s+/i, '').trim();
                const u = localTokenUtil.verifyToken(token);
                if (u) {
                    req.user = u;
                }
            }
            next();
        });
    }

    // Handle Component-preload.js in local dev to return 404 with JS MIME type, preventing strict MIME checking refusal
    app.get(/Component-preload\.js$/, (req, res) => {
        res.status(404).type('application/javascript').send('// Component-preload.js not available in development');
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

// Register local development Bearer token verification into CAP OData middleware chain
if (process.env.NODE_ENV !== 'production') {
    cds.middlewares.add((req, res, next) => {
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
        next();
    }, { after: 'auth' });
}

// Delegate to default CAP server bootstrap
module.exports = cds.server;
