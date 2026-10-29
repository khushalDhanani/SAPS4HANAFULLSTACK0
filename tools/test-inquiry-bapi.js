#!/usr/bin/env node
'use strict';

/**
 * ONE simulated call (TESTRUN='X', never committed) of BAPI_INQUIRY_CREATEFROMDATA2 for the data in
 * test/e2e/live/testData.json "salesInquiry". It is an RFC call to a create function, so it needs the user's written go
 * for this run (AGENTS.md) and the live gate: ALLOW_LIVE_SAP_TOOLS=1, --allow-live-sap and E2E_SAP_LIVE_TARGET equal to
 * the connected system label. Prints the exact input first and the SAP RETURN messages; creates nothing.
 *   ALLOW_LIVE_SAP_TOOLS=1 E2E_SAP_LIVE_TARGET='<system label>' node tools/test-inquiry-bapi.js --allow-live-sap
 */

require('./live-sap-gate')();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
const { assertTarget } = require('../test/e2e/support/liveWriteGate');
const { mapToS4InquiryPayload } = require('../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');
const { SalesInquiryRfcCreator, buildInput } = require('../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryRfcCreator');
const s4Config = require('../srv/integration/s4hana/s4Config');

async function main() {
    assertTarget(s4Config.getSystemLabel(), process.env);
    const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test/e2e/live/testData.json'), 'utf8')).salesInquiry;
    const today = new Date().toISOString().slice(0, 10);
    const { header, items } = mapToS4InquiryPayload(
        { ...data.header, ShipToParty: data.header.SoldToParty, SalesInquiryDate: today, CustomerPurchaseOrderDate: today, BindingPeriodValidityStartDate: today },
        [{ ...data.item, SalesInquiryItem: '000010' }]
    );
    console.log('TESTRUN input (nothing is committed):');
    console.log(JSON.stringify(buildInput(header, items)));
    if (process.argv.includes('--print-only')) { console.log('PRINT ONLY: no RFC call was made'); return; }
    console.log('WRITE-CLASS RFC CALL (TESTRUN=X) to BAPI_INQUIRY_CREATEFROMDATA2 now');
    try {
        const out = await new SalesInquiryRfcCreator().create(header, items, { testRun: true });
        console.log('RESULT: SAP accepted the test run (no document created)');
        out.messages.forEach((m) => console.log(`  [${m.type}] ${m.id || ''} ${m.number || ''} ${m.text} | vars=${JSON.stringify(m.vars)} parameter=${m.parameter || '-'} row=${m.row || '-'} field=${m.field || '-'}`));
    } catch (e) {
        console.log(`RESULT: SAP rejected the test run: ${e.message}`);
        (e.messages || []).forEach((m) => console.log(`  [${m.type}] ${m.id || ''} ${m.number || ''} ${m.text} | vars=${JSON.stringify(m.vars)} parameter=${m.parameter || '-'} row=${m.row || '-'} field=${m.field || '-'}`));
        process.exitCode = 1;
    }
}

main().catch((e) => { console.error(`Blocked or failed before the call: ${e.message}`); process.exitCode = 2; });
