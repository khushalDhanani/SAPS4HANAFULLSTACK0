#!/usr/bin/env node
'use strict';

/**
 * Migration Script: migrate-legacy-queue-references.js
 *
 * Scans the GoodsIssueQueue entity for legacy records where QueueReference starts with 'GI-QUEUE-'.
 * For every matching row:
 *   1. Sets LegacyReference = true (enabling SAP MATDOC pre-replay checks)
 *   2. Normalizes QueueReference = ID (canonical UUID)
 *   3. Drops the legacy invented string without mutating SyncStatus, payloads, or audit timestamps.
 *
 * Usage:
 *   node tools/migrate-legacy-queue-references.js --dry-run
 *   node tools/migrate-legacy-queue-references.js --execute
 */

const QUEUE_ENTITY = 'saps4hana.wm.GoodsIssueQueue';

/**
 * Programmatically migrates legacy queue rows.
 *
 * @param {Object} db - CAP database instance (cds.db or tx)
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] - If true, scans and reports without updating
 * @returns {Promise<{
 *   dryRun: boolean,
 *   preMigrationCount: number,
 *   migratedCount: number,
 *   remainingLegacyPrefixCount: number,
 *   candidateIds: string[]
 * }>}
 */
async function migrateLegacyQueueRows(db, options = {}) {
  if (!db || typeof db.run !== 'function') {
    throw new Error('A bound CAP database service (cds.db) is required for migration');
  }

  const isDryRun = Boolean(options.dryRun);

  // 1. Pre-migration scan: identify legacy records
  const legacyRows = await db.run(
    SELECT.from(QUEUE_ENTITY).where("QueueReference LIKE 'GI-QUEUE-%'")
  );

  const preMigrationCount = Array.isArray(legacyRows) ? legacyRows.length : 0;
  const candidateIds = (legacyRows || []).map((r) => r.ID);

  if (isDryRun || preMigrationCount === 0) {
    return {
      dryRun: isDryRun,
      preMigrationCount,
      migratedCount: 0,
      remainingLegacyPrefixCount: preMigrationCount,
      candidateIds
    };
  }

  // 2. Perform atomic transactional update
  await db.tx(async (tx) => {
    for (const row of legacyRows) {
      await tx.run(
        UPDATE(QUEUE_ENTITY)
          .set({
            LegacyReference: true,
            QueueReference: row.ID
          })
          .where({ ID: row.ID })
      );
    }
  });

  // 3. Post-migration verification
  const remainingRows = await db.run(
    SELECT.from(QUEUE_ENTITY).where("QueueReference LIKE 'GI-QUEUE-%'")
  );
  const remainingLegacyPrefixCount = Array.isArray(remainingRows) ? remainingRows.length : 0;

  const migratedRows = await db.run(
    SELECT.from(QUEUE_ENTITY).where({ LegacyReference: true })
  );
  const migratedCount = Array.isArray(migratedRows) ? migratedRows.length : 0;

  return {
    dryRun: false,
    preMigrationCount,
    migratedCount,
    remainingLegacyPrefixCount,
    candidateIds
  };
}

// CLI Execution Wrapper
if (require.main === module) {
  const path = require('path');
  const cds = require('@sap/cds');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--execute');

  (async () => {
    try {
      console.log('Connecting to CAP Database...');
      if (!cds.model) {
        cds.model = await cds.load([
          path.resolve(__dirname, '../db'),
          path.resolve(__dirname, '../srv')
        ]);
      }
      const db = await cds.connect.to('db');

      // If running against an in-memory SQLite instance where tables are not yet created, deploy schema:
      try {
        await db.run(SELECT.one.from(QUEUE_ENTITY));
      } catch (tableErr) {
        if (tableErr.message && tableErr.message.includes('no such table')) {
          console.log('Deploying schema to in-memory database for local scan...');
          await cds.deploy(cds.model).to(db);
        }
      }

      console.log(`\n======================================================`);
      console.log(` Goods Issue Queue Legacy Reference Migration`);
      console.log(` Mode: ${dryRun ? 'DRY-RUN (read-only scan)' : 'EXECUTE (live migration)'}`);
      console.log(`======================================================\n`);

      const result = await migrateLegacyQueueRows(db, { dryRun });

      console.log(`Pre-migration legacy rows count (QueueReference LIKE 'GI-QUEUE-%'): ${result.preMigrationCount}`);

      if (dryRun) {
        console.log(`Candidate record IDs:`);
        if (result.candidateIds.length === 0) {
          console.log(`  (None found - database has zero legacy GI-QUEUE- records)`);
        } else {
          result.candidateIds.forEach((id) => console.log(`  - ${id}`));
        }
        console.log(`\n[DRY RUN COMPLETE] Zero database writes performed.`);
        console.log(`To apply these changes, run with: node tools/migrate-legacy-queue-references.js --execute`);
      } else {
        console.log(`Migrated rows count (LegacyReference = true, QueueReference = ID): ${result.migratedCount}`);
        console.log(`Remaining legacy prefix count: ${result.remainingLegacyPrefixCount}`);

        if (result.remainingLegacyPrefixCount === 0) {
          console.log(`\n[SUCCESS] All legacy rows successfully normalized.`);
        } else {
          console.error(`\n[WARNING] Some legacy rows still carry the GI-QUEUE- prefix!`);
          process.exitCode = 1;
        }
      }
    } catch (err) {
      console.error('\nMigration failed with error:', err.message || err);
      process.exit(1);
    }
  })();
}

module.exports = {
  migrateLegacyQueueRows
};
