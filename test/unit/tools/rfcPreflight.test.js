'use strict';

const { rfcPreflight, classify } = require('../../../tools/rfc-preflight');

const failing = (err) => ({ readTable: jest.fn().mockRejectedValue(err) });
const env = { S4_CLIENT: '220' };

describe('RFC preflight classification [MOCK]', () => {
  test('ok: T000 row for the expected client', async () => {
    const rfc = { readTable: jest.fn().mockResolvedValue([{ MANDT: '220', MTEXT: 'DS4 220' }]) };
    await expect(rfcPreflight({ env, rfcClient: rfc })).resolves.toMatchObject({ ok: true, stage: 'ok', client: '220' });
    expect(rfc.readTable).toHaveBeenCalledWith('T000', ['MANDT', 'MTEXT'], ["MANDT = '220'"]);
  });

  test('client: connected but the client is not in T000', async () => {
    const rfc = { readTable: jest.fn().mockResolvedValue([]) };
    await expect(rfcPreflight({ env, rfcClient: rfc })).resolves.toMatchObject({ ok: false, stage: 'client' });
  });

  test('config: S4_CLIENT missing is reported before any RFC call', async () => {
    const rfc = { readTable: jest.fn() };
    await expect(rfcPreflight({ env: {}, rfcClient: rfc })).resolves.toMatchObject({ ok: false, stage: 'config' });
    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  test.each([
    ['sdk', new Error('node-rfc is not available (not installed). Install the SAP NW RFC SDK, then run: npm install node-rfc')],
    ['config', new Error('RFC connection not configured: set S4_PASSWORD in .env.local')],
    ['auth', Object.assign(new Error('Name or password is incorrect (repeat logon)'), { key: 'RFC_LOGON_FAILURE' })],
    ['network', Object.assign(new Error('partner \'host:3300\' not reached'), { key: 'RFC_COMMUNICATION_FAILURE' })],
    ['unknown', new Error('TABLE_WITHOUT_DATA')]
  ])('%s: classified from the thrown error', async (stage, err) => {
    await expect(rfcPreflight({ env, rfcClient: failing(err) })).resolves.toMatchObject({ ok: false, stage });
    expect(classify(err)).toBe(stage);
  });

  test('default client is never reachable under Jest (node-rfc is mocked)', async () => {
    const r = await rfcPreflight({ env: { ...env, S4_DESTINATION_URL: 'http://127.0.0.1:8000', S4_RFC_SYSNR: '00', S4_USERNAME: 'u', S4_PASSWORD: 'p' } });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Jest blocks node-rfc/);
  });
});
