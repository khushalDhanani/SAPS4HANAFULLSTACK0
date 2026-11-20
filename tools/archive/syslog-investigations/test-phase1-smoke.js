'use strict';
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

function redact(obj) {
  if (!obj) return obj;
  const json = JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string') {
      if (['SLGUSER', 'UNAME', 'USER', 'MANDT_USER'].includes(k)) return '[REDACTED_USER]';
      if (['SLGLTRM', 'SLGTERMIDNEW', 'TERMINAL', 'HOST'].includes(k)) return '[REDACTED_TERM]';
      if (['HOSTADR', 'IP', 'IPADDR', 'CLIENT_IP'].includes(k)) return '[REDACTED_IP]';
    }
    return v;
  });
  return JSON.parse(json);
}

async function main() {
  const rfc = new RfcClient();
  const report = {};

  console.log('=== PHASE 1 SMOKE TEST ===');

  // 0. Get Server Time & Instance info
  console.log('\n--- 0. System Info & Server Time ---');
  let serverDate = '';
  let serverTime = '';
  try {
    const sysInfo = await rfc.call('RFC_SYSTEM_INFO');
    console.log('RFC_SYSTEM_INFO:', {
      RFCSI_HOST: sysInfo.RFCSI_EXPORT.RFCSI_HOST,
      RFCSYSID: sysInfo.RFCSI_EXPORT.RFCSYSID,
      RFCDATETIME: sysInfo.RFCSI_EXPORT.RFCDATETIME
    });
    // RFCDATETIME format: YYYYMMDDHHMMSS
    const dt = sysInfo.RFCSI_EXPORT.RFCDATETIME;
    serverDate = dt.slice(0, 8);
    serverTime = dt.slice(8, 14);
    console.log(`Server Date: ${serverDate}, Server Time: ${serverTime}`);
  } catch (e) {
    console.log('RFC_SYSTEM_INFO failed, using UTC:', e.message);
    const now = new Date();
    serverDate = now.toISOString().slice(0, 10).replace(/-/g, '');
    serverTime = now.toISOString().slice(11, 19).replace(/:/g, '');
  }

  // Active instances
  const servers = await rfc.call('TH_SERVER_LIST');
  const instanceNames = (servers.LIST || []).map(s => s.NAME.trim());
  console.log('Available instances:', instanceNames);
  report.availableInstances = instanceNames;
  const targetInstance = instanceNames[0] || '[instance_00]';

  // Calculate 15 min window for SM21 (RSLG_READ_SLG)
  // Format RSLGTIME is CHAR 16: YYYYMMDDHHMMSS00
  const parseServerTimestamp = (dStr, tStr) => {
    const y = parseInt(dStr.slice(0, 4), 10);
    const m = parseInt(dStr.slice(4, 6), 10) - 1;
    const d = parseInt(dStr.slice(6, 8), 10);
    const hh = parseInt(tStr.slice(0, 2), 10);
    const mm = parseInt(tStr.slice(2, 4), 10);
    const ss = parseInt(tStr.slice(4, 6), 10);
    return new Date(Date.UTC(y, m, d, hh, mm, ss));
  };

  const serverNowDate = parseServerTimestamp(serverDate, serverTime);
  const fifteenMinsAgo = new Date(serverNowDate.getTime() - 15 * 60 * 1000);
  const oneHourAgo = new Date(serverNowDate.getTime() - 60 * 60 * 1000);

  const formatRslgTime = (dtObj) => {
    const y = dtObj.getUTCFullYear();
    const m = String(dtObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dtObj.getUTCDate()).padStart(2, '0');
    const hh = String(dtObj.getUTCHours()).padStart(2, '0');
    const mm = String(dtObj.getUTCMinutes()).padStart(2, '0');
    const ss = String(dtObj.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${d}${hh}${mm}${ss}00`;
  };

  const formatDatum = (dtObj) => {
    const y = dtObj.getUTCFullYear();
    const m = String(dtObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dtObj.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  };

  const formatUzeit = (dtObj) => {
    const hh = String(dtObj.getUTCHours()).padStart(2, '0');
    const mm = String(dtObj.getUTCMinutes()).padStart(2, '0');
    const ss = String(dtObj.getUTCSeconds()).padStart(2, '0');
    return `${hh}${mm}${ss}`;
  };

  const fromRslg = formatRslgTime(fifteenMinsAgo);
  const toRslg = formatRslgTime(serverNowDate);

  console.log(`\n--- 1. Testing RSLG_READ_SLG on instance ${targetInstance} ---`);
  console.log(`Window (15m): ${fromRslg} -> ${toRslg}`);

  try {
    const rslgRes = await rfc.call('RSLG_READ_SLG', {
      IM_INSTANCENAME: targetInstance,
      IM_FILTER_DATETIME_FROM: fromRslg,
      IM_FILTER_DATETIME_TO: toRslg,
      IM_POS: 0,
      IM_WRAPCOUNT: 0
    });

    const entries = rslgRes.T_SYSLOG_ENTRIES || [];
    console.log(`RSLG_READ_SLG Success! Returned ${entries.length} entries.`);
    console.log('Exporting params:', {
      EX_MAXSIZE: rslgRes.EX_MAXSIZE,
      EX_POS: rslgRes.EX_POS,
      EX_WRAPCOUNT: rslgRes.EX_WRAPCOUNT
    });

    report.rslg = {
      status: 'SUCCESS',
      instance: targetInstance,
      window: { from: fromRslg, to: toRslg },
      count: entries.length,
      sampleStructure: entries.length > 0 ? Object.keys(entries[0]) : null,
      sampleEntryRedacted: entries.length > 0 ? redact(entries[0]) : null
    };

    if (entries.length === 0) {
      console.log('Zero entries in 15m window. Testing 24h window for RSLG_READ_SLG sample structure...');
      const dayAgo = new Date(serverNowDate.getTime() - 24 * 60 * 60 * 1000);
      const rslg24 = await rfc.call('RSLG_READ_SLG', {
        IM_INSTANCENAME: targetInstance,
        IM_FILTER_DATETIME_FROM: formatRslgTime(dayAgo),
        IM_FILTER_DATETIME_TO: toRslg,
        IM_POS: 0,
        IM_WRAPCOUNT: 0
      });
      const entries24 = rslg24.T_SYSLOG_ENTRIES || [];
      console.log(`24h window returned ${entries24.length} entries.`);
      report.rslg.count24h = entries24.length;
      if (entries24.length > 0) {
        report.rslg.sampleStructure = Object.keys(entries24[0]);
        report.rslg.sampleEntryRedacted = redact(entries24[0]);
      }
    }
  } catch (err) {
    console.error('RSLG_READ_SLG Exception:', err);
    report.rslg = {
      status: 'EXCEPTION',
      error: err.message || String(err),
      key: err.key
    };
  }

  // 2. Testing RSAU_API_GET_LOG_DATA
  const datFrom = formatDatum(oneHourAgo);
  const datTo = formatDatum(serverNowDate);
  const timFrom = formatUzeit(oneHourAgo);
  const timTo = formatUzeit(serverNowDate);

  console.log(`\n--- 2. Testing RSAU_API_GET_LOG_DATA ---`);
  console.log(`Window (1h): ${datFrom} ${timFrom} -> ${datTo} ${timTo}`);

  try {
    const rsauRes = await rfc.call('RSAU_API_GET_LOG_DATA', {
      IS_INTERVAL: {
        DAT_FROM: datFrom,
        DAT_TO: datTo,
        TIM_FROM: timFrom,
        TIM_TO: timTo
      },
      ID_FILE_SEL_SIMPLE: 'X'
    });

    const logEntries = rsauRes.ET_LOG || [];
    const logUtcEntries = rsauRes.ET_LOG_UTC || [];
    const retMessages = rsauRes.ET_RETURN || [];
    console.log(`RSAU_API_GET_LOG_DATA Success! ET_LOG: ${logEntries.length}, ET_LOG_UTC: ${logUtcEntries.length}`);
    console.log('ET_RETURN messages:', retMessages);

    report.rsau = {
      status: 'SUCCESS',
      window: { datFrom, timFrom, datTo, timTo },
      countEtLog: logEntries.length,
      countEtLogUtc: logUtcEntries.length,
      returnMessages: retMessages,
      sampleStructureLog: logEntries.length > 0 ? Object.keys(logEntries[0]) : null,
      sampleStructureUtc: logUtcEntries.length > 0 ? Object.keys(logUtcEntries[0]) : null,
      sampleEntryRedacted: logEntries.length > 0 ? redact(logEntries[0]) : null
    };

    if (logEntries.length === 0) {
      console.log('ET_LOG returned 0 rows in 1h window. Checking 24h window...');
      const dayAgo = new Date(serverNowDate.getTime() - 24 * 60 * 60 * 1000);
      const rsau24 = await rfc.call('RSAU_API_GET_LOG_DATA', {
        IS_INTERVAL: {
          DAT_FROM: formatDatum(dayAgo),
          DAT_TO: datTo,
          TIM_FROM: formatUzeit(dayAgo),
          TIM_TO: timTo
        },
        ID_FILE_SEL_SIMPLE: 'X'
      });
      console.log(`24h window returned ET_LOG: ${(rsau24.ET_LOG || []).length}, ET_RETURN:`, rsau24.ET_RETURN);
      report.rsau.count24h = (rsau24.ET_LOG || []).length;
      if ((rsau24.ET_LOG || []).length > 0) {
        report.rsau.sampleStructureLog = Object.keys(rsau24.ET_LOG[0]);
        report.rsau.sampleEntryRedacted = redact(rsau24.ET_LOG[0]);
      }
    }
  } catch (err) {
    console.error('RSAU_API_GET_LOG_DATA Exception:', err);
    report.rsau = {
      status: 'EXCEPTION',
      error: err.message || String(err),
      key: err.key
    };
  }

  // 2b. If RSAU returned 0 rows, check Security Audit configuration (READ-ONLY)
  console.log('\n--- 2b. Checking Security Audit Log Configuration (READ-ONLY) ---');
  try {
    const cfg = await rfc.call('RSAU_API_GET_AUDIT_CONFIG');
    console.log('RSAU_API_GET_AUDIT_CONFIG return:');
    console.log('  Active profile:', cfg.E_PROFILE_NAME || cfg.E_ACTIVE_PROFILE);
    console.log('  Config info keys:', Object.keys(cfg));
    report.auditConfig = {
      status: 'SUCCESS',
      profile: cfg.E_PROFILE_NAME || cfg.E_ACTIVE_PROFILE || null,
      params: cfg.ET_PARAM || null,
      return: cfg.ET_RETURN || null
    };
  } catch (e) {
    console.log('RSAU_API_GET_AUDIT_CONFIG call failed:', e.message);
    try {
      const cfgSecu = await rfc.call('RSAU_GET_AUDIT_CONFIG');
      console.log('RSAU_GET_AUDIT_CONFIG keys:', Object.keys(cfgSecu));
      report.auditConfig = { status: 'SUCCESS_ALT', keys: Object.keys(cfgSecu) };
    } catch (e2) {
      console.log('RSAU_GET_AUDIT_CONFIG also failed:', e2.message);
      report.auditConfig = { status: 'EXCEPTION', error: e.message };
    }
  }

  // Check audit files list (read-only)
  try {
    const files = await rfc.call('RSAU_LIST_AUDIT_FILES');
    const fList = files.AUDIT_FILE_LIST || [];
    console.log(`Audit files count: ${fList.length}`);
    report.auditFiles = {
      count: fList.length,
      sample: fList.slice(0, 3).map(f => redact(f))
    };
  } catch (e) {
    console.log('RSAU_LIST_AUDIT_FILES failed:', e.message);
    report.auditFiles = { error: e.message };
  }

  fs.writeFileSync('scratch/phase1_smoke_results.json', JSON.stringify(report, null, 2));
  console.log('\nSaved smoke results to scratch/phase1_smoke_results.json');
}

main().catch(console.error);
