'use strict';

const fs = require('fs');
const path = require('path');

describe('Docker Configuration Integrity', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  test('package.json has @cap-js/sqlite in dependencies for standalone container runtime', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@cap-js/sqlite']).toBeDefined();
    expect(pkg.devDependencies['@cap-js/sqlite']).toBeUndefined();
  });

  test('docker-compose.yml defaults NODE_ENV to development for non-XSUAA standalone execution', () => {
    const composeContent = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');
    expect(composeContent).toContain('NODE_ENV=${NODE_ENV:-development}');
  });

  test('Dockerfile defaults NODE_ENV to development and does not hardcode CDS_ENV=production or srv/csn.json', () => {
    const dockerfileContent = fs.readFileSync(path.join(rootDir, 'Dockerfile'), 'utf8');
    expect(dockerfileContent).toContain('NODE_ENV=development');
    expect(dockerfileContent).not.toContain('CDS_ENV=production');
    expect(dockerfileContent).not.toContain('srv/csn.json');
  });

  test('.env.docker.example specifies NODE_ENV=development for standalone container stack', () => {
    const envExample = fs.readFileSync(path.join(rootDir, '.env.docker.example'), 'utf8');
    expect(envExample).toMatch(/^NODE_ENV=development/m);
  });

  test('server.js handles X-CSRF-Token: Fetch to support direct container and browser access', () => {
    const serverJsContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
    expect(serverJsContent).toContain("req.headers['x-csrf-token']");
    expect(serverJsContent).toContain("res.setHeader('X-CSRF-Token'");
  });

  test('docker-compose.yml mounts ./certs and configures NODE_EXTRA_CA_CERTS for custom CA support', () => {
    const composeContent = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');
    expect(composeContent).toContain('NODE_EXTRA_CA_CERTS');
    expect(composeContent).toContain('./certs:/run/certs:ro');
    expect(composeContent).toContain('./db.sqlite:/home/node/app/db.sqlite');
  });

  test('docker-compose.yml publishes the plain-HTTP services on loopback only and the TLS proxy alone on the network', () => {
    const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');
    const published = compose.split('\n').filter((line) => /^\s*- "[^"]*:\d+"\s*$/.test(line)).map((line) => line.trim());
    expect(published).toEqual([
      '- "127.0.0.1:${PORT:-4004}:4004"',
      '- "127.0.0.1:${ROUTER_PORT:-5000}:5000"',
      '- "${HTTPS_PORT:-443}:443"'
    ]);
    expect(compose).toMatch(/proxy:[\s\S]*profiles:\s*\n\s*- tls/);
    const caddyfile = fs.readFileSync(path.join(rootDir, 'docker/proxy/Caddyfile'), 'utf8');
    expect(caddyfile).toContain('reverse_proxy backend:4004');
    expect(caddyfile).toContain('tls /run/certs/server.crt /run/certs/server.key');
  });
  test.each(['.env.example', '.env.docker.example', 'docs/DOCKER.md'])('%s does not say that the login screen takes S4_PASSWORD', (file) => {
    const text = fs.readFileSync(path.join(rootDir, file), 'utf8');
    expect(text).not.toMatch(/takes `?S4_PASSWORD|accepts `?S4_PASSWORD/);
    expect(text).toMatch(/S4_PASSWORD`?\)? (is|are) refused/);
    expect(text).not.toMatch(/\(khushal, S4_USERNAME\)/);
  });

  test.each(['.env.example', '.env.docker.example'])('%s says when LOCAL_DEV_PASSWORD works and that the example secret is refused', (file) => {
    const text = fs.readFileSync(path.join(rootDir, file), 'utf8');
    expect(text).toContain('only when NODE_ENV=development or APP_ROLE=cap-local, and never for a user who holds Admin');
    expect(text).toContain('refuses');
    expect(text).toMatch(/^LOCAL_DEV_PASSWORD=$/m);
  });
  test('docker-compose.yml lets the app trust one proxy by default, so the sign-in limit sees the client address behind the tls proxy', () => {
    const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('- TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS:-1}');
    expect(compose).toMatch(/proxy:[\s\S]*profiles:\s*\n\s*- tls/);
  });

  test.each(['.env.example', '.env.docker.example'])('%s needs no user list: automatic roles are set up, without sample users', (file) => {
    const text = fs.readFileSync(path.join(rootDir, file), 'utf8');
    expect(text).toMatch(/^APP_ALLOW_ANY_SAP_USER=true$/m);
    expect(text).toMatch(/^APP_DEFAULT_ROLES=Viewer$/m);
    expect(text).toMatch(/^APP_SAP_ROLE_PREFIX=ZAPP_$/m);
    expect(text).toMatch(/^APP_ADMIN_USERS=$/m);
    expect(text).toMatch(/^APP_USER_ROLES=$/m);
    expect(text).toMatch(/^APP_USERS_FILE=$/m);
    expect(text).not.toMatch(/JDOE|ASMITH|JSMITH|MADMIN|KHUSHAL/);
    expect(text).toContain("a role change in SAP applies at the user's next sign-in");
  });
});
