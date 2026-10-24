'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Portably resolves Playwright's chromium / browser automation entry points.
 *
 * Resolution order:
 * 1. Standard installed module ('playwright' or 'playwright-core')
 * 2. Environment variable PLAYWRIGHT_PATH or PLAYWRIGHT_DRIVER_PATH
 * 3. Local user cache fallbacks (macOS / Linux / Windows)
 */
function resolvePlaywright() {
  // 1. Check standard node_modules
  for (const mod of ['playwright', 'playwright-core']) {
    try {
      return require(mod);
    } catch (_) {
      // Continue to next resolution strategy
    }
  }

  // 2. Check environment variable override
  const envPath = process.env.PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_DRIVER_PATH;
  if (envPath) {
    try {
      return require(envPath);
    } catch (err) {
      console.warn(`[playwrightLoader] Warning: Failed to load from PLAYWRIGHT_PATH="${envPath}": ${err.message}`);
    }
  }

  // 3. Check well-known local user cache directories
  const home = os.homedir();
  const candidatePaths = [
    path.join(home, 'Library/Caches/ms-playwright-go/1.57.0/package'),
    path.join(home, '.cache/ms-playwright-go/1.57.0/package'),
    path.join(home, 'AppData/Local/ms-playwright-go/1.57.0/package')
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        return require(candidate);
      } catch (_) {
        // Continue
      }
    }
  }

  throw new Error(
    '[playwrightLoader] Playwright could not be resolved. ' +
    'Please run "npm install --save-dev playwright" or set PLAYWRIGHT_PATH.'
  );
}

const playwright = resolvePlaywright();

module.exports = playwright;
