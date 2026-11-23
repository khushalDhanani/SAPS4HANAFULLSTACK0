'use strict';

const fs = require('fs');
const path = require('path');

describe('App Router Configuration (app/router/xs-app.json)', () => {
  const xsAppPath = path.resolve(__dirname, '../../../app/router/xs-app.json');
  let config;

  beforeAll(() => {
    expect(fs.existsSync(xsAppPath)).toBe(true);
    config = JSON.parse(fs.readFileSync(xsAppPath, 'utf8'));
  });

  test('contains valid welcomeFile and authenticationMethod', () => {
    expect(config.welcomeFile).toBe('/saps4hanafiori/index.html');
    expect(config.authenticationMethod).toBe('route');
    expect(Array.isArray(config.routes)).toBe(true);
  });

  test('routes /ai/chat/stream to srv-api with xsuaa auth and CSRF protection enabled', () => {
    const aiRoute = config.routes.find((r) => r.source === '^/ai/chat/stream$');
    expect(aiRoute).toBeDefined();
    expect(aiRoute.destination).toBe('srv-api');
    expect(aiRoute.target).toBe('/ai/chat/stream');
    expect(aiRoute.authenticationType).toBe('xsuaa');
    expect(aiRoute.csrfProtection).toBe(true);

    // Must appear before the catch-all HTML5 repo route
    const aiIndex = config.routes.indexOf(aiRoute);
    const catchAllIndex = config.routes.findIndex((r) => r.source === '^(.*)$');
    expect(aiIndex).toBeLessThan(catchAllIndex);
  });

  test('routes /health to srv-api without authentication or CSRF', () => {
    const healthRoute = config.routes.find((r) => r.source === '^/health(/.*)?$');
    expect(healthRoute).toBeDefined();
    expect(healthRoute.destination).toBe('srv-api');
    expect(healthRoute.target).toBe('/health$1');
    expect(healthRoute.authenticationType).toBe('none');
    expect(healthRoute.csrfProtection).toBe(false);

    const healthIndex = config.routes.indexOf(healthRoute);
    const catchAllIndex = config.routes.findIndex((r) => r.source === '^(.*)$');
    expect(healthIndex).toBeLessThan(catchAllIndex);
  });

  test('routes /odata/v4 to srv-api with xsuaa and CSRF protection', () => {
    const odataRoute = config.routes.find((r) => r.source === '^/odata/v4/(.*)$');
    expect(odataRoute).toBeDefined();
    expect(odataRoute.destination).toBe('srv-api');
    expect(odataRoute.authenticationType).toBe('xsuaa');
    expect(odataRoute.csrfProtection).toBe(true);
  });

  test('retains catch-all html5-apps-repo-rt route as the final rule', () => {
    const lastRoute = config.routes[config.routes.length - 1];
    expect(lastRoute.source).toBe('^(.*)$');
    expect(lastRoute.service).toBe('html5-apps-repo-rt');
    expect(lastRoute.authenticationType).toBe('xsuaa');
  });
});
