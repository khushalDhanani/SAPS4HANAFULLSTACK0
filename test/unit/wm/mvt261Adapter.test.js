const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');

describe('Mvt261Adapter.findFirst', () => {
  // Shapes as returned live by MMIM_MATDOC_OV_SRV / API_MATERIAL_DOCUMENT_SRV (document 4900000255, reversed by 4900000282).
  const ovRow = {
    MaterialDocument: '4900000255', MaterialDocumentYear: '2025', MaterialDocumentItem: '0001',
    PostingDate: '/Date(1750896000000)/', CreationDateTime: '/Date(1750930883000+0000)/',
    Material: '1000000514', Plant: '1120', StorageLocation: 'CS01', OrderID: '1000026',
    QuantityInEntryUnit: '9625.000', EntryUnit: 'KG', IsAutomaticallyCreated: '', IsCancelled: true, CreatedByUser: 'ADAPHALE'
  };
  const reversal = {
    MaterialDocument: '4900000282', MaterialDocumentYear: '2025', MaterialDocumentItem: '1',
    ReversedMaterialDocument: '4900000255', ReversedMaterialDocumentYear: '2025', ReversedMaterialDocumentItem: '1'
  };
  let calls;
  const adapter = (results = [ovRow], count = '1') => {
    calls = [];
    return new Mvt261Adapter({
      client: {
        get: async (path, { query }) => {
          calls.push({ path, query: decodeURIComponent(query) });
          return { data: { d: path.includes('Findmatdoc') ? { __count: count, results } : { results: [reversal] } } };
        }
      }
    });
  };

  it('maps the first row with its reversal evidence and reports count and sort key', async () => {
    const r = await adapter().findFirst({ plant: '1120' });
    expect(r).toMatchObject({ Definition: 'A', SortKey: 'BUDAT, CPUDT, CPUTM, MBLNR, MJAHR, ZEILE', TotalCount: 1 });
    expect(r.Top[0]).toMatchObject({
      Rank: 1, MaterialDocument: '4900000255', PostingDate: '2025-06-26', EntryTimestamp: '2025-06-26T09:41:23.000Z',
      ProductionOrder: '1000026', Quantity: 9625, IsAutomaticallyCreated: false, IsReversed: true, ReversedBy: '4900000282/2025/0001'
    });
    expect(calls[0].query).toContain("$filter=GoodsMovementType eq '261' and StockChangeType eq '05' and Plant eq '1120'&");
    expect(calls[0].query).toContain('$orderby=PostingDate asc,CreationDateTime asc,MaterialDocument asc,MaterialDocumentYear asc,MaterialDocumentItem asc');
    expect(calls[0].query).toContain('$top=5');
  });

  it('pushes every filter, option and definition down to SAP', async () => {
    await adapter([], '0').findFirst({
      plant: '1120', material: '1000000514', productionOrder: '1000026', dateFrom: '2025-06-01', dateTo: '2025-06-30',
      definition: 'C', excludeReversed: true, manualOnly: true
    });
    expect(calls).toHaveLength(1); // no reversal lookup without cancelled rows
    expect(calls[0].query).toContain(
      "Plant eq '1120' and Material eq '1000000514' and OrderID eq '1000026' and PostingDate ge datetime'2025-06-01T00:00:00'" +
      " and PostingDate le datetime'2025-06-30T00:00:00' and IsCancelled eq false and IsAutomaticallyCreated eq ''"
    );
    expect(calls[0].query).toContain('$orderby=MaterialDocumentYear asc,MaterialDocument asc,MaterialDocumentItem asc&');
  });

  it('rejects missing or unsafe input before calling SAP', async () => {
    const a = adapter();
    for (const input of [{}, { plant: "11' or 1 eq 1" }, { plant: '1120', definition: 'Z' }, { plant: '1120', material: "X' or '1" },
      { plant: '1120', dateFrom: '2025-06-01' }, { plant: '1120', dateFrom: '2025-07-01', dateTo: '2025-06-01' }]) {
      await expect(a.findFirst(input)).rejects.toMatchObject({ status: 400 });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('Mvt261Adapter.openItems', () => {
  // Shape as returned live by UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem (reservation 20808).
  const row = (item, required, withdrawn) => ({
    Reservation: '20808', ReservationItem: item, RecordType: '', OrderID: '1000086', Product: '1000000400', Plant: '1120',
    StorageLocation: 'CS01', MatlCompRequirementDate: '/Date(1753660800000)/', ResvnItmRequiredQtyInBaseUnit: required,
    ResvnItmWithdrawnQtyInBaseUnit: withdrawn, BaseUnit: 'KG', GoodsMovementIsAllowed: true
  });
  let calls;
  const adapter = () => {
    calls = [];
    return new Mvt261Adapter({
      client: {
        get: async (path, { query }) => {
          calls.push(decodeURIComponent(query));
          return { data: { d: { __count: '2', results: [row('8', '1200.000', '200.000'), row('9', '50.000', '50.000')] } } };
        }
      }
    });
  };

  it('returns only items with quantity left to issue and reports SAP\'s open count', async () => {
    const r = await adapter().openItems({ plant: '1120', productionOrder: '1000086' });
    expect(r).toMatchObject({ TotalCount: 1, SapOpenCount: 2, Truncated: false });
    expect(r.Items[0]).toMatchObject({ Reservation: '20808', ReservationItem: '8', RequirementDate: '2025-07-28', OpenQuantity: 1000, Unit: 'KG' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(
      "$filter=GoodsMovementType eq '261' and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false" +
      " and Plant eq '1120' and OrderID eq '1000086'&"
    );
  });

  it('includes fully withdrawn items on request and rejects unsafe input', async () => {
    const a = adapter();
    expect((await a.openItems({ includeFullyWithdrawn: true })).TotalCount).toBe(2);
    await expect(a.openItems({ reservation: "1' or '1" })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });
});

describe('Mvt261Adapter proof cases', () => {
  const resv = (item, required, withdrawn) => ({
    Reservation: '20808', ReservationItem: item, ResvnItmRequiredQtyInBaseUnit: required, ResvnItmWithdrawnQtyInBaseUnit: withdrawn
  });
  const withClient = (get) => new Mvt261Adapter({ client: { get } });

  it('zero rows: both reads return empty results and a zero count', async () => {
    const a = withClient(async () => ({ data: { d: { __count: '0', results: [] } } }));
    await expect(a.openItems({ plant: '9999' })).resolves.toEqual({ TotalCount: 0, SapOpenCount: 0, Truncated: false, Items: [] });
    await expect(a.findFirst({ plant: '9999' })).resolves.toMatchObject({ TotalCount: 0, Top: [] });
  });

  it('authorization missing: SAP 403 is passed on, never an empty list', async () => {
    const a = withClient(async () => { throw Object.assign(new Error('HTTP 403 - No authorization'), { status: 403 }); });
    await expect(a.openItems({ plant: '1120' })).rejects.toMatchObject({ status: 403 });
    await expect(a.findFirst({ plant: '1120' })).rejects.toMatchObject({ status: 403 });
  });

  it('boundary of "open quantity": required > withdrawn is open; equal or over-withdrawn is not', async () => {
    const rows = [resv('1', '10.000', '9.999'), resv('2', '10.000', '10.000'), resv('3', '10.000', '10.001'), resv('4', '0.000', '0.000')];
    const a = withClient(async () => ({ data: { d: { __count: '4', results: rows } } }));
    const r = await a.openItems({});
    expect(r.Items.map((i) => i.ReservationItem)).toEqual(['1']);
    expect(r.Items[0].OpenQuantity).toBeCloseTo(0.001, 6);
    const all = await a.openItems({ includeFullyWithdrawn: true });
    expect(all.Items.map((i) => i.OpenQuantity)).toEqual([expect.closeTo(0.001, 6), 0, 0, 0]);
  });

  it('reads further pages until SAP\'s count is reached', async () => {
    let n = 0;
    const a = withClient(async (_p, { query }) => {
      n++;
      const skip = Number(/\$skip=(\d+)/.exec(query)[1]);
      return { data: { d: { __count: '1500', results: Array.from({ length: skip ? 500 : 1000 }, (_x, i) => resv(String(skip + i), '1.000', '0.000')) } } };
    });
    const r = await a.openItems({});
    expect([n, r.TotalCount, r.Truncated]).toEqual([2, 1500, false]);
  });
});
