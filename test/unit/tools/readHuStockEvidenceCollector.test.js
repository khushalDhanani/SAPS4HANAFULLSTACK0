'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const { createReadOnlyRfcClient, assertNoSensitiveEnvironmentValues } = require('../../../tools/lib/readOnlyRfcGuard');
const { createCollector, evidenceFilePath, saveEvidence, describeFailure, MAX_OPTION_LINE, DEFAULT_SCOPE, FIELDS } = require('../../../tools/read-hu-stock-evidence');

const HU = (n) => String(n).padStart(20, '0');
const MAT = (n) => String(n).padStart(18, '0');

// Fake SAP: tables as row objects; the fake answers RFC_READ_TABLE in SAP's
// pipe-delimited WA format so the real RfcClient.readTable parser is exercised.
function buildTables({ lipsFields = FIELDS.LIPS, lips = [] } = {}) {
  const dd03l = [];
  const keyFields = { T301: ['MANDT', 'LGNUM', 'LGTYP'] };
  for (const [table, fields] of Object.entries({ ...FIELDS, LIPS: lipsFields })) {
    if (table === 'DD03L') continue;
    const all = [...(keyFields[table] || []), ...fields];
    [...new Set(all)].forEach((field, index) => dd03l.push({
      TABNAME: table, FIELDNAME: field, POSITION: String(index + 1).padStart(4, '0'),
      KEYFLAG: (keyFields[table] || []).includes(field) ? 'X' : '', ROLLNAME: field, DATATYPE: 'CHAR', LENG: '000003'
    }));
  }
  return {
    DD03L: dd03l,
    RESB: [
      { RSNUM: '0000529960', RSPOS: '0001', BWART: '311', MATNR: MAT(8000009754), WERKS: '1120', LGORT: 'CS02', UMLGO: 'CIS1', BDMNG: '1.000', ENMNG: '0.000', MEINS: 'NOS', KZEAR: '', XLOEK: '', AUFNR: '' },
      { RSNUM: '0000527588', RSPOS: '0001', BWART: '311', MATNR: MAT(8000006485), WERKS: '1120', LGORT: 'CS02', UMLGO: 'HU01', BDMNG: '10.000', ENMNG: '2.000', MEINS: 'NOS', KZEAR: '', XLOEK: '', AUFNR: '' },
      { RSNUM: '0000529961', RSPOS: '0001', BWART: '311', MATNR: MAT(8000009754), WERKS: '1120', LGORT: 'CS02', UMLGO: 'HU01', BDMNG: '1.000', ENMNG: '1.000', MEINS: 'NOS', KZEAR: 'X', XLOEK: '', AUFNR: '' },
      { RSNUM: '0000520235', RSPOS: '0001', BWART: '311', MATNR: MAT(8000009802), WERKS: '1150', LGORT: 'CS02', UMLGO: 'CIS1', BDMNG: '1.000', ENMNG: '0.000', MEINS: 'NOS', KZEAR: '', XLOEK: '', AUFNR: '' }
    ],
    T320: [{ WERKS: '1120', LGORT: 'CS02', LGNUM: 'WZ9' }],
    T001L: [{ WERKS: '1120', LGORT: 'CS02', XHUPF: 'X', VSTEL: '1105' }, { WERKS: '1150', LGORT: 'CS02', XHUPF: '', VSTEL: '' }],
    T301: ['902', 'OH1', 'EN1', '913'].map((LGTYP) => ({ LGNUM: 'WZ9', LGTYP })),
    T301T: [{ SPRAS: 'E', LGNUM: 'WZ9', LGTYP: 'OH1', LTYPT: 'Gr On-Hold Material' }, { SPRAS: 'E', LGNUM: 'WZ9', LGTYP: 'EN1', LTYPT: 'High rack' }],
    LQUA: [
      { LGNUM: 'WZ9', WERKS: '1120', LGORT: 'CS02', MATNR: MAT(8000009754), LENUM: HU(2000019372), LGTYP: 'EN1', LGPLA: '1-L0001-04', GESME: '1.000', VERME: '1.000', LETYP: 'E10', MEINS: 'NOS' },
      { LGNUM: 'WZ9', WERKS: '1120', LGORT: 'CS02', MATNR: MAT(8000009754), LENUM: HU(2000019363), LGTYP: '902', LGPLA: '0180000067', GESME: '1.000-', VERME: '1.000-', LETYP: 'E10', MEINS: 'NOS' },
      { LGNUM: 'WZ9', WERKS: '1120', LGORT: 'CS02', MATNR: MAT(8000009754), LENUM: HU(2000019363), LGTYP: 'OH1', LGPLA: 'ONHOLD', GESME: '1.000', VERME: '1.000', LETYP: 'E10', MEINS: 'NOS' }
    ],
    VEKP: [
      { VENUM: '0000020535', EXIDV: HU(2000019372), STATUS: '0020', WERKS: '', LGORT: '', LGNUM: 'WZ9', VPOBJ: '12', VPOBJKEY: '0180000068', VHART: 'Z007', VHILM: MAT(2000000340) },
      { VENUM: '0000020001', EXIDV: HU(2000019363), STATUS: '0020', WERKS: '', LGORT: '', LGNUM: 'WZ9', VPOBJ: '12', VPOBJKEY: '0180000067', VHART: 'Z007', VHILM: MAT(2000000340) }
    ],
    VEPO: [{ VENUM: '0000020535', VEPOS: '000005', MATNR: MAT(8000009754), WERKS: '1120', LGORT: 'CS02', CHARG: '', VEMNG: '1.000', VEMEH: 'NOS' }],
    LTAP: [{ TANUM: '0001037361', TAPOS: '0001', PQUIT: 'X', VLENR: HU(2000019372), NLENR: HU(2000019372), MATNR: MAT(8000009754), WERKS: '1120', LGORT: 'CS02', VLTYP: 'OH1', VLPLA: 'ONHOLD', NLTYP: 'EN1', NLPLA: '1-L0001-04', LETYP: 'E10', VSOLM: '1.000', VISTM: '1.000', MEINS: 'NOS' }],
    LTAK: [{ TANUM: '0001037361', LGNUM: 'WZ9', KQUIT: 'X' }],
    SER06: [{ OBKNR: '48000', VENUM: '0000020535' }],
    OBJK: [{ OBKNR: '48000', OBZAE: '1', SERNR: 'SN-SENTINEL-1', MATNR: MAT(8000009754) }],
    MARA: [{ MATNR: MAT(2000000340), VHART: 'Z007' }],
    T319A: [{ LGNUM: 'W15', VHART: 'Z007', LETYP: 'E1' }],
    LIPS: lips,
    LIKP: [{ VBELN: '0080000999', LFART: 'LF', VSTEL: '1105', WBSTK: 'A', KOSTK: 'C', LVSTK: 'C' }]
  };
}

function matches(row, whereText) {
  const pairs = [...whereText.matchAll(/(\w+) = '([^']*)'/g)].map(([, field, value]) => [field, value]);
  const orAcrossFields = /\(\s*(\w+) = '[^']*' OR (\w+) = /.exec(whereText);
  if (orAcrossFields && orAcrossFields[1] !== orAcrossFields[2]) return pairs.some(([field, value]) => row[field] === value);
  const byField = pairs.reduce((acc, [field, value]) => ((acc[field] = acc[field] || new Set()).add(value), acc), {});
  return Object.entries(byField).every(([field, values]) => values.has(row[field]));
}

function fakeRfc(tables) {
  const calls = [];
  const client = {
    call: jest.fn(async (functionName, params) => {
      calls.push({ functionName, table: params.QUERY_TABLE, where: params.OPTIONS.map((o) => o.TEXT).join(' ') });
      const fields = params.FIELDS.map((f) => f.FIELDNAME);
      const rows = (tables[params.QUERY_TABLE] || []).filter((row) => matches(row, calls[calls.length - 1].where));
      return { DATA: rows.map((row) => ({ WA: fields.map((f) => row[f] ?? '').join('|') })) };
    }),
    readTable: RfcClient.prototype.readTable
  };
  return { rfc: createReadOnlyRfcClient(client), calls };
}

describe('read-only HU evidence collector', () => {
  test('derives the warehouse from T320, confirms every table through DD03L first, and uses RFC_READ_TABLE only', async () => {
    const { rfc, calls } = fakeRfc(buildTables());
    const { evidence, collect } = createCollector({ rfc });
    await collect();

    expect(rfc.getCalledFunctions()).toEqual(['RFC_READ_TABLE']);
    expect(fs.readFileSync(path.resolve(__dirname, '../../../tools/read-hu-stock-evidence.js'), 'utf8')).not.toMatch(/'W01'/);
    expect(calls.some((c) => /LGNUM = 'W01'/.test(c.where))).toBe(false);

    // DD03L for a table precedes that table's first read.
    for (const table of new Set(calls.filter((c) => c.table !== 'DD03L').map((c) => c.table))) {
      const firstRead = calls.findIndex((c) => c.table === table);
      const schemaRead = calls.findIndex((c) => c.table === 'DD03L' && c.where === `TABNAME = '${table}'`);
      expect(schemaRead).toBeGreaterThanOrEqual(0);
      expect(schemaRead).toBeLessThan(firstRead);
    }

    expect(evidence.locations['1120/CS02']).toMatchObject({ warehouse: 'WZ9', warehouseStatus: 'DERIVED', XHUPF: 'X', VSTEL: '1105' });
    expect(evidence.locations['1150/CS02']).toMatchObject({ warehouse: null, warehouseStatus: 'T320_ROWS_0' });
    expect(evidence.open311Reservations).toHaveLength(3);
    expect(evidence.open311Reservations[0]).toMatchObject({ RSNUM: '0000529960', OpenQty: 1, Warehouse: 'WZ9', VSTEL: '1105' });
    expect(calls.filter((c) => c.table === 'LQUA').map((c) => c.where)).toEqual([
      `LGNUM = 'WZ9' AND WERKS = '1120' AND LGORT = 'CS02' AND MATNR = '${MAT(8000009754)}'`,
      `LGNUM = 'WZ9' AND WERKS = '1120' AND LGORT = 'CS02' AND MATNR = '${MAT(8000006485)}'`
    ]);
    expect(evidence.skippedReads).toContainEqual(expect.objectContaining({ table: 'LQUA', reason: 'WAREHOUSE_NOT_DERIVED' }));

    expect(evidence.t301.keyFields.map((r) => r.FIELDNAME)).toEqual(['MANDT', 'LGNUM', 'LGTYP']);
    expect(evidence.t301.storageTypeCodesByWarehouse).toEqual({ WZ9: ['902', '913', 'EN1', 'OH1'] });
    expect(evidence.t301t.WZ9.map((r) => r.LGTYP)).toEqual(['OH1', 'EN1']);

    // RFC_READ_TABLE OPTIONS are 72-character lines (live failure 2026-10-26, RFC code 5 on the T301T read).
    for (const q of evidence.queries) for (const line of q.query.where) expect(line.length).toBeLessThanOrEqual(MAX_OPTION_LINE);
    const t301t = evidence.queries.find((q) => q.query.table === 'T301T').query.where;
    expect(t301t).toEqual([
      "SPRAS = 'E'", "AND LGNUM = 'WZ9'",
      "AND ( LGTYP = '902'", "OR LGTYP = '911'", "OR LGTYP = '913'", "OR LGTYP = '921'", "OR LGTYP = 'OH1'", "OR LGTYP = 'EN1' )"
    ]);
  });

  test('refuses an over-long WHERE line before calling SAP, and describes RFC failures without secrets', async () => {
    const { rfc, calls } = fakeRfc(buildTables());
    const scope = { ...DEFAULT_SCOPE, reservations: [{ plant: '1120', storageLocation: 'X'.repeat(80) }] };
    const { collect } = createCollector({ rfc, scope });
    await expect(collect()).rejects.toMatchObject({ code: 'OPTION_LINE_TOO_LONG', query: expect.objectContaining({ table: 'RESB' }) });
    expect(calls.filter((c) => c.table === 'RESB')).toHaveLength(0);

    const live = Object.assign(new Error('secret host message'), { code: 5, key: 'OPTION_NOT_VALID', query: { table: 'T301T', where: ['x'] } });
    expect(describeFailure(live)).toEqual({ code: '5', rfcReturnCode: 'RFC_ABAP_EXCEPTION', abapException: 'OPTION_NOT_VALID', leakedKeys: null, query: { table: 'T301T', where: ['x'] } });
    expect(JSON.stringify(describeFailure(live))).not.toMatch(/secret host message/);
    expect(describeFailure(new Error('x'))).toMatchObject({ code: 'COLLECTION_FAILED', rfcReturnCode: null, abapException: null, leakedKeys: null, query: null });
    expect(describeFailure(Object.assign(new Error('leak'), { code: 'EVIDENCE_REDACTION_FAILED', keys: ['S4_USERNAME'] }))).toMatchObject({ code: 'EVIDENCE_REDACTION_FAILED', leakedKeys: ['S4_USERNAME'] });
  });

  test('saves partial evidence on failure under a .partial name and rejects leaked values', async () => {
    const { rfc } = fakeRfc(buildTables());
    const { evidence, collect } = createCollector({ rfc });
    await collect();
    const env = { S4_USERNAME: 'SAP_USER_REDACTION_SENTINEL' };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-evidence-save-'));
    try {
      evidence.failure = describeFailure(Object.assign(new Error('boom'), { code: 5 }));
      const file = saveEvidence(evidence, dir, env, new Date('2026-10-26T06:00:00Z'), { partial: true });
      expect(path.basename(file)).toBe('hu-stock-evidence.partial.raw.json');
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).failure.rfcReturnCode).toBe('RFC_ABAP_EXCEPTION');
      expect(() => saveEvidence({ leaked: 'SAP_USER_REDACTION_SENTINEL' }, dir, env)).toThrow(/sensitive environment value/);
      expect(fs.existsSync(path.join(dir, 'hu-stock-evidence.raw.json'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports stock per storage type with negative-quant flags and no total or shortfall', async () => {
    const { rfc } = fakeRfc(buildTables());
    const { evidence, collect } = createCollector({ rfc });
    await collect();
    const stock = evidence.stockByStorageType.find((s) => s.material === MAT(8000009754));
    expect(stock).toMatchObject({ warehouse: 'WZ9', rowCount: 3, hasNegativeQuants: true });
    expect(stock.byStorageType['902']).toMatchObject({ quantity: -1, negativeQuants: [{ LENUM: HU(2000019363), GESME: '1.000-' }] });
    expect(stock.byStorageType.OH1).toMatchObject({ quantity: 1, negativeQuants: [] });
    expect(stock.byStorageType.EN1).toMatchObject({ quantity: 1, storageUnits: [HU(2000019372)] });
    expect(JSON.stringify(stock)).not.toMatch(/total|shortfall/i);
  });

  test('reads serials for every LQUA HU via SER06/OBJK, VHILM/MARA packaging, T319A for derived and comparison warehouses, and deliveries', async () => {
    const lips = [{ VBELN: '0080000999', POSNR: '000010', MATNR: MAT(8000009754), WERKS: '1120', LGORT: 'CS02', LFIMG: '1.000', VRKME: 'NOS', VGBEL: '0000529960', VGPOS: '000001', RSNUM: '0000529960', RSPOS: '0001' }];
    const { rfc, calls } = fakeRfc(buildTables({ lips }));
    const { evidence, collect } = createCollector({ rfc });
    await collect();

    const target = evidence.serials.find((s) => s.HU === HU(2000019372));
    expect(target).toMatchObject({ VENUM: ['0000020535'], serialNumbers: ['SN-SENTINEL-1'], status: 'READ' });
    expect(evidence.serials.map((s) => s.HU)).toEqual(expect.arrayContaining([HU(2000019363), HU(2000019371), HU(2000020150), HU(2000020151)]));
    expect(evidence.huSummaries).toHaveLength(4);
    expect(evidence.packaging.vekpVhilm).toContainEqual({ HU: HU(2000019372), VHILM: [MAT(2000000340)] });
    expect(evidence.packaging.mara).toEqual([{ MATNR: MAT(2000000340), VHART: 'Z007' }]);
    expect(Object.keys(evidence.t319a).sort()).toEqual(['W15', 'WZ9']);
    expect(evidence.t319a.W15.rows).toEqual([{ LGNUM: 'W15', VHART: 'Z007', LETYP: 'E1' }]);
    expect(evidence.t319a.WZ9).toEqual({ status: 'READ', rows: [] });

    const delivery = evidence.deliveries.find((d) => d.RSNUM === '0000529960');
    expect(delivery.status).toBe('READ');
    expect(delivery.LIPS_byReservation).toHaveLength(1);
    expect(delivery.LIPS_byReference).toHaveLength(1);
    expect(delivery.LIKP).toEqual([{ VBELN: '0080000999', LFART: 'LF', VSTEL: '1105', WBSTK: 'A', KOSTK: 'C', LVSTK: 'C' }]);
    expect(calls.filter((c) => c.table === 'LIPS' && /VGBEL = '0000529960'/.test(c.where))).toHaveLength(1);
    const ltap = evidence.queries.find((q) => q.query.table === 'LTAP');
    expect(ltap.openTransferOrders).toEqual([]);
  });

  test('skips LIPS fail-closed when DD03L does not confirm a field, and records it', async () => {
    const { rfc, calls } = fakeRfc(buildTables({ lipsFields: FIELDS.LIPS.filter((f) => f !== 'RSNUM') }));
    const { evidence, collect } = createCollector({ rfc });
    await collect();
    expect(calls.some((c) => c.table === 'LIPS')).toBe(false);
    expect(evidence.skippedReads).toContainEqual(expect.objectContaining({ table: 'LIPS', reason: 'DD03L_FIELDS_UNCONFIRMED', missing: ['RSNUM'] }));
    expect(evidence.deliveries.every((d) => d.status === 'NOT_READ_SCHEMA_FIELDS_UNCONFIRMED')).toBe(true);
  });

  test('serialized evidence passes the redaction scan and existing evidence files are never overwritten', async () => {
    const { rfc } = fakeRfc(buildTables());
    const { evidence, collect } = createCollector({ rfc });
    await collect();
    const env = { S4_USERNAME: 'SAP_USER_REDACTION_SENTINEL', S4_PASSWORD: 'SAP_PASSWORD_REDACTION_SENTINEL', S4_DESTINATION_URL: 'https://sap-host-redaction-sentinel.example:44300', S4_RFC_SYSNR: '00', ENABLE_DEV_TOKEN_ISSUER: 'true' };
    expect(() => assertNoSensitiveEnvironmentValues(JSON.stringify(evidence), env)).not.toThrow();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-evidence-path-'));
    try {
      expect(evidenceFilePath(dir)).toBe(path.join(dir, 'hu-stock-evidence.raw.json'));
      fs.writeFileSync(path.join(dir, 'hu-stock-evidence.raw.json'), '{}');
      expect(evidenceFilePath(dir, new Date('2026-10-26T05:31:12Z'))).toBe(path.join(dir, 'hu-stock-evidence.20261026T053112.raw.json'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
