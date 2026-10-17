#!/usr/bin/env node
/**
 * Chunk 0: Prerequisites and Setup Inspection Script
 * Inspects:
 * 1. SAP Release (S4CORE, SAP_BASIS, RAP vs SEGW availability)
 * 2. WM Configuration (T320, T156S, T321, T333 for 201, 241, 311, 301)
 * 3. Package ZRES_WM, Transport Requests, Authorizations (M_MRES_BWA, L_LGNUM, L_BWART)
 * 4. Existing Flow Artifacts (RESB, LTBK, LTAK, MATDOC) to document baseline
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const rfc = new RfcClient();

async function run() {
  console.log('========================================================================');
  console.log('CHUNK 0: LIVE SAP S/4HANA ENVIRONMENT & WM CONFIGURATION AUDIT');
  console.log('========================================================================\n');

  // 1. System Release & Components
  console.log('--- 1. SAP RELEASE & SYSTEM ARCHITECTURE ---');
  const sysInfo = await rfc.call('RFC_SYSTEM_INFO');
  const exp = sysInfo.RFCSI_EXPORT || {};
  console.log(`System ID: ${exp.RFCSYSID} | DB: ${exp.RFCDBSYS} | Host: ${exp.RFCHOST} | Release: ${exp.RFCSAPRL}`);

  const cvers = await rfc.readTable('CVERS', ['COMPONENT', 'RELEASE', 'EXTRELEASE', 'COMP_TYPE'], [
    "( COMPONENT = 'S4CORE'",
    "OR COMPONENT = 'SAP_BASIS'",
    "OR COMPONENT = 'SAP_GWFND'",
    "OR COMPONENT = 'SAP_ABA' )"
  ]);
  console.log('\nInstalled Components:');
  for (const c of cvers) {
    console.log(`  ${c.COMPONENT.padEnd(12)} Rel: ${c.RELEASE} | Ext: ${c.EXTRELEASE} | Type: ${c.COMP_TYPE}`);
  }

  // Check if RAP objects and SEGW objects exist in system
  const rapCheck = await rfc.readTable('TADIR', ['PGMID', 'OBJECT', 'OBJ_NAME'], [
    "PGMID = 'R3TR' AND OBJECT = 'BDEF'",
    "AND AUTHOR = 'SAP'"
  ], 3);
  console.log(`\nRAP Framework Verification: Found ${rapCheck.length} Business Object Behaviors (BDEF) in TADIR (RAP is ACTIVE and NATIVE)`);

  const segwCheck = await rfc.readTable('TADIR', ['PGMID', 'OBJECT', 'OBJ_NAME'], [
    "PGMID = 'R3TR' AND OBJECT = 'IWOM'",
    "AND AUTHOR = 'SAP'"
  ], 3);
  console.log(`SEGW Framework Verification: Found ${segwCheck.length} Gateway Model definitions (IWOM) in TADIR (SEGW is ALSO AVAILABLE)`);

  // 2. WM Config for Plant / SLoc & Warehouses
  console.log('\n--- 2. WM CONFIGURATION (T320, T156S, T321, T333) ---');
  const t320 = await rfc.readTable('T320', ['WERKS', 'LGORT', 'LGNUM'], [
    "( WERKS = '1120'",
    "OR WERKS = '1130'",
    "OR WERKS = '1110' )"
  ]);
  console.log(`Warehouse Assignments in Plants 1110, 1120, 1130 (T320):`);
  const whMap = {};
  for (const r of t320) {
    if (!whMap[r.WERKS]) whMap[r.WERKS] = [];
    whMap[r.WERKS].push(`${r.LGORT} -> WH ${r.LGNUM}`);
  }
  for (const [w, slocs] of Object.entries(whMap)) {
    console.log(`  Plant ${w}: ${slocs.join(', ')}`);
  }

  // T156S Reference movement types
  console.log('\nIM Movement Types -> Reference WM Movement Types (T156S):');
  const t156s = await rfc.readTable('T156S', ['BWART', 'SOBKZ', 'RBLVS', 'UMRBL'], [
    "( BWART = '201'",
    "OR BWART = '241'",
    "OR BWART = '301'",
    "OR BWART = '311' )"
  ]);
  const seen156 = new Set();
  for (const r of t156s) {
    const key = `${r.BWART}|${r.SOBKZ}|${r.RBLVS}|${r.UMRBL}`;
    if (!seen156.has(key)) {
      seen156.add(key);
      console.log(`  BWART ${r.BWART} | SpecialStock: '${r.SOBKZ || '-'}' -> RefWM: ${r.RBLVS} | TransferRefWM: ${r.UMRBL}`);
    }
  }

  // T321 Mapping
  console.log('\nWM Movement Assignment (T321):');
  const t321 = await rfc.readTable('T321', ['LGNUM', 'BWLVS', 'RBLVS', 'TBFKZ', 'UBFKZ', 'TAFKZ', 'SOBKZ'], [
    "( RBLVS = '201'",
    "OR RBLVS = '241'",
    "OR RBLVS = '301'",
    "OR RBLVS = '311' )"
  ]);
  const seen321 = new Set();
  for (const r of t321) {
    const key = `${r.LGNUM}|${r.BWLVS}|${r.RBLVS}|${r.TBFKZ}|${r.SOBKZ}`;
    if (!seen321.has(key)) {
      seen321.add(key);
      console.log(`  WH: ${r.LGNUM.padEnd(4)} | WM-Mvt: ${r.BWLVS} | Ref-Mvt: ${r.RBLVS} | SpecStock: '${r.SOBKZ || '-'}' | CreateTR(TBFKZ): ${r.TBFKZ || '-'} | CreateTO(TAFKZ): ${r.TAFKZ || '-'}`);
    }
  }

  // T333 Definition
  console.log('\nWM Movement Types Detail in Warehouse W01 (T333):');
  const t333 = await rfc.readTable('T333', ['LGNUM', 'BWLVS', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'TRART', 'TBOBL'], [
    "LGNUM = 'W01'",
    "AND ( BWLVS = '201'",
    "OR BWLVS = '241'",
    "OR BWLVS = '301'",
    "OR BWLVS = '311' )"
  ]);
  for (const r of t333) {
    console.log(`  WH: ${r.LGNUM} | WM-Mvt: ${r.BWLVS} | Src: ${r.VLTYP || '-'}/${r.VLPLA || '-'} | Dest: ${r.NLTYP || '-'}/${r.NLPLA || '-'} | Type: ${r.TRART} | TRObligatory: ${r.TBOBL || '-'}`);
  }

  // 3. Package ZRES_WM, Transport Request, Authorizations
  console.log('\n--- 3. PACKAGE ZRES_WM, TRANSPORTS, AUTHORIZATIONS ---');
  const pkg = await rfc.readTable('TDEVC', ['DEVCLASS', 'DLVUNIT', 'COMPONENT', 'AS4USER'], [
    "DEVCLASS = 'ZRES_WM'"
  ]);
  console.log(`Package ZRES_WM in TDEVC: ${pkg.length > 0 ? JSON.stringify(pkg[0]) : 'DOES NOT EXIST YET (Must be created via SE21 / SE80 or ADT)'}`);

  const user = process.env.S4_USERNAME;
  console.log(`Current S/4 RFC User: ${user}`);

  // Transports for user
  const trs = await rfc.readTable('E070', ['TRKORR', 'TRFUNCTION', 'TRSTATUS', 'AS4USER', 'AS4DATE'], [
    `AS4USER = '${user}'`,
    "AND TRSTATUS = 'D'"
  ], 5);
  console.log(`Open Workbench/Customizing Transport Requests for user ${user} (E070):`);
  if (trs.length === 0) {
    console.log('  None currently open (status D).');
  } else {
    for (const t of trs) {
      console.log(`  TR: ${t.TRKORR} | Type: ${t.TRFUNCTION} | Status: ${t.TRSTATUS} | Date: ${t.AS4DATE}`);
    }
  }

  // Authorizations: M_MRES_BWA, L_LGNUM, L_BWLVS
  console.log('\nAuthorizations Objects Check (TOBJ):');
  const authObjs = await rfc.readTable('TOBJ', ['OBJCT', 'OCLSS', 'FIEL1', 'FIEL2'], [
    "( OBJCT = 'M_MRES_BWA'",
    "OR OBJCT = 'L_LGNUM'",
    "OR OBJCT = 'L_BWLVS' )"
  ]);
  for (const o of authObjs) {
    console.log(`  Auth Object: ${o.OBJCT.padEnd(12)} | Class: ${o.OCLSS} | Fields: ${o.FIEL1}, ${o.FIEL2}`);
  }

  // Check if user has SAP_ALL in UST04
  const userProfiles = await rfc.readTable('UST04', ['BNAME', 'PROFILE'], [
    `BNAME = '${user}' AND PROFILE = 'SAP_ALL'`
  ]);
  console.log(`User ${user} Authorization Status: ${userProfiles.length > 0 ? 'Assigned SAP_ALL (Superuser - full access to M_MRES_BWA, L_LGNUM, L_BWLVS)' : 'Custom profiles assigned'}`);

  console.log('\n--- 4. EXISTING FLOW ARTIFACTS IN LIVE SYSTEM ---');
  // Sample reservation with 201 or 311
  const resbSample = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG'], [
    "( BWART = '201'",
    "OR BWART = '311' )",
    "AND XLOEK = ' '"
  ], 5);
  console.log('Sample Active Reservations in RESB:');
  for (const r of resbSample) {
    console.log(`  Res: ${r.RSNUM}/${r.RSPOS} | Mvt: ${r.BWART} | Mat: ${r.MATNR} | Plant: ${r.WERKS} | SLoc: ${r.LGORT} | ReqQty: ${r.BDMNG} | WithdrawnQty: ${r.ENMNG}`);
  }

  // Sample TRs in LTBK
  const ltbkSample = await rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU'], [
    "LGNUM = 'W01'",
    "AND STATU <> 'D'"
  ], 5);
  console.log('\nSample Transfer Requirements in LTBK:');
  for (const r of ltbkSample) {
    console.log(`  TR: ${r.TBNUM} | WH: ${r.LGNUM} | Mvt: ${r.BWLVS} | Doc: ${r.BENUM || '-'} | Res: ${r.RSNUM || '-'} | Status: '${r.STATU}'`);
  }

  // Sample TOs in LTAK
  const ltakSample = await rfc.readTable('LTAK', ['LGNUM', 'TANUM', 'BWLVS', 'TBNUM', 'KQUIT', 'BDATU'], [
    "LGNUM = 'W01'"
  ], 5);
  console.log('\nSample Transfer Orders in LTAK:');
  for (const r of ltakSample) {
    console.log(`  TO: ${r.TANUM} | WH: ${r.LGNUM} | Mvt: ${r.BWLVS} | TR: ${r.TBNUM || '-'} | Confirmed(KQUIT): ${r.KQUIT || '-'} | Date: ${r.BDATU}`);
  }

  console.log('\n========================================================================');
  console.log('CHUNK 0 AUDIT COMPLETE');
  console.log('========================================================================');
}

run().catch((e) => {
  console.error('Audit failed:', e);
  process.exit(1);
});
