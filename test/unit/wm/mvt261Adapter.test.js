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
      rfc: { readTable: async () => [{ OBJNR: 'OR000001000086', STAT: 'I0002' }] },
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
    expect(r.Items[0]).toMatchObject({ Reservation: '20808', ReservationItem: '8', RequirementDate: '2025-07-28', OpenQuantity: 1000, Unit: 'KG', OrderStatus: 'REL' });
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

  it('requests open items ordered by requirement date and reservation descending', async () => {
    await adapter().openItems({ plant: '1120' });
    expect(calls[0]).toContain('$orderby=MatlCompRequirementDate desc,Reservation desc,ReservationItem desc');
  });

  it('carries the configured warehouse (T320) per plant/storage location on each item', async () => {
    const a = new Mvt261Adapter({
      rfc: { readTable: async (table) => (table === 'T320' ? [{ LGORT: 'CS01', LGNUM: 'W01' }] : [{ OBJNR: 'OR000001000086', STAT: 'I0002' }]) },
      client: { get: async () => ({ data: { d: { __count: '1', results: [row('8', '1200.000', '200.000')] } } }) }
    });
    const r = await a.openItems({ plant: '1120' });
    expect(r.Items[0]).toMatchObject({ Plant: '1120', StorageLocation: 'CS01', Warehouse: 'W01' });
  });

  // A WM-PP staged item (RESB-LGTYP set) short in its interim bin must land in Blocked, not Open -
  // the scan page blocks it, so the list has to carry the same reason instead of showing it scannable.
  const staged = (over) => new Mvt261Adapter({
    rfc: { readTable: async (table) => ({
      JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
      T320: [{ LGORT: 'CS01', LGNUM: 'W01' }],
      RESB: [{ RSNUM: '0000020808', RSPOS: '0008', AUFNR: '000001000086', MATNR: '000000001000000400', WERKS: '1120', LGNUM: 'W01', LGTYP: 'IP1', LGPLA: '' }],
      LQUA: [{ MATNR: '000000001000000400', WERKS: '1120', LGNUM: 'W01', LGTYP: 'IP1', LGPLA: '0001000086', VERME: '488.000' }],
      ...over
    })[table] || [] },
    client: { get: async () => ({ data: { d: { __count: '1', results: [row('8', '1200.000', '200.000')] } } }) }
  });

  it('classifies an interim-staging shortfall item as Blocked with the scan-page reason', async () => {
    const r = await staged().openItems({ plant: '1120' });
    expect(r.Items[0]).toMatchObject({
      ScanPossible: false, Blocked: true,
      BlockReason: 'available stock shortfall of 512 KG in interim storage bin IP1/0001000086'
    });
  });

  it('leaves a staged item scannable when the interim bin holds enough', async () => {
    const r = await staged({ LQUA: [{ MATNR: '000000001000000400', WERKS: '1120', LGNUM: 'W01', LGTYP: 'IP1', LGPLA: '0001000086', VERME: '1200.000' }] }).openItems({ plant: '1120' });
    expect(r.Items[0]).toMatchObject({ ScanPossible: true, Blocked: false, BlockReason: '' });
  });
});

describe('Mvt261Adapter proof cases', () => {
  const resv = (item, required, withdrawn) => ({
    Reservation: '20808', ReservationItem: item, ResvnItmRequiredQtyInBaseUnit: required, ResvnItmWithdrawnQtyInBaseUnit: withdrawn
  });
  const withClient = (get) => new Mvt261Adapter({ client: { get }, rfc: { readTable: async () => [] } });

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

describe('Mvt261Adapter.cycle', () => {
  // Rows as read live over RFC for reservation 20808 item 8 (order 1000086, released and locked).
  const base = {
    RESB: [{ RSNUM: '0000020808', RSPOS: '0008', AUFNR: '000001000086', MATNR: '000000001000000400', WERKS: '1120', LGORT: 'CS01', CHARG: '', BDTER: '20250728', BDMNG: '1200.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
    AUFK: [{ AUFNR: '000001000086', AUART: 'ZP01', LOEKZ: '' }],
    JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }, { OBJNR: 'OR000001000086', STAT: 'I0043' }, { OBJNR: 'OR000001000086', STAT: 'I0215' }],
    MARD: [{ LGORT: 'CS01', LABST: '100.000' }],
    MCHB: [{ LGORT: 'CS01', CHARG: 'IN25001760', CLABS: '100.000' }],
    T320: [{ LGNUM: 'W01' }],
    LQUA: [],
    LTBK: [{ LGNUM: 'W13', TBNUM: '0001000514', BWLVS: '319', STATU: '' }],
    LTBP: [{ TBPOS: '0001', MENGE: '1200.000', TAMEN: '0.000', ELIKZ: '' }],
    LTAK: [],
    MATDOC: []
  };
  const cycle = (over = {}) => new Mvt261Adapter({ rfc: { readTable: async (table) => ({ ...base, ...over })[table] || [] } }).cycle({ reservation: '20808', item: '8' });
  const status = (c) => Object.fromEntries(c.Steps.map((s) => [s.Step, s.Status]));

  it('locked order with too little stock: order, availability and goods issue are blocked with reasons', async () => {
    // WM reservation (W01): issuable stock is the warehouse quant (100 KG), short of the 1200 KG open.
    const c = await cycle({ LQUA: [{ LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'BIN1', LGORT: 'CS01', CHARG: '', VERME: '100.000', LENUM: '1000000001' }] });
    expect(c).toMatchObject({ Reservation: '20808', ReservationItem: '8', ProductionOrder: '1000086', OrderStatus: 'LKD REL', OpenQuantity: 1200, Warehouse: 'W01' });
    expect(status(c)).toEqual({ Reservation: 'done', ProductionOrder: 'blocked', Availability: 'blocked', WmStaging: 'open', GoodsIssue: 'blocked', DocumentHistory: 'open', Reversal: 'done', Closure: 'open' });
    expect(c.Steps[1].Reason).toBe('order is locked');
    expect(c.Steps[2].Reason).toBe('issuable stock 100 KG is less than the open quantity 1200 KG');
    expect(c.IssuableQuantity).toBe(100);
    expect(c.TransferRequirements).toEqual([expect.objectContaining({ TransferRequirement: '1000514', MovementType: '319', Completed: false })]);
  });

  it('released order with enough stock: goods issue is open', async () => {
    const c = await cycle({
      JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
      MARD: [{ LGORT: 'CS01', LABST: '1200.000' }],
      LQUA: [{ LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'BIN1', LGORT: 'CS01', CHARG: '', VERME: '1200.000', LENUM: '1000000002' }]
    });
    expect(status(c)).toMatchObject({ ProductionOrder: 'done', Availability: 'done', GoodsIssue: 'open' });
    expect(c.IssuableQuantity).toBe(1200);
  });

  it('A3: open quantity is re-derived from RESB each call (required - withdrawn), so a partial withdrawal leaves the remainder open', async () => {
    // 1000 required, 400 already withdrawn -> 600 open. After a 262 SAP lowers ENMNG and the next
    // cycle() read restores that quantity to the open quantity; the app recomputes, it does not cache.
    const c = await cycle({
      RESB: [{ ...base.RESB[0], BDMNG: '1000.000', ENMNG: '400.000' }],
      JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
      MARD: [{ LGORT: 'CS01', LABST: '1000.000' }],
      LQUA: [{ LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'BIN1', LGORT: 'CS01', CHARG: '', VERME: '1000.000', LENUM: '1000000004' }]
    });
    expect(c).toMatchObject({ RequiredQuantity: 1000, WithdrawnQuantity: 400, OpenQuantity: 600 });
    expect(status(c)).toMatchObject({ GoodsIssue: 'open' });
  });

  it('order not released, deleted item, final issue: each blocks with its own reason', async () => {
    expect((await cycle({ JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0001' }] })).Steps[1]).toMatchObject({ Status: 'blocked', Reason: 'order is not released' });
    expect((await cycle({ JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }, { OBJNR: 'OR000001000086', STAT: 'I0045' }] })).Steps[1].Reason).toBe('order is technically completed');
    expect((await cycle({ RESB: [{ ...base.RESB[0], XLOEK: 'X' }] })).Steps[0]).toMatchObject({ Status: 'blocked', Reason: 'item is deleted' });
    expect((await cycle({ RESB: [{ ...base.RESB[0], KZEAR: 'X' }] })).Steps[4]).toMatchObject({ Status: 'blocked' });
  });

  it('fully issued item with a 261 and its 262: history is shown, the reversed 261 is not reversible again', async () => {
    const doc = { MJAHR: '2025', ZEILE: '0004', BUDAT: '20250626', MENGE: '835.000', MEINS: 'KG', CHARG: 'IN25700001', LGORT: 'PT01', USNAM: 'ADAPHALE' };
    const c = await cycle({
      RESB: [{ ...base.RESB[0], BDMNG: '835.000', ENMNG: '835.000' }],
      MATDOC: [
        { ...doc, MBLNR: '4900000282', BWART: '262', SMBLN: '4900000255', SJAHR: '2025', SMBLP: '0004', CANCELLED: '' },
        { ...doc, MBLNR: '4900000255', BWART: '261', SMBLN: '', SJAHR: '0000', SMBLP: '0000', CANCELLED: 'X' },
        { ...doc, MBLNR: '4900000300', BWART: '261', SMBLN: '', SJAHR: '0000', SMBLP: '0000', CANCELLED: '' }
      ]
    });
    expect(c.History.map((h) => h.MaterialDocument)).toEqual(['4900000255', '4900000282', '4900000300']);
    expect(c.History[1].Reverses).toBe('4900000255/2025/0004');
    expect(status(c)).toMatchObject({ GoodsIssue: 'done', DocumentHistory: 'done', Reversal: 'open', Closure: 'done' });
    expect(c.Steps[6].Reason).toBe('1 document(s) of movement type 261 can be reversed');
  });

  it('blocks reservation and goods issue on warehouse number mismatch or unmanaged location', async () => {
    const mismatch = await cycle({ RESB: [{ ...base.RESB[0], LGNUM: 'W13' }], T320: [{ LGNUM: 'W01' }] });
    expect(status(mismatch)).toMatchObject({ Reservation: 'blocked', GoodsIssue: 'blocked' });
    expect(mismatch.Steps[0].Reason).toBe('transmitted warehouse number is W13; determined warehouse number is W01');
    expect(mismatch.Steps[4].Reason).toContain('transmitted warehouse number is W13; determined warehouse number is W01');

    const unmanaged = await cycle({ RESB: [{ ...base.RESB[0], LGNUM: 'W13' }], T320: [] });
    expect(unmanaged.Steps[0].Reason).toBe('transmitted warehouse number is W13; storage location is not warehouse-managed');

    const matched = await cycle({ RESB: [{ ...base.RESB[0], LGNUM: 'W01' }], T320: [{ LGNUM: 'W01' }] });
    expect(matched.Steps[0].Status).toBe('done');
    expect(matched.Warehouse).toBe('W01');
    expect(matched.ReservationWarehouse).toBe('W01');
  });

  it('on a warehouse mismatch, reports only the mismatch and suppresses the derivative staging shortfall', async () => {
    const c = await cycle({
      RESB: [{ ...base.RESB[0], LGNUM: 'W13', LGTYP: 'IP5', BDMNG: '370.000', ENMNG: '0.000' }],
      T320: [{ LGNUM: 'W01' }],
      JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
      LQUA: [] // no staged stock in the determined warehouse W01 -> would otherwise report a 370 KG shortfall
    });
    expect(c.StagingShortfall).toBe(0);
    expect(c.Steps[4].Reason).toBe('transmitted warehouse number is W13; determined warehouse number is W01');
    expect(c.Steps[4].Reason).not.toContain('available stock shortfall');
  });

  it('filters out quants in cycle when quant warehouse differs from configured storage location warehouse', async () => {
    const c = await cycle({
      RESB: [{ ...base.RESB[0], LGNUM: 'W01' }],
      T320: [{ LGNUM: 'W01' }],
      LQUA: [
        { LGNUM: 'W01', LGTYP: 'IP5', LGPLA: '0001000086', LGORT: 'CS01', CHARG: '', VERME: '500.000', LENUM: '1000000001' },
        { LGNUM: 'W13', LGTYP: 'IP5', LGPLA: '0001000086', LGORT: 'CS01', CHARG: '', VERME: '500.000', LENUM: '1000000002' }
      ]
    });
    expect(c.Quants).toHaveLength(1);
    expect(c.Quants[0].Warehouse).toBe('W01');
    expect(c.Quants[0].StorageUnit).toBe('1000000001');
  });

  it('evaluates interim bin staging: shortfall blocks goods issue, staged stock satisfies requirement', async () => {
    const shortfall = await cycle({
      RESB: [{ ...base.RESB[0], LGTYP: 'IP1', BDMNG: '480.000', ENMNG: '0.000' }],
      JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
      MARD: [{ LGORT: 'CS01', LABST: '1000.000' }],
      LQUA: []
    });
    expect(shortfall.StagingRequired).toBe(true);
    expect(shortfall.StagingStorageType).toBe('IP1');
    expect(shortfall.StagingBin).toBe('0001000086');
    expect(shortfall.StagedQuantity).toBe(0);
    expect(shortfall.StagingShortfall).toBe(480);
    expect(status(shortfall)).toMatchObject({ GoodsIssue: 'blocked' });
    expect(shortfall.Steps[4].Reason).toContain('available stock shortfall of 480 KG in interim storage bin IP1/0001000086');

    const satisfied = await cycle({
      RESB: [{ ...base.RESB[0], LGTYP: 'IP5', BDMNG: '1200.000', ENMNG: '0.000' }],
      JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
      MARD: [{ LGORT: 'CS01', LABST: '1200.000' }],
      LTBK: [],
      LQUA: [{ LGNUM: 'W01', LGTYP: 'IP5', LGPLA: '0001000086', LGORT: 'CS01', CHARG: '', VERME: '1200.000', LENUM: '' }]
    });
    expect(satisfied.StagingRequired).toBe(true);
    expect(satisfied.StagingShortfall).toBe(0);
    expect(satisfied.StagedQuantity).toBe(1200);
    expect(status(satisfied)).toMatchObject({ WmStaging: 'done', GoodsIssue: 'open' });
  });

  it('unknown reservation is 404, unsafe input 400, RFC failure is passed on', async () => {
    await expect(cycle({ RESB: [] })).rejects.toMatchObject({ status: 404 });
    await expect(new Mvt261Adapter({ rfc: {} }).cycle({ reservation: "1' OR '1", item: '1' })).rejects.toMatchObject({ status: 400 });
    const down = new Mvt261Adapter({ rfc: { readTable: async () => { throw Object.assign(new Error('RFC connection not configured'), { status: 503 }); } } });
    await expect(down.cycle({ reservation: '20808', item: '8' })).rejects.toMatchObject({ status: 503 });
  });
});

describe('Mvt261Adapter.postGoodsIssue / reverse', () => {
  // RFC rows as read live for reservation 278650 item 1 (order 4000033120, REL, 10 NOS in HS01).
  const tables = (over = {}) => ({
    RESB: [{ RSNUM: '0000278650', RSPOS: '0001', AUFNR: '004000033120', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'HS01', CHARG: '', BDTER: '20261005', BDMNG: '1.000', ENMNG: '0.000', MEINS: 'NOS', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
    AUFK: [{ AUFNR: '004000033120', AUART: 'ZBDN', LOEKZ: '' }],
    JEST: [{ OBJNR: 'OR004000033120', STAT: 'I0002' }],
    MARD: [{ LGORT: 'HS01', LABST: '10.000' }],
    ...over
  });
  let posts;
  const adapter = (over, postResult = { status: 201, headers: {}, data: { d: { MaterialDocument: '4900050046', MaterialDocumentYear: '2026' } } }) => {
    posts = [];
    const t = tables(over);
    return new Mvt261Adapter({
      rfc: { readTable: async (table) => t[table] || [] },
      client: {
        get: async () => ({ data: { d: { results: [{ BaseUnit: 'NOS' }] } } }),
        post: async (path, options) => { posts.push({ path, data: options.data }); return postResult; }
      }
    });
  };
  const input = { reservation: '278650', item: '1', quantity: 1 };

  it('posts one 261 referencing reservation, item and order and returns the SAP document', async () => {
    await expect(adapter().postGoodsIssue(input)).resolves.toMatchObject({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026' });
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
    expect(posts[0].data).toMatchObject({ GoodsMovementCode: '03', MaterialDocumentHeaderText: 'GI Resv 278650' });
    expect(posts[0].data.to_MaterialDocumentItem.results).toEqual([{
      Material: '8000001948', GoodsMovementType: '261', EntryUnit: 'NOS', QuantityInEntryUnit: '1', Plant: '1120', StorageLocation: 'HS01',
      Reservation: '278650', ReservationItem: '0001', ManufacturingOrder: '004000033120'
    }]);
  });

  it('refuses without any SAP call: over-issue, locked or unreleased order, already issued, no stock, missing batch, bad quantity, warehouse mismatch, staging shortfall', async () => {
    const cases = [
      [undefined, { ...input, quantity: 2 }, 422],
      [{ JEST: [{ OBJNR: 'OR004000033120', STAT: 'I0002' }, { OBJNR: 'OR004000033120', STAT: 'I0043' }] }, input, 422],
      [{ JEST: [{ OBJNR: 'OR004000033120', STAT: 'I0001' }] }, input, 422],
      [{ RESB: [{ ...tables().RESB[0], ENMNG: '1.000', KZEAR: 'X' }] }, input, 422],
      [{ MARD: [{ LGORT: 'HS01', LABST: '0.000' }] }, input, 422],
      [{ MCHB: [{ LGORT: 'HS01', CHARG: 'B1', CLABS: '10.000' }] }, input, 422],
      [{ RESB: [{ ...tables().RESB[0], LGNUM: 'W13' }], T320: [{ LGNUM: 'W01' }] }, input, 422],
      [{ RESB: [{ ...tables().RESB[0], LGTYP: 'IP1' }], LQUA: [] }, input, 422],
      [undefined, { ...input, quantity: 0 }, 400]
    ];
    for (const [over, data, status] of cases) {
      await expect(adapter(over).postGoodsIssue(data)).rejects.toMatchObject({ status });
      expect(posts).toHaveLength(0);
    }
  });

  it('returns the outbound delivery (not a 502) when SAP creates a delivery for a WM-managed location (L9/514)', async () => {
    const sapMessage = JSON.stringify({ code: 'L9/514', message: 'Delivery 80000087 created', severity: 'success', details: [] });
    await expect(adapter(undefined, { status: 201, headers: { 'sap-message': sapMessage }, data: { d: { MaterialDocument: '' } } }).postGoodsIssue(input))
      .resolves.toMatchObject({ MaterialDocument: '', DeliveryNumber: '0080000087', Pending: true });
  });

  it('treats a response with neither a material document nor a delivery, and a SAP error, as failures', async () => {
    await expect(adapter(undefined, { status: 201, headers: {}, data: { d: { MaterialDocument: '' } } }).postGoodsIssue(input))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('did not return a material document') });
    const failing = adapter();
    failing.client.post = async () => { throw Object.assign(new Error('HTTP 403 - No authorization for movement type 261'), { status: 403 }); };
    await expect(failing.postGoodsIssue(input)).rejects.toMatchObject({ status: 403 });
  });

  it('F7: 518006/3 shape - stock only in the supply area is not issuable; post refused with the transfer reason, no SAP call', async () => {
    const a = adapter({
      RESB: [{ RSNUM: '0000518006', RSPOS: '0003', AUFNR: '000001002747', MATNR: '000000001000000653', WERKS: '1120', LGORT: 'PT01', LGNUM: '', LGTYP: '', LGPLA: '', CHARG: '', PRVBE: 'IP05', BDTER: '20261001', BDMNG: '25.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
      AUFK: [{ AUFNR: '000001002747', AUART: 'ZP01', LOEKZ: '' }],
      JEST: [{ OBJNR: 'OR000001002747', STAT: 'I0002' }],
      MARD: [{ LGORT: 'PT01', LABST: '0.000' }],
      PVBE: [{ PRVBE: 'IP05', LGORT: 'CS01' }],
      LQUA: [{ LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'B1', LGORT: 'CS01', CHARG: '', BESTQ: '', VERME: '25.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG', LENUM: '1000048321' }]
    });
    await expect(a.postGoodsIssue({ reservation: '518006', item: '3', quantity: 25 }))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining('in supply area CS01; issue location PT01 is empty') });
    expect(posts).toHaveLength(0);
  });

  it('reverses the exact document item with the API CancelItem function import', async () => {
    const a = adapter(undefined, { status: 200, headers: {}, data: { d: { CancelItem: { MaterialDocument: '4900050047', MaterialDocumentYear: '2026' } } } });
    await expect(a.reverse({ materialDocument: '4900050046', materialDocumentYear: '2026', materialDocumentItem: '1' })).resolves.toMatchObject({ MaterialDocument: '4900050047' });
    expect(posts[0].path).toBe("/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/CancelItem?MaterialDocument='4900050046'&MaterialDocumentYear='2026'&MaterialDocumentItem='0001'");
    await expect(a.reverse({ materialDocument: "1' or '1", materialDocumentYear: '2026', materialDocumentItem: '1' })).rejects.toMatchObject({ status: 400 });
    await expect(a.reverse({ materialDocument: '4900050046', materialDocumentYear: '2026' })).rejects.toMatchObject({ status: 400 }); // item required
    expect(posts).toHaveLength(1);
  });
});

describe('Mvt261Adapter.scanContext production-stock filter', () => {
  // Reservation 519944/6-shaped: material in plant 1130 / CS02, order released, warehouse W01.
  // PSA (PVBE) maps PRVBE -> storage location so its stock is included alongside the reservation's.
  const su = (LENUM, LGORT, CHARG, VERME, WDATU = '20250101') => ({
    LENUM, LGNUM: 'W01', LGTYP: 'RM1', LGPLA: '0-L0001-00', LGORT, MATNR: '000000001000000318', WERKS: '1130',
    CHARG, BESTQ: '', VERME, EINME: '0.000', AUSME: '0.000', MEINS: 'KG', WDATU,
    SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: ''
  });
  const ctx = (over = {}) => {
    const t = {
      RESB: [{ RSNUM: '0000519944', RSPOS: '0006', AUFNR: '000001002760', MATNR: '000000001000000318', WERKS: '1130', LGORT: 'CS02', LGNUM: 'W01', LGTYP: '', LGPLA: '', CHARG: '', PRVBE: 'IP02', BDTER: '20260101', BDMNG: '677.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
      AUFK: [{ AUFNR: '000001002760', AUART: 'ZP01', LOEKZ: '' }],
      JEST: [{ OBJNR: 'OR000001002760', STAT: 'I0002' }],
      MARD: [{ LGORT: 'CS02', LABST: '1000.000' }],
      MCHB: [], T320: [{ LGNUM: 'W01' }], LTBK: [], LTBP: [], LTAK: [], LTAP: [], MATDOC: [],
      PVBE: [{ LGORT: 'SA02' }],
      MAKT: [{ MAKTX: 'Hydrogen Peroxide 50%' }], MARC: [{ XCHPF: 'X' }],
      LQUA: [su('1', 'CS02', '', '400.000'), su('2', 'SA02', '', '200.000', '20250201'), su('3', 'ZZ99', '', '999.000')],
      ...over
    };
    return new Mvt261Adapter({ rfc: { readTable: async (table) => t[table] || [] } }).scanContext({ reservation: '519944', item: '6' });
  };

  it('WM reservation: includes the reservation and supply-area locations (both suggested), excludes unrelated, no stranded flag', async () => {
    const c = await ctx();
    expect(c).toMatchObject({ OrderReleased: true, SupplyArea: 'IP02', SupplyAreaStorageLocation: 'SA02', OpenQuantity: 677, SupplyAreaStock: 0 });
    expect(c.Units.map((u) => u.StorageUnit).sort()).toEqual(['1', '2']); // SU 3 in ZZ99 excluded
    // Warehouse-managed: supply-area stock in another storage location of the same warehouse stays suggested.
    expect(c.Units.find((u) => u.StorageUnit === '2')).toMatchObject({ StorageLocation: 'SA02', Status: 'Available', Suggested: true });
  });

  // Reservation 518006/3-shaped: non-WM issue location PT01 (empty), stock stranded in the PSA location CS01.
  it('for a non-WM reservation, supply-area stock in another location is shown but not suggested, and SupplyAreaStock is reported', async () => {
    const su2 = (LENUM, LGORT, VERME) => ({ LENUM, LGNUM: 'W13', LGTYP: 'RM1', LGPLA: '0-L0001-03', LGORT, MATNR: '000000001000000653', WERKS: '1120', CHARG: 'IN25072189', BESTQ: '', VERME, EINME: '0.000', AUSME: '0.000', MEINS: 'KG', WDATU: '20250101', SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: '' });
    const t = {
      RESB: [{ RSNUM: '0000518006', RSPOS: '0003', AUFNR: '000001002747', MATNR: '000000001000000653', WERKS: '1120', LGORT: 'PT01', LGNUM: '', LGTYP: '', LGPLA: '', CHARG: '', PRVBE: 'IP05', BDTER: '20260101', BDMNG: '25.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
      AUFK: [{ AUFNR: '000001002747', AUART: 'ZP01', LOEKZ: '' }],
      JEST: [{ OBJNR: 'OR000001002747', STAT: 'I0002' }],
      MARD: [{ LGORT: 'PT01', LABST: '0.000' }],
      MCHB: [], T320: [], LTBK: [], LTBP: [], LTAK: [], LTAP: [], MATDOC: [],
      PVBE: [{ LGORT: 'CS01' }],
      MAKT: [{ MAKTX: 'Mat 653' }], MARC: [{ XCHPF: 'X' }],
      LQUA: [su2('1000048321', 'CS01', '25.000')]
    };
    const c = await new Mvt261Adapter({ rfc: { readTable: async (table) => t[table] || [] } }).scanContext({ reservation: '518006', item: '3' });
    expect(c).toMatchObject({ Warehouse: '', StorageLocation: 'PT01', SupplyAreaStorageLocation: 'CS01', SupplyAreaStock: 25, IssuableQuantity: 0 });
    // Stock lives only in the supply area, so the item is now BLOCKED with an actionable reason (F1),
    // not shown as an unblocked scan page with nothing to pick.
    expect(c.Blocked).toBe(true);
    expect(c.BlockReason).toBe('25 KG in supply area CS01; issue location PT01 is empty - transfer required');
    expect(c.Units).toHaveLength(1);
    expect(c.Units[0]).toMatchObject({ StorageUnit: '1000048321', StorageLocation: 'CS01', Status: 'OnHold', Reason: 'inSupplyArea', Suggested: false });
  });

  it('shows only the reserved batch when the reservation item is batch-specific', async () => {
    const c = await ctx({
      RESB: [{ RSNUM: '0000519944', RSPOS: '0006', AUFNR: '000001002760', MATNR: '000000001000000318', WERKS: '1130', LGORT: 'CS02', LGNUM: 'W01', LGTYP: '', LGPLA: '', CHARG: 'IN26000333', PRVBE: '', BDTER: '20260101', BDMNG: '677.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
      PVBE: [],
      LQUA: [su('1', 'CS02', 'IN26000333', '400.000'), su('2', 'CS02', 'IN26000999', '500.000')]
    });
    expect(c.Batch).toBe('IN26000333');
    expect(c.Units.map((u) => u.StorageUnit)).toEqual(['1']); // other batch excluded
  });

  it('returns an empty stock list and OrderReleased=false for a non-released order', async () => {
    const c = await ctx({ JEST: [{ OBJNR: 'OR000001002760', STAT: 'I0001' }] });
    expect(c).toMatchObject({ OrderReleased: false, Blocked: true });
    expect(c.Units).toEqual([]);
  });
});

describe('Mvt261Adapter.checkStorageUnit', () => {
  it('rejects wrongBatch when the scanned unit holds a batch other than the reserved one', async () => {
    const a = new Mvt261Adapter({
      rfc: {
        readTable: async (table) => {
          if (table === 'RESB') return [{ AUFNR: '004000033120', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01', LGNUM: 'W01', LGTYP: '', LGPLA: '', CHARG: 'B1', XLOEK: '', KZEAR: '', XWAOK: 'X' }];
          if (table === 'AUFK') return [{ AUFNR: '004000033120', AUART: 'ZBDN', LOEKZ: '' }];
          if (table === 'JEST') return [{ OBJNR: 'OR004000033120', STAT: 'I0002' }];
          if (table === 'T320') return [{ LGNUM: 'W01' }];
          if (table === 'LQUA') return [{
            LGNUM: 'W01', LGTYP: 'RM1', LGPLA: '0-L0001-00', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01',
            CHARG: 'B2', BESTQ: '', VERME: '200.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG',
            SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: ''
          }];
          return [];
        }
      }
    });
    const res = await a.checkStorageUnit({ reservation: '418011', item: '2', storageUnit: '1000033424' });
    expect(res).toMatchObject({ Accepted: false, Reason: 'wrongBatch', Value1: 'B2', Value2: 'B1' });
  });

  it('rejects with itemBlocked when reservation has warehouse mismatch against T320', async () => {
    const a = new Mvt261Adapter({
      rfc: {
        readTable: async (table) => {
          if (table === 'RESB') return [{ AUFNR: '004000033120', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01', LGNUM: 'W13', LGTYP: '', LGPLA: '', XLOEK: '', KZEAR: '', XWAOK: 'X' }];
          if (table === 'AUFK') return [{ AUFNR: '004000033120', AUART: 'ZBDN', LOEKZ: '' }];
          if (table === 'JEST') return [{ OBJNR: 'OR004000033120', STAT: 'I0002' }];
          if (table === 'T320') return [{ LGNUM: 'W01' }];
          return [];
        }
      }
    });
    const res = await a.checkStorageUnit({ reservation: '418011', item: '2', storageUnit: '1000000001' });
    expect(res).toMatchObject({
      Accepted: false,
      Reason: 'itemBlocked',
      Value1: expect.stringContaining('transmitted warehouse number is W13; determined warehouse number is W01')
    });
  });

  it('rejects with wrongWarehouse when storage unit quants belong to warehouse W13 while storage location requires W01', async () => {
    const a = new Mvt261Adapter({
      rfc: {
        readTable: async (table) => {
          if (table === 'RESB') return [{ AUFNR: '004000033120', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01', LGNUM: 'W01', LGTYP: '', LGPLA: '', XLOEK: '', KZEAR: '', XWAOK: 'X' }];
          if (table === 'AUFK') return [{ AUFNR: '004000033120', AUART: 'ZBDN', LOEKZ: '' }];
          if (table === 'JEST') return [{ OBJNR: 'OR004000033120', STAT: 'I0002' }];
          if (table === 'T320') return [{ LGNUM: 'W01' }];
          if (table === 'LQUA') return [{
            LGNUM: 'W13', LGTYP: 'RM1', LGPLA: '0-L0001-00', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01',
            CHARG: 'B1', BESTQ: '', VERME: '200.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG',
            SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: ''
          }];
          return [];
        }
      }
    });
    const res = await a.checkStorageUnit({ reservation: '418011', item: '2', storageUnit: '1000033424' });
    expect(res).toMatchObject({
      Accepted: false,
      Reason: 'wrongWarehouse',
      Value1: 'W13',
      Value2: 'W01'
    });
  });

  it('accepts storage unit when storage unit quants match the configured storage location warehouse W01', async () => {
    const a = new Mvt261Adapter({
      rfc: {
        readTable: async (table) => {
          if (table === 'RESB') return [{ AUFNR: '004000033120', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01', LGNUM: 'W01', LGTYP: '', LGPLA: '', XLOEK: '', KZEAR: '', XWAOK: 'X' }];
          if (table === 'AUFK') return [{ AUFNR: '004000033120', AUART: 'ZBDN', LOEKZ: '' }];
          if (table === 'JEST') return [{ OBJNR: 'OR004000033120', STAT: 'I0002' }];
          if (table === 'T320') return [{ LGNUM: 'W01' }];
          if (table === 'LQUA') return [{
            LGNUM: 'W01', LGTYP: 'RM1', LGPLA: '0-L0001-00', MATNR: '000000008000001948', WERKS: '1120', LGORT: 'CS01',
            CHARG: 'B1', BESTQ: '', VERME: '200.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG',
            SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: ''
          }];
          return [];
        }
      }
    });
    const res = await a.checkStorageUnit({ reservation: '418011', item: '2', storageUnit: '1000000002' });
    expect(res).toMatchObject({
      Accepted: true,
      Reason: '',
      Rows: [expect.objectContaining({ Warehouse: 'W01', Quantity: 200 })]
    });
  });
});

describe('Mvt261Adapter._issuable (the one shared issuable-stock rule)', () => {
  const a = new Mvt261Adapter({ notReadyBins: [] });
  const q = (over) => ({
    LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'B1', LGORT: 'CS01', CHARG: '', BESTQ: '', VERME: '100.000',
    EINME: '0.000', AUSME: '0.000', MEINS: 'KG', LENUM: '1000000001',
    SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: '', ...over
  });
  const wm = (quants) => a._issuable({ warehouse: 'W01', storageLocation: 'CS01', supplyAreaStorageLocation: '', batch: '', openQty: 10, unit: 'KG' }, quants, []);
  const nonWm = (storageLocation, supplyAreaStorageLocation, locationStock, quants = [], batch = '') =>
    a._issuable({ warehouse: '', storageLocation, supplyAreaStorageLocation, batch, openQty: 25, unit: 'KG' }, quants, locationStock);

  it('WM: none / partial / full against the whole warehouse', () => {
    expect(wm([])).toMatchObject({ issuableQty: 0, blocked: true, partial: false });
    expect(wm([q({ VERME: '4.000' })])).toMatchObject({ issuableQty: 4, blocked: false, partial: true });
    expect(wm([q({ VERME: '10.000' })])).toMatchObject({ issuableQty: 10, blocked: false, partial: false });
  });

  it('WM: excludes not-ready quants and matches the pinned batch; bulk counts toward quantity but not units', () => {
    expect(wm([q({ VERME: '99.000', SPGRU: '1' }), q({ VERME: '4.000' })]).issuableQty).toBe(4); // blocked quant excluded
    const batched = a._issuable({ warehouse: 'W01', storageLocation: 'CS01', supplyAreaStorageLocation: '', batch: 'B9', openQty: 10, unit: 'KG' },
      [q({ CHARG: 'B9', VERME: '10.000' }), q({ CHARG: 'B8', VERME: '99.000' })], []);
    expect(batched.issuableQty).toBe(10);
    const bulk = wm([q({ LENUM: '', VERME: '10.000' })]);
    expect([bulk.issuableQty, bulk.issuableUnits.length]).toEqual([10, 0]); // bulk quant counts, no drum
  });

  it('non-WM: issuable is exactly the issue location; supply-area stock is reported, never counted', () => {
    expect(nonWm('PT01', '', [{ StorageLocation: 'PT01', Batch: '', Quantity: 25 }])).toMatchObject({ issuableQty: 25, blocked: false });
    expect(nonWm('PT01', '', [{ StorageLocation: 'PT01', Batch: '', Quantity: 4 }])).toMatchObject({ issuableQty: 4, partial: true, blocked: false });
    const pinned = nonWm('PT01', '', [{ StorageLocation: 'PT01', Batch: 'B9', Quantity: 10 }, { StorageLocation: 'PT01', Batch: '', Quantity: 99 }], [], 'B9');
    expect(pinned.issuableQty).toBe(10);
  });

  it('518006/3 shape: PT01 empty, 25 KG in supply area CS01 -> blocked with the transfer reason', () => {
    const r = nonWm('PT01', 'CS01', [{ StorageLocation: 'PT01', Batch: '', Quantity: 0 }], [q({ LGORT: 'CS01', VERME: '25.000' })]);
    expect(r).toMatchObject({ issuableQty: 0, supplyAreaStock: 25, blocked: true });
    expect(r.reason).toBe('25 KG in supply area CS01; issue location PT01 is empty - transfer required');
  });

  it('450402/3 shape: PT01 empty, 168 KG in supply area CS01 -> blocked', () => {
    const r = nonWm('PT01', 'CS01', [{ StorageLocation: 'PT01', Batch: '', Quantity: 0 }], [q({ LGORT: 'CS01', VERME: '168.000' })]);
    expect(r).toMatchObject({ issuableQty: 0, supplyAreaStock: 168, blocked: true });
  });
});

describe('Mvt261Adapter.openItems issuable per reservation', () => {
  // One non-WM item (518006/3-shape): PT01 is not in T320; stock lives in the supply area CS01.
  const build = (mardAtPt01) => new Mvt261Adapter({
    rfc: { readTable: async (table) => ({
      JEST: [{ OBJNR: 'OR000001002747', STAT: 'I0002' }],
      T320: [{ LGORT: 'CS01', LGNUM: 'W01' }], // CS01 is WM, PT01 is not
      RESB: [{ RSNUM: '0000518006', RSPOS: '0003', AUFNR: '000001002747', MATNR: '000000001000000653', LGORT: 'PT01', LGNUM: '', LGTYP: '', LGPLA: '', PRVBE: 'IP05', CHARG: '', XWAOK: 'X' }],
      PVBE: [{ PRVBE: 'IP05', LGORT: 'CS01' }],
      LQUA: [{ LENUM: '1000048321', LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'B1', LGORT: 'CS01', MATNR: '000000001000000653', WERKS: '1120', CHARG: '', BESTQ: '', VERME: '25.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG', SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: '' }],
      MARD: [{ LGORT: 'PT01', LABST: mardAtPt01 }],
      MCHB: []
    })[table] || [] },
    client: { get: async () => ({ data: { d: { __count: '1', results: [{
      Reservation: '518006', ReservationItem: '3', OrderID: '1002747', Product: '1000000653', Plant: '1120',
      StorageLocation: 'PT01', MatlCompRequirementDate: '/Date(1790000000000)/', ResvnItmRequiredQtyInBaseUnit: '25.000',
      ResvnItmWithdrawnQtyInBaseUnit: '0.000', BaseUnit: 'KG', GoodsMovementIsAllowed: true
    }] } } }) }
  });

  it('non-WM item whose only stock is in the supply area is Blocked, not ScanPossible (F2)', async () => {
    const r = await build('0.000').openItems({ plant: '1120' });
    expect(r.Items[0]).toMatchObject({
      ScanPossible: false, Blocked: true, ReadyStorageUnits: 0, ReadyQuantity: 0,
      BlockReason: '25 KG in supply area CS01; issue location PT01 is empty - transfer required'
    });
  });

  it('non-WM item with some issue-location stock is scannable and flagged partial', async () => {
    const r = await build('4.000').openItems({ plant: '1120' });
    expect(r.Items[0]).toMatchObject({ ScanPossible: true, Blocked: false, PartialCoverage: true, ReadyQuantity: 4 });
  });
});

describe('Mvt261Adapter backflush indicator (F5, hard block)', () => {
  const resbRow = (over = {}) => ({
    RSNUM: '0000020808', RSPOS: '0008', AUFNR: '000001000086', MATNR: '000000001000000400', WERKS: '1120',
    LGORT: 'CS01', LGNUM: 'W01', LGTYP: '', LGPLA: '', CHARG: '', PRVBE: '', RGEKZ: '1',
    BDTER: '20260101', BDMNG: '100.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X', ...over
  });
  const drum = {
    LENUM: '1000000003', LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'B1', LGORT: 'CS01', MATNR: '000000001000000400', WERKS: '1120',
    CHARG: '', BESTQ: '', VERME: '100.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG', WDATU: '20260101',
    SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: ''
  };
  const tables = (over = {}) => ({
    RESB: [resbRow()], AUFK: [{ AUFNR: '000001000086', AUART: 'ZP01', LOEKZ: '' }], JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
    MARD: [{ LGORT: 'CS01', LABST: '100.000' }], MCHB: [], T320: [{ LGORT: 'CS01', LGNUM: 'W01' }],
    LTBK: [], LTBP: [], LTAK: [], LTAP: [], MATDOC: [], MAKT: [{ MAKTX: 'Backflush mat' }], MARC: [{ XCHPF: '' }], PVBE: [], LQUA: [drum], ...over
  });
  const rfcAdapter = (over) => new Mvt261Adapter({ rfc: { readTable: async (t) => tables(over)[t] || [] } });
  const listAdapter = (over) => new Mvt261Adapter({
    rfc: { readTable: async (t) => tables(over)[t] || [] },
    client: { get: async () => ({ data: { d: { __count: '1', results: [{
      Reservation: '20808', ReservationItem: '8', OrderID: '1000086', Product: '1000000400', Plant: '1120', StorageLocation: 'CS01',
      MatlCompRequirementDate: '/Date(1790000000000)/', ResvnItmRequiredQtyInBaseUnit: '100.000', ResvnItmWithdrawnQtyInBaseUnit: '0.000', BaseUnit: 'KG', GoodsMovementIsAllowed: true
    }] } } }) }
  });

  it('cycle flags and BLOCKS the backflush component with the CO11N reason', async () => {
    const c = await rfcAdapter().cycle({ reservation: '20808', item: '8' });
    expect(c.Backflush).toBe(true);
    const gi = c.Steps.find((s) => s.Step === 'GoodsIssue');
    expect(gi.Status).toBe('blocked');
    expect(gi.Reason).toContain('backflushed at order confirmation (CO11N)');
    // A9: the block is not a dead end - it tells the operator what to do.
    expect(gi.Reason).toContain('ask your supervisor');
  });

  it('cycle reports Backflush false and stays open for a non-backflush reservation', async () => {
    const c = await rfcAdapter({ RESB: [resbRow({ RGEKZ: '' })] }).cycle({ reservation: '20808', item: '8' });
    expect(c.Backflush).toBe(false);
    expect(c.Steps.find((s) => s.Step === 'GoodsIssue').Status).toBe('open');
  });

  it('scanContext flags and blocks the backflush item with the reason', async () => {
    const c = await rfcAdapter().scanContext({ reservation: '20808', item: '8' });
    expect(c).toMatchObject({ Backflush: true, Blocked: true });
    expect(c.BlockReason).toContain('backflushed at order confirmation');
  });

  it('checkStorageUnit rejects a backflush item (itemBlocked)', async () => {
    const res = await rfcAdapter().checkStorageUnit({ reservation: '20808', item: '8', storageUnit: '1000000003' });
    expect(res).toMatchObject({ Accepted: false, Reason: 'itemBlocked' });
    expect(res.Value1).toContain('backflushed');
  });

  it('postGoodsIssue refuses a backflush item with 422 and does not post', async () => {
    await expect(rfcAdapter().postGoodsIssue({ reservation: '20808', item: '8', quantity: 100 }))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining('backflushed') });
  });

  it('openItems flags a backflush item as NOT scannable (Blocked) with the reason', async () => {
    const r = await listAdapter().openItems({ plant: '1120' });
    expect(r.Items[0]).toMatchObject({ Backflush: true, ScanPossible: false });
    expect(r.Items[0].BlockReason).toContain('backflushed');
  });
});

describe('Mvt261Adapter plant scope (F10)', () => {
  const tbl = {
    RESB: [{ RSNUM: '0000020808', RSPOS: '0008', AUFNR: '000001000086', MATNR: '000000001000000400', WERKS: '1120', LGORT: 'CS01', LGNUM: '', LGTYP: '', LGPLA: '', CHARG: '', PRVBE: '', RGEKZ: '', BDTER: '20260101', BDMNG: '100.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
    AUFK: [{ AUFNR: '000001000086', AUART: 'ZP01', LOEKZ: '' }], JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }],
    MARD: [{ LGORT: 'CS01', LABST: '100.000' }], MCHB: [], T320: [], LTBK: [], LTBP: [], LTAK: [], LTAP: [], MATDOC: [], PVBE: [], LQUA: []
  };
  const rfcOnly = () => new Mvt261Adapter({ rfc: { readTable: async (t) => tbl[t] || [] } });

  it('cycle: 403 when the reservation plant is outside the user scope', async () => {
    await expect(rfcOnly().cycle({ reservation: '20808', item: '8', allowedPlants: ['1130'] })).rejects.toMatchObject({ status: 403 });
  });

  it('cycle: allowed when the plant is in scope, and null = all plants', async () => {
    await expect(rfcOnly().cycle({ reservation: '20808', item: '8', allowedPlants: ['1120'] })).resolves.toMatchObject({ Plant: '1120' });
    await expect(rfcOnly().cycle({ reservation: '20808', item: '8', allowedPlants: null })).resolves.toMatchObject({ Plant: '1120' });
  });

  it('openItems: 403 for a specific out-of-scope plant and for an empty scope', async () => {
    const a = new Mvt261Adapter({ rfc: { readTable: async (t) => tbl[t] || [] }, client: { get: async () => ({ data: { d: { __count: '0', results: [] } } }) } });
    await expect(a.openItems({ plant: '1120', allowedPlants: ['1130'] })).rejects.toMatchObject({ status: 403 });
    await expect(a.openItems({ plant: '1120', allowedPlants: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('openItems: no plant given + a multi-plant scope filters the SAP query to those plants', async () => {
    let lastQuery = '';
    const a = new Mvt261Adapter({ rfc: { readTable: async (t) => tbl[t] || [] }, client: { get: async (_p, { query }) => { lastQuery = decodeURIComponent(query); return { data: { d: { __count: '0', results: [] } } }; } } });
    await a.openItems({ allowedPlants: ['1120', '1130'] });
    expect(lastQuery).toContain("(Plant eq '1120' or Plant eq '1130')");
  });

  it('A8: a multi-plant user is allowed for each plant in scope and rejected for a third', async () => {
    const cycleForPlant = (werks) => new Mvt261Adapter({ rfc: { readTable: async (t) => ({ ...tbl, RESB: [{ ...tbl.RESB[0], WERKS: werks }] })[t] || [] } })
      .cycle({ reservation: '20808', item: '8', allowedPlants: ['1120', '1130'] });
    await expect(cycleForPlant('1120')).resolves.toMatchObject({ Plant: '1120' });
    await expect(cycleForPlant('1130')).resolves.toMatchObject({ Plant: '1130' });
    await expect(cycleForPlant('2100')).rejects.toMatchObject({ status: 403 });
  });
});
