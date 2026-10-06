#!/usr/bin/env node
// Supervised live proof of Goods Receipt against Storage Unit (Movement Type 101).
// WRITE commands change SAP; they run only with the trailing flag --go (one SAP write per invocation,
// followed immediately by read-back). Stops at the first error; never retries.
// Usage:
//   node tools/test-gr-su-post-cycle.js read     <delivery>
//   node tools/test-gr-su-post-cycle.js simulate <delivery> [SU]
//   node tools/test-gr-su-post-cycle.js post     <delivery> <SU> --go     # REAL SAP WRITE
//   node tools/test-gr-su-post-cycle.js cancel   <matDoc> <year> --go     # REVERSE VIA 102
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');
const MATDOC_API = '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV';

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const [cmd, ...args] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const GO = flags.has('--go');
const rfc = new RfcClient();
const http = new S4HttpClient();

const raw = (label, v) => console.log(`${label}: ${JSON.stringify(v, null, 2)}`);
const stop = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const pad = (v, n) => (/^\d+$/.test(v) ? String(v).padStart(n, '0') : String(v));
const bapiError = (ret) => [].concat(ret || []).find((r) => r && (r.TYPE === 'E' || r.TYPE === 'A'));

async function inspectDelivery(delivNo) {
  const d = pad(delivNo, 10);
  const [likp] = await rfc.readTable('LIKP', ['VBELN', 'LFART', 'LFDAT', 'KOSTK', 'WBSTK', 'PKSTK', 'LIFNR'], [`VBELN = '${d}'`]);
  if (!likp) stop(`Inbound Delivery ${d} not found in LIKP`);
  const lips = await rfc.readTable('LIPS', ['VBELN', 'POSNR', 'MATNR', 'WERKS', 'LGORT', 'LFIMG', 'MEINS', 'CHARG', 'VGBEL', 'VGPOS'], [`VBELN = '${d}'`]);
  const vepo = await rfc.readTable('VEPO', ['VENUM', 'VEPOS', 'VBELN', 'POSNR', 'MATNR', 'VEMNG'], [`VBELN = '${d}'`]);
  let vekp = [];
  if (vepo.length) {
    const venums = [...new Set(vepo.map(v => v.VENUM))];
    vekp = await rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHILM', 'STATUS', 'VPOBJ', 'VPOBJKEY'], [
      `VENUM >= '${venums[0]}'`, `AND VENUM <= '${venums[venums.length - 1]}'`
    ]);
  }
  return { likp, lips, vepo, vekp };
}

(async () => {
  if (!cmd || cmd === 'help') {
    console.log('Usage:');
    console.log('  node tools/test-gr-su-post-cycle.js read     <delivery>');
    console.log('  node tools/test-gr-su-post-cycle.js simulate <delivery> [SU]');
    console.log('  node tools/test-gr-su-post-cycle.js post     <delivery> <SU> --go');
    console.log('  node tools/test-gr-su-post-cycle.js cancel   <matDoc> <year> --go');
    return;
  }

  if (cmd === 'read') {
    const [deliv] = args;
    if (!deliv) stop('Missing delivery number');
    console.log(`\n== Reading Inbound Delivery ${deliv} ==`);
    const data = await inspectDelivery(deliv);
    raw('LIKP Header', data.likp);
    raw('LIPS Items', data.lips);
    console.log(`Packed HUs / Storage Units: ${data.vekp.length}`);
    data.vekp.slice(0, 10).forEach(h => {
      const items = data.vepo.filter(p => p.VENUM === h.VENUM);
      console.log(`  SU ${h.EXIDV} (Status ${h.STATUS}, PackMat ${h.VHILM}) -> ${items.map(i => `${i.MATNR.replace(/^0+/, '')} ${i.VEMNG} KG`).join(', ')}`);
    });
    if (data.vekp.length > 10) console.log(`  ... and ${data.vekp.length - 10} more SUs`);
    return;
  }

  if (cmd === 'simulate' || cmd === 'post') {
    const [deliv, suArg] = args;
    if (!deliv) stop('Missing delivery number');
    if (cmd === 'post' && !GO) stop('Refusing to execute real SAP write without trailing --go');

    const isSimulate = cmd === 'simulate';
    const d = pad(deliv, 10);
    const data = await inspectDelivery(d);
    const item = data.lips[0];
    if (!item) stop(`Delivery ${d} has no items`);

    let targetHUs = data.vekp;
    let targetItems = data.vepo;
    if (suArg) {
      const suPad = pad(suArg, 20);
      const matched = data.vekp.find(h => h.EXIDV === suPad || h.EXIDV.replace(/^0+/, '') === suArg.replace(/^0+/, ''));
      if (!matched) stop(`Storage Unit ${suArg} not found on delivery ${d}`);
      targetHUs = [matched];
      targetItems = data.vepo.filter(p => p.VENUM === matched.VENUM);
    }

    console.log(`\n== ${isSimulate ? 'SIMULATING' : 'EXECUTING LIVE POST'} for Delivery ${d} ==`);
    console.log(`Target Storage Units (${targetHUs.length}): ${targetHUs.map(h => h.EXIDV.replace(/^0+/, '')).join(', ')}`);

    const huHeaders = targetHUs.map(h => ({
      HDL_UNIT_EXID: h.EXIDV,
      SHIP_MAT: h.VHILM,
      DELIV_NUMB: d
    }));

    const huItems = targetItems.map(p => {
      const parent = targetHUs.find(h => h.VENUM === p.VENUM);
      return {
        HDL_UNIT_EXID_INTO: parent.EXIDV,
        DELIV_NUMB: d,
        DELIV_ITEM: p.POSNR,
        MATERIAL: p.MATNR,
        BATCH: item.CHARG || '',
        PACK_QTY: p.VEMNG,
        BASE_UOM: item.MEINS
      };
    });

    const sessionResult = await rfc.session(async (call) => {
      const res = await call('BAPI_INB_DELIVERY_CONFIRM_DEC', {
        HEADER_DATA: { DELIV_NUMB: d },
        HEADER_CONTROL: {
          DELIV_NUMB: d,
          POST_GI_FLG: 'X',
          SIMULATE: isSimulate ? 'X' : ''
        },
        ITEM_DATA: [{ DELIV_NUMB: d, DELIV_ITEM: item.POSNR }],
        ITEM_CONTROL: [{ DELIV_NUMB: d, DELIV_ITEM: item.POSNR }],
        HANDLING_UNIT_HEADER: huHeaders,
        HANDLING_UNIT_ITEM: huItems
      });

      const err = bapiError(res.RETURN);
      if (err) {
        raw('BAPI_INB_DELIVERY_CONFIRM_DEC FAILED', res.RETURN);
        stop(`SAP rejected posting: [${err.ID} ${err.NUMBER}] ${err.MESSAGE}`);
      }

      if (!isSimulate) {
        console.log('Posting validated by SAP; committing LUW on same connection...');
        const commitRes = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
        const commitErr = bapiError(commitRes.RETURN);
        if (commitErr) stop(`BAPI_TRANSACTION_COMMIT failed: ${commitErr.MESSAGE}`);
      }

      return res;
    });

    if (isSimulate) {
      console.log('\n[SUCCESS] Simulation returned ZERO errors. Ready for live posting with --go.');
      return;
    }

    console.log('\n[LIVE POST SUCCESSFUL] Reading back generated documents from SAP...');
    const afterLikp = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK'], [`VBELN = '${d}'`]);
    raw('Updated LIKP', afterLikp[0]);

    // Read latest material document posted for this delivery
    const matdocs = await rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'MENGE', 'MEINS', 'BUDAT', 'CPUDT', 'CPUTM'], [
      `VBELN_IM = '${d}'`, `AND BWART = '101'`
    ]);
    if (matdocs.length) {
      console.log('\n=== REAL SAP MATERIAL DOCUMENT PERSISTED ===');
      raw('MATDOC (101 Receipt)', matdocs[matdocs.length - 1]);
    } else {
      // Check EKBE
      const ekbe = await rfc.readTable('EKBE', ['EBELN', 'EBELP', 'BELNR', 'GJAHR', 'VGABE', 'BEWTP', 'BWART', 'MENGE'], [
        `EBELN = '${item.VGBEL}'`, `AND EBELP = '${item.VGPOS}'`, `AND BWART = '101'`
      ]);
      console.log('\n=== EKBE Purchase Order History Updated ===');
      raw('EKBE rows', ekbe);
    }
    return;
  }

  if (cmd === 'cancel') {
    const [doc, year] = args;
    if (!doc || !year) stop('Usage: cancel <materialDocument> <year> --go');
    if (!GO) stop('Refusing to cancel without trailing --go');

    console.log(`\n== Cancelling Material Document ${doc}/${year} via API_MATERIAL_DOCUMENT_SRV/Cancel ==`);
    const { data } = await http.post(`${MATDOC_API}/Cancel?MaterialDocument='${pad(doc, 10)}'&MaterialDocumentYear='${year}'`, {
      csrfPath: `${MATDOC_API}/`
    });
    const rev = data?.d?.Cancel || data?.d || data;
    console.log('\n=== CANCELLATION SUCCESSFUL ===');
    raw('Reversal Document', rev);
    return;
  }

  stop(`Unknown command ${cmd}`);
})().catch((e) => {
  console.error(`\nFAILED (${e.status || '-'}): ${e.message}`);
  process.exit(1);
});
