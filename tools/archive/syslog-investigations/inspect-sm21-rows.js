'use strict';

require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function main() {
  const rfc = new RfcClient();
  const now = new Date();
  // 60 minutes ago
  const pad = (n) => String(n).padStart(2, '0');
  // IST offset approx +5:30
  const istNow = new Date(now.getTime() + 330 * 60 * 1000);
  const istFrom = new Date(istNow.getTime() - 60 * 60 * 1000);
  
  const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}00`;

  console.log('Calling RSLG_READ_SLG for instance [instance_00]...');
  const res = await rfc.call('RSLG_READ_SLG', {
    IM_INSTANCENAME: '[instance_00]',
    IM_FILTER_DATETIME_FROM: fmt(istFrom),
    IM_FILTER_DATETIME_TO: fmt(istNow),
    IM_POS: 0,
    IM_WRAPCOUNT: 0,
  });

  const rows = res.T_SYSLOG_ENTRIES || [];
  console.log(`Received ${rows.length} rows.`);

  // Print 3 rows, redacting any sensitive data (usernames, IPs, terminals)
  const sample = rows.slice(0, 3).map(r => {
    const copy = { ...r };
    // Redact user
    if (copy.SLGUSER) copy.SLGUSER = '[REDACTED_USER]';
    if (copy.SLGLTRM) copy.SLGLTRM = '[REDACTED_TERM]';
    if (copy.SLGTERMIDNEW) copy.SLGTERMIDNEW = '[REDACTED_TERMID]';
    // Inspect SLGDATA
    return copy;
  });

  console.log('Sample 3 rows:');
  console.log(JSON.stringify(sample, null, 2));

  // Also compare with SM20 timestamps for Timezone check!
  console.log('\nCalling RSAU_API_GET_LOG_DATA for SM20...');
  const dFrom = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}`;
  const tFrom = `${pad(now.getUTCHours())}0000`;
  const tTo = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const auditRes = await rfc.call('RSAU_API_GET_LOG_DATA', {
    IS_INTERVAL: {
      DAT_FROM: dFrom,
      DAT_TO: dFrom,
      TIM_FROM: tFrom,
      TIM_TO: tTo,
    },
    ID_FILE_SEL_SIMPLE: 'X',
  });

  console.log(`SM20 ET_LOG rows: ${(auditRes.ET_LOG || []).length}, ET_LOG_UTC rows: ${(auditRes.ET_LOG_UTC || []).length}`);
  if ((auditRes.ET_LOG || []).length > 0) {
    const r0 = auditRes.ET_LOG[0];
    console.log(`SM20 ET_LOG sample timestamp: SAL_DATE=${r0.SAL_DATE}, SAL_TIME=${r0.SAL_TIME}, LOG_TSTMP=${r0.LOG_TSTMP}`);
  }
  if ((auditRes.ET_LOG_UTC || []).length > 0) {
    const r0_utc = auditRes.ET_LOG_UTC[0];
    console.log(`SM20 ET_LOG_UTC sample timestamp: SAL_DATE=${r0_utc.SAL_DATE}, SAL_TIME=${r0_utc.SAL_TIME}, LOG_TSTMP=${r0_utc.LOG_TSTMP}`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
