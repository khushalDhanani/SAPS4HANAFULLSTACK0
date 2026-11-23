'use strict';

/**
 * RfcClient timeout and connection lifecycle for transactional calls. node-rfc is replaced by a fake.
 * A JavaScript timeout does not cancel the function module in SAP, so a call that was sent and timed out
 * must never look like "not sent" (503): it is 504 / RFC_TIMEOUT / timedOut.
 */

const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

const ENV = { S4_DESTINATION_URL: 'https://sap.local:44300', S4_RFC_SYSNR: '00', S4_CLIENT: '100', S4_USERNAME: 'U', S4_PASSWORD: 'P' };
const never = () => new Promise(() => {});
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

function direct(client, env = {}) {
  return new RfcClient({ ...ENV, S4_RFC_TIMEOUT_MS: '30', ...env }, () => ({ Client: jest.fn(() => client) }));
}
function pooled(pool, env = {}) {
  return new RfcClient({ ...ENV, S4_RFC_TIMEOUT_MS: '30', S4_RFC_POOL_ENABLED: 'true', ...env }, () => ({ Client: jest.fn(), Pool: jest.fn(() => pool) }));
}
const fakeClient = (call) => ({ open: jest.fn(async () => {}), call: jest.fn(call), close: jest.fn(async () => {}) });

describe('RfcClient: a timeout of a call that was sent', () => {
  test('is reported as 504 RFC_TIMEOUT, not as 503 "never reached"', async () => {
    const client = fakeClient(never);

    const err = await direct(client).call('BAPI_X').catch((e) => e);

    expect(err).toMatchObject({ status: 504, code: 'RFC_TIMEOUT', timedOut: true, message: expect.stringMatching(/BAPI_X timed out after 30ms/) });
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('while the COMMIT is waiting, after the BAPI answered, is reported as 504', async () => {
    const client = fakeClient((fm) => (fm === 'BAPI_TRANSACTION_COMMIT' ? never() : Promise.resolve({ RETURN: [] })));

    const err = await direct(client).session(async (call) => {
      await call('BAPI_DO_IT', {});
      await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    }).catch((e) => e);

    // Either the COMMIT's own timer or the session timer fires first; both mean "sent, outcome unknown".
    expect(err).toMatchObject({ status: 504, code: 'RFC_TIMEOUT', timedOut: true, message: expect.stringMatching(/timed out after 30ms/) });
    expect(client.call.mock.calls.map(([fm]) => fm)).toEqual(['BAPI_DO_IT', 'BAPI_TRANSACTION_COMMIT']);
  });

  test('a slow session whose calls were sent times out as 504', async () => {
    const client = fakeClient(() => later(20, { RETURN: [] }));

    const err = await direct(client).session(async (call) => {
      await call('STEP_1');
      await call('STEP_2');
      await call('STEP_3');
    }).catch((e) => e);

    expect(err).toMatchObject({ status: 504, timedOut: true });
  });

  test('a late answer of a timed-out call is ignored and does not throw', async () => {
    const client = fakeClient(() => later(60, { RETURN: [] }));

    await expect(direct(client).call('SLOW_FM')).rejects.toMatchObject({ status: 504 });
    await later(80);

    expect(client.close).toHaveBeenCalledTimes(1);
  });
});

describe('RfcClient: a timeout before anything was sent stays 503', () => {
  test('connection open', async () => {
    const client = { open: jest.fn(never), call: jest.fn(), close: jest.fn(async () => {}) };

    const err = await direct(client).call('BAPI_X').catch((e) => e);

    expect(err).toMatchObject({ status: 503, message: expect.stringMatching(/connection open timed out/) });
    expect(err.timedOut).toBeUndefined();
    expect(client.call).not.toHaveBeenCalled();
  });

  test('pool acquire', async () => {
    const pool = { acquire: jest.fn(never), release: jest.fn(), closeAll: jest.fn() };

    const err = await pooled(pool).call('BAPI_X').catch((e) => e);

    expect(err).toMatchObject({ status: 503, message: expect.stringMatching(/pool acquire timed out/) });
    expect(err.timedOut).toBeUndefined();
  });

  test('a session that times out before its first call', async () => {
    const client = fakeClient(async () => ({}));

    const err = await direct(client).session(never).catch((e) => e);

    expect(err).toMatchObject({ status: 503 });
    expect(err.timedOut).toBeUndefined();
    expect(client.call).not.toHaveBeenCalled();
  });

  test('waiting for a free slot', async () => {
    const client = fakeClient(() => later(200, {}));
    const rfc = direct(client, { S4_RFC_MAX_CONCURRENT: '1', S4_RFC_TIMEOUT_MS: '40' });

    const running = rfc.call('LONG_FM').catch((e) => e);
    const queued = await rfc.call('QUEUED_FM').catch((e) => e);

    expect(queued).toMatchObject({ status: 503, message: expect.stringMatching(/wait queue timed out/) });
    expect(client.call).toHaveBeenCalledTimes(1);
    await running;
  });
});

describe('RfcClient: connection pool after a failure', () => {
  test('a timed-out connection is closed and never returned to the pool', async () => {
    const client = { call: jest.fn(never), close: jest.fn(async () => {}) };
    const pool = { acquire: jest.fn(async () => client), release: jest.fn(async () => {}), closeAll: jest.fn(async () => {}) };

    await expect(pooled(pool).call('BAPI_X')).rejects.toMatchObject({ status: 504 });

    expect(pool.release).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('the next call after a timeout gets a different connection and works', async () => {
    const stuck = { call: jest.fn(never), close: jest.fn(async () => {}) };
    const healthy = { call: jest.fn(async () => ({ OK: true })), close: jest.fn(async () => {}) };
    const pool = { acquire: jest.fn().mockResolvedValueOnce(stuck).mockResolvedValueOnce(healthy), release: jest.fn(async () => {}), closeAll: jest.fn(async () => {}) };
    const rfc = pooled(pool);

    await expect(rfc.call('BAPI_X')).rejects.toMatchObject({ status: 504 });
    await expect(rfc.call('BAPI_Y')).resolves.toEqual({ OK: true });

    expect(pool.release).toHaveBeenCalledTimes(1);
    expect(pool.release).toHaveBeenCalledWith(healthy);
  });

  test('a timeout frees the concurrency slot for the next caller', async () => {
    const client = fakeClient((fm) => (fm === 'STUCK' ? never() : Promise.resolve({ OK: true })));
    const rfc = direct(client, { S4_RFC_MAX_CONCURRENT: '1' });

    await expect(rfc.call('STUCK')).rejects.toMatchObject({ status: 504 });
    await expect(rfc.call('FINE')).resolves.toEqual({ OK: true });
  });

  test('a failed close of a faulted connection does not hide the original error', async () => {
    const client = { open: jest.fn(async () => {}), call: jest.fn(never), close: jest.fn(async () => { throw new Error('close failed'); }) };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(direct(client).call('BAPI_X')).rejects.toMatchObject({ status: 504, code: 'RFC_TIMEOUT' });
    warn.mockRestore();
  });
});
