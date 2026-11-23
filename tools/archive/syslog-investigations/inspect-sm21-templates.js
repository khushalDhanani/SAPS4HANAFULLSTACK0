'use strict';

require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const realRfcLoader = () => require('../node_modules/node-rfc');
const rfc = new RfcClient(process.env, realRfcLoader);
const templates = require('../srv/integration/s4hana/admin/sm21-templates.json');

async function main() {
  await rfc.session(async (call) => {
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}00`;
      
      const istNow = new Date(now.getTime() + 330 * 60 * 1000);
      const ist12hAgo = new Date(istNow.getTime() - 12 * 60 * 60 * 1000);
      
      const res = await call('RSLG_READ_SLG', {
        IM_INSTANCENAME: '',
        IM_FILTER_DATETIME_FROM: fmt(ist12hAgo),
        IM_FILTER_DATETIME_TO: fmt(istNow),
        IM_POS: 0,
      });
      
      const rows = res.T_SYSLOG_ENTRIES || [];
      console.log('Total entries read:', rows.length);
      
      const typeCounts = {};
      const samples = [];
      for (const r of rows) {
        const type = r.SLGTYPE || '';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        const key = type.length === 4 ? type.substring(1) : type;
        const tmpl = templates[key] || templates[type] || null;
        samples.push({
          type,
          key,
          template: tmpl,
          data: r.SLGDATA,
          user: r.SLGUSER,
          proc: r.SLGPROC,
          time: r.SLGDATTIM,
          repna: r.SLGREPNA
        });
      }
      console.log('Unique SLGTYPEs found:', typeCounts);
      
      const selected = [];
      for (const s of samples) {
        if (!selected.some(x => x.type === s.type)) {
          selected.push(s);
        }
      }
      console.log('Sample rows with templates:');
      for (const item of selected) {
        console.log(JSON.stringify(item));
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  });
}

main();
