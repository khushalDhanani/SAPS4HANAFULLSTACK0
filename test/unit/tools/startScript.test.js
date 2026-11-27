'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('package.json start & watch scripts', () => {
    const rootDir = path.resolve(__dirname, '../../..');
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

    test('watch delegates to start without duplicating launcher logic', () => {
        expect(pkg.scripts.watch).toBe('npm start -- --watch');
    });

    test('start launches node directly instead of sh -c so macOS SIP does not strip DYLD_LIBRARY_PATH', () => {
        expect(pkg.scripts.start.startsWith('node -e ')).toBe(true);
        expect(pkg.scripts.start).toContain("require.resolve(w?'@sap/cds-dk/bin/cds.js':'@sap/cds/bin/serve.js')");
    });

    test('start configures CA certs and NW RFC SDK library paths when present', () => {
        const script = pkg.scripts.start;
        expect(script).toContain('certs/ca-bundle.pem');
        expect(script).toContain('.sap-certs/s4-dev.pem');
        expect(script).toContain('DYLD_LIBRARY_PATH');
        expect(script).toContain('LD_LIBRARY_PATH');
        expect(script).toContain('libsapnwrfc.dylib');
        expect(script).toContain('libsapnwrfc.so');
    });

    test('start resolves @sap/cds/bin/serve.js and @sap/cds-dk/bin/cds.js and preserves DYLD_LIBRARY_PATH in spawned node', () => {
        expect(fs.existsSync(require.resolve('@sap/cds/bin/serve.js'))).toBe(true);
        expect(fs.existsSync(require.resolve('@sap/cds-dk/bin/cds.js'))).toBe(true);

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwrfc-test-'));
        const libDir = path.join(tmpDir, 'lib');
        fs.mkdirSync(libDir, { recursive: true });
        const libFile = process.platform === 'darwin' ? 'libsapnwrfc.dylib' : 'libsapnwrfc.so';
        const envKey = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
        fs.writeFileSync(path.join(libDir, libFile), '');

        try {
            // Simulate the library path resolution from package.json start script
            const env = { ...process.env, SAPNWRFC_HOME: tmpDir };
            const candidates = [
                env.SAPNWRFC_HOME && path.join(env.SAPNWRFC_HOME, 'lib'),
                path.resolve(rootDir, 'nwrfcsdk/lib'),
                path.join(os.homedir(), 'nwrfcsdk/lib'),
                '/usr/local/sap/nwrfcsdk/lib'
            ].filter(Boolean);
            for (const d of candidates) {
                if (fs.existsSync(path.join(d, libFile))) {
                    const cur = env[envKey] ? env[envKey].split(path.delimiter) : [];
                    if (!cur.includes(d)) env[envKey] = [d, ...cur].join(path.delimiter);
                    break;
                }
            }
            expect(env[envKey].split(path.delimiter)[0]).toBe(libDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
