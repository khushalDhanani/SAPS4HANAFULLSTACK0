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
});
