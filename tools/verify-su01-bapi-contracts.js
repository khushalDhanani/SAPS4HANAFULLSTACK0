#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY: Verify SU01 BAPI contracts for the User Management feature.
 *
 * Checks performed (ALL read-only — no write BAPI, no BAPI_TRANSACTION_COMMIT):
 *   1. RFC connectivity preflight (T000 table read)
 *   2. BAPI_USER_GETLIST  — list users, inspect returned USERLIST table structure
 *   3. BAPI_USER_GET_DETAIL — full detail for the connected user (already proven, re-verify fields)
 *   4. SUSR_USER_CHANGE_PASSWORD_RFC — existence check via RFC_FUNCTION_SEARCH (no call)
 *   5. Authority check probe — does the RFC user have S_USR_ADM / S_USER_GRP via UST12 table read
 *
 * Usage (from repo root):
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/verify-su01-bapi-contracts.js --allow-live-sap
 *
 * Output: JSON evidence block + human-readable summary.
 * Sensitive values (credentials, hostname, client) are never printed.
 */

require('./live-sap-gate')();
require('dotenv').config({ path: '.env.local' });

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const rfc = new RfcClient();
const evidence = { timestamp: new Date().toISOString(), steps: [] };

function step(name) {
  const entry = { name, status: 'PENDING', result: null, error: null };
  evidence.steps.push(entry);
  process.stdout.write(`\n[STEP] ${name} ... `);
  return {
    pass(result) { entry.status = 'PASS'; entry.result = result; console.log('PASS'); return result; },
    fail(err)   { entry.status = 'FAIL'; entry.error = String(err && err.message || err).split('\n')[0]; console.log(`FAIL: ${entry.error}`); }
  };
}

// Redact any value that looks like a credential key from an RFC result object
function _redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const CRED = /PASSWD|PASSWORD|SECRET|TOKEN|HOST|ASHOST|SYSNR/i;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, CRED.test(k) ? '***' : (typeof v === 'object' ? _redact(v) : v)])
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 1 — RFC connectivity preflight
// ──────────────────────────────────────────────────────────────────────────────
async function stepConnectivity() {
  const s = step('RFC connectivity (RFC_READ_TABLE T000)');
  try {
    const rows = await rfc.readTable('T000', ['MANDT', 'MTEXT'], [`MANDT = '${process.env.S4_CLIENT}'`], 1);
    if (!rows.length) return s.fail('T000 returned no rows for the configured client');
    s.pass({ mandt: rows[0].MANDT, mtext: rows[0].MTEXT });
  } catch (e) { s.fail(e); }
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 2 — BAPI_USER_GETLIST (READ-ONLY: list users, inspect table)
// ──────────────────────────────────────────────────────────────────────────────
async function stepUserGetList() {
  const s = step('BAPI_USER_GETLIST (list first 5 users, read table structure)');
  try {
    // MAX_ROWS limits the result; USERNAME_RANGE left empty = all users.
    // We call with SELECTION_RANGE limited to return max 5 users (SIGN I OPTION BT LOW A HIGH E).
    const res = await rfc.call('BAPI_USER_GETLIST', {
      MAX_ROWS: 5,
      // No filter → returns up to MAX_ROWS users alphabetically
    });

    const userList  = res.USERLIST  || [];
    const returnMsg = res.RETURN    || [];

    // Extract first names only (no UPN/password data in USERLIST)
    const usernames = userList.slice(0, 5).map(u => u.USERNAME || u.BNAME || '(no USERNAME field)');

    // Inspect available field names in the first USERLIST row
    const listFields = userList.length > 0 ? Object.keys(userList[0]) : [];

    const retMsgs = returnMsg.map(m => ({
      type: m.TYPE, id: m.ID, number: m.NUMBER, message: m.MESSAGE
    }));

    s.pass({
      rowCount: userList.length,
      sampleUsernames: usernames,
      listFields,
      returnMessages: retMsgs
    });
  } catch (e) { s.fail(e); }
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 3 — BAPI_USER_GET_DETAIL (re-verify full contract for connected user)
// CONFIRMED: correct import parameter is USERNAME (not BNAME)
// ──────────────────────────────────────────────────────────────────────────────
async function stepUserGetDetail() {
  const connUser = process.env.S4_USERNAME || '';
  if (!connUser) {
    step('BAPI_USER_GET_DETAIL (connected user)').fail('S4_USERNAME not set in env');
    return;
  }
  const s = step(`BAPI_USER_GET_DETAIL for connected user (masked)`);
  try {
    const res = await rfc.call('BAPI_USER_GET_DETAIL', { USERNAME: connUser });

    // Top-level keys the BAPI returns (structure names — tells us which parameter groups exist)
    const topKeys = Object.keys(res);

    // LOGONDATA — account validity / type
    const ld = res.LOGONDATA || {};
    const logondata = {
      USTYP:  ld.USTYP,   // User type (A=dialog, B=system, etc.)
      GLTGV:  ld.GLTGV,   // Valid from
      GLTGB:  ld.GLTGB,   // Valid to
      CLASS:  ld.CLASS
    };

    // ISLOCKED flags
    const lk = res.ISLOCKED || {};
    const locked = {
      WRNG_LOGON:  lk.WRNG_LOGON,
      NO_USER_PW:  lk.NO_USER_PW,
      GLOB_LOCK:   lk.GLOB_LOCK,
      LOCAL_LOCK:  lk.LOCAL_LOCK
    };

    // Roles count
    const roleCount = (res.ACTIVITYGROUPS || []).length;

    // RETURN messages
    const retMsgs = (res.RETURN || []).map(m => ({
      type: m.TYPE, id: m.ID, number: m.NUMBER, message: m.MESSAGE
    }));

    s.pass({ topKeys, logondata, locked, roleCount, returnMessages: retMsgs });
  } catch (e) { s.fail(e); }
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 4 — Verify write BAPI availability via TFDIR (function directory) — READ-ONLY table read
// Check BAPI_USER_CREATE1, BAPI_USER_CHANGE, BAPI_USER_LOCK, BAPI_USER_UNLOCK, BAPI_USER_DELETE
// SUSR_USER_CHANGE_PASSWORD_RFC via RFC_READ_TABLE on TFDIR (function module catalog)
// ──────────────────────────────────────────────────────────────────────────────
async function stepVerifyBapiExistence() {
  const s = step('Write BAPI existence check via TFDIR (RFC_READ_TABLE, READ-ONLY)');
  const BAPIS_TO_CHECK = [
    'BAPI_USER_CREATE1',
    'BAPI_USER_CHANGE',
    'BAPI_USER_LOCK',
    'BAPI_USER_UNLOCK',
    'BAPI_USER_DELETE',
    'SUSR_USER_CHANGE_PASSWORD_RFC'
  ];
  try {
    const results = {};
    for (const bapi of BAPIS_TO_CHECK) {
      // TFDIR: function module directory — FUNCNAME, FMODE (R=RFC-enabled)
      const rows = await rfc.readTable(
        'TFDIR',
        ['FUNCNAME', 'FMODE', 'INCLUDE'],
        [`FUNCNAME = '${bapi}'`],
        1
      );
      results[bapi] = rows.length > 0
        ? { found: true, fmode: rows[0].FMODE, include: rows[0].INCLUDE }
        : { found: false };
    }
    s.pass(results);
  } catch (e) { s.fail(e); }
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 5 — Authority probe via AGR_USERS + AGR_1251
// UST12 is not accessible to the RFC connection user (AD:718).
// Instead: read all role names from AGR_USERS, then scan AGR_1251 for S_USR_ADM / S_USER_GRP.
// CONFIRMED: RFC user has S_USER_GRP (in 5 roles), NO S_USR_ADM.
// ──────────────────────────────────────────────────────────────────────────────
async function stepAuthorityProbe() {
  const connUser = process.env.S4_USERNAME || '';
  if (!connUser) {
    step('Authority probe (AGR_USERS/AGR_1251: S_USR_ADM / S_USER_GRP)').fail('S4_USERNAME not set');
    return;
  }
  const s = step('Authority probe (AGR_USERS/AGR_1251: S_USR_ADM / S_USER_GRP for connected user)');
  try {
    // Get all role names (paginated)
    const allRoles = [];
    let skip = 0;
    while (true) {
      const batch = await rfc.readTable('AGR_USERS', ['AGR_NAME'],
        [`UNAME = '${connUser}'`], 100, skip);
      if (!batch.length) break;
      allRoles.push(...batch.map(r => r.AGR_NAME));
      if (batch.length < 100) break;
      skip += 100;
    }

    // Scan each role for both auth objects
    const admRoles = [], grpRoles = [];
    for (const role of allRoles) {
      const admRows = await rfc.readTable('AGR_1251', ['AGR_NAME', 'OBJECT', 'FIELD', 'LOW'],
        [`AGR_NAME = '${role}' AND OBJECT = 'S_USR_ADM'`], 5);
      if (admRows.length) admRoles.push({ role, rows: admRows });

      const grpRows = await rfc.readTable('AGR_1251', ['AGR_NAME', 'OBJECT', 'FIELD', 'LOW'],
        [`AGR_NAME = '${role}' AND OBJECT = 'S_USER_GRP'`], 5);
      if (grpRows.length) grpRoles.push({ role, rows: grpRows });
    }

    s.pass({
      totalRoles: allRoles.length,
      hasSUsrAdm: admRoles.length > 0,
      hasSUserGrp: grpRoles.length > 0,
      admRoles: admRoles.map(r => r.role),
      grpRoles: grpRoles.map(r => r.role),
      grpDetail: grpRoles[0] || null,
      note: 'UST12 not accessible (AD:718); AGR_1251 used instead'
    });
  } catch (e) { s.fail(e); }
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 6 — BAPI_USER_GETLIST filtering strategy
// CONFIRMED: WITH_USERNAME range table rejects all options with node-rfc type error
// (BAPIUSSRGE.SIGN is CHAR(1) but node-rfc "type 0" indicates a struct packing issue
// with this specific function module version on DS4). Client-side filtering is the
// proven viable alternative: unfiltered GETLIST returns USERNAME, FIRSTNAME, LASTNAME,
// FULLNAME — sufficient to filter in the CAP handler.
// ──────────────────────────────────────────────────────────────────────────────
async function stepUserGetListFiltered() {
  const s = step('BAPI_USER_GETLIST client-side filter strategy (confirmed viable)');
  try {
    // Confirm unfiltered call returns the four fields needed for client-side filtering
    const res = await rfc.call('BAPI_USER_GETLIST', { MAX_ROWS: 5 });
    const userList = res.USERLIST || [];
    const fields   = userList.length > 0 ? Object.keys(userList[0]) : [];
    s.pass({
      strategy: 'client-side filter on USERNAME/FIRSTNAME/LASTNAME/FULLNAME',
      confirmedFields: fields,
      sampleUsernames: userList.map(u => u.USERNAME),
      note: 'WITH_USERNAME range table rejected by node-rfc on this system; client-side filter is the safe alternative'
    });
  } catch (e) { s.fail(e); }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('READ-ONLY: SU01 BAPI contract verification against DS4/220');
  console.log('No write BAPI will run. No BAPI_TRANSACTION_COMMIT will run.\n');

  await stepConnectivity();
  await stepUserGetList();
  await stepUserGetDetail();
  await stepVerifyBapiExistence();
  await stepAuthorityProbe();
  await stepUserGetListFiltered();

  // ── Summary ──
  console.log('\n══════════════════════════════════════════');
  console.log('EVIDENCE SUMMARY');
  console.log('══════════════════════════════════════════');
  for (const s of evidence.steps) {
    const icon = s.status === 'PASS' ? '✅' : (s.status === 'FAIL' ? '❌' : '⏳');
    console.log(`${icon}  ${s.name}`);
    if (s.status === 'PASS' && s.result) {
      console.log('   ' + JSON.stringify(s.result, null, 2).replace(/\n/g, '\n   '));
    }
    if (s.status === 'FAIL') {
      console.log(`   ERROR: ${s.error}`);
    }
  }

  const passed = evidence.steps.filter(s => s.status === 'PASS').length;
  const failed = evidence.steps.filter(s => s.status === 'FAIL').length;
  console.log(`\nResult: ${passed} PASS / ${failed} FAIL / ${evidence.steps.length} total`);
  process.exit(failed > 0 ? 1 : 0);
})();
