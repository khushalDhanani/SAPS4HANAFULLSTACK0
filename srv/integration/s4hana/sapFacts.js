'use strict';

/**
 * SAP facts this app depends on, each read live from the connected system (DS4, client 220) on
 * 2026-10-05, read-only. The source is cited per entry; tools/smoke-sap-readonly.js re-reads them.
 * Do not add a value here without its SAP source.
 */

/** SE91 texts (T100, language E) of the message IDs the code interprets. */
const MESSAGES = {
  'AD/718': 'Table & does not contain data', // RFC_READ_TABLE TABLE_WITHOUT_DATA; live: raised for a field that does not exist in the table
  'DA/131': 'Table & does not exist in the database',
  'L9/514': 'Delivery & created', // SAP standard, raised only in include MM07MLVS (CROSS)
  'M7/053': 'Posting only possible in periods &1 and &2 in company code &3',
  '/IWFND/MED/170': "No service found for namespace '&1', name '&2', version '&3'"
};

/** Domain RFBSK (VBRK-RFBSK), DD07T language E: posting status of a billing document. */
const RFBSK = {
  '': 'Error in Accounting Interface',
  A: 'Billing document blocked for forwarding to FI',
  B: 'Journal entry not created (account determination error)',
  C: 'Journal entry has been created',
  D: 'Billing document is not relevant for accounting',
  E: 'Billing document canceled',
  F: 'Journal entry not created (pricing error)',
  G: 'Journal entry not created (export data missing)',
  H: 'Posted via invoice list',
  I: 'Posted via invoice list (account determination error)',
  K: 'Journal entry not created (no authorization)',
  L: 'Billing doc. blocked for transfer to manager (only IS-OIL)',
  M: 'Analyst Approval refused (only IS-OIL)',
  N: 'No Journal entry due to fund management (only IS-PS)'
};

/** Domain STATV (LIKP-WBSTK/KOSTK/LVSTK/GBSTK), DD07T language E. */
const STATV = { '': 'Not Relevant', A: 'Not yet processed', B: 'Partially processed', C: 'Completely processed' };

/** Header ReferenceDocument (MATDOC-XBLNR) proven persisted by a live read-back of app-created documents. */
const REFERENCE_PERSISTED_MOVEMENT_TYPES = ['201', '261']; // 201: 4900049865; 261: 4900050018/24/28. 301/311 not proven.

let offsetPromise = null;

/**
 * UTC offset of the SAP system time zone in minutes (TTZCU-TZONESYS -> TTZZ -> TTZR). MATDOC
 * CPUDT/CPUTM and LIKP ERDAT/ERZET are system-local (live: TZONESYS = INDIA, rule P0530, no DST).
 * Throws when the zone cannot be read or uses daylight saving: callers must then treat document
 * times as unknown instead of guessing.
 * ponytail: DST zones are refused, not converted; add TTZDF rules if the system ever moves to one.
 */
function systemUtcOffsetMinutes(readTable) {
  if (!offsetPromise) {
    offsetPromise = (async () => {
      const [sys] = await readTable('TTZCU', ['TZONESYS'], []);
      const zone = sys && sys.TZONESYS;
      if (!zone) throw new Error('SAP system time zone (TTZCU-TZONESYS) is not readable');
      const [zz] = await readTable('TTZZ', ['ZONERULE', 'DSTRULE'], [`TZONE = '${zone}'`]);
      if (!zz || !zz.ZONERULE) throw new Error(`SAP time zone ${zone} has no rule in TTZZ`);
      if (zz.DSTRULE && zz.DSTRULE !== 'NONE') throw new Error(`SAP time zone ${zone} uses daylight saving (${zz.DSTRULE}); not supported`);
      const [zr] = await readTable('TTZR', ['UTCDIFF', 'UTCSIGN'], [`ZONERULE = '${zz.ZONERULE}'`]);
      if (!zr || !/^\d{6}$/.test(zr.UTCDIFF || '')) throw new Error(`SAP zone rule ${zz.ZONERULE} has no UTC difference in TTZR`);
      const minutes = Number(zr.UTCDIFF.slice(0, 2)) * 60 + Number(zr.UTCDIFF.slice(2, 4));
      return zr.UTCSIGN === '-' ? -minutes : minutes;
    })().catch((err) => { offsetPromise = null; throw err; });
  }
  return offsetPromise;
}

/** SAP local date (YYYYMMDD) + time (HHMMSS) -> epoch ms, using the system offset. */
function sapLocalToEpochMs(date, time, offsetMinutes) {
  const d = String(date || '').trim();
  const t = String(time || '000000').trim().padStart(6, '0');
  if (!/^\d{8}$/.test(d) || !/^\d{6}$/.test(t)) return NaN;
  const asUtc = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
  return asUtc - offsetMinutes * 60000;
}

/**
 * SAP RFC number string -> Number. RFC_READ_TABLE returns '100.000' and a trailing minus for
 * negatives ('5.000-'). NaN for anything else, never 0.
 */
function parseSapNumber(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return NaN;
  const neg = s.endsWith('-');
  const n = Number(neg ? s.slice(0, -1) : s); // any other format (e.g. a comma) -> NaN, not a guess
  return neg ? -n : n;
}

/** Message id ("AD/718") from an RFC error text such as "ID:AD Type:E Number:718 MATDOC", or ''. */
function rfcMessageId(err) {
  const m = /ID:(\S+)\s+Type:\w+\s+Number:(\d+)/.exec(String((err && err.message) || ''));
  return m ? `${m[1]}/${m[2]}` : '';
}

module.exports = {
  MESSAGES,
  RFBSK,
  STATV,
  REFERENCE_PERSISTED_MOVEMENT_TYPES,
  systemUtcOffsetMinutes,
  sapLocalToEpochMs,
  parseSapNumber,
  rfcMessageId,
  _resetForTests: () => { offsetPromise = null; }
};
