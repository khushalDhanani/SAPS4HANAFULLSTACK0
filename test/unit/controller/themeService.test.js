const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEBAPP = path.join(__dirname, '../../../app/fiori-app/webapp');
const mockTheming = { setTheme: jest.fn() };
let ThemeService;

beforeAll(() => {
  global.sap = { ui: { define: (_deps, factory) => { ThemeService = factory(mockTheming); } } };
  require(path.join(WEBAPP, 'service/ThemeService.js'));
});

const useStorage = (storage) => { global.window = { localStorage: storage }; };
const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; }
  };
};
const blockedStorage = () => ({
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); }
});

beforeEach(() => mockTheming.setTheme.mockClear());
afterAll(() => { delete global.window; });

describe('ThemeService saving', () => {
  test('applies the theme at once and saves it under one key', () => {
    const storage = memoryStorage();
    useStorage(storage);

    ThemeService.applyTheme('sap_horizon_dark');

    expect(mockTheming.setTheme).toHaveBeenCalledWith('sap_horizon_dark');
    expect(storage.data).toEqual({ 'app.theme': 'sap_horizon_dark' });
  });

  test('blocked storage still applies the theme and does not throw', () => {
    useStorage(blockedStorage());

    expect(() => ThemeService.applyTheme('sap_fiori_3')).not.toThrow();
    expect(mockTheming.setTheme).toHaveBeenCalledWith('sap_fiori_3');
  });

  test('an unknown theme is neither applied nor saved', () => {
    const storage = memoryStorage();
    useStorage(storage);

    ThemeService.applyTheme('not_a_theme');

    expect(mockTheming.setTheme).not.toHaveBeenCalled();
    expect(storage.data).toEqual({});
  });
});

describe('ThemeService restoring', () => {
  test.each(['sap_horizon', 'sap_horizon_dark', 'sap_fiori_3', 'sap_fiori_3_dark'])('restores saved %s', (theme) => {
    useStorage(memoryStorage({ 'app.theme': theme }));

    expect(ThemeService.restoreTheme()).toBe(theme);
    expect(mockTheming.setTheme).toHaveBeenCalledWith(theme);
  });

  test.each([
    ['nothing saved', memoryStorage],
    ['an invalid value', () => memoryStorage({ 'app.theme': 'not_a_theme' })],
    ['an empty value', () => memoryStorage({ 'app.theme': '' })],
    ['blocked storage', blockedStorage]
  ])('falls back to the default with %s', (_name, makeStorage) => {
    useStorage(makeStorage());

    expect(ThemeService.getSavedTheme()).toBe('sap_horizon');
    expect(ThemeService.restoreTheme()).toBe('sap_horizon');
    expect(mockTheming.setTheme).toHaveBeenCalledWith('sap_horizon');
  });
});

describe('Theme lists stay in sync', () => {
  const read = (file) => fs.readFileSync(path.join(WEBAPP, file), 'utf8');

  /** Runs the plain boot script against the given storage and returns the theme it hands to UI5. */
  const startupTheme = (storage) => {
    const window = { localStorage: storage };
    vm.runInNewContext(read('themeStartup.js'), { window });
    return window['sap-ui-config'].theme;
  };

  test('themeStartup.js lists the same themes as ThemeService', () => {
    const script = read('themeStartup.js');
    expect(JSON.parse(script.match(/aThemes = (\[[^\]]*\])/)[1])).toEqual(ThemeService.THEMES);
  });

  test('themeStartup.js boots with the theme ThemeService saved', () => {
    const storage = memoryStorage();
    useStorage(storage);
    ThemeService.applyTheme('sap_fiori_3');

    expect(startupTheme(storage)).toBe('sap_fiori_3');
  });

  test.each([
    ['nothing saved', memoryStorage],
    ['an invalid value', () => memoryStorage({ 'app.theme': 'not_a_theme' })],
    ['blocked storage', blockedStorage]
  ])('themeStartup.js boots with sap_horizon with %s', (_name, makeStorage) => {
    expect(startupTheme(makeStorage())).toBe('sap_horizon');
  });

  test('index.html loads the startup script before UI5 and sets no fixed theme, which would override the saved one', () => {
    const html = read('index.html');
    expect(html.indexOf('src="themeStartup.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="themeStartup.js"')).toBeLessThan(html.indexOf('sap-ui-core.js'));
    expect(html).not.toMatch(/data-sap-ui-theme/);
  });

  test('the header menu offers the same themes and marks each one from the model', () => {
    const xml = read('fragment/CommonHeader.fragment.xml');
    const items = [...xml.matchAll(/<MenuItem key="(\w+)".*?selected="\{= \$\{shellModel>\/theme\} === '(\w+)' \}"/g)];
    expect(items.map((m) => m[1])).toEqual(ThemeService.THEMES);
    items.forEach((m) => expect(m[2]).toBe(m[1]));
  });

  test('Component.init restores the theme before its base init renders anything', () => {
    const calls = [];
    const deps = {
      'sap/ui/core/UIComponent': { prototype: { init: () => calls.push('base init') }, extend: (_name, proto) => proto },
      'sap/m/MessageToast': { show: () => {} },
      'saps4hana/fiori/model/models': { createDeviceModel: () => ({}) },
      'saps4hana/fiori/service/AuthService': { init: () => Promise.resolve(true), syncModelHeaders: () => {} },
      'saps4hana/fiori/service/ThemeService': { restoreTheme: () => calls.push('restore theme') }
    };
    let Component;
    new Function('sap', read('Component.js'))({
      ui: { define: (names, factory) => { Component = factory(...names.map((name) => deps[name] || {})); } }
    });

    Component.init.call(Object.assign(Object.create(Component), {
      getModel: () => null,
      setModel: () => {},
      getRouter: () => ({ attachRouteMatched: () => {}, getHashChanger: () => null, initialize: () => {} })
    }));

    expect(calls).toEqual(['restore theme', 'base init']);
  });
});
