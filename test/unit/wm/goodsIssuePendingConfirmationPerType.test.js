'use strict';

/**
 * Proves with tests:
 *  1. After an unknown outcome (504), SU claim stays `claiming`.
 *  2. A second post for the same reservation item is rejected while the attempt is sending/unconfirmed,
 *     with a "pending confirmation, do not post again" message.
 *  3. Verifies behavior across all movement types: 201, 261, 301, 311.
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { ATTEMPT_ENTITY } = attempts;
const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueIssuedSuStore = require('../../../srv/wm/goods-issue/GoodsIssueIssuedSuStore');

const { SELECT, DELETE } = cds.ql;

function initHandlers() {
  const handlers = {};
  const srv = { on: jest.fn((event, fn) => { handlers[event] = fn; }) };
  GoodsIssueHandler.init(srv);
  PerTypeGoodsIssueHandler.init(srv);
  return handlers;
}

const makeReq = (data) => ({
  data,
  user: { id: 'TESTUSER' },
  error: jest.fn((code, msg) => {
    const err = new Error(typeof msg === 'string' ? msg : code?.message || 'Error');
    err.status = typeof code === 'number' ? code : code?.status || 500;
    return err;
  })
});

const allAttempts = () => cds.db.run(SELECT.from(ATTEMPT_ENTITY));

describe('Goods Issue Pending Confirmation & Duplicate Post Prevention Per Movement Type', () => {
  const handlers = initHandlers();

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    await GoodsIssueIssuedSuStore.clear();
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);

    // Default safe pre-check mocks
    if (typeof GoodsIssueAdapter.revalidateStockBeforePosting === 'function') {
      jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
        StockReadSuccess: true,
        StockSufficient: true
      });
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    await GoodsIssueIssuedSuStore.clear();
  });

  // -------------------------------------------------------------
  // Movement Type 201: Goods Issue to Cost Center
  // -------------------------------------------------------------
  describe('Movement Type 201 (Goods Issue to Cost Center)', () => {
    const payload201 = {
      ReservationNo: '201001',
      ReservationItem: '0001',
      CostCenter: '1011101301',
      Material: '8000006645',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 10,
      Unit: 'EA',
      PostingDate: '2026-10-02'
    };

    it('retains unconfirmed attempt on 504 and blocks second post with "pending confirmation, do not post again"', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        ReservationNo: '201001',
        ReservationItem: '0001',
        CostCenter: '1011101301',
        Material: '8000006645',
        Plant: '1120',
        StorageLocation: 'HS01',
        OpenQty: 20
      });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockRejectedValue(
        Object.assign(new Error('Gateway timeout from SAP S/4HANA'), { status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' })
      );

      // Attempt 1: Encounter 504 unknown outcome
      const req1 = makeReq(payload201);
      await handlers.postGoodsIssue201(req1);

      expect(req1.error).toHaveBeenCalled();
      const firstStatus = req1.error.mock.calls[0][0];
      expect([500, 504]).toContain(typeof firstStatus === 'number' ? firstStatus : firstStatus?.status);

      // Verify attempt is tracked as unconfirmed in store
      const dbAttempts = await allAttempts();
      expect(dbAttempts).toHaveLength(1);
      expect(dbAttempts[0].Status).toBe('unconfirmed');
      expect(dbAttempts[0].ReservationNo).toBe('201001');
      expect(dbAttempts[0].ReservationItem).toBe('0001');

      // Attempt 2: Duplicate post for the same reservation item MUST be rejected with 409
      const req2 = makeReq(payload201);
      await handlers.postGoodsIssue201(req2);

      expect(req2.error).toHaveBeenCalledWith(
        409,
        expect.stringMatching(/pending confirmation, do not post again/i)
      );

      // SAP post method must NOT have been called a second time
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------
  // Movement Type 261: Goods Issue to Order (with Storage Units)
  // -------------------------------------------------------------
  describe('Movement Type 261 (Goods Issue to Order with Storage Units)', () => {
    const payload261 = {
      ReservationNo: '261001',
      ReservationItem: '0001',
      OrderNo: '1000856',
      Material: 'MAT-261-SU',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 50,
      Unit: 'KG',
      StorageUnits: ['SU-DRUM-261-01'],
      PostingDate: '2026-10-02'
    };

    it('after 504 unknown outcome: SU claim stays claiming, and second post is rejected with "pending confirmation, do not post again"', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        ReservationNo: '261001',
        ReservationItem: '0001',
        OrderNo: '1000856',
        Material: 'MAT-261-SU',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 50,
        RequiredQty: 50
      });

      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '261001',
        ReservationItem: '0001',
        Material: 'MAT-261-SU',
        Plant: '1120',
        StorageLocation: 'CS01',
        StockUnits: [
          { StorageUnit: 'SU-DRUM-261-01', AvailableStock: 50, Material: 'MAT-261-SU', Plant: '1120', StorageLocation: 'CS01' }
        ]
      });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockRejectedValue(
        Object.assign(new Error('Socket hangup during SAP posting'), { status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' })
      );

      // Attempt 1: Encounter 504 unknown outcome
      const req1 = makeReq(payload261);
      await handlers.postGoodsIssue261(req1);

      expect(req1.error).toHaveBeenCalled();

      // REQUIREMENT: Verify SU claim remains in 'claiming' status (never dropped on 504)
      const hasActiveClaim = await GoodsIssueIssuedSuStore.hasActiveClaimForReservation('261001', '0001');
      expect(hasActiveClaim).toBe(true);

      const dbAttempts = await allAttempts();
      expect(dbAttempts).toHaveLength(1);
      expect(dbAttempts[0].Status).toBe('unconfirmed');

      // Attempt 2: Duplicate post for the same reservation item MUST be rejected with 409
      const req2 = makeReq(payload261);
      await handlers.postGoodsIssue261(req2);

      expect(req2.error).toHaveBeenCalledWith(
        409,
        expect.stringMatching(/pending confirmation, do not post again/i)
      );

      // SAP post method was called exactly once
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------
  // Movement Type 301: Plant-to-Plant Stock Transfer
  // -------------------------------------------------------------
  describe('Movement Type 301 (Plant-to-Plant Stock Transfer)', () => {
    const payload301 = {
      ReservationNo: '301001',
      ReservationItem: '0001',
      Material: 'MAT-301-P2P',
      Plant: '1110',
      StorageLocation: 'CS01',
      ReceivingPlant: '1120',
      IssueQty: 25,
      Unit: 'KG',
      PostingDate: '2026-10-02'
    };

    it('retains unconfirmed attempt on 504 and blocks second post with "pending confirmation, do not post again"', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        ReservationNo: '301001',
        ReservationItem: '0001',
        Material: 'MAT-301-P2P',
        Plant: '1110',
        StorageLocation: 'CS01',
        ReceivingPlant: '1120',
        OpenQty: 50
      });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301').mockRejectedValue(
        Object.assign(new Error('Gateway timeout from SAP S/4HANA'), { status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' })
      );

      // Attempt 1: Encounter 504 unknown outcome
      const req1 = makeReq(payload301);
      await handlers.postGoodsIssue301(req1);

      expect(req1.error).toHaveBeenCalled();

      const dbAttempts = await allAttempts();
      expect(dbAttempts).toHaveLength(1);
      expect(dbAttempts[0].Status).toBe('unconfirmed');

      // Attempt 2: Duplicate post for the same reservation item MUST be rejected with 409
      const req2 = makeReq(payload301);
      await handlers.postGoodsIssue301(req2);

      expect(req2.error).toHaveBeenCalledWith(
        409,
        expect.stringMatching(/pending confirmation, do not post again/i)
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------
  // Movement Type 311: Storage Location Stock Transfer
  // -------------------------------------------------------------
  describe('Movement Type 311 (Storage Location Stock Transfer)', () => {
    const payload311 = {
      ReservationNo: '311001',
      ReservationItem: '0001',
      Material: 'MAT-311-SLOC',
      Plant: '1120',
      StorageLocation: 'CS01',
      ReceivingStorageLocation: 'CS02',
      IssueQty: 15,
      Unit: 'KG',
      PostingDate: '2026-10-02'
    };

    it('retains unconfirmed attempt on 504 and blocks second post with "pending confirmation, do not post again"', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        ReservationNo: '311001',
        ReservationItem: '0001',
        Material: 'MAT-311-SLOC',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingStorageLocation: 'CS02',
        OpenQty: 30
      });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue311').mockRejectedValue(
        Object.assign(new Error('Gateway timeout from SAP S/4HANA'), { status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' })
      );

      // Attempt 1: Encounter 504 unknown outcome
      const req1 = makeReq(payload311);
      await handlers.postGoodsIssue311(req1);

      expect(req1.error).toHaveBeenCalled();

      const dbAttempts = await allAttempts();
      expect(dbAttempts).toHaveLength(1);
      expect(dbAttempts[0].Status).toBe('unconfirmed');

      // Attempt 2: Duplicate post for the same reservation item MUST be rejected with 409
      const req2 = makeReq(payload311);
      await handlers.postGoodsIssue311(req2);

      expect(req2.error).toHaveBeenCalledWith(
        409,
        expect.stringMatching(/pending confirmation, do not post again/i)
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------
  // Mid-flight 'sending' attempt blocking
  // -------------------------------------------------------------
  describe('In-Flight sending attempt duplicate prevention', () => {
    it('blocks duplicate post while prior attempt is in status sending', async () => {
      // Simulate an attempt left in sending (e.g. process died mid-flight)
      await attempts.create({
        ReferenceDocument: 'REF-IN-FLIGHT-001',
        MovementType: '201',
        ReservationNo: '201999',
        ReservationItem: '0001',
        Material: '8000006645',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 5,
        Unit: 'EA'
      });

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        ReservationNo: '201999',
        ReservationItem: '0001',
        CostCenter: '1011101301',
        Material: '8000006645',
        Plant: '1120',
        StorageLocation: 'HS01',
        OpenQty: 10
      });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201');

      const req = makeReq({
        ReservationNo: '201999',
        ReservationItem: '0001',
        CostCenter: '1011101301',
        Material: '8000006645',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 5,
        Unit: 'EA'
      });

      await handlers.postGoodsIssue201(req);

      expect(req.error).toHaveBeenCalledWith(
        409,
        expect.stringMatching(/pending confirmation, do not post again/i)
      );
      expect(postSpy).not.toHaveBeenCalled();
    });
  });
});
