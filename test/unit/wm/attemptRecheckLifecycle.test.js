/**
 * test/unit/wm/attemptRecheckLifecycle.test.js
 *
 * Phase 3: Background Re-Check & Orphan Transaction Reconciliation Suite
 *
 * Validates:
 *  1. Temporal Thresholds:
 *     - < GI_ATTEMPT_RECHECK_AGE_MS (3 min): Ignored (still in normal execution window).
 *     - 3 min <= age < 15 min: Rechecked; kept open if document not yet visible in SAP.
 *     - >= GI_ATTEMPT_NOT_POSTED_AGE_MS (15 min): Marked 'not_posted' (definitive absence proven).
 *     - >= GI_UNCONFIRMED_MAX_AGE_MS (30 min): Lingering 'unconfirmed' marked 'needs-attention'.
 *  2. Resolution Outcomes:
 *     - Material Document found in SAP -> promoted to 'posted' with doc number & year.
 *     - Outbound Delivery created (L9/514 in LIKP-LIFEX) -> transitioned to 'delivery_created'.
 *     - Ambiguous candidate deliveries -> kept open (never falsely marked 'not_posted').
 *     - Adapter network / query error -> status preserved without alteration.
 *  3. Re-Confirm Job:
 *     - Retries readBackDocument for 'unconfirmed' attempts.
 *     - Promotes to 'posted' upon confirmation.
 *     - Reports structured summary { Checked, Confirmed, StillUnconfirmed, MarkedNeedsAttention, Errors }.
 *
 * [mock only, not SAP verification]
 */

'use strict';

const cds = require('@sap/cds');

// Test DB initialization
cds.test(__dirname + '/../../../');

const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

const { DELETE } = cds.ql;
const ATTEMPT_ENTITY = 'saps4hana.wm.GoodsIssuePostingAttempt';
const MIN = 60 * 1000;

describe('Phase 3: Background Re-Check & Orphan Transaction Reconciliation', () => {

  beforeEach(async () => {
    try {
      if (cds.db) {
        await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
      }
    } catch {
      // Memory store fallback
    }
    attempts.clearMemoryStore();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Temporal Age Thresholds in Re-Check
  // =========================================================================
  describe('1. Temporal Age Thresholds', () => {

    test('ignores attempts younger than recheckAgeMs (3 minutes)', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-YOUNG-001',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      const findSpy = jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference');

      // Executed 1 minute after creation (< 3 min threshold)
      const summary = await attempts.recheck(GoodsIssueAdapter, now + 1 * MIN);

      expect(summary.Checked).toBe(0);
      expect(findSpy).not.toHaveBeenCalled();
      const row = await attempts.getByReference('GI-YOUNG-001');
      expect(row.Status).toBe('sending');
    });

    test('rechecks attempts older than 3 minutes; keeps open if under 15 minutes', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-MIDAGE-001',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue(null);
      jest.spyOn(attempts, '_findDeliveryForAttempt').mockResolvedValue(null);

      // Executed 5 minutes after creation (>= 3 min, but < 15 min)
      const summary = await attempts.recheck(GoodsIssueAdapter, now + 5 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.StillOpen).toBe(1);
      expect(summary.NotPosted).toBe(0);

      const row = await attempts.getByReference('GI-MIDAGE-001');
      expect(row.Status).toBe('sending');
    });

    test('transitions attempt to not_posted when absent in SAP after 15 minutes', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-EXPIRED-001',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue(null);
      jest.spyOn(attempts, '_findDeliveryForAttempt').mockResolvedValue(null);

      // Executed 16 minutes after creation (>= 15 min)
      const summary = await attempts.recheck(GoodsIssueAdapter, now + 16 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.NotPosted).toBe(1);

      const row = await attempts.getByReference('GI-EXPIRED-001');
      expect(row.Status).toBe('not_posted');
      expect(row.LastError).toMatch(/not posted/i);
    });
  });

  // =========================================================================
  // 2. Definitive Resolution Outcomes
  // =========================================================================
  describe('2. Resolution Outcomes', () => {

    test('promotes attempt to posted when Material Document is discovered in SAP', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-DISCOVERED-001',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 5,
        PostingDate: '2026-10-24',
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue({
        MaterialDocument: '5000000201',
        MaterialDocumentYear: '2026'
      });

      const summary = await attempts.recheck(GoodsIssueAdapter, now + 4 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.Posted).toBe(1);

      const row = await attempts.getByReference('GI-DISCOVERED-001');
      expect(row.Status).toBe('posted');
      expect(row.MaterialDocument).toBe('5000000201');
      expect(row.MaterialDocYear).toBe('2026');
      expect(row.LastError).toBe('');
    });

    test('transitions attempt to delivery_created when outbound delivery (L9/514) was created', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-DELIV-001',
        MovementType: '311',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue(null);
      jest.spyOn(attempts, '_findDeliveryForAttempt').mockResolvedValue({
        DeliveryNumber: '0080000134'
      });

      const summary = await attempts.recheck(GoodsIssueAdapter, now + 5 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.DeliveryCreated).toBe(1);

      const row = await attempts.getByReference('GI-DELIV-001');
      expect(row.Status).toBe('delivery_created');
      expect(row.DeliveryNumber).toBe('0080000134');
      expect(row.LastError).toMatch(/outbound delivery 0080000134 instead of a material document/i);
    });

    test('keeps status open when candidate deliveries in SAP are ambiguous', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-AMBIG-001',
        MovementType: '311',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue(null);
      // Multiple candidates without external ID -> ambiguous
      jest.spyOn(attempts, '_findDeliveryForAttempt').mockResolvedValue('ambiguous');

      // Even past 15 min, ambiguous delivery keeps status open (never falsely marked not_posted)
      const summary = await attempts.recheck(GoodsIssueAdapter, now + 20 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.StillOpen).toBe(1);
      expect(summary.NotPosted).toBe(0);

      const row = await attempts.getByReference('GI-AMBIG-001');
      expect(row.Status).toBe('sending');
    });

    test('preserves attempt status when S/4HANA query encounters network error', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-NETERR-001',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockRejectedValue(new Error('Connection reset by peer'));

      const summary = await attempts.recheck(GoodsIssueAdapter, now + 20 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.Errors).toBe(1);
      expect(summary.NotPosted).toBe(0);

      const row = await attempts.getByReference('GI-NETERR-001');
      expect(row.Status).toBe('sending');
    });
  });

  // =========================================================================
  // 3. Re-Confirm Job for Unconfirmed Attempts
  // =========================================================================
  describe('3. Re-Confirm Job (reconfirmUnconfirmed)', () => {

    test('promotes unconfirmed attempt to posted when readBackDocument confirms persistence', async () => {
      await attempts.create({
        ReferenceDocument: 'GI-UNCONF-OK',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10
      });

      await attempts.setStatus('GI-UNCONF-OK', 'unconfirmed', {
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026'
      });

      jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026',
        Confirmed: true,
        Status: 'confirmed'
      });

      const summary = await attempts.reconfirmUnconfirmed(GoodsIssueAdapter);

      expect(summary.Checked).toBe(1);
      expect(summary.Confirmed).toBe(1);
      expect(summary.StillUnconfirmed).toBe(0);

      const row = await attempts.getByReference('GI-UNCONF-OK');
      expect(row.Status).toBe('posted');
      expect(row.MaterialDocument).toBe('5000000201');
    });

    test('marks unconfirmed attempt as needs-attention after exceeding maximum age (30 minutes)', async () => {
      const now = Date.now();
      await attempts.create({
        ReferenceDocument: 'GI-UNCONF-OLD',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 10,
        createdAt: new Date(now).toISOString()
      });

      await attempts.setStatus('GI-UNCONF-OLD', 'unconfirmed', {
        MaterialDocument: '5000000999',
        MaterialDocYear: '2026'
      });

      // Still unconfirmed in SAP
      jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({
        MaterialDocument: '5000000999',
        MaterialDocYear: '2026',
        Confirmed: false,
        Status: 'posted, confirmation pending'
      });

      // 35 minutes later
      const summary = await attempts.reconfirmUnconfirmed(GoodsIssueAdapter, now + 35 * MIN);

      expect(summary.Checked).toBe(1);
      expect(summary.Confirmed).toBe(0);
      expect(summary.MarkedNeedsAttention).toBe(1);

      const row = await attempts.getByReference('GI-UNCONF-OLD');
      expect(row.Status).toBe('needs-attention');
      expect(row.LastError).toMatch(/marked needs-attention/i);
    });
  });
});
