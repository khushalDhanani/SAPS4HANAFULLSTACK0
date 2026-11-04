/**
 * Unit tests for the ISOLATED per-movement-type posting-client methods.
 * Transport (_post / _getDestination) is stubbed; we assert each method targets the correct
 * SAP service/path and payload for its type only.
 */

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

function makeClient() {
  const client = new GoodsIssuePostingClient({});
  client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
  client._assert261CapabilityReady = jest.fn().mockResolvedValue({ ready: true, movementType: '261' });
  client.readBackDocument = jest.fn(async (doc, year, options = {}) => ({
    MaterialDocument: doc, MaterialDocYear: year, Confirmed: true, Status: 'confirmed',
    Items: [{ BWART: options.expectedMovementType }]
  }));
  const calls = [];
  client._post = jest.fn(async (path, body) => {
    calls.push({ path, body });
    return { MaterialDocument: '4900099999', MaterialDocumentYear: '2026' };
  });
  return { client, calls };
}

const base = { IssueQty: 1, Unit: 'KG', Plant: '1130', StorageLocation: 'CS02', PostingDate: '2026-09-29', DocumentDate: '2026-09-29', OrderType: 'ZP01' };

test('post261 maps and submits exactly the requested movement type and Order', async () => {
  const { client, calls } = makeClient();
  const result = await client.post261({
    ...base, MovementType: '261', ValidatedMovementType: '261', Material: '1000001001', ReservationNo: '512851',
    ReservationItem: '3', OrderNo: '1002707', ReferenceDocument: 'GI261TEST'
  });
  const sapItem = calls[0].body.to_MaterialDocumentItem.results[0];
  expect(result.Success).toBe(true);
  expect(client.readBackDocument).toHaveBeenCalledWith('4900099999', '2026', { expectedMovementType: '261' });
  expect(sapItem).toMatchObject({ GoodsMovementType: '261', ManufacturingOrder: '000001002707', Reservation: '512851', ReservationItem: '0003' });
  expect(sapItem.CostCenter).toBeUndefined();
  expect(sapItem.IssuingOrReceivingPlant).toBeUndefined();
});

test('rejects a missing upstream validated movement type before POST', async () => {
  const { client, calls } = makeClient();
  await expect(client.post261({ ...base, MovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123' }))
    .rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});

test('blocks movement 261 before POST when live capability readiness fails', async () => {
  const { client, calls } = makeClient();
  client._assert261CapabilityReady.mockRejectedValue(Object.assign(new Error('Service unavailable'), { status: 404 }));
  await expect(client.post261({
    ...base, MovementType: '261', ValidatedMovementType: '261', Material: 'M1',
    ReservationNo: '1', ReservationItem: '1', OrderNo: '123'
  })).rejects.toMatchObject({ status: 404 });
  expect(client._assert261CapabilityReady).toHaveBeenCalledTimes(1);
  expect(calls).toHaveLength(0);
});

test('261 refuses an incompatible 201 account field before POST', async () => {
  const { client, calls } = makeClient();
  await expect(client.post261({ ...base, MovementType: '261', ValidatedMovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123', CostCenter: 'CC1' }))
    .rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});

test('post261 fails closed when SAP read-back reports BWART 201', async () => {
  const { client, calls } = makeClient();
  client.readBackDocument.mockResolvedValue({ MaterialDocument: '4900099999', MaterialDocYear: '2026', Confirmed: false, Status: 'movement type mismatch', Items: [{ BWART: '201' }] });
  await expect(client.post261({ ...base, MovementType: '261', ValidatedMovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123' }))
    .rejects.toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
  expect(calls[0].body.to_MaterialDocumentItem.results[0].GoodsMovementType).toBe('261');
});

test('aborts before POST if the mapper changes requested movement 261 to 201', async () => {
  const mutated = '201';
  const payloadFactory = () => ({ MovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123' });
  const { client, calls } = makeClient();
  const originalSubmit = client._submitMaterialDocument.bind(client);
  client._submitMaterialDocument = (payload, meta) => {
    payload.to_MaterialDocumentItem.results[0].GoodsMovementType = mutated;
    return originalSubmit(payload, meta);
  };
  const data = { ...base, ...payloadFactory() };
  data.ValidatedMovementType = data.MovementType;
  await expect(client.post261(data))
    .rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});

describe('readBackDocument & commit-lag handling', () => {
  test('does not report a posting confirmed when read-back cannot prove its requested movement type', async () => {
    const client = new GoodsIssuePostingClient({});
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    client._post = jest.fn().mockResolvedValue({ MaterialDocument: '4900099999', MaterialDocumentYear: '2026' });
    // Simulate commit-lag: MATDOC and MKPF return no rows, OData returns no rows
    client.readBackDocument = jest.fn().mockResolvedValue({
      MaterialDocument: '4900099999',
      MaterialDocYear: '2026',
      Confirmed: false,
      Status: 'posted, confirmation pending'
    });

    client._assert261CapabilityReady = jest.fn().mockResolvedValue({ ready: true, movementType: '261' });
    await expect(client.post261({ ...base, MovementType: '261', ValidatedMovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123', OrderType: 'ZP01' }))
      .rejects.toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
  });

  test('returns SAP document marked "posted, confirmation pending" when readBackDocument errors', async () => {
    const client = new GoodsIssuePostingClient({});
    client.rfc = {
      readTable: jest.fn().mockRejectedValue(new Error('RFC connection reset during readback'))
    };
    client._get = jest.fn().mockRejectedValue(new Error('OData readback 503 gateway'));

    const result = await client.readBackDocument('4900099999', '2026');
    expect(result).toEqual({
      MaterialDocument: '4900099999',
      MaterialDocYear: '2026',
      Confirmed: false,
      Status: 'posted, confirmation pending'
    });
  });

  test('readBackDocument queries MATDOC first, then MKPF, then OData in fallback order', async () => {
    const callOrder = [];
    const client = new GoodsIssuePostingClient({});
    client.rfc = {
      readTable: jest.fn(async (table) => {
        callOrder.push(`RFC:${table}`);
        if (table === 'MATDOC') throw new Error('MATDOC table busy');
        if (table === 'MKPF') throw new Error('MKPF table lock');
        return [];
      })
    };
    client._get = jest.fn(async (_path) => {
      callOrder.push('ODATA:A_MaterialDocumentHeader');
      return { MaterialDocument: '4900077777', MaterialDocumentYear: '2026' };
    });

    const result = await client.readBackDocument('4900077777');
    expect(callOrder).toEqual(['RFC:MATDOC', 'RFC:MKPF', 'ODATA:A_MaterialDocumentHeader']);
    expect(result.Confirmed).toBe(true);
    expect(result.MaterialDocument).toBe('4900077777');
    expect(result.MaterialDocYear).toBe('2026');
  });

  test('MaterialDocYear derived from SAP BUDAT / PostingDate, never from the clock', async () => {
    const client = new GoodsIssuePostingClient({});
    client.rfc = {
      readTable: jest.fn(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '4900055555',
            MJAHR: '', // No year in MJAHR
            BUDAT: '20251115' // SAP posting date: Nov 15 2025
          }];
        }
        return [];
      })
    };

    const result = await client.readBackDocument('4900055555');
    expect(result.Confirmed).toBe(true);
    expect(result.MaterialDocYear).toBe('2025'); // Derived from 20251115, not from the clock
  });

  test('prefers MJAHR from SAP over a BUDAT-derived year', async () => {
    const client = new GoodsIssuePostingClient({});
    client.rfc = {
      readTable: jest.fn(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '4900012345',
            MJAHR: '2024',       // Authoritative SAP fiscal year
            BUDAT: '20250102'     // Different calendar date
          }];
        }
        return [];
      })
    };

    const result = await client.readBackDocument('4900012345');
    expect(result.Confirmed).toBe(true);
    expect(result.MaterialDocYear).toBe('2024'); // Strictly prefers MJAHR over BUDAT
  });

  test('hanging readBackDocument times out and returns unconfirmed without throwing or 504', async () => {
    let t1, t2;
    const client = new GoodsIssuePostingClient({ readBackTimeoutMs: 50 });
    client.rfc = {
      readTable: jest.fn(() => new Promise((resolve) => { t1 = setTimeout(() => resolve([]), 500); }))
    };
    client._get = jest.fn(() => new Promise((resolve) => { t2 = setTimeout(() => resolve({}), 500); }));

    try {
      const result = await client.readBackDocument('4900099999', '2026', { timeoutMs: 50 });
      expect(result).toMatchObject({
        MaterialDocument: '4900099999',
        MaterialDocYear: '2026',
        Confirmed: false,
        Status: 'posted, confirmation pending'
      });
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
    }
  });

  test('readBackDocument hands the same AbortSignal to an abort-capable HTTP client and to its GET', async () => {
    let getSignal = null;
    const httpClient = {
      supportsAbort: true,
      abortSignal: null,
      get: async (_path, opts) => {
        getSignal = opts.signal;
        return { data: { d: { MaterialDocument: '4900011111', MaterialDocumentYear: '2026' } } };
      }
    };
    const client = new GoodsIssuePostingClient({ client: httpClient });
    client.rfc = null; // force OData path

    const res = await client.readBackDocument('4900011111', '2026');
    expect(getSignal).toBeInstanceOf(AbortSignal);
    expect(httpClient.abortSignal).toBe(getSignal);
    expect(res).toMatchObject({ Confirmed: true, MaterialDocument: '4900011111', Tier: 'OData' });
  });

  test('readBackDocument caps concurrent read-backs when maxConcurrentReadBacks is reached', async () => {
    const client = new GoodsIssuePostingClient({ maxConcurrentReadBacks: 2 });
    let concurrent = 0;
    let maxObservedConcurrent = 0;

    client.rfc = {
      readTable: jest.fn(async () => {
        concurrent++;
        maxObservedConcurrent = Math.max(maxObservedConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        return [{ MBLNR: '4900000001', MJAHR: '2026' }];
      })
    };

    const promises = [
      client.readBackDocument('4900000001', '2026'),
      client.readBackDocument('4900000002', '2026'),
      client.readBackDocument('4900000003', '2026'),
      client.readBackDocument('4900000004', '2026'),
      client.readBackDocument('4900000005', '2026')
    ];

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(maxObservedConcurrent).toBeLessThanOrEqual(2);
    results.forEach((r) => expect(r.Confirmed).toBe(true));
  });
});
