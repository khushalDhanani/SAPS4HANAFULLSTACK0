'use strict';

/**
 * Browser audit (2026-10-19): a deep link opened while signed out instantiated its target view before the
 * auth guard redirected to login, so the view's OData V4 bindings requested $metadata / value helps
 * unauthenticated (75 console errors, 401s cached by the models). Routing must start only once the auth
 * state is known, and a signed-out deep link must be replaced by the login route first.
 */

const fs = require('fs');
const path = require('path');

function loadComponent(deps) {
  const src = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/Component.js'), 'utf8');
  let def;
  const sapUi = { define: (names, factory) => { def = factory(...names.map((n) => deps[n] || {})); } };
  new Function('sap', src)({ ui: sapUi });
  return def;
}

function setup({ authResult, hash }) {
  const initialize = jest.fn();
  const extended = {};
  const UIComponent = { prototype: { init: jest.fn() }, extend: (_n, obj) => Object.assign(extended, obj) };
  const AuthService = { init: jest.fn(() => authResult), isAuthenticated: jest.fn(() => false), syncModelHeaders: jest.fn() };
  global.window = { location: { hash, replace: jest.fn() } };
  global.document = undefined;
  const Component = loadComponent({
    'sap/ui/core/UIComponent': UIComponent,
    'sap/m/MessageToast': { show: jest.fn() },
    'saps4hana/fiori/model/models': { createDeviceModel: () => ({}) },
    'saps4hana/fiori/service/AuthService': AuthService
  });
  const router = { initialize, attachRouteMatched: jest.fn(), getHashChanger: () => ({ attachEvent: jest.fn() }) };
  const self = Object.assign(Object.create(Component), { getModel: () => null, setModel: jest.fn(), getRouter: () => router });
  return { Component, self, initialize, AuthService };
}

afterEach(() => { delete global.window; delete global.document; });

test('restored session: routing starts and no redirect happens', async () => {
  const { Component, self, initialize } = setup({ authResult: Promise.resolve(true), hash: '#/wm/reservation-entry/create' });
  Component.init.call(self);
  expect(initialize).not.toHaveBeenCalled(); // not before the auth state is known
  await Promise.resolve(); await Promise.resolve();
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(global.window.location.replace).not.toHaveBeenCalled();
});

test('signed out deep link: the hash is replaced by login BEFORE the router creates any target view', async () => {
  const { Component, self, initialize } = setup({ authResult: Promise.resolve(false), hash: '#/wm/reservation-entry/create' });
  Component.init.call(self);
  await Promise.resolve(); await Promise.resolve();
  expect(global.window.location.replace).toHaveBeenCalledWith('#/login');
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(global.window.location.replace.mock.invocationCallOrder[0]).toBeLessThan(initialize.mock.invocationCallOrder[0]);
});

test('signed out on the login route or an empty hash: no redirect loop', async () => {
  for (const hash of ['', '#/login', '#login']) {
    const { Component, self, initialize } = setup({ authResult: Promise.resolve(false), hash });
    Component.init.call(self);
    await Promise.resolve(); await Promise.resolve();
    expect(global.window.location.replace).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(1);
  }
});

test('AuthService.init without a promise (older service): routing still starts', async () => {
  const { Component, self, initialize } = setup({ authResult: undefined, hash: '' });
  Component.init.call(self);
  await Promise.resolve(); await Promise.resolve();
  expect(initialize).toHaveBeenCalledTimes(1);
});
