const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Frontend role evaluation (AuthUserHelper.hasAnyRole / canCreateDelivery).
 * It only decides what the UI shows; the CAP services enforce authorization themselves.
 */

function loadHelper() {
  let exported;
  const file = path.resolve(__dirname, '../../../app/fiori-app/webapp/service/AuthUserHelper.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { sap: { ui: { define: (_names, factory) => { exported = factory(); } } } });
  return exported;
}

describe('AuthUserHelper role evaluation', () => {
  const helper = loadHelper();
  const user = (...scopes) => ({ username: 'u', scopes });

  test('no user means no role', () => {
    expect(helper.hasAnyRole(null, ['Admin'])).toBe(false);
    expect(helper.hasAnyRole(undefined, [])).toBe(false);
    expect(helper.canCreateDelivery(null)).toBe(false);
  });

  test('a user without scopes has no role', () => {
    expect(helper.hasAnyRole({ username: 'u' }, ['Admin'])).toBe(false);
    expect(helper.hasAnyRole(user(), ['WarehouseClerk'])).toBe(false);
    expect(helper.canCreateDelivery(user())).toBe(false);
  });

  test('matches a role by exact name or as the last part of an XSUAA scope', () => {
    expect(helper.hasAnyRole(user('WarehouseClerk'), ['WarehouseClerk'])).toBe(true);
    expect(helper.hasAnyRole(user('saps4hana!t123.WarehouseClerk'), ['WarehouseClerk'])).toBe(true);
  });

  test('does not match a role that merely contains or ends with the name', () => {
    expect(helper.hasAnyRole(user('NotAdmin'), ['Admin'])).toBe(false);
    expect(helper.hasAnyRole(user('SuperWarehouseClerk'), ['WarehouseClerk'])).toBe(false);
    expect(helper.hasAnyRole(user('Admin.Viewer'), ['Admin'])).toBe(false);
    expect(helper.hasAnyRole(user('admin'), ['Admin'])).toBe(false);
  });

  test('Admin satisfies every role check', () => {
    expect(helper.hasAnyRole(user('Admin'), ['SapLogsReader'])).toBe(true);
    expect(helper.hasAnyRole(user('saps4hana!t123.Admin'), ['WarehouseManager'])).toBe(true);
  });

  test('ignores scope entries that are not strings', () => {
    expect(helper.hasAnyRole({ scopes: [null, 42, { name: 'Admin' }] }, ['Admin'])).toBe(false);
  });

  test('an empty or missing role list means "any signed-in user"', () => {
    expect(helper.hasAnyRole(user(), [])).toBe(true);
    expect(helper.hasAnyRole(user(), undefined)).toBe(true);
  });

  test.each(['SalesRepresentative', 'WarehouseClerk', 'WarehouseManager', 'SalesManager', 'Admin'])(
    '%s may create deliveries', (role) => {
      expect(helper.canCreateDelivery(user(role))).toBe(true);
    });

  test.each(['SapLogsReader', 'Viewer', 'PurchaseOrderCreator'])('%s may not create deliveries', (role) => {
    expect(helper.canCreateDelivery(user(role))).toBe(false);
  });
});
