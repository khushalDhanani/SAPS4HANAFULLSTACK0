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
 *   auth.kind                – mocked/dummy/basic authentication (dev profile) must not reach production
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
 * @param {{kind?: string}} [auth] - the effective cds.requires.auth config (optional)
 * @throws {ProductionGuardError} if a dev flag is found active in production
 */
function assertDevFlagsOff(env = process.env, auth) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') return;

  const violations = [];

  // Mocked users (with their Plant attributes) live under the [development] profile only; XSUAA is the production source.
  const authKind = String((auth && auth.kind) || '').trim().toLowerCase();
  if (authKind === 'mocked' || authKind === 'dummy' || authKind === 'basic') {
    violations.push(
      `Authentication kind '${authKind}' is not allowed in production. ` +
      'Mocked users and their Plant attributes are a [development] profile convenience; bind XSUAA in deployed environments.'
    );
  }

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

/**
 * Asserts that the S/4HANA connection is configured for the current profile, at startup:
 *   production  – Destination service binding (VCAP_SERVICES) + S4_DESTINATION_NAME + S4_RFC_DESTINATION_NAME;
 *                 no credentials, URL or client in environment variables (they come from the destinations)
 *   development – S4_DESTINATION_URL and S4_CLIENT (local .env.local)
 *   test        – not checked (tests mock SAP)
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @throws {ProductionGuardError}
 */
function assertS4ConnectionConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'test') return;
  const missing = [];
  const forbidden = [];
  if (nodeEnv === 'production') {
    let hasDestinationBinding = false;
    try { hasDestinationBinding = Boolean(JSON.parse(env.VCAP_SERVICES || '{}').destination); } catch (_) { hasDestinationBinding = false; }
    if (!hasDestinationBinding) missing.push('Destination service binding (VCAP_SERVICES.destination)');
    for (const k of ['S4_DESTINATION_NAME', 'S4_RFC_DESTINATION_NAME']) if (!String(env[k] || '').trim()) missing.push(k);
    for (const k of ['S4_DESTINATION_URL', 'S4_CLIENT', 'S4_USERNAME', 'S4_PASSWORD', 'S4_RFC_SYSNR']) if (String(env[k] || '').trim()) forbidden.push(k);
  } else {
    for (const k of ['S4_DESTINATION_URL', 'S4_CLIENT']) if (!String(env[k] || '').trim()) missing.push(k);
  }
  if (missing.length || forbidden.length) {
    throw new ProductionGuardError(
      `S/4HANA connection configuration check failed (NODE_ENV=${nodeEnv || '(unset)'}):` +
      (missing.length ? `\n  missing: ${missing.join(', ')}` : '') +
      (forbidden.length ? `\n  not allowed in production (use the BTP destinations instead): ${forbidden.join(', ')}` : '')
    );
  }
}

module.exports = { assertDevFlagsOff, assertS4ConnectionConfig, ProductionGuardError };
