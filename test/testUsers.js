'use strict';

/**
 * Test-only identities for permission tests (a Viewer may not write, a clerk may not act on another plant).
 * They are not in package.json: Jest and the isolated E2E server load them through CDS_CONFIG. A development server
 * for test/e2e/negative/verifyPlantIsolation.e2e.js and test/e2e/le/verifyLeScreens.e2e.js needs that variable too:
 *   CDS_CONFIG="$(node -p "require('./test/testUsers').cdsConfig")" npx cds-serve
 */
const USERS = {
  'test-viewer-1120': { roles: ['Viewer'], attr: { Plant: ['1120'] } },
  'test-clerk-1130': { roles: ['Viewer', 'WarehouseClerk'], attr: { Plant: ['1130'] } },
  'test-viewer-noplant': { roles: ['Viewer'] },
  'test-clerk-1120': { roles: ['Viewer', 'WarehouseClerk'], attr: { Plant: ['1120'] } },
  'test-clerk-noplant': { roles: ['Viewer', 'WarehouseClerk'] },
  'test-sales-1120': { roles: ['Viewer', 'SalesRepresentative'], attr: { Plant: ['1120'] } }
};

module.exports = { USERS, cdsConfig: JSON.stringify({ requires: { auth: { users: USERS } } }) };
