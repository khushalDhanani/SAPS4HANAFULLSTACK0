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

test('post261 → rejects an expired batch before any SAP POST', async () => {
  const adapter = {
    validateBatch: jest.fn().mockResolvedValue({ valid: true }),
    validateBatchForPosting: jest.fn().mockResolvedValue({
      valid: false,
      status: 422,
      reason: 'Batch EXPIRED01 has expired. Posting blocked.'
    })
  };
  const client = new GoodsIssuePostingClient({ adapter });
  client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
  client._post = jest.fn();

  await expect(client.post261({
    ...base,
    MovementType: '261',
    Material: '1000001002',
    ReservationNo: '518023',
    ReservationItem: '0001',
    Batch: 'EXPIRED01'
  })).rejects.toMatchObject({
    status: 422,
    message: expect.stringContaining('has expired')
  });

  expect(adapter.validateBatchForPosting).toHaveBeenCalledWith(
    '1000001002',
    '1130',
    'CS02',
    'EXPIRED01',
    1,
    'KG'
  );
  expect(adapter.validateBatch).not.toHaveBeenCalled();
  expect(client._post).not.toHaveBeenCalled();
});

test('submitGoodsIssueRequest → does not fall back to an API that would drop FinalIssue', async () => {
  const { client, calls } = makeClient();
  const rapError = Object.assign(new Error('RAP final-issue action unavailable'), { status: 503 });
  client._post = jest.fn(async (path, body) => {
    calls.push({ path, body });
    throw rapError;
  });

  await expect(client.submitGoodsIssueRequest('518023', '', [{
    ReservationItem: '0001',
    Material: '1000001002',
    IssueQty: 20,
    Unit: 'KG',
    FinalIssue: true
  }])).rejects.toBe(rapError);

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toContain('submitRequest');
  expect(calls[0].body.Items[0].FinalIssue).toBe(true);
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

describe('readBackDocument & commit-lag handling', () => {
  test('returns SAP document marked "posted, confirmation pending" when readBackDocument finds nothing due to commit lag', async () => {
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

    const res = await client.post201({ ...base, MovementType: '201', CostCenter: '1011202902', Material: '1000000980' });
    expect(res.Success).toBe(true);
    expect(res.MaterialDocument).toBe('4900099999');
    expect(res.Confirmed).toBe(false);
    expect(res.ConfirmationStatus).toBe('POSTED_CONFIRMATION_PENDING');
    expect(res.Message).toContain('(posted, confirmation pending)');
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
    client._get = jest.fn(async (path) => {
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

  test('hanging readBackDocument in post201 returns unconfirmed document and never produces 504', async () => {
    const client = new GoodsIssuePostingClient({ readBackTimeoutMs: 50 });
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    client._post = jest.fn().mockResolvedValue({ MaterialDocument: '4900099999', MaterialDocumentYear: '2026' });
    client.readBackDocument = jest.fn().mockImplementation(async (doc, yr) => {
      return { MaterialDocument: doc, MaterialDocYear: yr, Confirmed: false, Status: 'posted, confirmation pending' };
    });

    const res = await client.post201({ ...base, MovementType: '201', CostCenter: '1011202902', Material: '1000000980' });
    expect(res.Success).toBe(true);
    expect(res.MaterialDocument).toBe('4900099999');
    expect(res.Confirmed).toBe(false);
    expect(res.ConfirmationStatus).toBe('POSTED_CONFIRMATION_PENDING');
    expect(res.Message).toContain('(posted, confirmation pending)');
  });

  test('hanging readBackDocument in post261 returns unconfirmed document and never produces 504', async () => {
    const client = new GoodsIssuePostingClient({ readBackTimeoutMs: 50 });
    client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
    client._post = jest.fn().mockResolvedValue({ MaterialDocument: '4900088888', MaterialDocYear: '2026' });
    client.readBackDocument = jest.fn().mockResolvedValue({
      MaterialDocument: '4900088888',
      MaterialDocYear: '2026',
      Confirmed: false,
      Status: 'posted, confirmation pending'
    });

    const res = await client.post261({
      MovementType: '261',
      ReservationNo: '0000142001',
      ReservationItem: '0001',
      Material: '1000000514',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 10,
      Unit: 'NOS'
    });
    expect(res.Success).toBe(true);
    expect(res.MaterialDocument).toBe('4900088888');
    expect(res.Confirmed).toBe(false);
    expect(res.ConfirmationStatus).toBe('POSTED_CONFIRMATION_PENDING');
    expect(res.Message).toContain('(posted, confirmation pending)');
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
