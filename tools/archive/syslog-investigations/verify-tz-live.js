'use strict';

require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function main() {
  const rfc = new RfcClient();
  const nowUtc = new Date();
  console.log('Current machine UTC time:', nowUtc.toISOString());

  // Let's call RFC_SYSTEM_INFO or check server time directly
  try {
    const sysInfo = await rfc.call('RFC_SYSTEM_INFO', {});
    console.log('RFC_SYSTEM_INFO RFCSI_EXP:', sysInfo.RFCSI_EXP);
  } catch (e) {
    console.log('RFC_SYSTEM_INFO failed:', e.message);
  }

  // Read newest SM21 entry
  const istNow = new Date(nowUtc.getTime() + 330 * 60 * 1000);
  const ist10mAgo = new Date(istNow.getTime() - 10 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}00`;

  const sm21 = await rfc.call('RSLG_READ_SLG', {
    IM_INSTANCENAME: '[instance_00]',
    IM_FILTER_DATETIME_FROM: fmt(ist10mAgo),
    IM_FILTER_DATETIME_TO: fmt(istNow),
    IM_POS: 0,
    IM_WRAPCOUNT: 0,
  });
  const sm21Rows = sm21.T_SYSLOG_ENTRIES || [];
  console.log(`SM21 entries in last 10m: ${sm21Rows.length}`);
  if (sm21Rows.length > 0) {
    const last = sm21Rows[sm21Rows.length - 1];
    console.log(`SM21 latest entry SLGDATTIM: ${last.SLGDATTIM}, SLGTYPE: ${last.SLGTYPE}, SLGDATA: ${last.SLGDATA}`);
  }

  // Query SM20 with wide window covering today
  const y = nowUtc.getUTCFullYear();
  const m = pad(nowUtc.getUTCMonth()+1);
  const d = pad(nowUtc.getUTCDate());
  const sm20 = await rfc.call('RSAU_API_GET_LOG_DATA', {
    IS_INTERVAL: {
      DAT_FROM: `${y}${m}${d}`,
      DAT_TO: `${y}${m}${d}`,
      TIM_FROM: '000000',
      TIM_TO: '235959',
    },
    ID_FILE_SEL_SIMPLE: 'X',
  });
  const sm20Rows = sm20.ET_LOG || [];
  console.log(`SM20 ET_LOG entries today: ${sm20Rows.length}`);
  if (sm20Rows.length > 0) {
    const last20 = sm20Rows[sm20Rows.length - 1];
    console.log(`SM20 latest entry: SAL_DATE=${last20.SAL_DATE}, SAL_TIME=${last20.SAL_TIME}, LOG_TSTMP=${last20.LOG_TSTMP}`);
  }
}

main().catch(console.error);
