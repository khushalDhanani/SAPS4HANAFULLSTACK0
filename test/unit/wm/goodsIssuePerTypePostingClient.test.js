/**
 * Unit tests for the ISOLATED per-movement-type posting-client methods.
 * Transport (_post / _getDestination) is stubbed; we assert each method targets the correct
 * SAP service/path and payload for its type only.
 */

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

function makeClient() {
  const client = new GoodsIssuePostingClient({});
  client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
  const calls = [];
  client._post = jest.fn(async (path, body) => {
    calls.push({ path, body });
    return { MaterialDocument: '4900099999', MaterialDocumentYear: '2026' };
  });
  return { client, calls };
}

const base = { IssueQty: 1, Unit: 'KG', Plant: '1130', StorageLocation: 'CS02', PostingDate: '2026-09-29', DocumentDate: '2026-09-29' };

test('post201 → standard API with CostCenter, movement 201', async () => {
  const { client, calls } = makeClient();
  // Feed other types' exclusive fields too, to prove they never leak into a 201 payload.
  const res = await client.post201({ ...base, MovementType: '201', CostCenter: '1011202902', Material: '1000000980', GLAccount: '400000', ReceivingPlant: '1600', ReceivingStorageLocation: 'CS02' });
  expect(res.Success).toBe(true);
  expect(res.MaterialDocument).toBe('4900099999');
  expect(calls[0].path).toContain('API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
  const item = calls[0].body.to_MaterialDocumentItem.results[0];
  expect(item.GoodsMovementType).toBe('201');
  expect(item.CostCenter).toBe('1011202902');
  // No cross-type leakage: 201 never forwards GLAccount or receiving plant/sloc.
  expect(item.GLAccount).toBeUndefined();
  expect(item.IssuingOrReceivingPlant).toBeUndefined();
  expect(item.IssuingOrReceivingStorageLoc).toBeUndefined();
});

test('post261 → tries RAP ZUI_GI_ORDER_RSV_O4 first', async () => {
  const { client, calls } = makeClient();
  const res = await client.post261({ ...base, MovementType: '261', Material: '1000001002', ReservationNo: '518023', ReservationItem: '0001' });
  expect(res.Success).toBe(true);
  expect(calls[0].path).toContain('zui_gi_order_rsv_o4');
  expect(calls[0].path).toContain("ReservationNo='518023'");
});

test('post261 → falls back to standard API when RAP yields no document', async () => {
  const { client, calls } = makeClient();
  // RAP returns no MaterialDocument; standard returns one.
  client._post = jest.fn(async (path, body) => {
    calls.push({ path, body });
    if (path.includes('zui_gi_order_rsv_o4')) return {};
    return { MaterialDocument: '4900088888', MaterialDocumentYear: '2026' };
  });
  const res = await client.post261({ ...base, Material: '1000001002', ReservationNo: '518023', ReservationItem: '0001' });
  expect(res.MaterialDocument).toBe('4900088888');
  expect(calls[1].path).toContain('A_MaterialDocumentHeader');
  expect(calls[1].body.to_MaterialDocumentItem.results[0].GoodsMovementType).toBe('261');
});

test.each([['301', '04'], ['311', '04']])('post%s → standard API with receiving, movement %s', async (type, gm) => {
  const { client, calls } = makeClient();
  // Feed 201/261 exclusive fields too, to prove they never leak into a transfer payload.
  const res = await client[`post${type}`]({ ...base, MovementType: type, Material: 'M1', ReservationNo: '519944', ReservationItem: '0001', ReceivingPlant: '1600', ReceivingStorageLocation: 'CS02', CostCenter: 'CC1', GLAccount: '400000' });
  expect(res.Success).toBe(true);
  expect(calls[0].path).toContain('A_MaterialDocumentHeader');
  const item = calls[0].body.to_MaterialDocumentItem.results[0];
  expect(calls[0].body.GoodsMovementCode).toBe(gm);
  expect(item.GoodsMovementType).toBe(type);
  expect(item.IssuingOrReceivingPlant).toBe('1600');
  // No cross-type leakage: transfers never forward CostCenter or GLAccount.
  expect(item.CostCenter).toBeUndefined();
  expect(item.GLAccount).toBeUndefined();
});

test('postByMovementType routes to the isolated method', async () => {
  const { client } = makeClient();
  client.post301 = jest.fn().mockResolvedValue({ Success: true, mvt: '301' });
  const res = await client.postByMovementType({ ...base, MovementType: '301' });
  expect(client.post301).toHaveBeenCalled();
  expect(res.mvt).toBe('301');
});

test('postByMovementType routes 311 to post311 (not 301/261)', async () => {
  const { client } = makeClient();
  client.post311 = jest.fn().mockResolvedValue({ Success: true, mvt: '311' });
  client.post301 = jest.fn();
  client.post261 = jest.fn();
  const res = await client.postByMovementType({ ...base, MovementType: '311' });
  expect(client.post311).toHaveBeenCalled();
  expect(client.post301).not.toHaveBeenCalled();
  expect(client.post261).not.toHaveBeenCalled();
  expect(res.mvt).toBe('311');
});
