'use strict';

/**
 * Deployed-environment contract: a failed BTP destination lookup must not silently downgrade
 * the S/4HANA connection to local Basic credentials.
 *
 * The resolver itself falls back to local configuration when the lookup yields nothing, so the
 * protection in production is the combination of three things, each asserted here:
 *   1. the startup guard refuses S/4 credentials in environment variables in production;
 *   2. the production profile of every remote service carries a destination reference, never a URL;
 *   3. in production the resolver itself never uses local credentials: a lookup that throws is
 *      DESTINATION_LOOKUP_FAILED (503), a lookup that finds nothing is DESTINATION_NOT_CONFIGURED (502).
 */

const { S4HttpClient, DESTINATION_NOT_CONFIGURED, DESTINATION_LOOKUP_FAILED } = require('../../srv/integration/s4hana/S4HttpClient');
const { LOCAL_CREDENTIAL_SOURCES } = require('../../srv/integration/s4hana/S4HttpUtils');
const { assertS4ConnectionConfig } = require('../../srv/common/productionGuard');
const pkg = require('../../package.json');

/** cds.requires as the production profile resolves it: base entry overlaid with its [production] block. */
function productionRequires() {
  const out = {};
  for (const [name, entry] of Object.entries(pkg.cds.requires || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const base = Object.fromEntries(Object.entries(entry).filter(([k]) => !k.startsWith('[')));
    out[name] = { ...base, ...(entry['[production]'] || {}) };
  }
  return out;
}

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  VCAP_SERVICES: JSON.stringify({ destination: [{ name: 'destination-service' }] }),
  S4_DESTINATION_NAME: 'S4_TEST_DESTINATION',
  S4_RFC_DESTINATION_NAME: 'S4_TEST_RFC_DESTINATION'
};

function productionClient(getDestination) {
  return new S4HttpClient({
    getDestination,
    executeHttpRequest: jest.fn(),
    env: PRODUCTION_ENV,
    cdsRequires: productionRequires
  });
}

describe('S/4HANA destination: no silent authentication downgrade in a deployed environment', () => {
  test('the production environment used by these tests passes the startup guard', () => {
    expect(() => assertS4ConnectionConfig(PRODUCTION_ENV)).not.toThrow();
  });

  test.each(['S4_DESTINATION_URL', 'S4_USERNAME', 'S4_PASSWORD', 'S4_CLIENT'])(
    'startup guard refuses %s in production, so the environment fallback cannot exist there',
    (name) => {
      expect(() => assertS4ConnectionConfig({ ...PRODUCTION_ENV, [name]: 'x' })).toThrow(/not allowed in production/);
    }
  );

  test('production profile of every remote service uses a destination reference, never a URL or credentials', () => {
    const requires = productionRequires();
    const remote = Object.entries(requires).filter(([, e]) => e.credentials && e.credentials.destination);
    expect(remote.map(([name]) => name)).toEqual(expect.arrayContaining(LOCAL_CREDENTIAL_SOURCES));
    for (const [, entry] of remote) {
      expect(entry.credentials).not.toHaveProperty('url');
      expect(entry.credentials).not.toHaveProperty('username');
      expect(entry.credentials).not.toHaveProperty('password');
    }
    for (const name of LOCAL_CREDENTIAL_SOURCES) {
      expect(requires[name].credentials.url).toBeUndefined();
    }
  });

  test.each([
    ['the lookup returns nothing', () => jest.fn().mockResolvedValue(null)],
    ['the lookup returns a destination without a URL', () => jest.fn().mockResolvedValue({ name: 'S4_TEST_DESTINATION' })]
  ])('when %s, no destination is resolved and no Basic credentials are substituted', async (_label, makeLookup) => {
    const getDestination = makeLookup();
    const client = productionClient(getDestination);

    await expect(client.resolveDestination()).resolves.toBeNull();
    await expect(client._requireDestination()).rejects.toMatchObject({ status: 502, code: DESTINATION_NOT_CONFIGURED });
    expect(getDestination).toHaveBeenCalledWith(expect.objectContaining({ destinationName: 'S4_TEST_DESTINATION' }));
  });

  test('a lookup that throws is classified as a lookup failure (503), not as "not configured"', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('destination service unavailable');
    const client = productionClient(jest.fn().mockRejectedValue(cause));

    await expect(client.resolveDestination()).rejects.toMatchObject({ status: 503, code: DESTINATION_LOOKUP_FAILED, cause });
    error.mockRestore();
  });

  test('a request is not sent to SAP when the destination lookup fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const executeHttpRequest = jest.fn();
    const client = new S4HttpClient({
      getDestination: jest.fn().mockRejectedValue(new Error('destination service unavailable')),
      executeHttpRequest,
      env: PRODUCTION_ENV,
      cdsRequires: productionRequires
    });

    await expect(client.get('/sap/opu/odata/sap/SOME_SRV/Entity')).rejects.toMatchObject({ code: DESTINATION_LOOKUP_FAILED });
    await expect(client.post('/sap/opu/odata/sap/SOME_SRV/Entity', { data: {} })).rejects.toMatchObject({ code: DESTINATION_LOOKUP_FAILED, status: 503 });
    expect(executeHttpRequest).not.toHaveBeenCalled();
    error.mockRestore();
  });

  test('even with local credentials present, production never falls back to them', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const leakyEnv = { ...PRODUCTION_ENV, S4_DESTINATION_URL: 'https://s4.example.corp:44300', S4_USERNAME: 'tech', S4_PASSWORD: 'p' };
    const localRequires = () => ({ MM_PUR_PO_MAINT_V2_SRV: { credentials: { url: 'https://s4.example.corp:44300/sap/opu', username: 'tech', password: 'p' } } });
    const make = (getDestination) => new S4HttpClient({ getDestination, executeHttpRequest: jest.fn(), env: leakyEnv, cdsRequires: localRequires });

    await expect(make(jest.fn().mockRejectedValue(new Error('down'))).resolveDestination()).rejects.toMatchObject({ code: DESTINATION_LOOKUP_FAILED });
    await expect(make(jest.fn().mockResolvedValue(null)).resolveDestination()).resolves.toBeNull();
    error.mockRestore();
  });

  describe('Principal Propagation', () => {
    const PP_DEST = { url: 'https://s4.example.corp:44300', authentication: 'PrincipalPropagation', proxyType: 'OnPremise', sapClient: '220' };

    test('the caller JWT reaches the lookup, the CSRF probe and the write', async () => {
      const getDestination = jest.fn().mockResolvedValue(PP_DEST);
      const executeHttpRequest = jest.fn()
        .mockResolvedValueOnce({ status: 200, data: {}, headers: { 'x-csrf-token': 'T' } })
        .mockResolvedValueOnce({ status: 201, data: {}, headers: {} });
      const client = new S4HttpClient({ getDestination, executeHttpRequest, env: PRODUCTION_ENV, cdsRequires: productionRequires });

      await client.post('/sap/opu/odata/sap/SOME_SRV/Entity', { data: {}, userJwt: 'caller.jwt.value' });

      expect(getDestination).toHaveBeenCalledWith(expect.objectContaining({ userJwt: 'caller.jwt.value' }));
      expect(executeHttpRequest.mock.calls.map((call) => call[2].userJwt)).toEqual(['caller.jwt.value', 'caller.jwt.value']);
      expect(executeHttpRequest.mock.calls.every((call) => call[0] === PP_DEST)).toBe(true);
    });

    test('the destination is used as resolved: no Authorization header or Basic credentials are added', async () => {
      const executeHttpRequest = jest.fn().mockResolvedValue({ status: 200, data: {}, headers: {} });
      const client = new S4HttpClient({ getDestination: jest.fn().mockResolvedValue(PP_DEST), executeHttpRequest, env: PRODUCTION_ENV, cdsRequires: productionRequires });

      await client.get('/sap/opu/odata/sap/SOME_SRV/Entity', { userJwt: 'caller.jwt.value', headers: { Authorization: 'Basic c2hvdWxkOm5vdA==' } });

      const [destination, config] = executeHttpRequest.mock.calls[0];
      expect(destination).not.toHaveProperty('username');
      expect(destination).not.toHaveProperty('password');
      expect(Object.keys(config.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    });

    test('a failed token exchange for the caller is a lookup failure; the shared technical user is not used instead', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const getDestination = jest.fn().mockRejectedValue(new Error('token exchange failed'));
      const executeHttpRequest = jest.fn();
      const client = new S4HttpClient({ getDestination, executeHttpRequest, env: PRODUCTION_ENV, cdsRequires: productionRequires });

      await expect(client.post('/sap/opu/odata/sap/SOME_SRV/Entity', { data: {}, userJwt: 'caller.jwt.value' }))
        .rejects.toMatchObject({ code: DESTINATION_LOOKUP_FAILED, status: 503 });
      expect(getDestination).toHaveBeenCalledWith(expect.objectContaining({ userJwt: 'caller.jwt.value' }));
      expect(executeHttpRequest).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  // Known behaviour outside production, recorded so that a change to it is deliberate.
  test('outside production, a failed lookup does fall back to the local Basic configuration', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new S4HttpClient({
      getDestination: jest.fn().mockRejectedValue(new Error('no destination service binding')),
      executeHttpRequest: jest.fn(),
      env: { NODE_ENV: 'development', S4_DESTINATION_NAME: 'S4_TEST_DESTINATION', S4_DESTINATION_URL: 'https://s4.example.corp:44300', S4_USERNAME: 'u', S4_PASSWORD: 'p', S4_CLIENT: '100' },
      cdsRequires: () => ({})
    });

    await expect(client.resolveDestination()).resolves.toMatchObject({ authentication: 'BasicAuthentication', url: 'https://s4.example.corp:44300' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using local configuration'));
    warn.mockRestore();
  });
});
