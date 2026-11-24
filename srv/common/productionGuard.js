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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIN_LOCAL_AUTH_SECRET_BYTES = 32;
// Files in Git whose values everybody with the repository knows.
const EXAMPLE_ENV_FILES = ['.env.example', '.env.docker.example'];
// SHA-256 of the LOCAL_AUTH_SECRET values in those files, for images that do not contain the files
// (Dockerfile copies neither). test/unit/common/productionGuard.test.js fails when a file value is missing here.
const EXAMPLE_SECRET_DIGESTS = Object.freeze([
  'e3be996c5295cae7d937e6d03dd478f230b7db4ef7d8d06058f4b24f11790b8b'
]);

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

/** Every non-empty value assigned in the example env files that exist under rootDir. */
function exampleEnvValues(rootDir, fsImpl) {
  const values = new Set();
  for (const file of EXAMPLE_ENV_FILES) {
    let text;
    try { text = fsImpl.readFileSync(path.join(rootDir, file), 'utf8'); } catch (_) { continue; }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/.exec(line);
      const value = match ? match[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim() : '';
      if (value) values.add(value);
    }
  }
  return values;
}

/**
 * Asserts at startup that the signing secret of the local token issuer (srv/auth/localTokenUtil.js) is not one
 * that others know or can guess: whoever has it can sign a token for any user, without a password.
 *
 * Refused: a LOCAL_AUTH_SECRET under 32 bytes, and one equal to a value in .env.example or .env.docker.example.
 * Checked when the secret is set or ENABLE_DEV_TOKEN_ISSUER=true. Not checked under NODE_ENV=test (tests use
 * fixed secrets) or in production, where assertDevFlagsOff() already refuses any LOCAL_AUTH_SECRET.
 * The message never contains the secret.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{rootDir?: string, fsImpl?: object}} [options] - injectable for tests
 * @throws {ProductionGuardError}
 */
function assertLocalAuthSecret(env = process.env, { rootDir = path.resolve(__dirname, '../..'), fsImpl = fs } = {}) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'test' || nodeEnv === 'production') return;

  const secret = String(env.LOCAL_AUTH_SECRET || '').trim();
  const issuerOn = String(env.ENABLE_DEV_TOKEN_ISSUER || '').trim().toLowerCase() === 'true';
  if (!secret && !issuerOn) return;

  const howTo = 'Set LOCAL_AUTH_SECRET to a new random value, for example the output of: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';
  if (Buffer.byteLength(secret, 'utf8') < MIN_LOCAL_AUTH_SECRET_BYTES) {
    throw new ProductionGuardError(
      `Startup check failed: LOCAL_AUTH_SECRET must be at least ${MIN_LOCAL_AUTH_SECRET_BYTES} bytes. ${howTo}`
    );
  }
  const digest = crypto.createHash('sha256').update(secret).digest('hex');
  if (EXAMPLE_SECRET_DIGESTS.includes(digest) || exampleEnvValues(rootDir, fsImpl).has(secret)) {
    throw new ProductionGuardError(
      `Startup check failed: LOCAL_AUTH_SECRET is a value from ${EXAMPLE_ENV_FILES.join(' / ')}. ` +
      `Those files are in Git, so anyone with the repository could sign in as any user. ${howTo}`
    );
  }
}

module.exports = {
  assertDevFlagsOff,
  assertS4ConnectionConfig,
  assertLocalAuthSecret,
  ProductionGuardError,
  EXAMPLE_ENV_FILES,
  EXAMPLE_SECRET_DIGESTS
};
