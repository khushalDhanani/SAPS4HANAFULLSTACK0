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

/** Fake S4HttpClient: routes GET by path substring. (Read-only adapter; create is not implemented — see WORKSTATUS.) */
function adapter(getRoutes) {
  const calls = { get: [] };
  const client = {
    get: async (path, { query } = {}) => {
      calls.get.push({ path, query: query ? decodeURIComponent(query) : '' });
      for (const [match, d] of getRoutes) if (path.includes(match)) return { data: { d } };
      return { data: { d: {} } };
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

// Create is intentionally not implemented (live POST proof failed with PI_RAP/003; required RAP fields
// undiscoverable). The adapter exposes no createHeader — see WORKSTATUS.
test('adapter exposes no create path (unproven against SAP)', () => {
  expect(typeof new PackingInstructionAdapter({}).createHeader).toBe('undefined');
});
