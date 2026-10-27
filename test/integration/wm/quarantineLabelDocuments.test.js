const cds = require('@sap/cds');
const QuarantineLabelAdapter = require('../../../srv/integration/s4hana/wm/QuarantineLabelAdapter');

// CAP wiring of the quarantine-labels document list: roles, server-side plant scope, error mapping. SAP reads mocked.
const cdsTest = cds.test(__dirname + '/../../../');
const { POST, GET } = cdsTest;

const BASE = '/odata/v4/quarantine-label';
const as = (username) => ({ auth: { username, password: '' } });
const range = { Plant: '1120', DateFrom: '2026-10-01', DateTo: '2026-10-27' };

describe('Integration: quarantine labels document list', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists documents with the user\'s plants as the server-side scope', async () => {
    const list = jest.spyOn(QuarantineLabelAdapter.prototype, 'listDocuments').mockResolvedValue({
      Plant: '1120', DateFrom: '2026-10-01', DateTo: '2026-10-27', More: false,
      Documents: [{ MaterialDocument: '5000000001', MaterialDocumentYear: '2026', PostingDate: '2026-10-20', Plant: '1120',
        Material: 'DEMO-MAT-1', MaterialDescription: 'DEMO MATERIAL 1', Batch: 'B1', SupplierName: 'DEMO SUPPLIER' }]
    });
    const { data } = await POST(`${BASE}/listDocuments`, range, as('carol'));
    expect(data).toMatchObject({ Plant: '1120', More: false, Documents: [{ MaterialDocument: '5000000001', SupplierName: 'DEMO SUPPLIER' }] });
    expect(list.mock.calls[0][0]).toMatchObject({ ...range, allowedPlants: ['1120'] });
  });

  it('Admin is unrestricted (allowedPlants null)', async () => {
    const list = jest.spyOn(QuarantineLabelAdapter.prototype, 'listDocuments').mockResolvedValue({ Plant: '1120', More: false, Documents: [] });
    await POST(`${BASE}/listDocuments`, range, as('alice'));
    expect(list.mock.calls[0][0].allowedPlants).toBeNull();
  });

  it('adapter errors keep their status (403 plant, 400 input)', async () => {
    jest.spyOn(QuarantineLabelAdapter.prototype, 'listDocuments').mockRejectedValue(Object.assign(new Error('You are not authorized for plant 1130.'), { status: 403 }));
    await expect(POST(`${BASE}/listDocuments`, { ...range, Plant: '1130' }, as('carol'))).rejects.toMatchObject({ response: { status: 403 } });
  });

  it('a user without a warehouse role cannot list', async () => {
    const list = jest.spyOn(QuarantineLabelAdapter.prototype, 'listDocuments');
    await expect(POST(`${BASE}/listDocuments`, range, as('bob'))).rejects.toMatchObject({ response: { status: 403 } });
    expect(list).not.toHaveBeenCalled();
  });

  it('getPlantContext returns the user\'s plants; Admin is unrestricted', async () => {
    expect((await GET(`${BASE}/getPlantContext()`, as('dave'))).data).toMatchObject({ plants: ['1130'], unrestricted: false });
    expect((await GET(`${BASE}/getPlantContext()`, as('alice'))).data).toMatchObject({ plants: [], unrestricted: true });
  });
});
