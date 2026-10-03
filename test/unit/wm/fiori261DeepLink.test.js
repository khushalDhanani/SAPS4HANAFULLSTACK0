const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '../../..');
const xsAppPath = path.join(appRoot, 'app/router/xs-app.json');
const indexPath = path.join(appRoot, 'app/fiori-app/webapp/index.html');
const normalizerPath = path.join(appRoot, 'app/fiori-app/webapp/deepLink.js');
const directPath = '/wm/goods-issue/order-based-261';
const normalizeDirect261Link = require(normalizerPath);

function runDeepLinkBootstrap(pathname, search = '') {
  const html = fs.readFileSync(indexPath, 'utf8');
  const history = { replaceState: jest.fn() };
  const location = { pathname, search };
  const normalized = normalizeDirect261Link(location, history, 'SAPS4HANA Fiori');
  return { html, history, normalized };
}

describe('Movement 261 direct-path deep links', () => {
  test('routes the direct path to the app shell before the generic HTML5 resource route', () => {
    const config = JSON.parse(fs.readFileSync(xsAppPath, 'utf8'));
    const directRoute = config.routes.find((route) => route.source.includes('/wm/goods-issue/order-based-261'));
    const genericRouteIndex = config.routes.findIndex((route) => route.source === '^(.*)$');

    expect(directRoute).toMatchObject({
      target: '/saps4hanafiori/index.html',
      service: 'html5-apps-repo-rt',
      authenticationType: 'xsuaa'
    });
    expect(config.routes.indexOf(directRoute)).toBeLessThan(genericRouteIndex);
    expect(directPath.replace(new RegExp(directRoute.source), directRoute.target)).toBe('/saps4hanafiori/index.html');
    expect(fs.readFileSync(indexPath, 'utf8')).toContain('<script src="/saps4hanafiori/deepLink.js"></script>');
  });

  test.each([
    ['/wm/goods-issue/order-based-261', '?resv=480962', '/saps4hanafiori/index.html#/wm/goods-issue/order-based-261?resv=480962'],
    ['/wm/goods-issue/order-based-261/', '?resv=123456&item=0002', '/saps4hanafiori/index.html#/wm/goods-issue/order-based-261?resv=123456&item=0002'],
    ['/wm/goods-issue/order-based-261', '?resv=987654', '/saps4hanafiori/index.html#/wm/goods-issue/order-based-261?resv=987654']
  ])('normalizes %s%s into the UI5 route without reservation-specific handling', (pathname, search, expectedUrl) => {
    const { history, normalized } = runDeepLinkBootstrap(pathname, search);

    expect(normalized).toBe(true);
    expect(history.replaceState).toHaveBeenCalledWith(null, 'SAPS4HANA Fiori', expectedUrl);
  });

  test('leaves unrelated paths and the existing hash-route entry point unchanged', () => {
    const { history, normalized } = runDeepLinkBootstrap('/index.html', '');
    const unrelated = runDeepLinkBootstrap('/wm/goods-issue/261/open-reservations', '?plant=1120');

    expect(normalized).toBe(false);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(unrelated.normalized).toBe(false);
    expect(unrelated.history.replaceState).not.toHaveBeenCalled();
  });
});
