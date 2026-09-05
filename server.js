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
    const devRoles = ['User', 'Admin', 'Viewer', 'PurchasingManager'];
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

    cds.env.requires = cds.env.requires || {};
    cds.env.requires.C_PURCHASEORDER_FS_SRV = Object.assign(cds.env.requires.C_PURCHASEORDER_FS_SRV || { kind: 'odata-v2', model: 'srv/external/C_PURCHASEORDER_FS_SRV' }, { credentials: credsFS });
    cds.env.requires.MM_PUR_PO_MAINT_V2_SRV = Object.assign(cds.env.requires.MM_PUR_PO_MAINT_V2_SRV || { kind: 'odata-v2', model: 'srv/external/MM_PUR_PO_MAINT_V2_SRV' }, { credentials: credsMaint });

    if (cds.requires) {
        if (cds.requires.C_PURCHASEORDER_FS_SRV) cds.requires.C_PURCHASEORDER_FS_SRV.credentials = credsFS;
        if (cds.requires.MM_PUR_PO_MAINT_V2_SRV) cds.requires.MM_PUR_PO_MAINT_V2_SRV.credentials = credsMaint;
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

// Local development bootstrap handlers
cds.on('bootstrap', (app) => {
    // Set Permissions-Policy header to eliminate Chromium 'unload is not allowed' violation warnings
    app.use((req, res, next) => {
        res.setHeader('Permissions-Policy', 'unload=*');
        next();
    });

    // In local development, default unauthenticated browser requests to canonical mock user 'alice'
    // so UI5 batch requests and value helps load without 403 Forbidden
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        app.use((req, res, next) => {
            if (!req.headers.authorization) {
                req.headers.authorization = 'Basic ' + Buffer.from('alice:').toString('base64');
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

// Delegate to default CAP server bootstrap
module.exports = cds.server;
