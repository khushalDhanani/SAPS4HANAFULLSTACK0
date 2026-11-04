const cds = require('@sap/cds');
const QuarantineLabelAdapter = require('../../../srv/integration/s4hana/wm/QuarantineLabelAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

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
    const { data } = await POST(`${BASE}/listDocuments`, range, as('test-clerk-1120'));
    expect(data).toMatchObject({ Plant: '1120', More: false, Documents: [{ MaterialDocument: '5000000001', SupplierName: 'DEMO SUPPLIER' }] });
    expect(list.mock.calls[0][0]).toMatchObject({ ...range, allowedPlants: ['1120'] });
  });

  it('Admin is unrestricted (allowedPlants null)', async () => {
    const list = jest.spyOn(QuarantineLabelAdapter.prototype, 'listDocuments').mockResolvedValue({ Plant: '1120', More: false, Documents: [] });
    await POST(`${BASE}/listDocuments`, range, as('khushal'));
    expect(list.mock.calls[0][0].allowedPlants).toBeNull();
  });

  it('refuses a plant outside the user\'s scope with 403 before any SAP read', async () => {
    const session = jest.spyOn(RfcClient.prototype, 'session');
    await expect(POST(`${BASE}/listDocuments`, { ...range, Plant: '1130' }, as('test-clerk-1120')))
      .rejects.toMatchObject({ response: { status: 403, data: { error: { message: 'You are not authorized for plant 1130.' } } } });
    expect(session).not.toHaveBeenCalled();
  });

  it('refuses a date range that ends before it starts with 400 before any SAP read', async () => {
    const session = jest.spyOn(RfcClient.prototype, 'session');
    await expect(POST(`${BASE}/listDocuments`, { Plant: '1120', DateFrom: '2026-10-27', DateTo: '2026-10-01' }, as('test-clerk-1120')))
      .rejects.toMatchObject({ response: { status: 400, data: { error: { message: 'The posting date "from" must not be after "to".' } } } });
    expect(session).not.toHaveBeenCalled();
  });

  it('a user without a warehouse role cannot list', async () => {
    const list = jest.spyOn(QuarantineLabelAdapter.prototype, 'listDocuments');
    await expect(POST(`${BASE}/listDocuments`, range, as('test-viewer-1120'))).rejects.toMatchObject({ response: { status: 403 } });
    expect(list).not.toHaveBeenCalled();
  });

  it('getPlantContext returns the user\'s plants; Admin is unrestricted', async () => {
    expect((await GET(`${BASE}/getPlantContext()`, as('test-clerk-1130'))).data).toMatchObject({ plants: ['1130'], unrestricted: false });
    expect((await GET(`${BASE}/getPlantContext()`, as('khushal'))).data).toMatchObject({ plants: [], unrestricted: true });
  });
});
