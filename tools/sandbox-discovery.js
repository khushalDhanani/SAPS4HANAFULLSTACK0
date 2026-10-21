#!/usr/bin/env node
require('./live-sap-gate')();
'use strict';
/**
 * Read-only discovery for the WM sandbox matrix (Phase A). Every value comes from the live system
 * (RFC_READ_TABLE / RFC_GET_FUNCTION_INTERFACE) or from repo configuration; nothing is defaulted.
 * CLI:   node tools/sandbox-discovery.js > /tmp/discovery.md   (markdown; failed reads print "NOT READ")
 * API:   const { createReaders } = require('./sandbox-discovery'); const r = createReaders(rfc); await r.stock(...)
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const { resolveWarehouse } = require('../srv/integration/s4hana/wm/warehouseResolver');

const MVTS = ['201', '241', '311', '301'];
const yyyymmdd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return yyyymmdd(d); };
const strip = (v) => String(v || '').replace(/^0+(?=\d)/, '');
const padMat = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);
const num = (v) => { let s = String(v ?? '').trim(); if (!s) return 0; const neg = s.includes('-'); s = s.replace(/[-\s]/g, ''); const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')); const n = i < 0 ? Number(s) : Number(`${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1)}`); return neg ? -n : n; };
/** OR list as one short WHERE line per value (RFC_READ_TABLE rejects long / "suspicious" lines). */
const orList = (field, values) => values.map((v, i) => `${i === 0 ? '( ' : 'OR '}${field} = '${v}'`).concat([')']);
const andOr = (field, values) => orList(field, values).map((l, i) => (i === 0 ? `AND ${l}` : l));
/** Storage types the repo marks as not pickable (package.json cds.s4.mvt261NotReadyBins). */
const notReadyTypes = () => { try { return (require('@sap/cds').env.s4.mvt261NotReadyBins || []).map((b) => b.storageType); } catch (_) { return []; } };

function createReaders(rfc) {
  const dd03l = async (tab) => {
    const rows = await rfc.readTable('DD03L', ['POSITION', 'FIELDNAME', 'KEYFLAG', 'ROLLNAME', 'DOMNAME', 'DATATYPE', 'LENG'], [`TABNAME = '${tab}'`, "AND AS4LOCAL = 'A'"]);
    return rows.filter((r) => r.FIELDNAME && !r.FIELDNAME.startsWith('.')).sort((a, b) => Number(a.POSITION) - Number(b.POSITION));
  };
  const dd04t = async (rollnames) => {
    const out = {};
    for (const r of [...new Set(rollnames.filter(Boolean))]) {
      const t = await rfc.readTable('DD04T', ['DDTEXT'], [`ROLLNAME = '${r}'`, "AND DDLANGUAGE = 'E'", "AND AS4LOCAL = 'A'"], 1);
      out[r] = t[0]?.DDTEXT || '';
    }
    return out;
  };
  const fieldsWithText = async (tab) => {
    const f = await dd03l(tab);
    const t = await dd04t(f.map((r) => r.ROLLNAME));
    return f.map((r) => ({ ...r, TEXT: t[r.ROLLNAME] || '' }));
  };

  return {
    dd03l, dd04t, fieldsWithText,
    warehouse: (lgnum) => resolveWarehouse(rfc, { warehouseNumber: lgnum }),

    /** A1: plant / storage location pairs assigned to the warehouse (T320). */
    wmPairs: (wh) => rfc.readTable('T320', ['WERKS', 'LGORT', 'LGNUM', 'LGNTB', 'OBEST'], [`LGNUM = '${wh}'`]),

    /** A2: T333 rows, all fields. */
    t333: async (wh, mvts = MVTS) => {
      const fields = (await dd03l('T333')).map((r) => r.FIELDNAME).filter((f) => f !== 'MANDT');
      const rows = await rfc.readTable('T333', fields, [`LGNUM = '${wh}'`, ...andOr('BWLVS', mvts)]);
      return { fields, rows };
    },
    /** Stock removal search (T334T, KZEAR 'A'): storage type indicator -> list of searchable storage types ('***' = all). */
    removalSearch: async (wh) => {
      const cols = ['LGTKZ', 'BESTQ', 'SOBKZ', ...Array.from({ length: 30 }, (_, i) => (i < 10 ? `LGTY${i}` : `LGT${i}`))];
      const rows = await rfc.readTable('T334T', cols, [`LGNUM = '${wh}'`, "AND KZEAR = 'A'", "AND BESTQ = ''", "AND SOBKZ = ''"]);
      const map = {};
      for (const x of rows) map[x.LGTKZ || ''] = cols.slice(3).map((c) => String(x[c] || '').trim()).filter(Boolean);
      return map;
    },
    /** Material WM view: removal storage type indicator (MLGN-LTKZA), looked up in T334T. */
    mlgn: (matnr, wh) => rfc.readTable('MLGN', ['LTKZA', 'LTKZE', 'LGBKZ'], [`MATNR = '${padMat(matnr)}'`, `AND LGNUM = '${wh}'`], 1),
    /** Interim storage types of the warehouse = every VLTYP/NLTYP/RLTYP named by any T333 row (read, not assumed). */
    interimTypes: async (wh) => {
      const rows = await rfc.readTable('T333', ['BWLVS', 'VLTYP', 'NLTYP', 'RLTYP'], [`LGNUM = '${wh}'`]);
      return [...new Set(rows.flatMap((x) => [x.VLTYP, x.NLTYP, x.RLTYP]).map((v) => String(v || '').trim()).filter(Boolean))].sort();
    },
    /** A2: DDIC search for the IM -> WM mapping table (by description and by field RBLVS). */
    ddicSearch: async () => {
      const byText = await rfc.readTable('DD02T', ['TABNAME', 'DDTEXT'], ["DDLANGUAGE = 'E'", "AND ( TABNAME LIKE 'T3%' OR TABNAME LIKE 'T15%' )", "AND ( DDTEXT LIKE '%WM%' OR DDTEXT LIKE '%Warehouse%' )"], 60);
      const byField = await rfc.readTable('DD03L', ['TABNAME', 'FIELDNAME', 'KEYFLAG'], ["FIELDNAME = 'RBLVS'", "AND AS4LOCAL = 'A'", "AND TABNAME LIKE 'T%'"], 60);
      return { byText, byField };
    },
    t156s: (mvts = MVTS) => rfc.readTable('T156S', ['BWART', 'SOBKZ', 'KZBEW', 'KZZUG', 'KZVBR', 'RBLVS', 'UMRBL'], orList('BWART', mvts)),
    t321: (wh, rblvs) => rfc.readTable('T321', ['LGNUM', 'RBLVS', 'BSLVS', 'KZBEW', 'SOBKZ', 'BSSKZ', 'LGREF', 'BWLVS', 'TBFKZ', 'TAFKZ', 'UBFKZ', 'BESTQ'], [`LGNUM = '${wh}'`, ...andOr('RBLVS', rblvs)]),

    /** A4: T156 fields whose text mentions reservations, plus the live row for the movement types. */
    t156Reservation: async (mvts = MVTS) => {
      const fields = await fieldsWithText('T156');
      const hits = fields.filter((f) => /reserv/i.test(f.TEXT));
      const sel = ['BWART', ...hits.map((h) => h.FIELDNAME)];
      const rows = hits.length ? await rfc.readTable('T156', sel, orList('BWART', mvts)) : [];
      return { hits, rows };
    },

    /** A5a/b: free stock in the warehouse joined with MARC (batch/serial profile) and MARD (IM stock). */
    stock: async (wh, excludeTypes = [], max = 300) => {
      const rows = await rfc.readTable('LQUA', ['LQNUM', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA', 'LENUM', 'BESTQ', 'SOBKZ'], [`LGNUM = '${wh}'`, 'AND VERME > 0', "AND BESTQ = ''", "AND SOBKZ = ''"], max);
      const usable = rows.filter((r) => !excludeTypes.includes(r.LGTYP)).map((r) => ({ ...r, VERME: num(r.VERME) }));
      const keys = [...new Set(usable.map((r) => `${r.MATNR}|${r.WERKS}`))].slice(0, 40);
      const marc = {};
      for (const k of keys) {
        const [m, w] = k.split('|');
        const p = await rfc.readTable('MARC', ['XCHPF', 'SERNP'], [`MATNR = '${m}'`, `AND WERKS = '${w}'`], 1);
        marc[k] = { XCHPF: p[0]?.XCHPF || '', SERNP: p[0]?.SERNP || '' };
      }
      return usable.map((r) => ({ ...r, ...(marc[`${r.MATNR}|${r.WERKS}`] || { XCHPF: '?', SERNP: '?' }) }));
    },
    mardPlant: (matnr, werks) => rfc.readTable('MARD', ['LGORT', 'LABST'], [`MATNR = '${padMat(matnr)}'`, `AND WERKS = '${werks}'`], 20),
    mard: (matnr, werks, lgort) => rfc.readTable('MARD', ['LABST', 'INSME', 'SPEME'], [`MATNR = '${padMat(matnr)}'`, `AND WERKS = '${werks}'`, `AND LGORT = '${lgort}'`], 1),

    /** A5c: account assignments and receiving targets. */
    /** Company code of a plant (T001K, valuation area = plant). */
    companyCode: async (werks) => (await rfc.readTable('T001K', ['BWKEY', 'BUKRS'], [`BWKEY = '${werks}'`], 1))[0]?.BUKRS || '',
    costCenters: async (bukrs = '') => {
      const fields = (await dd03l('CSKS')).map((r) => r.FIELDNAME);
      const sel = ['KOKRS', 'KOSTL', 'DATBI', 'DATAB', 'BUKRS', 'BKZKP'].filter((f) => fields.includes(f));
      const rows = await rfc.readTable('CSKS', sel, [`DATBI >= '${yyyymmdd(new Date())}'`, ...(bukrs ? [`AND BUKRS = '${bukrs}'`] : [])], 20);
      return { fields: sel, rows: rows.filter((r) => !String(r.BKZKP || '').trim()) };
    },
    assets: async (bukrs = '') => {
      const fields = (await dd03l('ANLA')).map((r) => r.FIELDNAME);
      const sel = ['BUKRS', 'ANLN1', 'ANLN2', 'DEAKT', 'AKTIV', 'ANLKL'].filter((f) => fields.includes(f));
      const rows = await rfc.readTable('ANLA', sel, ["DEAKT = '00000000'", ...(bukrs ? [`AND BUKRS = '${bukrs}'`] : [])], 20);
      return { fields: sel, rows: rows.filter((r) => r.AKTIV && r.AKTIV !== '00000000') };
    },
    /** Serial-managed materials of the WM plants (MARC-SERNP) that hold free stock in the warehouse. */
    serialMaterials: async (wh, plants, max = 60) => {
      const out = [];
      for (const w of plants) {
        const marc = await rfc.readTable('MARC', ['MATNR', 'WERKS', 'SERNP', 'XCHPF'], [`WERKS = '${w}'`, "AND SERNP <> ''"], max);
        for (const m of marc) {
          const q = await rfc.readTable('LQUA', ['LQNUM', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA'], [`LGNUM = '${wh}'`, `AND MATNR = '${m.MATNR}'`, `AND WERKS = '${w}'`, 'AND VERME > 0'], 3);
          if (q.length) out.push({ ...m, quants: q.map((x) => ({ ...x, VERME: num(x.VERME) })) });
        }
      }
      return out;
    },
    t001l: (werks) => rfc.readTable('T001L', ['WERKS', 'LGORT', 'LGOBE', 'XHUPF'], [`WERKS = '${werks}'`]),
    /** Handling-unit requirement of a storage location (T001L-XHUPF, read from the DDIC: system-metadata §26). */
    huFlag: async (werks, lgort) => String((await rfc.readTable('T001L', ['XHUPF'], [`WERKS = '${werks}'`, `AND LGORT = '${lgort}'`], 1))[0]?.XHUPF || '').trim(),
    marcPlants: (matnr) => rfc.readTable('MARC', ['WERKS', 'XCHPF', 'SERNP'], [`MATNR = '${padMat(matnr)}'`]),

    /** A5d: recent reservations per movement type with their WM / MM document chain. */
    recentReservations: (mvt, days = 30, max = 5) => rfc.readTable('RKPF', ['RSNUM', 'BWART', 'RSDAT', 'USNAM', 'KOSTL', 'ANLN1', 'ANLN2', 'UMWRK', 'UMLGO'], [`BWART = '${mvt}'`, `AND RSDAT >= '${daysAgo(days)}'`], max),
    /** WM movement type the app itself puts on a staging TR (ReservationProcessAdapter.createTransferRequirement). */
    appTrMovementType: (mvt) => (mvt === '201' || mvt === '241' ? '311' : mvt),
    chain: async (wh, rsnum, rsdat = '', expectedBwlvs = '') => {
      const rs = String(rsnum).padStart(10, '0');
      const resb = await rfc.readTable('RESB', ['RSPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDMNG', 'ENMNG', 'KZEAR', 'XLOEK'], [`RSNUM = '${rs}'`]);
      const LTBK_F = ['TBNUM', 'BWLVS', 'STATU', 'BETYP', 'BENUM', 'RSNUM', 'BDATU', 'NLTYP', 'NLPLA', 'VLTYP', 'VLPLA'];
      let ltbk = await rfc.readTable('LTBK', LTBK_F, [`LGNUM = '${wh}'`, `AND RSNUM = '${rs}'`]);
      let link = 'LTBK-RSNUM';
      if (!ltbk.length && rsdat && resb[0]) {
        // 311/301 staging TRs are created without RSNUM (ReservationProcessAdapter.createTransferRequirement):
        // candidate TRs of the same day whose first item carries the reservation's material and quantity.
        const sameDay = await rfc.readTable('LTBK', LTBK_F, [`LGNUM = '${wh}'`, `AND BDATU = '${rsdat}'`], 50);
        for (const h of sameDay) {
          if (strip(h.RSNUM) && strip(h.RSNUM) !== '0') continue; // a TR that names another reservation is not a candidate
          if (expectedBwlvs && h.BWLVS !== expectedBwlvs) continue; // only the WM movement type the app creates for this IM type
          const items = await rfc.readTable('LTBP', ['MATNR', 'MENGA'], [`LGNUM = '${wh}'`, `AND TBNUM = '${h.TBNUM}'`], 1);
          if (items[0] && items[0].MATNR === resb[0].MATNR && num(items[0].MENGA) === num(resb[0].BDMNG)) ltbk.push(h);
        }
        link = ltbk.length ? 'candidate: same BDATU, material and quantity (TR has no RSNUM)' : 'none';
      }
      const ltbp = [], ltak = [], ltap = [];
      for (const h of ltbk) {
        ltbp.push(...await rfc.readTable('LTBP', ['TBNUM', 'TBPOS', 'MATNR', 'MENGA', 'TAMEN', 'ELIKZ'], [`LGNUM = '${wh}'`, `AND TBNUM = '${h.TBNUM}'`]));
        const heads = await rfc.readTable('LTAK', ['TANUM', 'TBNUM', 'BWLVS', 'KQUIT', 'BDATU'], [`LGNUM = '${wh}'`, `AND TBNUM = '${h.TBNUM}'`]);
        ltak.push(...heads);
        for (const t of heads) ltap.push(...await rfc.readTable('LTAP', ['TANUM', 'TAPOS', 'TBPOS', 'MATNR', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT', 'NSOLA', 'CHARG'], [`LGNUM = '${wh}'`, `AND TANUM = '${t.TANUM}'`]));
      }
      const matdoc = await rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'SGTXT', 'CANCELLED', 'REVERSAL_MOVEMENT'], [`RSNUM = '${rs}'`], 20);
      return { resb, ltbk, ltbp, ltak, ltap, matdoc, link };
    },
    lqua: (wh, matnr) => rfc.readTable('LQUA', ['LQNUM', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA', 'LENUM'], [`LGNUM = '${wh}'`, `AND MATNR = '${padMat(matnr)}'`, 'AND VERME > 0']),

    /** A6: users and their profiles (no password columns are selected). */
    users: async () => {
      const usr02 = await rfc.readTable('USR02', ['BNAME', 'USTYP', 'UFLAG', 'GLTGB', 'CLASS'], [], 1000);
      const ust04 = await rfc.readTable('UST04', ['BNAME', 'PROFILE'], []); // no row cap: a cap hid profiles of later users
      return { usr02, ust04 };
    }
  };
}

/** Phase C helper: pick test data for one movement type from the discovery readers (no defaults). */
async function pickTestData(r, wh, mvt, { needBatch = false, needSerial = false } = {}) {
  const pairs = await r.wmPairs(wh);
  const { rows: t333 } = await r.t333(wh);
  // Excluded quants: staging destinations of the four movement types (T333 NLTYP) and the repo's not-ready types.
  // Whether a quant can be removed is decided by the warehouse's stock removal search (T334T) per material, read live.
  const interim = [...new Set([...t333.map((x) => x.NLTYP), ...notReadyTypes()].filter(Boolean))];
  const stock = await r.stock(wh, interim);
  const inWm = stock.filter((s) => pairs.some((p) => p.WERKS === s.WERKS && p.LGORT === s.LGORT));
  const removal = await r.removalSearch(wh);
  const ltkza = {};
  const removable = [];
  for (const s of inWm) {
    if (ltkza[s.MATNR] === undefined) ltkza[s.MATNR] = String((await r.mlgn(s.MATNR, wh))[0]?.LTKZA || '').trim();
    const types = removal[ltkza[s.MATNR]];
    if (types && (types.includes('***') || types.includes(s.LGTYP))) removable.push({ ...s, LTKZA: ltkza[s.MATNR], T334T: `A/${ltkza[s.MATNR] || '(blank)'} -> ${types.join(',')}` });
  }
  // largest free quantity first (the quants SAP removed from in the verified runs were the large 902 quants)
  const cand = removable.filter((s) => (needBatch ? s.XCHPF === 'X' : true) && (needSerial ? !!s.SERNP : !s.SERNP)).sort((a, b) => b.VERME - a.VERME);
  let pick = cand[0];
  let receiving = null;
  if (mvt === '311') {
    // 311 needs a receiving storage location the material is extended to (MARD) in the same plant, other than the
    // issuing one; a WM-managed one (T320) is preferred. Sandbox run 2026-10-12 07:42 UTC failed on a T320-only pick.
    const seen = new Set();
    let fallback = null;
    for (const c of cand) {
      if (seen.has(c.MATNR) || seen.size >= 60) continue;
      seen.add(c.MATNR);
      // receiving location: material extended there (MARD), same HU requirement as the issuing one (T001L-XHUPF;
      // sandbox 07:51 UTC: "Transfer posting with WM only possible if both storage locs subject to HU"), WM-managed preferred
      const hu = await r.huFlag(c.WERKS, c.LGORT);
      const slocs = [];
      for (const l of (await r.mardPlant(c.MATNR, c.WERKS)).map((m) => m.LGORT).filter((l) => l && l !== c.LGORT)) if ((await r.huFlag(c.WERKS, l)) === hu) slocs.push(l);
      const wm = slocs.find((l) => pairs.some((p) => p.WERKS === c.WERKS && p.LGORT === l));
      if (wm) { receiving = { ReceivingStorageLocation: wm, ReceivingSource: `MARD ${c.WERKS}/${wm} (WM-managed, T320; XHUPF '${hu}' = issuing)` }; pick = c; break; }
      if (!fallback && slocs[0]) fallback = { c, receiving: { ReceivingStorageLocation: slocs[0], ReceivingSource: `MARD ${c.WERKS}/${slocs[0]} (not in T320; XHUPF '${hu}' = issuing)` } };
    }
    if (!receiving && fallback) { receiving = fallback.receiving; pick = fallback.c; }
    if (!receiving) return { error: `no WM stock material extended to a second storage location (MARD) for 311 in ${wh}` };
  }
  if (mvt === '301') {
    // 301 needs a material that exists in a second plant with a storage location (MARC + MARD, read live)
    const seen = new Set();
    for (const c of cand) {
      if (seen.has(c.MATNR) || seen.size >= 60) continue;
      seen.add(c.MATNR);
      const plants = (await r.marcPlants(c.MATNR)).filter((p) => p.WERKS !== c.WERKS);
      const hu = await r.huFlag(c.WERKS, c.LGORT);
      for (const p of plants) {
        for (const m of await r.mardPlant(c.MATNR, p.WERKS)) {
          if ((await r.huFlag(p.WERKS, m.LGORT)) !== hu) continue; // same HU requirement as the issuing location
          receiving = { ReceivingPlant: p.WERKS, ReceivingStorageLocation: m.LGORT, ReceivingSource: `MARC ${p.WERKS} + MARD ${p.WERKS}/${m.LGORT} (XHUPF '${hu}' = issuing)` }; break;
        }
        if (receiving) break;
      }
      if (receiving) { pick = c; break; }
    }
    if (!receiving) return { error: `no WM stock material extended to a second plant (MARC/MARD) for 301 in ${wh}` };
  }
  if (!pick) return { error: `no removable WM stock (T334T 'A' row for the material's MLGN-LTKZA) matching batch=${needBatch} serial=${needSerial} in ${wh}` };
  const data = { Material: strip(pick.MATNR), Plant: pick.WERKS, StorageLocation: pick.LGORT, Unit: pick.MEINS, Available: pick.VERME, Batch: pick.CHARG, StorageType: pick.LGTYP, Bin: pick.LGPLA, XCHPF: pick.XCHPF, SERNP: pick.SERNP, RemovalSearch: pick.T334T, source: `LQUA ${pick.LQNUM}` };
  const bukrs = await r.companyCode(pick.WERKS);
  data.CompanyCode = bukrs;
  // Account assignments: a value already used by a recent reservation of the same plant is preferred (proven postable);
  // otherwise the first valid row of the master table (CSKS / ANLA) of the plant's company code.
  if (mvt === '201') { const latest = (await r.recentReservations('201')).find((x) => x.KOSTL?.trim()); const cc = latest ? { rows: [] } : await r.costCenters(bukrs); data.CostCenter = latest?.KOSTL || cc.rows[0]?.KOSTL; data.CostCenterSource = latest ? `RKPF ${latest.RSNUM}` : (cc.rows[0] ? `CSKS ${bukrs}` : 'none'); }
  if (mvt === '241') { const latest = (await r.recentReservations('241')).find((x) => x.ANLN1?.trim()); const a = latest ? { rows: [] } : await r.assets(bukrs); data.AssetNo = strip(latest?.ANLN1 || a.rows[0]?.ANLN1 || ''); data.SubNumber = latest?.ANLN2 || a.rows[0]?.ANLN2; data.AssetSource = latest ? `RKPF ${latest.RSNUM}` : (a.rows[0] ? `ANLA ${bukrs}` : 'none'); }
  if (mvt === '311' || mvt === '301') Object.assign(data, receiving);
  return data;
}

module.exports = { createReaders, pickTestData, MVTS, num, strip, padMat, daysAgo, yyyymmdd };

if (require.main === module) {
  const out = (s = '') => console.log(s);
  const notRead = (what, e) => out(`**NOT READ** (${what}): ${String(e && e.message || e).split('\n')[0]}`);
  const table = (rows, cols) => { if (!rows || !rows.length) { out('(no rows)'); return; } out(`| ${cols.join(' | ')} |`); out(`|${cols.map(() => '---').join('|')}|`); for (const r of rows) out(`| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '/')).join(' | ')} |`); };
  const r = createReaders(new RfcClient());
  (async () => {
    const lgnum = process.argv.find((arg) => arg.startsWith('--lgnum='))?.slice('--lgnum='.length) || '';
    const wh = await r.warehouse(lgnum);
    out(`\n## Discovery (${new Date().toISOString().slice(0, 10)}, read-only; request warehouse ${wh})`);

    out('\n### A1. WM-managed plant / storage location pairs (T320)');
    let pairs = [];
    try { pairs = await r.wmPairs(wh); table(pairs, ['WERKS', 'LGORT', 'LGNUM', 'LGNTB', 'OBEST']); } catch (e) { notRead('T320', e); }

    out('\n### A2. T333 rows (all fields) for 201 / 241 / 311 / 301');
    let t333 = { fields: [], rows: [] };
    try { t333 = await r.t333(wh); table(t333.rows, t333.fields); } catch (e) { notRead('T333', e); }

    out('\n### A2. DDIC search for the IM -> WM mapping table');
    out('\nDD02T, English texts containing "WM" or "Warehouse", table names T3* / T15*:');
    try { const s = await r.ddicSearch(); table(s.byText, ['TABNAME', 'DDTEXT']); out('\nDD03L tables (T*) that carry field RBLVS (reference movement type for WM):'); table(s.byField, ['TABNAME', 'FIELDNAME', 'KEYFLAG']); } catch (e) { notRead('DDIC search', e); }

    out('\n### A2. IM movement type -> reference movement type (T156S) -> WM movement type (T321)');
    let t156s = [];
    try { t156s = await r.t156s(); table(t156s, ['BWART', 'SOBKZ', 'KZBEW', 'KZZUG', 'KZVBR', 'RBLVS', 'UMRBL']); } catch (e) { notRead('T156S', e); }
    try {
      const rb = [...new Set(t156s.map((x) => x.RBLVS).filter(Boolean))];
      const t321 = rb.length ? await r.t321(wh, rb) : [];
      out(`\nT321 for warehouse ${wh}, RBLVS in (${rb.join(', ') || '-'}):`);
      table(t321, ['LGNUM', 'RBLVS', 'BSLVS', 'KZBEW', 'SOBKZ', 'BSSKZ', 'LGREF', 'BWLVS', 'TBFKZ', 'TAFKZ', 'UBFKZ', 'BESTQ']);
    } catch (e) { notRead('T321', e); }

    out('\n### A3. Field that controls automatic TR creation (DDIC text, T321)');
    try { const f = (await r.fieldsWithText('T321')).filter((x) => ['TBFKZ', 'TAFKZ', 'UBFKZ', 'BWLVS', 'RBLVS'].includes(x.FIELDNAME)); table(f, ['FIELDNAME', 'ROLLNAME', 'DATATYPE', 'LENG', 'TEXT']); } catch (e) { notRead('T321 DD04T', e); }

    out('\n### A4. Is movement type 301 allowed for reservations? (T156 fields whose text mentions reservations)');
    try { const q = await r.t156Reservation(); if (!q.hits.length) out('NOT FOUND: no T156 field text contains "reserv".'); else { table(q.hits, ['FIELDNAME', 'ROLLNAME', 'DATATYPE', 'LENG', 'TEXT']); out('\nLive T156 rows:'); table(q.rows, ['BWART', ...q.hits.map((h) => h.FIELDNAME)]); } } catch (e) { notRead('T156', e); }
    try { const rk = await r.recentReservations('301'); out(`\nEmpirical: RKPF reservations with BWART 301 since ${daysAgo(30)}:`); table(rk, ['RSNUM', 'BWART', 'RSDAT', 'USNAM', 'UMWRK', 'UMLGO']); } catch (e) { notRead('RKPF 301', e); }

    out('\n### A5a/b. Free WM stock (LQUA VERME > 0, BESTQ blank, SOBKZ blank; interim storage types excluded) with MARC batch/serial profile');
    let stock = [];
    let allInterim = [];
    try { allInterim = await r.interimTypes(wh); } catch (e) { notRead('T333 interim types', e); }
    const interim = [...new Set([...allInterim, ...notReadyTypes()])];
    out(`Storage types excluded: interim types named by any T333 row of ${wh} (VLTYP/NLTYP/RLTYP) = ${allInterim.join(', ') || '-'}; repo config cds.s4.mvt261NotReadyBins = ${notReadyTypes().join(', ') || '-'}`);
    try {
      stock = await r.stock(wh, interim);
      const inWm = stock.filter((s) => pairs.some((p) => p.WERKS === s.WERKS && p.LGORT === s.LGORT));
      out(`\n${stock.length} quants read, ${inWm.length} in WM-managed pairs. First 40:`);
      table(inWm.slice(0, 40), ['LQNUM', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA', 'LENUM', 'XCHPF', 'SERNP']);
      const b = inWm.find((s) => s.XCHPF === 'X'); const sn = inWm.find((s) => s.SERNP && s.SERNP !== '?');
      out(`\nBatch-managed material with stock: ${b ? `${strip(b.MATNR)} (${b.WERKS}/${b.LGORT}, batch ${b.CHARG}, ${b.VERME} ${b.MEINS} at ${b.LGTYP}/${b.LGPLA})` : 'none found in the first 300 quants'}`);
      out(`Serial-managed material with stock: ${sn ? `${strip(sn.MATNR)} (${sn.WERKS}/${sn.LGORT}, profile ${sn.SERNP}, ${sn.VERME} ${sn.MEINS} at ${sn.LGTYP}/${sn.LGPLA})` : 'none found in the first 300 quants'}`);
      const seen = new Set();
      for (const s of inWm) { const k = `${s.MATNR}|${s.WERKS}|${s.LGORT}`; if (seen.has(k) || seen.size >= 5) continue; seen.add(k); try { const m = await r.mard(s.MATNR, s.WERKS, s.LGORT); out(`MARD ${strip(s.MATNR)} ${s.WERKS}/${s.LGORT}: LABST ${m[0]?.LABST ?? '(none)'}`); } catch (e) { notRead('MARD', e); } }
    } catch (e) { notRead('LQUA/MARC', e); }
    try {
      const plants = [...new Set(pairs.map((p) => p.WERKS))];
      const sm = await r.serialMaterials(wh, plants);
      out(`\nSerial-managed materials (MARC-SERNP <> '' in plants ${plants.join(', ')}) with free stock in ${wh}:${sm.length ? '' : ' none'}`);
      table(sm.flatMap((m) => m.quants.map((q) => ({ MATNR: m.MATNR, WERKS: m.WERKS, SERNP: m.SERNP, XCHPF: m.XCHPF, ...q }))), ['MATNR', 'WERKS', 'SERNP', 'XCHPF', 'LQNUM', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA']);
    } catch (e) { notRead('MARC SERNP / LQUA', e); }

    out('\n### A5c. Account assignments and receiving targets');
    const bukrsOf = {};
    for (const w of [...new Set(pairs.map((p) => p.WERKS))]) { try { bukrsOf[w] = await r.companyCode(w); } catch (e) { notRead(`T001K ${w}`, e); } }
    out(`Company code per WM plant (T001K BWKEY -> BUKRS): ${Object.entries(bukrsOf).map(([w, b]) => `${w} -> ${b || '?'}`).join(', ')}`);
    for (const b of [...new Set(Object.values(bukrsOf).filter(Boolean))]) {
      try { const c = await r.costCenters(b); out(`\nCSKS (company code ${b}, valid today, not blocked for postings; fields ${c.fields.join(', ')}):`); table(c.rows, c.fields); } catch (e) { notRead(`CSKS ${b}`, e); }
      try { const a = await r.assets(b); out(`\nANLA (company code ${b}, not deactivated, capitalised; fields ${a.fields.join(', ')}):`); table(a.rows, a.fields); } catch (e) { notRead(`ANLA ${b}`, e); }
    }
    for (const w of [...new Set(pairs.map((p) => p.WERKS))]) { try { const l = await r.t001l(w); out(`\nT001L storage locations of plant ${w}: ${l.map((x) => `${x.LGORT} (${x.LGOBE})`).join(', ')}`); } catch (e) { notRead(`T001L ${w}`, e); } }

    out('\n### A5d. Reservations of the last 30 days per movement type and how SAP behaved');
    for (const mvt of MVTS) {
      out(`\n#### Movement type ${mvt}`);
      try {
        const rk = (await r.recentReservations(mvt, 30, 40)).sort((a, b) => (b.RSDAT + b.RSNUM).localeCompare(a.RSDAT + a.RSNUM));
        table(rk.slice(0, 8), ['RSNUM', 'BWART', 'RSDAT', 'USNAM', 'KOSTL', 'ANLN1', 'ANLN2', 'UMWRK', 'UMLGO']);
        // show the most recent reservation that has a WM chain, else the most recent one
        let best = null;
        for (const x of rk.slice(0, 8)) { const c = await r.chain(wh, x.RSNUM, x.RSDAT, r.appTrMovementType(mvt)); if (!best || (c.ltak.length + c.matdoc.length) > (best.c.ltak.length + best.c.matdoc.length)) best = { x, c }; if (c.ltak.length && c.matdoc.length) break; }
        if (best) {
          const c = best.c;
          out(`\nChain of reservation ${strip(best.x.RSNUM)} (TR link: ${c.link}):`);
          out('RESB:'); table(c.resb, ['RSPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDMNG', 'ENMNG', 'KZEAR', 'XLOEK']);
          out('LTBK:'); table(c.ltbk, ['TBNUM', 'BWLVS', 'STATU', 'BETYP', 'BENUM', 'RSNUM', 'BDATU', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA']);
          out('LTBP:'); table(c.ltbp, ['TBNUM', 'TBPOS', 'MATNR', 'MENGA', 'TAMEN', 'ELIKZ']);
          out('LTAK:'); table(c.ltak, ['TANUM', 'TBNUM', 'BWLVS', 'KQUIT', 'BDATU']);
          out('LTAP:'); table(c.ltap, ['TANUM', 'TAPOS', 'TBPOS', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT', 'NSOLA', 'CHARG']);
          out('MATDOC:'); table(c.matdoc, ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'SGTXT', 'CANCELLED', 'REVERSAL_MOVEMENT']);
          const nl = [...new Set(c.ltap.map((x) => `${x.NLTYP}/${x.NLPLA}`))];
          out(`\nObserved: destination ${nl.join(', ') || '-'}; TR BWLVS ${[...new Set(c.ltbk.map((x) => x.BWLVS))].join(', ') || '-'}; RESB KZEAR ${c.resb.map((x) => x.KZEAR || "' '").join(', ')}; MATDOC SGTXT ${[...new Set(c.matdoc.map((x) => x.SGTXT || "' '"))].join(', ') || '-'}`);
        } else out('No reservation with this movement type in the last 30 days.');
      } catch (e) { notRead(`chain ${mvt}`, e); }
    }

    out('\n### A6. Lock object and users with limited authorization');
    out('Lock object EMRESB: see sections 5 and 21 (ENQUEUE_EMRESB / DEQUEUE_EMRESB, not remote-enabled, section 16).');
    try {
      const u = await r.users();
      const prof = {}; for (const x of u.ust04) (prof[x.BNAME] = prof[x.BNAME] || []).push(x.PROFILE);
      const limited = u.usr02.filter((x) => String(x.UFLAG || '0').trim() === '0' && !(prof[x.BNAME] || []).includes('SAP_ALL'));
      out(`USR02 rows read: ${u.usr02.length}; UST04 rows read: ${u.ust04.length}. Users not locked (UFLAG 0) and without profile SAP_ALL:`);
      table(limited.map((x) => ({ ...x, PROFILES: (prof[x.BNAME] || []).join(' ') })), ['BNAME', 'USTYP', 'UFLAG', 'GLTGB', 'PROFILES']);
      out(`\nRFC user ${process.env.S4_USERNAME ? '(from S4_USERNAME)' : ''} profiles: ${(prof[(process.env.S4_USERNAME || '').toUpperCase()] || []).join(' ') || 'NOT READ'}`);
    } catch (e) { notRead('USR02/UST04', e); out('Negative authorization test: not verified (no limited user could be read).'); }
  })().catch((e) => { notRead('discovery', e); process.exit(1); });
}
