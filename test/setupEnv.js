// Tests must never inherit local SAP credentials, destinations, or VCAP-bound service keys.
// SAP_SYSTEM_TYPE is non-secret and is retained only so the explicit live-test gate can fail closed.
// Do not load .env.local or .env here: tests use explicit adapter/RFC mocks instead.
for (const key of Object.keys(process.env)) {
  if ((/^(?:S4_|CDS_S4_|SAP_|RFC_)/i.test(key) && key !== 'SAP_SYSTEM_TYPE') || key === 'VCAP_SERVICES') delete process.env[key];
}

// Keep only a harmless display label for auth/UI tests; no destination or login is configured.
process.env.S4_SYSTEM_NAME = 'S4HANA_TEST';
// Explicit non-credential configuration fixtures for unit tests. Production must supply these per environment.
process.env.S4_CLIENT = '220';
process.env.S4_PLANT = '1120';
process.env.S4_STORAGE_LOCATION = 'CS01';
process.env.S4_WAREHOUSE_NUMBER = 'W01';
process.env.ENABLE_DEV_TOKEN_ISSUER = process.env.ENABLE_DEV_TOKEN_ISSUER || 'true';
process.env.LOCAL_AUTH_SECRET = process.env.LOCAL_AUTH_SECRET || 'test-mock-secret-key-32-chars-long!';

require('./outboundNetworkGuard');
