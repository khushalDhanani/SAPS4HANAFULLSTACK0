'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scripts } = require('../../../package.json');

// Runs the real check:mbt script text against a stand-in mbt, so the guard itself is what is tested.
function runCheck(fakeMbtBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbt-guard-'));
  fs.writeFileSync(path.join(dir, 'mbt'), `#!/bin/sh\n${fakeMbtBody}\n`, { mode: 0o755 });
  try {
    return spawnSync('sh', ['-c', scripts['check:mbt']], { env: { PATH: `${dir}:/usr/bin:/bin` }, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('MTA build tool guard', () => {
  test('fails with a message when mbt prints nothing, as the npm launcher does without its binary', () => {
    const result = runCheck('exit 0');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/mbt binary is missing/);
  });

  test('passes when mbt reports a version', () => {
    expect(runCheck('echo "Cloud MTA Build Tool version 1.2.49"').status).toBe(0);
  });

  test('both MTA scripts run the guard first', () => {
    expect(scripts['validate:mta']).toMatch(/^npm run -s check:mbt && mbt validate/);
    expect(scripts['build:mta']).toMatch(/^npm run -s check:mbt && mbt build/);
  });
});
