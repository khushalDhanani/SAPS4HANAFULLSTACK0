'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProbe, saveEvidence, FUNCTION_NAME, WANTED } = require('../../../tools/check-hu-fm-rfc');
const { createReadOnlyRfcClient } = require('../../../tools/lib/readOnlyRfcGuard');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

function fixture({ mode = 'R', missing = [], exists = true, direction = 'T', rowKind = 'E' } = {}) {
  const queries = [];
  const rows = {
    TFDIR: exists ? [{ FUNCNAME: FUNCTION_NAME, FMODE: mode, PNAME: 'SAPLHU_GOODS_MOVEMENT' }] : [],
    FUPARAREF: [
      { PARAMETER: 'IT_EXTERNAL_ID', PARAMTYPE: direction, STRUCTURE: 'HUM_EXIDV_T', OPTIONAL: '' },
      { PARAMETER: 'IT_OTHER', PARAMTYPE: direction, STRUCTURE: 'HUM_EXIDV_T', OPTIONAL: 'X' }
    ],
    DD40L: [{ TYPENAME: 'HUM_EXIDV_T', ROWTYPE: 'EXIDV', ROWKIND: rowKind }],
    ROW_FIELDS: { EXIDV: [{ FIELDNAME: 'EXIDV', POSITION: '0001', ROLLNAME: 'EXIDV', DATATYPE: 'CHAR', LENG: '000020' }] }
  };
  const client = {
    readTable: RfcClient.prototype.readTable,
    call: jest.fn(async (fm, params) => {
      queries.push({ fm, ...params });
      const selected = params.FIELDS.map((f) => f.FIELDNAME);
      const table = params.QUERY_TABLE;
      const tableName = params.OPTIONS[0].TEXT.match(/'([^']+)'/)[1];
      const data = table === 'DD03L'
        ? (WANTED[tableName]
          ? WANTED[tableName].filter((field) => !missing.includes(field)).map((FIELDNAME) => ({ TABNAME: tableName, FIELDNAME }))
          : (rows.ROW_FIELDS[tableName] || []))
        : rows[table];
      return { DATA: data.map((r) => ({ WA: selected.map((f) => r[f] || '').join('|') })) };
    })
  };
  return { rfc: createReadOnlyRfcClient(client), queries, client };
}

describe('HUM READ-ONLY function probe (mocked SAP)', () => {
  it.each([['R', true], ['', false]])('records mode %s, parameters and deduplicated elementary row types using only table reads', async (mode, enabled) => {
    const { rfc, queries } = fixture({ mode });
    const evidence = await createProbe({ rfc }).run();
    expect(evidence.result).toMatchObject({ exists: true, fmode: mode, rfcEnabled: enabled, tableTypes: [{ typeName: 'HUM_EXIDV_T', rowType: 'EXIDV', rowKind: 'E', found: true }] });
    expect(evidence.result.parameters[0]).toEqual({ name: 'IT_EXTERNAL_ID', kind: 'T', type: 'HUM_EXIDV_T', optional: '' });
    expect(queries.map((q) => q.QUERY_TABLE)).toEqual(['DD03L', 'TFDIR', 'DD03L', 'FUPARAREF', 'DD03L', 'DD40L']);
    expect(rfc.getCalledFunctions()).toEqual(['RFC_READ_TABLE']);
    expect(queries.every((q) => q.fm === 'RFC_READ_TABLE')).toBe(true);
  });

  it.each(['I', 'E', 'C'])('discovers table types passed as %s parameters, once per distinct type', async (direction) => {
    const { rfc, queries } = fixture({ direction, rowKind: 'S' });
    const evidence = await createProbe({ rfc }).run();
    expect(evidence.result.tableTypes).toEqual([{
      typeName: 'HUM_EXIDV_T', rowType: 'EXIDV', rowKind: 'S', found: true,
      rowFields: [{ name: 'EXIDV', rollname: 'EXIDV', datatype: 'CHAR', length: '000020' }]
    }]);
    expect(queries.filter((q) => q.QUERY_TABLE === 'DD40L')).toHaveLength(1);
    expect(queries.filter((q) => q.QUERY_TABLE === 'DD03L' && q.OPTIONS[0].TEXT.includes("'EXIDV'"))).toHaveLength(1);
    expect(rfc.getCalledFunctions()).toEqual(['RFC_READ_TABLE']);
  });

  it('does not claim RFC capability for an absent function', async () => {
    const { rfc } = fixture({ exists: false });
    expect((await createProbe({ rfc }).run()).result).toMatchObject({ exists: false, fmode: null, rfcEnabled: null });
  });

  it('records missing metadata fields and never requests them from the data table', async () => {
    const { rfc, queries } = fixture({ missing: ['FMODE'] });
    const evidence = await createProbe({ rfc }).run();
    expect(evidence.skippedReads).toContainEqual({ table: 'TFDIR', missingFields: ['FMODE'] });
    expect(evidence.result.fmode).toBeNull();
    expect(queries.find((q) => q.QUERY_TABLE === 'TFDIR').FIELDS.map((f) => f.FIELDNAME)).not.toContain('FMODE');
  });

  it('propagates a read failure without invoking the HUM posting function', async () => {
    const { rfc, client } = fixture();
    client.call.mockRejectedValue(Object.assign(new Error('read denied'), { key: 'NOT_AUTHORIZED' }));
    await expect(createProbe({ rfc }).run()).rejects.toMatchObject({ key: 'NOT_AUTHORIZED' });
    expect(rfc.getCalledFunctions()).toEqual(['RFC_READ_TABLE']);
  });

  it('preserves existing evidence, restricts file permissions and rejects sensitive output', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-probe-'));
    try {
      const first = saveEvidence({ readOnly: true }, dir, {});
      const second = saveEvidence({ readOnly: true, result: {} }, dir, {});
      expect(first).not.toBe(second);
      expect(JSON.parse(fs.readFileSync(first, 'utf8'))).toEqual({ readOnly: true });
      expect(fs.statSync(second).mode & 0o777).toBe(0o600);
      const files = fs.readdirSync(dir);
      expect(() => saveEvidence({ value: 'credential-sentinel' }, dir, { S4_PASSWORD: 'credential-sentinel' })).toThrow();
      expect(fs.readdirSync(dir)).toEqual(files);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
