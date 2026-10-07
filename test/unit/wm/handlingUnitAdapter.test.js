const HandlingUnitAdapter = require('../../../srv/integration/s4hana/wm/HandlingUnitAdapter');

// Shapes as returned live by the three V2 services (HU 1000000000, client 220, 2026-10-06).
const listRow = {
  HandlingUnitExternalID: '1000000000', Warehouse: '', HandlingUnitIDChar32: '005056B40AF61FE08DD83C72B2D7F7F0',
  HandlingUnitOrigin: 'ERP', PackagingMaterial: '2000000042', PackagingMaterialName: 'Pallet', Plant: '1010',
  StorageLocation: '', StorageBin: '0000000007', GrossWeight: '209.200', NetWeight: '200.000', WeightUnit: 'KG',
  GrossVolume: '0.000', VolumeUnit: '', HandlingUnitProcessStatus: '', CreatedByUser: 'ADAPHALE', CreationDateTime: '/Date(1747886400000)/'
};
const detailHeader = {
  HandlingUnitExternalID: '1000000000', Warehouse: '', PackagingMaterial: '2000000042', Plant: '1010',
  GrossWeight: '209.200', NetWeight: '200.000', HandlingUnitTareWeight: '9.200', WeightUnit: 'KG',
  HandlingUnitPackingObjectKey: '000002000000', CreatedByUser: 'ADAPHALE', CreationDateTime: '/Date(1747886400000)/'
};
const detailItem = {
  HandlingUnitItem: '000001', Material: '000000000004000000002', MaterialName: 'HEEP', Plant: '1130',
  StorageLocation: 'FG01', Batch: 'HE1P250001', HandlingUnitQuantity: '200.000', HandlingUnitQuantityUnit: 'KG',
  HandlingUnitReferenceDocument: '', HandlingUnitGoodsReceiptDate: null
};
const hierRows = [
  { Node: '0000000007', ParentNode: '', HierarchyLevel: 0, HandlingUnitOrProductName: '1000000000', PackagingMaterial: '2000000042', HandlingUnitQuantity: '0.000', HandlingUnitQuantityUnit: '' },
  { Node: '0000000007000001', ParentNode: '0000000007', HierarchyLevel: 1, HandlingUnitOrProductName: '000000004000000002', Product: '000000000004000000002', HandlingUnitQuantity: '200.000', HandlingUnitQuantityUnit: 'KG' }
];

/** Fake S4HttpClient.get: routes by path, records the decoded query. */
function adapter(routes) {
  const calls = [];
  const client = {
    get: async (path, { query } = {}) => {
      calls.push({ path, query: query ? decodeURIComponent(query) : '' });
      for (const [match, d] of routes) if (path.includes(match)) return { data: { d } };
      return { data: { d: {} } };
    }
  };
  return { a: new HandlingUnitAdapter({ client }), calls };
}

describe('HandlingUnitAdapter.list', () => {
  it('maps a monitor row and reports counts', async () => {
    const { a, calls } = adapter([['C_HANDLINGUNITMONITOR_CDS', { __count: '1', results: [listRow] }]]);
    const r = await a.list({ plant: '1010' });
    expect(r).toMatchObject({ TotalCount: 1, SapCount: 1, Truncated: false });
    expect(r.Items[0]).toMatchObject({
      HandlingUnitExternalID: '1000000000', HandlingUnitIDChar32: '005056B40AF61FE08DD83C72B2D7F7F0',
      PackagingMaterial: '2000000042', GrossWeight: 209.2, NetWeight: 200, WeightUnit: 'KG', CreatedByUser: 'ADAPHALE'
    });
    expect(calls[0].query).toContain("$filter=Plant eq '1010'");
    expect(calls[0].query).toContain('$inlinecount=allpages');
  });

  it('builds every filter and rejects an unsafe value with 400 before any SAP call', async () => {
    const { a, calls } = adapter([['C_HANDLINGUNITMONITOR_CDS', { __count: '0', results: [] }]]);
    await a.list({ plant: '1010', storageLocation: 'ST01', warehouse: 'W1', packagingMaterial: '2000000042', handlingUnitExternalID: '1000000000' });
    expect(calls[0].query).toContain("Plant eq '1010' and StorageLocation eq 'ST01' and Warehouse eq 'W1' and PackagingMaterial eq '2000000042' and HandlingUnitExternalID eq '1000000000'");
    await expect(a.list({ plant: "1010' or '1'='1" })).rejects.toMatchObject({ status: 400 });
  });
});

describe('HandlingUnitAdapter.detail', () => {
  // detail() reads items (nav), header (API), then resolves Char32/Origin from the monitor. Order: most specific first.
  const detailRoutes = [
    ['to_HandlingUnitItem', { results: [detailItem] }],
    ['C_HANDLINGUNITMONITOR_CDS', { results: [{
      HandlingUnitIDChar32: '005056B40AF61FE08DD83C72B2D7F7F0',
      HandlingUnitOrigin: 'ERP',
      PackagingMaterialName: 'Pallet',
      HandlingUnitProcessStatusText: 'Active',
      HandlingUnitReferenceDocName: 'Inbound Delivery'
    }] }],
    ['API_HANDLING_UNIT', detailHeader]
  ];

  it('reads header plus items and maps weights, item material and enriched fields', async () => {
    const { a } = adapter(detailRoutes);
    const r = await a.detail({ handlingUnitExternalID: '1000000000' });
    expect(r).toMatchObject({
      HandlingUnitExternalID: '1000000000',
      GrossWeight: 209.2,
      TareWeight: 9.2,
      PackingObjectKey: '000002000000',
      PackagingMaterialName: 'Pallet',
      StatusText: 'Active',
      ReferenceDocumentType: 'Inbound Delivery'
    });
    expect(r.Items).toHaveLength(1);
    expect(r.Items[0]).toMatchObject({
      HandlingUnitItem: '1',
      Material: '4000000002',
      MaterialName: 'HEEP',
      Plant: '1130',
      StorageLocation: 'FG01',
      Batch: 'HE1P250001',
      Quantity: 200,
      Unit: 'KG'
    });
  });

  it('resolves HandlingUnitIDChar32 / Origin from the monitor so the tree loads on a deep link', async () => {
    const { a, calls } = adapter(detailRoutes);
    const r = await a.detail({ handlingUnitExternalID: '1000000000' });
    expect(r).toMatchObject({ HandlingUnitIDChar32: '005056B40AF61FE08DD83C72B2D7F7F0', HandlingUnitOrigin: 'ERP' });
    expect(calls.some((c) => c.path.includes('C_HANDLINGUNITMONITOR_CDS') && c.query.includes("HandlingUnitExternalID eq '1000000000'"))).toBe(true);
  });

  it('404 when the handling unit is not found', async () => {
    const { a } = adapter([['API_HANDLING_UNIT', {}]]);
    await expect(a.detail({ handlingUnitExternalID: '9999999999' })).rejects.toMatchObject({ status: 404 });
  });

  it('turns SAP\'s technical 404 (deleted HU) into a clear 404 message', async () => {
    // Live shape after a delete (HU 2000020251, 2026-10-06): S4HttpClient rejects with status 404 and SAP's segment text.
    const client = { get: async () => { throw Object.assign(new Error("S/4HANA GET … failed: HTTP 404 - Resource not found for segment 'HandlingUnitType'"), { status: 404 }); } };
    const a = new HandlingUnitAdapter({ client });
    await expect(a.detail({ handlingUnitExternalID: '2000020251' })).rejects.toMatchObject({
      status: 404, message: 'Handling unit 2000020251 was not found in SAP (it may have been deleted)'
    });
  });

  it('400 when the handling unit id is missing', async () => {
    const { a } = adapter([]);
    await expect(a.detail({})).rejects.toMatchObject({ status: 400 });
  });
});

describe('HandlingUnitAdapter.hierarchy', () => {
  it('maps the packing tree with node / parent / level', async () => {
    const { a, calls } = adapter([['UI_HANDLINGUNITHIERNODE', { results: hierRows }]]);
    const r = await a.hierarchy({ handlingUnitIDChar32: '005056B40AF61FE08DD83C72B2D7F7F0' });
    expect(r.TotalCount).toBe(2);
    expect(r.Nodes[0]).toMatchObject({ Node: '0000000007', ParentNode: '', HierarchyLevel: 0, PackagingMaterial: '2000000042' });
    expect(r.Nodes[1]).toMatchObject({ Node: '0000000007000001', ParentNode: '0000000007', HierarchyLevel: 1, Product: '4000000002', Quantity: 200, Unit: 'KG' });
    expect(calls[0].path).toContain("P_HandlingUnitOrigin='ERP',P_HandlingUnitIDChar32='005056B40AF61FE08DD83C72B2D7F7F0'");
  });

  it('400 on a malformed char32 id', async () => {
    const { a } = adapter([]);
    await expect(a.hierarchy({ handlingUnitIDChar32: 'nothex' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('HandlingUnitAdapter.valueHelp', () => {
  it('maps the plant value-help set to key/text (plant codes kept unstripped)', async () => {
    const { a, calls } = adapter([['C_PlantVH', { results: [{ Plant: '0001', PlantName: 'Werk 0001' }, { Plant: '1120', PlantName: 'Plant 1120' }] }]]);
    const r = await a.valueHelp({ kind: 'plant' });
    expect(r.Items).toEqual([{ key: '0001', text: 'Werk 0001' }, { key: '1120', text: 'Plant 1120' }]);
    expect(calls[0].path).toContain('C_PlantVH');
  });

  it('maps the status value-help set with its own field names', async () => {
    const { a } = adapter([['C_HandlingUnitStatusVH', { results: [{ HandlingUnitStat: 'A', HandlingUnitStatusName: 'Planned' }] }]]);
    const r = await a.valueHelp({ kind: 'status' });
    expect(r.Items).toEqual([{ key: 'A', text: 'Planned' }]);
  });

  it('accepts a mixed-case kind (shippingPoint) — case is normalized', async () => {
    const { a } = adapter([['C_ShippingPointVH', { results: [{ ShippingPoint: '0001', ShippingPointName: 'SP 0001' }] }]]);
    const r = await a.valueHelp({ kind: 'shippingPoint' });
    expect(r.Items).toEqual([{ key: '0001', text: 'SP 0001' }]);
  });

  it('400 on an unknown value-help kind, before any SAP call', async () => {
    const { a, calls } = adapter([]);
    await expect(a.valueHelp({ kind: 'bogus' })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
});

describe('HandlingUnitAdapter.statusKpis', () => {
  it('returns the total and one count per status code', async () => {
    const client = {
      get: async () => ({ data: { d: { results: [{ HandlingUnitStat: 'A', HandlingUnitStatusName: 'Planned' }, { HandlingUnitStat: 'B', HandlingUnitStatusName: 'Active' }] } } }),
      getText: async (path, { query } = {}) => (!query ? '17462' : /'A'/.test(decodeURIComponent(query)) ? '1124' : '7588')
    };
    const r = await new HandlingUnitAdapter({ client }).statusKpis();
    expect(r.Total).toBe(17462);
    expect(r.Items).toEqual([{ code: 'A', name: 'Planned', count: 1124 }, { code: 'B', name: 'Active', count: 7588 }]);
  });
});

describe('HandlingUnitAdapter.serials', () => {
  // SER06 (VENUM) -> OBKNR -> OBJK (SERNR, MATNR, EQUNR). VENUM is left-padded to 10 before the read.
  function rfc(ser06, objk) {
    const calls = [];
    return {
      calls,
      readTable: async (table, fields, where) => {
        calls.push({ table, where: where.join(' ') });
        return table === 'SER06' ? ser06 : objk;
      }
    };
  }

  it('maps serials for a handling unit (SER06 -> OBJK)', async () => {
    const r = rfc([{ OBKNR: '48066', VENUM: '0000021192' }], [{ OBKNR: '48066', SERNR: 'SR-01', MATNR: '000000008000007113', EQUNR: '000000000010015824' }]);
    const out = await new HandlingUnitAdapter({ rfc: r }).serials({ handlingUnitInternalNumber: '21192' });
    expect(out.Items).toEqual([{ SerialNumber: 'SR-01', Material: '8000007113', Equipment: '10015824' }]);
    expect(r.calls[0]).toMatchObject({ table: 'SER06', where: "VENUM = '0000021192'" });
  });

  it('returns no serials (and skips OBJK) when SER06 is empty', async () => {
    const r = rfc([], [{ OBKNR: 'x', SERNR: 'NOPE' }]);
    const out = await new HandlingUnitAdapter({ rfc: r }).serials({ handlingUnitInternalNumber: '21184' });
    expect(out.Items).toEqual([]);
    expect(r.calls).toHaveLength(1); // only SER06 was read
  });

  it('400 on a non-numeric internal number, before any RFC', async () => {
    const r = rfc([], []);
    await expect(new HandlingUnitAdapter({ rfc: r }).serials({ handlingUnitInternalNumber: 'abc' })).rejects.toMatchObject({ status: 400 });
    expect(r.calls).toHaveLength(0);
  });
});

describe('HandlingUnitAdapter.labels (batched material + first serial join)', () => {
  // Combined-item rows (I_HandlingUnitItemCombined) + SER06/OBJK, as the live join returns them.
  const items = [
    { HandlingUnitExternalID: 'A', HandlingUnitItem: '000002', Material: 'M2', MaterialName: 'Valve', HandlingUnitNumberOfSerialNumb: '0', HandlingUnitInternalID: '0000000001' },
    { HandlingUnitExternalID: 'A', HandlingUnitItem: '000001', Material: 'M1', MaterialName: 'Pump', HandlingUnitNumberOfSerialNumb: '0', HandlingUnitInternalID: '0000000001' },
    { HandlingUnitExternalID: 'B', HandlingUnitItem: '000001', Material: 'M3', MaterialName: 'Motor', HandlingUnitNumberOfSerialNumb: '1', HandlingUnitInternalID: '0000021496' }
  ];
  function build() {
    const calls = { client: [], rfc: [] };
    const client = {
      get: async (path, { query } = {}) => {
        calls.client.push({ path, query: query ? decodeURIComponent(query) : '' });
        return { data: { d: { results: items } } };
      }
    };
    const rfc = {
      readTable: async (table, fields, where) => {
        calls.rfc.push({ table, where: where.join(' ') });
        if (table === 'SER06') return [{ OBKNR: 'OB1', VENUM: '0000021496' }];
        return [{ OBKNR: 'OB1', SERNR: 'SR-B' }]; // OBJK
      }
    };
    return { a: new HandlingUnitAdapter({ client, rfc }), calls };
  }

  it('returns first-item material (+N more) and first serial, reading serials only for HUs that have them', async () => {
    const { a, calls } = build();
    const out = await a.labels({ handlingUnitExternalIDs: ['A', 'B', 'C'] });
    expect(out.Items).toEqual([
      { HandlingUnitExternalID: 'A', MaterialName: 'Pump +1 more', SerialNumber: '' }, // first by item no., 2 items
      { HandlingUnitExternalID: 'B', MaterialName: 'Motor', SerialNumber: 'SR-B' },     // serial from SER06->OBJK
      { HandlingUnitExternalID: 'C', MaterialName: '', SerialNumber: '' }               // no items
    ]);
    // one batched combined-item query (<=50 ids), filtered by the HU ids
    expect(calls.client).toHaveLength(1);
    expect(calls.client[0].path).toContain('I_HandlingUnitItemCombined');
    expect(calls.client[0].query).toContain("HandlingUnitExternalID eq 'A'");
    // serials read only for the one HU with a serial count > 0 (VENUM 0000021496), via SER06 then OBJK
    expect(calls.rfc.map((c) => c.table)).toEqual(['SER06', 'OBJK']);
    expect(calls.rfc[0].where).toContain("VENUM = '0000021496'");
  });

  it('rejects more than 2000 ids per call (enumeration/DoS guard), before any SAP call', async () => {
    const { a, calls } = build();
    const tooMany = Array.from({ length: 2001 }, (_, i) => String(i));
    await expect(a.labels({ handlingUnitExternalIDs: tooMany })).rejects.toMatchObject({ status: 400 });
    expect(calls.client).toHaveLength(0);
    expect(calls.rfc).toHaveLength(0);
  });

  it('returns no items and makes no SAP calls for an empty / invalid id list', async () => {
    const { a, calls } = build();
    expect(await a.labels({ handlingUnitExternalIDs: [] })).toEqual({ Items: [] });
    expect(await a.labels({})).toEqual({ Items: [] });
    expect(calls.client).toHaveLength(0);
    expect(calls.rfc).toHaveLength(0);
  });

  // Authorization: labels() reads I_HandlingUnitItemCombined in the SAME auth-enforced service as list(); SAP filters
  // out HUs the user may not see, so a restricted id simply comes back with no rows -> empty label, no serial read.
  it('returns no data for an HU the user is not authorized to see (SAP filters it out)', async () => {
    const rfcCalls = [];
    const client = {
      // Mimics SAP DCL: only rows whose HU id is in the $filter AND is authorized ('B') are returned; 'RESTRICTED' is filtered out.
      get: async (path, { query } = {}) => {
        const q = decodeURIComponent(query || '');
        const rows = items.filter((r) => q.includes(`HandlingUnitExternalID eq '${r.HandlingUnitExternalID}'`));
        return { data: { d: { results: rows } } };
      }
    };
    const rfc = {
      readTable: async (table, fields, where) => {
        rfcCalls.push({ table, where: where.join(' ') });
        return table === 'SER06' ? [{ OBKNR: 'OB1', VENUM: '0000021496' }] : [{ OBKNR: 'OB1', SERNR: 'SR-B' }];
      }
    };
    const out = await new HandlingUnitAdapter({ client, rfc }).labels({ handlingUnitExternalIDs: ['B', 'RESTRICTED'] });
    expect(out.Items).toEqual([
      { HandlingUnitExternalID: 'B', MaterialName: 'Motor', SerialNumber: 'SR-B' },
      { HandlingUnitExternalID: 'RESTRICTED', MaterialName: '', SerialNumber: '' } // filtered out by SAP -> no data
    ]);
    // the restricted HU never reaches the serial read; only authorized 'B' (VENUM 0000021496) does
    expect(rfcCalls[0].where).toBe("( VENUM = '0000021496' )");
  });
});

describe('HandlingUnitAdapter plant authorization (all read paths)', () => {
  it('list: scopes the monitor $filter to the user plants', async () => {
    const { a, calls } = adapter([['C_HANDLINGUNITMONITOR_CDS', { __count: '1', results: [listRow] }]]);
    await a.list({ allowedPlants: ['1010', '1120'] });
    expect(calls[0].query).toContain("(Plant eq '1010' or Plant eq '1120')");
  });
  it('list: empty plant scope returns nothing and makes no SAP call', async () => {
    const { a, calls } = adapter([['C_HANDLINGUNITMONITOR_CDS', { results: [listRow] }]]);
    const r = await a.list({ allowedPlants: [] });
    expect(r).toMatchObject({ TotalCount: 0, Items: [] });
    expect(calls).toHaveLength(0);
  });
  it('list: a browser plant outside the scope is not trusted -> no rows, no SAP call', async () => {
    const { a, calls } = adapter([['C_HANDLINGUNITMONITOR_CDS', { results: [listRow] }]]);
    const r = await a.list({ plant: '9999', allowedPlants: ['1010'] });
    expect(r.Items).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
  it('list: Admin (allowedPlants null) is unrestricted', async () => {
    const { a, calls } = adapter([['C_HANDLINGUNITMONITOR_CDS', { __count: '1', results: [listRow] }]]);
    await a.list({ allowedPlants: null });
    expect(calls[0].query).not.toContain('Plant eq');
  });
  it('labels: blanks HUs outside the user plants, keeps in-scope ones', async () => {
    const items = [
      { HandlingUnitExternalID: 'A', HandlingUnitItem: '000001', Material: 'M', MaterialName: 'InScope', HandlingUnitNumberOfSerialNumb: '0', HandlingUnitInternalID: '1', Plant: '1120' },
      { HandlingUnitExternalID: 'B', HandlingUnitItem: '000001', Material: 'M', MaterialName: 'OutScope', HandlingUnitNumberOfSerialNumb: '1', HandlingUnitInternalID: '2', Plant: '1130' }
    ];
    const rfcCalls = [];
    const client = { get: async () => ({ data: { d: { results: items } } }) };
    const rfc = { readTable: async (t, f, w) => { rfcCalls.push(w.join(' ')); return t === 'SER06' ? [{ OBKNR: 'O', VENUM: '0000000002' }] : [{ OBKNR: 'O', SERNR: 'S-B' }]; } };
    const out = await new HandlingUnitAdapter({ client, rfc }).labels({ handlingUnitExternalIDs: ['A', 'B'], allowedPlants: ['1120'] });
    expect(out.Items).toEqual([
      { HandlingUnitExternalID: 'A', MaterialName: 'InScope', SerialNumber: '' },
      { HandlingUnitExternalID: 'B', MaterialName: '', SerialNumber: '' } // out of scope -> blank, and its serial was never read
    ]);
    expect(rfcCalls).toHaveLength(0);
  });
  it('detail: 403 for an HU in a plant outside the user scope', async () => {
    const client = { get: async (path) => {
      if (path.includes('to_HandlingUnitItem')) return { data: { d: { results: [] } } };
      if (path.includes('C_HANDLINGUNITMONITOR_CDS')) return { data: { d: { results: [{ HandlingUnitExternalID: 'X', Plant: '1130' }] } } };
      return { data: { d: { HandlingUnitExternalID: 'X', Plant: '1130' } } };
    } };
    await expect(new HandlingUnitAdapter({ client }).detail({ handlingUnitExternalID: 'X', warehouse: '', allowedPlants: ['1120'] }))
      .rejects.toMatchObject({ status: 403 });
  });
  it('serials: no serials for an HU whose VEKP plant is out of scope', async () => {
    const rfc = { readTable: async (t) => (t === 'VEKP' ? [{ WERKS: '1130' }] : [{ OBKNR: 'O', VENUM: '0000021192' }]) };
    const out = await new HandlingUnitAdapter({ rfc }).serials({ handlingUnitInternalNumber: '21192', allowedPlants: ['1120'] });
    expect(out.Items).toEqual([]);
  });
  it('valueHelp plant: only offers the user plants', async () => {
    const client = { get: async () => ({ data: { d: { results: [{ Plant: '1010', PlantName: 'P10' }, { Plant: '1120', PlantName: 'P120' }] } } }) };
    const out = await new HandlingUnitAdapter({ client }).valueHelp({ kind: 'plant', allowedPlants: ['1120'] });
    expect(out.Items).toEqual([{ key: '1120', text: 'P120' }]);
  });
  it('hierarchy: 403 for an HU tree in a plant outside the user scope', async () => {
    const client = { get: async (path) => (path.includes('C_HANDLINGUNITMONITOR_CDS/HandlingUnit')
      ? { data: { d: { results: [{ Plant: '1130' }] } } }
      : { data: { d: { results: [] } } }) };
    await expect(new HandlingUnitAdapter({ client }).hierarchy({ handlingUnitIDChar32: 'A'.repeat(32), handlingUnitOrigin: 'ERP', allowedPlants: ['1120'] }))
      .rejects.toMatchObject({ status: 403 });
  });
  it('create: 403 when the target plant is outside the user scope (before any BAPI)', async () => {
    const rfc = { session: jest.fn() };
    await expect(new HandlingUnitAdapter({ client: {}, rfc }).create({ packagingMaterial: '2000000043', plant: '9999', storageLocation: 'HU01', allowedPlants: ['1120'] }))
      .rejects.toMatchObject({ status: 403 });
    expect(rfc.session).not.toHaveBeenCalled();
  });
});

describe('HandlingUnitAdapter writes (BAPI_HU_* + commit on one RFC session)', () => {
  // Shapes as returned live 2026-10-06 (client 220, test HU 2000020166).
  const KEY = '00000000002000020166';
  const VEKP = { VENUM: '0000021400', EXIDV: KEY, VHILM: '000000002000000043', WERKS: '1120', LGORT: 'HU01', STATUS: '0020', INHALT: 'CLAUDE HU BAPI PROOF' };
  const VEPO = { VEPOS: '000001', VELIN: '1', MATNR: '000000002000000255', CHARG: '', VEMNG: '1.000', VEMEH: 'NOS', WERKS: '1120', LGORT: 'HU01' };

  /** Fake RfcClient: session() hands the same call() to the adapter; readTable answers VEKP / VEPO. */
  function rfc({ ret = [], vekp = [VEKP], vepo = [VEPO], commitRet = { TYPE: '', ID: '', NUMBER: '000' }, fail } = {}) {
    const call = jest.fn(async (fm) => {
      if (fail) throw fail;
      if (fm === 'BAPI_TRANSACTION_COMMIT') return { RETURN: commitRet };
      return { RETURN: ret, HUKEY: KEY };
    });
    const readTable = jest.fn(async (table) => (table === 'VEKP' ? vekp : vepo));
    return { call, readTable, session: async (fn) => fn(call) };
  }
  const fms = (r) => r.call.mock.calls.map(([fm]) => fm);

  it('create sends the padded packaging material, commits with WAIT X and returns the committed HU', async () => {
    const r = rfc();
    const out = await new HandlingUnitAdapter({ rfc: r }).create({ packagingMaterial: '2000000043', plant: '1120', storageLocation: 'hu01', content: 'CLAUDE HU BAPI PROOF' });
    expect(r.call.mock.calls[0]).toEqual(['BAPI_HU_CREATE', { HEADERPROPOSAL: { PACK_MAT: '000000002000000043', PLANT: '1120', STGE_LOC: 'HU01', CONTENT: 'CLAUDE HU BAPI PROOF' } }]);
    expect(fms(r)).toEqual(['BAPI_HU_CREATE', 'BAPI_TRANSACTION_COMMIT']);
    expect(r.call.mock.calls[1][1]).toEqual({ WAIT: 'X' });
    expect(r.readTable.mock.calls[0][2]).toEqual([`EXIDV = '${KEY}'`]);
    expect(out).toMatchObject({ HandlingUnitExternalID: '2000020166', HandlingUnitInternalNumber: '0000021400', PackagingMaterial: '2000000043', Plant: '1120', StorageLocation: 'HU01', Status: '0020', Deleted: false });
    expect(out.Items).toEqual([{ HandlingUnitItem: '1', Material: '2000000255', Batch: '', Quantity: 1, Unit: 'NOS', Plant: '1120', StorageLocation: 'HU01' }]);
  });

  it('does not commit and answers 422 with SAP\'s text when RETURN has an E message', async () => {
    const r = rfc({ ret: [{ TYPE: 'E', ID: 'HUFUNCTIONS', NUMBER: '123', MESSAGE: 'Packaging material 2000000043 does not exist in plant 9999' }] });
    await expect(new HandlingUnitAdapter({ rfc: r }).create({ packagingMaterial: '2000000043', plant: '9999', storageLocation: 'HU01' }))
      .rejects.toMatchObject({ status: 422, message: /Packaging material 2000000043 does not exist/ });
    expect(fms(r)).toEqual(['BAPI_HU_CREATE']);
    expect(r.readTable).not.toHaveBeenCalled();
  });

  it('pack sends HUKEY as the 20-char string and a type-1 material item with a decimal quantity string', async () => {
    const r = rfc();
    const out = await new HandlingUnitAdapter({ rfc: r }).pack({ handlingUnitExternalID: '2000020166', material: '2000000255', quantity: 1, unit: 'nos', plant: '1120', storageLocation: 'HU01' });
    expect(r.call.mock.calls[0]).toEqual(['BAPI_HU_PACK', { HUKEY: KEY, ITEMPROPOSAL: { HU_ITEM_TYPE: '1', MATERIAL: '000000002000000255', PACK_QTY: '1.000', BASE_UNIT_QTY: 'NOS', PLANT: '1120', STGE_LOC: 'HU01' } }]);
    expect(fms(r)).toEqual(['BAPI_HU_PACK', 'BAPI_TRANSACTION_COMMIT']);
    expect(out.Items).toHaveLength(1);
  });

  it('pack passes an optional batch through', async () => {
    const r = rfc();
    await new HandlingUnitAdapter({ rfc: r }).pack({ handlingUnitExternalID: '2000020166', material: '4000000033', quantity: 2.5, unit: 'KG', batch: 'PMEP250156', plant: '1120', storageLocation: 'HU01' });
    expect(r.call.mock.calls[0][1].ITEMPROPOSAL).toMatchObject({ PACK_QTY: '2.500', BATCH: 'PMEP250156' });
  });

  it('unpack sends the 6-digit HU item number and returns the emptied HU', async () => {
    const r = rfc({ vepo: [] });
    const out = await new HandlingUnitAdapter({ rfc: r }).unpack({ handlingUnitExternalID: '2000020166', item: '1', material: '2000000255', quantity: '1', unit: 'NOS', plant: '1120', storageLocation: 'HU01' });
    expect(r.call.mock.calls[0]).toEqual(['BAPI_HU_UNPACK', { HUKEY: KEY, ITEMUNPACK: { HU_ITEM_TYPE: '1', HU_ITEM_NUMBER: '000001', MATERIAL: '000000002000000255', PACK_QTY: '1.000', BASE_UNIT_QTY: 'NOS', PLANT: '1120', STGE_LOC: 'HU01' } }]);
    expect(out.Items).toEqual([]);
  });

  it('remove treats SAP\'s S message as success and reports Deleted when the VEKP row is gone', async () => {
    const r = rfc({ ret: [{ TYPE: 'S', ID: 'HUDIALOG', NUMBER: '202', MESSAGE: '' }], vekp: [] });
    const out = await new HandlingUnitAdapter({ rfc: r }).remove({ handlingUnitExternalID: '2000020166' });
    expect(r.call.mock.calls[0]).toEqual(['BAPI_HU_DELETE', { HUKEY: KEY }]);
    expect(fms(r)).toEqual(['BAPI_HU_DELETE', 'BAPI_TRANSACTION_COMMIT']);
    expect(out).toEqual({ HandlingUnitExternalID: '2000020166', Deleted: true, Items: [] });
  });

  it('remove answers 502 when the HU still exists after the commit', async () => {
    const r = rfc();
    await expect(new HandlingUnitAdapter({ rfc: r }).remove({ handlingUnitExternalID: '2000020166' })).rejects.toMatchObject({ status: 502 });
  });

  it('rejects invalid input with 400 before any RFC call', async () => {
    const r = rfc();
    const a = new HandlingUnitAdapter({ rfc: r });
    await expect(a.pack({ handlingUnitExternalID: '2000020166', material: '2000000255', quantity: 0, unit: 'NOS', plant: '1120', storageLocation: 'HU01' })).rejects.toMatchObject({ status: 400, message: /Quantity/ });
    await expect(a.create({ packagingMaterial: '2000000043', plant: "11'20", storageLocation: 'HU01' })).rejects.toMatchObject({ status: 400, message: /Plant/ });
    await expect(a.create({ packagingMaterial: '2000000043', plant: '1120', storageLocation: 'HU01', content: 'x'.repeat(41) })).rejects.toMatchObject({ status: 400, message: /Content/ });
    await expect(a.unpack({ handlingUnitExternalID: '2000020166', item: 'abc', material: '2000000255', quantity: 1, unit: 'NOS', plant: '1120', storageLocation: 'HU01' })).rejects.toMatchObject({ status: 400, message: /Item/ });
    await expect(a.remove({ handlingUnitExternalID: '' })).rejects.toMatchObject({ status: 400 });
    expect(r.call).not.toHaveBeenCalled();
  });

  it('maps an RFC transport error to 502', async () => {
    const r = rfc({ fail: new Error('RFC_COMMUNICATION_FAILURE') });
    await expect(new HandlingUnitAdapter({ rfc: r }).remove({ handlingUnitExternalID: '2000020166' })).rejects.toMatchObject({ status: 502, message: /RFC_COMMUNICATION_FAILURE/ });
  });

  // Plant authorization on writes (VEKP.WERKS of the test HU is '1120'); role guards are unchanged.
  it('pack: 403 when the HU plant is outside the user scope (before any BAPI)', async () => {
    const r = rfc(); // VEKP.WERKS = '1120'
    await expect(new HandlingUnitAdapter({ rfc: r }).pack({ handlingUnitExternalID: '2000020166', material: '2000000255', quantity: 1, unit: 'NOS', plant: '1120', storageLocation: 'HU01', allowedPlants: ['1130'] }))
      .rejects.toMatchObject({ status: 403 });
    expect(r.call).not.toHaveBeenCalled(); // never reached the BAPI
  });
  it('remove: 403 when the HU plant is outside the user scope', async () => {
    const r = rfc();
    await expect(new HandlingUnitAdapter({ rfc: r }).remove({ handlingUnitExternalID: '2000020166', allowedPlants: ['1130'] }))
      .rejects.toMatchObject({ status: 403 });
    expect(r.call).not.toHaveBeenCalled();
  });
  it('pack: proceeds to the BAPI when the HU plant is within the user scope', async () => {
    const r = rfc(); // VEKP.WERKS = '1120'
    await new HandlingUnitAdapter({ rfc: r }).pack({ handlingUnitExternalID: '2000020166', material: '2000000255', quantity: 1, unit: 'NOS', plant: '1120', storageLocation: 'HU01', allowedPlants: ['1120'] });
    expect(fms(r)).toEqual(['BAPI_HU_PACK', 'BAPI_TRANSACTION_COMMIT']); // scope check passed, write proceeded
  });
});
