'use strict';

const { userFacingSapError, isSapInfrastructureError, USER_TEXT } = require('../../srv/common/sapErrorText');

describe('userFacingSapError: infrastructure details never reach the end user', () => {
  test.each([
    ['RFC connection not configured: set S4_RFC_SYSNR in .env.local', 503],
    ['node-rfc is not available (not installed). Install the SAP NW RFC SDK, then run: npm install node-rfc', 503],
    ['RFC_COMMUNICATION_FAILURE: partner not reached', undefined],
    ['connect ECONNREFUSED 10.0.0.1:3300', undefined],
    ['No credentials configured for "FAC_GL_JOURNALENTRY_VER_SRV".', 500]
  ])('replaces "%s"', (message, status) => {
    const err = Object.assign(new Error(message), status ? { status } : {});
    expect(isSapInfrastructureError(err)).toBe(true);
    const text = userFacingSapError(err, { id: 'req-42' }, 'warehouse determination');
    expect(text).toBe(`${USER_TEXT} (reference req-42).`);
    expect(text).not.toMatch(/S4_|\.env|node-rfc|RFC_|ECONNREFUSED|credentials/);
  });

  test.each([
    ['BAPI_RESERVATION_CREATE1 failed: Deficit of BA Unrestricted-use stock', 400],
    ['Cost Center 1011201301 is not valid on 20261019 (valid ranges: ...)', 400],
    ['Order 1011 is technically completed (status TECO / I0045)', 400]
  ])('keeps the business rejection "%s"', (message, status) => {
    const err = Object.assign(new Error(message), { status });
    expect(isSapInfrastructureError(err)).toBe(false);
    expect(userFacingSapError(err, { id: 'x' })).toBe(message);
  });

  test('uses err.error when the adapter set it, and works without a request', () => {
    expect(userFacingSapError({ status: 400, error: 'SAP said no', message: 'wrapped' })).toBe('SAP said no');
    expect(userFacingSapError({ status: 503, message: 'RFC connection not configured: set X' })).toBe(`${USER_TEXT}.`);
  });
});
