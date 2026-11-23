'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  checkRfcSdk,
  configureCa,
  loadBindings,
  commandToRun,
  prepareRuntime
} = require('../../../tools/docker/runtime');

describe('Docker runtime configuration', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-docker-runtime-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('builds VCAP_SERVICES from the requested mounted service bindings', () => {
    for (const service of ['xsuaa', 'destination', 'hana']) {
      fs.writeFileSync(
        path.join(tempDir, `${service}.json`),
        JSON.stringify({ name: `${service}-binding`, label: service, credentials: { marker: 'test-only' } })
      );
    }

    expect(JSON.parse(loadBindings(['xsuaa', 'destination', 'hana'], tempDir))).toEqual({
      xsuaa: [{ name: 'xsuaa-binding', label: 'xsuaa', credentials: { marker: 'test-only' } }],
      destination: [{ name: 'destination-binding', label: 'destination', credentials: { marker: 'test-only' } }],
      hana: [{ name: 'hana-binding', label: 'hana', credentials: { marker: 'test-only' } }]
    });
  });

  test('fails clearly when a required binding is missing without exposing credentials', () => {
    expect(() => loadBindings(['xsuaa'], tempDir)).toThrow(
      `Required xsuaa service binding is missing or invalid at ${path.join(tempDir, 'xsuaa.json')}`
    );
  });

  test('rejects binding files whose service label does not match the requested binding', () => {
    fs.writeFileSync(
      path.join(tempDir, 'xsuaa.json'),
      JSON.stringify({ name: 'test-binding', label: 'destination', credentials: { marker: 'test-only' } })
    );
    expect(() => loadBindings(['xsuaa'], tempDir)).toThrow(
      `Required xsuaa service binding at ${path.join(tempDir, 'xsuaa.json')} must contain matching label, name, and credentials`
    );
  });

  test('uses the normal start command by default and supports runtime-prepared one-off commands', () => {
    expect(commandToRun([])).toEqual(['npm', 'start']);
    expect(commandToRun(['node', 'tools/rfc-preflight.js', '--allow-live-sap']))
      .toEqual(['node', 'tools/rfc-preflight.js', '--allow-live-sap']);
  });

  test('requires local-only auth credentials without loading service bindings or RFC SDK', () => {
    expect(() => prepareRuntime({
      APP_ROLE: 'cap-local',
      NODE_ENV: 'test',
      ENABLE_DEV_TOKEN_ISSUER: 'true',
      LOCAL_AUTH_SECRET: 'test-local-auth-secret-longer-than-32-characters',
      LOCAL_DEV_PASSWORD: 'local-only-test-password',
      BINDING_SERVICES: '',
      REQUIRE_RFC_SDK: 'false'
    })).not.toThrow();

    expect(() => prepareRuntime({
      APP_ROLE: 'cap-local',
      NODE_ENV: 'test',
      ENABLE_DEV_TOKEN_ISSUER: 'true',
      LOCAL_AUTH_SECRET: '',
      LOCAL_DEV_PASSWORD: '',
      BINDING_SERVICES: '',
      REQUIRE_RFC_SDK: 'false'
    })).toThrow(/Local CAP profile requires ENABLE_DEV_TOKEN_ISSUER=true/);
  });

  test('sets the optional custom CA only when the file exists', () => {
    const env = {};
    configureCa(env);
    expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined();

    const caFile = path.join(tempDir, 'custom-ca.pem');
    fs.writeFileSync(caFile, 'test-only');
    const configuredEnv = { CUSTOM_CA_CERT_FILE: caFile };
    configureCa(configuredEnv);
    expect(configuredEnv.NODE_EXTRA_CA_CERTS).toBe(caFile);
  });

  test('connected local RFC requires connection settings before loading the SDK', () => {
    const env = {
      APP_ROLE: 'cap-local', NODE_ENV: 'test', ENABLE_DEV_TOKEN_ISSUER: 'true',
      LOCAL_AUTH_SECRET: 'test-local-auth-secret-longer-than-32-characters',
      LOCAL_DEV_PASSWORD: 'local-test-password', REQUIRE_RFC_SDK: 'true',
      S4_DESTINATION_URL: 'https://sap.test', S4_CLIENT: '001',
      S4_USERNAME: 'test-user', S4_PASSWORD: 'never-print-this'
    };
    expect(() => prepareRuntime(env)).toThrow('Local RFC configuration is missing: S4_RFC_SYSNR');
    env.S4_RFC_SYSNR = '00';
    env.PLATFORM = 'unsupported-test-platform';
    expect(() => prepareRuntime(env)).toThrow(/Unsupported PLATFORM/);
  });

  test('fails when an explicitly configured custom CA file is missing', () => {
    expect(() => configureCa({ CUSTOM_CA_CERT_FILE: path.join(tempDir, 'missing.pem') }))
      .toThrow(`Configured custom CA certificate is missing at ${path.join(tempDir, 'missing.pem')}`);
  });

  test('rejects unsupported platform targets and missing SDK libraries', () => {
    expect(() => checkRfcSdk({ platform: 'linux/ppc64le' }))
      .toThrow("Unsupported PLATFORM 'linux/ppc64le'; use linux/amd64 or linux/arm64");
    expect(() => checkRfcSdk({
      sdkPath: tempDir,
      platform: 'linux/amd64',
      nodeArch: 'x64',
      runtimePlatform: 'linux'
    }))
      .toThrow(`SAP NW RFC SDK library is missing or unreadable at ${path.join(tempDir, 'lib', 'libsapnwrfc.so')}`);
  });

  test('rejects a mounted SDK library with a different ELF architecture', () => {
    const libDir = path.join(tempDir, 'lib');
    fs.mkdirSync(libDir);
    const header = Buffer.alloc(20);
    header.set([0x7f, 0x45, 0x4c, 0x46], 0);
    header[5] = 1;
    header.writeUInt16LE(183, 18);
    fs.writeFileSync(path.join(libDir, 'libsapnwrfc.so'), header);

    expect(() => checkRfcSdk({
      sdkPath: tempDir,
      platform: 'linux/amd64',
      nodeArch: 'x64',
      runtimePlatform: 'linux'
    })).toThrow(/expected x86-64 ELF machine 62, found 183/);
  });
});
