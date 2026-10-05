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
    const c = await cycle();
    expect(c).toMatchObject({ Reservation: '20808', ReservationItem: '8', ProductionOrder: '1000086', OrderStatus: 'LKD REL', OpenQuantity: 1200, Warehouse: 'W01' });
    expect(status(c)).toEqual({ Reservation: 'done', ProductionOrder: 'blocked', Availability: 'blocked', WmStaging: 'open', GoodsIssue: 'blocked', DocumentHistory: 'open', Reversal: 'done', Closure: 'open' });
    expect(c.Steps[1].Reason).toBe('order is locked');
    expect(c.Steps[2].Reason).toBe('unrestricted stock 100 KG is less than the open quantity 1200 KG');
    expect(c.TransferRequirements).toEqual([expect.objectContaining({ TransferRequirement: '1000514', MovementType: '319', Completed: false })]);
  });

  it('released order with enough stock: goods issue is open', async () => {
    const c = await cycle({ JEST: [{ OBJNR: 'OR000001000086', STAT: 'I0002' }], MARD: [{ LGORT: 'CS01', LABST: '1200.000' }] });
    expect(status(c)).toMatchObject({ ProductionOrder: 'done', Availability: 'done', GoodsIssue: 'open' });
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

  it('refuses without any SAP call: over-issue, locked or unreleased order, already issued, no stock, missing batch, bad quantity', async () => {
    const cases = [
      [undefined, { ...input, quantity: 2 }, 422],
      [{ JEST: [{ OBJNR: 'OR004000033120', STAT: 'I0002' }, { OBJNR: 'OR004000033120', STAT: 'I0043' }] }, input, 422],
      [{ JEST: [{ OBJNR: 'OR004000033120', STAT: 'I0001' }] }, input, 422],
      [{ RESB: [{ ...tables().RESB[0], ENMNG: '1.000', KZEAR: 'X' }] }, input, 422],
      [{ MARD: [{ LGORT: 'HS01', LABST: '0.000' }] }, input, 422],
      [{ MCHB: [{ LGORT: 'HS01', CHARG: 'B1', CLABS: '10.000' }] }, input, 422],
      [undefined, { ...input, quantity: 0 }, 400]
    ];
    for (const [over, data, status] of cases) {
      await expect(adapter(over).postGoodsIssue(data)).rejects.toMatchObject({ status });
      expect(posts).toHaveLength(0);
    }
  });

  it('treats a response without a material document, and a SAP error, as failures', async () => {
    await expect(adapter(undefined, { status: 201, headers: { 'sap-message': 'L9/514 delivery created' }, data: { d: { MaterialDocument: '' } } }).postGoodsIssue(input))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('L9/514') });
    const failing = adapter();
    failing.client.post = async () => { throw Object.assign(new Error('HTTP 403 - No authorization for movement type 261'), { status: 403 }); };
    await expect(failing.postGoodsIssue(input)).rejects.toMatchObject({ status: 403 });
  });

  it('reverses with the API Cancel action on the exact document', async () => {
    const a = adapter(undefined, { status: 200, headers: {}, data: { d: { Cancel: { MaterialDocument: '4900050047', MaterialDocumentYear: '2026' } } } });
    await expect(a.reverse({ materialDocument: '4900050046', materialDocumentYear: '2026' })).resolves.toMatchObject({ MaterialDocument: '4900050047' });
    expect(posts[0].path).toBe("/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/Cancel?MaterialDocument='4900050046'&MaterialDocumentYear='2026'");
    await expect(a.reverse({ materialDocument: "1' or '1", materialDocumentYear: '2026' })).rejects.toMatchObject({ status: 400 });
    expect(posts).toHaveLength(1);
  });
});
