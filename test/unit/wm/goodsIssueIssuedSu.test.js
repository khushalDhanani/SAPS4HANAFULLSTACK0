/**
 * goodsIssueIssuedSu.test.js
 * Comprehensive tests for Option (b) Issued Storage Units persistence & tracking:
 *  1. Two reservations cannot claim the same drum (400 before SAP is called).
 *  2. Parallel Promise.all claims for one drum (exactly one wins).
 *  3. Second reservation takes the 30 kg residual; partial residual is suggested at reduced qty.
 *  4. Queue replay (drain job) records claims using the same code path.
 *  5. Claiming row resolved after a crash (found in SAP -> issued; not found -> deleted).
 *  6. No double-count after TO confirmation (effective claim formula).
 *  7. Deleted quant releases the claim (missing from LQUA counts as released, not lookup error).
 *  8. Failed post writes no record into store.
 *  9. Release job: releases claim when LQUA stock <= preIssueStock - issuedQty (TO confirmed).
 * 10. Release job: releases claim when Material Document is reversed in SAP (MSEG / MATDOC).
 * 11. Release job: lookup errors leave status unchanged and log warning.
 * 12. UI Model: partial drum instruction formatted before scanning ("18 kg from SU X").
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const GoodsIssueIssuedSuStore = require('../../../srv/wm/goods-issue/GoodsIssueIssuedSuStore');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueQueueManager = require('../../../srv/wm/goods-issue/GoodsIssueQueueManager');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssue261Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue261Model');

describe('Option (b) Issued Storage Units Persistence & Reconciliation', () => {
  let handlers = {};
  const mockSrv = {
    on: (evt, handler) => {
      handlers[evt] = handler;
    }
  };

  beforeAll(() => {
    PerTypeGoodsIssueHandler.init(mockSrv);
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await GoodsIssueIssuedSuStore.clear();
    if (GoodsIssueQueueManager.isAvailable()) {
      await GoodsIssueQueueManager.clear();
    }
  });

  afterEach(async () => {
    await GoodsIssueIssuedSuStore.clear();
    if (GoodsIssueQueueManager.isAvailable()) {
      await GoodsIssueQueueManager.clear();
    }
  });

  // ──────────────────────────────────────────────────────────
  // Test 1: Two reservations cannot claim the same drum
  // ──────────────────────────────────────────────────────────
  describe('Concurrent Claim Protection (Requirement 2 & 7)', () => {
    it('blocks second reservation from claiming the same drum with HTTP 400 before SAP is called', async () => {
      const resvItem1 = {
        ReservationNo: '0000100201',
        ReservationItem: '0001',
        Material: 'CH-DRUM-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 48
      };

      const suStock = [
        {
          StorageUnit: 'DRUM_SHARED_01',
          AvailableStock: 48,
          Unit: 'KG',
          Warehouse: 'W01',
          StorageBin: '01-01'
        }
      ];

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(resvItem1);
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100201',
        ReservationItem: '0001',
        StockUnits: suStock
      });
      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
        MaterialDocument: '4900011111',
        MaterialDocYear: '2026',
        Success: true
      });

      // 1. Post Reservation 1
      const req1 = {
        data: {
          ReservationNo: '0000100201',
          ReservationItem: '0001',
          Material: 'CH-DRUM-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 48,
          Unit: 'KG',
          StorageUnits: ['DRUM_SHARED_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_1' },
        error: jest.fn()
      };

      const result1 = await handlers['postGoodsIssue261'](req1);
      expect(result1.MaterialDocument).toBe('4900011111');
      expect(postSpy).toHaveBeenCalledTimes(1);

      // Verify claim was recorded in store
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-DRUM-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].StorageUnit).toBe('DRUM_SHARED_01');
      expect(active[0].Status).toBe('issued');

      // 2. Reservation 2 tries to claim the same DRUM_SHARED_01
      const resvItem2 = {
        ReservationNo: '0000100202',
        ReservationItem: '0001',
        Material: 'CH-DRUM-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 48
      };
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(resvItem2);

      const req2 = {
        data: {
          ReservationNo: '0000100202',
          ReservationItem: '0001',
          Material: 'CH-DRUM-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 48,
          Unit: 'KG',
          StorageUnits: ['DRUM_SHARED_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_2' },
        error: jest.fn()
      };

      await handlers['postGoodsIssue261'](req2);

      // Fails fast with HTTP 400 before SAP is called a second time
      expect(req2.error).toHaveBeenCalledWith(
        400,
        expect.stringMatching(/DRUM_SHARED_01.*currently claimed in an active Goods Issue/i)
      );
      // Post was NOT called again
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('parallel Promise.all claims for one drum (exactly one wins)', async () => {
      const resvItem1 = {
        ReservationNo: '0000100201',
        ReservationItem: '0001',
        Material: 'CH-PARALLEL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 48
      };
      const resvItem2 = {
        ReservationNo: '0000100202',
        ReservationItem: '0001',
        Material: 'CH-PARALLEL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 48
      };
      const suStock = [
        {
          StorageUnit: 'DRUM_PARALLEL_01',
          AvailableStock: 48,
          Unit: 'KG'
        }
      ];

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockImplementation((r) => {
        return Promise.resolve(r === '0000100201' ? resvItem1 : resvItem2);
      });
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100201',
        ReservationItem: '0001',
        StockUnits: suStock
      });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockImplementation(async () => {
        // Small delay to simulate SAP network latency
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          MaterialDocument: '4900012222',
          MaterialDocYear: '2026',
          Success: true
        };
      });

      const req1 = {
        data: {
          ReservationNo: '0000100201',
          ReservationItem: '0001',
          Material: 'CH-PARALLEL-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 48,
          Unit: 'KG',
          StorageUnits: ['DRUM_PARALLEL_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_1' },
        error: jest.fn()
      };

      const req2 = {
        data: {
          ReservationNo: '0000100202',
          ReservationItem: '0001',
          Material: 'CH-PARALLEL-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 48,
          Unit: 'KG',
          StorageUnits: ['DRUM_PARALLEL_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_2' },
        error: jest.fn()
      };

      const [res1, res2] = await Promise.all([
        handlers['postGoodsIssue261'](req1),
        handlers['postGoodsIssue261'](req2)
      ]);

      // Exactly one succeeds, the other fails with 400
      const successes = [res1, res2].filter((r) => r && r.MaterialDocument === '4900012222');
      expect(successes).toHaveLength(1);
      expect(postSpy).toHaveBeenCalledTimes(1);

      const errors = [req1.error, req2.error].filter((fn) => fn.mock.calls.length > 0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toHaveBeenCalledWith(
        400,
        expect.stringMatching(/DRUM_PARALLEL_01.*currently claimed in an active Goods Issue/i)
      );

      // Verify final store state has exactly 1 issued claim
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-PARALLEL-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('issued');
    });

    it('second reservation takes the 30 kg residual from a 48 kg drum', async () => {
      // Drum has 48 KG. Reservation 1 claims 18 KG (partial).
      const resvItem1 = {
        ReservationNo: '0000100210',
        ReservationItem: '0001',
        Material: 'CH-RESIDUAL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 18
      };
      const resvItem2 = {
        ReservationNo: '0000100211',
        ReservationItem: '0001',
        Material: 'CH-RESIDUAL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 30
      };
      const suStock = [
        {
          StorageUnit: 'DRUM_RESIDUAL_01',
          AvailableStock: 48,
          Unit: 'KG'
        }
      ];

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockImplementation((r) => {
        return Promise.resolve(r === '0000100210' ? resvItem1 : resvItem2);
      });
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100210',
        ReservationItem: '0001',
        StockUnits: suStock
      });
      let docSeq = 1000;
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockImplementation(async () => ({
        MaterialDocument: `490001${++docSeq}`,
        MaterialDocYear: '2026',
        Success: true
      }));

      // Post Reservation 1 for 18 KG
      const req1 = {
        data: {
          ReservationNo: '0000100210',
          ReservationItem: '0001',
          Material: 'CH-RESIDUAL-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 18,
          Unit: 'KG',
          StorageUnits: ['DRUM_RESIDUAL_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_1' },
        error: jest.fn()
      };
      const res1 = await handlers['postGoodsIssue261'](req1);
      expect(res1.MaterialDocument).toBe('4900011001');

      // Post Reservation 2 for 30 KG residual from the SAME drum
      const req2 = {
        data: {
          ReservationNo: '0000100211',
          ReservationItem: '0001',
          Material: 'CH-RESIDUAL-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 30,
          Unit: 'KG',
          StorageUnits: ['DRUM_RESIDUAL_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_2' },
        error: jest.fn()
      };
      const res2 = await handlers['postGoodsIssue261'](req2);
      expect(res2.MaterialDocument).toBe('4900011002');
      expect(req2.error).not.toHaveBeenCalled();

      // Check active claims: both 18 KG and 30 KG exist
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-RESIDUAL-01', '1120', 'CS01');
      expect(active).toHaveLength(2);
      const totalClaimed = active.reduce((sum, c) => sum + Number(c.IssuedQty), 0);
      expect(totalClaimed).toBe(48);

      // A third request for 5 KG is now rejected because drum is fully claimed (18 + 30 + 5 > 48)
      const req3 = {
        data: {
          ReservationNo: '0000100212',
          ReservationItem: '0001',
          Material: 'CH-RESIDUAL-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 5,
          Unit: 'KG',
          StorageUnits: ['DRUM_RESIDUAL_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'CLERK_3' },
        error: jest.fn()
      };
      const resvItem3 = {
        ReservationNo: '0000100212',
        ReservationItem: '0001',
        Material: 'CH-RESIDUAL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 5
      };
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(resvItem3);
      await handlers['postGoodsIssue261'](req3);
      expect(req3.error).toHaveBeenCalledWith(
        400,
        expect.stringMatching(/DRUM_RESIDUAL_01.*currently claimed in an active Goods Issue/i)
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 3: Stock Units Subtraction & Suggestion
  // ──────────────────────────────────────────────────────────
  describe('Stock Units Subtraction & Suggestion (Requirement 3 & 7)', () => {
    it('subtracts active issued quantity from drum and suggests residual for next reservation', async () => {
      // Record an active claim of 18 KG on a 48 KG drum
      await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900011122',
        materialDocYear: '2026',
        reservationNo: '0000100200',
        reservationItem: '0001',
        material: 'RAW_CHEM_A',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'DRUM_PARTIAL_01', issuedQty: 18, preIssueStock: 48 }
        ]
      });

      // Mock client reading LQUA
      const stockUnitClient = GoodsIssueAdapter.stockUnits;
      jest.spyOn(stockUnitClient, '_readOpenReservationItem').mockResolvedValue({
        sResv: '0000100203',
        sItem: '0001',
        resvItem: {
          Product: 'RAW_CHEM_A',
          Plant: '1120',
          StorageLocation: 'CS01',
          Batch: 'BATCH_X',
          ResvnItmRequiredQtyInBaseUnit: '30',
          ResvnItmWithdrawnQtyInBaseUnit: '0',
          BaseUnit: 'KG'
        }
      });

      jest.spyOn(stockUnitClient, '_wmQuants').mockResolvedValue([
        {
          LGNUM: 'W01',
          LENUM: 'DRUM_PARTIAL_01',
          LQNUM: '0001',
          MATNR: 'RAW_CHEM_A',
          WERKS: '1120',
          LGORT: 'CS01',
          CHARG: 'BATCH_X',
          VERME: 48,
          MEINS: 'KG',
          LGTYP: '001',
          LGPLA: 'BIN-01',
          WDATU: '20260901'
        },
        {
          LGNUM: 'W01',
          LENUM: 'DRUM_FULL_02',
          LQNUM: '0002',
          MATNR: 'RAW_CHEM_A',
          WERKS: '1120',
          LGORT: 'CS01',
          CHARG: 'BATCH_X',
          VERME: 48,
          MEINS: 'KG',
          LGTYP: '001',
          LGPLA: 'BIN-02',
          WDATU: '20260910'
        }
      ]);
      jest.spyOn(stockUnitClient, '_usableBatchMap').mockResolvedValue(new Map([
        ['BATCH_X', { Batch: 'BATCH_X', StatusState: 'Success' }]
      ]));

      const result = await stockUnitClient.listStockUnitsForReservationItem('0000100203', '0001');

      expect(result.StockUnits).toHaveLength(2);
      const partialDrum = result.StockUnits.find((s) => s.StorageUnit === 'DRUM_PARTIAL_01');
      expect(partialDrum).toBeDefined();
      // 48 - 18 = 30 KG available
      expect(partialDrum.AvailableStock).toBe(30);
      expect(partialDrum.StatusText).toMatch(/30 KG available \(18 KG pending TO confirmation\)/i);

      // Suggestions for a 30 KG open reservation will pick exactly the 30 KG residual drum
      const suggested = GoodsIssue261Model.calculateSuggestedUnits(result.StockUnits, 30);
      expect(suggested).toHaveLength(1);
      expect(suggested[0].StorageUnit).toBe('DRUM_PARTIAL_01');
      expect(suggested[0].SuggestedQty).toBe(30);
      expect(suggested[0].IsPartial).toBe(false);
    });

    it('drops SUs whose active claims equal or exceed full stock (drop at 0)', async () => {
      // Record full claim of 48 KG on DRUM_DEPLETED_01
      await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900011123',
        materialDocYear: '2026',
        reservationNo: '0000100200',
        reservationItem: '0001',
        material: 'RAW_CHEM_A',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'DRUM_DEPLETED_01', issuedQty: 48, preIssueStock: 48 }
        ]
      });

      const stockUnitClient = GoodsIssueAdapter.stockUnits;
      jest.spyOn(stockUnitClient, '_readOpenReservationItem').mockResolvedValue({
        sResv: '0000100204',
        sItem: '0001',
        resvItem: {
          Product: 'RAW_CHEM_A',
          Plant: '1120',
          StorageLocation: 'CS01',
          Batch: 'BATCH_X',
          ResvnItmRequiredQtyInBaseUnit: '48',
          BaseUnit: 'KG'
        }
      });

      jest.spyOn(stockUnitClient, '_wmQuants').mockResolvedValue([
        {
          LGNUM: 'W01',
          LENUM: 'DRUM_DEPLETED_01',
          LQNUM: '0001',
          MATNR: 'RAW_CHEM_A',
          WERKS: '1120',
          LGORT: 'CS01',
          CHARG: 'BATCH_X',
          VERME: 48,
          MEINS: 'KG',
          LGTYP: '001',
          LGPLA: 'BIN-01'
        }
      ]);
      jest.spyOn(stockUnitClient, '_usableBatchMap').mockResolvedValue(new Map([
        ['BATCH_X', { Batch: 'BATCH_X', StatusState: 'Success' }]
      ]));

      const result = await stockUnitClient.listStockUnitsForReservationItem('0000100204', '0001');

      // Fully claimed drum is dropped from StockUnits
      expect(result.StockUnits).toHaveLength(0);
      expect(result.ExcludedUnconfirmedCount).toBe(1);
      expect(result.Message).toMatch(/pending Transfer Order confirmation/i);
    });

    it('no double-count after TO confirmation: effective claim = max(0, claimed - (preIssueStock - currentStock))', async () => {
      // Drum had PreIssueStock = 48 KG, 18 KG issued
      await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900016666',
        materialDocYear: '2026',
        reservationNo: '0000100240',
        reservationItem: '0001',
        material: 'RAW_CHEM_TO',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'DRUM_TO_01', issuedQty: 18, preIssueStock: 48 }
        ]
      });

      const stockUnitClient = GoodsIssueAdapter.stockUnits;
      jest.spyOn(stockUnitClient, '_readOpenReservationItem').mockResolvedValue({
        sResv: '0000100241',
        sItem: '0001',
        resvItem: {
          Product: 'RAW_CHEM_TO',
          Plant: '1120',
          StorageLocation: 'CS01',
          Batch: 'BATCH_TO',
          ResvnItmRequiredQtyInBaseUnit: '30',
          BaseUnit: 'KG'
        }
      });

      // LQUA stock has ALREADY dropped to 30 KG because WM TO was confirmed in SAP!
      // Formula: effective claim = max(0, 18 - (48 - 30)) = 0 KG, so available stock stays 30 KG!
      jest.spyOn(stockUnitClient, '_wmQuants').mockResolvedValue([
        {
          LGNUM: 'W01',
          LENUM: 'DRUM_TO_01',
          LQNUM: '0001',
          MATNR: 'RAW_CHEM_TO',
          WERKS: '1120',
          LGORT: 'CS01',
          CHARG: 'BATCH_TO',
          VERME: 30, // dropped in LQUA
          MEINS: 'KG',
          LGTYP: '001',
          LGPLA: 'BIN-01'
        }
      ]);
      jest.spyOn(stockUnitClient, '_usableBatchMap').mockResolvedValue(new Map([
        ['BATCH_TO', { Batch: 'BATCH_TO', StatusState: 'Success' }]
      ]));

      const result = await stockUnitClient.listStockUnitsForReservationItem('0000100241', '0001');
      expect(result.StockUnits).toHaveLength(1);
      const drum = result.StockUnits[0];
      expect(drum.StorageUnit).toBe('DRUM_TO_01');
      expect(drum.AvailableStock).toBe(30); // Not double-counted!
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 4: Queue Replay Records Claims (Requirement 3 & 7)
  // ──────────────────────────────────────────────────────────
  describe('Queue Replay Claim Recording (Requirement 3 & 7)', () => {
    it('queue replay (drain job) records issued SUs using the same code path', async () => {
      // Enqueue a 261 Goods Issue with StorageUnits
      await GoodsIssueQueueManager.enqueue({
        ReservationNo: '0000100220',
        ReservationItem: '0001',
        Material: 'CH-REPLAY-01',
        Plant: '1120',
        StorageLocation: 'CS01',
        IssueQty: 48,
        Unit: 'KG',
        MovementType: '261',
        StorageUnits: [
          { storageUnit: 'DRUM_REPLAY_01', issuedQty: 48, preIssueStock: 48 }
        ],
        LastSyncError: 'SAP Gateway unavailable'
      });

      // Initially no claim in store
      let claims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-REPLAY-01', '1120', 'CS01');
      expect(claims).toHaveLength(0);

      // Drain queue with adapter that succeeds
      const mockDrainAdapter = {
        postGoodsIssueByType: jest.fn().mockResolvedValue({
          MaterialDocument: '4900019999',
          MaterialDocYear: '2026',
          Success: true
        })
      };

      const drainResult = await GoodsIssueQueueManager.drainQueue(mockDrainAdapter);
      expect(drainResult.SyncedToSap).toBe(1);

      // Verify issued SU claim was recorded during replay
      claims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-REPLAY-01', '1120', 'CS01');
      expect(claims).toHaveLength(1);
      expect(claims[0].StorageUnit).toBe('DRUM_REPLAY_01');
      expect(claims[0].MaterialDocument).toBe('4900019999');
      expect(claims[0].Status).toBe('issued');
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 5: Failed Post Isolation
  // ──────────────────────────────────────────────────────────
  describe('Failed Post Isolation (Requirement 2 & 7)', () => {
    it('writes no record into store when SAP post fails or is rejected', async () => {
      const resvItem = {
        ReservationNo: '0000100205',
        ReservationItem: '0001',
        Material: 'CH-DRUM-FAIL',
        Plant: '1120',
        StorageLocation: 'CS01',
        OpenQty: 48
      };

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(resvItem);
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100205',
        ReservationItem: '0001',
        StockUnits: [
          {
            StorageUnit: 'DRUM_FAIL_01',
            AvailableStock: 48,
            Unit: 'KG'
          }
        ]
      });

      // SAP rejects the post (e.g. posting period closed or lock failure)
      const sapErr = new Error('Posting period 09/2026 is closed for company code 1120');
      sapErr.status = 400;
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockRejectedValue(sapErr);

      const req = {
        data: {
          ReservationNo: '0000100205',
          ReservationItem: '0001',
          Material: 'CH-DRUM-FAIL',
          Plant: '1120',
          StorageLocation: 'CS01',
          IssueQty: 48,
          Unit: 'KG',
          StorageUnits: ['DRUM_FAIL_01'],
          PostingDate: '2026-10-02',
          DocumentDate: '2026-10-02'
        },
        user: { id: 'TEST_USER' },
        error: jest.fn()
      };

      await handlers['postGoodsIssue261'](req);

      expect(req.error).toHaveBeenCalled();
      // Store must have 0 records (claiming row deleted)
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-DRUM-FAIL', '1120', 'CS01');
      expect(active).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 6: Release Job (LQUA drop, Reversal, Crash Resolution, Deleted Quant)
  // ──────────────────────────────────────────────────────────
  describe('Release Job (Requirement 4, 5, 6 & 7)', () => {
    it('sets status to released when LQUA stock drops <= preIssueStock - issuedQty (TO confirmed)', async () => {
      // Drum had 48 KG, 18 KG issued -> expected max stock 30 KG
      const [record] = await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900011130',
        materialDocYear: '2026',
        reservationNo: '0000100206',
        reservationItem: '0001',
        material: 'MAT_RELEASE_01',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'SU_REL_LQUA_01', issuedQty: 18, preIssueStock: 48 }
        ]
      });

      expect(record.Status).toBe('issued');

      // Mock readTable: LQUA now shows 30 KG (TO confirmed in LE-WM)
      const mockAdapter = {
        readTable: jest.fn().mockImplementation((table) => {
          if (table === 'LQUA') {
            return Promise.resolve([
              { LENUM: '0000000000SU_REL_LQUA_01', VERME: '30.000', LGTYP: '001' }
            ]);
          }
          return Promise.resolve([]);
        })
      };

      const result = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapter);

      expect(result.inspected).toBe(1);
      expect(result.released).toBe(1);
      expect(result.errors).toBe(0);

      // Verify status changed to released
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('MAT_RELEASE_01', '1120', 'CS01');
      expect(active).toHaveLength(0);
    });

    it('sets status to released when material document is reversed in SAP (MSEG / MATDOC)', async () => {
      // Drum issued 48 KG
      await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900011131',
        materialDocYear: '2026',
        reservationNo: '0000100207',
        reservationItem: '0001',
        material: 'MAT_RELEASE_02',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'SU_REL_REV_01', issuedQty: 48, preIssueStock: 48 }
        ]
      });

      // Mock readTable: LQUA still shows full 48 KG (TO not confirmed), but MSEG shows document reversal (SMBLN)
      const mockAdapter = {
        readTable: jest.fn().mockImplementation((table) => {
          if (table === 'LQUA') {
            return Promise.resolve([
              { LENUM: '0000000000SU_REL_REV_01', VERME: '48.000', LGTYP: '001' }
            ]);
          }
          if (table === 'MSEG') {
            // Reversal document found with SMBLN = 4900011131
            return Promise.resolve([
              { MBLNR: '4900011132', BWART: '262' }
            ]);
          }
          return Promise.resolve([]);
        })
      };

      const result = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapter);

      expect(result.inspected).toBe(1);
      expect(result.released).toBe(1);
      expect(result.errors).toBe(0);

      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('MAT_RELEASE_02', '1120', 'CS01');
      expect(active).toHaveLength(0);
    });

    it('resolves claiming row after a crash: found in SAP -> issued; not found -> deleted', async () => {
      // Create a stale claiming row that crashed mid-posting
      await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100230',
        reservationItem: '0001',
        material: 'CH-CRASH-01',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'REF_CRASH_FOUND',
        items: [{ storageUnit: 'DRUM_CRASH_01', issuedQty: 48, preIssueStock: 48 }]
      });

      // Check it is in 'claiming' status
      let active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-CRASH-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('claiming');

      // 1. Adapter finds material document in SAP -> promoted to 'issued'
      const mockAdapterFound = {
        findPostedGoodsIssueByReference: jest.fn().mockResolvedValue({
          MaterialDocument: '4900017777',
          MaterialDocumentYear: '2026'
        })
      };

      await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapterFound, {
        now: Date.now(),
        staleClaimAgeMs: 0 // forces immediate resolution
      });

      active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-CRASH-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('issued');
      expect(active[0].MaterialDocument).toBe('4900017777');

      // 2. Second crash case where SAP did NOT post the document -> deleted after threshold
      await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100231',
        reservationItem: '0001',
        material: 'CH-CRASH-02',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'REF_CRASH_NOT_FOUND',
        items: [{ storageUnit: 'DRUM_CRASH_02', issuedQty: 48, preIssueStock: 48 }]
      });

      const mockAdapterNotFound = {
        findPostedGoodsIssueByReference: jest.fn().mockResolvedValue(null)
      };

      await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapterNotFound, {
        now: Date.now(),
        staleClaimAgeMs: 0 // forces immediate resolution
      });

      active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-CRASH-02', '1120', 'CS01');
      // Deleted from store
      expect(active).toHaveLength(0);
    });

    it('deleted quant releases the claim when LQUA returns no quants for that SU', async () => {
      await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900015555',
        materialDocYear: '2026',
        reservationNo: '0000100250',
        reservationItem: '0001',
        material: 'MAT_DELETED_QUANT',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'SU_DELETED_QUANT_01', issuedQty: 48, preIssueStock: 48 }
        ]
      });

      // LQUA returns empty array [] (quant deleted/consumed from warehouse)
      const mockAdapter = {
        readTable: jest.fn().mockImplementation((table) => {
          if (table === 'LQUA') return Promise.resolve([]);
          return Promise.resolve([]);
        })
      };

      const result = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapter);
      expect(result.released).toBe(1);

      // Quant missing counts as released, not as a lookup error
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('MAT_DELETED_QUANT', '1120', 'CS01');
      expect(active).toHaveLength(0);
    });

    it('leaves status unchanged and logs when lookup error occurs', async () => {
      await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900011133',
        materialDocYear: '2026',
        reservationNo: '0000100208',
        reservationItem: '0001',
        material: 'MAT_ERR_01',
        plant: '1120',
        storageLocation: 'CS01',
        items: [
          { storageUnit: 'SU_ERR_01', issuedQty: 48, preIssueStock: 48 }
        ]
      });

      const failingAdapter = {
        readTable: jest.fn().mockRejectedValue(new Error('RFC connection timed out'))
      };

      const result = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(failingAdapter);

      expect(result.inspected).toBe(1);
      expect(result.released).toBe(0);
      expect(result.errors).toBe(0); // Row-level lookup errors leave status unchanged without crashing

      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('MAT_ERR_01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('issued');
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 7: UI Model Partial Instruction (Requirement 5)
  // ──────────────────────────────────────────────────────────
  describe('UI Partial Drum Instruction & Excluded Note (Requirement 5)', () => {
    it('formats partial drum instruction string for display before scanning ("18 kg from SU X")', () => {
      const suggestedUnits = [
        { StorageUnit: 'DRUM_01', SuggestedQty: 48, Unit: 'KG', IsPartial: false },
        { StorageUnit: 'DRUM_02', SuggestedQty: 18, Unit: 'KG', IsPartial: true }
      ];

      const instruction = GoodsIssue261Model.getPartialInstruction(suggestedUnits);
      expect(instruction).toBe('18 kg from SU DRUM_02');
    });

    it('returns empty string when all suggested units are full drums', () => {
      const suggestedUnits = [
        { StorageUnit: 'DRUM_01', SuggestedQty: 48, Unit: 'KG', IsPartial: false },
        { StorageUnit: 'DRUM_02', SuggestedQty: 48, Unit: 'KG', IsPartial: false }
      ];

      const instruction = GoodsIssue261Model.getPartialInstruction(suggestedUnits);
      expect(instruction).toBe('');
    });
  });
});
