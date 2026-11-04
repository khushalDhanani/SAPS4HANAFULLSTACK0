'use strict';

/**
 * The background re-check of unconfirmed posting attempts (261, HU stock transfer) runs from Mvt261Service,
 * so an attempt whose outcome SAP did not confirm still gets resolved. SAP is never reached: recheck is stubbed.
 */

const cds = require('@sap/cds');
const Mvt261Service = require('../../../srv/wm/mvt261/service');
const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const startService = async () => {
  const srv = Object.create(Mvt261Service.prototype);
  srv.on = jest.fn();
  srv.before = jest.fn();
  srv.after = jest.fn();
  await srv.init();
};

describe('Mvt261Service posting-attempt re-check timer', () => {
  const env = { NODE_ENV: process.env.NODE_ENV, interval: process.env.GI_ATTEMPT_RECHECK_INTERVAL_MS };
  let timer;
  let setIntervalSpy;
  let recheck;

  beforeEach(() => {
    jest.spyOn(cds.ApplicationService.prototype, 'init').mockResolvedValue();
    timer = { unref: jest.fn() };
    setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    recheck = jest.spyOn(attempts, 'recheck').mockResolvedValue({});
    delete process.env.GI_ATTEMPT_RECHECK_INTERVAL_MS;
  });

  afterEach(() => {
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.interval === undefined) delete process.env.GI_ATTEMPT_RECHECK_INTERVAL_MS;
    else process.env.GI_ATTEMPT_RECHECK_INTERVAL_MS = env.interval;
    jest.restoreAllMocks();
  });

  test('outside test mode it re-checks every 60000 ms through GoodsIssueAdapter', async () => {
    process.env.NODE_ENV = 'development';
    await startService();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(60000);
    expect(timer.unref).toHaveBeenCalledTimes(1);

    setIntervalSpy.mock.calls[0][0]();
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(recheck).toHaveBeenCalledWith(GoodsIssueAdapter);
  });

  test('a failed re-check does not reject out of the timer callback', async () => {
    process.env.NODE_ENV = 'development';
    recheck.mockRejectedValue(new Error('RFC down'));
    await startService();

    await expect(Promise.resolve(setIntervalSpy.mock.calls[0][0]())).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  test('it does not start under test mode', async () => {
    process.env.NODE_ENV = 'test';
    await startService();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  test('it does not start when the interval is 0', async () => {
    process.env.NODE_ENV = 'development';
    process.env.GI_ATTEMPT_RECHECK_INTERVAL_MS = '0';
    await startService();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
