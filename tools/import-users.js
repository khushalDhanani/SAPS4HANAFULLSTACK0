#!/usr/bin/env node
'use strict';

/**
 * import-users.js
 *
 * Bulk-import users from a CSV file into the APP_USERS_FILE JSON format.
 *
 * Usage:
 *   node tools/import-users.js --input users.csv --output config/app-users.json
 *   node tools/import-users.js --input users.csv --output config/app-users.json --dry-run
 *   node tools/import-users.js --input users.csv --merge config/app-users.json --output config/app-users.json
 *
 * Input CSV format (header required):
 *   username,roles
 *   JSMITH,"Viewer,SalesManager"
 *   ACLARKE,PurchasingManager
 *   # lines starting with # are ignored
 *
 * The output file is a JSON object ready for APP_USERS_FILE or APP_USER_ROLES.
 * --merge reads an existing JSON output file and merges new rows into it (new rows win on conflict).
 *
 * Roles validated against the known application roles. Invalid rows are skipped with a warning.
 * No passwords are read, written, or logged.
 *
 * Exit codes: 0 = success, 1 = error (see stderr).
 */

const fs = require('fs');
const path = require('path');

const KNOWN_ROLES = new Set([
  'Admin', 'Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager',
  'WarehouseClerk', 'WarehouseManager', 'SapLogsReader'
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input')    { args.input   = argv[++i]; continue; }
    if (a === '--output')   { args.output  = argv[++i]; continue; }
    if (a === '--merge')    { args.merge   = argv[++i]; continue; }
    if (a === '--dry-run')  { args.dryRun  = true;      continue; }
    if (a === '--help' || a === '-h') { args.help = true; }
  }
  return args;
}

function printHelp() {
  console.log(`
import-users.js — Bulk import users from CSV into APP_USERS_FILE JSON format

Usage:
  node tools/import-users.js --input <csv> --output <json>
  node tools/import-users.js --input <csv> --merge <existing-json> --output <json>
  node tools/import-users.js --input <csv> --output <json> --dry-run

Options:
  --input   <file>  Input CSV file (required). Header: username,roles
  --output  <file>  Output JSON file (required unless --dry-run)
  --merge   <file>  Existing JSON file to merge new rows into (new rows win)
  --dry-run         Print result to stdout without writing the output file
  --help            Show this message

Known roles: ${[...KNOWN_ROLES].join(', ')}

CSV example:
  username,roles
  JSMITH,"Viewer,SalesManager"
  ACLARKE,PurchasingManager
  # comment lines are ignored
`.trim());
}

function parseCsv(text) {
  const users = {};
  let warnings = 0;
  let imported = 0;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  if (!lines.length) {
    console.error('ERROR: CSV file is empty.');
    process.exit(1);
  }
  const header = lines[0].toLowerCase();
  if (!header.startsWith('username')) {
    console.error('ERROR: CSV must start with a "username,roles" header row.');
    process.exit(1);
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) continue;

    const sep = line.indexOf(',');
    if (sep === -1) {
      console.warn(`WARN line ${i + 1}: no comma found, skipping: ${line}`);
      warnings++;
      continue;
    }

    const rawUser = line.slice(0, sep).trim().toUpperCase(); // store in uppercase for readability
    const rawRoles = line.slice(sep + 1).trim().replace(/^"|"$/g, '');

    if (!rawUser || !/^[A-Z0-9@._-]{1,40}$/.test(rawUser)) {
      console.warn(`WARN line ${i + 1}: invalid user name '${rawUser}', skipping`);
      warnings++;
      continue;
    }

    const roles = rawRoles.split(',').map((r) => r.trim()).filter(Boolean);
    const unknown = roles.filter((r) => !KNOWN_ROLES.has(r));
    if (unknown.length) {
      console.warn(`WARN line ${i + 1}: user ${rawUser} has unknown role(s) [${unknown.join(', ')}], skipping`);
      warnings++;
      continue;
    }

    const finalRoles = roles.length ? [...new Set(roles)] : ['Viewer'];
    users[rawUser] = finalRoles;
    imported++;
    console.log(`  ${rawUser}: [${finalRoles.join(', ')}]`);
  }

  return { users, imported, warnings };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.input) {
    console.error('ERROR: --input <csv> is required.');
    printHelp();
    process.exit(1);
  }
  if (!args.output && !args.dryRun) {
    console.error('ERROR: --output <json> is required (or use --dry-run to print to stdout).');
    printHelp();
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let csvText;
  try {
    csvText = fs.readFileSync(inputPath, 'utf8');
  } catch (e) {
    console.error(`ERROR: Cannot read ${inputPath}: ${e.message}`);
    process.exit(1);
  }

  console.log(`\nImporting from: ${inputPath}`);

  // Start with existing merge file if requested
  let merged = {};
  if (args.merge) {
    const mergePath = path.resolve(args.merge);
    if (fs.existsSync(mergePath)) {
      try {
        merged = JSON.parse(fs.readFileSync(mergePath, 'utf8'));
        console.log(`Merging into existing file: ${mergePath} (${Object.keys(merged).length} existing users)`);
      } catch (e) {
        console.error(`ERROR: Cannot parse merge file ${mergePath}: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.warn(`WARN: --merge file not found (${mergePath}), starting fresh.`);
    }
  }

  const { users, imported, warnings } = parseCsv(csvText, inputPath);

  // New rows win over merge
  const output = { ...merged, ...users };

  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.dryRun) {
    console.log('\n--- DRY RUN: output JSON (not written) ---\n');
    console.log(json);
  } else {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json, 'utf8');
    console.log(`\nWritten: ${outputPath}`);
  }

  console.log(`\nSummary: ${imported} user(s) imported, ${warnings} warning(s)`);
  console.log(`Total in output: ${Object.keys(output).length} user(s)`);
  if (warnings > 0) {
    console.log('Some rows were skipped (see WARNs above). Fix the CSV and re-run to include them.');
  }
}

main();
