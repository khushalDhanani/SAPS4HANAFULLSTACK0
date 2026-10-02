-- ============================================================================
-- Migration: 20261002_migrate_legacy_queue_references.sql
-- Target: SAP HANA Cloud HDI Container / saps4hana.wm.GoodsIssueQueue
-- Purpose: Normalize legacy pre-UUID queue references to canonical UUIDs (ID)
--          and set the LegacyReference flag to TRUE for MATDOC pre-replay checks.
-- Integrity: Strictly preserves SyncStatus, Reservation data, quantities, and audit dates.
-- ============================================================================

-- Step 1: Pre-migration verification (Check legacy row count and sample references)
SELECT COUNT(*) AS "PRE_MIGRATION_LEGACY_COUNT"
FROM "SAPS4HANA_WM_GOODSISSUEQUEUE"
WHERE "QUEUEREFERENCE" LIKE ('GI' || '-QUEUE-%');

-- Step 2: Atomic migration update
-- 1. Flag as LegacyReference = TRUE
-- 2. Normalize QueueReference to the canonical UUID (ID)
UPDATE "SAPS4HANA_WM_GOODSISSUEQUEUE"
SET
    "LEGACYREFERENCE" = TRUE,
    "QUEUEREFERENCE"  = "ID"
WHERE "QUEUEREFERENCE" LIKE ('GI' || '-QUEUE-%');

-- Step 3: Post-migration verification
-- Remaining legacy prefix count must be 0
SELECT COUNT(*) AS "POST_MIGRATION_REMAINING_PREFIX_COUNT"
FROM "SAPS4HANA_WM_GOODSISSUEQUEUE"
WHERE "QUEUEREFERENCE" LIKE ('GI' || '-QUEUE-%');

-- Total migrated rows flagged with LegacyReference = TRUE and QueueReference = ID
SELECT COUNT(*) AS "MIGRATED_CANONICAL_COUNT"
FROM "SAPS4HANA_WM_GOODSISSUEQUEUE"
WHERE "LEGACYREFERENCE" = TRUE
  AND "QUEUEREFERENCE" = "ID";
