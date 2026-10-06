#!/usr/bin/env node
// Supervised live proof of the HU BAPIs (BAPI_HU_CREATE / PACK / UNPACK / DELETE + BAPI_TRANSACTION_COMMIT).
// WRITE commands change SAP; they run only with the trailing flag --go (one SAP write per invocation, then a
// read-back). Stops at the first error; never retries. Read-only commands: candidates, read.
//   node tools/test-hu-bapi-cycle.js candidates <plant> <sloc>
//   node tools/test-hu-bapi-cycle.js read <HU>
//   node tools/test-hu-bapi-cycle.js create <packMat> <plant> <sloc> [content] --go
//   node tools/test-hu-bapi-cycle.js pack   <HU> <material> <qty> <unit> <plant> <sloc> [batch] --go
//   node tools/test-hu-bapi-cycle.js unpack <HU> <item> <material> <qty> <unit> <plant> <sloc> [batch] --go
//   node tools/test-hu-bapi-cycle.js delete <HU> --go
// --adapter routes the write through HandlingUnitAdapter.create/pack/unpack/remove instead of raw BAPI calls.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const HandlingUnitAdapter = require('../srv/integration/s4hana/wm/HandlingUnitAdapter');

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const [cmd, ...args] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const GO = flags.has('--go');
const rfc = new RfcClient();
const adapter = new HandlingUnitAdapter({ rfc });
const raw = (label, v) => console.log(`${label}: ${JSON.stringify(v)}`);
const stop = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const pad = (v, n) => (/^\d+$/.test(v) ? v.padStart(n, '0') : v);
const qty = (v) => Number(v).toFixed(3);
const bapiError = (ret) => [].concat(ret || []).find((r) => r && (r.TYPE === 'E' || r.TYPE === 'A'));
const read = (t, f, w, n) => rfc.readTable(t, f, w, n).catch((e) => ({ error: e.message.split('\n')[0] }));

// Proven 2026-10-06 (client 220): BAPI_HU_GETLIST finds an HU only with the 20-char zero-padded external id and
// returns the key reliably with ONLYKEYS = 'X' (HUKEY). The full read (header + items) came back EMPTY for existing
// HUs and HU_GET_HUS_RFC raised HUGENERAL 099, so items are read from VEPO via RFC_READ_TABLE instead.
// HUKEY on BAPI_HU_PACK / UNPACK / DELETE is the bare field BAPIHUKEY-HU_EXID: pass the 20-char string, not {HU_EXID}
// (node-rfc rejects a structure for it client-side: "String expected from NodeJS for ABAP field"; nothing reaches SAP).
const getList = (call, exid) => call('BAPI_HU_GETLIST', { ONLYKEYS: 'X', HUNUMBERS: [{ HU_EXID: exid }] });

/** The HU key as SAP wants it: tries the given id, then 20-char zero-padded. Read-only. */
async function resolveKey(hu) {
  return rfc.session(async (call) => {
    for (const key of [...new Set([pad(hu, 20), hu])]) {
      const r = await getList(call, key);
      if ((r.HUKEY || []).length) return { key: r.HUKEY[0].HU_EXID, found: r };
    }
    return { key: null };
  });
}

/** Read-back block run after every write: GETLIST + VEKP + VEPO + the OData detail() the UI shows. */
async function readBack(hu) {
  console.log(`\n[read-back ${hu}]`);
  const { key, found } = await resolveKey(hu);
  raw('  GETLIST ONLYKEYS key', key || 'NOT FOUND (padded and unpadded)');
  if (found) raw('  GETLIST RETURN', found.RETURN);
  const vekp = await read('VEKP', ['VENUM', 'EXIDV', 'EXIDA', 'VHILM', 'WERKS', 'LGORT', 'VPOBJ', 'STATUS', 'INHALT', 'ERNAM', 'ERDAT', 'ERUHR'], [`EXIDV = '${pad(hu, 20)}'`]);
  raw('  VEKP', vekp);
  const venum = Array.isArray(vekp) && vekp[0] ? vekp[0].VENUM : null;
  const vepo = venum ? await read('VEPO', ['VENUM', 'VEPOS', 'VELIN', 'MATNR', 'CHARG', 'VEMNG', 'VEMEH', 'WERKS', 'LGORT'], [`VENUM = '${venum}'`]) : [];
  if (venum) raw('  VEPO', vepo);
  try {
    const d = await adapter.detail({ handlingUnitExternalID: hu });
    raw('  adapter.detail()', { HandlingUnitExternalID: d.HandlingUnitExternalID, Plant: d.Plant, StorageLocation: d.StorageLocation, PackagingMaterial: d.PackagingMaterial, Status: d.Status, StatusText: d.StatusText, Items: d.Items });
  } catch (e) { raw('  adapter.detail() failed', { status: e.status, message: e.message }); }
  return { key, found, vekp, items: Array.isArray(vepo) ? vepo : [] };
}

/** One BAPI + commit + GETLIST on ONE connection. Prints everything; stops (no commit) on an E/A message. */
async function bapiWrite(fm, params, keyAfter) {
  if (!GO) { raw(`DRY RUN (add --go to write) ${fm}`, params); process.exit(0); }
  return rfc.session(async (call) => {
    raw(`  ${fm} params`, params);
    const res = await call(fm, params);
    raw(`  ${fm} RETURN`, res.RETURN); raw('  HUHEADER', res.HUHEADER); raw('  HUKEY', res.HUKEY); raw('  HUITEM', res.HUITEM);
    const err = bapiError(res.RETURN);
    if (err) stop(`${fm} rejected (no commit sent): ${err.ID}/${err.NUMBER} ${err.MESSAGE}`);
    const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    raw('  BAPI_TRANSACTION_COMMIT RETURN', commit.RETURN);
    if (bapiError(commit.RETURN)) stop('commit returned an error');
    // HUKEY is exported as the bare field BAPIHUKEY-HU_EXID (a string), proven live 2026-10-06 (HU 2000020166).
    const key = (typeof res.HUKEY === 'string' && res.HUKEY) || (res.HUKEY && res.HUKEY.HU_EXID) || keyAfter;
    raw('  GETLIST ONLYKEYS (same connection)', await getList(call, key));
    return key;
  });
}

const cmds = {
  async candidates([plant, sloc]) {
    if (!plant || !sloc) stop('usage: candidates <plant> <sloc>');
    raw('T001L', await read('T001L', ['WERKS', 'LGORT', 'LGOBE', 'XHUPF'], [`WERKS = '${plant}'`, `AND LGORT = '${sloc}'`]));
    raw('T320 (WM mapping, empty = not WM-managed)', await read('T320', ['WERKS', 'LGORT', 'LGNUM'], [`WERKS = '${plant}'`, `AND LGORT = '${sloc}'`]));
    const mard = await read('MARD', ['MATNR', 'LABST', 'INSME', 'SPEME'], [`WERKS = '${plant}'`, `AND LGORT = '${sloc}'`, 'AND LABST > 0'], 15);
    raw('MARD loose unrestricted stock', mard);
    raw('MCHB batch stock', await read('MCHB', ['MATNR', 'CHARG', 'CLABS'], [`WERKS = '${plant}'`, `AND LGORT = '${sloc}'`, 'AND CLABS > 0'], 15));
    const rows = [];
    for (const m of (Array.isArray(mard) ? mard : []).slice(0, 15)) {
      const [mara] = await read('MARA', ['MTART', 'MEINS', 'XCHPF'], [`MATNR = '${m.MATNR}'`]);
      const [marc] = await read('MARC', ['XCHPF', 'SERNP'], [`MATNR = '${m.MATNR}'`, `AND WERKS = '${plant}'`]);
      const [makt] = await read('MAKT', ['MAKTX'], [`MATNR = '${m.MATNR}'`, "AND SPRAS = 'E'"]);
      rows.push({ material: m.MATNR.replace(/^0+/, ''), text: makt?.MAKTX, type: mara?.MTART, unit: mara?.MEINS, stock: m.LABST, batchManaged: (mara?.XCHPF || marc?.XCHPF) === 'X', serialProfile: marc?.SERNP || '' });
    }
    console.log('\nItem candidates (prefer batchManaged=false, serialProfile empty):');
    console.table(rows);
    raw('packaging 2000000043 MARA', await read('MARA', ['MTART', 'VHART', 'MEINS', 'BRGEW', 'GEWEI'], ["MATNR = '000000002000000043'"]));
    raw(`packaging 2000000043 MARC ${plant}`, await read('MARC', ['WERKS', 'LVORM'], ["MATNR = '000000002000000043'", `AND WERKS = '${plant}'`]));
    raw('VEKP free HUs (VPOBJ 12) sample', await read('VEKP', ['EXIDV', 'VENUM', 'WERKS', 'LGORT', 'STATUS', 'VHILM', 'ERNAM', 'ERDAT'], ["VPOBJ = '12'", `AND WERKS = '${plant}'`], 5));
  },

  async read([hu]) {
    if (!hu) stop('usage: read <HU>');
    await readBack(hu);
  },

  async create([packMat, plant, sloc, content]) {
    if (!packMat || !plant || !sloc) stop('usage: create <packMat> <plant> <sloc> [content] --go');
    console.log(`== CREATE HU: packaging ${packMat}, ${plant}/${sloc}${content ? `, content "${content}"` : ''}`);
    let key;
    if (flags.has('--adapter')) {
      if (!GO) stop('--adapter create is a write: add --go');
      const r = await adapter.create({ packagingMaterial: packMat, plant, storageLocation: sloc, content });
      raw('adapter.create()', r); key = r.HandlingUnitExternalID;
    } else {
      key = await bapiWrite('BAPI_HU_CREATE', { HEADERPROPOSAL: { PACK_MAT: pad(packMat, 18), PLANT: plant, STGE_LOC: sloc, ...(content ? { CONTENT: content } : {}) } });
    }
    const back = await readBack(key);
    if (!back.found) stop('HU not found after commit — see plan step (b) fallbacks');
    console.log(`\nRESULT: PASS — HU ${key} created and read back (VEKP + GETLIST + detail above)`);
  },

  async pack([hu, material, q, unit, plant, sloc, batch]) {
    if (!hu || !material || !q || !unit || !plant || !sloc) stop('usage: pack <HU> <material> <qty> <unit> <plant> <sloc> [batch] --go');
    console.log(`== PACK ${q} ${unit} of ${material}${batch ? ` batch ${batch}` : ''} from ${plant}/${sloc} into HU ${hu}`);
    const stockWhere = [`MATNR = '${pad(material, 18)}'`, `AND WERKS = '${plant}'`, `AND LGORT = '${sloc}'`];
    raw('MARD before', await read('MARD', ['LABST'], stockWhere));
    const { key } = await resolveKey(hu);
    if (!key) stop(`HU ${hu} not found via GETLIST`);
    if (flags.has('--adapter')) {
      if (!GO) stop('--adapter pack is a write: add --go');
      raw('adapter.pack()', await adapter.pack({ handlingUnitExternalID: hu, material, quantity: Number(q), unit, batch, plant, storageLocation: sloc }));
    } else {
      await bapiWrite('BAPI_HU_PACK', { HUKEY: key, ITEMPROPOSAL: { HU_ITEM_TYPE: '1', MATERIAL: pad(material, 18), PACK_QTY: qty(q), BASE_UNIT_QTY: unit, PLANT: plant, STGE_LOC: sloc, ...(batch ? { BATCH: batch } : {}) } }, key);
    }
    raw('MARD after', await read('MARD', ['LABST'], stockWhere));
    const back = await readBack(hu);
    if (!back.items.length) stop('no VEPO item after commit');
    console.log('\nRESULT: PASS — item packed and read back');
  },

  async unpack([hu, item, material, q, unit, plant, sloc, batch]) {
    if (!hu || !item || !material || !q || !unit || !plant || !sloc) stop('usage: unpack <HU> <item> <material> <qty> <unit> <plant> <sloc> [batch] --go');
    console.log(`== UNPACK item ${item} (${q} ${unit} of ${material}) from HU ${hu}`);
    const { key } = await resolveKey(hu);
    if (!key) stop(`HU ${hu} not found via GETLIST`);
    if (flags.has('--adapter')) {
      if (!GO) stop('--adapter unpack is a write: add --go');
      raw('adapter.unpack()', await adapter.unpack({ handlingUnitExternalID: hu, item, material, quantity: Number(q), unit, batch, plant, storageLocation: sloc }));
    } else {
      await bapiWrite('BAPI_HU_UNPACK', { HUKEY: key, ITEMUNPACK: { HU_ITEM_TYPE: '1', HU_ITEM_NUMBER: pad(item, 6), MATERIAL: pad(material, 18), PACK_QTY: qty(q), BASE_UNIT_QTY: unit, PLANT: plant, STGE_LOC: sloc, ...(batch ? { BATCH: batch } : {}) } }, key);
    }
    const back = await readBack(hu);
    if (back.items.length) stop('HU still has VEPO items after commit');
    console.log('\nRESULT: PASS — item unpacked and read back');
  },

  async delete([hu]) {
    if (!hu) stop('usage: delete <HU> --go');
    console.log(`== DELETE HU ${hu}`);
    const { key } = await resolveKey(hu);
    if (!key) stop(`HU ${hu} not found via GETLIST`);
    if (flags.has('--adapter')) {
      if (!GO) stop('--adapter delete is a write: add --go');
      raw('adapter.remove()', await adapter.remove({ handlingUnitExternalID: hu }));
    } else {
      await bapiWrite('BAPI_HU_DELETE', { HUKEY: key }, key);
    }
    const back = await readBack(hu);
    console.log(back.found ? '\nRESULT: HU still listed by GETLIST after delete — record the status SAP set (see VEKP STATUS)' : '\nRESULT: PASS — HU no longer found (GETLIST + VEKP)');
  }
};

(async () => {
  if (!cmds[cmd]) stop(`unknown command "${cmd}"; see the usage header`);
  await cmds[cmd](args);
})().catch((e) => stop(`${e.status || '-'} ${e.message}`));
