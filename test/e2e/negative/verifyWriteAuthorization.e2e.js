'use strict';

/**
 * Write-authorization E2E against a private CAP server that cannot reach SAP (support/isolatedServer.js):
 * every request that wrongly passes authorization ends at the dead S/4 endpoint, so no SAP write is possible.
 * - Role checks, generated from the compiled CDS model: every write action that does not grant Viewer must answer
 *   401 when signed out and 403 for the Viewer-only mock users `bob` (Plant 1120) and `eve` (no plant).
 * - Plant checks: the WarehouseClerk mock user `dave` (Plant 1130) acting on plant 1120 must get 403 before any S/4 call.
 */

const path = require('path');
const cds = require('@sap/cds');
const { startIsolatedServer, assertSapUnreachable } = require('../support/isolatedServer');

const ROOT = path.join(__dirname, '../../..');
// External S/4 proxies and the login service are not application write APIs
const SKIP_SERVICES = /(^AuthService$|_SRV$)/;

const PLANT_CASES = [
    { name: 'createReservation for plant 1120', path: '/odata/v4/reservation-entry/createReservation',
        body: { MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'E2E', Quantity: 1, Unit: 'EA', CostCenter: '1011201301' } },
    { name: 'createReservationEntry for plant 1120', path: '/odata/v4/reservation-entry/createReservationEntry',
        body: { MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'E2E', Quantity: 1, Unit: 'EA', CostCenter: '1011201301' } },
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

const kebab = (n) => n.replace(/Service$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Unbound actions of the application services with their @requires roles. */
async function writeActions() {
    const m = await cds.load(path.join(ROOT, 'srv'));
    const out = [];
    for (const [sn, sd] of Object.entries(m.definitions)) {
        const short = sn.split('.').pop();
        if (sd.kind !== 'service' || SKIP_SERVICES.test(short)) continue;
        const base = sd['@path'] || `/odata/v4/${kebab(short)}`;
        for (const [n, d] of Object.entries(m.definitions)) {
            if (d.kind === 'action' && n.startsWith(`${sn}.`) && !n.slice(sn.length + 1).includes('.')) {
                out.push({ id: `${short}.${n.slice(sn.length + 1)}`, path: `${base}/${n.slice(sn.length + 1)}`, roles: [].concat(d['@requires'] || []) });
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
        const roleChecked = actions.filter((a) => a.roles.length > 0 && !a.roles.includes('Viewer'));
        const errs = [];
        for (const a of roleChecked) {
            for (const [user, expected] of [[null, 401], ['bob', 403], ['eve', 403]]) {
                const r = await post(server, user, a.path);
                if (r.status !== expected) errs.push(`${a.id} as ${user || 'signed-out'}: HTTP ${r.status} (expected ${expected}) ${r.message}`);
            }
        }
        const notChecked = actions.filter((a) => !roleChecked.includes(a)).map((a) => `${a.id} [${a.roles.join(', ') || 'service default'}]`);
        console.log(`  role-checked actions: ${roleChecked.length}; not role-checked (grant Viewer or no own @requires): ${notChecked.join('; ')}`);
        record(`Viewer and signed-out users are refused on all ${roleChecked.length} write actions`, errs);

        for (const c of PLANT_CASES) {
            const r = await post(server, 'dave', c.path, c.body);
            record(`Clerk of plant 1130 refused: ${c.name}`, r.status === 403 ? [] : [`HTTP ${r.status}: ${r.message} — passed authorization (no SAP reachable here)`]);
        }
    } finally {
        await server.stop();
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifyWriteAuthorization().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyWriteAuthorization, writeActions };
