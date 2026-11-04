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

  test('blocks when the command-line flag is missing', () => {
    process.env.ALLOW_LIVE_SAP_TOOLS = '1';
    process.argv = ['node', 'tool.js'];
    expect(() => requireLiveSapTool()).toThrow(/requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap/);
  });

  test('blocks when the environment opt-in is missing, and leaves the flag in place', () => {
    delete process.env.ALLOW_LIVE_SAP_TOOLS;
    process.argv = ['node', 'tool.js', '--allow-live-sap'];
    expect(() => requireLiveSapTool()).toThrow(/requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap/);
    expect(process.argv).toEqual(['node', 'tool.js', '--allow-live-sap']);
  });

  test('consumes the explicit opt-in flag before the script parses its own arguments', () => {
    process.env.ALLOW_LIVE_SAP_TOOLS = '1';
    process.argv = ['node', 'tool.js', '--allow-live-sap', '--read-only'];
    requireLiveSapTool();
    expect(process.argv).toEqual(['node', 'tool.js', '--read-only']);
  });

  test('a second call in the same process blocks, because the first one consumed the flag', () => {
    process.env.ALLOW_LIVE_SAP_TOOLS = '1';
    process.argv = ['node', 'tool.js', '--allow-live-sap'];
    requireLiveSapTool();
    expect(() => requireLiveSapTool()).toThrow(/requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap/);
  });

  // Because of the test above a tool must reference the gate once. Static scan: running the tools here would need SAP.
  test('no tool references the gate more than once', () => {
    const fs = require('fs');
    const path = require('path');
    const toolsDir = path.join(__dirname, '../../tools');
    const repeated = fs.readdirSync(toolsDir)
      .filter((f) => f.endsWith('.js') && f !== 'live-sap-gate.js')
      .filter((f) => (fs.readFileSync(path.join(toolsDir, f), 'utf8').match(/require\(\s*['"]\.\/live-sap-gate(?:\.js)?['"]\s*\)/g) || []).length > 1);
    expect(repeated).toEqual([]);
  });
});
