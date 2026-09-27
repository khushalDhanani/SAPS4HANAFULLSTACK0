const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { sapNum } = TrToAdapter._internals;

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
    ['missing warehouse', ['1000663', '']],
    ['non-numeric TR', ["1' OR '1", 'W01']],
    ['injection in warehouse', ['1000663', "W' OR"]]
  ])('rejects %s with 400 before calling SAP', async (_, [tbnum, lgnum]) => {
    const rfc = fakeRfc();
    await expect(new TrToAdapter({ rfc }).getTR(tbnum, lgnum)).rejects.toMatchObject({ status: 400 });
    expect(rfc.call).not.toHaveBeenCalled();
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

  it('sapNum reads both SAP number formats', () => {
    expect(sapNum('11.210,000')).toBe(11210);
    expect(sapNum('11,210.000')).toBe(11210);
    expect(sapNum('17323.200')).toBe(17323.2);
    expect(sapNum('1,500 -')).toBe(-1.5);
    expect(sapNum('')).toBe(0);
  });
});

describe('RfcClient', () => {
  const env = { S4_DESTINATION_URL: 'http://172.27.100.32:8000', S4_RFC_SYSNR: '00', S4_CLIENT: '220', S4_USERNAME: 'U', S4_PASSWORD: 'P' };

  it('returns 503 naming missing settings', () => {
    expect(() => new RfcClient({}).connectionParams()).toThrow(/S4_RFC_SYSNR/);
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
});
