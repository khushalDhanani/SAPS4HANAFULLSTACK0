#!/usr/bin/env node
require('./live-sap-gate')();
'use strict';
/**
 * WM sandbox matrix (Phase C). Drives the real CAP endpoints (reservation -> TR -> TO -> confirm -> goods movement),
 * reads back RESB / LTBK / LTBP / LTAK / LTAP / LQUA / MATDOC after every step and prints PASS / FAIL with raw values.
 *
 * DEFAULT = DRY RUN: test data is read from SAP (read-only) and every HTTP call is printed with its payload, nothing
 * is sent. Live writes happen only with --execute.
 *
 *   node tools/sandbox-matrix.js                       dry run, all movement types, all cases
 *   node tools/sandbox-matrix.js --mvt 311 --case full  dry run, one movement type / case
 *   node tools/sandbox-matrix.js --mvt 311 --execute    LIVE writes on the sandbox (CAP server must run: npm start)
 *   --base <url>  (default CAP_BASE_URL or http://localhost:4004)   --out <file> (default docs/abap/sandbox-results.md)
 *   CAP_USER / CAP_PASSWORD: Basic auth for the CAP mocked users (default alice / admin, as tools/run*-live.js)
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const { createReaders, pickTestData, MVTS, num, strip, padMat } = require('./sandbox-discovery');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXECUTE = flag('--execute');
const BASE = opt('--base', process.env.CAP_BASE_URL || 'http://localhost:4004');
const OUT = opt('--out', path.resolve(__dirname, '../docs/abap/sandbox-results.md'));
const ONLY_MVT = opt('--mvt', '');
const ONLY_CASE = opt('--case', '');
const AUTH = 'Basic ' + Buffer.from(`${process.env.CAP_USER || 'alice'}:${process.env.CAP_PASSWORD || 'admin'}`).toString('base64');
const CASES = ['full', 'partial', 'batch', 'serial', 'gi-failure-retry'];
const picked = {}; // test data per movement type / flags, read once per run
const pickOnce = async (r, wh, mvt, flags) => { const k = `${mvt}|${flags.needBatch}|${flags.needSerial}`; if (!picked[k]) picked[k] = await pickTestData(r, wh, mvt, flags); return picked[k]; };

const lines = [];
const out = (s = '') => { console.log(s); lines.push(s); };
const table = (rows, cols) => { if (!rows || !rows.length) { out('(no rows)'); return; } out(`| ${cols.join(' | ')} |`); out(`|${cols.map(() => '---').join('|')}|`); for (const r of rows) out(`| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '/')).join(' | ')} |`); };
const results = [];
const check = (caseId, name, ok, observed, expected) => { results.push({ caseId, name, ok, observed, expected }); out(`${ok ? 'PASS' : 'FAIL'}  ${name}  observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`); return ok; };

async function post(pathname, payload) {
  out(`\nPOST ${BASE}${pathname}`);
  out('```json'); out(JSON.stringify(payload, null, 2)); out('```');
  if (!EXECUTE) { out('(dry run: not sent)'); return null; }
  const res = await fetch(`${BASE}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: AUTH }, body: JSON.stringify(payload) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  out(`HTTP ${res.status}`); out('```json'); out(JSON.stringify(body, null, 2).slice(0, 4000)); out('```');
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}
async function get(pathname) {
  out(`\nGET ${BASE}${pathname}`);
  if (!EXECUTE) { out('(dry run: not sent)'); return null; }
  const res = await fetch(`${BASE}${pathname}`, { headers: { Accept: 'application/json', Authorization: AUTH } });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

/** Read every table of one process (by reservation, TR, TOs and ProcessIds) and print it. */
async function readProcess(rfc, wh, ctx) {
  const rs = String(ctx.rsnum || '').padStart(10, '0');
  const pid = (ctx.processIds || []).map((p) => String(p).toUpperCase());
  const snap = { resb: [], ltbk: [], ltbp: [], ltak: [], ltap: [], lqua: [], matdoc: [] };
  if (ctx.rsnum) snap.resb = await rfc.readTable('RESB', ['RSPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDMNG', 'ENMNG', 'KZEAR', 'XLOEK'], [`RSNUM = '${rs}'`]);
  if (ctx.tbnum) {
    const tb = String(ctx.tbnum).padStart(10, '0');
    snap.ltbk = await rfc.readTable('LTBK', ['TBNUM', 'BWLVS', 'STATU', 'RSNUM', 'BDATU', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA'], [`LGNUM = '${wh}'`, `AND TBNUM = '${tb}'`]);
    snap.ltbp = await rfc.readTable('LTBP', ['TBNUM', 'TBPOS', 'MATNR', 'MENGA', 'TAMEN', 'ELIKZ'], [`LGNUM = '${wh}'`, `AND TBNUM = '${tb}'`]);
    snap.ltak = await rfc.readTable('LTAK', ['TANUM', 'TBNUM', 'BWLVS', 'KQUIT', 'BDATU'], [`LGNUM = '${wh}'`, `AND TBNUM = '${tb}'`]);
    for (const h of snap.ltak) snap.ltap.push(...await rfc.readTable('LTAP', ['TANUM', 'TAPOS', 'TBPOS', 'MATNR', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT', 'NSOLA', 'CHARG'], [`LGNUM = '${wh}'`, `AND TANUM = '${h.TANUM}'`]));
  }
  if (ctx.material) snap.lqua = await rfc.readTable('LQUA', ['LQNUM', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA'], [`LGNUM = '${wh}'`, `AND MATNR = '${padMat(ctx.material)}'`, `AND WERKS = '${ctx.plant}'`, 'AND VERME > 0']);
  if (ctx.rsnum) snap.matdoc = await rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'RSNUM', 'RSPOS', 'SGTXT', 'CANCELLED', 'REVERSAL_MOVEMENT'], [`RSNUM = '${rs}'`], 50);
  for (const p of pid) { const extra = await rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'RSNUM', 'RSPOS', 'SGTXT', 'CANCELLED', 'REVERSAL_MOVEMENT'], [`SGTXT = '${p}'`], 20); for (const e of extra) if (!snap.matdoc.some((m) => m.MBLNR === e.MBLNR && m.ZEILE === e.ZEILE)) snap.matdoc.push(e); }
  out('\nRESB:'); table(snap.resb, ['RSPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDMNG', 'ENMNG', 'KZEAR', 'XLOEK']);
  out('LTBK:'); table(snap.ltbk, ['TBNUM', 'BWLVS', 'STATU', 'RSNUM', 'BDATU', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA']);
  out('LTBP:'); table(snap.ltbp, ['TBNUM', 'TBPOS', 'MATNR', 'MENGA', 'TAMEN', 'ELIKZ']);
  out('LTAK:'); table(snap.ltak, ['TANUM', 'TBNUM', 'BWLVS', 'KQUIT', 'BDATU']);
  out('LTAP:'); table(snap.ltap, ['TANUM', 'TAPOS', 'TBPOS', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT', 'NSOLA', 'CHARG']);
  out('LQUA:'); table(snap.lqua, ['LQNUM', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA']);
  out('MATDOC:'); table(snap.matdoc, ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'RSNUM', 'RSPOS', 'SGTXT', 'CANCELLED', 'REVERSAL_MOVEMENT']);
  return snap;
}

/** Serial numbers in stock for a serial-managed material (EQUI/EQBS fields verified at run time). */
async function serialsInStock(r, rfc, matnr, werks, lgort, n) {
  const equi = (await r.dd03l('EQUI')).map((x) => x.FIELDNAME);
  const eqbs = (await r.dd03l('EQBS')).map((x) => x.FIELDNAME);
  if (!['EQUNR', 'MATNR', 'SERNR'].every((f) => equi.includes(f)) || !['EQUNR', 'B_WERK', 'B_LAGER'].every((f) => eqbs.includes(f))) return { error: 'EQUI/EQBS fields not as expected (DD03L); serial numbers NOT READ' };
  const stock = await rfc.readTable('EQBS', ['EQUNR'], [`B_WERK = '${werks}'`, `AND B_LAGER = '${lgort}'`], 200);
  const found = [];
  for (const s of stock) { const e = await rfc.readTable('EQUI', ['SERNR'], [`EQUNR = '${s.EQUNR}'`, `AND MATNR = '${padMat(matnr)}'`], 1); if (e[0]?.SERNR) found.push(e[0].SERNR.trim()); if (found.length >= n) break; }
  return { serials: found };
}

const invalidFor = (mvt) => ({ '201': { CostCenter: 'ZZZZZZZZZZ' }, '241': { AssetNo: '999999999999', SubNumber: '0000' }, '311': { ReceivingStorageLocation: 'ZZZZ' }, '301': { ReceivingPlant: 'ZZZZ' } }[mvt]);
const assignment = (mvt, d) => ({ '201': { CostCenter: d.CostCenter }, '241': { AssetNo: d.AssetNo, SubNumber: d.SubNumber }, '311': { ReceivingStorageLocation: d.ReceivingStorageLocation }, '301': { ReceivingPlant: d.ReceivingPlant, ReceivingStorageLocation: d.ReceivingStorageLocation } }[mvt]);

async function runCase(rfc, r, wh, t333, mvt, caseName) {
  const caseId = `${mvt}/${caseName}`;
  out(`\n\n## Case ${caseId}`);
  if (!EXECUTE) results.push({ caseId, name: 'dry run (calls printed, nothing sent)', ok: null, dry: true });
  let d = await pickOnce(r, wh, mvt, { needBatch: caseName === 'batch', needSerial: caseName === 'serial' });
  let serials = [];
  if (caseName === 'serial') {
    // serial-managed candidates come from MARC-SERNP (all WM plants); take the first one whose serial numbers are in stock
    if (!picked.serialCandidates) picked.serialCandidates = await r.serialMaterials(wh, [...new Set((await r.wmPairs(wh)).map((p) => p.WERKS))]);
    let found = null;
    for (const m of picked.serialCandidates) {
      for (const q of m.quants) {
        const sn = await serialsInStock(r, rfc, m.MATNR, m.WERKS, q.LGORT, 2);
        if (sn.serials && sn.serials.length) { found = { ...(d.error ? {} : d), Material: strip(m.MATNR), Plant: m.WERKS, StorageLocation: q.LGORT, Unit: q.MEINS, Available: q.VERME, Batch: q.CHARG, StorageType: q.LGTYP, Bin: q.LGPLA, XCHPF: m.XCHPF, SERNP: m.SERNP, source: `MARC SERNP + LQUA ${q.LQNUM} + EQUI/EQBS`, serials: sn.serials }; break; }
        out(`serial candidate ${strip(m.MATNR)} ${m.WERKS}/${q.LGORT}: ${sn.error || `${sn.serials.length} serial numbers in EQUI/EQBS`}`);
      }
      if (found) break;
    }
    if (!found) { out('SKIPPED: no serial-managed material with serial numbers in stock (EQUI/EQBS) found'); results.push({ caseId, name: 'test data', ok: null, observed: 'no serial numbers in stock' }); return; }
    if (d.error) { const base = await pickOnce(r, wh, mvt, { needBatch: false, needSerial: false }); d = { ...(base.error ? {} : base), ...found }; } else d = { ...d, ...found };
    serials = found.serials;
  }
  if (d.error) { out(`SKIPPED: ${d.error}`); results.push({ caseId, name: 'test data', ok: null, observed: d.error }); return; }
  out('Test data (read at run time):'); out('```json'); out(JSON.stringify(d, null, 2)); out('```');
  const asg = assignment(mvt, d);
  if (Object.values(asg).some((v) => !v)) { out(`SKIPPED: no account assignment / receiving target found (${JSON.stringify(asg)})`); results.push({ caseId, name: 'test data', ok: null, observed: asg }); return; }
  const totalQty = caseName === 'partial' ? 2 : 1;
  if (d.Available < totalQty) { out(`SKIPPED: only ${d.Available} ${d.Unit} available, case needs ${totalQty}`); results.push({ caseId, name: 'test data', ok: null, observed: d.Available }); return; }
  if (caseName === 'serial') serials = serials.slice(0, totalQty);
  const batch = d.XCHPF === 'X' ? d.Batch : '';
  const expDest = t333.find((x) => x.BWLVS === r.appTrMovementType(mvt)) || {};
  const ctx = { material: d.Material, plant: d.Plant, processIds: [] };

  // Step 1: reservation + TR
  const resv = await post('/odata/v4/reservation-entry/createReservationEntry', { MovementType: mvt, Plant: d.Plant, StorageLocation: d.StorageLocation, Material: d.Material, Quantity: totalQty, Unit: d.Unit, WarehouseNumber: wh, ...(batch ? { Batch: batch } : {}), ...asg });
  if (!resv) { out('(dry run: remaining steps shown with placeholders)'); }
  ctx.rsnum = resv?.ReservationNo || '<RSNUM>'; ctx.rspos = resv?.ReservationItem || '0001'; ctx.tbnum = resv?.TransferRequirement || '<TBNUM>';
  if (resv) {
    check(caseId, 'reservation created', !!strip(resv.ReservationNo), resv.ReservationNo, 'RSNUM');
    check(caseId, 'TR created (status 02)', resv.Status_code === '02' && !!strip(resv.TransferRequirement), { Status_code: resv.Status_code, TR: resv.TransferRequirement, ErrorMessage: resv.ErrorMessage }, { Status_code: '02' });
    const s1 = await readProcess(rfc, wh, ctx);
    check(caseId, 'RESB item open', s1.resb[0] && num(s1.resb[0].BDMNG) === totalQty && !s1.resb[0].KZEAR, s1.resb[0], { BDMNG: totalQty, KZEAR: '' });
    if (resv.Status_code !== '02') return;
  }

  // Step 2: TO(s)
  const toQtys = caseName === 'partial' ? [1, totalQty - 1] : [totalQty];
  const tos = [];
  for (const [i, q] of toQtys.entries()) {
    const look = await get(`/odata/v4/tr-to/lookupTR(tbnum='${ctx.tbnum}',lgnum='${wh}',docType='TR',tbpos='')`);
    const tbpos = look?.TRItem || '<TBPOS>';
    if (look) check(caseId, `lookupTR open qty before TO ${i + 1}`, num(look.OpenQty) === totalQty - toQtys.slice(0, i).reduce((a, b) => a + b, 0), look.OpenQty, totalQty - toQtys.slice(0, i).reduce((a, b) => a + b, 0));
    const to = await post('/odata/v4/tr-to/createTOFromTR', { lgnum: wh, tbnum: ctx.tbnum, tbpos, qty: q, unit: d.Unit, batch, serials, autoConfirm: true, autoPostMigo: false });
    if (!to) continue;
    tos.push(to);
    ctx.processIds.push(to.ProcessId);
    check(caseId, `TO ${i + 1} created and confirmed (status 04)`, to.Status === '04' && !!to.TransferOrder, { TransferOrder: to.TransferOrder, Status: to.Status, ErrorMessage: to.ErrorMessage }, { Status: '04' });
    const s2 = await readProcess(rfc, wh, ctx);
    const head = s2.ltak.find((h) => strip(h.TANUM) === strip(to.TransferOrder));
    check(caseId, `LTAK KQUIT for TO ${to.TransferOrder}`, head?.KQUIT === 'X', head, { KQUIT: 'X' });
    const items = s2.ltap.filter((x) => strip(x.TANUM) === strip(to.TransferOrder));
    check(caseId, `LTAP PQUIT for TO ${to.TransferOrder}`, items.length > 0 && items.every((x) => x.PQUIT === 'X'), items.map((x) => x.PQUIT), ['X']);
    const expN = s2.ltbk[0]?.NLTYP || expDest.NLTYP || '';
    check(caseId, `LTAP destination = TR header or T333 (${expN}/${s2.ltbk[0]?.NLPLA || expDest.NLPLA || ''})`, items.every((x) => x.NLTYP === expN), items.map((x) => `${x.NLTYP}/${x.NLPLA}`), expN);
    check(caseId, 'LTBP TAMEN after TO', num(s2.ltbp[0]?.TAMEN) === toQtys.slice(0, i + 1).reduce((a, b) => a + b, 0), s2.ltbp[0]?.TAMEN, toQtys.slice(0, i + 1).reduce((a, b) => a + b, 0));
    check(caseId, 'LQUA quant at destination type', s2.lqua.some((q2) => q2.LGTYP === expN), s2.lqua.map((q2) => `${q2.LGTYP}/${q2.LGPLA}:${q2.VERME}`), expN);
    if (i === toQtys.length - 1) check(caseId, 'LTBK STATU after last TO', s2.ltbk[0]?.STATU === 'E', s2.ltbk[0]?.STATU, 'E');
    if (caseName === 'batch') check(caseId, 'LTAP CHARG = batch', items.every((x) => x.CHARG === batch), items.map((x) => x.CHARG), batch);
  }

  // Step 3: goods movement(s)
  const gmBase = { ReservationNo: ctx.rsnum, ReservationItem: ctx.rspos, MovementType: mvt, Material: d.Material, Plant: d.Plant, StorageLocation: d.StorageLocation, Unit: d.Unit, ...(batch ? { Batch: batch } : {}), ...(serials.length ? { Serials: serials } : {}) };
  const postGm = async (to, qty, over, complete) => post('/odata/v4/tr-to/postMigoGoodsMovement', { ...gmBase, TransferOrder: to, Quantity: qty, ...asg, ...over, CompleteReservation: complete });
  const toList = EXECUTE ? tos : toQtys.map(() => ({ TransferOrder: '<TANUM>' }));
  if (caseName === 'gi-failure-retry') {
    const to = toList[0]?.TransferOrder;
    const fail = await postGm(to, totalQty, invalidFor(mvt), true);
    if (fail) { check(caseId, 'forced failure -> status 90', fail.Status === '90' && !fail.MaterialDocument, { Status: fail.Status, ErrorMessage: fail.ErrorMessage }, { Status: '90' }); ctx.processIds.push(fail.ProcessId); await readProcess(rfc, wh, ctx); }
    const ok = await postGm(to, totalQty, {}, true);
    if (ok) { check(caseId, 'retry -> status 05 with material document', ok.Status === '05' && !!ok.MaterialDocument, { Status: ok.Status, MaterialDocument: ok.MaterialDocument, ProcessId: ok.ProcessId }, { Status: '05' }); check(caseId, 'retry reused the ProcessId of the failed step', ok.ProcessId === fail?.ProcessId, ok.ProcessId, fail?.ProcessId); }
    const before = ok ? (await readProcess(rfc, wh, ctx)).matdoc.length : 0;
    const again = await postGm(to, totalQty, {}, true);
    if (again) {
      check(caseId, 'second retry -> already posted, same document', again.Status === '05' && again.MaterialDocument === ok?.MaterialDocument && /already existed/i.test(again.Message || ''), { Status: again.Status, MaterialDocument: again.MaterialDocument, Message: again.Message }, { MaterialDocument: ok?.MaterialDocument });
      const after = (await readProcess(rfc, wh, ctx)).matdoc;
      check(caseId, 'no new MATDOC rows after second retry', after.length === before, after.length, before);
      const sgtxtMatch2 = after.some((m) => m.SGTXT === String(ok?.ProcessId || '').toUpperCase());
      const resMatch2 = Boolean(ctx.rsnum) && after.some((m) => strip(m.RSNUM) === strip(ctx.rsnum) && strip(m.RSPOS) === strip(ctx.rspos));
      check(caseId, 'MATDOC links to ProcessId (SGTXT) or Reservation (RSNUM/RSPOS)', sgtxtMatch2 || resMatch2, sgtxtMatch2 ? 'SGTXT' : `${strip(ctx.rsnum)}/${strip(ctx.rspos)}`, String(ok?.ProcessId || '').toUpperCase());
    }
    return;
  }
  for (const [i, to] of toList.entries()) {
    const qty = toQtys[i];
    const last = i === toList.length - 1;
    const gm = await postGm(to.TransferOrder, qty, {}, last);
    if (!gm) continue;
    ctx.processIds.push(gm.ProcessId);
    check(caseId, `goods movement ${i + 1} posted (status 05)`, gm.Status === '05' && !!gm.MaterialDocument, { Status: gm.Status, MaterialDocument: gm.MaterialDocument, ErrorMessage: gm.ErrorMessage, ProcessId: gm.ProcessId }, { Status: '05' });
    const s3 = await readProcess(rfc, wh, ctx);
    const posted = toQtys.slice(0, i + 1).reduce((a, b) => a + b, 0);
    check(caseId, 'RESB ENMNG = posted quantity', num(s3.resb[0]?.ENMNG) === posted, s3.resb[0]?.ENMNG, posted);
    check(caseId, `RESB KZEAR ${last ? 'set (CompleteReservation)' : 'not set yet'}`, (s3.resb[0]?.KZEAR === 'X') === last, s3.resb[0]?.KZEAR, last ? 'X' : '');
    const docRows = s3.matdoc.filter((m) => strip(m.MBLNR) === strip(gm.MaterialDocument));
    check(caseId, 'MATDOC rows exist for the document', docRows.length > 0, docRows.length, '>0');
    if (!docRows.length) continue; // the remaining document checks would be vacuous
    const sgtxtMatch = docRows.every((m) => m.SGTXT === String(gm.ProcessId).toUpperCase());
    const resLinkMatch = Boolean(ctx.rsnum) && docRows.every((m) => strip(m.RSNUM) === strip(ctx.rsnum) && strip(m.RSPOS) === strip(ctx.rspos));
    check(caseId, 'MATDOC links to ProcessId (SGTXT) or Reservation (RSNUM/RSPOS)', sgtxtMatch || resLinkMatch, sgtxtMatch ? String(gm.ProcessId).toUpperCase() : docRows.map((m) => `${strip(m.RSNUM)}/${strip(m.RSPOS)}`).join(','), String(gm.ProcessId).toUpperCase());
    check(caseId, 'MATDOC BWART / RSPOS', docRows.every((m) => m.BWART === mvt && m.RSPOS === ctx.rspos), docRows.map((m) => `${m.BWART}/${m.RSPOS}`), `${mvt}/${ctx.rspos}`);
    check(caseId, 'MATDOC not cancelled', docRows.every((m) => !m.CANCELLED && !m.REVERSAL_MOVEMENT), docRows.map((m) => `${m.CANCELLED}${m.REVERSAL_MOVEMENT}`), '');
    if (batch) check(caseId, 'MATDOC CHARG = batch', docRows.every((m) => m.CHARG === batch), docRows.map((m) => m.CHARG), batch);
  }
}

(async () => {
  const rfc = new RfcClient();
  const r = createReaders(rfc);
  const wh = r.warehouse();
  const t333 = (await r.t333(wh)).rows;
  out(`# Sandbox matrix results`);
  out(`\nMode: **${EXECUTE ? 'EXECUTE (live writes)' : 'DRY RUN (nothing sent)'}** | ${new Date().toISOString()} | warehouse ${wh} (cds.s4.warehouseNumber) | CAP ${BASE} | T333 destinations: ${t333.map((x) => `${x.BWLVS} -> ${x.NLTYP}/${x.NLPLA || '(dynamic)'}`).join(', ')}`);
  for (const mvt of MVTS.filter((m) => !ONLY_MVT || m === ONLY_MVT)) {
    for (const c of CASES.filter((x) => !ONLY_CASE || x === ONLY_CASE)) {
      try { await runCase(rfc, r, wh, t333, mvt, c); } catch (e) { out(`\nERROR in case ${mvt}/${c}: ${e.message}`); if (e.body) out('```json\n' + JSON.stringify(e.body, null, 2).slice(0, 2000) + '\n```'); results.push({ caseId: `${mvt}/${c}`, name: 'case aborted', ok: false, observed: e.message }); }
    }
  }
  out('\n\n## Summary');
  const byCase = {};
  for (const x of results) (byCase[x.caseId] = byCase[x.caseId] || []).push(x);
  table(Object.entries(byCase).map(([caseId, xs]) => ({ Case: caseId, Checks: xs.filter((x) => x.ok !== null).length, PASS: xs.filter((x) => x.ok === true).length, FAIL: xs.filter((x) => x.ok === false).length, Result: xs.some((x) => x.ok === false) ? 'FAIL' : (xs.some((x) => x.ok === true) ? 'PASS' : (xs.some((x) => x.dry) && !xs.some((x) => x.name === 'test data') ? 'DRY RUN' : 'SKIPPED')) })), ['Case', 'Checks', 'PASS', 'FAIL', 'Result']);
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  console.log(`\nResults written to ${OUT}`);
  process.exit(results.some((x) => x.ok === false) ? 1 : 0);
})().catch((e) => { out(`\nFATAL: ${e.message}`); fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8'); process.exit(1); });
