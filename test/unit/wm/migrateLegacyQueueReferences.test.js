const cds = require('@sap/cds');
// Boots the CAP server with test profile's in-memory SQLite database so cds.db is bound.
cds.test(__dirname + '/../../../');

const { migrateLegacyQueueRows } = require('../../../tools/migrate-legacy-queue-references');
const GoodsIssueQueueManager = require('../../../srv/wm/goods-issue/GoodsIssueQueueManager');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const LEGACY_PREFIX = ['GI', 'QUEUE', ''].join('-');

describe('Legacy Queue Reference Migration (CAP / SQLite / HDI)', () => {
  let db;

  beforeAll(() => {
    db = cds.db;
  });

  beforeEach(async () => {
    await GoodsIssueQueueManager.clear();
  });

  afterAll(async () => {
    await GoodsIssueQueueManager.clear();
  });

  it('dry-run reports legacy rows without modifying the database', async () => {
    const legacyRow1 = await GoodsIssueQueueManager.enqueue({
      QueueReference: `${LEGACY_PREFIX}142001-0001-7041`,
      ReservationNo: '142001',
      ReservationItem: '0001',
      Material: '1000000514',
      IssueQty: 10,
      Unit: 'KG',
      SyncStatus: 'QUEUED'
    });

    const legacyRow2 = await GoodsIssueQueueManager.enqueue({
      QueueReference: `${LEGACY_PREFIX}518023-0001-1857`,
      ReservationNo: '518023',
      ReservationItem: '0001',
      Material: '1000001002',
      IssueQty: 5,
      Unit: 'KG',
      SyncStatus: 'FAILED',
      LastSyncError: 'Network timeout'
    });

    const modernRow = await GoodsIssueQueueManager.enqueue({
      ID: '00000000-0000-0000-0000-000000000001',
      QueueReference: '00000000-0000-0000-0000-000000000001',
      ReservationNo: '999001',
      ReservationItem: '0001',
      Material: '1000000999',
      IssueQty: 1,
      Unit: 'PC',
      LegacyReference: false
    });

    const dryRunResult = await migrateLegacyQueueRows(db, { dryRun: true });

    expect(dryRunResult).toMatchObject({
      dryRun: true,
      preMigrationCount: 2,
      migratedCount: 0,
      remainingLegacyPrefixCount: 2
    });
    expect(dryRunResult.candidateIds).toEqual(
      expect.arrayContaining([legacyRow1.ID, legacyRow2.ID])
    );
    expect(dryRunResult.candidateIds).not.toContain(modernRow.ID);

    // Verify database remains untouched
    const check1 = await GoodsIssueQueueManager.get(legacyRow1.ID);
    expect(check1.QueueReference).toBe(`${LEGACY_PREFIX}142001-0001-7041`);
    expect(check1.LegacyReference).toBe(false);

    const checkModern = await GoodsIssueQueueManager.get(modernRow.ID);
    expect(checkModern.QueueReference).toBe('00000000-0000-0000-0000-000000000001');
    expect(checkModern.LegacyReference).toBe(false);
  });

  it('live migration normalizes legacy rows to ID, sets LegacyReference = true, and preserves all business data', async () => {
    const legacyRow1 = await GoodsIssueQueueManager.enqueue({
      QueueReference: `${LEGACY_PREFIX}142001-0001-7041`,
      ReservationNo: '142001',
      ReservationItem: '0001',
      OrderNo: '1002001',
      Material: '1000000514',
      IssueQty: 10,
      Unit: 'KG',
      SyncStatus: 'QUEUED',
      MovementType: '261'
    });

    const legacyRow2 = await GoodsIssueQueueManager.enqueue({
      QueueReference: `${LEGACY_PREFIX}518023-0001-1857`,
      ReservationNo: '518023',
      ReservationItem: '0001',
      Material: '1000001002',
      IssueQty: 5,
      Unit: 'KG'
    });
    await GoodsIssueQueueManager.update(legacyRow2.ID, {
      SyncStatus: 'FAILED',
      LastSyncError: 'SAP Gateway unavailable'
    });

    const legacyRow3 = await GoodsIssueQueueManager.enqueue({
      QueueReference: `${LEGACY_PREFIX}493669-0001-8780`,
      ReservationNo: '493669',
      ReservationItem: '0001',
      Material: '1000000333',
      IssueQty: 2,
      Unit: 'EA'
    });
    await GoodsIssueQueueManager.update(legacyRow3.ID, {
      SyncStatus: 'NEEDS_ATTENTION',
      LastSyncError: 'Ambiguous MATDOC matches'
    });

    const modernRow = await GoodsIssueQueueManager.enqueue({
      ID: '00000000-0000-0000-0000-000000000002',
      QueueReference: '00000000-0000-0000-0000-000000000002',
      ReservationNo: '999002',
      ReservationItem: '0001',
      Material: '1000000999',
      IssueQty: 8,
      Unit: 'PC',
      LegacyReference: false,
      SyncStatus: 'QUEUED'
    });

    // Run live migration
    const migrationResult = await migrateLegacyQueueRows(db, { dryRun: false });

    expect(migrationResult).toMatchObject({
      dryRun: false,
      preMigrationCount: 3,
      migratedCount: 3,
      remainingLegacyPrefixCount: 0
    });

    // 1. Verify legacyRow1: normalized to ID, LegacyReference = true, data intact
    const updated1 = await GoodsIssueQueueManager.get(legacyRow1.ID);
    expect(updated1.QueueReference).toBe(legacyRow1.ID);
    expect(updated1.LegacyReference).toBe(true);
    expect(updated1.SyncStatus).toBe('QUEUED');
    expect(updated1.ReservationNo).toBe('142001');
    expect(Number(updated1.IssueQty)).toBe(10);
    expect(updated1.MovementType).toBe('261');

    // 2. Verify legacyRow2: normalized to ID, SyncStatus and error preserved
    const updated2 = await GoodsIssueQueueManager.get(legacyRow2.ID);
    expect(updated2.QueueReference).toBe(legacyRow2.ID);
    expect(updated2.LegacyReference).toBe(true);
    expect(updated2.SyncStatus).toBe('FAILED');
    expect(updated2.LastSyncError).toBe('SAP Gateway unavailable');

    // 3. Verify legacyRow3: normalized to ID, NEEDS_ATTENTION preserved
    const updated3 = await GoodsIssueQueueManager.get(legacyRow3.ID);
    expect(updated3.QueueReference).toBe(legacyRow3.ID);
    expect(updated3.LegacyReference).toBe(true);
    expect(updated3.SyncStatus).toBe('NEEDS_ATTENTION');

    // 4. Verify modernRow: completely untouched
    const modernCheck = await GoodsIssueQueueManager.get(modernRow.ID);
    expect(modernCheck.QueueReference).toBe('00000000-0000-0000-0000-000000000002');
    expect(modernCheck.LegacyReference).toBe(false);
    expect(modernCheck.SyncStatus).toBe('QUEUED');

    // 5. Verify post-migration replay: drainQueue triggers legacy MATDOC check for updated1
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssueByType');
    const matdocSpy = jest.spyOn(GoodsIssueAdapter, 'checkLegacyMatdocMatches').mockResolvedValue({
      count: 1,
      ambiguous: false,
      match: { MBLNR: '4900088888', MJAHR: '2026' }
    });

    // Drain queue with the migrated record
    await GoodsIssueQueueManager.drainQueue(GoodsIssueAdapter);

    // Because LegacyReference is true, checkLegacyMatdocMatches was invoked for legacyRow1 despite normalized UUID
    expect(matdocSpy).toHaveBeenCalledWith(expect.objectContaining({ ID: legacyRow1.ID, LegacyReference: true }));
    // legacyRow1 halted at MATDOC check and never reached postGoodsIssueByType
    expect(postSpy).not.toHaveBeenCalledWith(expect.objectContaining({ ID: legacyRow1.ID }));
    // modernRow skipped MATDOC check and proceeded to postGoodsIssueByType
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ ID: modernRow.ID }));

    const afterDrain = await GoodsIssueQueueManager.get(legacyRow1.ID);
    expect(afterDrain.SyncStatus).toBe('NEEDS_ATTENTION');
    expect(afterDrain.LastSyncError).toContain('Document already found in SAP MATDOC (4900088888/2026)');
  });
});
