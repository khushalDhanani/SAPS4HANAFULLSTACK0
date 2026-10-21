'use strict';

/**
 * productionGuard.js
 *
 * Startup check: dev-only flags must be off in production.
 * Call assertDevFlagsOff() once before server bootstrap.
 *
 * Checked flags:
 *   ENABLE_DEV_TOKEN_ISSUER  – local JWT issuer, must be absent / 'false' in prod
 *   LOCAL_AUTH_SECRET        – JWT signing secret for local dev, must be absent in prod
 *   WM_ALLOW_MISMATCHED_TR   – sandbox-only WM override (also checked in wmMismatchOverrideGuard)
 */

class ProductionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductionGuardError';
  }
}

/**
 * Asserts that no development-only flags are active when NODE_ENV=production.
 *
 * @param {NodeJS.ProcessEnv} [env] - defaults to process.env; injectable for tests
 * @throws {ProductionGuardError} if a dev flag is found active in production
 */
function assertDevFlagsOff(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') return;

  const violations = [];

  if (String(env.ENABLE_DEV_TOKEN_ISSUER || '').trim().toLowerCase() === 'true') {
    violations.push(
      'ENABLE_DEV_TOKEN_ISSUER=true is not allowed in production. ' +
      'Remove it or set it to false. Use XSUAA for authentication in deployed environments.'
    );
  }

  if (env.LOCAL_AUTH_SECRET && env.LOCAL_AUTH_SECRET.trim() !== '') {
    violations.push(
      'LOCAL_AUTH_SECRET must not be set in production. ' +
      'It is a local dev JWT signing secret. Use XSUAA service bindings in deployed environments.'
    );
  }

  if (String(env.WM_ALLOW_MISMATCHED_TR || '').trim().toLowerCase() === 'true') {
    violations.push(
      'WM_ALLOW_MISMATCHED_TR=true is not allowed in production. ' +
      'This flag is for sandbox testing only.'
    );
  }

  if (violations.length > 0) {
    throw new ProductionGuardError(
      `Production startup check failed — dev flags detected:\n` +
      violations.map((v, i) => `  ${i + 1}. ${v}`).join('\n')
    );
  }
}

module.exports = { assertDevFlagsOff, ProductionGuardError };
