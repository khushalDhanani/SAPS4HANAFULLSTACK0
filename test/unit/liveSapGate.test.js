'use strict';

const { shouldRunLiveSapTests } = require('../liveSapGate');

describe('explicit live SAP test gate [MOCK]', () => {
  test.each([
    [{}, false],
    [{ RUN_LIVE_SAP: '1' }, false],
    [{ SAP_SYSTEM_TYPE: 'dev' }, false],
    [{ RUN_LIVE_SAP: 'true', SAP_SYSTEM_TYPE: 'dev' }, false],
    [{ RUN_LIVE_SAP: '1', SAP_SYSTEM_TYPE: '' }, false],
    [{ RUN_LIVE_SAP: '1', SAP_SYSTEM_TYPE: 'prod' }, false],
    [{ RUN_LIVE_SAP: '1', SAP_SYSTEM_TYPE: ' PROD ' }, false],
    [{ RUN_LIVE_SAP: '1', SAP_SYSTEM_TYPE: 'dev' }, true],
    [{ RUN_LIVE_SAP: '1', SAP_SYSTEM_TYPE: 'sandbox' }, true],
    [{ RUN_LIVE_SAP: '1', SAP_SYSTEM_TYPE: 'dev', JEST_WORKER_ID: '1' }, false]
  ])('evaluates %j as %s', (env, expected) => {
    expect(shouldRunLiveSapTests(env)).toBe(expected);
  });
});
