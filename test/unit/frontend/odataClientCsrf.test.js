const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * ODataClient CSRF contract. The client is not the enforcement point (the approuter is, see
 * test/unit/guard/routerConfig.test.js). The client fails closed when the token request fails, and never
 * re-sends a write automatically except once after the server refused it for a stale token.
 */

const webapp = path.resolve(__dirname, '../../../app/fiori-app/webapp');

function response(status, headers = {}, body = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    headers: { get: (name) => lower[String(name).toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  };
}

function loadClient(fetchMock) {
  let exported;
  vm.runInNewContext(fs.readFileSync(path.join(webapp, 'service/ODataClient.js'), 'utf8'), {
    sap: { ui: { define: (_names, factory) => { exported = factory({}, undefined); } } },
    fetch: fetchMock,
    Promise,
    setTimeout
  });
  return exported;
}

const isTokenFetch = ([, init]) => init.method === 'HEAD';
const isWrite = ([, init]) => init.method === 'POST';

describe('ODataClient CSRF handling', () => {
  test('a write carries the token the server issued', async () => {
    const fetchMock = jest.fn((url, init) => Promise.resolve(
      init.method === 'HEAD' ? response(200, { 'X-CSRF-Token': 'issued-token' }) : response(200, {}, { ok: true })
    ));
    const client = loadClient(fetchMock);

    await client.request('/odata/v4/purchase-order/create', { method: 'POST', body: { a: 1 } });

    const write = fetchMock.mock.calls.find(isWrite);
    expect(write[1].headers['X-CSRF-Token']).toBe('issued-token');
    expect(write[1].credentials).toBe('same-origin');
  });

  test('a read does not fetch a token', async () => {
    const fetchMock = jest.fn(() => Promise.resolve(response(200, {}, { value: [] })));
    const client = loadClient(fetchMock);

    await client.request('/odata/v4/purchase-order/PurchaseOrders');

    expect(fetchMock.mock.calls.filter(isTokenFetch)).toHaveLength(0);
  });

  test('fails closed: when the token request itself fails, the write is not sent', async () => {
    const fetchMock = jest.fn((url, init) => (
      init.method === 'HEAD' ? Promise.reject(new TypeError('network')) : Promise.resolve(response(200, {}, { ok: true }))
    ));
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/create', { method: 'POST', body: { a: 1 } }))
      .rejects.toMatchObject({ code: 'CSRF_TOKEN_UNAVAILABLE' });

    expect(fetchMock.mock.calls.filter(isWrite)).toHaveLength(0);
  });

  test('when the server requires a token and issues none, the write is sent once and not repeated', async () => {
    const fetchMock = jest.fn((url, init) => Promise.resolve(
      init.method === 'HEAD'
        ? response(200)
        : response(403, { 'x-csrf-token': 'Required' }, { error: { message: 'CSRF token validation failed' } })
    ));
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/create', { method: 'POST', body: { a: 1 } })).rejects.toBeDefined();

    expect(fetchMock.mock.calls.filter(isWrite)).toHaveLength(1);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('a %s is never retried automatically, even when the caller asks for retries', async (method) => {
    const fetchMock = jest.fn((url, init) => Promise.resolve(
      init.method === 'HEAD' ? response(200, { 'X-CSRF-Token': 't' }) : response(503, {}, { error: { message: 'Service Unavailable' } })
    ));
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/create', { method, body: {}, maxRetries: 3, retryDelayMs: 1 })).rejects.toBeDefined();

    expect(fetchMock.mock.calls.filter(([, init]) => init.method === method)).toHaveLength(1);
  });

  test('a write that fails on the network is not re-sent, even when the caller asks for retries', async () => {
    const fetchMock = jest.fn((url, init) => (
      init.method === 'HEAD' ? Promise.resolve(response(200, { 'X-CSRF-Token': 't' })) : Promise.reject(new TypeError('Failed to fetch'))
    ));
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/create', { method: 'POST', body: {}, maxRetries: 3, retryDelayMs: 1 })).rejects.toBeDefined();

    expect(fetchMock.mock.calls.filter(isWrite)).toHaveLength(1);
  });

  test('a read is still retried once on a transient gateway error', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, {}, { value: [] }));
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/PurchaseOrders', { retryDelayMs: 1 })).resolves.toEqual({ value: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('a rejected token is refreshed once and the write is re-sent with the new token', async () => {
    let issued = 0;
    const fetchMock = jest.fn((url, init) => {
      if (init.method === 'HEAD') {
        issued += 1;
        return Promise.resolve(response(200, { 'X-CSRF-Token': `token-${issued}` }));
      }
      return Promise.resolve(init.headers['X-CSRF-Token'] === 'token-1'
        ? response(403, { 'x-csrf-token': 'Required' })
        : response(200, {}, { ok: true }));
    });
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/create', { method: 'POST', body: {} })).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.filter(isWrite).map((c) => c[1].headers['X-CSRF-Token'])).toEqual(['token-1', 'token-2']);
  });

  test('a 403 that is not a CSRF challenge is not retried', async () => {
    const fetchMock = jest.fn((url, init) => Promise.resolve(
      init.method === 'HEAD' ? response(200, { 'X-CSRF-Token': 't' }) : response(403, {}, { error: { message: 'Forbidden' } })
    ));
    const client = loadClient(fetchMock);

    await expect(client.request('/odata/v4/purchase-order/create', { method: 'POST', body: {} })).rejects.toBeDefined();

    expect(fetchMock.mock.calls.filter(isWrite)).toHaveLength(1);
  });
});
