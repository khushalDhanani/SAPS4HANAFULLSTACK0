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
