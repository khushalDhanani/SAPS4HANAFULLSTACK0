const fs = require('fs');
const path = require('path');

let AppController;
const mockDevice = { system: { phone: false } };
const mockThemeService = { applyTheme: jest.fn(), getSavedTheme: jest.fn() };
const mockAuthService = { hasAnyRole: jest.fn(() => false) };
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
        AppController = factory(BaseController, function JSONModel() {}, {}, mockDevice, mockThemeService, mockAuthService);
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

  test('every manifest route except login and default gets a non-empty ShellBar title', () => {
    const controller = makeController();
    const untitled = routes
      .filter((route) => !['login', 'default'].includes(route.name))
      .filter((route) => {
        controller._updateShell(route.name, {});
        return !controller.shellState['/currentTitle'];
      })
      .map((route) => route.name);

    expect(untitled).toEqual([]);
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

  test('the Administrator section is highlighted only for the Admin role', () => {
    const controller = makeController();
    expect(controller._getSideNavKey('dashboard', { section: 'admin' })).toBe('overview');
    expect(mockAuthService.hasAnyRole).toHaveBeenLastCalledWith(['Admin']);
    mockAuthService.hasAnyRole.mockReturnValueOnce(true);
    expect(controller._getSideNavKey('dashboard', { section: 'admin' })).toBe('admin');
  });

  test('an item opens its dashboard section; Overview opens the plain dashboard URL', () => {
    const router = makeRouter();
    const controller = makeController(router);
    const press = (key) => controller.onSideNavItemPress({ getParameter: () => ({ getKey: () => key, getSelectable: () => true }) });

    press('ewm');
    expect(router.navTo).toHaveBeenLastCalledWith('dashboard', { section: 'ewm' });
    press('overview');
    expect(router.navTo).toHaveBeenLastCalledWith('dashboard', {});
  });

  test('the User Master group only expands: its press does not navigate or close the phone sidebar', () => {
    const router = makeRouter();
    const toolPage = { setSideExpanded: jest.fn() };
    const controller = makeController(router);
    controller.byId = () => toolPage;
    mockDevice.system.phone = true;

    controller.onSideNavItemPress({ getParameter: () => ({ getKey: () => null, getSelectable: () => false }) });

    expect(router.navTo).not.toHaveBeenCalled();
    expect(toolPage.setSideExpanded).not.toHaveBeenCalled();
  });

  test('User Master is an Admin-only group holding Administrator, with i18n texts', () => {
    const webapp = path.join(__dirname, '../../../app/fiori-app/webapp');
    const view = fs.readFileSync(path.join(webapp, 'view/App.view.xml'), 'utf8');
    const group = view.match(/<tnt:NavigationListItem id="sideNavUserMaster"([^\n]*)>\s*<tnt:items>([\s\S]*?)<\/tnt:items>/);
    expect(group).not.toBeNull();
    expect(group[1]).toContain('selectable="false"');
    expect(group[1]).toContain("visible=\"{path: 'auth>/user/scopes', formatter: '.isAdmin'}\"");
    expect(group[2]).toContain('id="sideNavAdmin" key="admin"');
    expect(view.split('id="sideNavAdmin"')).toHaveLength(2);
    ['i18n.properties', 'i18n_en.properties'].forEach((file) => {
      const bundle = fs.readFileSync(path.join(webapp, 'i18n', file), 'utf8');
      expect(bundle).toContain('tabUserMasterTitle=User Master\n');
      expect(bundle).toMatch(/^tabUserMasterTooltip=.+$/m);
    });
  });

  test('a phone closes the sidebar after a selection; other devices keep it open', () => {
    const toolPage = { setSideExpanded: jest.fn() };
    const controller = makeController();
    controller.byId = () => toolPage;
    const event = { getParameter: () => ({ getKey: () => 'mm', getSelectable: () => true }) };

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
