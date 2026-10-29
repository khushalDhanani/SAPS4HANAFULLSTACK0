#!/usr/bin/env node
'use strict';

/**
 * ONE simulated call (TESTRUN='X', never committed) of BAPI_CUSTOMERRETURN_CREATE for the data in
 * test/e2e/live/testData.json "customerReturn". It is an RFC call to a create function, so it needs the user's written go
 * for this run (AGENTS.md) and the live gate: ALLOW_LIVE_SAP_TOOLS=1, --allow-live-sap and E2E_SAP_LIVE_TARGET equal to
 * the connected system label. Prints the exact input first and the SAP RETURN messages; creates nothing.
 *   ALLOW_LIVE_SAP_TOOLS=1 E2E_SAP_LIVE_TARGET='<system label>' node tools/test-return-bapi.js --allow-live-sap [--print-only]
 * --print-only builds and prints the input (two read-only table reads for the sales area) and makes no BAPI call.
 */

require('./live-sap-gate')();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
const { assertTarget } = require('../test/e2e/support/liveWriteGate');
const s4Config = require('../srv/integration/s4hana/s4Config');
const adapter = require('../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');
const { buildInput } = require('../srv/integration/s4hana/sd/customer-return/CustomerReturnRfcCreator');
const { resolveCustomerSalesArea } = require('../srv/integration/s4hana/sd/customerSalesArea');

const line = (m) => `  [${m.type}] ${m.id || ''} ${m.number || ''} ${m.text} | vars=${JSON.stringify(m.vars)} parameter=${m.parameter || '-'} row=${m.row || '-'} field=${m.field || '-'}`;

async function main() {
    assertTarget(s4Config.getSystemLabel(), process.env);
    const d = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test/e2e/live/testData.json'), 'utf8')).customerReturn;
    if (!d) throw new Error('test/e2e/live/testData.json has no "customerReturn" section');
    const payload = {
        CustomerReturnType: 'ZRET', SoldToParty: d.SoldToParty, ReturnsOrderReason: d.ReturnsOrderReason,
        ReferenceSDDocument: d.ReferenceSDDocument, ReferenceSDDocumentCategory: 'C',
        SalesOrganization: d.SalesOrganization, DistributionChannel: d.DistributionChannel, OrganizationDivision: d.OrganizationDivision,
        CustomerReturnDate: new Date().toISOString().slice(0, 10),
        Items: [{
            Material: d.Material, OrderQuantity: d.OrderQuantity, OrderQuantityUnit: d.OrderQuantityUnit, ProductionPlant: d.ProductionPlant,
            StorageLocation: d.StorageLocation, ReturnReason: d.ReturnsOrderReason, ReferenceSDDocument: d.ReferenceSDDocument, ReferenceSDDocumentItem: '000010'
        }]
    };
    const salesArea = await resolveCustomerSalesArea(adapter.rfc, payload.SoldToParty, {
        salesOrganization: payload.SalesOrganization, distributionChannel: payload.DistributionChannel, division: payload.OrganizationDivision
    });
    console.log('TESTRUN input (nothing is committed):');
    console.log(JSON.stringify(buildInput(payload, salesArea)));
    if (process.argv.includes('--print-only')) { console.log('PRINT ONLY: no BAPI call was made'); return; }
    console.log('WRITE-CLASS RFC CALL (TESTRUN=X) to BAPI_CUSTOMERRETURN_CREATE now');
    try {
        const out = await adapter.createCustomerReturnViaRfc(payload, { testRun: true });
        console.log('RESULT: SAP accepted the test run (no document created)');
        out.messages.forEach((m) => console.log(line(m)));
    } catch (e) {
        console.log(`RESULT: SAP rejected the test run: ${e.message}`);
        (e.messages || []).forEach((m) => console.log(line(m)));
        process.exitCode = 1;
    }
}

main().catch((e) => { console.error(`Blocked or failed before the call: ${e.message}`); process.exitCode = 2; });
