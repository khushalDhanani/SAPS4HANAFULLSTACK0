/**
 * goodsIssue261Unplanned.test.js
 * Unit tests for Unplanned Movement 261 (Direct Goods Issue to Order, without reservation).
 * Covers:
 * 1. CAP Validation: accepts OrderNo-only, rejects when neither is provided, enforces Material/Plant/SLoc when unplanned.
 * 2. Mapper: maps ManufacturingOrder padded to 12 digits, optional ManufacturingOrderItem, header text.
 * 3. Posting Client: bypasses reservation-keyed RAP service and invokes Tier 2 _submitMaterialDocument directly.
 */

const { validateGoodsIssue261Payload } = require('../../../srv/wm/goods-issue/validation/goodsIssue261.validation');
const GoodsIssue261Mapper = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue261Mapper');
const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

describe('Movement 261 Unplanned - Validation', () => {
  const baseValidUnplanned = {
    IssueQty: 1,
    Unit: 'KG',
    PostingDate: '2026-09-29',
    DocumentDate: '2026-09-29',
    OrderNo: '2000611',
    Material: '8500000035',
    Plant: '1120',
    StorageLocation: 'CS01'
  };

  test('valid unplanned payload with OrderNo passes validation', () => {
    const res = validateGoodsIssue261Payload(baseValidUnplanned);
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  test('valid unplanned payload with OrderID alias passes validation', () => {
    const res = validateGoodsIssue261Payload({
      ...baseValidUnplanned,
      OrderNo: undefined,
      OrderID: '2000611'
    });
    expect(res.isValid).toBe(true);
  });

  test('rejects when neither reservation nor OrderNo is provided', () => {
    const res = validateGoodsIssue261Payload({
      IssueQty: 1,
      Unit: 'KG',
      Material: '8500000035',
      Plant: '1120',
      StorageLocation: 'CS01'
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.field === 'OrderNo')).toBe(true);
    expect(res.errors.some(e => e.message.includes('Either (ReservationNo and ReservationItem) or OrderNo is required'))).toBe(true);
  });

  test('enforces Material as mandatory in unplanned mode', () => {
    const res = validateGoodsIssue261Payload({
      ...baseValidUnplanned,
      Material: ''
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.field === 'Material')).toBe(true);
  });

  test('enforces Plant as mandatory in unplanned mode', () => {
    const res = validateGoodsIssue261Payload({
      ...baseValidUnplanned,
      Plant: ''
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.field === 'Plant')).toBe(true);
  });

  test('enforces StorageLocation as mandatory in unplanned mode', () => {
    const res = validateGoodsIssue261Payload({
      ...baseValidUnplanned,
      StorageLocation: ''
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.field === 'StorageLocation')).toBe(true);
  });

  test('rejects OrderNo exceeding 12 characters in unplanned mode', () => {
    const res = validateGoodsIssue261Payload({
      ...baseValidUnplanned,
      OrderNo: '1234567890123'
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.field === 'OrderNo' && e.message.includes('maximum length of 12'))).toBe(true);
  });
});

describe('Movement 261 Unplanned - Mapper', () => {
  const baseData = {
    IssueQty: 2.5,
    Unit: 'KG',
    PostingDate: '2026-09-29',
    DocumentDate: '2026-09-29',
    OrderNo: '2000611',
    Material: '8500000035',
    Plant: '1120',
    StorageLocation: 'CS01'
  };

  test('maps OrderNo to 12-digit padded ManufacturingOrder', () => {
    const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload(baseData);
    const item = payload.to_MaterialDocumentItem.results[0];

    expect(payload.GoodsMovementCode).toBe('03');
    expect(item.GoodsMovementType).toBe('261');
    expect(item.ManufacturingOrder).toBe('000002000611');
    expect(item.Reservation).toBeUndefined();
    expect(item.ReservationItem).toBeUndefined();
    expect(payload.MaterialDocumentHeaderText).toBe('GI Order 2000611');
  });

  test('maps OrderID alias to ManufacturingOrder if OrderNo is absent', () => {
    const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload({
      ...baseData,
      OrderNo: undefined,
      OrderID: '2000611'
    });
    const item = payload.to_MaterialDocumentItem.results[0];
    expect(item.ManufacturingOrder).toBe('000002000611');
  });

  test('maps optional ManufacturingOrderItem padded to 4 digits', () => {
    const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload({
      ...baseData,
      OrderItem: '1',
      ManufacturingOrderItem: '1'
    });
    const item = payload.to_MaterialDocumentItem.results[0];
    expect(item.ManufacturingOrderItem).toBe('0001');
  });

  test('never leaks CostCenter or receiving plant/storage location into 261 payload', () => {
    const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload({
      ...baseData,
      CostCenter: '1011202902',
      ReceivingPlant: '1600',
      ReceivingStorageLocation: 'CS02'
    });
    const item = payload.to_MaterialDocumentItem.results[0];
    expect(item.CostCenter).toBeUndefined();
    expect(item.IssuingOrReceivingPlant).toBeUndefined();
    expect(item.IssuingOrReceivingStorageLoc).toBeUndefined();
  });
});

describe('Movement 261 Unplanned - Posting Client', () => {
  function makeClient() {
    const client = new GoodsIssuePostingClient({});
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    const calls = [];
    client._post = jest.fn(async (path, body) => {
      calls.push({ path, body });
      return { MaterialDocument: '4900012345', MaterialDocumentYear: '2026' };
    });
    return { client, calls };
  }

  const baseUnplanned = {
    IssueQty: 1,
    Unit: 'KG',
    Plant: '1120',
    StorageLocation: 'CS01',
    PostingDate: '2026-09-29',
    DocumentDate: '2026-09-29',
    Material: '8500000035',
    OrderNo: '2000611'
  };

  test('unplanned 261 bypasses RAP V4 and calls Tier 2 _submitMaterialDocument directly', async () => {
    const { client, calls } = makeClient();
    const res = await client.post261(baseUnplanned);

    expect(res.Success).toBe(true);
    expect(res.MaterialDocument).toBe('4900012345');
    expect(res.OrderNo).toBe('2000611');
    expect(res.ReservationNo).toBe('');
    expect(res.ReservationItem).toBe('');

    // Exactly 1 call was made, and it went directly to API_MATERIAL_DOCUMENT_SRV
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toContain('API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
    expect(calls[0].path).not.toContain('zui_gi_order_rsv_o4');

    const item = calls[0].body.to_MaterialDocumentItem.results[0];
    expect(item.GoodsMovementType).toBe('261');
    expect(item.ManufacturingOrder).toBe('000002000611');
    expect(item.Reservation).toBeUndefined();
  });

  test('planned 261 (with reservation) still attempts RAP V4 first', async () => {
    const { client, calls } = makeClient();
    const plannedData = {
      ...baseUnplanned,
      ReservationNo: '518023',
      ReservationItem: '0001'
    };

    const res = await client.post261(plannedData);
    expect(res.Success).toBe(true);
    expect(calls[0].path).toContain('zui_gi_order_rsv_o4');
  });
});
