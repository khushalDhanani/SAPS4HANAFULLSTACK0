/**
 * Unit tests for the ISOLATED per-movement-type posting-client methods.
 * Transport (_post / _getDestination) is stubbed; we assert each method targets the correct
 * SAP service/path and payload for its type only.
 */

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

function makeClient() {
  const client = new GoodsIssuePostingClient({});
  client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
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

test('post201 → standard API with CostCenter, movement 201', async () => {
  const { client, calls } = makeClient();
  // Feed other types' exclusive fields too, to prove they never leak into a 201 payload.
  const res = await client.post201({ ...base, MovementType: '201', ValidatedMovementType: '201', CostCenter: '1011202902', Material: '1000000980', GLAccount: '400000', ReceivingPlant: '1600', ReceivingStorageLocation: 'CS02' });
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



test.each([['301', '04'], ['311', '04']])('post%s → standard API with receiving, movement %s', async (type, gm) => {
  const { client, calls } = makeClient();
  // Feed 201/261 exclusive fields too, to prove they never leak into a transfer payload.
  const res = await client[`post${type}`]({ ...base, MovementType: type, ValidatedMovementType: type, Material: 'M1', ReservationNo: '519944', ReservationItem: '0001', ReceivingPlant: '1600', ReceivingStorageLocation: 'CS02', CostCenter: 'CC1', GLAccount: '400000' });
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

test.each([undefined, '', '241', '999'])('rejects absent or unsupported movement type %s before POST', async (movementType) => {
  const { client, calls } = makeClient();
  await expect(client.postByMovementType({ ...base, MovementType: movementType })).rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});

test('rejects a missing upstream validated movement type before POST', async () => {
  const { client, calls } = makeClient();
  await expect(client.post261({ ...base, MovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123' }))
    .rejects.toMatchObject({ status: 400 });
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

test.each([
  ['201', '261', () => ({ MovementType: '261', Material: 'M1', CostCenter: 'CC1' })],
  ['261', '201', () => ({ MovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123' })]
])('aborts before POST if mapper changes requested movement %s to %s', async (requested, mutated, payloadFactory) => {
  const { client, calls } = makeClient();
  const originalSubmit = client._submitMaterialDocument.bind(client);
  client._submitMaterialDocument = (payload, meta) => {
    payload.to_MaterialDocumentItem.results[0].GoodsMovementType = mutated;
    return originalSubmit(payload, meta);
  };
  const data = { ...base, ...payloadFactory() };
  data.ValidatedMovementType = data.MovementType;
  await expect(requested === '201' ? client.post201(data) : client.post261(data))
    .rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});

test('postByMovementType routes to the isolated method', async () => {
  const { client } = makeClient();
  client.post301 = jest.fn().mockResolvedValue({ Success: true, mvt: '301' });
  const res = await client.postByMovementType({ ...base, MovementType: '301' });
  expect(client.post301).toHaveBeenCalled();
  expect(res.mvt).toBe('301');
});

test('postByMovementType routes 261 to post261 and preserves the requested Order', async () => {
  const { client } = makeClient();
  client.post261 = jest.fn().mockResolvedValue({ Success: true, mvt: '261' });
  const payload = { ...base, MovementType: '261', OrderNo: '1002707' };
  const res = await client.postByMovementType(payload);
  expect(client.post261).toHaveBeenCalledWith(payload);
  expect(res.mvt).toBe('261');
});

test('legacy queue replay requires explicit validated type and preserves 261 Order fields', async () => {
  const { client, calls } = makeClient();
  const result = await client.postGoodsIssue(
    '512851', '3', '1000001001', 1, 'KG', '', 0, '', '', false, '1130', 'CS02',
    { movementType: '261', validatedMovementType: '261', orderNo: '1002707', orderType: 'ZP01' }
  );
  const item = calls[0].body.to_MaterialDocumentItem.results[0];
  expect(result.Success).toBe(true);
  expect(item).toMatchObject({ GoodsMovementType: '261', ManufacturingOrder: '000001002707' });
  expect(item.CostCenter).toBeUndefined();
  expect(client.readBackDocument).toHaveBeenCalledWith('4900099999', '2026', { expectedMovementType: '261' });
});

test('postByMovementType routes 311 to post311 (not 301)', async () => {
  const { client } = makeClient();
  client.post311 = jest.fn().mockResolvedValue({ Success: true, mvt: '311' });
  client.post301 = jest.fn();
  const res = await client.postByMovementType({ ...base, MovementType: '311' });
  expect(client.post311).toHaveBeenCalled();
  expect(client.post301).not.toHaveBeenCalled();
  expect(res.mvt).toBe('311');
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

    await expect(client.post201({ ...base, MovementType: '201', ValidatedMovementType: '201', CostCenter: '1011202902', Material: '1000000980' }))
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

  test('hanging readBackDocument in post201 fails closed with an unknown outcome', async () => {
    const client = new GoodsIssuePostingClient({ readBackTimeoutMs: 50 });
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    client._post = jest.fn().mockResolvedValue({ MaterialDocument: '4900099999', MaterialDocumentYear: '2026' });
    client.readBackDocument = jest.fn().mockImplementation(async (doc, yr) => {
      return { MaterialDocument: doc, MaterialDocYear: yr, Confirmed: false, Status: 'posted, confirmation pending' };
    });

    await expect(client.post201({ ...base, MovementType: '201', ValidatedMovementType: '201', CostCenter: '1011202902', Material: '1000000980' }))
      .rejects.toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
  });


  test('readBackDocument passes abort signal if client supports abort', async () => {
    const mockHttpClient = {
      supportsAbort: true,
      abortSignal: null,
      get: jest.fn().mockImplementation((path, opts) => {
        expect(opts).toBeDefined();
        expect(opts.signal).toBeDefined();
        return Promise.resolve({ data: { d: { MaterialDocument: '4900011111', MaterialDocumentYear: '2026' } } });
      })
    };
    const client = new GoodsIssuePostingClient({ client: mockHttpClient });
    client.rfc = null; // force OData path

    const res = await client.readBackDocument('4900011111', '2026');
    expect(mockHttpClient.abortSignal).toBeDefined();
    expect(res.Confirmed).toBe(true);
    expect(res.MaterialDocument).toBe('4900011111');
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

describe('reverseGoodsIssue with empty year', () => {
  test('looks up year from SAP by document number and completes reversal', async () => {
    const client = new GoodsIssuePostingClient({});
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    client.readBackDocument = jest.fn().mockResolvedValue({
      MaterialDocument: '4900012345',
      MaterialDocYear: '2026',
      Confirmed: true
    });
    client._post = jest.fn().mockResolvedValue({
      MaterialDocument: '4900099999',
      MaterialDocumentYear: '2026'
    });

    const res = await client.reverseGoodsIssue('4900012345', '');
    expect(client.readBackDocument).toHaveBeenCalledWith('4900012345');
    expect(res.Success).toBe(true);
    expect(res.OriginalMaterialDocument).toBe('4900012345');
    expect(res.OriginalMaterialDocYear).toBe('2026');
    expect(res.ReversalMaterialDocument).toBe('4900099999');
  });

  test('blocks with clear message when document is not found in SAP for empty year', async () => {
    const client = new GoodsIssuePostingClient({});
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    client.readBackDocument = jest.fn().mockResolvedValue({
      MaterialDocument: '4900099999',
      MaterialDocYear: '',
      Confirmed: false
    });

    await expect(client.reverseGoodsIssue('4900099999', ''))
      .rejects.toThrow('Material document 4900099999 was not found in SAP; unable to determine document year for reversal.');
  });
});
