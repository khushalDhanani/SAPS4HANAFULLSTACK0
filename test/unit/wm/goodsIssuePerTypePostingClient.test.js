/**
 * Unit tests for the ISOLATED per-movement-type posting-client methods.
 * Transport (_post / _getDestination) is stubbed; we assert each method targets the correct
 * SAP service/path and payload for its type only.
 */

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

describe('readBackDocument & commit-lag handling', () => {

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
