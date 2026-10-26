'use strict';

/**
 * Critical Transaction Authorization & Gating Test Suite
 * Phase 2 — Gate critical SAP transactions
 *
 * Covers:
 * 1. ReservationEntryService write action gating:
 *    - Unauthenticated (no session) -> 401 Unauthorized
 *    - Viewer role (bob) -> 403 Forbidden
 *    - WarehouseClerk (carol) -> 200 Permitted (bypasses auth gate)
 *    Covers: createReservation, createTransferRequirement, createTOFromTR,
 *            confirmTransferOrder, createReservationEntry, postMigoGoodsMovement,
 *            executeReservationWarehouseFlow
 *
 * 2. GoodsIssueService write action gating & privilege escalation protection:
 *    - postGoodsIssue201, postGoodsIssue301, postGoodsIssue311:
 *      - Unauthenticated -> 401
 *      - Viewer (bob) -> 403
 *      - WarehouseClerk (carol) -> 200 Permitted
 *    - recheckPostingAttempts:
 *      - Unauthenticated -> 401
 *      - Viewer (bob) -> 403
 *      - WarehouseClerk (carol) -> 403 (privilege escalation blocked: manager/admin only)
 *      - WarehouseManager / Admin (alice) -> 200 Permitted
 *
 * 3. Mvt261Service authorization & plant scope gating:
 *    - postGoodsIssue: Viewer (bob) -> 403, WarehouseClerk (carol) -> 200 Permitted
 *    - reverse: Viewer (bob) -> 403, WarehouseClerk (carol) -> 403, Admin (alice) -> 200 Permitted
 *    - plantScope: dave (plant 1130) -> 403 for plant 1120; eve (no plant) -> 403
 *
 * 4. HuStockTransferService gating:
 *    - executeHuStockTransfer: Unauthenticated -> 401, Viewer (bob) -> 403, WarehouseClerk (carol) -> 200 Permitted
 *
 * 5. S/4HANA Backend RFC Authorization Failure:
 *    - Backend RFC authorization failure is handled safely without leaking credentials or passwords.
 *
 * [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST, GET } = cds.test(__dirname + '/../../../');

describe('Phase 2: Critical Transaction Authorization & Gating [mock only, not SAP verification]', () => {
  let resvSpy;
  let trSpy;
  let _toSpy;
  let toConfirmSpy;
  let postMigoSpy;
  let flowSpy;
  let giPost201Spy;
  let giPost301Spy;
  let giPost311Spy;
  let _mvt261CycleSpy;
  let mvt261PostSpy;
  let mvt261RevSpy;
  let huTransferSpy;
  let _s4HttpSpy;
  let _rfcReadTableSpy;

  beforeEach(() => {
    // S4HttpClient mock for reservation pre-checks with positive open quantities
    _s4HttpSpy = jest.spyOn(S4HttpClient.prototype, 'get').mockImplementation(async (path) => {
      const is301 = String(path).includes('301') || String(path).includes('520301');
      if (String(path).includes('C_ReservationDocTP_F4839')) {
        return {
          data: {
            d: {
              results: [{
                Reservation: is301 ? '520301' : '520001',
                IssuingOrReceivingPlant: is301 ? '1110' : '1120',
                IssuingOrReceivingStorageLoc: 'CS01',
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
              Reservation: is301 ? '520301' : '520001',
              ReservationItem: '0001',
              Plant: '1120',
              Material: '8000000023',
              MovementType: is301 ? '301' : '201',
              StorageLocation: 'HS01',
              ReceivingPlant: is301 ? '1110' : '1120',
              ReceivingStorageLocation: 'CS01',
              ResvnItmRequiredQtyInBaseUnit: '10.000',
              ResvnItmWithdrawnQtyInBaseUnit: '0.000'
            }]
          }
        }
      };
    });

    _rfcReadTableSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
      if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
      if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS01' }, { WERKS: '1110', LGORT: 'CS01' }];
      if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }, { LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
      if (table === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011201301', DATBI: '99991231' }];
      if (table === 'MARC') return [{ MATNR: '000000008000000023', WERKS: '1120' }, { MATNR: '000000008000000023', WERKS: '1110' }];
      if (table === 'MARD') return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }, { MATNR: '000000008000000023', WERKS: '1110', LGORT: 'CS01', LABST: '50.000' }];
      return [];
    });

    // ReservationProcessAdapter spies
    resvSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValue({
      success: true,
      stage: 'RESERVATION_CREATED',
      reservation: { number: '520001', item: '0001' },
      movementType: '201'
    });

    trSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValue({
      success: true,
      stage: 'TR_CREATED',
      trNumber: '1000001',
      trItem: '0001',
      warehouseNumber: 'W01',
      movementType: '201'
    });

    _toSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTOFromTR').mockResolvedValue({
      success: true,
      stage: 'TO_CREATED',
      warehouseNumber: 'W01',
      toNumber: '1030001',
      confirmed: false,
      status: 'O'
    });

    toConfirmSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'confirmTransferOrder').mockResolvedValue({
      success: true,
      stage: 'TO_CONFIRMED',
      warehouseNumber: 'W01',
      toNumber: '1030001',
      confirmed: true,
      status: 'C'
    });

    postMigoSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockResolvedValue({
      success: true,
      stage: 'MIGO_POSTED',
      materialDocument: '5000000201',
      materialDocumentYear: '2026',
      quantity: 10
    });

    flowSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'executeReservationWarehouseFlow').mockResolvedValue({
      success: true,
      state: 'COMPLETED',
      completed: true,
      reservationNumber: '520001',
      materialDocument: '5000000201'
    });

    // GoodsIssueAdapter spies
    jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockResolvedValue([{
      ReservationNo: '520001',
      MovementType: '201',
      MovementTypeName: 'GI for cost center',
      SampleMaterial: '8000000023',
      SampleMaterialDesc: 'Test Material',
      Plant: '1120',
      StorageLocation: 'HS01'
    }]);

    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockImplementation(async (resNo, itemNo) => ({
      ReservationNo: resNo,
      ReservationItem: itemNo,
      Plant: '1120',
      StorageLocation: 'HS01',
      ReceivingPlant: (String(resNo).includes('301') || resNo === '520301') ? '1110' : '1120',
      ReceivingStorageLocation: 'CS01',
      Material: '8000000023',
      MovementType: (String(resNo).includes('301') || resNo === '520301') ? '301' : '201',
      RequiredQty: 10,
      WithdrawnQty: 0,
      OpenQty: 10
    }));

    giPost201Spy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockResolvedValue({
      Success: true,
      Confirmed: true,
      ReservationNo: '520001',
      ReservationItem: '0001',
      MaterialDocument: '5000000201',
      MaterialDocYear: '2026'
    });

    giPost301Spy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301').mockResolvedValue({
      Success: true,
      Confirmed: true,
      ReservationNo: '520301',
      ReservationItem: '0001',
      MaterialDocument: '5000000301',
      MaterialDocYear: '2026'
    });

    giPost311Spy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue311').mockResolvedValue({
      Success: true,
      Confirmed: true,
      ReservationNo: '520311',
      ReservationItem: '0001',
      MaterialDocument: '5000000311',
      MaterialDocYear: '2026'
    });

    // Mvt261Adapter spies
    _mvt261CycleSpy = jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockImplementation(async (input = {}) => {
      const allowed = input.allowedPlants;
      if (allowed !== undefined && allowed !== null && !allowed.includes('1120')) {
        const err = new Error('Not authorized for plant 1120');
        err.status = 403;
        throw err;
      }
      return {
        Reservation: '528780',
        ReservationItem: '1',
        Material: 'M',
        Plant: '1120',
        StorageLocation: 'CS01',
        ProductionOrder: '4000033120',
        OrderType: 'ZBDN',
        Unit: 'NOS',
        OpenQuantity: 10,
        History: [{
          MaterialDocument: '5000000261',
          MaterialDocumentYear: '2026',
          MaterialDocumentItem: '0001',
          MovementType: '261',
          IsReversed: false
        }]
      };
    });

    mvt261PostSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
      MaterialDocument: '5000000261', MaterialDocumentYear: '2026', DeliveryNumber: '', Pending: false, SapMessage: ''
    });

    mvt261RevSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockResolvedValue({
      MaterialDocument: '5000000262', MaterialDocumentYear: '2026', SapMessage: 'Reversed'
    });

    // plant-scope pre-read of the reservation (carol/dave are plant-scoped users)
    jest.spyOn(HuStockTransferAdapter.prototype, 'getCockpitDetail').mockResolvedValue({ ReservationNo: '520001', ReservationItem: '1', Plant: '1120', OpenQty: 10 });
    // HuStockTransferAdapter spy
    huTransferSpy = jest.spyOn(HuStockTransferAdapter.prototype, 'executeHuStockTransfer').mockResolvedValue({
      Success: true,
      ReservationNo: '520311',
      ReservationItem: '0001',
      MaterialDocument: '5000000311',
      MaterialDocYear: '2026',
      TransferOrder: '1030311',
      Message: 'HU transferred successfully'
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. ReservationEntryService Write Action Authorization Gates
  // =========================================================================
  describe('1. ReservationEntryService Write Action Gating', () => {
    const defaultResvPayload = {
      MovementType: '201',
      Plant: '1120',
      StorageLocation: 'HS01',
      Material: '8000000023',
      Quantity: 10,
      Unit: 'NOS',
      CostCenter: '1011201301',
      WarehouseNumber: 'W01',
      ClientAttemptId: 'test-attempt-001'
    };

    describe('createReservation action', () => {
      const url = '/odata/v4/reservation-entry/createReservation';

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, defaultResvPayload)).rejects.toMatchObject({ response: { status: 401 } });
        expect(resvSpy).not.toHaveBeenCalled();
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, defaultResvPayload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(resvSpy).not.toHaveBeenCalled();
      });

      it('permits authorized WarehouseClerk (carol)', async () => {
        const res = await POST(url, defaultResvPayload, { auth: { username: 'carol', password: '' } });
        expect(res.status).toBe(200);
        expect(resvSpy).toHaveBeenCalledTimes(1);
      });

      it('rejects out-of-scope clerk (dave, plant 1130) creating reservation for plant 1120 with 403', async () => {
        await expect(POST(url, defaultResvPayload, { auth: { username: 'dave', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(resvSpy).not.toHaveBeenCalled();
      });

      it('rejects unassigned plant user (eve, no plant attribute) with 403', async () => {
        await expect(POST(url, defaultResvPayload, { auth: { username: 'eve', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(resvSpy).not.toHaveBeenCalled();
      });
    });

    describe('createTransferRequirement action', () => {
      const url = '/odata/v4/reservation-entry/createTransferRequirement';
      const payload = { ReservationNo: '520001', ReservationItem: '0001', WarehouseNumber: 'W01' };

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, payload)).rejects.toMatchObject({ response: { status: 401 } });
        expect(trSpy).not.toHaveBeenCalled();
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, payload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(trSpy).not.toHaveBeenCalled();
      });

      it('permits authorized WarehouseClerk (carol)', async () => {
        const res = await POST(url, payload, { auth: { username: 'carol', password: '' } });
        expect(res.status).toBe(200);
        expect(trSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe('createTOFromTR action', () => {
      const url = '/odata/v4/reservation-entry/createTOFromTR';
      const payload = { ReservationNo: '520001', ReservationItem: '0001', WarehouseNumber: 'W01', TRNumber: '1000001', autoConfirm: false };

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, payload)).rejects.toMatchObject({ response: { status: 401 } });
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, payload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('permits authorized WarehouseClerk (carol) through auth gate', async () => {
        const res = await POST(url, payload, { auth: { username: 'carol', password: '' } });
        expect(res.status).toBe(200);
      });
    });

    describe('confirmTransferOrder action', () => {
      const url = '/odata/v4/reservation-entry/confirmTransferOrder';
      const payload = { ReservationNo: '520001', ReservationItem: '0001', WarehouseNumber: 'W01', TransferOrder: '1030001' };

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, payload)).rejects.toMatchObject({ response: { status: 401 } });
        expect(toConfirmSpy).not.toHaveBeenCalled();
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, payload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(toConfirmSpy).not.toHaveBeenCalled();
      });

      it('permits authorized WarehouseClerk (carol)', async () => {
        const res = await POST(url, payload, { auth: { username: 'carol', password: '' } });
        expect(res.status).toBe(200);
        expect(toConfirmSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe('createReservationEntry action', () => {
      const url = '/odata/v4/reservation-entry/createReservationEntry';

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, defaultResvPayload)).rejects.toMatchObject({ response: { status: 401 } });
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, defaultResvPayload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('permits authorized WarehouseClerk (carol) past authorization gate', async () => {
        const res = await POST(url, defaultResvPayload, { auth: { username: 'carol', password: '' } })
          .catch((err) => err.response);
        // carol is authenticated and authorized; not rejected with 401 or 403
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it('rejects out-of-scope clerk (dave, plant 1130) creating reservation entry for plant 1120 with 403', async () => {
        await expect(POST(url, defaultResvPayload, { auth: { username: 'dave', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('rejects unassigned plant user (eve, no plant attribute) creating entry with 403', async () => {
        await expect(POST(url, defaultResvPayload, { auth: { username: 'eve', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });
    });

    describe('postMigoGoodsMovement action', () => {
      const url = '/odata/v4/reservation-entry/postMigoGoodsMovement';
      const payload = {
        ReservationNo: '520001',
        ReservationItem: '0001',
        MovementType: '201',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Quantity: 10,
        Unit: 'NOS',
        CostCenter: '1011201301'
      };

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, payload)).rejects.toMatchObject({ response: { status: 401 } });
        expect(postMigoSpy).not.toHaveBeenCalled();
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, payload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(postMigoSpy).not.toHaveBeenCalled();
      });

      it('permits authorized WarehouseClerk (carol) through auth gate', async () => {
        const res = await POST(url, payload, { auth: { username: 'carol', password: '' } })
          .catch((err) => err.response);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it('rejects out-of-scope clerk (dave, plant 1130) posting MIGO for plant 1120 with 403', async () => {
        await expect(POST(url, payload, { auth: { username: 'dave', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(postMigoSpy).not.toHaveBeenCalled();
      });

      it('rejects unassigned plant user (eve) with 403', async () => {
        await expect(POST(url, payload, { auth: { username: 'eve', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(postMigoSpy).not.toHaveBeenCalled();
      });
    });

    describe('executeReservationWarehouseFlow action', () => {
      const url = '/odata/v4/reservation-entry/executeReservationWarehouseFlow';
      const flowPayload = {
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000000023',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        warehouseNumber: 'W01'
      };

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, flowPayload)).rejects.toMatchObject({ response: { status: 401 } });
        expect(flowSpy).not.toHaveBeenCalled();
      });

      it('rejects read-only Viewer (bob) with 403', async () => {
        await expect(POST(url, flowPayload, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(flowSpy).not.toHaveBeenCalled();
      });

      it('permits authorized WarehouseClerk (carol)', async () => {
        const res = await POST(url, flowPayload, { auth: { username: 'carol', password: '' } });
        expect(res.status).toBe(200);
        expect(flowSpy).toHaveBeenCalledTimes(1);
      });

      it('rejects out-of-scope clerk (dave, plant 1130) executing flow for plant 1120 with 403', async () => {
        await expect(POST(url, flowPayload, { auth: { username: 'dave', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(flowSpy).not.toHaveBeenCalled();
      });

      it('rejects unassigned plant user (eve, no plant attribute) executing flow with 403', async () => {
        await expect(POST(url, flowPayload, { auth: { username: 'eve', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
        expect(flowSpy).not.toHaveBeenCalled();
      });
    });

    describe('getOpenReservations function (plant scope)', () => {
      const url = "/odata/v4/reservation-entry/getOpenReservations(plant='1120',movementType='')";

      it('rejects out-of-scope user (dave, plant 1130) querying plant 1120 with 403', async () => {
        await expect(GET(url, { auth: { username: 'dave', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('rejects unassigned plant user (eve) querying plant 1120 with 403', async () => {
        await expect(GET(url, { auth: { username: 'eve', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('permits authorized user (carol, plant 1120) querying plant 1120', async () => {
        const res = await GET(url, { auth: { username: 'carol', password: '' } });
        expect(res.status).toBe(200);
        expect(res.data.value).toHaveLength(1);
      });
    });
  });

  // =========================================================================
  // 2. GoodsIssueService Write Actions & Privilege Escalation Gates
  // =========================================================================
  describe('2. GoodsIssueService Write Actions & Privilege Escalation Gating', () => {
    const giPayload201 = {
      MovementType: '201',
      ReservationNo: '520001',
      ReservationItem: '0001',
      Material: '8000000023',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 10,
      Unit: 'NOS',
      CostCenter: '1011201301',
      ClientAttemptId: 'gi-attempt-201'
    };

    const giPayload301 = {
      MovementType: '301',
      ReservationNo: '520301',
      ReservationItem: '0001',
      Material: '8000000023',
      Plant: '1120',
      StorageLocation: 'HS01',
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01',
      IssueQty: 10,
      Unit: 'NOS',
      ClientAttemptId: 'gi-attempt-301'
    };

    const giPayload311 = {
      MovementType: '311',
      ReservationNo: '520001',
      ReservationItem: '0001',
      Material: '8000000023',
      Plant: '1120',
      StorageLocation: 'HS01',
      ReceivingPlant: '1120',
      ReceivingStorageLocation: 'CS01',
      IssueQty: 10,
      Unit: 'NOS',
      ClientAttemptId: 'gi-attempt-311'
    };

    it('postGoodsIssue201: gates unauthenticated (401) and Viewer (403); permits carol (200)', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue201';
      await expect(POST(url, giPayload201)).rejects.toMatchObject({ response: { status: 401 } });
      await expect(POST(url, giPayload201, { auth: { username: 'bob', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost201Spy).not.toHaveBeenCalled();

      const ok = await POST(url, giPayload201, { auth: { username: 'carol', password: '' } });
      expect(ok.status).toBe(200);
      expect(giPost201Spy).toHaveBeenCalledTimes(1);
    });

    it('postGoodsIssue201: rejects out-of-scope clerk (dave, plant 1130) for plant 1120 with 403', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue201';
      await expect(POST(url, giPayload201, { auth: { username: 'dave', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost201Spy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue201: rejects unassigned plant user (eve) with 403', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue201';
      await expect(POST(url, giPayload201, { auth: { username: 'eve', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost201Spy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue301: gates unauthenticated (401) and Viewer (403); permits carol (200)', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue301';
      await expect(POST(url, giPayload301)).rejects.toMatchObject({ response: { status: 401 } });
      await expect(POST(url, giPayload301, { auth: { username: 'bob', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost301Spy).not.toHaveBeenCalled();

      const ok = await POST(url, giPayload301, { auth: { username: 'carol', password: '' } });
      expect(ok.status).toBe(200);
      expect(giPost301Spy).toHaveBeenCalledTimes(1);
    });

    it('postGoodsIssue301: rejects out-of-scope clerk (dave, plant 1130) issuing from plant 1120 with 403', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue301';
      await expect(POST(url, giPayload301, { auth: { username: 'dave', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost301Spy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue301: rejects unassigned plant user (eve) with 403', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue301';
      await expect(POST(url, giPayload301, { auth: { username: 'eve', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost301Spy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue311: gates unauthenticated (401) and Viewer (403); permits carol (200)', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue311';
      await expect(POST(url, giPayload311)).rejects.toMatchObject({ response: { status: 401 } });
      await expect(POST(url, giPayload311, { auth: { username: 'bob', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost311Spy).not.toHaveBeenCalled();

      const ok = await POST(url, giPayload311, { auth: { username: 'carol', password: '' } });
      expect(ok.status).toBe(200);
      expect(giPost311Spy).toHaveBeenCalledTimes(1);
    });

    it('postGoodsIssue311: rejects out-of-scope clerk (dave, plant 1130) transferring in plant 1120 with 403', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue311';
      await expect(POST(url, giPayload311, { auth: { username: 'dave', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost311Spy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue311: rejects unassigned plant user (eve) with 403', async () => {
      const url = '/odata/v4/goods-issue/postGoodsIssue311';
      await expect(POST(url, giPayload311, { auth: { username: 'eve', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(giPost311Spy).not.toHaveBeenCalled();
    });

    describe('recheckPostingAttempts action (Manager/Admin only - privilege escalation protection)', () => {
      const url = '/odata/v4/goods-issue/recheckPostingAttempts';

      it('rejects unauthenticated request with 401', async () => {
        await expect(POST(url, {})).rejects.toMatchObject({ response: { status: 401 } });
      });

      it('rejects Viewer (bob) with 403', async () => {
        await expect(POST(url, {}, { auth: { username: 'bob', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('rejects WarehouseClerk (carol) with 403 — clerk cannot perform manager administrative recheck', async () => {
        await expect(POST(url, {}, { auth: { username: 'carol', password: '' } }))
          .rejects.toMatchObject({ response: { status: 403 } });
      });

      it('permits Admin / WarehouseManager (alice) with 200', async () => {
        const res = await POST(url, {}, { auth: { username: 'alice', password: '' } });
        expect(res.status).toBe(200);
      });
    });
  });

  // =========================================================================
  // 3. Mvt261Service Authorization, Reversal & Plant Scope Gating
  // =========================================================================
  describe('3. Mvt261Service Gating & Plant Scope', () => {
    it('postGoodsIssue: rejects Viewer (bob) with 403; permits WarehouseClerk (carol)', async () => {
      const url = '/odata/v4/mvt261/postGoodsIssue';
      const payload = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '528780', item: '1', quantity: 10 };

      await expect(POST(url, payload, { auth: { username: 'bob', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261PostSpy).not.toHaveBeenCalled();

      const res = await POST(url, payload, { auth: { username: 'carol', password: '' } });
      expect(res.status).toBe(200);
      expect(mvt261PostSpy).toHaveBeenCalledTimes(1);
    });

    it('postGoodsIssue: rejects out-of-scope clerk (dave, plant 1130) for plant 1120 reservation with 403', async () => {
      const url = '/odata/v4/mvt261/postGoodsIssue';
      const payload = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '528780', item: '1', quantity: 10 };
      await expect(POST(url, payload, { auth: { username: 'dave', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    it('postGoodsIssue: rejects unassigned plant user (eve) with 403', async () => {
      const url = '/odata/v4/mvt261/postGoodsIssue';
      const payload = { movementType: '261', orderId: '4000033120', orderType: 'ZBDN', reservation: '528780', item: '1', quantity: 10 };
      await expect(POST(url, payload, { auth: { username: 'eve', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261PostSpy).not.toHaveBeenCalled();
    });

    it('reverse: rejects Clerk (carol) with 403 (privilege escalation blocked); permits alice (Admin/Manager)', async () => {
      const url = '/odata/v4/mvt261/reverse';
      const payload = {
        reservation: '528780',
        item: '1',
        materialDocument: '5000000261',
        materialDocumentYear: '2026',
        materialDocumentItem: '0001'
      };

      await expect(POST(url, payload, { auth: { username: 'carol', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(mvt261RevSpy).not.toHaveBeenCalled();

      const ok = await POST(url, payload, { auth: { username: 'alice', password: '' } });
      expect(ok.status).toBe(200);
      expect(mvt261RevSpy).toHaveBeenCalledTimes(1);
    });

    it('plant scope: out-of-scope user (dave, plant 1130) asking for 1120 receives 403', async () => {
      const url = "/odata/v4/mvt261/openItems(plant='1120',material='',productionOrder='',reservation='',dateFrom='',dateTo='',includeFullyWithdrawn=false,scanPossibleOnly=false)";
      await expect(GET(url, { auth: { username: 'dave', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
    });

    it('plant scope: user with no plant scope (eve) asking for 1120 receives 403', async () => {
      const url = "/odata/v4/mvt261/openItems(plant='1120',material='',productionOrder='',reservation='',dateFrom='',dateTo='',includeFullyWithdrawn=false,scanPossibleOnly=false)";
      await expect(GET(url, { auth: { username: 'eve', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
    });
  });

  // =========================================================================
  // 4. HuStockTransferService Gating
  // =========================================================================
  describe('4. HuStockTransferService executeHuStockTransfer Gating', () => {
    const url = '/odata/v4/hu-stock-transfer/executeHuStockTransfer';
    const payload = {
      ReservationNo: '520311',
      ReservationItem: '0001',
      UnitNumber: '1000048321',
      TransferQty: 10,
      IsFullUnit: true,
      ClientAttemptId: 'hu-attempt-001'
    };

    it('rejects unauthenticated request with 401', async () => {
      await expect(POST(url, payload)).rejects.toMatchObject({ response: { status: 401 } });
      expect(huTransferSpy).not.toHaveBeenCalled();
    });

    it('rejects read-only Viewer (bob) with 403', async () => {
      await expect(POST(url, payload, { auth: { username: 'bob', password: '' } }))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(huTransferSpy).not.toHaveBeenCalled();
    });

    it('permits authorized WarehouseClerk (carol)', async () => {
      const res = await POST(url, payload, { auth: { username: 'carol', password: '' } });
      expect(res.status).toBe(200);
      expect(huTransferSpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 5. Backend RFC Authorization Failure & Leak Prevention
  // =========================================================================
  describe('5. S/4HANA Backend RFC Authorization Failure & Leak Prevention', () => {
    it('handles backend USER_NOT_AUTHORIZED safely without leaking system secrets', async () => {
      flowSpy.mockRestore();
      resvSpy.mockRestore();

      const mockRfc = {
        session: jest.fn(async (fn) => fn(mockRfc.call)),
        call: jest.fn().mockImplementation(async (fm) => {
          if (fm === 'BAPI_RESERVATION_CREATE1') {
            const authErr = new Error('RFC_ERROR_SYSTEM_FAILURE: No authorization to execute RFC BAPI_RESERVATION_CREATE1 (authorization object S_RFC user TESTUSER client 100)');
            authErr.code = 'USER_NOT_AUTHORIZED';
            throw authErr;
          }
          return {};
        }),
        readTable: jest.fn().mockImplementation(async (table) => {
          if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
          if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }];
          if (table === 'CSKS') return [{ KOKRS: '1000', KOSTL: '001011201301', DATBI: '99991231' }];
          if (table === 'MARC') return [{ MATNR: '000000008000000023', WERKS: '1120' }];
          if (table === 'MARD') return [{ MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', LABST: '100.000' }];
          return [];
        })
      };

      const testAdapter = new ReservationProcessAdapter({ rfc: mockRfc });

      const input = {
        movementType: '201',
        plant: '1120',
        storageLocation: 'HS01',
        material: '8000000023',
        quantity: 10,
        unit: 'NOS',
        costCenter: '1011201301',
        processId: 'auth-test-proc-001'
      };

      const result = await testAdapter.executeReservationWarehouseFlow(input);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('RESERVATION');
      expect(result.error).toContain('No authorization');
      // Verify no password, token, or secret is leaked in error message or details
      expect(result.error).not.toMatch(/password|passwd|bearer|client_secret/i);
      expect(JSON.stringify(result)).not.toMatch(/password|passwd|bearer|client_secret/i);
    });

    it('handles BAPI_GOODSMVT_CREATE authorization failure without leaking credentials', async () => {
      postMigoSpy.mockRestore();

      const mockRfc = {
        session: jest.fn(async (fn) => fn(mockRfc.call)),
        call: jest.fn().mockImplementation(async (fm) => {
          if (fm === 'BAPI_GOODSMVT_CREATE') {
            return {
              MATERIALDOCUMENT: '',
              MATDOCUMENTYEAR: '',
              RETURN: [{
                TYPE: 'E',
                ID: 'M7',
                NUMBER: '120',
                MESSAGE: 'You have no authorization for movement type 201 in plant 1120'
              }]
            };
          }
          if (fm === 'BAPI_TRANSACTION_ROLLBACK') return {};
          return {};
        }),
        readTable: jest.fn().mockImplementation(async (table) => {
          if (table === 'T001K') return [{ BWKEY: '1120', BUKRS: '1000' }];
          if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'HS01' }];
          if (table === 'LTAK') return [{ LGNUM: 'W01', TANUM: '0001030201', KQUIT: 'X' }];
          return [];
        })
      };

      const testAdapter = new ReservationProcessAdapter({ rfc: mockRfc });

      let caughtErr = null;
      try {
        await testAdapter.postGoodsMovement({
          movementType: '201',
          plant: '1120',
          storageLocation: 'HS01',
          material: '8000000023',
          quantity: 10,
          unit: 'NOS',
          costCenter: '1011201301',
          reservationNumber: '520201',
          reservationItem: '0001'
        });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toContain('You have no authorization');
      expect(caughtErr.message).not.toMatch(/password|passwd|bearer|client_secret/i);
    });
  });
});
