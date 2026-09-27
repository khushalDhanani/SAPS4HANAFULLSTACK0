const { GoodsIssueStockUnitClient } = require('../../../srv/integration/s4hana/wm/goods-issue');

const RESV_ITEM = {
  Reservation: '519366', ReservationItem: '0001', OrderID: '1002749', Product: '1000000867',
  ProductName: 'IPA, Extra Pure', Plant: '1000', StorageLocation: '1100', Batch: '', BaseUnit: 'KG',
  ResvnItmRequiredQtyInBaseUnit: '5000', ResvnItmWithdrawnQtyInBaseUnit: '0'
};
const q = (o) => ({
  LGNUM: 'W01', LENUM: '00000000001000041635', LQNUM: '1', MATNR: '000000001000000867', WERKS: '1000',
  LGORT: '1100', CHARG: 'IN25031691', BESTQ: '', SOBKZ: '', VERME: '1620.000', MEINS: 'KG',
  LGTYP: 'RM1', LGPLA: '0-L0001-03', SKZUA: '', SKZSA: '', SKZSI: '', WDATU: '20260801', ...o
});
const BATCHES = [
  { Batch: 'IN25031691', ExpiryDate: '2027-06-01', StatusState: 'Success', StatusText: 'VALID', DaysToExpiry: 250 },
  { Batch: 'IN25031994', ExpiryDate: '2027-01-01', StatusState: 'Warning', StatusText: 'EXPIRING SOON', DaysToExpiry: 90 }
];

function makeClient({ resv = RESV_ITEM, lqua = [], batches = BATCHES } = {}) {
  const rfc = {
    readTable: jest.fn((table, fields, where) => {
      if (table === 'LQUA') return Promise.resolve(typeof lqua === 'function' ? lqua(where) : lqua);
      return Promise.resolve([]);
    })
  };
  const adapter = {
    _get: jest.fn((path) => {
      if (path.includes('ReservationDocumentItem')) return Promise.resolve(resv ? [resv] : []);
      if (path.includes('MaterialStorLocHelps')) return Promise.resolve([{ CurrentStock: '9000', BaseUnit: 'KG' }]);
      return Promise.resolve([]);
    }),
    getMaterialBatches: jest.fn().mockResolvedValue(batches)
  };
  return { client: new GoodsIssueStockUnitClient({ adapter, rfc }), rfc };
}

describe('GoodsIssueStockUnitClient – Storage Units for one reservation line', () => {
  it('queries LQUA by the line material/plant/sloc in any warehouse (no T320 dependency)', async () => {
    const { client, rfc } = makeClient({ lqua: [q()] });
    await client.listStockUnitsForReservationItem('519366', '1');
    expect(rfc.readTable.mock.calls.some((c) => c[0] === 'T320')).toBe(false);
    const lqua = rfc.readTable.mock.calls.find((c) => c[0] === 'LQUA');
    expect(lqua[2]).toEqual(["MATNR = '000000001000000867'", "AND WERKS = '1000'", "AND LGORT = '1100'"]);
    lqua[2].forEach((line) => expect(line.length).toBeLessThanOrEqual(72));
  });

  it('live case 519366/0001: bin stock without SU in W13 -> no SUs, message names the bin stock', async () => {
    const { client } = makeClient({
      resv: { ...RESV_ITEM, Product: '8000001648', Plant: '1120', StorageLocation: 'HS01' },
      batches: [],
      lqua: [
        q({ LGNUM: 'W13', LENUM: '', MATNR: '000000008000001648', WERKS: '1120', LGORT: 'HS01', CHARG: '', VERME: '55.000', MEINS: 'EA', LGTYP: 'EN1', LGPLA: '0-L0002-02' }),
        q({ LGNUM: 'W13', LENUM: '', MATNR: '000000008000001648', WERKS: '1120', LGORT: 'HS01', CHARG: '', VERME: '2.000-', MEINS: 'EA', LGTYP: '902', LGPLA: '0300001771' })
      ]
    });
    const res = await client.listStockUnitsForReservationItem('519366', '1');
    expect(res.StockUnits).toEqual([]);
    expect(res.ExcludedCount).toBe(0);
    expect(res.Warehouse).toBe('W13');
    expect(res.Message).toMatch(/55 EA in W13 EN1\/0-L0002-02\) is not SU-managed/);
  });

  it('excludes SUs sitting in interim storage types (9xx)', async () => {
    const { client } = makeClient({ lqua: [q(), q({ LENUM: '00000000001000000009', LGTYP: '902' })] });
    const res = await client.listStockUnitsForReservationItem('519366', '1');
    expect(res.StockUnits.map((s) => s.StorageUnit)).toEqual(['1000041635']);
    expect(res.ExcludedCount).toBe(1);
  });

  it('returns only issuable SUs and hides blocked / QI / special / zero / unusable-batch quants', async () => {
    const { client } = makeClient({
      lqua: [
        q(),
        q({ LENUM: '00000000001000041636', CHARG: 'IN25031994', VERME: '1800.000' }),
        q({ LENUM: '00000000001000000001', BESTQ: 'Q' }),
        q({ LENUM: '00000000001000000002', SKZUA: 'X' }),
        q({ LENUM: '00000000001000000003', SOBKZ: 'E' }),
        q({ LENUM: '00000000001000000004', VERME: '0.000' }),
        q({ LENUM: '00000000001000000005', CHARG: 'EXPIRED01' })
      ]
    });
    const res = await client.listStockUnitsForReservationItem('519366', '1');
    expect(res.StockUnits.map((s) => s.StorageUnit)).toEqual(['1000041636', '1000041635']); // FEFO
    expect(res.ExcludedCount).toBe(5);
    expect(res.StockUnits[1]).toMatchObject({ Batch: 'IN25031691', AvailableStock: 1620, StorageBin: '0-L0001-03', Warehouse: 'W01' });
  });

  it('restricts to the reservation batch when the reservation fixes one', async () => {
    const { client } = makeClient({
      resv: { ...RESV_ITEM, Batch: 'IN25031691' },
      lqua: [q(), q({ LENUM: '00000000001000041636', CHARG: 'IN25031994' })]
    });
    const res = await client.listStockUnitsForReservationItem('519366', '1');
    expect(res.StockUnits.map((s) => s.StorageUnit)).toEqual(['1000041635']);
  });

  it('sums quants of one SU', async () => {
    const { client } = makeClient({ lqua: [q(), q({ LQNUM: '2', VERME: '380.000' })] });
    const res = await client.listStockUnitsForReservationItem('519366', '1');
    expect(res.StockUnits).toHaveLength(1);
    expect(res.StockUnits[0]).toMatchObject({ AvailableStock: 2000, QuantCount: 2 });
  });

  it('says so when the material has no WM stock at all', async () => {
    const { client } = makeClient({ lqua: [] });
    const res = await client.listStockUnitsForReservationItem('519366', '1');
    expect(res.StockUnits).toEqual([]);
    expect(res.Message).toMatch(/No WM stock/);
  });

  it('404 when the reservation item is not open', async () => {
    const { client } = makeClient({ resv: null });
    await expect(client.listStockUnitsForReservationItem('519366', '9')).rejects.toMatchObject({ status: 404 });
  });

  it('resolves a selected WM SU to its batch (ResolvedType WM_STORAGE_UNIT)', async () => {
    const { client } = makeClient({ lqua: [q()] });
    const res = await client.resolveStockUnitForGoodsIssue('1000041635', '519366', '1');
    expect(res).toMatchObject({
      SuExists: true, ResolvedType: 'WM_STORAGE_UNIT', DeterminedBatch: 'IN25031691',
      SuStockQty: 1620, CurrentStock: 1620, MaxIssueQty: 1620
    });
  });

  it('rejects a WM SU holding another material (409)', async () => {
    const { client } = makeClient({ lqua: [q({ MATNR: '000000001000000869' })] });
    await expect(client.resolveStockUnitForGoodsIssue('1000041635', '519366', '1'))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects a WM SU blocked for removal (409)', async () => {
    const { client } = makeClient({ lqua: [q({ SKZSA: 'X' })] });
    await expect(client.resolveStockUnitForGoodsIssue('1000041635', '519366', '1'))
      .rejects.toThrow(/blocked for stock removal/);
  });
});
