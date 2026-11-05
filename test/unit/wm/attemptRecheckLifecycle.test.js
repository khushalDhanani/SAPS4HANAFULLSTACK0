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

    test('never marks an attempt not_posted when SAP gave it a document number', async () => {
      const now = Date.now();
      await attempts.create({ ReferenceDocument: 'HU-WITH-DOC-0', MovementType: '311', IssueQty: 1, createdAt: new Date(now).toISOString() });
      await attempts.setStatus('HU-WITH-DOC-0', 'unconfirmed', { MaterialDocument: '4900012345', MaterialDocYear: '2026' });
      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue(null);
      jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({ Confirmed: false });
      jest.spyOn(attempts, '_findDeliveryForAttempt').mockResolvedValue(null);

      const summary = await attempts.recheck(GoodsIssueAdapter, now + 16 * MIN);

      expect(summary.NotPosted).toBe(0);
      expect((await attempts.getByReference('HU-WITH-DOC-0')).Status).toBe('unconfirmed');
    });
  });

  // =========================================================================
  // 2. Definitive Resolution Outcomes
  // =========================================================================
  describe('2. Resolution Outcomes', () => {
    // SAP stubbed at the adapter boundary, so the real _findDeliveryForAttempt runs. Delivery shape is the one the
    // store reads (store:424); the SAP side of it is not proven here.
    const deliveryAttempt = (ReferenceDocument) => ({
      ReferenceDocument, MovementType: '311', ReservationNo: '520311', ReservationItem: '0001', Material: '8000000023',
      Plant: '1120', StorageLocation: 'HS01', IssueQty: 10, PostingDate: '2026-10-24'
    });
    const candidate = (DeliveryNumber, over = {}) => ({ DeliveryNumber, ExternalId: '', CreatedOn: '20261024', Quantity: '10.000', ...over });
    const sapDouble = ({ byRef = null, candidates = [] }) => ({
      findPostedGoodsIssueByReference: async () => null,
      findDeliveryByReference: async () => byRef,
      findDeliveriesForReservationItem: async () => candidates
    });

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

    test('keeps status open past 15 minutes when two candidate deliveries match the attempt', async () => {
      const now = Date.now();
      await attempts.create(deliveryAttempt('GI-AMBIG-001'));
      const summary = await attempts.recheck(sapDouble({ candidates: [candidate('80000001'), candidate('80000002')] }), now + 20 * MIN);

      expect(summary).toMatchObject({ Checked: 1, StillOpen: 1, NotPosted: 0, DeliveryCreated: 0 });
      expect((await attempts.getByReference('GI-AMBIG-001')).Status).toBe('sending');
    });

    test('attributes a delivery found by exact LIFEX match without reading reservation candidates', async () => {
      const now = Date.now();
      await attempts.create(deliveryAttempt('GI-LIFEX-001'));
      const candidateRead = jest.fn();
      const sap = sapDouble({ byRef: { DeliveryNumber: '80000009' } });
      sap.findDeliveriesForReservationItem = candidateRead;
      await attempts.recheck(sap, now + 5 * MIN);

      expect((await attempts.getByReference('GI-LIFEX-001')).DeliveryNumber).toBe('80000009');
      expect(candidateRead).not.toHaveBeenCalled();
    });

    test('attributes the single candidate with no external id, same quantity and same posting date', async () => {
      const now = Date.now();
      await attempts.create(deliveryAttempt('GI-CAND-001'));
      await attempts.recheck(sapDouble({ candidates: [candidate('80000003')] }), now + 5 * MIN);

      const row = await attempts.getByReference('GI-CAND-001');
      expect(row.Status).toBe('delivery_created');
      expect(row.DeliveryNumber).toBe('80000003');
    });

    test.each([
      ['carries an external id', { ExternalId: 'OTHER-REF' }],
      ['was created on another day', { CreatedOn: '20261025' }],
      ['has another quantity', { Quantity: '11.000' }]
    ])('does not attribute a candidate that %s', async (_label, over) => {
      const now = Date.now();
      await attempts.create(deliveryAttempt('GI-CANDX-001'));
      await attempts.recheck(sapDouble({ candidates: [candidate('80000004', over)] }), now + 5 * MIN);

      const row = await attempts.getByReference('GI-CANDX-001');
      expect(row.Status).toBe('sending');
      expect(row.DeliveryNumber).toBe('');
    });

    test('keeps status and counts an error when the delivery lookup fails', async () => {
      const now = Date.now();
      await attempts.create(deliveryAttempt('GI-DLVERR-001'));
      const sap = sapDouble({});
      sap.findDeliveryByReference = async () => { throw new Error('LIKP read failed'); };
      const summary = await attempts.recheck(sap, now + 20 * MIN);

      expect(summary).toMatchObject({ Checked: 1, Errors: 1, NotPosted: 0 });
      expect((await attempts.getByReference('GI-DLVERR-001')).Status).toBe('sending');
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
