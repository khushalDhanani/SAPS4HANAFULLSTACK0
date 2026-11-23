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
});
