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
//   node tools/test-hu-bapi-cycle.js move   <HU> <material> <qty> <unit> <plant> <fromSloc> <toSloc> [batch] --go   # WRITE: 311 + HU via API_MATERIAL_DOCUMENT_SRV
//   node tools/test-hu-bapi-cycle.js cancel <materialDocument> <year> --go                                          # WRITE: API Cancel (312)
// --adapter routes the write through HandlingUnitAdapter.create/pack/unpack/remove instead of raw BAPI calls.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const { S4HttpClient } = require('../srv/integration/s4hana/S4HttpClient');
const HandlingUnitAdapter = require('../srv/integration/s4hana/wm/HandlingUnitAdapter');
const { buildBaseItem, buildHeaderEnvelope } = require('../srv/integration/s4hana/wm/goods-issue/s4common');
const MATDOC_API = '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV';

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const [cmd, ...args] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const GO = flags.has('--go');
const rfc = new RfcClient();
const adapter = new HandlingUnitAdapter({ rfc });
const http = new S4HttpClient();
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

/** One OData POST to API_MATERIAL_DOCUMENT_SRV (CSRF handled by S4HttpClient). Prints request + response. */
async function odataPost(path, data) {
  raw(`  POST ${path} body`, data);
  if (!GO) { console.log('DRY RUN (add --go to write)'); process.exit(0); }
  try {
    const res = await http.post(path, { data, csrfPath: `${MATDOC_API}/` });
    raw(`  POST response HTTP ${res.status} sap-message`, res.headers?.['sap-message'] || null);
    const body = res.data?.d || res.data || {};
    raw('  POST response body', body);
    return body;
  } catch (e) {
    stop(`POST failed HTTP ${e.status || '-'}: ${e.message}`);
  }
}

/** Stock + HU location + material document rows after a movement (read-only). */
async function stockBack(material, plant, slocs, hu, doc, year) {
  for (const l of slocs) raw(`  MARD ${material} ${plant}/${l}`, await read('MARD', ['LABST', 'INSME', 'SPEME'], [`MATNR = '${pad(material, 18)}'`, `AND WERKS = '${plant}'`, `AND LGORT = '${l}'`]));
  raw(`  VEKP ${hu} location`, await read('VEKP', ['VENUM', 'WERKS', 'LGORT', 'STATUS', 'VPOBJ'], [`EXIDV = '${pad(hu, 20)}'`]));
  if (doc) {
    raw(`  MKPF ${doc}/${year}`, await read('MKPF', ['MBLNR', 'MJAHR', 'BLART', 'BUDAT', 'USNAM', 'TCODE2'], [`MBLNR = '${doc}'`, `AND MJAHR = '${year}'`]));
    raw(`  MSEG ${doc}/${year}`, await read('MSEG', ['ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'UMWRK', 'UMLGO', 'MENGE', 'MEINS', 'SMBLN', 'SJAHR'], [`MBLNR = '${doc}'`, `AND MJAHR = '${year}'`]));
  }
}

const cmds = {
  // 311 transfer posting of the HU's material into another storage location, referencing the HU
  // (API_MATERIAL_DOCUMENT_SRV deep insert, goods movement code 04, item HandlingUnitExternalID). Target may be
  // HU-managed: this is the "pack into an HU-managed SLoc" goods movement (HU event 0001 = movement type 311).
  async move([hu, material, q, unit, plant, fromSloc, toSloc, batch]) {
    if (!hu || !material || !q || !unit || !plant || !fromSloc || !toSloc) stop('usage: move <HU> <material> <qty> <unit> <plant> <fromSloc> <toSloc> [batch] --go');
    console.log(`== MOVE HU ${hu} (${q} ${unit} of ${material}) ${plant}/${fromSloc} -> ${plant}/${toSloc} via 311 + HandlingUnitExternalID`);
    console.log('[before]'); await stockBack(material, plant, [fromSloc, toSloc], hu);
    const item = buildBaseItem({ Material: material, Unit: unit, IssueQty: q, Plant: plant, StorageLocation: fromSloc, Batch: batch }, '311');
    item.IssuingOrReceivingPlant = plant;
    item.IssuingOrReceivingStorageLoc = toSloc;
    item.HandlingUnitExternalID = hu;
    const payload = buildHeaderEnvelope({ gmCode: '04', headerText: `HU move proof ${hu}`.slice(0, 25), postingDate: new Date(), item });
    const body = await odataPost(`${MATDOC_API}/A_MaterialDocumentHeader`, payload);
    const doc = body.MaterialDocument, year = body.MaterialDocumentYear;
    if (!doc) stop('no MaterialDocument in the response');
    console.log(`\n[after] material document ${doc}/${year}`); await stockBack(material, plant, [fromSloc, toSloc], hu, doc, year);
    await readBack(hu);
    console.log(`\nRESULT: POSTED — material document ${doc}/${year}; verify MSEG 311 rows + VEKP LGORT above. Reverse with: cancel ${doc} ${year} --go`);
  },

  // Reverse one material document with the API's Cancel function import (SAP posts the reversal movement, e.g. 312).
  async cancel([doc, year]) {
    if (!doc || !year) stop('usage: cancel <materialDocument> <year> --go');
    console.log(`== CANCEL material document ${doc}/${year}`);
    const body = await odataPost(`${MATDOC_API}/Cancel?MaterialDocument='${doc}'&MaterialDocumentYear='${year}'`, {});
    const rev = body.Cancel || body;
    raw('  reversal document', { MaterialDocument: rev.MaterialDocument, MaterialDocumentYear: rev.MaterialDocumentYear });
    if (rev.MaterialDocument) raw(`  MSEG ${rev.MaterialDocument}/${rev.MaterialDocumentYear}`, await read('MSEG', ['ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'UMWRK', 'UMLGO', 'MENGE', 'MEINS', 'SMBLN'], [`MBLNR = '${rev.MaterialDocument}'`, `AND MJAHR = '${rev.MaterialDocumentYear}'`]));
    console.log('\nRESULT: reversal posted (check the MSEG rows above; then re-run `read <HU>` and MARD via `move` dry run)');
  },

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
