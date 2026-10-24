'use strict';

const { validateNonProdSap } = require('../../../tools/validate-sap-sandbox');

describe('Release Automation: Non-Production SAP Validation Stage Unit Tests', () => {
  const origEnv = process.env;
  let _exitSpy;
  let logSpy;
  let errSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
    _exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit: ${code}`);
    });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = origEnv;
    jest.restoreAllMocks();
  });

  it('fails closed (exit 1) if NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(validateNonProdSap()).rejects.toThrow('process.exit: 1');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Target is marked as production. Non-production validation is strictly forbidden in production.')
    );
  });

  it('fails closed (exit 1) if SAP_SYSTEM_TYPE=prod', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SAP_SYSTEM_TYPE = 'prod';
    await expect(validateNonProdSap()).rejects.toThrow('process.exit: 1');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Target is marked as production. Non-production validation is strictly forbidden in production.')
    );
  });

  it('skips safely (exit 0) when ALLOW_LIVE_SAP_TOOLS is not enabled', async () => {
    delete process.env.ALLOW_LIVE_SAP_TOOLS;
    delete process.env.RUN_LIVE_SAP;
    const origArgv = process.argv;
    process.argv = ['node', 'validate-sap-sandbox.js'];

    await expect(validateNonProdSap()).rejects.toThrow('process.exit: 0');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('SKIPPED: Non-production SAP validation stage is gated.')
    );

    process.argv = origArgv;
  });
});
