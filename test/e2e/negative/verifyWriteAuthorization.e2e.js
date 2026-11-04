'use strict';

/**
 * Write-authorization E2E against a private CAP server that cannot reach SAP (support/isolatedServer.js):
 * every request that wrongly passes authorization ends at the dead S/4 endpoint, so no SAP write is possible.
 * - Role checks, generated from the compiled CDS model: every write action whose own or service-level @requires names
 *   specific roles without Viewer must answer 401 when signed out and 403 for the Viewer-only mock users
 *   `test-viewer-1120` (Plant 1120) and `test-viewer-noplant` (no plant). lockUser and unlockUser are also checked by fixed path.
 * - Plant checks: the WarehouseClerk mock user `test-clerk-1130` (Plant 1130) acting on plant 1120 must get 403 before any S/4 call.
 * - Plant read check: open HU reservations of a plant outside the user's scope answer 403 before any S/4 call.
 */

const path = require('path');
const cds = require('@sap/cds');
const { startIsolatedServer, assertSapUnreachable } = require('../support/isolatedServer');

const ROOT = path.join(__dirname, '../../..');
// External S/4 proxies and the login service are not application write APIs
const SKIP_SERVICES = /(^AuthService$|_SRV$)/;

const PLANT_CASES = [
    { name: 'HU pack for plant 1120', path: '/odata/v4/handling-unit/pack',
        body: { handlingUnitExternalID: 'E2E', material: 'E2E', quantity: 1, unit: 'EA', plant: '1120', storageLocation: 'HS01' } },
    { name: 'postGoodsReceipt for plant 1120', path: '/odata/v4/goods-receipt/postGoodsReceipt',
        body: { Plant: '1120', StorageLocation: 'HS01', Material: 'E2E', Quantity: 1, Unit: 'EA', DeliveryDocument: '1', DeliveryDocumentItem: '10' } },
    { name: 'postGoodsReceiptWithStorageUnit (the action the GR screen calls) for plant 1120', path: '/odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit',
        body: { StorageUnit: '180000003', DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Plant: '1120', StorageLocation: 'HS01', Material: 'E2E', Quantity: 1, Unit: 'KG' } },
    { name: 'createDeliveryWithoutRef for plant 1120', path: '/odata/v4/outbound-delivery/createDeliveryWithoutRef',
        body: { ShippingPoint: '1104', DeliveryDocumentType: 'LO2', SalesOrganization: '1000', DistributionChannel: '10', Division: '52', ShipToParty: '1',
            Plant: '1120', StorageLocation: 'FG01', PlannedGoodsIssueDate: '2026-10-27', Items: [{ Material: 'E2E', ActualDeliveryQuantity: 1, DeliveryQuantityUnit: 'KG' }] } }
];

// Written by hand so these two stay checked whatever the CDS scan below finds. They lock real SAP users; no case names a user.
const ADMIN_ONLY_PATHS = { lockUser: '/odata/v4/user-management/lockUser', unlockUser: '/odata/v4/user-management/unlockUser' };
const OPEN_RESERVATIONS = (plant) => `/odata/v4/hu-stock-transfer/getOpenReservations(plant='${plant}',storageLocation='',movementType='311',`
    + "requester='',reservation='',material='',status='open',includeDeleted=false)";

const kebab = (n) => n.replace(/Service$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Unbound actions of the application services with their roles: the action's own @requires, else its service's. */
async function writeActions() {
    const m = await cds.load(path.join(ROOT, 'srv'));
    const out = [];
    for (const [sn, sd] of Object.entries(m.definitions)) {
        const short = sn.split('.').pop();
        if (sd.kind !== 'service' || SKIP_SERVICES.test(short)) continue;
        const base = sd['@path'] || `/odata/v4/${kebab(short)}`;
        for (const [n, d] of Object.entries(m.definitions)) {
            if (d.kind === 'action' && n.startsWith(`${sn}.`) && !n.slice(sn.length + 1).includes('.')) {
                out.push({ id: `${short}.${n.slice(sn.length + 1)}`, path: `${base}/${n.slice(sn.length + 1)}`, roles: [].concat(d['@requires'] || sd['@requires'] || []) });
            }
        }
    }
    return out;
}

async function post(server, user, urlPath, body = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers.Authorization = 'Basic ' + Buffer.from(`${user}:`).toString('base64');
    const res = await fetch(`${server.baseUrl}${urlPath}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, message: (text.match(/"message":"([^"]*)"/) || [])[1] || '' };
}

async function get(server, user, urlPath) {
    const res = await fetch(`${server.baseUrl}${urlPath}`, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:`).toString('base64') } });
    const text = await res.text();
    return { status: res.status, message: (text.match(/"message":"([^"]*)"/) || [])[1] || '' };
}

async function verifyWriteAuthorization() {
    console.log('\n=== Write authorization (isolated CAP server, no SAP reachable) ===');
    const server = await startIsolatedServer();
    const errors = [];
    const details = [];
    const record = (name, errs) => {
        console.log(`  [${errs.length ? 'FAIL' : 'PASS'}] ${name}`);
        errs.forEach((e) => console.log(`      - ${e}`));
        details.push({ case: name, status: errs.length ? 'FAIL' : 'PASS', errors: errs });
        errs.forEach((e) => errors.push(`${name}: ${e}`));
    };
    try {
        const sap = await assertSapUnreachable(server);
        console.log(`  SAP unreachable (SAP-backed read answered HTTP ${sap.status})`);

        const actions = await writeActions();
        const roleChecked = actions.filter((a) => a.roles.length > 0 && !a.roles.includes('Viewer') && !a.roles.includes('authenticated-user'));
        const errs = [];
        for (const a of roleChecked) {
            for (const [user, expected] of [[null, 401], ['test-viewer-1120', 403], ['test-viewer-noplant', 403]]) {
                const r = await post(server, user, a.path);
                if (r.status !== expected) errs.push(`${a.id} as ${user || 'signed-out'}: HTTP ${r.status} (expected ${expected}) ${r.message}`);
            }
        }
        const notChecked = actions.filter((a) => !roleChecked.includes(a)).map((a) => `${a.id} [${a.roles.join(', ')}]`);
        console.log(`  role-checked actions: ${roleChecked.length}; not role-checked (grant Viewer or any signed-in user): ${notChecked.join('; ')}`);
        record(`Viewer and signed-out users are refused on all ${roleChecked.length} write actions`, errs);

        for (const [action, actionPath] of Object.entries(ADMIN_ONLY_PATHS)) {
            for (const [user, expected] of [[null, 401], ['test-viewer-1120', 403], ['test-viewer-noplant', 403]]) {
                const r = await post(server, user, actionPath);
                record(`${action} (Admin only) answers ${expected} for ${user || 'a signed-out caller'}`, r.status === expected ? [] : [`HTTP ${r.status}: ${r.message}`]);
            }
        }

        // The server's own plant rule, which the screen's default filter (HuStockTransferList.controller.js:17) cannot show
        for (const [user, plant, label] of [['test-viewer-1120', '1130', 'another plant'], ['test-viewer-1120', '', 'no plant'], ['test-viewer-noplant', '1120', 'any plant, having none assigned']]) {
            const r = await get(server, user, OPEN_RESERVATIONS(plant));
            record(`Open reservations: ${user} asking for ${label} gets 403`, r.status === 403 ? [] : [`HTTP ${r.status}: ${r.message}`]);
        }
        // Control: the same user and read pass the plant rule for their own plant, so the 403s above are not a blanket refusal
        const own = await get(server, 'test-viewer-1120', OPEN_RESERVATIONS('1120'));
        console.log(`  own-plant control answered HTTP ${own.status}: ${own.message}`);
        record('Open reservations: test-viewer-1120 asking for its own plant is not refused with 401/403', own.status === 401 || own.status === 403 ? [`HTTP ${own.status}: ${own.message}`] : []);

        for (const c of PLANT_CASES) {
            const r = await post(server, 'test-clerk-1130', c.path, c.body);
            record(`Clerk of plant 1130 refused: ${c.name}`, r.status === 403 ? [] : [`HTTP ${r.status}: ${r.message} — passed authorization (no SAP reachable here)`]);
        }
        // These take the plant from the SAP document or shipping point. SAP cannot be reached here, so a limited user is refused, not passed on.
        for (const [action, body] of [['postGoodsIssue', { DeliveryDocument: '80000001' }], ['createBillingDocument', { DeliveryDocument: '80000001', BillingDocumentType: 'F2' }], ['createOutboundDelivery', { SalesOrder: '5000104', ShippingPoint: 'WAVG' }]]) {
            const user = action === 'createBillingDocument' ? 'test-sales-1120' : 'test-clerk-1130';
            const r = await post(server, user, `/odata/v4/outbound-delivery/${action}`, body);
            record(`${user} refused while the plant cannot be read: ${action}`, r.status === 503 ? [] : [`HTTP ${r.status}: ${r.message}`]);
        }
        const noPlant = await post(server, 'test-clerk-noplant', '/odata/v4/outbound-delivery/createOutboundDelivery', { SalesOrder: '5000104', ShippingPoint: 'WAVG' });
        record('Clerk with no plant refused: createOutboundDelivery', noPlant.status === 403 ? [] : [`HTTP ${noPlant.status}: ${noPlant.message}`]);
    } finally {
        await server.stop();
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifyWriteAuthorization().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyWriteAuthorization, writeActions };
