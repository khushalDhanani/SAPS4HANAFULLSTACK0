#!/usr/bin/env node
'use strict';

/**
 * tools/scan-secrets.js
 *
 * Automated Secret Scanner for SAP S/4HANA Full-Stack Project.
 * Scans git-tracked files for credential leaks, tokens, private keys, and sensitive environment patterns.
 * Strictly adheres to AGENTS.md Security and Environment rules.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// Regex patterns for credential detection
const SECRET_RULES = [
  {
    name: 'Private Key Block',
    regex: /-----BEGIN (?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/i
  },
  {
    name: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: 'NVIDIA NIM API Key',
    regex: /\bnvapi-[A-Za-z0-9_-]{30,}\b/,
    nonTestOnly: true
  },
  {
    name: 'OpenAI API Key',
    regex: /\bsk-[A-Za-z0-9_-]{30,}\b/,
    nonTestOnly: true
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/,
    nonTestOnly: true
  },
  {
    name: 'Hardcoded S/4HANA Password in non-test file',
    regex: /(?:S4_PASSWORD|S4HANA_PASSWORD|SAP_PASSWORD)\s*[:=]\s*["'][^"'\s${}]{6,}["']/,
    nonTestOnly: true
  }
];

// File exclusions
const IGNORED_PATHS = [
  'node_modules',
  '.git',
  'dist',
  'package-lock.json',
  'test-results',
  'docs/archive',
  'tools/scan-secrets.js'
];

// Fails closed: an empty file list would otherwise report "0 secrets" without scanning anything.
function getTrackedFiles(exec = execSync) {
  let stdout;
  try {
    stdout = exec('git ls-files', { cwd: PROJECT_ROOT, encoding: 'utf8' });
  } catch (err) {
    throw new Error(`Cannot list tracked files (git ls-files failed): ${err.message}`);
  }
  const files = String(stdout)
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !IGNORED_PATHS.some((ignored) => f.startsWith(ignored)));
  if (files.length === 0) {
    throw new Error('git ls-files returned no files to scan');
  }
  return files;
}

function verifyGitignore() {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return { ok: false, message: '.gitignore does not exist!' };
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const requiredPatterns = ['.env', '.env.*', '.env.local'];
  const missing = requiredPatterns.filter((pattern) => !gitignoreContent.includes(pattern));

  if (missing.length > 0) {
    return { ok: false, message: `Missing required secret patterns in .gitignore: ${missing.join(', ')}` };
  }

  // Ensure no .env or .env.local file is tracked in git (excluding safe .env.example)
  try {
    const rawTracked = execSync('git ls-files .env .env.local .env.*', { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
    const trackedSecrets = rawTracked
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f && f !== '.env.example');

    if (trackedSecrets.length > 0) {
      return { ok: false, message: `FATAL: Sensitive environment file(s) are tracked in git: ${trackedSecrets.join(', ')}` };
    }
  } catch (_) {
    // ignore
  }

  return { ok: true };
}

function scanFile(relPath) {
  const fullPath = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(fullPath)) return [];
  try {
    if (!fs.statSync(fullPath).isFile()) return [];
  } catch (_) {
    return [];
  }

  // Check if binary
  const buffer = fs.readFileSync(fullPath);
  for (let i = 0; i < Math.min(buffer.length, 512); i++) {
    if (buffer[i] === 0) return []; // Binary file
  }

  const content = buffer.toString('utf8');
  const lines = content.split('\n');
  const findings = [];
  const isTest = relPath.startsWith('test/') || relPath.includes('.test.') || relPath.includes('fixtures/');

  lines.forEach((line, idx) => {
    SECRET_RULES.forEach((rule) => {
      if (rule.nonTestOnly && isTest) return;

      if (rule.regex.test(line)) {
        findings.push({
          file: relPath,
          line: idx + 1,
          rule: rule.name,
          snippet: line.trim().slice(0, 80)
        });
      }
    });
  });

  return findings;
}

function run() {
  console.log('[SECRET SCAN] Starting automated secret and credential scan...');

  const gitignoreCheck = verifyGitignore();
  if (!gitignoreCheck.ok) {
    console.error(`[SECRET SCAN] FAILED: ${gitignoreCheck.message}`);
    process.exit(1);
  }

  let trackedFiles;
  try {
    trackedFiles = getTrackedFiles();
  } catch (err) {
    console.error(`[SECRET SCAN] FAILED: ${err.message}`);
    process.exit(1);
  }
  console.log(`[SECRET SCAN] Inspecting ${trackedFiles.length} tracked files against ${SECRET_RULES.length} detection rules...`);

  let allFindings = [];
  for (const file of trackedFiles) {
    const findings = scanFile(file);
    if (findings.length > 0) {
      allFindings = allFindings.concat(findings);
    }
  }

  if (allFindings.length > 0) {
    console.error(`\n[SECRET SCAN] VIOLATION DETECTED: Found ${allFindings.length} exposed secret(s):`);
    allFindings.forEach((f) => {
      console.error(`  - ${f.file}:${f.line} [${f.rule}]`);
    });
    console.error('\nImmediate action required: Remove credentials from code, rotate keys, and use environment variables or BTP destinations.');
    process.exit(1);
  }

  console.log('[SECRET SCAN] SUCCESS: 0 secrets, credentials, or private keys detected. Gitignore rules verified.\n');
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = { scanFile, verifyGitignore, getTrackedFiles, SECRET_RULES };
