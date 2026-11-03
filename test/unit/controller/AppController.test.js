const path = require('path');

let AppController;
const mockDevice = { system: { phone: false } };
const mockThemeService = { applyTheme: jest.fn(), getSavedTheme: jest.fn() };
const manifest = require('../../../app/fiori-app/webapp/manifest.json');
const routes = manifest['sap.ui5'].routing.routes;

beforeAll(() => {
  const BaseController = {
    extend: (_name, implementation) => {
      function Controller() {}
      Controller.prototype = implementation;
      return Controller;
    }
  };

  global.sap = {
    ui: {
      define: (_dependencies, factory) => {
        AppController = factory(BaseController, function JSONModel() {}, {}, mockDevice, mockThemeService);
      }
    }
  };

  require(path.join(__dirname, '../../../app/fiori-app/webapp/controller/App.controller.js'));
});

/** Router over the real manifest routes, so a new route prefix cannot silently lose its sidebar item. */
const makeRouter = () => ({
  navTo: jest.fn(),
  getRoute: (name) => {
    const route = routes.find((r) => r.name === name);
    return route ? { getPattern: () => route.pattern } : undefined;
  }
});

const makeController = (router = makeRouter()) => {
  const controller = Object.create(AppController.prototype);
  controller.shellState = {};
  controller._oShellModel = {
    setProperty: (key, value) => { controller.shellState[key] = value; }
  };
  controller.getOwnerComponent = () => ({
    getRouter: () => router,
    getModel: () => ({
      getResourceBundle: () => ({ getText: (key) => key })
    })
  });
  return controller;
};

describe('App shell route titles', () => {
  test('purchase order detail keeps its title instead of falling through to sales inquiries', () => {
    const controller = makeController();

    controller._updateShell('purchaseOrderDetail', { PurchaseOrder: '4500012345' });

    expect(controller.shellState).toEqual({
      '/currentTitle': 'poDetailTitle 4500012345',
      '/showNavButton': true,
      '/sideNavKey': 'mm'
    });
  });
});

describe('App shell sidebar', () => {
  afterEach(() => { mockDevice.system.phone = false; });

  test('every manifest route highlights the sidebar item of its module', () => {
    const controller = makeController();
    const expected = { mm: 'mm', sd: 'sd', le: 'sd', wm: 'ewm' };
    routes.forEach((route) => {
      const prefix = route.pattern.split('/')[0];
      expect(`${route.name}: ${controller._getSideNavKey(route.name, {})}`).toBe(`${route.name}: ${expected[prefix] || 'overview'}`);
    });
  });

  test('the dashboard highlights its section, and an unknown section falls back to the overview', () => {
    const controller = makeController();
    expect(controller._getSideNavKey('dashboard', { section: 'sd' })).toBe('sd');
    expect(controller._getSideNavKey('dashboard', { section: 'bogus' })).toBe('overview');
    expect(controller._getSideNavKey('dashboard')).toBe('overview');
  });

  test('an item opens its dashboard section; Overview opens the plain dashboard URL', () => {
    const router = makeRouter();
    const controller = makeController(router);
    const press = (key) => controller.onSideNavItemPress({ getParameter: () => ({ getKey: () => key }) });

    press('ewm');
    expect(router.navTo).toHaveBeenLastCalledWith('dashboard', { section: 'ewm' });
    press('overview');
    expect(router.navTo).toHaveBeenLastCalledWith('dashboard', {});
  });

  test('a phone closes the sidebar after a selection; other devices keep it open', () => {
    const toolPage = { setSideExpanded: jest.fn() };
    const controller = makeController();
    controller.byId = () => toolPage;
    const event = { getParameter: () => ({ getKey: () => 'mm' }) };

    controller.onSideNavItemPress(event);
    expect(toolPage.setSideExpanded).not.toHaveBeenCalled();

    mockDevice.system.phone = true;
    controller.onSideNavItemPress(event);
    expect(toolPage.setSideExpanded).toHaveBeenCalledWith(false);
  });

  test('the menu button toggles the sidebar', () => {
    const toolPage = { toggleSideContentMode: jest.fn() };
    const controller = makeController();
    controller.byId = () => toolPage;

    controller.onMenuButtonPressed();

    expect(toolPage.toggleSideContentMode).toHaveBeenCalledTimes(1);
  });
});

describe('App shell theme menu', () => {
  test('the header button opens the menu at the button', () => {
    const menu = { openBy: jest.fn() };
    const button = {};
    const controller = makeController();
    controller.byId = (id) => (id === 'shellThemeMenu' ? menu : null);

    controller.onThemeMenuPressed({ getSource: () => button });

    expect(menu.openBy).toHaveBeenCalledWith(button);
  });

  test('a selection applies and saves the theme and marks it active in the menu', () => {
    const controller = makeController();

    controller.onThemeSelected({ getParameter: () => ({ getKey: () => 'sap_fiori_3_dark' }) });

    expect(mockThemeService.applyTheme).toHaveBeenCalledWith('sap_fiori_3_dark');
    expect(controller.shellState['/theme']).toBe('sap_fiori_3_dark');
  });
});
