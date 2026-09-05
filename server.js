const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

// Load .env.local into process.env before CAP bootstraps
const envPath = path.resolve(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim();
            if (!process.env[key]) {
                process.env[key] = val;
            }
        }
    }
}

// Inject credentials dynamically for development
if (process.env.S4_DESTINATION_URL) {
    cds.env.requires = cds.env.requires || {};
    const client = process.env.S4_CLIENT || "220";
    const headers = { "sap-client": client };
    
    cds.env.requires.C_PURCHASEORDER_FS_SRV = cds.env.requires.C_PURCHASEORDER_FS_SRV || { kind: "odata-v2", model: "srv/external/C_PURCHASEORDER_FS_SRV" };
    cds.env.requires.C_PURCHASEORDER_FS_SRV.credentials = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV`,
        authentication: "BasicAuthentication",
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };

    cds.env.requires.MM_PUR_PO_MAINT_V2_SRV = cds.env.requires.MM_PUR_PO_MAINT_V2_SRV || { kind: "odata-v2", model: "srv/external/MM_PUR_PO_MAINT_V2_SRV" };
    cds.env.requires.MM_PUR_PO_MAINT_V2_SRV.credentials = {
        url: `${process.env.S4_DESTINATION_URL}/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV`,
        authentication: "BasicAuthentication",
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: headers
    };
}

// Handle UI5 Layered Repository (LRep / Flexibility) requests in local dev to eliminate 404 console errors
cds.on('bootstrap', (app) => {
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
