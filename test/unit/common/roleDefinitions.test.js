'use strict';

const path = require('path');
const cds = require('@sap/cds');
const xsSecurity = require('../../../xs-security.json');

const ROOT = path.join(__dirname, '..', '..', '..');
const PSEUDO_ROLES = new Set(['any', 'authenticated-user', 'identified-user', 'system-user', 'internal-user']);

describe('Unit: CDS roles match xs-security.json', () => {
  let definitions;

  beforeAll(async () => {
    ({ definitions } = await cds.load(path.join(ROOT, 'srv')));
  });

  test('every @requires role is a scope that can be granted', () => {
    const scopes = new Set(xsSecurity.scopes.map((s) => s.name.replace('$XSAPPNAME.', '')));
    const undefinedRoles = [];
    const check = (name, def) => {
      for (const role of [].concat(def['@requires'] || [])) {
        if (!PSEUDO_ROLES.has(role) && !scopes.has(role)) undefinedRoles.push(`${name}: ${role}`);
      }
    };
    for (const [name, def] of Object.entries(definitions)) {
      check(name, def);
      for (const [action, actionDef] of Object.entries(def.actions || {})) check(`${name}/${action}`, actionDef);
    }
    expect(undefinedRoles).toEqual([]);
  });

  test('cancelBillingDocument stays limited to SalesManager and Admin', () => {
    expect(definitions['CustomerInvoiceService.cancelBillingDocument']['@requires']).toEqual(['SalesManager', 'Admin']);
  });
});
