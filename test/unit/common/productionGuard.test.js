'use strict';

const {
  assertDevFlagsOff, assertS4ConnectionConfig, assertLocalAuthSecret, ProductionGuardError,
  EXAMPLE_ENV_FILES, EXAMPLE_SECRET_DIGESTS
} = require('../../../srv/common/productionGuard');

describe('Unit: productionGuard — assertLocalAuthSecret() (signing secret of the local token issuer)', () => {
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '../../..');
  const GOOD = 'a-signing-secret-made-up-for-this-test-0123456789'; // not a real secret
  const noFiles = { readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } };
  const files = (content) => ({ readFileSync: (file) => { if (file in content) return content[file]; throw new Error('ENOENT'); } });
  /** LOCAL_AUTH_SECRET as written in a tracked example file; used only to compare, never printed. */
  const exampleSecret = (file) => (/^LOCAL_AUTH_SECRET=(.*)$/m.exec(fs.readFileSync(path.join(ROOT, file), 'utf8')) || [])[1].trim();
  const dev = (extra) => ({ NODE_ENV: 'development', ENABLE_DEV_TOKEN_ISSUER: 'true', ...extra });

  test('accepts a secret of 32 bytes or more that is in no example file', () => {
    expect(() => assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: GOOD }))).not.toThrow();
    expect(() => assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: 'x'.repeat(32) }), { fsImpl: noFiles })).not.toThrow();
  });

  test.each(EXAMPLE_ENV_FILES)('refuses the LOCAL_AUTH_SECRET printed in %s, with the example files present', (file) => {
    expect(() => assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: exampleSecret(file) })))
      .toThrow(/LOCAL_AUTH_SECRET is a value from \.env\.example/);
  });

  test.each(EXAMPLE_ENV_FILES)('refuses the LOCAL_AUTH_SECRET printed in %s inside an image without the example files', (file) => {
    const secret = exampleSecret(file);
    expect(EXAMPLE_SECRET_DIGESTS).toContain(crypto.createHash('sha256').update(secret).digest('hex'));
    expect(() => assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: `  ${secret}  ` }), { fsImpl: noFiles })).toThrow(ProductionGuardError);
  });

  test('refuses any other value of an example file, quoted or not, and never repeats the secret in the message', () => {
    const other = 'another-sample-value-from-an-example-file-0001';
    const fsImpl = files({ [path.join('/app', '.env.example')]: `# sample\nFOO=bar\nSOME_KEY="${other}"\n`, [path.join('/app', '.env.docker.example')]: 'A=1\n' });
    let message = '';
    try { assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: other }), { rootDir: '/app', fsImpl }); } catch (e) { message = e.message; }
    expect(message).toMatch(/is a value from/);
    expect(message).not.toContain(other);
    expect(() => assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: GOOD }), { rootDir: '/app', fsImpl })).not.toThrow();
  });

  test('refuses a secret under 32 bytes, also when only ENABLE_DEV_TOKEN_ISSUER is set', () => {
    expect(() => assertLocalAuthSecret(dev({ LOCAL_AUTH_SECRET: 'x'.repeat(31) }))).toThrow(/at least 32 bytes/);
    expect(() => assertLocalAuthSecret(dev({}))).toThrow(/at least 32 bytes/);
    expect(() => assertLocalAuthSecret({ NODE_ENV: 'staging', LOCAL_AUTH_SECRET: 'short' })).toThrow(/at least 32 bytes/);
    expect(() => assertLocalAuthSecret({ LOCAL_AUTH_SECRET: 'short' })).toThrow(/at least 32 bytes/);
  });

  test('is not applied without a secret and issuer, under NODE_ENV=test, or in production', () => {
    expect(() => assertLocalAuthSecret({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertLocalAuthSecret({ NODE_ENV: 'test', ENABLE_DEV_TOKEN_ISSUER: 'true', LOCAL_AUTH_SECRET: 'short' })).not.toThrow();
    expect(() => assertLocalAuthSecret({ NODE_ENV: 'test', LOCAL_AUTH_SECRET: exampleSecret('.env.example') })).not.toThrow();
    // production: assertDevFlagsOff refuses any LOCAL_AUTH_SECRET; this check adds nothing there
    expect(() => assertLocalAuthSecret({ NODE_ENV: 'production' })).not.toThrow();
    expect(() => assertDevFlagsOff({ NODE_ENV: 'production', LOCAL_AUTH_SECRET: GOOD })).toThrow(/LOCAL_AUTH_SECRET must not be set in production/);
  });
});

describe('Unit: productionGuard — assertDevFlagsOff()', () => {

  // ─── Non-production: guard is a no-op ───────────────────────────────────

  describe('Non-production environments — guard is a no-op', () => {
    test('does not throw when NODE_ENV=development regardless of dev flags', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'development',
        ENABLE_DEV_TOKEN_ISSUER: 'true',
        LOCAL_AUTH_SECRET: 'some-secret',
        WM_ALLOW_MISMATCHED_TR: 'true'
      })).not.toThrow();
    });

    test('does not throw when NODE_ENV=test', () => {
      expect(() => assertDevFlagsOff({ NODE_ENV: 'test', ENABLE_DEV_TOKEN_ISSUER: 'true' })).not.toThrow();
    });

    test('does not throw when NODE_ENV is absent', () => {
      expect(() => assertDevFlagsOff({ ENABLE_DEV_TOKEN_ISSUER: 'true' })).not.toThrow();
    });
  });

  describe('Production: mocked authentication is refused (Q4 guard)', () => {
    test.each(['mocked', 'dummy', 'basic'])('throws when NODE_ENV=production and auth.kind=%s', (kind) => {
      expect(() => assertDevFlagsOff({ NODE_ENV: 'production' }, { kind })).toThrow(/Authentication kind '.*' is not allowed in production/);
    });
    test('passes with xsuaa in production and ignores mocked auth outside production', () => {
      expect(() => assertDevFlagsOff({ NODE_ENV: 'production' }, { kind: 'xsuaa' })).not.toThrow();
      expect(() => assertDevFlagsOff({ NODE_ENV: 'development' }, { kind: 'mocked' })).not.toThrow();
    });
  });

  // ─── Production: clean env passes ───────────────────────────────────────

  describe('Production with clean env — passes', () => {
    test('does not throw when all dev flags are absent', () => {
      expect(() => assertDevFlagsOff({ NODE_ENV: 'production' })).not.toThrow();
    });

    test('does not throw when ENABLE_DEV_TOKEN_ISSUER=false', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        ENABLE_DEV_TOKEN_ISSUER: 'false'
      })).not.toThrow();
    });

    test('does not throw when LOCAL_AUTH_SECRET is empty string', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        LOCAL_AUTH_SECRET: ''
      })).not.toThrow();
    });

    test('does not throw when WM_ALLOW_MISMATCHED_TR=false', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        WM_ALLOW_MISMATCHED_TR: 'false'
      })).not.toThrow();
    });
  });

  // ─── ENABLE_DEV_TOKEN_ISSUER=true in production ──────────────────────────

  describe('ENABLE_DEV_TOKEN_ISSUER=true in production', () => {
    test('throws ProductionGuardError', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        ENABLE_DEV_TOKEN_ISSUER: 'true'
      })).toThrow(ProductionGuardError);
    });

    test('error message names the flag and the remediation', () => {
      const run = () => assertDevFlagsOff({ NODE_ENV: 'production', ENABLE_DEV_TOKEN_ISSUER: 'true' });
      expect(run).toThrow(/ENABLE_DEV_TOKEN_ISSUER/);
      expect(run).toThrow(/XSUAA/);
    });
  });

  // ─── LOCAL_AUTH_SECRET set in production ────────────────────────────────

  describe('LOCAL_AUTH_SECRET set in production', () => {
    test('throws ProductionGuardError when the secret is a non-empty string', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        LOCAL_AUTH_SECRET: 'my-super-secret-key'
      })).toThrow(ProductionGuardError);
    });

    test('error message names LOCAL_AUTH_SECRET and the remediation', () => {
      const run = () => assertDevFlagsOff({ NODE_ENV: 'production', LOCAL_AUTH_SECRET: 'x' });
      expect(run).toThrow(/LOCAL_AUTH_SECRET/);
      expect(run).toThrow(/XSUAA/);
    });

    test('does not throw when LOCAL_AUTH_SECRET is whitespace only', () => {
      // whitespace-only is treated as "not set" by the guard
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        LOCAL_AUTH_SECRET: '   '
      })).not.toThrow();
    });
  });

  // ─── WM_ALLOW_MISMATCHED_TR=true in production ──────────────────────────

  describe('WM_ALLOW_MISMATCHED_TR=true in production', () => {
    test('throws ProductionGuardError', () => {
      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        WM_ALLOW_MISMATCHED_TR: 'true'
      })).toThrow(ProductionGuardError);
    });

    test('error message names WM_ALLOW_MISMATCHED_TR', () => {
      const run = () => assertDevFlagsOff({ NODE_ENV: 'production', WM_ALLOW_MISMATCHED_TR: 'true' });
      expect(run).toThrow(/WM_ALLOW_MISMATCHED_TR/);
    });
  });

  // ─── Multiple violations reported together ───────────────────────────────

  describe('Multiple dev flags active in production', () => {
    test('reports all violations in a single error', () => {
      const run = () => assertDevFlagsOff({
        NODE_ENV: 'production',
        ENABLE_DEV_TOKEN_ISSUER: 'true',
        LOCAL_AUTH_SECRET: 'secret',
        WM_ALLOW_MISMATCHED_TR: 'true'
      });
      expect(run).toThrow(ProductionGuardError);
      try { run(); } catch (e) {
        expect(e.message).toMatch(/ENABLE_DEV_TOKEN_ISSUER/);
        expect(e.message).toMatch(/LOCAL_AUTH_SECRET/);
        expect(e.message).toMatch(/WM_ALLOW_MISMATCHED_TR/);
        // All three numbered items should be present
        expect(e.message).toMatch(/1\./);
        expect(e.message).toMatch(/2\./);
        expect(e.message).toMatch(/3\./);
      }
    });
  });

  describe('assertS4ConnectionConfig — S/4 connection comes from BTP destinations in production, from .env.local in development', () => {
    const vcapWithDestination = JSON.stringify({ destination: [{ name: 'dest', credentials: {} }] });
    test('test profile is not checked', () => {
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'test' })).not.toThrow();
    });
    test('production passes with a Destination binding and both destination names', () => {
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'production', VCAP_SERVICES: vcapWithDestination, S4_DESTINATION_NAME: 'S4', S4_RFC_DESTINATION_NAME: 'S4_RFC' })).not.toThrow();
    });
    test('production fails at startup without the binding or a destination name', () => {
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'production', S4_DESTINATION_NAME: 'S4', S4_RFC_DESTINATION_NAME: 'S4_RFC' })).toThrow(/VCAP_SERVICES\.destination/);
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'production', VCAP_SERVICES: vcapWithDestination, S4_DESTINATION_NAME: 'S4' })).toThrow(/S4_RFC_DESTINATION_NAME/);
    });
    test('production refuses credentials, URL or client in environment variables', () => {
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'production', VCAP_SERVICES: vcapWithDestination, S4_DESTINATION_NAME: 'S4', S4_RFC_DESTINATION_NAME: 'S4_RFC', S4_PASSWORD: 'x', S4_CLIENT: '220' }))
        .toThrow(/not allowed in production.*S4_CLIENT, S4_PASSWORD/s);
    });
    test('development requires S4_DESTINATION_URL and S4_CLIENT', () => {
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'development', S4_DESTINATION_URL: 'https://h:443', S4_CLIENT: '100' })).not.toThrow();
      expect(() => assertS4ConnectionConfig({ NODE_ENV: 'development', S4_DESTINATION_URL: 'https://h:443' })).toThrow(/missing: S4_CLIENT/);
      expect(() => assertS4ConnectionConfig({})).toThrow(/missing: S4_DESTINATION_URL, S4_CLIENT/);
    });
  });
});
