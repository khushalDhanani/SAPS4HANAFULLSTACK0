'use strict';

const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

const noLoader = () => { throw Object.assign(new Error('not loaded in test'), { code: 'MODULE_NOT_FOUND' }); };
const dest = (originalProperties) => jest.fn(async () => ({ originalProperties }));
const fullProps = { 'jco.client.ashost': 'sap.internal', 'jco.client.sysnr': '00', 'jco.client.client': '220', 'jco.client.user': 'TECH', 'jco.client.passwd': 'secret' };

describe('RfcClient.resolveConnectionParams — BTP RFC destination first, local env only outside production', () => {
  test('maps the RFC destination properties and caches them per instance', async () => {
    const getDestination = dest(fullProps);
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC', NODE_ENV: 'production' }, noLoader, getDestination);
    await expect(rfc.resolveConnectionParams()).resolves.toEqual({ ashost: 'sap.internal', sysnr: '00', client: '220', user: 'TECH', passwd: 'secret', lang: 'EN', trace: '0' });
    await rfc.resolveConnectionParams();
    expect(getDestination).toHaveBeenCalledTimes(1);
    expect(getDestination).toHaveBeenCalledWith({ destinationName: 'S4_RFC' });
  });

  test('fails closed when the destination lacks RFC properties, naming the missing ones and never the password', async () => {
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC' }, noLoader, dest({ URL: 'https://x', Name: 'S4_RFC' }));
    await expect(rfc.resolveConnectionParams()).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/lacks jco\.client\.ashost, jco\.client\.sysnr.*properties present: URL, Name/) });
  });

  test('in development: falls back to local env when destination lacks RFC properties but local env is fully configured', async () => {
    const localEnv = {
      S4_RFC_DESTINATION_NAME: 'S4_RFC',
      NODE_ENV: 'development',
      S4_DESTINATION_URL: 'https://sap.local:44300',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '100',
      S4_USERNAME: 'U',
      S4_PASSWORD: 'P'
    };
    const rfc = new RfcClient(localEnv, noLoader, dest({ URL: 'https://x', Name: 'S4_RFC' }));
    await expect(rfc.resolveConnectionParams()).resolves.toMatchObject({ ashost: 'sap.local', client: '100', sysnr: '00' });
  });

  test('in production: refuses to fall back to local env even if local env keys exist', async () => {
    const localEnv = {
      S4_RFC_DESTINATION_NAME: 'S4_RFC',
      NODE_ENV: 'production',
      S4_DESTINATION_URL: 'https://sap.local:44300',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '100',
      S4_USERNAME: 'U',
      S4_PASSWORD: 'P'
    };
    const rfc = new RfcClient(localEnv, noLoader, dest({ URL: 'https://x', Name: 'S4_RFC' }));
    await expect(rfc.resolveConnectionParams()).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/lacks jco\.client\.ashost/) });
  });

  test('destination lookup error and missing destination are 503 with the destination name', async () => {
    await expect(new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC' }, noLoader, jest.fn(async () => { throw new Error('no binding'); })).resolveConnectionParams())
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("'S4_RFC' could not be read") });
    await expect(new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC' }, noLoader, jest.fn(async () => null)).resolveConnectionParams())
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("'S4_RFC' not found") });
  });

  test('without a destination name: local env in development, refused in production', async () => {
    const env = { S4_DESTINATION_URL: 'https://sap.local:44300', S4_RFC_SYSNR: '00', S4_CLIENT: '100', S4_USERNAME: 'U', S4_PASSWORD: 'P' };
    await expect(new RfcClient(env, noLoader).resolveConnectionParams()).resolves.toMatchObject({ ashost: 'sap.local', client: '100' });
    await expect(new RfcClient({ ...env, NODE_ENV: 'production' }, noLoader).resolveConnectionParams())
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('S4_RFC_DESTINATION_NAME') });
  });

  test('resolves message server / logon group destination properties', async () => {
    const msProps = {
      'jco.client.mshost': 'ms.corp.sap',
      'jco.client.r3name': 'PRD',
      'jco.client.group': 'PUBLIC',
      'jco.client.client': '100',
      'jco.client.user': 'RFC_USER',
      'jco.client.passwd': 'secret',
      'jco.client.msserv': '3600'
    };
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_MS_RFC' }, noLoader, dest(msProps));
    await expect(rfc.resolveConnectionParams()).resolves.toEqual({
      mshost: 'ms.corp.sap',
      r3name: 'PRD',
      group: 'PUBLIC',
      client: '100',
      user: 'RFC_USER',
      passwd: 'secret',
      msserv: '3600',
      lang: 'EN',
      trace: '0'
    });
  });

  test('resolves destination properties configured with direct alias names without jco.client prefix', async () => {
    const aliasProps = {
      ashost: 's4app.corp.internal',
      sysnr: '02',
      client: '200',
      username: 'APP_USER',
      password: 'vaultPassword',
      pool_capacity: '10',
      peak_limit: '20'
    };
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_ALIAS' }, noLoader, dest(aliasProps));
    await expect(rfc.resolveConnectionParams()).resolves.toMatchObject({
      ashost: 's4app.corp.internal',
      sysnr: '02',
      client: '200',
      user: 'APP_USER',
      passwd: 'vaultPassword',
      pool_capacity: '10',
      peak_limit: '20'
    });
  });

  test('resolves optional gateway parameters when configured in BTP destination', async () => {
    const gwProps = {
      ...fullProps,
      'jco.client.gwhost': 'gw.corp.internal',
      'jco.client.gwserv': 'sapgw00'
    };
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_GW' }, noLoader, dest(gwProps));
    await expect(rfc.resolveConnectionParams()).resolves.toMatchObject({
      ashost: 'sap.internal',
      gwhost: 'gw.corp.internal',
      gwserv: 'sapgw00'
    });
  });
});

describe('RfcClient concurrency limits and queueing', () => {
  test('throttles concurrent sessions to maxConcurrent and processes queued calls as capacity frees', async () => {
    let active = 0;
    let maxObservedActive = 0;
    const makeMockClient = () => ({
      open: jest.fn(async () => {
        active++;
        maxObservedActive = Math.max(maxObservedActive, active);
      }),
      call: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true };
      }),
      close: jest.fn(async () => {
        active--;
      })
    });

    const loader = () => ({ Client: jest.fn(() => makeMockClient()) });
    const rfc = new RfcClient({
      S4_DESTINATION_URL: 'https://sap.local:44300',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '100',
      S4_USERNAME: 'U',
      S4_PASSWORD: 'P',
      S4_RFC_MAX_CONCURRENT: '2',
      S4_RFC_TIMEOUT_MS: '2000'
    }, loader);

    const results = await Promise.all([
      rfc.call('FM1'),
      rfc.call('FM2'),
      rfc.call('FM3'),
      rfc.call('FM4')
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
    expect(maxObservedActive).toBeLessThanOrEqual(2);
    expect(active).toBe(0);
  });

  test('queue wait times out with 503 if concurrency slots do not free up in time', async () => {
    const makeHangingClient = () => ({
      open: jest.fn(async () => {}),
      call: jest.fn(() => new Promise(() => {})), // never resolves
      close: jest.fn(async () => {})
    });

    const loader = () => ({ Client: jest.fn(() => makeHangingClient()) });
    const rfc = new RfcClient({
      S4_DESTINATION_URL: 'https://sap.local:44300',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '100',
      S4_USERNAME: 'U',
      S4_PASSWORD: 'P',
      S4_RFC_MAX_CONCURRENT: '1',
      S4_RFC_TIMEOUT_MS: '50'
    }, loader);

    // First call consumes the only slot
    const p1 = rfc.call('HANG1');
    // Second call is queued and times out waiting in queue
    const p2 = rfc.call('HANG2');

    await Promise.all([
      expect(p1).rejects.toMatchObject({ status: 504, message: expect.stringMatching(/timed out/) }), // sent, no answer
      expect(p2).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/concurrency limit reached|timed out/) })
    ]);
  });
});

describe('RfcClient timeout protection and lifecycle', () => {
  test('aborts hanging call with a 504 timeout and forcefully closes client connection', async () => {
    const mockClient = {
      open: jest.fn(async () => {}),
      call: jest.fn(() => new Promise((resolve) => setTimeout(resolve, 200))),
      close: jest.fn(async () => {})
    };
    const loader = () => ({ Client: jest.fn(() => mockClient) });
    const rfc = new RfcClient({
      S4_DESTINATION_URL: 'https://sap.local:44300',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '100',
      S4_USERNAME: 'U',
      S4_PASSWORD: 'P',
      S4_RFC_TIMEOUT_MS: '30'
    }, loader);

    await expect(rfc.call('HANGING_FM')).rejects.toMatchObject({
      status: 504,
      message: expect.stringMatching(/RFC call to HANGING_FM timed out after 30ms/)
    });
    expect(mockClient.close).toHaveBeenCalledTimes(1);
  });

  test('connection pooling: acquires from Pool, releases on success, and disposes on error', async () => {
    const fakeClient = {
      call: jest.fn().mockResolvedValue({ SUCCESS: true }),
      close: jest.fn().mockResolvedValue()
    };
    const mockPool = {
      acquire: jest.fn().mockResolvedValue(fakeClient),
      release: jest.fn().mockResolvedValue(),
      closeAll: jest.fn().mockResolvedValue()
    };
    const loader = () => ({
      Client: jest.fn(),
      Pool: jest.fn(() => mockPool)
    });

    const rfc = new RfcClient({
      S4_DESTINATION_URL: 'https://sap.local:44300',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '100',
      S4_USERNAME: 'U',
      S4_PASSWORD: 'P',
      S4_RFC_POOL_ENABLED: 'true'
    }, loader);

    const res = await rfc.call('TEST_FM');
    expect(res).toEqual({ SUCCESS: true });
    expect(mockPool.acquire).toHaveBeenCalledTimes(1);
    expect(mockPool.release).toHaveBeenCalledWith(fakeClient);

    // On error, faulted client is closed rather than released back to pool
    fakeClient.call.mockRejectedValueOnce(new Error('SAP ABAP Dump'));
    await expect(rfc.call('TEST_FAIL')).rejects.toThrow('SAP ABAP Dump');
    expect(fakeClient.close).toHaveBeenCalledTimes(1);

    await rfc.close();
    expect(mockPool.closeAll).toHaveBeenCalledTimes(1);
  });
});

describe('RfcClient.readTable sorted paging', () => {
  test('requests GET_SORTED when capped reads need stable ROWSKIPS paging', async () => {
    const rfc = new RfcClient();
    jest.spyOn(rfc, 'call').mockResolvedValue({ DATA: [] });

    await rfc.readTable('USH02', ['BNAME'], ["MODDA >= '20261105'"], 500, 500, true);

    expect(rfc.call).toHaveBeenCalledWith('RFC_READ_TABLE', {
      QUERY_TABLE: 'USH02',
      DELIMITER: '|',
      FIELDS: [{ FIELDNAME: 'BNAME' }],
      OPTIONS: [{ TEXT: "MODDA >= '20261105'" }],
      ROWCOUNT: 500,
      GET_SORTED: 'X',
      ROWSKIPS: 500,
    });
  });
});
