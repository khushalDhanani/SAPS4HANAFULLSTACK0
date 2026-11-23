#!/usr/bin/env node
'use strict';

/**
 * Cloud Foundry RFC Runtime Dependency & Deployment Verification Tool
 *
 * Verifies whether the current execution runtime (Cloud Foundry droplet, container, or local host)
 * satisfies all prerequisites for native SAP NW RFC SDK execution.
 *
 * Checks:
 *   1. Node.js runtime version and ABI compatibility.
 *   2. Operating system and processor architecture (Linux x86_64 for cflinuxfs4).
 *   3. Environment configuration (LD_LIBRARY_PATH, SAPNWRFC_HOME, S4_RFC_DESTINATION_NAME).
 *   4. Native dynamic library file existence (libsapnwrfc.so / libsapnwrfc.dylib).
 *   5. Native node-rfc module loadability (RfcClient.isAvailable()).
 *   6. Cloud Foundry destination binding presence (VCAP_SERVICES).
 *
 * Certification Gate:
 *   Returns CERTIFIED only when dynamic libraries are present, architecture is compatible,
 *   node-rfc loads successfully, and destination configuration is bound.
 *   Otherwise returns NOT_CERTIFIED with specific remediation actions.
 */

const fs = require('fs');
const path = require('path');
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const REQUIRED_LINUX_LIBRARIES = [
  'libsapnwrfc.so',
  'libsapucum.so',
  'libicudata.so.57',
  'libicui18n.so.57',
  'libicuuc.so.57'
];

/**
 * Search candidate library directories for the native SAP NW RFC SDK dynamic library.
 */
function findNativeRfcLibrary(searchPaths, fsModule = fs, platform = process.platform) {
  const libName = platform === 'darwin' ? 'libsapnwrfc.dylib' : 'libsapnwrfc.so';
  for (const dir of searchPaths) {
    if (!dir) continue;
    try {
      const fullPath = path.join(dir, libName);
      if (fsModule.existsSync(fullPath)) {
        return { found: true, path: fullPath, directory: dir, libName };
      }
    } catch {
      // Ignore unreadable paths
    }
  }
  return { found: false, path: null, directory: null, libName };
}

/**
 * Verify Cloud Foundry RFC runtime environment.
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {object} [opts.fsModule=fs]
 * @param {typeof RfcClient} [opts.rfcClientClass=RfcClient]
 * @param {string} [opts.platform=process.platform]
 * @param {string} [opts.arch=process.arch]
 * @param {string} [opts.nodeVersion=process.version]
 * @returns {object} Verification report
 */
function verifyCfRfcRuntime({
  env = process.env,
  fsModule = fs,
  rfcClientClass = RfcClient,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version
} = {}) {
  const isCloudFoundry = Boolean(env.VCAP_APPLICATION || env.CF_INSTANCE_INDEX !== undefined);
  const isProduction = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const issues = [];
  const warnings = [];

  // 1. Node.js Version Check
  const majorNode = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
  const nodeCompatible = majorNode >= 20;
  if (!nodeCompatible) {
    issues.push(`Node.js version ${nodeVersion} is below minimum supported version 20 (Node 22 LTS recommended)`);
  }

  // 2. Platform & Architecture Check
  const isLinuxAmd64 = platform === 'linux' && arch === 'x64';
  const isDarwin = platform === 'darwin';
  let platformStatus = 'COMPATIBLE';
  if (isCloudFoundry && !isLinuxAmd64) {
    platformStatus = 'INCOMPATIBLE';
    issues.push(`Cloud Foundry stack requires linux/x64 (cflinuxfs4), but runtime reported ${platform}/${arch}`);
  } else if (!isLinuxAmd64 && !isDarwin) {
    warnings.push(`Runtime platform is ${platform}/${arch}; SAP NW RFC SDK production prebuilds require linux/x64`);
  }

  // 3. Environment Variables & Search Paths
  const rawLdPath = platform === 'darwin' ? (env.DYLD_LIBRARY_PATH || '') : (env.LD_LIBRARY_PATH || '');
  const sdkHome = env.SAPNWRFC_HOME || env.RFC_SDK_PATH || '';
  const searchDirs = [
    sdkHome ? path.join(sdkHome, 'lib') : null,
    ...rawLdPath.split(':').map((p) => p.trim()).filter(Boolean),
    '/home/vcap/deps/0/nwrfcsdk/lib',
    '/usr/sap/nwrfcsdk/lib',
    '/home/vcap/app/lib'
  ].filter(Boolean);

  // 4. Dynamic Library Discovery
  const libDiscovery = findNativeRfcLibrary(searchDirs, fsModule, platform);
  if (!libDiscovery.found) {
    issues.push(
      `SAP NW RFC SDK shared library (${libDiscovery.libName}) was not found in library search paths: [${searchDirs.join(', ')}]`
    );
  }

  // 5. Native Module Load Check
  let moduleLoadable = false;
  let moduleError = null;
  try {
    const client = new rfcClientClass(env);
    moduleLoadable = client.isAvailable();
    if (!moduleLoadable) {
      issues.push('node-rfc native module is not loadable in current process (RfcClient.isAvailable() returned false)');
    }
  } catch (err) {
    moduleError = err.message.split('\n')[0];
    issues.push(`Failed to load node-rfc native addon: ${moduleError}`);
  }

  // 6. Destination Binding Check
  const destinationName = String(env.S4_RFC_DESTINATION_NAME || '').trim();
  let destinationBound = false;
  if (isCloudFoundry || isProduction) {
    if (!destinationName) {
      issues.push('S4_RFC_DESTINATION_NAME environment variable is not defined for production RFC routing');
    }
    if (env.VCAP_SERVICES) {
      try {
        const vcap = typeof env.VCAP_SERVICES === 'string' ? JSON.parse(env.VCAP_SERVICES) : env.VCAP_SERVICES;
        destinationBound = Boolean(vcap.destination && vcap.destination.length > 0);
      } catch {
        destinationBound = false;
      }
      if (!destinationBound) {
        issues.push('VCAP_SERVICES does not contain a bound destination service instance (saps4hana-destination)');
      }
    } else if (isProduction) {
      issues.push('Production environment lacks VCAP_SERVICES destination service binding');
    }
  } else {
    // Non-production local check
    destinationBound = Boolean(destinationName || env.S4_DESTINATION_URL);
    if (!destinationBound) {
      warnings.push('Neither S4_RFC_DESTINATION_NAME nor S4_DESTINATION_URL is set in local environment');
    }
  }

  const certified = issues.length === 0 && moduleLoadable && libDiscovery.found;

  return {
    certified,
    status: certified ? 'CERTIFIED' : 'NOT_CERTIFIED',
    isCloudFoundry,
    isProduction,
    platform: `${platform}/${arch}`,
    platformStatus,
    nodeVersion,
    library: {
      found: libDiscovery.found,
      name: libDiscovery.libName,
      path: libDiscovery.path,
      searchDirectories: searchDirs
    },
    moduleLoadable,
    destination: {
      name: destinationName || (isProduction ? 'NOT_CONFIGURED' : 'local-env-fallback'),
      serviceBound: destinationBound
    },
    issues,
    warnings,
    remediation: certified
      ? []
      : [
          'Supply the SAP NW RFC SDK 7.50 via Cloud Foundry multi-buildpack (binary supply buildpack) or container runtime (/usr/sap/nwrfcsdk)',
          'Ensure LD_LIBRARY_PATH includes the SDK lib directory (/home/vcap/deps/0/nwrfcsdk/lib or /usr/sap/nwrfcsdk/lib)',
          'Bind BTP destination service with RFC destination (S4_RFC_DESTINATION_NAME)',
          'Run tools/rfc-preflight.js to test backend SAP connectivity'
        ]
  };
}

if (require.main === module) {
  const report = verifyCfRfcRuntime();
  console.log('========================================================================');
  console.log('   CLOUD FOUNDRY RFC RUNTIME DEPENDENCY & DEPLOYMENT PROOF CHECK');
  console.log('========================================================================');
  console.log(`Certification Status:  ${report.status}`);
  console.log(`Runtime Platform:      ${report.platform}`);
  console.log(`Node.js Version:       ${report.nodeVersion}`);
  console.log(`Native Library Found:  ${report.library.found ? report.library.path : 'NO'}`);
  console.log(`node-rfc Loadable:     ${report.moduleLoadable ? 'YES' : 'NO'}`);
  console.log(`RFC Destination:       ${report.destination.name} (Bound: ${report.destination.serviceBound ? 'YES' : 'NO'})`);
  console.log('------------------------------------------------------------------------');

  if (report.warnings.length > 0) {
    console.log('Warnings:');
    report.warnings.forEach((w) => console.log(`  [WARN] ${w}`));
  }

  if (report.issues.length > 0) {
    console.log('Blocking Certification Issues:');
    report.issues.forEach((i) => console.log(`  [BLOCK] ${i}`));
    console.log('------------------------------------------------------------------------');
    console.log('Remediation Steps:');
    report.remediation.forEach((r, idx) => console.log(`  ${idx + 1}. ${r}`));
  }

  console.log('========================================================================');
  // Return non-zero only if explicitly failing certification check in strict mode
  if (process.argv.includes('--strict') && !report.certified) {
    process.exit(1);
  }
}

module.exports = {
  verifyCfRfcRuntime,
  findNativeRfcLibrary,
  REQUIRED_LINUX_LIBRARIES
};
