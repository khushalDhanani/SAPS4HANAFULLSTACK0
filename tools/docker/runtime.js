'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_BINDINGS_DIR = '/run/secrets';
const DEFAULT_CA_FILE = '/run/certs/ca-bundle.pem';
const SUPPORTED_PLATFORMS = {
  'linux/amd64': { nodeArch: 'x64', elfMachine: 62, label: 'x86-64' },
  'linux/arm64': { nodeArch: 'arm64', elfMachine: 183, label: 'AArch64' }
};

function readBindingFile(service, bindingsDir) {
  const file = path.join(bindingsDir, `${service}.json`);
  let binding;
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile()) throw new Error();
    binding = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Required ${service} service binding is missing or invalid at ${file}`);
  }

  if (
    !binding ||
    typeof binding !== 'object' ||
    Array.isArray(binding) ||
    binding.label !== service ||
    typeof binding.name !== 'string' ||
    !binding.name.trim() ||
    !binding.credentials ||
    typeof binding.credentials !== 'object' ||
    Array.isArray(binding.credentials) ||
    Object.keys(binding.credentials).length === 0
  ) {
    throw new Error(`Required ${service} service binding at ${file} must contain matching label, name, and credentials`);
  }
  return binding;
}

function loadBindings(requiredServices, bindingsDir = DEFAULT_BINDINGS_DIR) {
  const services = {};
  for (const service of requiredServices) {
    if (!['xsuaa', 'destination', 'hana'].includes(service)) {
      throw new Error(`Unsupported service binding requested: ${service}`);
    }
    services[service] = [readBindingFile(service, bindingsDir)];
  }
  return JSON.stringify(services);
}

function configureCa(env = process.env) {
  const caFile = env.CUSTOM_CA_CERT_FILE || DEFAULT_CA_FILE;
  if (!fs.existsSync(caFile)) {
    if (env.CUSTOM_CA_CERT_FILE) {
      throw new Error(`Configured custom CA certificate is missing at ${caFile}`);
    }
    return;
  }
  if (!fs.statSync(caFile).isFile()) {
    throw new Error(`Configured custom CA certificate is not a file: ${caFile}`);
  }
  env.NODE_EXTRA_CA_CERTS = caFile;
}

function readElfMachine(libraryPath) {
  let header;
  try {
    header = fs.readFileSync(libraryPath);
  } catch {
    throw new Error(`SAP NW RFC SDK library is missing or unreadable at ${libraryPath}`);
  }
  if (header.length < 20 || header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') {
    throw new Error(`SAP NW RFC SDK library is not a valid ELF shared library: ${libraryPath}`);
  }
  const byteOrder = header[5];
  if (byteOrder !== 1 && byteOrder !== 2) {
    throw new Error(`SAP NW RFC SDK library has an unsupported ELF byte order: ${libraryPath}`);
  }
  return byteOrder === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
}

function checkRfcSdk({
  sdkPath = process.env.RFC_SDK_PATH || '/usr/sap/nwrfcsdk',
  platform = process.env.PLATFORM || 'linux/amd64',
  nodeArch = process.arch,
  runtimePlatform = process.platform,
  requireNodeRfc = false
} = {}) {
  const target = SUPPORTED_PLATFORMS[platform];
  if (!target) {
    throw new Error(`Unsupported PLATFORM '${platform}'; use linux/amd64 or linux/arm64`);
  }
  if (runtimePlatform !== 'linux' || nodeArch !== target.nodeArch) {
    throw new Error(`Container runtime does not match PLATFORM=${platform} (Node reports ${runtimePlatform}/${nodeArch})`);
  }

  const libraryPath = path.join(sdkPath, 'lib', 'libsapnwrfc.so');
  const actualMachine = readElfMachine(libraryPath);
  if (actualMachine !== target.elfMachine) {
    throw new Error(
      `SAP NW RFC SDK architecture mismatch at ${libraryPath}: expected ${target.label} ELF machine ${target.elfMachine}, found ${actualMachine}`
    );
  }

  if (requireNodeRfc) {
    try {
      require('node-rfc');
    } catch (error) {
      throw new Error(`node-rfc could not load with the mounted SAP NW RFC SDK (${error.code || 'load error'})`);
    }
  }
  return libraryPath;
}

function prepareRuntime(env = process.env) {
  configureCa(env);
  if (env.APP_ROLE === 'cap-local') {
    if (env.NODE_ENV !== 'test') {
      throw new Error('Local CAP profile must use NODE_ENV=test');
    }
    if (
      env.ENABLE_DEV_TOKEN_ISSUER !== 'true' ||
      typeof env.LOCAL_AUTH_SECRET !== 'string' ||
      env.LOCAL_AUTH_SECRET.trim().length < 32 ||
      typeof env.LOCAL_DEV_PASSWORD !== 'string' ||
      !env.LOCAL_DEV_PASSWORD.trim()
    ) {
      throw new Error('Local CAP profile requires ENABLE_DEV_TOKEN_ISSUER=true, LOCAL_AUTH_SECRET of at least 32 characters, and LOCAL_DEV_PASSWORD');
    }
  }
  const requiredServices = String(env.BINDING_SERVICES || '')
    .split(',')
    .map((service) => service.trim())
    .filter(Boolean);
  if (requiredServices.length) {
    env.VCAP_SERVICES = loadBindings(requiredServices, env.BINDINGS_DIR || DEFAULT_BINDINGS_DIR);
  }
  const localRfcRequired = env.APP_ROLE === 'cap-local' && env.REQUIRE_RFC_SDK === 'true';
  if (localRfcRequired) {
    const required = ['S4_DESTINATION_URL', 'S4_RFC_SYSNR', 'S4_CLIENT', 'S4_USERNAME', 'S4_PASSWORD'];
    const missing = required.filter((key) => !String(env[key] || '').trim());
    if (missing.length) throw new Error(`Local RFC configuration is missing: ${missing.join(', ')}`);
  }
  if ((env.APP_ROLE === 'cap' && env.REQUIRE_RFC_SDK !== 'false') || localRfcRequired) {
    const libraryPath = checkRfcSdk({ sdkPath: env.RFC_SDK_PATH, platform: env.PLATFORM, requireNodeRfc: true });
    const sdkLibDir = path.dirname(libraryPath);
    env.LD_LIBRARY_PATH = [sdkLibDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
}

function commandToRun(args = process.argv.slice(2)) {
  return args.length > 0 ? args : ['npm', 'start'];
}

function startApplication() {
  try {
    prepareRuntime();
  } catch (error) {
    console.error(`Docker startup configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const [command, ...args] = commandToRun();
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Unable to start application process: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code === null ? (signal ? 1 : 0) : code;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
}

if (require.main === module) startApplication();

module.exports = {
  checkRfcSdk,
  configureCa,
  loadBindings,
  prepareRuntime,
  readElfMachine,
  commandToRun
};
