'use strict';

const {
  verifyCfRfcRuntime,
  findNativeRfcLibrary,
  REQUIRED_LINUX_LIBRARIES
} = require('../../../tools/verify-cf-rfc-runtime');

describe('Unit: Cloud Foundry RFC Runtime Dependency & Deployment Proof (MTA-01)', () => {
  describe('REQUIRED_LINUX_LIBRARIES specification', () => {
    it('declares the 5 required SAP NW RFC SDK shared libraries', () => {
      expect(REQUIRED_LINUX_LIBRARIES).toEqual([
        'libsapnwrfc.so',
        'libsapucum.so',
        'libicudata.so.57',
        'libicui18n.so.57',
        'libicuuc.so.57'
      ]);
    });
  });

  describe('findNativeRfcLibrary', () => {
    it('detects library when present in one of the search paths (Linux)', () => {
      const mockFs = {
        existsSync: jest.fn((p) => p === '/home/vcap/deps/0/nwrfcsdk/lib/libsapnwrfc.so')
      };
      const result = findNativeRfcLibrary(
        ['/opt/other', '/home/vcap/deps/0/nwrfcsdk/lib'],
        mockFs,
        'linux'
      );
      expect(result.found).toBe(true);
      expect(result.path).toBe('/home/vcap/deps/0/nwrfcsdk/lib/libsapnwrfc.so');
      expect(result.libName).toBe('libsapnwrfc.so');
    });

    it('detects .dylib on darwin platform', () => {
      const mockFs = {
        existsSync: jest.fn((p) => p === '/usr/local/sap/lib/libsapnwrfc.dylib')
      };
      const result = findNativeRfcLibrary(
        ['/usr/local/sap/lib'],
        mockFs,
        'darwin'
      );
      expect(result.found).toBe(true);
      expect(result.path).toBe('/usr/local/sap/lib/libsapnwrfc.dylib');
      expect(result.libName).toBe('libsapnwrfc.dylib');
    });

    it('returns found: false when dynamic library is absent across all search paths', () => {
      const mockFs = {
        existsSync: jest.fn(() => false)
      };
      const result = findNativeRfcLibrary(
        ['/dir1', '/dir2'],
        mockFs,
        'linux'
      );
      expect(result.found).toBe(false);
      expect(result.path).toBeNull();
    });
  });

  describe('verifyCfRfcRuntime', () => {
    it('certifies runtime when Linux x64, Node 22, libraries present, node-rfc loads, and destination bound', () => {
      const mockFs = {
        existsSync: jest.fn((p) => p === '/home/vcap/deps/0/nwrfcsdk/lib/libsapnwrfc.so')
      };
      class MockRfcClient {
        isAvailable() {
          return true;
        }
      }
      const env = {
        NODE_ENV: 'production',
        VCAP_APPLICATION: '{"application_name":"saps4hana-srv"}',
        VCAP_SERVICES: JSON.stringify({
          destination: [{ name: 'saps4hana-destination', credentials: {} }]
        }),
        S4_RFC_DESTINATION_NAME: 'S4HANA_RFC',
        SAPNWRFC_HOME: '/home/vcap/deps/0/nwrfcsdk',
        LD_LIBRARY_PATH: '/home/vcap/deps/0/nwrfcsdk/lib'
      };

      const report = verifyCfRfcRuntime({
        env,
        fsModule: mockFs,
        rfcClientClass: MockRfcClient,
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.13.0'
      });

      expect(report.certified).toBe(true);
      expect(report.status).toBe('CERTIFIED');
      expect(report.isCloudFoundry).toBe(true);
      expect(report.isProduction).toBe(true);
      expect(report.library.found).toBe(true);
      expect(report.moduleLoadable).toBe(true);
      expect(report.destination.serviceBound).toBe(true);
      expect(report.issues).toHaveLength(0);
      expect(report.remediation).toHaveLength(0);
    });

    it('fails certification when native dynamic library is missing', () => {
      const mockFs = {
        existsSync: jest.fn(() => false)
      };
      class MockRfcClient {
        isAvailable() {
          return false;
        }
      }
      const env = {
        NODE_ENV: 'production',
        VCAP_APPLICATION: '{"application_name":"saps4hana-srv"}',
        VCAP_SERVICES: JSON.stringify({ destination: [{ name: 'dest' }] }),
        S4_RFC_DESTINATION_NAME: 'S4HANA_RFC'
      };

      const report = verifyCfRfcRuntime({
        env,
        fsModule: mockFs,
        rfcClientClass: MockRfcClient,
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.13.0'
      });

      expect(report.certified).toBe(false);
      expect(report.status).toBe('NOT_CERTIFIED');
      expect(report.library.found).toBe(false);
      expect(report.moduleLoadable).toBe(false);
      expect(report.issues.some((i) => i.includes('was not found in library search paths'))).toBe(true);
      expect(report.issues.some((i) => i.includes('node-rfc native module is not loadable'))).toBe(true);
      expect(report.remediation.length).toBeGreaterThan(0);
    });

    it('detects incompatible Cloud Foundry stack architecture', () => {
      const mockFs = { existsSync: jest.fn(() => true) };
      class MockRfcClient {
        isAvailable() {
          return true;
        }
      }
      const env = {
        VCAP_APPLICATION: '{"application_name":"saps4hana-srv"}',
        VCAP_SERVICES: JSON.stringify({ destination: [{ name: 'dest' }] }),
        S4_RFC_DESTINATION_NAME: 'S4HANA_RFC'
      };

      const report = verifyCfRfcRuntime({
        env,
        fsModule: mockFs,
        rfcClientClass: MockRfcClient,
        platform: 'linux',
        arch: 'arm64',
        nodeVersion: 'v22.13.0'
      });

      expect(report.certified).toBe(false);
      expect(report.issues.some((i) => i.includes('cflinuxfs4'))).toBe(true);
    });

    it('flags missing VCAP_SERVICES destination binding in production Cloud Foundry', () => {
      const mockFs = { existsSync: jest.fn(() => true) };
      class MockRfcClient {
        isAvailable() {
          return true;
        }
      }
      const env = {
        NODE_ENV: 'production',
        VCAP_APPLICATION: '{"application_name":"saps4hana-srv"}',
        VCAP_SERVICES: JSON.stringify({ otherService: [] }),
        S4_RFC_DESTINATION_NAME: 'S4HANA_RFC'
      };

      const report = verifyCfRfcRuntime({
        env,
        fsModule: mockFs,
        rfcClientClass: MockRfcClient,
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.13.0'
      });

      expect(report.certified).toBe(false);
      expect(report.destination.serviceBound).toBe(false);
      expect(report.issues.some((i) => i.includes('bound destination service instance'))).toBe(true);
    });

    it('warns when Node version is below 20', () => {
      const mockFs = { existsSync: jest.fn(() => true) };
      class MockRfcClient {
        isAvailable() {
          return true;
        }
      }
      const env = {
        S4_RFC_DESTINATION_NAME: 'S4HANA_DEV'
      };

      const report = verifyCfRfcRuntime({
        env,
        fsModule: mockFs,
        rfcClientClass: MockRfcClient,
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v18.19.0'
      });

      expect(report.issues.some((i) => i.includes('minimum supported version 20'))).toBe(true);
    });
  });
});
