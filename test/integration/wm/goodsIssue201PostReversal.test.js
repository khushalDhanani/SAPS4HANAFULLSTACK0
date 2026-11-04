const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { POST, axios } = cdsTest;

const BASE = '/odata/v4/goods-issue';

// S/4 answers below are hand-written from API_MATERIAL_DOCUMENT_SRV.xml field names and what the clients read;
// the stock and serial read shapes are not proven against SAP here.
const openStock = { status: 200, headers: {}, data: { d: { results: [{ StorageLocation: 'HS01', CurrentStock: '10', BaseUnit: 'EA' }] } } };

/** Stubs the Cloud SDK only: handlers, adapter, posting client and mapper all run. Returns the POSTs that reached SAP. */
function stubSap({ post, get = () => ({ status: 200, data: {}, headers: {} }) }) {
  jest.spyOn(connectivity, 'getDestination').mockResolvedValue({ url: 'https://s4.example.test', sapClient: '220' });
  const posts = [];
  jest.spyOn(httpClient, 'executeHttpRequest').mockImplementation(async (_dest, config) => {
    if (config.headers['x-csrf-token'] === 'Fetch') return { status: 200, data: {}, headers: { 'x-csrf-token': 'TOKEN' } };
    if (config.method === 'get') return get(config);
    posts.push(config);
    return post(config);
  });
  return posts;
}

describe('Integration: Movement 201 Post and 202 Reversal Cycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete GoodsIssueAdapter.rfc.readTable; // back to RfcClient.prototype.readTable
  });

  it('posts a 201 Goods Issue: the payload reaches S/4 and the document S/4 created comes back after read-back', async () => {
    const posts = stubSap({
      get: () => openStock,
      post: () => ({ status: 201, headers: {}, data: { d: { MaterialDocument: '4900055001', MaterialDocumentYear: '2026' } } })
    });
    GoodsIssueAdapter.rfc.readTable = async (table) => (table === 'MATDOC'
      ? [{ MBLNR: '4900055001', MJAHR: '2026', BWART: '201' }]
      : []);

    // GLAccount is intentionally omitted: for Movement 201 it is system-determined via OBYC/GBB-VBR.
    const postRes = await POST(`${BASE}/postGoodsIssue201`, {
      MovementType: '201',
      CostCenter: '1011101301',
      Material: '8000009753',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 1,
      Unit: 'EA'
    });

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
    expect(posts[0].data.GoodsMovementCode).toBe('03');
    expect(posts[0].data.to_MaterialDocumentItem.results[0]).toMatchObject({
      GoodsMovementType: '201',
      Material: '8000009753',
      Plant: '1120',
      StorageLocation: 'HS01',
      CostCenter: '1011101301'
    });
    expect(postRes.status).toBe(200);
    expect(postRes.data).toMatchObject({ Success: true, MaterialDocument: '4900055001', MaterialDocYear: '2026' });
  });

  it('reverses a material document through the S/4 Cancel import and returns the reversal document S/4 created', async () => {
    const posts = stubSap({
      post: () => ({ status: 201, headers: {}, data: { d: { MaterialDocument: '4900055002', MaterialDocumentYear: '2026' } } })
    });

    const reverseRes = await POST(`${BASE}/reverseGoodsIssue`, {
      MaterialDocument: '4900055001',
      MaterialDocYear: '2026',
      PostingDate: '2026-09-29',
      ReversalReason: '01'
    });

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/API_MATERIAL_DOCUMENT_SRV/Cancel?MaterialDocument='4900055001'&MaterialDocumentYear='2026'");
    expect(reverseRes.status).toBe(200);
    expect(reverseRes.data).toMatchObject({
      OriginalMaterialDocument: '4900055001',
      OriginalMaterialDocYear: '2026',
      ReversalMaterialDocument: '4900055002',
      ReversalMaterialDocYear: '2026',
      Success: true
    });
  });

  it('rejects postGoodsIssue with 400 when a caller supplies GLAccount for Movement 201', async () => {
    // G/L account is system-determined via OBYC/GBB-VBR for cost-center consumption and must
    // never be caller-overridable for 201, even with a syntactically valid value.
    const res = await axios.post(
      `${BASE}/postGoodsIssue201`,
      {
        MovementType: '201',
        CostCenter: '1011101301',
        GLAccount: '0000400000',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 1,
        Unit: 'EA'
      },
      { validateStatus: () => true }
    );

    // The isolated 201 action does not even declare a GLAccount parameter, so a caller-supplied
    // value is rejected outright (400) - the account stays system-determined (OBYC/GBB-VBR).
    expect(res.status).toBe(400);
    expect(res.data.error.message).toContain('GLAccount');
  });

  it('fails closed (blocks posting) instead of posting unchecked when the stock pre-check itself errors unexpectedly', async () => {
    const unexpectedErr = new Error('S/4HANA Gateway timeout while revalidating stock');
    unexpectedErr.status = 504;
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockRejectedValue(unexpectedErr);
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201');

    const res = await axios.post(
      `${BASE}/postGoodsIssue201`,
      {
        MovementType: '201',
        CostCenter: '1011101301',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 1,
        Unit: 'EA'
      },
      { validateStatus: () => true }
    );

    expect(res.status).toBe(504);
    expect(res.data.error.message).toContain('Stock pre-check could not be completed');
    // The whole point of failing closed: posting must never be attempted when the pre-check itself failed.
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects with 422 and posts nothing when SAP reports the serial number outside unrestricted stock', async () => {
    const posts = stubSap({
      get: (config) => (config.url.includes('UI_MATERIALSERIALNUMBER')
        ? { status: 200, headers: {}, data: { d: { results: [{ SerialNumber: 'MACBOOK-004', Material: '8000009753', Plant: '1120', StorageLocation: 'HS01', InventoryStockType: '07', InventoryStockType_Text: 'Blocked' }] } } }
        : openStock),
      post: () => ({ status: 201, headers: {}, data: { d: { MaterialDocument: '4900055009', MaterialDocumentYear: '2026' } } })
    });
    GoodsIssueAdapter.rfc.readTable = async () => [];

    const res = await axios.post(
      `${BASE}/postGoodsIssue201`,
      {
        MovementType: '201',
        CostCenter: '1011101301',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 1,
        Unit: 'EA',
        SerialNumbers: ['MACBOOK-004']
      },
      { validateStatus: () => true }
    );

    expect(res.status).toBe(422);
    expect(res.data.error.message).toBe('Serial number MACBOOK-004 is not in unrestricted stock (plant 1120, storage location HS01, Blocked).');
    expect(posts).toHaveLength(0);
  });
});
