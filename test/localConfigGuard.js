'use strict';

// Test-only preload shared by Jest and the SAP-free CAP child process.
// CAP 10 includes the development profile in test mode and otherwise imports .env again
// after setup has removed credentials. Intercept that file-to-process.env boundary.
// This internal CAP seam is version-sensitive: fail closed if its shape changes.
if (process.env.NODE_ENV !== 'test') {
  throw new Error('Local configuration guard requires NODE_ENV=test');
}
const config = require('@sap/cds/lib/env/cds-env');
if (typeof config._add_to_env !== 'function') {
  throw new Error('CAP environment loader changed; review test configuration isolation');
}
config._add_to_env = function ignoreLocalEnvironmentFiles() {};
