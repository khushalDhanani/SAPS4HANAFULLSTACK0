'use strict';

const StorageTypeConfigAdapter = require('../../../srv/integration/s4hana/wm/StorageTypeConfigAdapter');

const metadata = [
  { FIELDNAME: 'MANDT', ROLLNAME: 'MANDT', KEYFLAG: 'X', POSITION: '0001' },
  { FIELDNAME: 'LGNUM', ROLLNAME: 'LGNUM', KEYFLAG: 'X', POSITION: '0002' },
  { FIELDNAME: 'LGTYP', ROLLNAME: 'LGTYP', KEYFLAG: 'X', POSITION: '0003' }
];

const configuredLists = {
  pickableStorageTypes: ['EN1'],
  holdStorageTypes: ['OH1'],
  interimStorageTypes: ['911']
};

describe('StorageTypeConfigAdapter', () => {
  test('discovers T301 key fields from DD03L and validates configured values for that warehouse', async () => {
    const readTable = jest.fn(async (table) => {
      if (table === 'DD03L') return metadata;
      if (table === 'T301') return [
        { LGNUM: 'W01', LGTYP: 'EN1' },
        { LGNUM: 'W01', LGTYP: 'OH1' },
        { LGNUM: 'W01', LGTYP: '911' },
        { LGNUM: 'W02', LGTYP: 'NOT_FOR_W01' }
      ];
      throw new Error(`Unexpected table ${table}`);
    });
    const adapter = new StorageTypeConfigAdapter({ rfcClient: { readTable } });

    await expect(adapter.validateStorageTypeListsForWarehouse('W01', configuredLists)).resolves.toEqual({
      warehouse: 'W01',
      verifiedStorageTypes: ['EN1', 'OH1', '911']
    });
    expect(readTable).toHaveBeenNthCalledWith(1, 'DD03L', ['TABNAME', 'FIELDNAME', 'POSITION', 'KEYFLAG', 'ROLLNAME'], ["TABNAME = 'T301'"], 9999);
    expect(readTable).toHaveBeenNthCalledWith(2, 'T301', ['LGNUM', 'LGTYP'], ["LGNUM = 'W01'"], 9999);
  });

  test('rejects configured storage types absent from T301 for the selected warehouse', async () => {
    const readTable = jest.fn(async (table) => table === 'DD03L'
      ? metadata
      : [{ LGNUM: 'W01', LGTYP: 'EN1' }, { LGNUM: 'W02', LGTYP: 'OH1' }]);
    const adapter = new StorageTypeConfigAdapter({ rfcClient: { readTable } });

    await expect(adapter.validateStorageTypeListsForWarehouse('W01', configuredLists))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('OH1, 911') });
  });

  test.each([
    ['missing metadata', async () => []],
    ['ambiguous warehouse key', async () => [
      ...metadata,
      { FIELDNAME: 'WHNUM', ROLLNAME: 'LGNUM', KEYFLAG: 'X', POSITION: '0004' }
    ]],
    ['unreadable DD03L', async () => { throw new Error('RFC unavailable'); }]
  ])('%s fails closed', async (_name, dd03l) => {
    const readTable = jest.fn(async (table) => {
      if (table === 'DD03L') return dd03l();
      return [];
    });
    const adapter = new StorageTypeConfigAdapter({ rfcClient: { readTable } });

    await expect(adapter.validateStorageTypeListsForWarehouse('W01', configuredLists))
      .rejects.toMatchObject({ status: 503 });
    expect(readTable).toHaveBeenCalledTimes(1);
  });

  test('unreadable or potentially truncated T301 rows fail closed', async () => {
    const unreadable = new StorageTypeConfigAdapter({
      rfcClient: { readTable: jest.fn(async (table) => {
        if (table === 'DD03L') return metadata;
        throw new Error('RFC unavailable');
      }) }
    });
    await expect(unreadable.validateStorageTypeListsForWarehouse('W01', configuredLists))
      .rejects.toMatchObject({ status: 503 });

    const truncated = new StorageTypeConfigAdapter({
      rfcClient: { readTable: jest.fn(async (table) => table === 'DD03L' ? metadata : new Array(9999).fill({ LGNUM: 'W01', LGTYP: 'EN1' })) }
    });
    await expect(truncated.validateStorageTypeListsForWarehouse('W01', configuredLists))
      .rejects.toMatchObject({ status: 503 });
  });

  test('rejects an invalid warehouse before any RFC read', async () => {
    const readTable = jest.fn();
    const adapter = new StorageTypeConfigAdapter({ rfcClient: { readTable } });
    await expect(adapter.validateStorageTypeListsForWarehouse("W01' OR '1'='1", configuredLists))
      .rejects.toMatchObject({ status: 400 });
    expect(readTable).not.toHaveBeenCalled();
  });

  test('discovers LGNUM/LGTYP from the real DD03L T301 rows captured on 2026-10-26 and validates against real W01 codes', async () => {
    // Rows quoted from docs/evidence/2026-10-26/hu-stock-evidence.raw.json, queries[0].rows (DD03L, TABNAME = 'T301').
    const realDd03l = [
      { TABNAME: 'T301', FIELDNAME: 'LGTYP', POSITION: '0003', KEYFLAG: 'X', ROLLNAME: 'LGTYP', DATATYPE: 'CHAR', LENG: '000003' },
      { TABNAME: 'T301', FIELDNAME: 'MANDT', POSITION: '0001', KEYFLAG: 'X', ROLLNAME: 'MANDT', DATATYPE: 'CLNT', LENG: '000003' },
      { TABNAME: 'T301', FIELDNAME: 'LGNUM', POSITION: '0002', KEYFLAG: 'X', ROLLNAME: 'LGNUM', DATATYPE: 'CHAR', LENG: '000003' },
      { TABNAME: 'T301', FIELDNAME: 'GLCGR', POSITION: '0005', KEYFLAG: '', ROLLNAME: 'LXYRD_GLCGR', DATATYPE: 'CHAR', LENG: '000003' },
      { TABNAME: 'T301', FIELDNAME: '.INCLU--AP', POSITION: '0004', KEYFLAG: '', ROLLNAME: '', DATATYPE: '', LENG: '000000' }
    ];
    // Subset of queries[1].rows (T301, LGNUM = 'W01', 49 rows); OXD/WRA are the two codes new since the 2026-10-23 T301T read.
    const realW01 = ['902', '911', '913', '921', 'EN1', 'OH1', 'OXD', 'WRA'].map((LGTYP) => ({ LGNUM: 'W01', LGTYP }));
    const readTable = jest.fn(async (table) => (table === 'DD03L' ? realDd03l : realW01));
    const adapter = new StorageTypeConfigAdapter({ rfcClient: { readTable } });

    await expect(adapter.validateStorageTypeListsForWarehouse('W01', {
      pickableStorageTypes: ['EN1'],
      holdStorageTypes: ['OH1'],
      interimStorageTypes: ['911', '913', '921', '902']
    })).resolves.toEqual({ warehouse: 'W01', verifiedStorageTypes: ['EN1', 'OH1', '911', '913', '921', '902'] });
    expect(readTable).toHaveBeenNthCalledWith(2, 'T301', ['LGNUM', 'LGTYP'], ["LGNUM = 'W01'"], 9999);

    await expect(adapter.validateStorageTypeListsForWarehouse('W01', {
      pickableStorageTypes: ['EN1'], holdStorageTypes: ['OH1'], interimStorageTypes: ['ZZ9']
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('ZZ9') });
  });
});
