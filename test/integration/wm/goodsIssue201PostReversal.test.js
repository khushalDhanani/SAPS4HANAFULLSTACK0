const cds = require('@sap/cds');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'alice', password: '' };
const { POST, axios } = cdsTest;

const BASE = '/odata/v4/goods-issue';

describe('Integration: Movement 201 Post and 202 Reversal Cycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts a 201 Goods Issue to Cost Center and reverses it via CancelHeader', async () => {
    // 1. Mock S/4 stock pre-check and serial status pre-check
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
      StockSufficient: true,
      CurrentStock: 10,
      Valid: true
    });

    jest.spyOn(GoodsIssueAdapter, 'validateSerialStatus').mockResolvedValue({
      valid: true
    });

    // 2. Mock S/4 posting & reversal methods on adapter
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue').mockResolvedValue({
      ReservationNo: '',
      ReservationItem: '',
      MaterialDocument: '4900055001',
      MaterialDocYear: '2026',
      TransferOrder: '',
      DifferenceCleared: false,
      DifferenceQty: 0,
      Success: true,
      Message: 'Goods Issue to Cost Center 201 posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (MatDoc: 4900055001/2026).'
    });

    jest.spyOn(GoodsIssueAdapter, 'reverseGoodsIssue').mockResolvedValue({
      OriginalMaterialDocument: '4900055001',
      OriginalMaterialDocYear: '2026',
      ReversalMaterialDocument: '4900055002',
      ReversalMaterialDocYear: '2026',
      PostingDate: '2026-09-29',
      Success: true,
      Message: 'Material Document 4900055001/2026 reversed successfully in S/4HANA via CancelHeader. Reversal Document: 4900055002/2026.'
    });

    // 3. Execute POST /odata/v4/goods-issue/postGoodsIssue for Movement 201
    const postRes = await POST(`${BASE}/postGoodsIssue`, {
      MovementType: '201',
      CostCenter: '1011101301',
      GLAccount: '0000400000',
      Material: '8000009753',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 1,
      Unit: 'EA',
      SerialNumbers: ['MACBOOK-004']
    });

    expect(postRes.status).toBe(200);
    expect(postRes.data).toMatchObject({
      Success: true,
      MaterialDocument: '4900055001',
      MaterialDocYear: '2026',
      SyncStatus: 'POSTED_IN_SAP',
      Queued: false
    });

    // Verify adapter call args
    expect(GoodsIssueAdapter.postGoodsIssue).toHaveBeenCalledWith(
      '',
      '',
      '8000009753',
      1,
      'EA',
      '',
      0,
      '',
      '',
      false,
      '1120',
      'HS01',
      expect.objectContaining({
        movementType: '201',
        costCenter: '1011101301',
        glAccount: '0000400000',
        serialNumbers: ['MACBOOK-004']
      })
    );

    // 4. Execute POST /odata/v4/goods-issue/reverseGoodsIssue for 202 Reversal
    const reverseRes = await POST(`${BASE}/reverseGoodsIssue`, {
      MaterialDocument: '4900055001',
      MaterialDocYear: '2026',
      PostingDate: '2026-09-29',
      ReversalReason: '01'
    });

    expect(reverseRes.status).toBe(200);
    expect(reverseRes.data).toMatchObject({
      OriginalMaterialDocument: '4900055001',
      OriginalMaterialDocYear: '2026',
      ReversalMaterialDocument: '4900055002',
      ReversalMaterialDocYear: '2026',
      Success: true
    });
    expect(reverseRes.data.Message).toContain('reversed successfully in S/4HANA via CancelHeader');
  });

  it('rejects postGoodsIssue with 422 when serial number is not ESTO (already issued)', async () => {
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
      StockSufficient: true,
      CurrentStock: 5,
      Valid: true
    });

    const serErr = new Error(
      'Serial Number "MACBOOK-004" is already issued or not in unrestricted stock (Status: Not in Stock (ESTO)). Serial numbers for Goods Issue must have status In-Stock (ESTO). Goods Issue is blocked.'
    );
    serErr.status = 422;
    jest.spyOn(GoodsIssueAdapter, 'validateSerialStatus').mockRejectedValue(serErr);

    const res = await axios.post(
      `${BASE}/postGoodsIssue`,
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
    expect(res.data.error.message).toContain('already issued or not in unrestricted stock');
  });
});
