/**
 * goodsIssueIssuedSu.test.js
 * Comprehensive tests for Option (b) Issued Storage Units persistence & tracking:
 *  1. Two reservations cannot claim the same drum (400 before SAP is called).
 *  2. Parallel Promise.all claims for one drum (exactly one wins).
 *  3. Second reservation takes the 30 kg residual; partial residual is suggested at reduced qty.
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
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
  });

  afterEach(async () => {
    await GoodsIssueIssuedSuStore.clear();
  });

  it('persists the final SAP SU snapshot on the posting claim before it is promoted', async () => {
    const ids = await GoodsIssueIssuedSuStore.acquireClaims({
      reservationNo: '0000100201',
      reservationItem: '0001',
      referenceDocument: 'GI-AUDIT-0001',
      material: 'CH-AUDIT-01',
      plant: '1120',
      storageLocation: 'CS01',
      items: [{ storageUnit: 'SU-AUDIT-01', issuedQty: 7.5, preIssueStock: 12 }]
    });

    await GoodsIssueIssuedSuStore.updateClaimEvidence('GI-AUDIT-0001', [{
      storageUnit: 'SU-AUDIT-01',
      batch: 'BATCH-01',
      warehouse: 'W01',
      storageType: 'IP1',
      storageBin: '0000001234',
      multipleBatches: false
    }]);

    let [claim] = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-AUDIT-01', '1120', 'CS01');
    expect(claim).toMatchObject({
      ReferenceDocument: 'GI-AUDIT-0001',
      StorageUnit: 'SU-AUDIT-01',
      IssuedQty: 7.5,
      PreIssueStock: 12,
      Batch: 'BATCH-01',
      Warehouse: 'W01',
      StorageType: 'IP1',
      StorageBin: '0000001234',
      MultipleBatches: false,
      Status: 'claiming'
    });
    expect(claim.EvidenceCapturedAt).toBeTruthy();

    await GoodsIssueIssuedSuStore.promoteClaims(ids, {
      materialDocument: '4900012345',
      materialDocYear: '2026'
    });
    [claim] = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-AUDIT-01', '1120', 'CS01');
    expect(claim).toMatchObject({ Status: 'issued', MaterialDocument: '4900012345', MaterialDocYear: '2026' });
    expect(claim.EvidenceCapturedAt).toBeTruthy();
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
          Material: 'CH-DRUM-01',
          Plant: '1120',
          StorageLocation: 'CS01',
          Warehouse: 'W01',
          StorageBin: '01-01'
        }
      ];

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(resvItem1);
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100201',
        ReservationItem: '0001',
        Material: 'CH-DRUM-01',
        Plant: '1120',
        StorageLocation: 'CS01',
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
          Unit: 'KG',
          Material: 'CH-PARALLEL-01',
          Plant: '1120',
          StorageLocation: 'CS01'
        }
      ];

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockImplementation((r) => {
        return Promise.resolve(r === '0000100201' ? resvItem1 : resvItem2);
      });
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100201',
        ReservationItem: '0001',
        Material: 'CH-PARALLEL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
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

      // Exactly one succeeds; the competing request is stopped by either the
      // reservation-level pending-attempt guard or the storage-unit claim guard.
      const successes = [res1, res2].filter((r) => r && r.MaterialDocument === '4900012222');
      expect(successes).toHaveLength(1);
      expect(postSpy).toHaveBeenCalledTimes(1);

      const errors = [req1.error, req2.error].filter((fn) => fn.mock.calls.length > 0);
      expect(errors).toHaveLength(1);
      expect([400, 409]).toContain(errors[0].mock.calls[0][0]);
      if (errors[0].mock.calls[0][0] === 400) {
        expect(errors[0].mock.calls[0][1]).toMatch(/DRUM_PARALLEL_01.*currently claimed in an active Goods Issue/i);
      } else {
        expect(errors[0].mock.calls[0][1]).toMatch(/pending confirmation.*do not post again/i);
      }

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
          Unit: 'KG',
          Material: 'CH-RESIDUAL-01',
          Plant: '1120',
          StorageLocation: 'CS01'
        }
      ];

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockImplementation((r) => {
        return Promise.resolve(r === '0000100210' ? resvItem1 : resvItem2);
      });
      jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
        ReservationNo: '0000100210',
        ReservationItem: '0001',
        Material: 'CH-RESIDUAL-01',
        Plant: '1120',
        StorageLocation: 'CS01',
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
      jest.spyOn(stockUnitClient, '_resolveStagingRequirement').mockResolvedValue({ isStagingRequired: false });
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
      jest.spyOn(stockUnitClient, '_resolveStagingRequirement').mockResolvedValue({ isStagingRequired: false });
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
      jest.spyOn(stockUnitClient, '_resolveStagingRequirement').mockResolvedValue({ isStagingRequired: false });
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

  // ──────────────────────────────────────────────────────────
  // Test 8: Oldest-first LQUA allocation (one TO confirmed, one not)
  // ──────────────────────────────────────────────────────────
  describe('Oldest-First LQUA Drop Allocation (Requirement 4)', () => {
    it('allocates LQUA drop to oldest claim first — newer claim retains its full effective qty', () => {
      // Drum: 48 KG. Claim 1 (older): 18 KG. Claim 2 (newer): 30 KG.
      // LQUA drops to 30 KG (18 KG TO confirmed — only older claim covered).
      // Expected: effectiveClaim(claim1) = max(0, 18 - 18) = 0
      //           effectiveClaim(claim2) = max(0, 30 - 0) = 30
      const GoodsIssueIssuedSuStoreClass = GoodsIssueIssuedSuStore.GoodsIssueIssuedSuStore;
      const older = { IssuedQty: 18, PreIssueStock: 48 };
      const newer = { IssuedQty: 30, PreIssueStock: 48 };
      const currentStock = 30;

      let toAllocated = 0;
      const { effectiveClaim: eff1, toDeductedUsed: used1 } =
        GoodsIssueIssuedSuStoreClass.calculateEffectiveClaimWithAllocation(older, currentStock, toAllocated);
      toAllocated = Math.round((toAllocated + used1) * 1000) / 1000;
      const { effectiveClaim: eff2 } =
        GoodsIssueIssuedSuStoreClass.calculateEffectiveClaimWithAllocation(newer, currentStock, toAllocated);

      expect(eff1).toBe(0);   // Older claim fully covered by LQUA drop
      expect(eff2).toBe(30);  // Newer claim: remaining drop = 0; still fully active
    });

    it('effective total is 0 when all claims are covered by confirmed TO (LQUA = 0)', () => {
      const GoodsIssueIssuedSuStoreClass = GoodsIssueIssuedSuStore.GoodsIssueIssuedSuStore;
      const claimA = { IssuedQty: 18, PreIssueStock: 48 };
      const claimB = { IssuedQty: 30, PreIssueStock: 48 };
      const currentStock = 0;

      let toAllocated = 0;
      const { effectiveClaim: eA, toDeductedUsed: uA } =
        GoodsIssueIssuedSuStoreClass.calculateEffectiveClaimWithAllocation(claimA, currentStock, toAllocated);
      toAllocated = Math.round((toAllocated + uA) * 1000) / 1000;
      const { effectiveClaim: eB } =
        GoodsIssueIssuedSuStoreClass.calculateEffectiveClaimWithAllocation(claimB, currentStock, toAllocated);

      expect(eA).toBe(0);
      expect(eB).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 9: Unknown-outcome persistence (claiming row kept)
  // ──────────────────────────────────────────────────────────
  describe('Unknown Outcome — Claiming Row Persistence (Requirement 2)', () => {
    it('keeps claiming row when deleteClaims called with { definitive: false }', async () => {
      const ids = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100300',
        reservationItem: '0001',
        material: 'CH-UNKNOWN-01',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'GI_UNKNOWN_REF_01',
        items: [{ storageUnit: 'DRUM_UNKNOWN_01', issuedQty: 48, preIssueStock: 48 }]
      });

      expect(ids).toHaveLength(1);

      // Simulate unknown outcome (timeout/504): do NOT delete
      await GoodsIssueIssuedSuStore.deleteClaims(ids, { definitive: false });

      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-UNKNOWN-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('claiming');
    });

    it('deletes claiming row when deleteClaims called with { definitive: true }', async () => {
      const ids = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100301',
        reservationItem: '0001',
        material: 'CH-DEFINITIVE-01',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'GI_DEF_REF_01',
        items: [{ storageUnit: 'DRUM_DEF_01', issuedQty: 48, preIssueStock: 48 }]
      });

      await GoodsIssueIssuedSuStore.deleteClaims(ids, { definitive: true });

      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-DEFINITIVE-01', '1120', 'CS01');
      expect(active).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 10: Stale unprovable claiming row protected from deletion
  // ──────────────────────────────────────────────────────────
  describe('Stale Unprovable Claiming Row Protection (Requirement 3)', () => {
    it('leaves claiming row intact when ReferenceDocument lookup throws (cannot prove not-posted)', async () => {
      await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100310',
        reservationItem: '0001',
        material: 'CH-UNPROVABLE-01',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'GI_UNPROVABLE_REF',
        items: [{ storageUnit: 'DRUM_UNPROV_01', issuedQty: 48, preIssueStock: 48 }]
      });

      // Adapter lookup throws — cannot prove not-posted
      const failingAdapter = {
        findPostedGoodsIssueByReference: jest.fn().mockRejectedValue(new Error('RFC connection timed out'))
      };

      const result = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(failingAdapter, {
        now: Date.now(),
        staleClaimAgeMs: 0 // force stale-age check immediately
      });

      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-UNPROVABLE-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('claiming');
      expect(result.errors).toBe(1);
      expect(result.resolvedClaiming).toBe(0);
    });

    it('leaves claiming row intact when no ReferenceDocument or MaterialDocument present', () => {
      const GoodsIssueIssuedSuStoreClass = GoodsIssueIssuedSuStore.GoodsIssueIssuedSuStore;
      const localStore = new GoodsIssueIssuedSuStoreClass({ db: null });

      const id = 'STALE-NO-REF-01';
      localStore._memoryStore.set(id, {
        ID: id, StorageUnit: 'DRUM_NOREF_01', Material: 'CH-NOREF-01', Plant: '1120',
        StorageLocation: 'CS01', IssuedQty: 48, PreIssueStock: 48, Status: 'claiming',
        MaterialDocument: '', ReferenceDocument: '',
        createdAt: new Date(Date.now() - 999999).toISOString(),
        CreatedAt: new Date(Date.now() - 999999).toISOString()
      });

      const noopAdapter = {};
      return localStore.releaseByLquaDropOrReversal(noopAdapter, { now: Date.now(), staleClaimAgeMs: 0 })
        .then((result) => {
          const still = localStore._memoryStore.get(id);
          expect(still).toBeDefined();
          expect(still.Status).toBe('claiming');
          expect(result.errors).toBe(1);
        });
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 12: Release-job idempotency
  // ──────────────────────────────────────────────────────────
  describe('Release Job Idempotency (Requirement 4)', () => {
    it('running the release job twice on the same already-released row has no further effect', async () => {
      const [record] = await GoodsIssueIssuedSuStore.recordIssuedSUs({
        materialDocument: '4900099800',
        materialDocYear: '2026',
        reservationNo: '0000100500',
        reservationItem: '0001',
        material: 'MAT_IDEM_01',
        plant: '1120',
        storageLocation: 'CS01',
        items: [{ storageUnit: 'SU_IDEM_01', issuedQty: 18, preIssueStock: 48 }]
      });
      expect(record.Status).toBe('issued');

      const mockAdapter = {
        readTable: jest.fn().mockImplementation((table) => {
          if (table === 'LQUA') return Promise.resolve([{ LENUM: '0000000000SU_IDEM_01', VERME: '30.000', LGTYP: '001' }]);
          return Promise.resolve([]);
        })
      };

      const result1 = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapter);
      expect(result1.released).toBe(1);

      // Second run: no active rows remaining
      const result2 = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapter);
      expect(result2.inspected).toBe(0);
      expect(result2.released).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 13: Read-Committed Row Lock Concurrency, Bootstrap Retry & Stale Purge (Requirement 1)
  // ──────────────────────────────────────────────────────────
  describe('Read-Committed Row Lock Concurrency, Bootstrap Retry & Stale Purge (Requirement 1)', () => {
    it('handles unique-key violation on concurrent first INSERT by retrying as UPDATE and proves one fails under Read Committed', async () => {
      const committedRows = [];
      const suLocks = new Map();
      const existingSuLocks = new Set();
      let uniqueConstraintHitCount = 0;

      const mockDb = {
        tx: async (options, callback) => {
          const txBuffer = [];
          const lockedKeys = [];

          const txContext = {
            run: async (query) => {
              // 1. Lock GoodsIssueSuLock: UPDATE GoodsIssueSuLock SET LockVersion = LockVersion + 1 WHERE StorageUnit = ?
              const updateEnt = query?.UPDATE?.entity?.ref?.[0] || query?.UPDATE?.entity;
              if (updateEnt === 'saps4hana.wm.GoodsIssueSuLock') {
                const su = query.UPDATE.where?.[2]?.val;
                if (su) {
                  while (suLocks.has(su)) {
                    await suLocks.get(su);
                  }
                  let releaseLock;
                  const p = new Promise((resolve) => { releaseLock = resolve; });
                  p.resolve = releaseLock;
                  suLocks.set(su, p);
                  lockedKeys.push(su);
                }
                return 1;
              }

              // 2. INSERT into GoodsIssueSuLock: simulate unique key violation on concurrent first claim
              const insertEnt = query?.INSERT?.into?.ref?.[0] || query?.INSERT?.into;
              if (insertEnt === 'saps4hana.wm.GoodsIssueSuLock') {
                const entries = query.INSERT.entries || [];
                const entry = Array.isArray(entries) ? entries[0] : entries;
                const su = entry?.StorageUnit;
                if (su) {
                  if (existingSuLocks.has(su)) {
                    uniqueConstraintHitCount++;
                    const err = new Error(`UNIQUE constraint failed: saps4hana.wm.GoodsIssueSuLock.StorageUnit (${su})`);
                    err.code = 'SQLITE_CONSTRAINT_UNIQUE';
                    throw err;
                  }
                  existingSuLocks.add(su);
                  // Acquire lock for the inserting transaction
                  while (suLocks.has(su)) {
                    await suLocks.get(su);
                  }
                  let releaseLock;
                  const p = new Promise((resolve) => { releaseLock = resolve; });
                  p.resolve = releaseLock;
                  suLocks.set(su, p);
                  lockedKeys.push(su);
                }
                return 1;
              }

              // 3. INSERT into GoodsIssueIssuedStorageUnit
              if (insertEnt === 'saps4hana.wm.GoodsIssueIssuedStorageUnit') {
                const entries = query.INSERT.entries || [];
                txBuffer.push(...entries);
                return entries.length;
              }

              // 4. SELECT from GoodsIssueIssuedStorageUnit: READ COMMITTED view
              const selectEnt = query?.SELECT?.from?.ref?.[0] || query?.SELECT?.from;
              if (selectEnt === 'saps4hana.wm.GoodsIssueIssuedStorageUnit') {
                const visible = [...committedRows, ...txBuffer].filter((r) => ['claiming', 'issued', 'needs-attention'].includes(r.Status));
                return visible;
              }

              // 5. DELETE from GoodsIssueIssuedStorageUnit: remove from txBuffer
              const delEnt = query?.DELETE?.from?.ref?.[0] || query?.DELETE?.from;
              if (delEnt === 'saps4hana.wm.GoodsIssueIssuedStorageUnit') {
                const ids = query.DELETE.where?.[2]?.list?.map((item) => item.val) || [];
                for (let i = txBuffer.length - 1; i >= 0; i--) {
                  if (ids.includes(txBuffer[i].ID)) txBuffer.splice(i, 1);
                }
                return ids.length;
              }

              return [];
            }
          };

          try {
            const res = await callback(txContext);
            committedRows.push(...txBuffer);
            return res;
          } finally {
            for (const key of lockedKeys) {
              const lk = suLocks.get(key);
              if (lk) {
                suLocks.delete(key);
                lk.resolve();
              }
            }
          }
        }
      };

      const GoodsIssueIssuedSuStoreClass = GoodsIssueIssuedSuStore.GoodsIssueIssuedSuStore;
      const store1 = new GoodsIssueIssuedSuStoreClass({ db: mockDb });
      const store2 = new GoodsIssueIssuedSuStoreClass({ db: mockDb });

      const claim1Promise = store1.acquireClaims({
        reservationNo: '0000100901',
        reservationItem: '0001',
        material: 'CH-RC-LOCK-01',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'REF_RC_01',
        items: [{ storageUnit: 'DRUM_RC_01', issuedQty: 48, preIssueStock: 48 }]
      });

      const claim2Promise = store2.acquireClaims({
        reservationNo: '0000100902',
        reservationItem: '0001',
        material: 'CH-RC-LOCK-01',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'REF_RC_02',
        items: [{ storageUnit: 'DRUM_RC_01', issuedQty: 48, preIssueStock: 48 }]
      });

      const results = await Promise.allSettled([claim1Promise, claim2Promise]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.status).toBe(400);
      expect(rejected[0].reason.message).toMatch(/Storage Unit DRUM_RC_01 is currently claimed/i);

      // Unique-key violation was caught and retried as UPDATE:
      expect(uniqueConstraintHitCount).toBeGreaterThanOrEqual(1);

      expect(committedRows).toHaveLength(1);
      expect(committedRows[0].IssuedQty).toBe(48);
    });

    it('purges stale lock rows with no active claims older than cutoff', async () => {
      const activeClaims = [
        { StorageUnit: 'DRUM_HAS_CLAIM' }
      ];
      const suLockRows = [
        { StorageUnit: 'DRUM_STALE_01', updatedAt: '2026-09-01T00:00:00.000Z' },
        { StorageUnit: 'DRUM_HAS_CLAIM', updatedAt: '2026-09-01T00:00:00.000Z' }
      ];
      let deletedLocks = [];

      const mockDb = {
        tx: async (options, callback) => {
          const txContext = {
            run: async (query) => {
              const selectEnt = query?.SELECT?.from?.ref?.[0] || query?.SELECT?.from;
              if (selectEnt === 'saps4hana.wm.GoodsIssueIssuedStorageUnit') {
                return activeClaims;
              }
              if (selectEnt === 'saps4hana.wm.GoodsIssueSuLock') {
                return suLockRows;
              }
              const delEnt = query?.DELETE?.from?.ref?.[0] || query?.DELETE?.from;
              if (delEnt === 'saps4hana.wm.GoodsIssueSuLock') {
                const list = query.DELETE.where?.[2]?.list?.map((it) => it.val) || [];
                deletedLocks.push(...list);
                return list.length;
              }
              return [];
            }
          };
          return callback(txContext);
        }
      };

      const GoodsIssueIssuedSuStoreClass = GoodsIssueIssuedSuStore.GoodsIssueIssuedSuStore;
      const store = new GoodsIssueIssuedSuStoreClass({ db: mockDb });

      const purged = await store.purgeStaleLocks({ maxAgeMs: 86400000 });
      expect(purged).toBe(1);
      expect(deletedLocks).toEqual(['DRUM_STALE_01']);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 14: deleteClaims Default Keep & Error Classification (Requirements 2 & 5)
  // ──────────────────────────────────────────────────────────
  describe('deleteClaims Default Keep & Error Classification (Requirements 2 & 5)', () => {
    it('defaults to "keep" when deleteClaims is called without definitive: true', async () => {
      const ids = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100910',
        reservationItem: '0001',
        material: 'CH-DEFAULT-KEEP',
        plant: '1120',
        storageLocation: 'CS01',
        referenceDocument: 'REF_KEEP_01',
        items: [{ storageUnit: 'DRUM_KEEP_01', issuedQty: 48, preIssueStock: 48 }]
      });
      expect(ids).toHaveLength(1);

      await GoodsIssueIssuedSuStore.deleteClaims(ids);
      let active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-DEFAULT-KEEP', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('claiming');

      await GoodsIssueIssuedSuStore.deleteClaims(ids, {});
      active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-DEFAULT-KEEP', '1120', 'CS01');
      expect(active).toHaveLength(1);

      await GoodsIssueIssuedSuStore.deleteClaims(ids, { definitive: true });
      active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-DEFAULT-KEEP', '1120', 'CS01');
      expect(active).toHaveLength(0);
    });

    it('confirms plain 403 is definitive and 502/504/timeout/reset are not', () => {
      // Plain 403 Forbidden is definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 403 })).toBe(true);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ statusCode: 403 })).toBe(true);

      // 502 Bad Gateway is unknown / NOT definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 502 })).toBe(false);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ statusCode: 502 })).toBe(false);

      // 504 Gateway Timeout is unknown / NOT definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 504 })).toBe(false);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection(new Error('504 Gateway Timeout'))).toBe(false);

      // Timeout (ETIMEDOUT / message timeout) is NOT definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ code: 'ETIMEDOUT', message: 'Connection timed out' })).toBe(false);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection(new Error('Request timed out'))).toBe(false);

      // Reset (ECONNRESET / reset / socket hang up) is NOT definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection(new Error('read ECONNRESET'))).toBe(false);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection(new Error('Connection reset by peer'))).toBe(false);

      // Standard rejections remain definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 400 })).toBe(true);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 409 })).toBe(true);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 422 })).toBe(true);

      // Never-reached errors remain definitive:
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 404 })).toBe(true);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ status: 503 })).toBe(true);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ code: 'ECONNREFUSED' })).toBe(true);
      expect(GoodsIssueIssuedSuStore.isDefinitiveRejection({ code: 'ENOTFOUND' })).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 15: 261 MATDOC Fallback Lookup Filtering (Requirement 2)
  // ──────────────────────────────────────────────────────────
  describe('261 MATDOC Fallback Lookup Filtering (Requirement 2)', () => {
    // Live SAP system zone (TTZCU/TTZZ/TTZR): INDIA, rule P0530, UTC+05:30, no DST.
    // CPUDT/CPUTM in the rows below are therefore IST, as SAP returns them.
    const TZ = {
      TTZCU: [{ TZONESYS: 'INDIA' }],
      TTZZ: [{ ZONERULE: 'P0530', DSTRULE: 'NONE' }],
      TTZR: [{ UTCDIFF: '053000', UTCSIGN: '+' }]
    };
    const withTz = (impl) => async (table, fields, where) => (TZ[table] ? TZ[table] : impl(table, fields, where));
    it('proves an earlier same-day posting does NOT prove a later attempt', async () => {
      const mockPosting = GoodsIssueAdapter.posting;
      if (!mockPosting.rfc) {
        const { RfcClient } = require('../../../srv/integration/s4hana/wm/RfcClient');
        mockPosting.rfc = new RfcClient();
      }
      // Earlier posting at 14:30 IST = 09:00Z, before the 12:00Z attempt. The old code read
      // CPUTM as UTC (14:30Z) and would have wrongly taken it as this attempt's document.
      // The lookup reads 261 and 262 rows separately (equality-only predicates), so the
      // mock must honor the BWART predicate.
      const rows = [
        {
          MBLNR: '4900019991', MJAHR: '2026', ZEILE: '0001', BWART: '261',
          RSNUM: '0000100930', RSPOS: '0001', CPUDT: '20261002', CPUTM: '143000',
          MENGE: '48.000', STORNO: ''
        }
      ];
      jest.spyOn(mockPosting.rfc, 'readTable').mockImplementation(withTz(async (table, fields, where) => {
        const w = (where || []).join(' ');
        return rows.filter((r) => w.includes(`BWART = '${r.BWART}'`));
      }));

      // Later claim attempt created at 12:00:00
      const doc = await GoodsIssueAdapter.findPosted261ByMatdoc({
        reservationNo: '0000100930',
        reservationItem: '0001',
        user: 'OPERATOR1',
        date: '2026-10-02',
        createdAt: '2026-10-02T12:00:00.000Z',
        quantity: 48
      });

      // Earlier posting must NOT prove the later attempt
      expect(doc).toBeNull();
    });

    it('finds posted document created after claim createdAt with matching quantity', async () => {
      const mockPosting = GoodsIssueAdapter.posting;
      if (!mockPosting.rfc) {
        const { RfcClient } = require('../../../srv/integration/s4hana/wm/RfcClient');
        mockPosting.rfc = new RfcClient();
      }
      const rows = [
        {
          MBLNR: '4900019999', MJAHR: '2026', ZEILE: '0001', BWART: '261',
          RSNUM: '0000100930', RSPOS: '0001', CPUDT: '20261002', CPUTM: '173500',
          MENGE: '48.000', STORNO: ''
        }
      ];
      jest.spyOn(mockPosting.rfc, 'readTable').mockImplementation(withTz(async (table, fields, where) => {
        const w = (where || []).join(' ');
        return rows.filter((r) => w.includes(`BWART = '${r.BWART}'`));
      }));

      const doc = await GoodsIssueAdapter.findPosted261ByMatdoc({
        reservationNo: '0000100930',
        reservationItem: '0001',
        user: 'OPERATOR1',
        date: '2026-10-02',
        createdAt: '2026-10-02T12:00:00.000Z',
        quantity: 48
      });

      expect(doc).toEqual({ MaterialDocument: '4900019999', MaterialDocYear: '2026' });
    });

    it('rejects document with mismatched quantity', async () => {
      const mockPosting = GoodsIssueAdapter.posting;
      if (!mockPosting.rfc) {
        const { RfcClient } = require('../../../srv/integration/s4hana/wm/RfcClient');
        mockPosting.rfc = new RfcClient();
      }
      jest.spyOn(mockPosting.rfc, 'readTable').mockImplementation(withTz(async () => [
        {
          MBLNR: '4900019993', MJAHR: '2026', ZEILE: '0001', BWART: '261',
          RSNUM: '0000100930', RSPOS: '0001', CPUDT: '20261002', CPUTM: '173500',
          MENGE: '20.000', STORNO: ''
        }
      ]));

      const doc = await GoodsIssueAdapter.findPosted261ByMatdoc({
        reservationNo: '0000100930',
        reservationItem: '0001',
        createdAt: '2026-10-02T12:00:00.000Z',
        quantity: 48
      });

      expect(doc).toBeNull();
    });

    it('excludes reversed documents (cancelled by BWART 262 / SMBLN)', async () => {
      const mockPosting = GoodsIssueAdapter.posting;
      if (!mockPosting.rfc) {
        const { RfcClient } = require('../../../srv/integration/s4hana/wm/RfcClient');
        mockPosting.rfc = new RfcClient();
      }
      // Document 4900019994 has cancellation document 4900019995 (BWART 262)
      jest.spyOn(mockPosting.rfc, 'readTable').mockImplementation(withTz(async () => [
        {
          MBLNR: '4900019994', MJAHR: '2026', ZEILE: '0001', BWART: '261',
          RSNUM: '0000100930', RSPOS: '0001', CPUDT: '20261002', CPUTM: '173500',
          MENGE: '48.000', STORNO: ''
        },
        {
          MBLNR: '4900019995', MJAHR: '2026', ZEILE: '0001', BWART: '262',
          RSNUM: '0000100930', RSPOS: '0001', CPUDT: '20261002', CPUTM: '173600',
          MENGE: '48.000', SMBLN: '4900019994', SJAHR: '2026'
        }
      ]));

      const doc = await GoodsIssueAdapter.findPosted261ByMatdoc({
        reservationNo: '0000100930',
        reservationItem: '0001',
        createdAt: '2026-10-02T12:00:00.000Z',
        quantity: 48
      });

      expect(doc).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────
  // Test 16: Manual Resolution & Needs-Attention Re-check (Requirements 3 & 4)
  // ──────────────────────────────────────────────────────────
  describe('Manual Resolution & Needs-Attention Re-check (Requirements 3 & 4)', () => {
    it('verifies document in MATDOC on manual resolve action "posted"', async () => {
      const [claimId] = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100960',
        reservationItem: '0001',
        material: 'CH-MANUAL-VERIFY',
        plant: '1120',
        storageLocation: 'CS01',
        items: [{ storageUnit: 'DRUM_MAN_01', issuedQty: 48, preIssueStock: 48 }]
      });

      // 1. Rejects when document does not exist in MATDOC
      const mockAdapterNotFound = {
        readTable: jest.fn().mockResolvedValue([])
      };
      await expect(
        GoodsIssueIssuedSuStore.resolveClaimManual(claimId, 'posted', {
          materialDocument: '4900088881',
          materialDocYear: '2026',
          adapter: mockAdapterNotFound
        })
      ).rejects.toThrow(/not found in SAP MATDOC\/MSEG/i);

      // 2. Rejects when document has wrong movement type (e.g. 201 instead of 261)
      const mockAdapterWrongMvt = {
        readTable: jest.fn().mockResolvedValue([
          { MBLNR: '4900088882', MJAHR: '2026', ZEILE: '0001', BWART: '201', RSNUM: '0000100960', RSPOS: '0001' }
        ])
      };
      await expect(
        GoodsIssueIssuedSuStore.resolveClaimManual(claimId, 'posted', {
          materialDocument: '4900088882',
          materialDocYear: '2026',
          adapter: mockAdapterWrongMvt
        })
      ).rejects.toThrow(/movement type 201, expected 261/i);

      // 3. Rejects when document is for different reservation/item
      const mockAdapterWrongResv = {
        readTable: jest.fn().mockResolvedValue([
          { MBLNR: '4900088883', MJAHR: '2026', ZEILE: '0001', BWART: '261', RSNUM: '0000100999', RSPOS: '0001' }
        ])
      };
      await expect(
        GoodsIssueIssuedSuStore.resolveClaimManual(claimId, 'posted', {
          materialDocument: '4900088883',
          materialDocYear: '2026',
          adapter: mockAdapterWrongResv
        })
      ).rejects.toThrow(/does not match claim reservation/i);

      // 4. Succeeds when document is verified: promotes to issued
      const mockAdapterSuccess = {
        readTable: jest.fn().mockResolvedValue([
          { MBLNR: '4900088888', MJAHR: '2026', ZEILE: '0001', BWART: '261', RSNUM: '0000100960', RSPOS: '0001' }
        ])
      };
      const resolved = await GoodsIssueIssuedSuStore.resolveClaimManual(claimId, 'posted', {
        materialDocument: '4900088888',
        materialDocYear: '2026',
        adapter: mockAdapterSuccess
      });
      expect(resolved.Status).toBe('issued');
      expect(resolved.MaterialDocument).toBe('4900088888');
      expect(resolved.NeedsAttention).toBe(false);

      // 5. Rejects when another claim attempts to link to the same document
      const [claimId2] = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100960',
        reservationItem: '0001',
        material: 'CH-MANUAL-VERIFY',
        plant: '1120',
        storageLocation: 'CS01',
        items: [{ storageUnit: 'DRUM_MAN_02', issuedQty: 10, preIssueStock: 48 }]
      });
      await expect(
        GoodsIssueIssuedSuStore.resolveClaimManual(claimId2, 'posted', {
          materialDocument: '4900088888',
          materialDocYear: '2026',
          adapter: mockAdapterSuccess
        })
      ).rejects.toThrow(/already linked to claim/i);
    });

    it('sets status released with reason/user/time instead of deleting on manual resolve action "not-posted"', async () => {
      const [claimId] = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100965',
        reservationItem: '0001',
        material: 'CH-MANUAL-RELEASE',
        plant: '1120',
        storageLocation: 'CS01',
        items: [{ storageUnit: 'DRUM_REL_01', issuedQty: 48, preIssueStock: 48 }]
      });

      const resolved = await GoodsIssueIssuedSuStore.resolveClaimManual(claimId, 'not-posted', {
        user: 'OPERATOR_BOB',
        reason: 'CONFIRMED_NEVER_POSTED'
      });

      // Status must be 'released', NOT deleted!
      expect(resolved.Status).toBe('released');
      expect(resolved.NeedsAttention).toBe(false);
      expect(resolved.ManualResolveAction).toBe('not-posted');
      expect(resolved.ReleaseReason).toBe('CONFIRMED_NEVER_POSTED');
      expect(resolved.ReleasedAt).toBeDefined();

      // Verified: row remains in store
      const active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-MANUAL-RELEASE', '1120', 'CS01');
      // No longer active, but record exists
      expect(active).toHaveLength(0);
    });

    it('keeps re-checking needs-attention claims in release job and auto-resolves when document appears', async () => {
      const [claimId] = await GoodsIssueIssuedSuStore.acquireClaims({
        reservationNo: '0000100980',
        reservationItem: '0001',
        material: 'CH-AUTO-RESOLVE-01',
        plant: '1120',
        storageLocation: 'CS01',
        items: [{ storageUnit: 'DRUM_AUTO_01', issuedQty: 48, preIssueStock: 48 }]
      });

      // Force transition to needs-attention
      const mockAdapterNoDoc = {
        findPosted261ByMatdoc: jest.fn().mockResolvedValue(null)
      };
      await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapterNoDoc, {
        now: Date.now(),
        staleClaimAgeMs: 0,
        needsAttentionAgeMs: 0
      });

      let active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-AUTO-RESOLVE-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('needs-attention');
      expect(active[0].NeedsAttention).toBe(true);

      // Cycle 1: document still not found in SAP -> remains needs-attention
      await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapterNoDoc, {
        now: Date.now() + 60000,
        staleClaimAgeMs: 0,
        needsAttentionAgeMs: 0
      });
      active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-AUTO-RESOLVE-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('needs-attention');

      // Cycle 2: document now appears in SAP -> auto-resolves to 'issued'
      const mockAdapterDocAppears = {
        findPosted261ByMatdoc: jest.fn().mockResolvedValue({
          MaterialDocument: '4900099888',
          MaterialDocYear: '2026'
        })
      };
      const result = await GoodsIssueIssuedSuStore.releaseByLquaDropOrReversal(mockAdapterDocAppears, {
        now: Date.now() + 120000,
        staleClaimAgeMs: 0,
        needsAttentionAgeMs: 0
      });

      expect(result.resolvedClaiming).toBe(1);
      active = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('CH-AUTO-RESOLVE-01', '1120', 'CS01');
      expect(active).toHaveLength(1);
      expect(active[0].Status).toBe('issued');
      expect(active[0].NeedsAttention).toBe(false);
      expect(active[0].MaterialDocument).toBe('4900099888');
    });
  });
});
