'use strict';

/**
 * RFC runtime deployability guard.
 *
 * The SAP NW RFC SDK is proprietary and is not installed by the standard Node.js buildpack. Until mta.yaml
 * installs it (a supply buildpack) the RFC runtime is NOT proven deployable by `cf deploy` alone. These tests
 * keep that gap visible: they pin the documented routes, the certification tool and the startup warning, and
 * they must be revisited when the deployment route is decided.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const mta = read('mta.yaml');
const srvModule = mta.slice(mta.indexOf('- name: saps4hana-srv'), mta.indexOf('provides:', mta.indexOf('- name: saps4hana-srv')));

describe('RFC runtime: deployment state of mta.yaml', () => {
  const buildpacks = [...srvModule.matchAll(/^\s*(?:buildpack:\s*|-\s+)(\S*buildpack\S*)\s*$/gm)].map((m) => m[1]);
  const installsSdk = buildpacks.some((name) => !/^nodejs_buildpack$/.test(name));

  test('the service module either installs the SDK through a supply buildpack or documents both other routes', () => {
    if (installsSdk) return;
    // No SDK supply buildpack is active, so the documented routes and the proof document must exist.
    expect(buildpacks).toEqual(['nodejs_buildpack']);
    expect(fs.existsSync(path.join(root, 'docs/deployment/rfc-production-readiness.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'docs/deployment/cf-native-rfc-runtime-proof.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'docker/cap/Dockerfile'))).toBe(true);
    expect(mta).toMatch(/Note on RFC Production Readiness/);
  });

  test('the module tells the runtime where an installed SDK would be', () => {
    expect(srvModule).toMatch(/SAPNWRFC_HOME:\s*\S+/);
    expect(srvModule).toMatch(/LD_LIBRARY_PATH:\s*\S*nwrfcsdk\/lib/);
  });

  test('no SDK binary or archive is committed to the repository', () => {
    const tracked = require('child_process').execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => /libsapnwrfc|nwrfc\d*.*\.(zip|sar|tgz)$/i.test(f))).toEqual([]);
  });

  test('the certification tool for the deployed runtime is wired as an npm script', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['check:rfc-runtime']).toBe('node tools/verify-cf-rfc-runtime.js');
    expect(fs.existsSync(path.join(root, 'tools/verify-cf-rfc-runtime.js'))).toBe(true);
  });
});

describe('RFC runtime: a missing SDK is reported at startup and in the health report', () => {
  const { registerHealth } = require('../../../srv/common/health');
  const fakeApp = () => {
    const routes = {};
    return { routes, get: (route, handler) => { routes[route] = handler; } };
  };
  const call = async (handler) => {
    const res = { set: jest.fn(() => res), status: jest.fn((code) => { res.code = code; return res; }), json: jest.fn((body) => { res.body = body; return res; }) };
    await handler({ headers: {}, query: {} }, res);
    return res;
  };
  const checks = (rfcSdk) => ({ database: async () => 'UP', s4Destination: async () => 'CONFIGURED', rfcSdk: () => rfcSdk });

  test('warns once at startup when the SDK cannot be loaded', () => {
    const startupLog = { warn: jest.fn() };

    registerHealth(fakeApp(), { checks: checks('DOWN'), startupLog });

    expect(startupLog.warn).toHaveBeenCalledTimes(1);
    expect(startupLog.warn).toHaveBeenCalledWith(expect.stringContaining('RFC SDK'));
    expect(startupLog.warn).toHaveBeenCalledWith(expect.stringContaining('check:rfc-runtime'));
  });

  test('stays silent when the SDK loads', () => {
    const startupLog = { warn: jest.fn() };

    registerHealth(fakeApp(), { checks: checks('UP'), startupLog });

    expect(startupLog.warn).not.toHaveBeenCalled();
  });

  test('a missing SDK degrades the dependency report but does not take the instance out of service', async () => {
    const app = fakeApp();
    registerHealth(app, { checks: checks('DOWN'), startupLog: null });

    const ready = await call(app.routes['/health/ready']);
    const deps = await call(app.routes['/health/dependencies']);

    expect(ready.code).toBe(200);
    expect(deps.body).toMatchObject({ status: 'DEGRADED', dependencies: { rfcSdk: 'DOWN' } });
  });
});
