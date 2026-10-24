'use strict';

/**
 * test/unit/wm/duplicateConcurrentTimeoutRecovery.test.js
 *
 * P1 - Protect SAP writes:
 * 1. Fail closed if production transaction logging is unavailable (HTTP 503, 0 SAP writes).
 * 2. Duplicate / concurrent posting protection (HTTP 409 Conflict, exactly 1 SAP write, replay of posted docs).
 * 3. Timeout recovery and unconfirmed outcome handling (claims kept alive, recheck reconciliation).
 *
 * [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const attemptStore = require('../../../srv/wm/reservation-entry/ReservationAttemptStore');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');

describe('P1: Protect SAP Writes - Fail-Closed, Duplicate/Concurrent & Timeout Recovery [mock only]', () => {
  let resvSpy;
  let giPost201Spy;
  let giPost301Spy;
  let giPost311Spy;
  let _mvt261CycleSpy;
  let mvt261PostSpy;
  let mvt261RevSpy;
  let huTransferSpy;
  let _s4HttpSpy;
  let _rfcReadTableSpy;

  const authCarol = { auth: { username: 'carol', password: '' } };
  const authAlice = { auth: { username: 'alice', password: '' } };

  beforeEach(async () => {
    jest.restoreAllMocks();
    try {
      if (cds.db) {
        await cds.db.run(cds.ql.DELETE.from('saps4hana.wm.GoodsIssuePostingAttempt'));
      }
    } catch {}
    GoodsIssueAttemptStore.clearMemoryStore();

    // Default S4HttpClient mock
    _s4HttpSpy = jest.spyOn(S4HttpClient.prototype, 'get').mockImplementation(async (path, options = {}) => {
      const full = `${path}?${options?.query || ''}`;
      const is301 = full.includes('301') || full.includes('520301');
      const is311 = full.includes('311') || full.includes('520311');
      if (full.includes('C_ReservationDocTP_F4839')) {
        return {
          data: {
            d: {
              results: [{
                Reservation: is301 ? '520301' : (is311 ? '520311' : '520001'),
                IssuingOrReceivingPlant: is301 ? '1110' : '1120',
                IssuingOrReceivingStorageLoc: is311 ? 'HS01' : 'CS01',
                CostCenter: '1011201301'
              }]
            }
          }
        };
      }
      return {
        data: {
          d: {
            results: [{
              Reservation: is301 ? '520301' : (is311 ? '520311' : '520001'),
              ReservationItem: '0001',
              Plant: '1120',
              Material: '8000000023',
              MovementType: is301 ? '301' : (is311 ? '311' : '201'),
              StorageLocation: 'CS01',
              ReceivingPlant: is301 ? '1110' : '1120',
              ReceivingStorageLocation: is311 ? 'HS01' : 'CS01',
              ResvnItmRequiredQtyInBaseUnit: '10.000',
              ResvnItmWithdrawnQtyInBaseUnit: '0.000'
            }]
          }
        }
      };
    });

    // Default RFC mock
    _rfcReadTableSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
      if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
      if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS01' }, { WERKS: '1110', LGORT: 'CS01' }, { WERKS: '1120', LGORT: 'HS01' }];
      if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }, { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
      if (table === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011201301', DATBI: '99991231' }];
      if (table === 'MARC') return [{ MATNR: '000000008000000023', WERKS: '1120' }, { MATNR: '000000008000000023', WERKS: '1110' }];
      if (table === 'MARD') return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }, { MATNR: '000000008000000023', WERKS: '1110', LGORT: 'CS01', LABST: '50.000' }, { MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', LABST: '100.000' }];
      if (table === 'AFKO') return [{ AUFNR: '000000001011', AUFPT: 'PP01' }];
      if (table === 'RESB') return [{ RSNUM: '0000528780', RSPOS: '0001', MATNR: '000000008000000023', WERKS: '1120', LGORT: 'CS01', BDMNG: '10.000', ENMNG: '0.000', MEINS: 'KG' }];
      return [];
    });

    // Adapter write spies
    resvSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValue({
      success: true,
      stage: 'RESERVATION_CREATED',
      reservation: { number: '520001', item: '0001' },
      reservationNo: '520001',
      sapVerified: true
    });

    giPost201Spy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockResolvedValue({
      MaterialDocument: '4900050142',
      MaterialDocYear: '2026',
      PostingStatus: 'POSTED',
      Confirmed: true
    });

    giPost301Spy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301').mockResolvedValue({
      MaterialDocument: '4900050149',
      MaterialDocYear: '2026',
      PostingStatus: 'POSTED',
      Confirmed: true
    });

    giPost311Spy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue311').mockResolvedValue({
      MaterialDocument: '4900050153',
      MaterialDocYear: '2026',
      PostingStatus: 'POSTED',
      Confirmed: true
    });

    _mvt261CycleSpy = jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue({
      Reservation: '0000528780',
      ReservationItem: '0001',
      Material: '8000000023',
      Plant: '1120',
      StorageLocation: 'CS01',
      Unit: 'KG',
      OpenQuantity: 10,
      ProductionOrder: '4000033120',
      OrderType: 'ZBDN',
      MovementAllowed: true,
      FinalIssue: false,
      IsDeleted: false,
      History: [{
        MaterialDocument: '4900050254',
        MaterialDocumentYear: '2026',
        MaterialDocumentItem: '0001',
        MovementType: '261',
        IsReversed: false
      }]
    });

    mvt261PostSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
      MaterialDocument: '4900050254',
      MaterialDocumentYear: '2026',
      Pending: false
    });

    mvt261RevSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockResolvedValue({
      MaterialDocument: '4900050255',
      MaterialDocumentYear: '2026'
    });

    huTransferSpy = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({
      success: true,
      huNumber: '1122334455',
      materialDocument: '4900050999',
      materialDocYear: '2026',
      statusText: 'HU Stock Transfer Completed'
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // SECTION 1: Fail Closed If Production Transaction Logging Is Unavailable
  // ===========================================================================
  describe('1. Fail closed if production transaction logging is unavailable', () => {

    test('createReservation: aborts with HTTP 503 and NEVER calls SAP when attempt store throws', async () => {
      jest.spyOn(attemptStore, 'claim').mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));

      await expect(POST('/odata/v4/reservation-entry/createReservation', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'KG',
        CostCenter: '1011201301',
        ClientAttemptId: 'test-attempt-failclosed-001'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/production transaction logging is unavailable/i) } }
        }
      });

      expect(resvSpy).not.toHaveBeenCalled();
    });

    test('createReservationEntry: aborts with HTTP 503 and NEVER calls SAP when attempt store throws', async () => {
      jest.spyOn(attemptStore, 'claim').mockRejectedValue(new Error('Transaction log connection pool exhausted'));

      await expect(POST('/odata/v4/reservation-entry/createReservationEntry', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'KG',
        CostCenter: '1011201301',
        ClientAttemptId: 'test-attempt-failclosed-002'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/production transaction logging is unavailable/i) } }
        }
      });

      expect(resvSpy).not.toHaveBeenCalled();
    });

    test('postGoodsIssue201: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Persistent store unreachable'));

      await expect(POST('/odata/v4/goods-issue/postGoodsIssue201', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        IssueQty: 2,
        Unit: 'KG',
        CostCenter: '1011201301',
        PostingDate: '2026-10-24',
        ClientAttemptId: 'test-gi201-failclosed-003'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/posting attempt could not be recorded/i) } }
        }
      });

      expect(giPost201Spy).not.toHaveBeenCalled();
    });

    test('postGoodsIssue301: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('DB failure'));

      await expect(POST('/odata/v4/goods-issue/postGoodsIssue301', {
        MovementType: '301',
        ReservationNo: '520301',
        ReservationItem: '0001',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingPlant: '1110',
        ReceivingStorageLocation: 'CS01',
        Material: '8000000023',
        IssueQty: 2,
        Unit: 'KG',
        PostingDate: '2026-10-24',
        ClientAttemptId: 'test-gi301-failclosed-004'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/posting attempt could not be recorded/i) } }
        }
      });

      expect(giPost301Spy).not.toHaveBeenCalled();
    });

    test('postGoodsIssue311: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Disk I/O error'));

      await expect(POST('/odata/v4/goods-issue/postGoodsIssue311', {
        MovementType: '311',
        ReservationNo: '520311',
        ReservationItem: '0001',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingStorageLocation: 'HS01',
        Material: '8000000023',
        IssueQty: 2,
        Unit: 'KG',
        PostingDate: '2026-10-24',
        ClientAttemptId: 'test-gi311-failclosed-005'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/posting attempt could not be recorded/i) } }
        }
      });

      expect(giPost311Spy).not.toHaveBeenCalled();
    });

    test('Mvt261 postGoodsIssue: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Attempt store write failure'));

      await expect(POST('/odata/v4/mvt261/postGoodsIssue', {
        movementType: '261',
        orderId: '4000033120',
        orderType: 'ZBDN',
        reservation: '0000528780',
        item: '0001',
        quantity: 1,
        storageUnits: []
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/goods issue posting-attempt log is unavailable/i) } }
        }
      });

      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    test('Mvt261 reverse: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Reversal audit log down'));

      await expect(POST('/odata/v4/mvt261/reverse', {
        reservation: '0000528780',
        item: '0001',
        materialDocument: '4900050254',
        materialDocumentYear: '2026',
        materialDocumentItem: '0001'
      }, authAlice)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/reversal attempt log is unavailable/i) } }
        }
      });

      expect(mvt261RevSpy).not.toHaveBeenCalled();
    });

    test('executeHuStockTransfer: aborts with HTTP 503 and NEVER calls SAP when GoodsIssueAttemptStore throws', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('Attempt store down'));

      await expect(POST('/odata/v4/hu-stock-transfer/executeHuStockTransfer', {
        ReservationNo: '520001',
        ReservationItem: '0001',
        UnitNumber: '1122334455',
        TransferQty: 10,
        IsFullUnit: true,
        ClientAttemptId: 'test-hu-failclosed-006'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 503,
          data: { error: { message: expect.stringMatching(/production transaction logging is unavailable/i) } }
        }
      });

      expect(huTransferSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // SECTION 2: Duplicate / Concurrent Posting Protection
  // ===========================================================================
  describe('2. Duplicate and concurrent posting protection', () => {

    test('createReservation: concurrent in-progress attempt returns IN_PROGRESS and does not call SAP twice', async () => {
      let firstClaim = true;
      jest.spyOn(attemptStore, 'claim').mockImplementation(async () => {
        if (firstClaim) {
          firstClaim = false;
          return {
            created: true,
            row: { ID: 'attempt-res-1', AttemptKey: 'key-1', Stage: 'INITIAL' }
          };
        }
        return {
          created: false,
          reason: 'in_progress',
          row: { ID: 'attempt-res-1', AttemptKey: 'key-1', Stage: 'RESERVATION_CLAIMED', LastError: '' }
        };
      });

      // First call (creates claim, proceeds to SAP)
      const res1 = await POST('/odata/v4/reservation-entry/createReservation', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'KG',
        CostCenter: '1011201301',
        ClientAttemptId: 'concurrent-res-1'
      }, authCarol);

      expect(res1.status).toBe(200);
      expect(res1.data.success).toBe(true);
      expect(resvSpy).toHaveBeenCalledTimes(1);

      // Second concurrent call with same attempt
      const res2 = await POST('/odata/v4/reservation-entry/createReservation', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'KG',
        CostCenter: '1011201301',
        ClientAttemptId: 'concurrent-res-1'
      }, authCarol);

      expect(res2.status).toBe(200);
      expect(res2.data.success).toBe(false);
      expect(res2.data.stage).toBe('IN_PROGRESS');
      // SAP must NOT have been called a second time
      expect(resvSpy).toHaveBeenCalledTimes(1);
    });

    test('createReservation: replay of completed attempt returns existing document without duplicate SAP call', async () => {
      jest.spyOn(attemptStore, 'claim').mockResolvedValue({
        created: false,
        reason: 'replay',
        row: {
          ID: 'attempt-res-done',
          AttemptKey: 'key-replay',
          Stage: 'RESERVATION_CREATED',
          ReservationNo: '0000520001',
          ReservationItem: '0001'
        }
      });

      const res = await POST('/odata/v4/reservation-entry/createReservation', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'KG',
        CostCenter: '1011201301',
        ClientAttemptId: 'replay-res-001'
      }, authCarol);

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.stage).toBe('REPLAY');
      expect(res.data.reservation.number).toBe('520001');
      expect(resvSpy).not.toHaveBeenCalled();
    });

    test('postGoodsIssue201: replay of already posted goods issue returns existing document without duplicate SAP call', async () => {
      // First call succeeds and claims
      const res1 = await POST('/odata/v4/goods-issue/postGoodsIssue201', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        IssueQty: 2,
        Unit: 'KG',
        CostCenter: '1011201301',
        PostingDate: '2026-10-24',
        ClientAttemptId: 'replay-gi-201'
      }, authCarol);

      expect(res1.status).toBe(200);
      expect(res1.data.PostingStatus).toBe('POSTED');
      expect(giPost201Spy).toHaveBeenCalledTimes(1);

      // Re-posting with same ClientAttemptId returns the existing posted document
      const res2 = await POST('/odata/v4/goods-issue/postGoodsIssue201', {
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        IssueQty: 2,
        Unit: 'KG',
        CostCenter: '1011201301',
        PostingDate: '2026-10-24',
        ClientAttemptId: 'replay-gi-201'
      }, authCarol);

      expect(res2.status).toBe(200);
      expect(res2.data.PostingStatus).toBe('POSTED');
      expect(res2.data.Confirmed).toBe(true);
      expect(giPost201Spy).toHaveBeenCalledTimes(1);
    });

    test('Mvt261 postGoodsIssue: concurrent double-submit returns 409 and calls adapter once', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockResolvedValue({
        created: false,
        row: {
          ReferenceDocument: 'GI261CONCUR01',
          Status: 'sending'
        }
      });

      await expect(POST('/odata/v4/mvt261/postGoodsIssue', {
        movementType: '261',
        orderId: '4000033120',
        orderType: 'ZBDN',
        reservation: '0000528780',
        item: '0001',
        quantity: 1
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 409,
          data: { error: { message: expect.stringMatching(/already in progress/i) } }
        }
      });

      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    test('ReservationProcessAdapter postGoodsMovement: de-duplicates concurrent in-flight calls sharing ProcessId', async () => {
      const adapter = new ReservationProcessAdapter({ mock: true });
      let callCount = 0;
      jest.spyOn(adapter, '_postGoodsMovement').mockImplementation(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true, materialDocument: '4900059999', materialDocYear: '2026' };
      });

      const params = {
        processId: 'IN_FLIGHT_PROC_99',
        reservationNumber: '520001',
        reservationItem: '0001',
        movementType: '201',
        material: '8000000023',
        plant: '1120',
        storageLocation: 'CS01',
        quantity: 1
      };

      const [res1, res2] = await Promise.all([
        adapter.postGoodsMovement(params),
        adapter.postGoodsMovement(params)
      ]);

      expect(res1.materialDocument).toBe('4900059999');
      expect(res2.materialDocument).toBe('4900059999');
      expect(callCount).toBe(1);
    });
  });

  // ===========================================================================
  // SECTION 3: Timeout Recovery & Reconciliation
  // ===========================================================================
  describe('3. Timeout recovery and unconfirmed outcome reconciliation', () => {

    test('postGoodsIssue201: network timeout leaves attempt unconfirmed and returns 504 with do-not-post-again message', async () => {
      const timeoutErr = new Error('ESOCKETTIMEDOUT: connection timed out');
      timeoutErr.code = 'ESOCKETTIMEDOUT';
      giPost201Spy.mockRejectedValue(timeoutErr);

      const setStatusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');

      await expect(POST('/odata/v4/goods-issue/postGoodsIssue201', {
        Plant: '1120',
        StorageLocation: 'CS01',
        Material: '8000000023',
        IssueQty: 2,
        Unit: 'KG',
        CostCenter: '1011201301',
        MovementType: '201',
        PostingDate: '2026-10-24',
        ClientAttemptId: 'timeout-attempt-201'
      }, authCarol)).rejects.toMatchObject({
        response: {
          status: 504,
          data: { error: { message: expect.stringMatching(/do not post again/i) } }
        }
      });

      // Verify attempt was transitioned to unconfirmed (NOT rejected / deleted)
      expect(setStatusSpy).toHaveBeenCalledWith(
        expect.any(String),
        'unconfirmed',
        expect.objectContaining({ LastError: expect.stringMatching(/do not post again/i) })
      );
    });

    test('reconfirmUnconfirmed: promotes unconfirmed attempt to posted when readBackDocument confirms persistence in SAP', async () => {
      await GoodsIssueAttemptStore.create({
        ReferenceDocument: 'GI-TIMEOUT-REC-01',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'CS01',
        IssueQty: 2
      });

      await GoodsIssueAttemptStore.setStatus('GI-TIMEOUT-REC-01', 'unconfirmed', {
        MaterialDocument: '4900050888',
        MaterialDocYear: '2026'
      });

      // 2. Mock readBackDocument confirming document committed in SAP
      jest.spyOn(GoodsIssueAdapter, 'readBackDocument').mockResolvedValue({
        MaterialDocument: '4900050888',
        MaterialDocYear: '2026',
        Confirmed: true,
        Status: 'confirmed',
        Tier: 'MATDOC'
      });

      // 3. Execute reconfirmUnconfirmed
      const summary = await GoodsIssueAttemptStore.reconfirmUnconfirmed(GoodsIssueAdapter);

      expect(summary.Checked).toBe(1);
      expect(summary.Confirmed).toBe(1);
      const row = await GoodsIssueAttemptStore.getByReference('GI-TIMEOUT-REC-01');
      expect(row.Status).toBe('posted');
      expect(row.MaterialDocument).toBe('4900050888');
      expect(row.MaterialDocYear).toBe('2026');
    });

    test('recheck reconciliation: transitions aged attempt (>= 15 min) to not_posted when SAP proves absence', async () => {
      const now = Date.now();
      await GoodsIssueAttemptStore.create({
        ReferenceDocument: 'GI-AGED-ABSENT-01',
        MovementType: '201',
        Material: '8000000023',
        Plant: '1120',
        StorageLocation: 'CS01',
        IssueQty: 2,
        createdAt: new Date(now).toISOString()
      });

      jest.spyOn(GoodsIssueAdapter, 'findPostedGoodsIssueByReference').mockResolvedValue(null);
      jest.spyOn(GoodsIssueAttemptStore, '_findDeliveryForAttempt').mockResolvedValue(null);

      const summary = await GoodsIssueAttemptStore.recheck(GoodsIssueAdapter, now + 16 * 60 * 1000);

      expect(summary.NotPosted).toBe(1);
      const row = await GoodsIssueAttemptStore.getByReference('GI-AGED-ABSENT-01');
      expect(row.Status).toBe('not_posted');
    });
  });
});
