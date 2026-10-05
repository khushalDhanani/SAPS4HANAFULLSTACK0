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

function makeClient({
  resv = RESV_ITEM,
  resb = {
    RSNUM: '0000519366', RSPOS: '0001', MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
    BDMNG: '5000', ENMNG: '0', MEINS: 'KG', AUFNR: '1002749', LGTYP: '', PRVBE: ''
  },
  lqua = [],
  batches = BATCHES,
  issuedSuStore = null,
  stagingClient = null
} = {}) {
  const rfc = {
    readTable: jest.fn((table, fields, where) => {
      if (table === 'LQUA') return Promise.resolve(typeof lqua === 'function' ? lqua(where) : lqua);
      if (table === 'RESB') return Promise.resolve(resb ? [resb] : []);
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
  return { client: new GoodsIssueStockUnitClient({ adapter, rfc, issuedSuStore, stagingClient }), rfc };
}

describe('GoodsIssueStockUnitClient – Storage Units for one reservation line', () => {
  it('uses only an SAP-supplied bin when classifying dynamic staging stock', () => {
    const { client } = makeClient();
    const ownOrderBin = q({ LGTYP: 'IP1', LGPLA: '0001002599', VERME: 378 });
    const otherOrderBin = q({ LGTYP: 'IP1', LGPLA: '0001002999', VERME: 378 });

    expect(client._wmQuantRejection(ownOrderBin, '', null, {
      targetType: 'IP1', targetBin: '0001002599', currentOrder: '000001002599'
    })).toBe('');
    expect(client._wmQuantRejection(otherOrderBin, '', null, {
      targetType: 'IP1', targetBin: '0001002599'
    })).toContain('staged for another order');
    expect(client._wmQuantRejection(otherOrderBin, '', null, {
      targetType: 'IP1', targetBin: '', currentOrder: '000001002599'
    })).toBe('');
  });

  it('returns UNKNOWN and no staged quantity when SAP has not supplied a dynamic destination', async () => {
    const stagingClient = {
      findTransferRequirement: jest.fn().mockResolvedValue({ tbnum: '', status: 'UNKNOWN' }),
      findStagingTarget: jest.fn().mockResolvedValue({
        isWm: true,
        targetType: 'IP1',
        targetBin: '',
        status: 'UNKNOWN',
        stagingSource: 'PKHD_DYNAMIC_BIN',
        error: 'Cannot verify staging: transfer destination not readable (DA 131).'
      })
    };
    const lqua = [q({ LGTYP: 'IP1', LGPLA: '0001002599', VERME: 378, EINME: 0 })];
    const { client } = makeClient({
      resb: {
        RSNUM: '0000519366', RSPOS: '0001', MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
        BDMNG: '5000', ENMNG: '0', MEINS: 'KG', AUFNR: '000001002599', LGTYP: 'IP1', PRVBE: 'PSA1'
      },
      lqua,
      stagingClient
    });

    const result = await client.listStockUnitsForReservationItem('519366', '1');

    expect(result).toMatchObject({
      StagingStatus: 'UNKNOWN',
      IsStagingRequired: true,
      IsFullyStaged: false,
      TargetStorageType: 'IP1',
      Message: 'Cannot verify staging: transfer destination not readable.'
    });
    expect(result).not.toHaveProperty('StagedQty');
    expect(result).not.toHaveProperty('PlannedUnconfirmedQty');
  });

  it('returns UNKNOWN with no staged quantity when LQUA cannot be read', async () => {
    const { client } = makeClient({ lqua: () => { throw new Error('SAP RFC error AD 718'); } });

    const result = await client.listStockUnitsForReservationItem('519366', '1');

    expect(result).toMatchObject({
      StagingStatus: 'UNKNOWN', IsStagingRequired: true, IsFullyStaged: false,
      StockUnits: [], Message: 'Cannot verify staging: LQUA read failed: SAP RFC error AD 718'
    });
    expect(result).not.toHaveProperty('StagedQty');
    expect(result).not.toHaveProperty('PlannedUnconfirmedQty');
  });

  it('queries LQUA by the line material/plant/sloc in any warehouse (no T320 dependency)', async () => {
    const { client, rfc } = makeClient({ lqua: [q()] });
    await client.listStockUnitsForReservationItem('519366', '1');
    expect(rfc.readTable.mock.calls.some((c) => c[0] === 'T320')).toBe(false);
    const lqua = rfc.readTable.mock.calls.find((c) => c[0] === 'LQUA');
    expect(lqua[2]).toEqual(["MATNR = '000000001000000867'", "AND WERKS = '1000'", "AND LGORT = '1100'"]);
    lqua[2].forEach((line) => expect(line.length).toBeLessThanOrEqual(72));
  });

  it('uses the exact reservation-linked transfer target instead of an unrelated order transfer', async () => {
    const stagingClient = {
      findTransferRequirement: jest.fn().mockResolvedValue({
        tbnum: '0000000789', status: 'FOUND', targetType: 'IP1', targetBin: '000001002599'
      }),
      findStagingTarget: jest.fn()
    };
    const { client, rfc } = makeClient({
      resb: {
        RSNUM: '0000519366', RSPOS: '0001', MATNR: '000000001000000867', WERKS: '1000', LGORT: '1100',
        BDMNG: '480', ENMNG: '0', MEINS: 'KG', AUFNR: '1002749', LGTYP: 'IP1', PRVBE: 'PSA1'
      },
      stagingClient,
      lqua: [
        q({ LENUM: '00000000001000041635', LGTYP: 'IP1', LGPLA: '000001002599', VERME: '100.000' }),
        q({ LENUM: '00000000001000041636', LGTYP: 'IP1', LGPLA: 'UNRELATED-BIN', VERME: '480.000' })
      ]
    });

    const result = await client.listStockUnitsForReservationItem('519366', '1');

    expect(stagingClient.findTransferRequirement).toHaveBeenCalledWith(
      '519366', '0001', '1000000867', '1000', 'W01', true
    );
    expect(stagingClient.findStagingTarget).toHaveBeenCalledWith(
      '1000000867', '1000', '1100', 'W01', 'PSA1', '1002749', 'IP1'
    );
    expect(rfc.readTable.mock.calls.some(([table]) => table === 'LTBK')).toBe(false);
    expect(result).toMatchObject({
      TargetStorageType: 'IP1',
      TargetStorageBin: '000001002599',
      TransferRequirement: '0000000789',
      TransferRequirementStatus: 'FOUND',
      StagedQty: 100,
      RequiredQty: 480,
      IsFullyStaged: false
    });
    expect(result.Message).toContain('Only 100 of 480 KG staged in W01/IP1/000001002599.');
    expect(result.Message).toContain('Transfer requirement 0000000789 needs a confirmed transfer order');
    expect(result.StockUnits.map((su) => su.StorageBin)).toEqual(['000001002599']);
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

  it('excludes only the current posting attempt claim during its final SAP stock revalidation', async () => {
    const issuedSuStore = {
      getActiveIssuedSUs: jest.fn().mockResolvedValue([
        {
          ReferenceDocument: 'CURRENT-ATTEMPT',
          StorageUnit: '1000041635',
          Status: 'claiming',
          IssuedQty: 100,
          PreIssueStock: 1620
        },
        {
          ReferenceDocument: 'OTHER-ATTEMPT',
          StorageUnit: '1000041635',
          Status: 'claiming',
          IssuedQty: 20,
          PreIssueStock: 1620
        }
      ])
    };
    const { client } = makeClient({ lqua: [q()], issuedSuStore });

    const result = await client.listStockUnitsForReservationItem('519366', '1', {
      excludeReferenceDocument: 'CURRENT-ATTEMPT'
    });

    expect(result.StockUnits).toHaveLength(1);
    expect(result.StockUnits[0].AvailableStock).toBe(1600);
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
