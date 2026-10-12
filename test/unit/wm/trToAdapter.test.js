const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { sapNum, mapStorageTypeSearchError } = TrToAdapter._internals;

// Shapes as returned by Z_WM_GET_TR_MATERIAL_LIST / RFC_READ_TABLE (values from W01, TR 1000663).
const HEADER = { LGNUM: 'W01', TBNUM: '0001000663', BWLVS: '319', BETYP: 'P', BENUM: '0001002749', RSNUM: '0000517858',
  BDATU: '20260923', STATU: '', VLTYP: '', VLPLA: '', NLTYP: '100', NLPLA: '1002749' };
const ITEMS = [
  { LGNUM: 'W01', TBNUM: '0001000663', TBPOS: '0001', MATNR: '000000001000000867', WERKS: '1000', LGORT: 'RM01',
    CHARG: '', MENGE: '17323.200', TAMEN: '0.000', MEINS: 'KG', ELIKZ: '' },
  { LGNUM: 'W01', TBNUM: '0001000663', TBPOS: '0002', MATNR: '000000001000000869', WERKS: '1000', LGORT: 'RM01',
    CHARG: '', MENGE: '13929.600', TAMEN: '13929.600', MEINS: 'KG', ELIKZ: 'X' }
];
const QUANT = { LQNUM: '0001035375', MATNR: '000000001000000867', WERKS: '1000', LGORT: 'RM01', CHARG: 'IN25003572',
  VERME: '11.210,000', MEINS: 'KG', LGTYP: 'RM1', LGPLA: 'ONHOLD' };

function fakeRfc({ header = HEADER, items = ITEMS, quants = [QUANT], create } = {}) {
  return {
    call: jest.fn(async (fm) => {
      if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') return { ET_TR_HEADER: header ? [header] : [], ET_TR_ITEMS: items };
      if (fm === 'ZWM_TO_CREATE_FROM_TR') return create;
      throw new Error(`unexpected ${fm}`);
    }),
    readTable: jest.fn(async (table) => (table === 'MAKT' ? [{ MAKTX: 'IPA, Extra Pure' }] : quants))
  };
}

describe('TrToAdapter (RFC)', () => {
  it('getTR maps header/items, computes OpenQty = MENGE - TAMEN, strips leading zeros', async () => {
    const rfc = fakeRfc();
    const tr = await new TrToAdapter({ rfc }).getTR('1000663', 'w01');

    expect(rfc.call).toHaveBeenCalledWith('Z_WM_GET_TR_MATERIAL_LIST', { IV_TR_NUMBER: '0001000663', IV_LGNUM: 'W01' });
    expect(tr).toMatchObject({ Tbnum: '0001000663', Bwlvs: '319', Betyp: 'P', Bdatu: '2026-09-23', Nlpla: '1002749' });
    expect(tr.Items[0]).toMatchObject({ Tbpos: '0001', Material: '1000000867', MaterialDesc: 'IPA, Extra Pure',
      OpenQty: 17323.2, Unit: 'KG', DeliveryCompleted: false });
    expect(tr.Items[1]).toMatchObject({ OpenQty: 0, DeliveryCompleted: true });
  });

  it('getTR returns 404 when SAP has no such TR', async () => {
    await expect(new TrToAdapter({ rfc: fakeRfc({ header: null }) }).getTR('999', 'W01'))
      .rejects.toMatchObject({ status: 404, message: 'Transfer Requirement 999 not found in warehouse W01' });
  });

  it.each([
    ['non-numeric TR', ["1' OR '1", 'W01']],
    ['TR with a prefix (prefix handling is the scan screen\'s job)', ['TR 1000663', 'W01']],
    ['injection in warehouse', ['1000663', "W' OR"]]
  ])('rejects %s with 400 before calling SAP', async (_, [tbnum, lgnum]) => {
    const rfc = fakeRfc();
    await expect(new TrToAdapter({ rfc }).getTR(tbnum, lgnum)).rejects.toMatchObject({ status: 400 });
    expect(rfc.call).not.toHaveBeenCalled();
  });

  it('uses the configured warehouse (cds.s4.warehouseNumber) when the caller sends none, never a literal', async () => {
    const rfc = fakeRfc();
    await new TrToAdapter({ rfc }).getTR('1000663', '');
    expect(rfc.call).toHaveBeenCalledWith('Z_WM_GET_TR_MATERIAL_LIST', { IV_TR_NUMBER: '0001000663', IV_LGNUM: require('@sap/cds').env.s4.warehouseNumber });
  });

  it('checkSU accepts an SU holding an open TR material in the same plant (batch ignored, as ZTO)', async () => {
    const rfc = fakeRfc();
    const su = await new TrToAdapter({ rfc }).checkSU('1000043935', '1000663', 'W01');

    expect(rfc.readTable).toHaveBeenCalledWith('LQUA', expect.any(Array),
      ["LGNUM = 'W01'", "AND LENUM = '00000000001000043935'"]);
    expect(su).toMatchObject({ IsValid: true, ErrorCode: '', StorageBin: 'ONHOLD' });
    expect(su.Quants[0]).toMatchObject({ Material: '1000000867', Batch: 'IN25003572', AvailableStock: 11210 });
  });

  it('checkSU flags an SU whose material is not open on the TR', async () => {
    const other = { ...QUANT, MATNR: '000000004000000123' };
    const su = await new TrToAdapter({ rfc: fakeRfc({ quants: [other] }) }).checkSU('1000041619', '1000663', 'W01');
    expect(su).toMatchObject({ IsValid: false, ErrorCode: 'SU_MATERIAL_MISMATCH' });
  });

  it('checkSU matches the TR item with the same batch when TR items name a batch (TR 1000446 shape)', async () => {
    const mk = (pos, charg) => ({ ...ITEMS[0], TBPOS: pos, MATNR: '000000001000000156', WERKS: '1600', CHARG: charg, MENGE: '1800.000' });
    const items = [mk('0001', 'IN25031691'), mk('0002', 'IN25031994'), mk('0003', 'IN25032604')];
    const q = { ...QUANT, MATNR: '000000001000000156', WERKS: '1600', CHARG: 'IN25032604' };
    const create = { EV_SUCCESS: 'S', EV_TANUM: '0001036700', EV_MESSAGE: 'ok' };
    const rfc = fakeRfc({ items, quants: [q], create });

    await new TrToAdapter({ rfc }).createTO({ lgnum: 'W01', tbnum: '1000446', lenum: '1000043935', qty: 10 });
    expect(rfc.call.mock.calls.at(-1)[1].IT_ITEMS[0]).toMatchObject({ TBPOS: '0003', CHARG: 'IN25032604' });

    const wrong = fakeRfc({ items, quants: [{ ...q, CHARG: 'IN99999999' }] });
    await expect(new TrToAdapter({ rfc: wrong }).checkSU('1000043935', '1000446', 'W01'))
      .resolves.toMatchObject({ IsValid: false, ErrorCode: 'SU_MATERIAL_MISMATCH' });
  });

  it('checkSU flags an empty or unknown SU', async () => {
    const su = await new TrToAdapter({ rfc: fakeRfc({ quants: [] }) }).checkSU('1', '1000663', 'W01');
    expect(su).toMatchObject({ IsValid: false, ErrorCode: 'SU_NO_STOCK' });
  });

  it('createTO sends the item exactly as ZTO builds it and returns the TO (create only)', async () => {
    const rfc = fakeRfc({ create: { EV_SUCCESS: 'S', EV_TANUM: '0001036601', EV_MESSAGE: 'Transfer Order 0001036601 created successfully.' } });
    const res = await new TrToAdapter({ rfc }).createTO({ lgnum: 'W01', tbnum: '1000663', lenum: '1000043935', qty: 500 });

    expect(rfc.call).toHaveBeenLastCalledWith('ZWM_TO_CREATE_FROM_TR', {
      IV_LGNUM: 'W01', IV_TBNUM: '0001000663', IV_COMMIT: 'X',
      IT_ITEMS: [{ TBPOS: '0001', ANFME: '500.000', ALTME: 'KG', CHARG: 'IN25003572', NLTYP: '100', NLPLA: '1002749',
        VLTYP: 'RM1', VLPLA: 'ONHOLD', VLENR: '00000000001000043935' }]
    });
    expect(res).toEqual({ TransferOrder: '1036601', Success: true, Message: 'Transfer Order 0001036601 created successfully.', Confirmed: false });
  });

  it('createTO rejects qty above min(SU stock, TR open) without calling SAP create', async () => {
    const rfc = fakeRfc();
    await expect(new TrToAdapter({ rfc }).createTO({ lgnum: 'W01', tbnum: '1000663', lenum: '1000043935', qty: 12000 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('exceeds the allowed 11210') });
    expect(rfc.call).not.toHaveBeenCalledWith('ZWM_TO_CREATE_FROM_TR', expect.anything());
  });

  it('createTO rejects zero quantity and an invalid SU', async () => {
    await expect(new TrToAdapter({ rfc: fakeRfc() }).createTO({ lgnum: 'W01', tbnum: '1000663', lenum: '1000043935', qty: 0 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(new TrToAdapter({ rfc: fakeRfc({ quants: [] }) }).createTO({ lgnum: 'W01', tbnum: '1000663', lenum: '1', qty: 1 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('no available stock') });
  });

  it('createTO surfaces the SAP message when ZWM_TO_CREATE_FROM_TR fails', async () => {
    const rfc = fakeRfc({ create: { EV_SUCCESS: 'E', EV_TANUM: '', EV_MESSAGE: 'Storage bin 100/1002749 does not exist' } });
    await expect(new TrToAdapter({ rfc }).createTO({ lgnum: 'W01', tbnum: '1000663', lenum: '1000043935', qty: 1 }))
      .rejects.toMatchObject({ status: 400, message: 'Storage bin 100/1002749 does not exist' });
  });

  it('maps RFC transport errors to 502 with context', async () => {
    const rfc = { call: jest.fn().mockRejectedValue(new Error('RFC_COMMUNICATION_FAILURE')), readTable: jest.fn() };
    await expect(new TrToAdapter({ rfc }).getTR('1000663', 'W01'))
      .rejects.toMatchObject({ status: 502, message: 'Read Transfer Requirement 1000663: RFC_COMMUNICATION_FAILURE' });
  });

  it('getAvailableSUs reads quants from LQUA and returns available SUs for open TR items', async () => {
    const q1 = { LQNUM: '0001030622', LENUM: '00000000001000041635', MATNR: '000000001000000867', WERKS: '1000',
      LGORT: 'RM01', CHARG: 'IN25003572', VERME: '11.210,000', MEINS: 'KG', LGTYP: 'RM1', LGPLA: '0-L0001-03' };
    const rfc = fakeRfc({ quants: [q1] });
    const sus = await new TrToAdapter({ rfc }).getAvailableSUs('1000663', 'W01');

    expect(rfc.readTable).toHaveBeenCalledWith('LQUA', expect.any(Array), [
      "LGNUM = 'W01'", "AND MATNR = '000000001000000867'", "AND LENUM <> ' '", "AND VERME > 0", "AND WERKS = '1000'"
    ]);
    expect(sus).toHaveLength(1);
    expect(sus[0]).toMatchObject({
      StorageUnit: '1000041635',
      Tbpos: '0001',
      Material: '1000000867',
      AvailableStock: 11210,
      Unit: 'KG',
      StorageType: 'RM1',
      StorageBin: '0-L0001-03'
    });
  });

  it('getAvailableSUs filters by tbpos when specified', async () => {
    const rfc = fakeRfc({ quants: [] });
    const sus = await new TrToAdapter({ rfc }).getAvailableSUs('1000663', 'W01', '0001');
    expect(sus).toEqual([]);
    expect(rfc.readTable).toHaveBeenCalledWith('LQUA', expect.any(Array), expect.any(Array));
  });

  it('getAvailableSUs returns empty array when TR has no open items or tbpos is not found', async () => {
    const rfc = fakeRfc({ items: [{ ...ITEMS[1], OpenQty: 0, DeliveryCompleted: true }] });
    const sus = await new TrToAdapter({ rfc }).getAvailableSUs('1000663', 'W01');
    expect(sus).toEqual([]);
    expect(rfc.readTable).not.toHaveBeenCalledWith('LQUA', expect.anything(), expect.anything());
  });

  it('getFifoBatches returns batches sorted by earliest goods receipt date (FIFO)', async () => {
    const quants = [
      { LQNUM: '1', CHARG: 'BATCH_NEW', VERME: '50.000', MEINS: 'KG', WDATU: '20261010', EDATU: '20261011', LGTYP: 'OH1', LGPLA: 'BIN2', WERKS: '1120', LGORT: 'CS01' },
      { LQNUM: '2', CHARG: 'BATCH_OLD', VERME: '20.000', MEINS: 'KG', WDATU: '20261001', EDATU: '20261002', LGTYP: 'OH1', LGPLA: 'BIN1', WERKS: '1120', LGORT: 'CS01' },
      { LQNUM: '3', CHARG: 'BATCH_OLD', VERME: '30.000', MEINS: 'KG', WDATU: '20261001', EDATU: '20261002', LGTYP: 'OH1', LGPLA: 'BIN1', WERKS: '1120', LGORT: 'CS01' }
    ];
    const rfc = {
      readTable: jest.fn(async (table) => (table === 'LQUA' ? quants : []))
    };
    const adapter = new TrToAdapter({ rfc });
    const batches = await adapter.getFifoBatches('1000000867', '1120', 'CS01', 'W01');

    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({
      Batch: 'BATCH_OLD',
      FifoRank: 1,
      IsRecommended: true,
      AvailableStock: 50,
      GoodsReceiptDate: '2026-10-01'
    });
    expect(batches[0].Recommendation).toContain('FIFO Recommended');
    expect(batches[1]).toMatchObject({
      Batch: 'BATCH_NEW',
      FifoRank: 2,
      IsRecommended: false,
      AvailableStock: 50,
      GoodsReceiptDate: '2026-10-10'
    });
  });

  it('getFifoBatches falls back to MCHA when LQUA has no stock quants', async () => {
    const mcha = [
      { CHARG: 'MCHA_BATCH_2', WERKS: '1120', ERSDA: '20261009', VFDAT: '20271009', HSDAT: '00000000' },
      { CHARG: 'MCHA_BATCH_1', WERKS: '1120', ERSDA: '20261005', VFDAT: '20271005', HSDAT: '00000000' }
    ];
    const rfc = {
      readTable: jest.fn(async (table) => (table === 'MCHA' ? mcha : []))
    };
    const adapter = new TrToAdapter({ rfc });
    const batches = await adapter.getFifoBatches('1000000867', '1120', '', 'W01');

    expect(batches).toHaveLength(2);
    expect(batches[0].Batch).toBe('MCHA_BATCH_1');
    expect(batches[0].FifoRank).toBe(1);
    expect(batches[0].IsRecommended).toBe(true);
    expect(batches[1].Batch).toBe('MCHA_BATCH_2');
    expect(batches[1].FifoRank).toBe(2);
  });

  it('getAvailableSerials queries EQUI and returns naturally sorted serial series', async () => {
    const equi = [
      { SERNR: 'CON-40-003', EQUNR: '3' },
      { SERNR: 'CON-40-001', EQUNR: '1' },
      { SERNR: 'CON-40-002', EQUNR: '2' }
    ];
    const rfc = {
      readTable: jest.fn(async (table) => (table === 'EQUI' ? equi : []))
    };
    const adapter = new TrToAdapter({ rfc });
    const serials = await adapter.getAvailableSerials('8000006485');

    expect(serials).toEqual(['CON-40-001', 'CON-40-002', 'CON-40-003']);
  });

  it('lookupTR enriches TRDetail with FIFO suggested batches and serials', async () => {
    const quants = [
      { LQNUM: '1', CHARG: 'IN26001216', VERME: '100.000', MEINS: 'KG', WDATU: '20261008', EDATU: '20261008', LGTYP: 'OH1', LGPLA: 'BIN1', WERKS: '1000', LGORT: 'RM01' }
    ];
    const equi = [{ SERNR: 'SN001', EQUNR: '1' }, { SERNR: 'SN002', EQUNR: '2' }];
    const rfc = {
      call: jest.fn(async (fm) => {
        if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') return { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEMS[0]] };
        throw new Error(`unexpected ${fm}`);
      }),
      readTable: jest.fn(async (table) => {
        if (table === 'MAKT') return [{ MAKTX: 'IPA' }];
        if (table === 'MARC') return [{ XCHPF: 'X', SERNP: 'Z001' }];
        if (table === 'LQUA') return quants;
        if (table === 'EQUI') return equi;
        return [];
      })
    };
    const tr = await new TrToAdapter({ rfc }).lookupTR('1000663', 'W01', 'TR');

    expect(tr.IsBatchManaged).toBe(true);
    expect(tr.IsSerialManaged).toBe(true);
    expect(tr.FifoBatch).toBe('IN26001216');
    expect(tr.SuggestedBatches).toHaveLength(1);
    expect(tr.SuggestedBatches[0].Batch).toBe('IN26001216');
    expect(tr.SuggestedBatches[0].IsRecommended).toBe(true);
    expect(tr.SuggestedSerials).toEqual(['SN001', 'SN002']);
  });

  it('sapNum reads both SAP number formats', () => {
    expect(sapNum('11.210,000')).toBe(11210);
    expect(sapNum('11,210.000')).toBe(11210);
    expect(sapNum('17323.200')).toBe(17323.2);
    expect(sapNum('1,500 -')).toBe(-1.5);
    expect(sapNum('')).toBe(0);
  });

  it('mapStorageTypeSearchError parses SAP L3 007 and produces actionable customizing error with SPRO path (mock only, not SAP verification)', () => {
    const msg = mapStorageTypeSearchError(
      'Create Transfer Order for TR 1000799: Data for storage type search is not defined (A EN1 )',
      'W01',
      '311'
    );
    expect(msg).toContain('warehouse W01 for WM movement type 311');
    expect(msg).toContain("missing customizing key in table T334T (Warehouse: W01, Operation: A [Stock Removal], Storage Type Indicator: 'EN1')");
    expect(msg).toContain('SPRO: Logistics Execution > Warehouse Management > Strategies > Stock Removal Strategies > Determine Storage Type Search');
  });

  it('createTOFromTR maps SAP L3 007 error to actionable customizing error (mock only, not SAP verification)', async () => {
    const tr1000799Header = {
      LGNUM: 'W01', TBNUM: '0001000799', BWLVS: '311', BETYP: '', BENUM: '', RSNUM: '0000000000',
      STATU: '', BDATU: '20261012', VLTYP: '', VLPLA: '', NLTYP: '921', NLPLA: 'TRANSFER'
    };
    const tr1000799Items = [{
      LGNUM: 'W01', TBNUM: '0001000799', TBPOS: '0001', MATNR: '000000008000009753', WERKS: '1120', LGORT: 'HS01',
      CHARG: '', BESTQ: '', SOBKZ: '', MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
    }];
    const rfc = {
      call: jest.fn(async (fm) => {
        if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') return { ET_TR_HEADER: [tr1000799Header], ET_TR_ITEMS: tr1000799Items };
        if (fm === 'AUTHORITY_CHECK') return { USER_IS_AUTHORIZED: 'Y' };
        if (fm === 'Z_WM_TO_CREATE_FROM_TR') {
          throw new Error('Data for storage type search is not defined (A EN1 )');
        }
        throw new Error(`unexpected ${fm}`);
      }),
      readTable: jest.fn(async (table) => {
        if (table === 'LTAP') return [];
        if (table === 'MARC') return [];
        return [];
      })
    };

    const adapter = new TrToAdapter({ rfc });
    const p = adapter.createTOFromTR({
      lgnum: '',
      tbnum: '1000799',
      tbpos: '0001',
      qty: 1,
      unit: 'NOS',
      batch: '',
      serials: [],
      storageUnit: ''
    });
    await expect(p).rejects.toThrow(/missing customizing key in table T334T \(Warehouse: W01, Operation: A \[Stock Removal\], Storage Type Indicator: 'EN1'\)/);
    await expect(p).rejects.toMatchObject({
      status: 400,
      Status: '12',
      ErrorStep: 'LT04'
    });
  });
});

describe('RfcClient', () => {
  const env = { S4_DESTINATION_URL: 'http://s4.example.test:8000', S4_RFC_SYSNR: '00', S4_CLIENT: '220', S4_USERNAME: 'U', S4_PASSWORD: 'P' };

  it('returns 503 naming missing settings', () => {
    expect(() => new RfcClient({}).connectionParams()).toThrow(/S4_RFC_SYSNR/);
  });

  it('defaults RFC trace off (no rfc*.trc spam) and honours S4_RFC_TRACE', () => {
    expect(new RfcClient(env).connectionParams().trace).toBe('0');
    expect(new RfcClient({ ...env, S4_RFC_TRACE: '2' }).connectionParams().trace).toBe('2');
  });

  it('returns 503 when node-rfc is not installed', async () => {
    const c = new RfcClient(env, () => { throw new Error("Cannot find module 'node-rfc'"); });
    await expect(c.call('X')).rejects.toMatchObject({ status: 503 });
  });

  it('readTable splits RFC_READ_TABLE rows by field', async () => {
    const client = { open: jest.fn(), close: jest.fn(), call: jest.fn().mockResolvedValue({ DATA: [{ WA: ' RM1 |ONHOLD    ' }] }) };
    const c = new RfcClient(env, () => ({ Client: jest.fn(() => client) }));
    await expect(c.readTable('LQUA', ['LGTYP', 'LGPLA'], ["LGNUM = 'W01'"])).resolves.toEqual([{ LGTYP: 'RM1', LGPLA: 'ONHOLD' }]);
    expect(client.close).toHaveBeenCalled();
  });

  it('session runs several calls on one connection and closes it once', async () => {
    const client = { open: jest.fn(), close: jest.fn(), call: jest.fn(async (fm) => ({ fm })) };
    const Client = jest.fn(() => client);
    const c = new RfcClient(env, () => ({ Client }));
    const out = await c.session(async (call) => [await call('BAPI_HU_CREATE', { A: 1 }), await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' })]);
    expect(out.map((r) => r.fm)).toEqual(['BAPI_HU_CREATE', 'BAPI_TRANSACTION_COMMIT']);
    expect(Client).toHaveBeenCalledTimes(1);
    expect(client.open).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.call.mock.calls).toEqual([['BAPI_HU_CREATE', { A: 1 }], ['BAPI_TRANSACTION_COMMIT', { WAIT: 'X' }]]);
  });

  it('session closes the connection when the callback throws', async () => {
    const client = { open: jest.fn(), close: jest.fn(), call: jest.fn() };
    const c = new RfcClient(env, () => ({ Client: jest.fn(() => client) }));
    await expect(c.session(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
