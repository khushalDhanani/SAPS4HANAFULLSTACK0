#!/usr/bin/env node
// Supervised live test of ONE goods issue 261 and its reversal. WRITES TO SAP: one 261 and one cancel.
// Usage: node tools/test-261-post-cycle.js <reservation> <item> <quantity> <expectedOpen> <expectedStock> [batch]
//   Aborts before posting unless the item is exactly as expected. Stops at the first error; never retries.
//   Quantity 0 = blocked test: expects the app to refuse and proves no POST was sent.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const Mvt261Adapter = require('../srv/integration/s4hana/wm/Mvt261Adapter');
const { parseSapNumber } = require('../srv/integration/s4hana/sapFacts');

const [reservation, item, qtyArg, openArg, stockArg, batch] = process.argv.slice(2);
const quantity = Number(qtyArg);
const adapter = new Mvt261Adapter();
const raw = (label, v) => console.log(`${label}: ${JSON.stringify(v)}`);
const stop = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

// Log every write and count it.
let posts = 0;
const post = adapter.client.post.bind(adapter.client);
adapter.client.post = async (path, options) => {
  posts++;
  raw(`  POST ${path} body`, options.data);
  try {
    const res = await post(path, options);
    raw(`  POST response HTTP ${res.status} sap-message`, res.headers?.['sap-message'] || null);
    raw('  POST response body', res.data);
    return res;
  } catch (e) {
    raw(`  POST failed HTTP ${e.status}`, e.response?.data || e.message);
    throw e;
  }
};

const rsnum = String(reservation).padStart(10, '0');
const rspos = String(item).padStart(4, '0');
const snapshot = async (label) => {
  const [resb] = await adapter.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'AUFNR', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'XLOEK', 'KZEAR', 'XWAOK'], [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`]);
  const mard = await adapter.rfc.readTable('MARD', ['LGORT', 'LABST'], [`MATNR = '${resb.MATNR}'`, `AND WERKS = '${resb.WERKS}'`, `AND LGORT = '${resb.LGORT}'`]);
  const mchb = batch ? await adapter.rfc.readTable('MCHB', ['CHARG', 'CLABS'], [`MATNR = '${resb.MATNR}'`, `AND WERKS = '${resb.WERKS}'`, `AND LGORT = '${resb.LGORT}'`, `AND CHARG = '${batch}'`]) : [];
  const docs = await adapter.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MENGE', 'CHARG', 'SMBLN', 'CANCELLED'], [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`, "AND RECORD_TYPE = 'MDOC'"]);
  raw(`${label} RESB`, resb); raw(`${label} MARD`, mard); if (batch) raw(`${label} MCHB`, mchb); raw(`${label} MATDOC`, docs);
  return { resb, mard, mchb, docs };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log(`== Reservation ${reservation} item ${item}, quantity ${quantity}${batch ? `, batch ${batch}` : ''}`);
  console.log('\n[1] Pre-check');
  const before = await snapshot('before');
  const c = await adapter.cycle({ reservation, item });
  raw('before cycle', { OrderStatus: c.OrderStatus, OpenQuantity: c.OpenQuantity, Unit: c.Unit, Steps: c.Steps });

  if (quantity === 0) {
    console.log('\n[blocked test] asking the app to post 1 unit; it must refuse without a POST');
    try {
      const r = await adapter.postGoodsIssue({ reservation, item, quantity: 1 });
      stop(`app posted ${JSON.stringify(r)}`);
    } catch (e) {
      raw('app answer', { status: e.status, message: e.message });
      if (e.status !== 422 || posts !== 0) stop(`expected 422 and 0 POSTs, got ${e.status} and ${posts}`);
    }
    const after = await snapshot('after');
    if (!same(before, after)) stop('SAP data changed');
    console.log(`\nRESULT: PASS - refused with 422, POST calls sent: ${posts}, SAP data unchanged`);
    return;
  }

  const stock = before.mard.reduce((t, m) => t + parseSapNumber(m.LABST), 0);
  if (c.OpenQuantity !== Number(openArg)) stop(`open quantity ${c.OpenQuantity} differs from expected ${openArg}`);
  if (stock !== Number(stockArg)) stop(`stock ${stock} differs from expected ${stockArg}`);
  if (c.OrderStatus !== 'REL') stop(`order status "${c.OrderStatus}" differs from expected "REL"`);

  console.log('\n[2] Post 261');
  const gi = await adapter.postGoodsIssue({ reservation, item, quantity, batch });
  raw('app result', gi);

  console.log('\n[3] Read back after posting');
  // Live 2026-10-05: SAP returns the number before its update task has written the document; an
  // immediate GET answered 404 and the document was readable seconds later. Wait for it (reads only).
  const docPath = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader(MaterialDocumentYear='${gi.MaterialDocumentYear}',MaterialDocument='${gi.MaterialDocument}')`;
  let data;
  for (let attempt = 1; !data; attempt++) {
    try {
      ({ data } = await adapter.client.get(docPath, { query: '$expand=to_MaterialDocumentItem&$format=json' }));
    } catch (e) {
      if (e.status !== 404 || attempt === 10) throw e;
      console.log(`  document not readable yet (404), waiting 2 s (${attempt}/10)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const it = data.d.to_MaterialDocumentItem.results;
  raw('document header', { MaterialDocument: data.d.MaterialDocument, MaterialDocumentYear: data.d.MaterialDocumentYear, PostingDate: data.d.PostingDate, GoodsMovementCode: data.d.GoodsMovementCode, MaterialDocumentHeaderText: data.d.MaterialDocumentHeaderText });
  raw('document items', it.map((i) => ({ Item: i.MaterialDocumentItem, GoodsMovementType: i.GoodsMovementType, Material: i.Material, Plant: i.Plant, StorageLocation: i.StorageLocation, Batch: i.Batch, Quantity: i.QuantityInEntryUnit, Unit: i.EntryUnit, Reservation: i.Reservation, ReservationItem: i.ReservationItem, ManufacturingOrder: i.ManufacturingOrder })));
  const mid = await snapshot('posted');
  const enmng = (s) => parseSapNumber(s.resb.ENMNG);
  const labst = (s) => s.mard.reduce((t, m) => t + parseSapNumber(m.LABST), 0);
  if (enmng(mid) !== enmng(before) + quantity) stop(`ENMNG ${enmng(mid)} is not ${enmng(before)} + ${quantity}`);
  if (labst(mid) !== labst(before) - quantity) stop(`stock ${labst(mid)} is not ${labst(before)} - ${quantity}`);

  console.log('\n[4] Reverse with the API Cancel action');
  const rev = await adapter.reverse({ materialDocument: gi.MaterialDocument, materialDocumentYear: gi.MaterialDocumentYear });
  raw('app result', rev);

  console.log('\n[5] Read back after reversal');
  const after = await snapshot('reversed');
  if (enmng(after) !== enmng(before)) stop(`ENMNG ${enmng(after)} is not back to ${enmng(before)}`);
  if (labst(after) !== labst(before)) stop(`stock ${labst(after)} is not back to ${labst(before)}`);
  if (!same(before.resb, after.resb)) stop('RESB row differs from the start');
  console.log(`\nRESULT: PASS - posted ${gi.MaterialDocument}/${gi.MaterialDocumentYear}, reversed by ${rev.MaterialDocument}/${rev.MaterialDocumentYear}, ENMNG and stock back to start. POST calls sent: ${posts}`);
})().catch((e) => stop(`${e.status || '-'} ${e.message}`));
