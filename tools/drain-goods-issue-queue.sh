#!/usr/bin/env bash
# ==============================================================================
# Drain Goods Issue Dispatch Queue (Movement 261) to SAP S/4HANA
# ==============================================================================
# Reads all pending ('QUEUED', 'FAILED') items from the durable CAP GoodsIssueQueue
# database and retries transactional posting against SAP S/4HANA Gateway services.
#
# Usage:
#   ./drain-goods-issue-queue.sh
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== SAP S/4HANA Goods Issue Dispatch Queue Drain ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

node -e "
const cds = require('@sap/cds');

async function run() {
  const db = await cds.connect.to('db');
  await cds.deploy('*').to(db);

  const GoodsIssueQueueManager = require('./srv/wm/goods-issue/GoodsIssueQueueManager');
  const GoodsIssueAdapter = require('./srv/integration/s4hana/wm/GoodsIssueAdapter');

  if (!GoodsIssueQueueManager.isAvailable()) {
    console.error('ERROR: CAP Database is not bound to this environment. Queue cannot be accessed.');
    process.exit(1);
  }

  const summary = await GoodsIssueQueueManager.getSummary();
  console.log('Current Queue Status:');
  console.log('  Total Records : ' + summary.TotalCount);
  console.log('  Pending Sync  : ' + summary.QueuedCount);
  console.log('');

  if (summary.QueuedCount === 0) {
    console.log('No pending items to drain.');
    process.exit(0);
  }

  console.log('Draining queue against SAP S/4HANA...');
  const result = await GoodsIssueQueueManager.drainQueue(GoodsIssueAdapter);

  console.log('');
  console.log('Drain Result:');
  console.log('  Attempted        : ' + result.Attempted);
  console.log('  Synced to SAP    : ' + result.SyncedToSap);
  console.log('  Failed / Retained: ' + result.Failed);
  console.log('  Remaining Pending: ' + result.RemainingQueued);
  console.log('  Message          : ' + result.Message);
  console.log('');

  if (result.SyncedToSap > 0) {
    console.log('Successfully posted items:');
    const posted = result.Items.filter(i => i.SyncStatus === 'POSTED_IN_SAP');
    for (const item of posted) {
      console.log('  ' + item.QueueReference + ' -> MaterialDocument: ' + item.SapMaterialDocument + ' (' + item.SapMaterialDocYear + ')');
    }
  }

  if (result.Failed > 0) {
    console.log('Remaining pending items:');
    const pending = result.Items.filter(i => i.SyncStatus === 'FAILED' || i.SyncStatus === 'QUEUED');
    for (const item of pending) {
      console.log('  ' + item.QueueReference + ' -> Status: ' + item.SyncStatus + ' | Error: ' + item.LastSyncError);
    }
  }
}

run().catch(err => {
  console.error('Fatal drain error:', err);
  process.exit(1);
});
"
