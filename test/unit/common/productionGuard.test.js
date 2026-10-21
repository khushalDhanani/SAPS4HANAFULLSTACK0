'use strict';

const { assertDevFlagsOff, ProductionGuardError } = require('../../../srv/common/productionGuard');

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

    test('error message is an instance of ProductionGuardError', () => {
      try {
        assertDevFlagsOff({ NODE_ENV: 'production', ENABLE_DEV_TOKEN_ISSUER: 'true' });
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProductionGuardError);
        expect(e.name).toBe('ProductionGuardError');
      }
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

  // ─── Dependency injection / isolation ───────────────────────────────────

  describe('Env injection ensures isolation from process.env', () => {
    test('uses the injected env object, not process.env', () => {
      // process.env has no NODE_ENV=production, but injected env does
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      expect(() => assertDevFlagsOff({
        NODE_ENV: 'production',
        LOCAL_AUTH_SECRET: 'injected-secret'
      })).toThrow(ProductionGuardError);

      process.env.NODE_ENV = originalNodeEnv;
    });
  });
});
