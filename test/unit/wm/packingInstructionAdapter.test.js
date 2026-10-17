const PackingInstructionAdapter = require('../../../srv/integration/s4hana/wm/PackingInstructionAdapter');

// Shapes as returned live by API_PACKINGINSTRUCTION (client 220, 2026-10-06).
const headerRow = {
  PackingInstructionSystemUUID: '005056b4-0af6-1fe0-8dc1-fa4bb9c857ee', PackingInstructionNumber: 'PI-2000000041',
  PackingInstructionExternalName: 'Pallet EUR', HandlingUnitType: '0001', HandlingUnitLength: '120.000',
  HandlingUnitWidth: '80.000', HandlingUnitHeight: '15.000', HandlingUnitUoMDimension: 'CM',
  HandlingUnitGrossWeight: '25.000', HandlingUnitWeightUnit: 'KG', PackingInstructionIsDeleted: false,
  CreatedByUser: 'ADAPHALE', CreationDate: '/Date(1747872000000)/'
};
const componentRow = { PackingInstructionItem: '000001', Material: '000000000004000000002', PackingInstructionItmTargetQty: '50.000', BaseUnitofMeasure: 'EA' };

/** Fake S4HttpClient: routes GET by path substring, records POST bodies. */
function adapter(getRoutes, postResult) {
  const calls = { get: [], post: [] };
  const client = {
    get: async (path, { query } = {}) => {
      calls.get.push({ path, query: query ? decodeURIComponent(query) : '' });
      for (const [match, d] of getRoutes) if (path.includes(match)) return { data: { d } };
      return { data: { d: {} } };
    },
    post: async (path, { data, csrfPath } = {}) => {
      calls.post.push({ path, data, csrfPath });
      return { data: { d: postResult || {} } };
    }
  };
  return { a: new PackingInstructionAdapter({ client }), calls };
}

describe('PackingInstructionAdapter.list', () => {
  it('maps header rows and reports counts', async () => {
    const { a, calls } = adapter([['PackingInstructionHeader', { __count: '1', results: [headerRow] }]]);
    const r = await a.list({});
    expect(r).toMatchObject({ TotalCount: 1, SapCount: 1, Truncated: false });
    expect(r.Items[0]).toMatchObject({ PackingInstructionNumber: 'PI-2000000041', PackingInstructionExternalName: 'Pallet EUR', Length: 120, GrossWeight: 25, CreationDate: '2025-05-22' });
    expect(calls.get[0].query).toContain('$inlinecount=allpages');
  });

  it('builds a contains filter and rejects an unsafe external name with 400', async () => {
    const { a, calls } = adapter([['PackingInstructionHeader', { __count: '0', results: [] }]]);
    await a.list({ externalName: 'Pallet' });
    expect(calls.get[0].query).toContain("substringof('Pallet',PackingInstructionExternalName)");
    await expect(a.list({ externalName: "x' or '1'='1" })).rejects.toMatchObject({ status: 400 });
  });
});

describe('PackingInstructionAdapter.get', () => {
  const routes = [
    ['to_PackingInstructionComponent', { results: [componentRow] }],
    ['to_PackingInstructionText', { results: [{ Language: 'E', PackingInstructionText: 'Standard' }] }],
    ['PackingInstructionHeader(guid', headerRow]
  ];
  it('reads header, components and texts', async () => {
    const { a } = adapter(routes);
    const r = await a.get({ systemUUID: '005056b4-0af6-1fe0-8dc1-fa4bb9c857ee' });
    expect(r).toMatchObject({ PackingInstructionNumber: 'PI-2000000041', HandlingUnitType: '0001' });
    expect(r.Components).toEqual([{ Item: '1', Material: '4000000002', TargetQuantity: 50, Unit: 'EA' }]);
    expect(r.Texts).toEqual([{ Language: 'E', Text: 'Standard' }]);
  });

  it('404 when not found, 400 on a malformed id', async () => {
    const notFound = adapter([['PackingInstructionHeader(guid', {}]]);
    await expect(notFound.a.get({ systemUUID: '005056b4-0af6-1fe0-8dc1-fa4bb9c857ee' })).rejects.toMatchObject({ status: 404 });
    const bad = adapter([]);
    await expect(bad.a.get({ systemUUID: 'not-a-guid' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('PackingInstructionAdapter.create (deep insert)', () => {
  const readBackRoutes = [
    ['to_PackingInstructionComponent', { results: [componentRow] }],
    ['to_PackingInstructionText', { results: [] }],
    ['PackingInstructionHeader(guid', headerRow]
  ];
  const input = {
    externalName: 'BOX_MAT4000_10KG', weightUnit: 'KG',
    components: [
      { item: '10', category: 'P', material: '2000000041', targetQty: 1, unit: 'NOS' },
      { item: '20', category: 'M', material: '4000000002', targetQty: 10, unit: 'KG' }
    ],
    texts: []
  };

  it('deep-inserts header + components (texts omitted when empty), then reads back the persisted doc', async () => {
    const { a, calls } = adapter(readBackRoutes, { PackingInstructionSystemUUID: '005056b4-0af6-1fe0-8dc1-fa4bb9c857ee' });
    const r = await a.create(input);
    const body = calls.post[0].data;
    expect(body).toMatchObject({ PackingInstructionExternalName: 'BOX_MAT4000_10KG', HandlingUnitWeightUnit: 'KG' });
    expect(body.to_PackingInstructionComponent).toEqual([
      { PackingInstructionItem: '10', PackingInstructionItemCategory: 'P', Material: '2000000041', PackingInstructionItmTargetQty: '1', BaseUnitofMeasure: 'NOS', UnitOfMeasure: 'NOS' },
      { PackingInstructionItem: '20', PackingInstructionItemCategory: 'M', Material: '4000000002', PackingInstructionItmTargetQty: '10', BaseUnitofMeasure: 'KG', UnitOfMeasure: 'KG' }
    ]);
    expect(body.to_PackingInstructionText).toBeUndefined();
    expect(calls.post[0].csrfPath).toContain('API_PACKINGINSTRUCTION');
    expect(r.PackingInstructionNumber).toBe('PI-2000000041'); // read-back, not the POST echo
  });

  it('includes texts when provided', async () => {
    const { a, calls } = adapter(readBackRoutes, { PackingInstructionSystemUUID: '005056b4-0af6-1fe0-8dc1-fa4bb9c857ee' });
    await a.create({ ...input, texts: [{ language: 'EN', text: 'standard box' }] });
    expect(calls.post[0].data.to_PackingInstructionText).toEqual([{ Language: 'EN', PackingInstructionText: 'standard box' }]);
  });

  it('422 before any POST when there is no component or no P item; 502 when SAP persists nothing', async () => {
    const noComp = adapter([], {});
    await expect(noComp.a.create({ externalName: 'X', weightUnit: 'KG', components: [] })).rejects.toMatchObject({ status: 422 });
    expect(noComp.calls.post).toHaveLength(0);
    const noP = adapter([], {});
    await expect(noP.a.create({ externalName: 'X', weightUnit: 'KG', components: [{ item: '10', category: 'M', material: '4000000002', targetQty: 1, unit: 'KG' }] })).rejects.toMatchObject({ status: 422 });
    expect(noP.calls.post).toHaveLength(0);
    const noPersist = adapter(readBackRoutes, {});
    await expect(noPersist.a.create(input)).rejects.toMatchObject({ status: 502 });
  });

  it('400 on an unsafe field, before any POST', async () => {
    const { a, calls } = adapter([], {});
    await expect(a.create({ externalName: 'X', weightUnit: 'KG', components: [{ item: '10', category: 'P', material: "x' or '1'='1", targetQty: 1, unit: 'NOS' }] })).rejects.toMatchObject({ status: 400 });
    expect(calls.post).toHaveLength(0);
  });
});
