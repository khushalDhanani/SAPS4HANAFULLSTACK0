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
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockResolvedValue({
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
    // GLAccount is intentionally omitted here: for Movement 201 it is system-determined via
    // OBYC/GBB-VBR and the server now rejects any caller-supplied value (see goodsIssueValidation
    // and goodsIssueMapper tests for the rejection/stripping behavior itself).
    const postRes = await POST(`${BASE}/postGoodsIssue201`, {
      CostCenter: '1011101301',
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
      MaterialDocYear: '2026'
    });

    // Verify the isolated 201 adapter method received the normalized 201 payload.
    expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledWith(
      expect.objectContaining({
        MovementType: '201',
        CostCenter: '1011101301',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 1,
        Unit: 'EA',
        SerialNumbers: ['MACBOOK-004']
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

  it('rejects postGoodsIssue with 400 when a caller supplies GLAccount for Movement 201', async () => {
    // G/L account is system-determined via OBYC/GBB-VBR for cost-center consumption and must
    // never be caller-overridable for 201, even with a syntactically valid value.
    const res = await axios.post(
      `${BASE}/postGoodsIssue201`,
      {
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
      `${BASE}/postGoodsIssue201`,
      {
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
