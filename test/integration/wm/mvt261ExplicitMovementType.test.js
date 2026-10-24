const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

function setup() {
  const client = new GoodsIssuePostingClient({ client: {} });
  client._getDestination = jest.fn().mockResolvedValue({ name: 'NON_PROD_TEST_DESTINATION' });
  client._assert261CapabilityReady = jest.fn().mockResolvedValue({ ready: true, movementType: '261' });
  const sapCalls = [];
  client._post = jest.fn(async (path, payload) => {
    sapCalls.push({ path, payload });
    return { MaterialDocument: '4900050046', MaterialDocumentYear: '2026' };
  });
  client.readBackDocument = jest.fn(async (doc, year, options) => ({
    MaterialDocument: doc,
    MaterialDocYear: year,
    Confirmed: true,
    Status: 'confirmed',
    Items: [{ BWART: options.expectedMovementType }]
  }));

  const adapter = new Mvt261Adapter({ client: {}, rfc: {}, postingClient: client });
  adapter.revalidateStock = jest.fn().mockResolvedValue({ freshCycle: {
    Reservation: '512851', ReservationItem: '0003', ProductionOrder: '1002707',
    Material: '1000001001', Plant: '1130', StorageLocation: 'CS02', Unit: 'KG', OrderType: 'ZP01'
  } });
  adapter._results = jest.fn().mockResolvedValue({ results: [{ BaseUnit: 'KG' }] });
  return { adapter, client, sapCalls };
}

const request = (overrides = {}) => ({
  movementType: '261', orderId: '1002707', orderType: 'ZP01', reservation: '512851', item: '3',
  quantity: 200, batch: 'B1', ...overrides
});

describe('Integration: 261 adapter → posting client → mapper → SAP payload → strict read-back', () => {
  it.each([undefined, '', '201', '241', '301', '311', '999'])('refuses movement type %s before any SAP post', async (movementType) => {
    const { adapter, client, sapCalls } = setup();
    await expect(adapter.postGoodsIssue(request({ movementType }))).rejects.toMatchObject({ status: 400 });
    expect(adapter.revalidateStock).not.toHaveBeenCalled();
    expect(client._post).not.toHaveBeenCalled();
    expect(sapCalls).toHaveLength(0);
  });

  it('sends and reads back exactly 261 with the verified Order', async () => {
    const { adapter, client, sapCalls } = setup();
    const result = await adapter.postGoodsIssue(request());
    const item = sapCalls[0].payload.to_MaterialDocumentItem.results[0];
    expect(result.MaterialDocument).toBe('4900050046');
    expect(client._assert261CapabilityReady).toHaveBeenCalledWith(expect.objectContaining({
      MovementType: '261', ValidatedMovementType: '261'
    }));
    expect(item.GoodsMovementType).toBe('261');
    expect(item.ManufacturingOrder).toBe('000001002707');
    expect(client.readBackDocument).toHaveBeenCalledWith('4900050046', '2026', { expectedMovementType: '261' });
  });

  it('never accepts a read-back that contains BWART 201', async () => {
    const { adapter, client, sapCalls } = setup();
    client.readBackDocument.mockResolvedValue({
      MaterialDocument: '4900050046', MaterialDocYear: '2026', Confirmed: false,
      Status: 'movement type mismatch', Items: [{ BWART: '201' }]
    });
    await expect(adapter.postGoodsIssue(request())).rejects.toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
    expect(sapCalls[0].payload.to_MaterialDocumentItem.results[0].GoodsMovementType).toBe('261');
  });

  it('fails closed when strict SAP material-document read-back is unavailable', async () => {
    const { adapter, client, sapCalls } = setup();
    client.readBackDocument.mockResolvedValue({
      MaterialDocument: '4900050046', MaterialDocYear: '2026', Confirmed: false, Status: 'not yet confirmed'
    });
    await expect(adapter.postGoodsIssue(request())).rejects.toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
    expect(sapCalls[0].payload.to_MaterialDocumentItem.results[0].GoodsMovementType).toBe('261');
  });
});
