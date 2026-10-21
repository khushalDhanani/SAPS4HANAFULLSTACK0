'use strict';

const requireLiveSapTool = require('../../tools/live-sap-gate');

describe('live SAP tool opt-in gate', () => {
  const originalEnv = process.env.ALLOW_LIVE_SAP_TOOLS;
  const originalArgv = process.argv;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ALLOW_LIVE_SAP_TOOLS;
    else process.env.ALLOW_LIVE_SAP_TOOLS = originalEnv;
    process.argv = originalArgv;
  });

  test('blocks unless both the environment opt-in and explicit command-line flag are present', () => {
    process.env.ALLOW_LIVE_SAP_TOOLS = '1';
    process.argv = ['node', 'tool.js'];
    expect(() => requireLiveSapTool()).toThrow(/requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap/);
  });

  test('consumes the explicit opt-in flag before the script parses its own arguments', () => {
    process.env.ALLOW_LIVE_SAP_TOOLS = '1';
    process.argv = ['node', 'tool.js', '--allow-live-sap', '--read-only'];
    requireLiveSapTool();
    expect(process.argv).toEqual(['node', 'tool.js', '--read-only']);
  });
});
