'use strict';

/**
 * Unit Test Suite for Chunk 3: ReservationEntryService & Auto-TR Creation
 * Validates:
 * 1. Validation per movement type:
 *    - 201: Cost Center mandatory
 *    - 241: Asset mandatory
 *    - 311: Receiving SLoc mandatory & != issuing SLoc
 *    - 301: Receiving Plant mandatory & != issuing Plant
 * 2. On Save: creates Reservation + auto-creates TR + updates status to 02 (TR Created)
 * 3. Step-wise logs recorded in ReservationLog (MB21 + LB01)
 * 4. Error and deferred TR handling
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST, GET, PATCH, DELETE: HTTP_DELETE } = cds.test(__dirname + '/../../../');
const { SELECT, DELETE } = cds.ql;

const TRACK_ENTITY = 'saps4hana.wm.ReservationTrack';
const LOG_ENTITY = 'saps4hana.wm.ReservationLog';

const authClerk = { auth: { username: 'carol', password: '' } };

describe('Chunk 3: Step 1 Service — ReservationEntryService (Create Reservation + Auto-TR)', () => {
  let createResSpy;
  let createTrSpy;
  let authSpy;

  beforeEach(() => {
    authSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'checkAuthorization').mockResolvedValue(true);
  });

  afterEach(async () => {
    createResSpy?.mockRestore();
    createTrSpy?.mockRestore();
    authSpy?.mockRestore();
  });

  describe('1. Movement Type Validations', () => {
    test('Rejects missing movement type with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 1
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 201 without Cost Center with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '201',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 5
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 241 without Asset Number with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '241',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 1
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 311 without Receiving SLoc with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '311',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 1
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 311 with identical Issuing and Receiving SLoc with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '311',
            Plant: '1120',
            StorageLocation: 'HS01',
            ReceivingStorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 1
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 301 without Receiving Plant with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '301',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 2
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 301 with identical Issuing and Receiving Plant with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '301',
            Plant: '1120',
            ReceivingPlant: '1120',
            StorageLocation: 'HS01',
            Material: '8000000023',
            Quantity: 2
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 261 without OrderType with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '261',
            Plant: '1120',
            StorageLocation: 'CS01',
            Material: '1000000045',
            Quantity: 10,
            OrderID: '1007'
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects Movement 261 without OrderID with 400', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '261',
            Plant: '1120',
            StorageLocation: 'CS01',
            Material: '1000000045',
            Quantity: 10,
            OrderType: 'ZEMP'
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });
  });

  describe('1b. Entity write authorization (D1)', () => {
    const authViewer = { auth: { username: 'bob', password: '' } };
    const body = {
      ReservationNo: '0000777009', ReservationItem: '0001', MovementType: '311', Plant: '1120',
      StorageLocation: 'CS01', Material: '1000000045', Quantity: 1, Unit: 'KG', ReceivingStorageLocation: 'ST02'
    };

    test('Viewer (bob) cannot CREATE ReservationEntries and the SAP adapter is never called', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValue({ success: true, reservationNo: '777009', reservationNoRaw: '0000777009', reservationItem: '0001' });
      await expect(POST('/odata/v4/reservation-entry/ReservationEntries', body, authViewer))
        .rejects.toMatchObject({ response: { status: 403 } });
      expect(createResSpy).not.toHaveBeenCalled();
    });

    test('Viewer (bob) cannot UPDATE or DELETE a tracked ReservationEntries row', async () => {
      const key = "/odata/v4/reservation-entry/ReservationEntries(ReservationNo='0000524979',ReservationItem='0001')";
      await expect(PATCH(key, { ErrorMessage: 'x' }, authViewer)).rejects.toMatchObject({ response: { status: 403 } });
      await expect(HTTP_DELETE(key, authViewer)).rejects.toMatchObject({ response: { status: 403 } });
      const row = await GET(key, authViewer);
      expect(row.data.ErrorMessage || '').not.toBe('x');
    });
  });

  describe('1c. Canonical API contract (Step 7.2): one PascalCase name per business field', () => {
    const resNo = '0000777072';
    const base = { Plant: '1120', StorageLocation: 'CS01', Material: '1000000045', Quantity: 2, Unit: 'KG', WarehouseNumber: 'W01', Batch: 'B1' };
    const perType = {
      '201': { payload: { CostCenter: '1011201301' }, adapter: { costCenter: '1011201301', receivingPlant: undefined } },
      '241': { payload: { AssetNo: '400092', SubNumber: '0000' }, adapter: { assetNo: '400092', subNumber: '0000' } },
      '261': { payload: { OrderType: 'ZEMP', OrderID: '1011' }, adapter: { orderId: '1011', orderType: 'ZEMP' } },
      '301': { payload: { ReceivingPlant: '1130', ReceivingStorageLocation: 'ST02' }, adapter: { receivingPlant: '1130', receivingStorageLocation: 'ST02' } },
      '311': { payload: { ReceivingStorageLocation: 'ST02' }, adapter: { receivingPlant: '1120', receivingStorageLocation: 'ST02' } }
    };
    const okRes = { success: true, reservationNo: '777072', reservationNoRaw: resNo, reservationItem: '0001', status: '01' };
    const okTr = { success: true, warehouseNumber: 'W01', trNumber: '1007072', trNumberRaw: '0001007072', trItem: '0001', status: '02' };

    afterEach(async () => {
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: resNo }));
      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: resNo }));
    });

    test.each(Object.keys(perType))('createReservationEntry %s: canonical payload maps 1:1 onto the adapter call', async (mvt) => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce(okRes);
      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce(okTr);
      const { status, data } = await POST('/odata/v4/reservation-entry/createReservationEntry', { MovementType: mvt, ...base, ...perType[mvt].payload }, authClerk);
      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(resNo);
      expect(createResSpy).toHaveBeenCalledTimes(1);
      expect(createResSpy.mock.calls[0][0]).toMatchObject({
        movementType: mvt, plant: '1120', storageLocation: 'CS01', material: '1000000045', quantity: 2, unit: 'KG', batch: 'B1', reservationDate: undefined,
        ...perType[mvt].adapter
      });
      // Nothing but the canonical fields reaches the adapter: no leftover alias keys.
      expect(Object.keys(createResSpy.mock.calls[0][0]).filter((k) => /^[A-Z]/.test(k))).toEqual([]);
    });

    test('createReservation (261): canonical payload persists OrderID and OrderType on the track row', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce(okRes);
      const { status } = await POST('/odata/v4/reservation-entry/createReservation', { MovementType: '261', ...base, ...perType['261'].payload }, authClerk);
      expect(status).toBe(200);
      expect(createResSpy.mock.calls[0][0]).toMatchObject({ orderId: '1011', orderType: 'ZEMP' });
      const row = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: resNo, ReservationItem: '0001' }));
      expect(row).toMatchObject({ OrderID: '1011', OrderType: 'ZEMP' });
    });

    const obsolete = [['orderId', '1011'], ['orderType', 'ZEMP'], ['OrderId', '1011'], ['reservationDate', '2026-10-19'], ['orderNo', '1011'], ['aufnr', '1011']];
    test.each([
      ...obsolete.map(([k, v]) => ['createReservationEntry', k, v]),
      ...obsolete.map(([k, v]) => ['createReservation', k, v])
    ])('%s rejects obsolete parameter %s with 400 before any SAP call', async (action, key, value) => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValue(okRes);
      await expect(POST(`/odata/v4/reservation-entry/${action}`, { MovementType: '261', ...base, OrderType: 'ZEMP', OrderID: '1011', [key]: value }, authClerk))
        .rejects.toMatchObject({ response: { status: 400, data: { error: { message: expect.stringMatching(new RegExp(`"${key}" does not exist`)) } } } });
      expect(createResSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. On Save: Create Reservation + Auto-TR Creation', () => {
    const testResNo = '0000777001';

    afterEach(async () => {
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
    });

    test('Movement 311: Creates reservation, auto-creates TR, advances status to 02', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservationNo: '777001',
        reservationNoRaw: testResNo,
        reservationItem: '0001',
        status: '01'
      });

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        trNumber: '1007777',
        trNumberRaw: '0001007777',
        trItem: '0001',
        status: '02'
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservationEntry',
        {
          MovementType: '311',
          Plant: '1120',
          StorageLocation: 'HS01',
          ReceivingStorageLocation: 'CS01',
          Material: '000000008000000023',
          MaterialName: 'Cable Assembly',
          Quantity: 1,
          Unit: 'NOS',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toBeTruthy();
      expect(data.ReservationNo).toBe(testResNo);
      expect(data.MovementType).toBe('311');
      expect(data.TransferRequirement).toBe('0001007777');
      expect(data.Status_code).toBe('02'); // Auto-TR complete -> Status 02

      // Verify DB persistence in ReservationTrack
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
      expect(track).toBeTruthy();
      expect(track.Status_code).toBe('02');
      expect(track.TransferRequirement).toBe('0001007777');
      expect(track.ReceivingStorageLocation).toBe('CS01');

      // Verify 2 step-wise logs were created (MB21 and LB01)
      const logs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      expect(logs).toHaveLength(2);
      expect(logs.map((l) => l.Step)).toEqual(['MB21', 'LB01']);
      expect(logs[0].Status).toBe('01');
      expect(logs[1].Status).toBe('02');
    });

    test('Movement 201: Creates reservation with Cost Center and auto-creates TR', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservationNo: '777001',
        reservationNoRaw: testResNo,
        reservationItem: '0001',
        status: '01'
      });

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        trNumber: '1007778',
        trNumberRaw: '0001007778',
        trItem: '0001',
        status: '02'
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservationEntry',
        {
          MovementType: '201',
          Plant: '1120',
          StorageLocation: 'HS01',
          Material: '000000008000000023',
          Quantity: 10,
          Unit: 'NOS',
          CostCenter: '1011201301',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testResNo);
      expect(data.CostCenter).toBe('1011201301');
      expect(data.TransferRequirement).toBe('0001007778');
      expect(data.Status_code).toBe('02');
    });

    test('Movement 241: Creates reservation with Asset and auto-creates TR', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservationNo: '777001',
        reservationNoRaw: testResNo,
        reservationItem: '0001',
        status: '01'
      });

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        trNumber: '1007779',
        trNumberRaw: '0001007779',
        trItem: '0001',
        status: '02'
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservationEntry',
        {
          MovementType: '241',
          Plant: '1120',
          StorageLocation: 'HS01',
          Material: '000000008000000023',
          Quantity: 1,
          Unit: 'NOS',
          AssetNo: '000000400092',
          SubNumber: '0000',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testResNo);
      expect(data.AssetNo).toBe('000000400092');
      expect(data.TransferRequirement).toBe('0001007779');
      expect(data.Status_code).toBe('02');
    });

    test('When TR creation fails the reservation is kept and tracked as status 11 (TR error, backend issue)', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservationNo: '777001',
        reservationNoRaw: testResNo,
        reservationItem: '0001',
        status: '01'
      });

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockRejectedValueOnce(
        new Error('Warehouse movement not active for plant/sloc')
      );

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservationEntry',
        {
          MovementType: '311',
          Plant: '1120',
          StorageLocation: 'HS01',
          ReceivingStorageLocation: 'CS01',
          Material: '000000008000000023',
          Quantity: 1,
          Unit: 'NOS',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testResNo);
      expect(data.Status_code).toBe('11'); // TR error: backend created no TR
      expect(data.ErrorMessage).toContain('TR creation failed in SAP backend: Warehouse movement not active');

      const logs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      expect(logs).toHaveLength(2);
      expect(logs[1].MessageType).toBe('E');
      expect(logs[1].Status).toBe('11');
    });

    test('Movement 311 with Batch: passes batch to adapter createReservation', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservationNo: '777001',
        reservationNoRaw: testResNo,
        reservationItem: '0001',
        status: '01'
      });

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        trNumber: '1007780',
        trNumberRaw: '0001007780',
        trItem: '0001',
        status: '02'
      });

      const { status } = await POST(
        '/odata/v4/reservation-entry/createReservationEntry',
        {
          MovementType: '311',
          Plant: '1120',
          StorageLocation: 'HS01',
          ReceivingStorageLocation: 'CS01',
          Material: '000000008000000023',
          Quantity: 1,
          Unit: 'NOS',
          Batch: 'IN26001170',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(createResSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          batch: 'IN26001170'
        })
      );
    });

    test("Movement 311: passes isTransferPosting=false and batch to adapter createTransferRequirement so RSNUM and CHARG stay on the TR [mock only, not SAP verification]", async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, "createReservation").mockResolvedValueOnce({
        success: true, reservationNo: "777001", reservationNoRaw: testResNo, reservationItem: "0001", status: "01"
      });
      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, "createTransferRequirement").mockResolvedValueOnce({
        success: true, warehouseNumber: "W01", trNumber: "1007781", trNumberRaw: "0001007781", trItem: "0001", status: "02"
      });

      const { status } = await POST(
        "/odata/v4/reservation-entry/createReservationEntry",
        { MovementType: "311", Plant: "1120", StorageLocation: "HS01", ReceivingStorageLocation: "CS01",
          Material: "000000008000000023", Quantity: 1, Unit: "NOS", Batch: "IN26001170", WarehouseNumber: "W01" },
        authClerk
      );

      expect(status).toBe(200);
      expect(createTrSpy).toHaveBeenCalledWith(expect.objectContaining({
        movementType: "311",
        isTransferPosting: false,
        batch: "IN26001170",
        reservationNo: testResNo
      }));
    });

    test("Movement 301: passes isTransferPosting=true to adapter createTransferRequirement (RSNUM omitted on staging TR) [mock only, not SAP verification]", async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, "createReservation").mockResolvedValueOnce({
        success: true, reservationNo: "777002", reservationNoRaw: "0000777002", reservationItem: "0001", status: "01"
      });
      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, "createTransferRequirement").mockResolvedValueOnce({
        success: true, warehouseNumber: "W01", trNumber: "1007782", trNumberRaw: "0001007782", trItem: "0001", status: "02"
      });

      const { status } = await POST(
        "/odata/v4/reservation-entry/createReservationEntry",
        { MovementType: "301", Plant: "1120", StorageLocation: "HS01", ReceivingPlant: "1600", ReceivingStorageLocation: "CS01",
          Material: "000000008000000023", Quantity: 1, Unit: "NOS", WarehouseNumber: "W01" },
        authClerk
      );

      expect(status).toBe(200);
      expect(createTrSpy).toHaveBeenCalledWith(expect.objectContaining({ movementType: "301", isTransferPosting: true }));
    });

    test('When reservation creation fails, TR creation is NEVER called and error is returned with stage RESERVATION', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockRejectedValueOnce(
        Object.assign(new Error('Cost Center 1011201301 locked for postings'), {
          status: 400,
          stage: 'RESERVATION',
          success: false
        })
      );
      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement');

      await expect(
        POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '201',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '000000008000000023',
            Quantity: 10,
            Unit: 'NOS',
            CostCenter: '1011201301'
          },
          authClerk
        )
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: {
              message: expect.stringMatching(/Cost Center 1011201301 locked for postings/)
            }
          }
        }
      });

      // TR creation must NEVER be called after reservation failure
      expect(createTrSpy).not.toHaveBeenCalled();

      // No reservation tracking entry persisted
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ CostCenter: '1011201301', Material: '000000008000000023' }));
      expect(track).toBeFalsy();
    });

    test('action createReservation: independently creates reservation and returns structured result without creating TR', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservation: {
          number: '520235',
          item: '0001'
        },
        movementType: '201',
        reservationNo: '520235',
        reservationNoRaw: '0000520235',
        reservationItem: '0001',
        status: '01'
      });
      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement');

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservation',
        {
          MovementType: '201',
          Plant: '1120',
          StorageLocation: 'HS01',
          Material: '000000008000000023',
          Quantity: 10,
          Unit: 'NOS',
          CostCenter: '1011201301'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        reservation: {
          number: '520235',
          item: '0001'
        },
        movementType: '201'
      });

      // TR creation must NOT be called by createReservation
      expect(createTrSpy).not.toHaveBeenCalled();

      // Reservation is persisted in DB with Status 01 (RES_CREATED)
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: '0000520235' }));
      expect(track).toBeTruthy();
      expect(track.Status_code).toBe('01');
      expect(track.TransferRequirement).toBe('');

      // Clean up test row
      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: '0000520235' }));
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: '0000520235' }));
    });

    test('action createReservation: returns { success: false, stage: "RESERVATION", error: "..." } on failure', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: false,
        stage: 'RESERVATION',
        error: 'Deficit of BA Unrestricted-use stock'
      });
      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement');

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservation',
        {
          MovementType: '201',
          Plant: '1120',
          StorageLocation: 'HS01',
          Material: '000000008000000023',
          Quantity: 10,
          Unit: 'NOS',
          CostCenter: '1011201301'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toMatchObject({
        success: false,
        stage: 'RESERVATION',
        error: 'Deficit of BA Unrestricted-use stock'
      });

      expect(createTrSpy).not.toHaveBeenCalled();
    });

    test('action createTransferRequirement: independently creates TR for existing reservation and returns structured result', async () => {
      const testRes = '0000529991';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Quantity: 1,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        Status_code: '01'
      }));

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: true,
        reservationNumber: '529991',
        trNumber: '1001839',
        trNumberRaw: '0001001839',
        trItem: '0001',
        material: '8000000023',
        quantity: 1,
        plant: '1120',
        storageLocation: 'HS01',
        warehouse: 'W01',
        warehouseNumber: 'W01',
        movement: '311',
        status: '02'
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createTransferRequirement',
        {
          ReservationNo: testRes,
          ReservationItem: '0001',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        reservationNumber: '529991',
        trNumber: '1001839',
        trItem: '0001'
      });

      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
      expect(track.Status_code).toBe('02');
      expect(track.TransferRequirement).toBe('0001001839');

      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
    });

    test('action createTransferRequirement: returns { success: false, stage: "TR", error: "..." } on failure and sets status 11', async () => {
      const testRes = '0000529992';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Quantity: 1,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        Status_code: '01'
      }));

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: false,
        stage: 'TR',
        error: 'SAP TR creation rejected'
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createTransferRequirement',
        {
          ReservationNo: testRes,
          ReservationItem: '0001',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toMatchObject({
        success: false,
        stage: 'TR',
        error: 'SAP TR creation rejected'
      });

      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
      expect(track.Status_code).toBe('11');
      expect(track.ErrorStep).toBe('LB01');

      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
    });

    test('createReservationEntry: when TR verification fails, reservation is kept with status 11 and warehouse workflow cannot continue', async () => {
      createResSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservation: { number: '520999', item: '0001' },
        reservationNo: '520999',
        reservationNoRaw: '0000520999',
        reservationItem: '0001',
        movementType: '201',
        status: '01'
      });

      createTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockRejectedValueOnce(
        Object.assign(new Error('TR creation verification failed: material mismatch (expected 8000000023, got 8000009999)'), {
          stage: 'TR',
          status: 500
        })
      );

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/createReservationEntry',
        {
          MovementType: '201',
          Plant: '1120',
          StorageLocation: 'HS01',
          Material: '000000008000000023',
          Quantity: 10,
          Unit: 'NOS',
          CostCenter: '1011201301',
          WarehouseNumber: 'W01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe('0000520999');
      expect(data.Status_code).toBe('11');
      expect(data.TransferRequirement).toBe('');
      expect(data.ErrorStep).toBe('LB01');
      expect(data.ErrorMessage).toMatch(/material mismatch/);

      // Clean up test row
      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: '0000520999' }));
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: '0000520999' }));
    });

    test('action createTOFromTR: creates TO referencing verified SAP TR and returns structured result', async () => {
      const testRes = '0000529993';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Quantity: 1,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '0001001839',
        Status_code: '02'
      }));

      const getTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'getTransferRequirement').mockResolvedValueOnce({
        success: true,
        trNumber: '1001839',
        trNumberRaw: '0001001839',
        warehouse: 'W01',
        movement: '311',
        reservationNo: '529993'
      });

      const toSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferOrderFromTR').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        toNumber: '1012966',
        toNumberRaw: '0001012966',
        status: '03'
      });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/createTOFromTR',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: true,
          reservationNumber: '529993',
          trNumber: '1001839',
          toNumber: '1012966',
          warehouse: 'W01',
          itemsCreated: 1
        });

        const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        expect(track.Status_code).toBe('03');
        expect(track.TransferOrder).toBe('0001012966');
      } finally {
        getTrSpy.mockRestore();
        toSpy.mockRestore();
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });

    test('action createTOFromTR: rejects with stage TR_VALIDATION when TR cannot be verified in SAP', async () => {
      const testRes = '0000529994';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Quantity: 1,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '0001009999',
        Status_code: '02'
      }));

      const getTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'getTransferRequirement').mockResolvedValueOnce(null);

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/createTOFromTR',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: false,
          stage: 'TR_VALIDATION',
          error: expect.stringContaining('cannot be verified in SAP')
        });

        const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        expect(track.Status_code).toBe('11');
        expect(track.ErrorStep).toBe('LT04');
      } finally {
        getTrSpy.mockRestore();
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });

    test('action createTOFromTR: rejects with stage TR when TR is not created on reservation', async () => {
      const testRes = '0000529995';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '8000000023',
        Quantity: 1,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '',
        Status_code: '01'
      }));

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/createTOFromTR',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: false,
          stage: 'TR',
          error: 'TR was not created or TR number is missing'
        });
      } finally {
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });

    test('action createTOFromTR: with autoConfirm=true succeeds and marks status 04 (TO Confirmed)', async () => {
      const testRes = '0000529995';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        ReceivingPlant: '1120',
        ReceivingStorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '0001001839',
        Status_code: '02'
      }));

      const getTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'getTransferRequirement').mockResolvedValueOnce({
        trNumber: '1001839',
        trNumberRaw: '0001001839',
        warehouse: 'W01',
        movement: '311',
        material: '8000000023'
      });
      const createToSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferOrderFromTR').mockResolvedValueOnce({
        success: true,
        trNumber: '1001839',
        toNumber: '987654',
        toNumberRaw: '0000987654',
        toItem: '0001',
        confirmed: true,
        warehouseNumber: 'W01',
        status: '04'
      });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/createTOFromTR',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01',
            TRNumber: '1001839',
            autoConfirm: true
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: true,
          toNumber: '987654',
          confirmed: true,
          itemsCreated: 1
        });

        const row = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        expect(row.Status_code).toBe('04');
        expect(row.TransferOrder).toBe('0000987654');
      } finally {
        getTrSpy.mockRestore();
        createToSpy.mockRestore();
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });

    test('action createTOFromTR: with autoConfirm=true fails confirmation and returns { success: false, stage: TO_CONFIRMATION, toNumber: 987654, error: ... } with status 13', async () => {
      const testRes = '0000529996';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        ReceivingPlant: '1120',
        ReceivingStorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '0001001839',
        Status_code: '02'
      }));

      const getTrSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'getTransferRequirement').mockResolvedValueOnce({
        trNumber: '1001839',
        trNumberRaw: '0001001839',
        warehouse: 'W01',
        movement: '311',
        material: '8000000023'
      });
      const createToSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferOrderFromTR').mockResolvedValueOnce({
        success: false,
        stage: 'TO_CONFIRMATION',
        toNumber: '987654',
        toNumberRaw: '0000987654',
        toItem: '0001',
        trNumber: '1001839',
        warehouseNumber: 'W01',
        status: '13',
        error: 'Destination bin is blocked for stock placement',
        confirmed: false
      });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/createTOFromTR',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01',
            TRNumber: '1001839',
            autoConfirm: true
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: false,
          stage: 'TO_CONFIRMATION',
          toNumber: '987654',
          error: 'Destination bin is blocked for stock placement',
          confirmed: false
        });

        const row = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        expect(row.Status_code).toBe('13');
        expect(row.ErrorStep).toBe('LT12');
        expect(row.ErrorMessage).toBe('Destination bin is blocked for stock placement');
      } finally {
        getTrSpy.mockRestore();
        createToSpy.mockRestore();
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });

    test('action confirmTransferOrder: successfully confirms TO and advances status to 04', async () => {
      const testRes = '0000529997';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        ReceivingPlant: '1120',
        ReceivingStorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '0001001839',
        TransferOrder: '0000987654',
        Status_code: '13',
        ErrorStep: 'LT12',
        ErrorMessage: 'Previous confirmation failed'
      }));

      const confirmSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'confirmTransferOrder').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        toNumber: '987654',
        status: '04',
        confirmed: true
      });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/confirmTransferOrder',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01',
            TransferOrder: '987654'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: true,
          stage: 'TO_CONFIRMATION',
          toNumber: '987654',
          confirmed: true,
          status: '04'
        });

        const row = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        expect(row.Status_code).toBe('04');
        expect(row.ErrorStep).toBe('');
        expect(row.ErrorMessage).toBe('');
      } finally {
        confirmSpy.mockRestore();
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });

    test('action confirmTransferOrder: returns structured error when confirmation fails', async () => {
      const testRes = '0000529998';
      await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
        ReservationNo: testRes,
        ReservationItem: '0001',
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        ReceivingPlant: '1120',
        ReceivingStorageLocation: 'CS01',
        Material: '8000000023',
        Quantity: 5,
        Unit: 'NOS',
        WarehouseNumber: 'W01',
        TransferRequirement: '0001001839',
        TransferOrder: '0000987654',
        Status_code: '03'
      }));

      const confirmSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'confirmTransferOrder').mockRejectedValueOnce(
        new Error('Bin blocked by operator')
      );

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/confirmTransferOrder',
          {
            ReservationNo: testRes,
            ReservationItem: '0001',
            WarehouseNumber: 'W01',
            TransferOrder: '987654'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          success: false,
          stage: 'TO_CONFIRMATION',
          toNumber: '987654',
          error: 'Bin blocked by operator',
          confirmed: false,
          status: '13'
        });

        const row = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        expect(row.Status_code).toBe('13');
        expect(row.ErrorStep).toBe('LT12');
        expect(row.ErrorMessage).toBe('Bin blocked by operator');
      } finally {
        confirmSpy.mockRestore();
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testRes }));
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testRes }));
      }
    });
  });

  describe('3. Querying Reservation Entries & Statuses', () => {
    test('GET /odata/v4/reservation-entry/ReservationEntries returns seeded entries with status badges', async () => {
      const { status, data } = await GET('/odata/v4/reservation-entry/ReservationEntries', authClerk);
      expect(status).toBe(200);
      expect(data.value.length).toBeGreaterThanOrEqual(2);

      const r311 = data.value.find((r) => r.ReservationNo === '0000524979');
      expect(r311).toBeTruthy();
      expect(r311.MovementType).toBe('311');
      expect(r311.StatusText).toBe('Reservation Created');
    });

    test('GET /odata/v4/reservation-entry/OrderTypeVH returns order types with ZEMP priority and production/process types', async () => {
      const { status, data } = await GET('/odata/v4/reservation-entry/OrderTypeVH', authClerk);
      expect(status).toBe(200);
      expect(Array.isArray(data.value)).toBe(true);
      expect(data.value.length).toBeGreaterThan(0);
      const zemp = data.value.find((o) => o.OrderType === 'ZEMP');
      expect(zemp).toBeTruthy();
      expect(zemp.OrderTypeName).toContain('EMP');
      expect(zemp.OrderCategory).toBe('01');

      // Verify non-internal order categories like ZP01 or PP01 are supported
      const zp01 = data.value.find((o) => o.OrderType === 'ZP01');
      if (zp01) {
        expect(zp01.OrderCategory).toBe('40');
      }
    });

    test('GET /odata/v4/reservation-entry/InternalOrderVH returns internal orders and process/production orders', async () => {
      const { status, data } = await GET('/odata/v4/reservation-entry/InternalOrderVH', authClerk);
      expect(status).toBe(200);
      expect(Array.isArray(data.value)).toBe(true);
      expect(data.value.length).toBeGreaterThan(0);
      expect(data.value[0]).toHaveProperty('OrderID');
      expect(data.value[0]).toHaveProperty('OrderType');

      const processOrder = data.value.find((o) => o.OrderID === '1002790');
      if (processOrder) {
        expect(processOrder.OrderType).toBe('ZP01');
        expect(processOrder.Plant).toBe('1120');
      }
    });

    test('GET /odata/v4/reservation-entry/CostCenterVH returns cost centers for movement 201', async () => {
      const { status, data } = await GET('/odata/v4/reservation-entry/CostCenterVH', authClerk);
      expect(status).toBe(200);
      expect(Array.isArray(data.value)).toBe(true);
      expect(data.value.length).toBeGreaterThan(0);
      expect(data.value[0]).toHaveProperty('CostCenter');
      expect(data.value[0]).toHaveProperty('CostCenterName');
    });
  });

  describe('4. Action: postMigoGoodsMovement', () => {
    const testMigoResNo = '0000524979';
    let postGoodsMvtSpy;

    afterEach(() => {
      postGoodsMvtSpy?.mockRestore();
    });

    test('POST /odata/v4/reservation-entry/postMigoGoodsMovement updates status to 05 and logs MIGO step', async () => {
      postGoodsMvtSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockResolvedValueOnce({
        success: true,
        materialDocument: '4900050888',
        materialDocYear: '2026',
        status: '05',
        stockEffect: 'Stock transferred to Storage Location CS01'
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/postMigoGoodsMovement',
        {
          ReservationNo: testMigoResNo,
          ReservationItem: '0001'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testMigoResNo);
      expect(data.MaterialDocument).toBe('4900050888');
      expect(data.MaterialDocYear).toBe('2026');
      expect(data.Status_code).toBe('05');

      // Verify DB update
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testMigoResNo }));
      expect(track.MaterialDocument).toBe('4900050888');
      expect(track.Status_code).toBe('05');

      // Verify log entry
      const log = await cds.db.run(
        SELECT.one.from(LOG_ENTITY).where({ ReservationNo: testMigoResNo, Step: 'MIGO' })
      );
      expect(log).toBeTruthy();
      expect(log.Status).toBe('05');
      expect(log.MessageType).toBe('S');
    });

    test('POST /odata/v4/reservation-entry/postMigoGoodsMovement with partial issue: sets WithdrawnQuantity=6, RemainingQuantity=4, and CompletelyProcessed=false (does NOT mark completely processed)', async () => {
      postGoodsMvtSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockResolvedValueOnce({
        success: true,
        materialDocument: '4900050889',
        materialDocYear: '2026',
        status: '05',
        stockEffect: 'Stock consumed to Cost Center 1011201301',
        reservationVerification: {
          success: true,
          stage: 'RESERVATION_VERIFICATION',
          reservationNumber: testMigoResNo,
          reservationItem: '0001',
          requestedQuantity: 10,
          issuedQuantity: 6,
          remainingQuantity: 4,
          completelyProcessed: false,
          isComplete: false,
          completionStatus: 'PARTIALLY_PROCESSED'
        }
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/postMigoGoodsMovement',
        {
          ReservationNo: testMigoResNo,
          ReservationItem: '0001',
          Quantity: 6
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testMigoResNo);
      expect(data.MaterialDocument).toBe('4900050889');

      // Verify DB update: CompletelyProcessed must be FALSE, RemainingQuantity must be 4
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testMigoResNo }));
      expect(Number(track.WithdrawnQuantity)).toBe(6);
      expect(Number(track.RemainingQuantity)).toBe(4);
      expect(Boolean(track.CompletelyProcessed)).toBe(false);

      // Verify log message notes partial issue
      const log = await cds.db.run(
        SELECT.one.from(LOG_ENTITY).where({ ReservationNo: testMigoResNo, DocumentNo: '4900050889' })
      );
      expect(log).toBeTruthy();
      expect(log.MessageText).toContain('Partial issue: remaining quantity 4');
    });

    test('POST /odata/v4/reservation-entry/postMigoGoodsMovement with complete issue: sets WithdrawnQuantity=10, RemainingQuantity=0, and CompletelyProcessed=true', async () => {
      postGoodsMvtSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockResolvedValueOnce({
        success: true,
        materialDocument: '4900050890',
        materialDocYear: '2026',
        status: '05',
        stockEffect: 'Stock consumed to Cost Center 1011201301',
        reservationVerification: {
          success: true,
          stage: 'RESERVATION_VERIFICATION',
          reservationNumber: testMigoResNo,
          reservationItem: '0001',
          requestedQuantity: 10,
          issuedQuantity: 10,
          remainingQuantity: 0,
          completelyProcessed: true,
          isComplete: true,
          completionStatus: 'COMPLETED'
        }
      });

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/postMigoGoodsMovement',
        {
          ReservationNo: testMigoResNo,
          ReservationItem: '0001',
          Quantity: 10
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testMigoResNo);
      expect(data.MaterialDocument).toBe('4900050890');

      // Verify DB update: CompletelyProcessed must be TRUE, RemainingQuantity must be 0
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testMigoResNo }));
      expect(Number(track.WithdrawnQuantity)).toBe(10);
      expect(Number(track.RemainingQuantity)).toBe(0);
      expect(Boolean(track.CompletelyProcessed)).toBe(true);

      // Verify log message notes completely processed
      const log = await cds.db.run(
        SELECT.one.from(LOG_ENTITY).where({ ReservationNo: testMigoResNo, DocumentNo: '4900050890' })
      );
      expect(log).toBeTruthy();
      expect(log.MessageText).toContain('Reservation completely processed');
    });

    test('POST /odata/v4/reservation-entry/postMigoGoodsMovement handles failure with status 90 (GI error) and error log', async () => {
      postGoodsMvtSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockRejectedValueOnce(
        new Error('Posting period 10/2026 closed')
      );

      const { status, data } = await POST(
        '/odata/v4/reservation-entry/postMigoGoodsMovement',
        {
          ReservationNo: testMigoResNo,
          ReservationItem: '0001'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data.ReservationNo).toBe(testMigoResNo);
      expect(data.Status_code).toBe('90');
      expect(data.ErrorMessage).toContain('Posting period 10/2026 closed');

      // Verify DB update to 90
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testMigoResNo }));
      expect(track.Status_code).toBe('90');
      expect(track.ErrorMessage).toContain('Posting period 10/2026 closed');

      // Verify error log entry
      const log = await cds.db.run(
        SELECT.one.from(LOG_ENTITY).where({ ReservationNo: testMigoResNo, Step: 'MIGO', Status: '90' })
      );
      expect(log).toBeTruthy();
      expect(log.MessageType).toBe('E');
    });
  });

  describe('getOpenReservations (all open reservations, live from SAP)', () => {
    let openResvSpy;
    afterEach(() => openResvSpy?.mockRestore());

    test('maps the shared open-reservations reader into the list rows', async () => {
      openResvSpy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockResolvedValue([
        {
          ReservationNo: '0000525868', MovementType: '301', MovementTypeName: 'TF trfr.plnt to plnt',
          SampleMaterial: '8000009753', SampleMaterialDesc: 'iPhone 16', Plant: '1120', StorageLocation: 'CS01',
          ReceivingPlant: '1110', ReceivingStorageLocation: 'CS01', OrderNo: '', CreatedByUser: 'KHUSHAL',
          ItemCount: 1, DisplayText: 'Reservation 0000525868 (TF • Plant 1120 • 1 item)'
        }
      ]);

      const { status, data } = await GET(
        "/odata/v4/reservation-entry/getOpenReservations(plant='1120',movementType='')",
        authClerk
      );

      expect(status).toBe(200);
      expect(openResvSpy).toHaveBeenCalledWith('311,201,241,301,261', '1120');
      expect(data.value).toHaveLength(1);
      expect(data.value[0]).toMatchObject({
        ReservationNo: '0000525868',
        ReservationItem: '0001',
        MovementType: '301',
        Material: '8000009753',
        MaterialName: 'iPhone 16',
        Plant: '1120',
        ReceivingPlant: '1110',
        ItemCount: 1
      });
    });

    test('strictly restricts open reservations to supported movements and filters out unsupported movements like 999', async () => {
      openResvSpy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockResolvedValue([
        {
          ReservationNo: '0000519944', MovementType: '999', MovementTypeName: 'Unsupported',
          SampleMaterial: '8000001000', SampleMaterialDesc: 'Component', Plant: '1130', StorageLocation: 'CS02',
          ItemCount: 1, DisplayText: 'Reservation 0000519944 (999)'
        },
        {
          ReservationNo: '0000527594', MovementType: '311', MovementTypeName: 'TF trfr.st.loc.',
          SampleMaterial: '8000000023', SampleMaterialDesc: 'Material A', Plant: '1120', StorageLocation: 'HS01',
          ItemCount: 1, DisplayText: 'Reservation 0000527594 (311)'
        },
        {
          ReservationNo: '0000527595', MovementType: '201', MovementTypeName: 'GI to cost center',
          SampleMaterial: '8000000023', SampleMaterialDesc: 'Material A', Plant: '1120', StorageLocation: 'HS01',
          ItemCount: 1, DisplayText: 'Reservation 0000527595 (201)'
        }
      ]);

      const { status, data } = await GET(
        "/odata/v4/reservation-entry/getOpenReservations(plant='1120',movementType='')",
        authClerk
      );

      expect(status).toBe(200);
      expect(openResvSpy).toHaveBeenCalledWith('311,201,241,301,261', '1120');
      // Movement 999 must be excluded from the returned rows
      expect(data.value).toHaveLength(2);
      expect(data.value.map((r) => r.MovementType)).toEqual(['311', '201']);
      expect(data.value.some((r) => r.MovementType === '999')).toBe(false);
    });

    test('returns empty array immediately if caller specifies unsupported movement type like 999', async () => {
      openResvSpy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations');

      const { status, data } = await GET(
        "/odata/v4/reservation-entry/getOpenReservations(plant='1120',movementType='999')",
        authClerk
      );

      expect(status).toBe(200);
      expect(data.value).toEqual([]);
      expect(openResvSpy).not.toHaveBeenCalled();
    });

    test('surfaces a reader failure as a 502', async () => {
      openResvSpy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockRejectedValue(new Error('S/4 unreachable'));
      await expect(
        GET("/odata/v4/reservation-entry/getOpenReservations(plant='',movementType='')", authClerk)
      ).rejects.toMatchObject({ response: { status: 502 } });
    });
  });

  describe('getReservationDetail (live detail for untracked reservations)', () => {
    let rtSpy;
    afterEach(() => rtSpy?.mockRestore());

    test('reads an untracked reservation live from SAP RKPF/RESB', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'RKPF') return [{ BWART: '311', KOSTL: '', ANLN1: '', ANLN2: '', UMWRK: '1120', UMLGO: 'CIS1' }];
        if (table === 'RESB') return [{ MATNR: '000000008000009753', WERKS: '1120', LGORT: 'HS01', BDMNG: '1.000', MEINS: 'NOS', CHARG: '', KZEAR: '' }];
        return [];
      });

      const { status, data } = await GET(
        "/odata/v4/reservation-entry/getReservationDetail(ReservationNo='525869',ReservationItem='0001')",
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toMatchObject({
        ReservationNo: '525869',
        ReservationItem: '0001',
        MovementType: '311',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        ReceivingStorageLocation: 'CIS1',
        Quantity: 1,
        Unit: 'NOS',
        Status_code: '01'
      });
    });

    test('returns 404 when the reservation item does not exist in SAP', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockResolvedValue([]);
      await expect(
        GET("/odata/v4/reservation-entry/getReservationDetail(ReservationNo='999999',ReservationItem='0001')", authClerk)
      ).rejects.toMatchObject({ response: { status: 404 } });
    });

    test('returns 404 when reservation has unsupported movement type like 999', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'RKPF') return [{ BWART: '999', KOSTL: '', ANLN1: '', ANLN2: '', UMWRK: '', UMLGO: '' }];
        if (table === 'RESB') return [{ MATNR: '000000008000001000', WERKS: '1130', LGORT: 'CS02', BDMNG: '10.000', MEINS: 'KG', CHARG: '', KZEAR: '' }];
        return [];
      });
      await expect(
        GET("/odata/v4/reservation-entry/getReservationDetail(ReservationNo='519944',ReservationItem='0001')", authClerk)
      ).rejects.toMatchObject({ response: { status: 404 } });
    });
  });

  describe('READ ReservationEntries & retryStep for untracked GUI reservations', () => {
    let rtSpy;
    afterEach(() => rtSpy?.mockRestore());

    test('auto-imports untracked GUI reservation on key READ', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'RKPF') return [{ BWART: '311', KOSTL: '', ANLN1: '', ANLN2: '', UMWRK: '1120', UMLGO: 'MT01' }];
        if (table === 'RESB') return [{ MATNR: '000000008000006485', WERKS: '1120', LGORT: 'HS01', BDMNG: '1.000', MEINS: 'NOS', CHARG: '', KZEAR: '' }];
        if (table === 'MAKT') return [{ MATNR: '000000008000006485', MAKTX: 'Graphite Condenser, 40m2' }];
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        return [];
      });

      const { status, data } = await GET(
        "/odata/v4/reservation-entry/ReservationEntries(ReservationNo='0000527599',ReservationItem='0001')",
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toMatchObject({
        ReservationNo: '0000527599',
        ReservationItem: '0001',
        MovementType: '311',
        Material: '8000006485',
        MaterialName: 'Graphite Condenser, 40m2',
        Plant: '1120',
        StorageLocation: 'HS01',
        ReceivingStorageLocation: 'MT01',
        Status_code: '01'
      });
    });

    test('retryStep auto-imports untracked GUI reservation and creates TR', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'RKPF') return [{ BWART: '311', KOSTL: '', ANLN1: '', ANLN2: '', UMWRK: '1120', UMLGO: 'MT01' }];
        if (table === 'RESB') return [{ MATNR: '000000008000006485', WERKS: '1120', LGORT: 'HS01', BDMNG: '1.000', MEINS: 'NOS', CHARG: '', KZEAR: '' }];
        if (table === 'MAKT') return [{ MATNR: '000000008000006485', MAKTX: 'Graphite Condenser, 40m2' }];
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        return [];
      });

      const trSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement')
        .mockResolvedValue({ trNumber: '1000899', trNumberRaw: '0001000899' });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/retryStep',
          { ReservationNo: '0000527598', ReservationItem: '0001', Step: 'LB01' },
          authClerk
        );

        expect(status).toBe(200);
        expect(data).toMatchObject({
          ReservationNo: '0000527598',
          ReservationItem: '0001',
          TransferRequirement: '0001000899',
          Status_code: '02'
        });
      } finally {
        trSpy.mockRestore();
      }
    });

    test('SLoc pre-check at reservation creation warns when SLoc has no stock without changing SLoc [mock only, not SAP verification]', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table, fields, where) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'LQUA') {
          const isCurrentSLoc = where.some((w) => w.includes("LGORT = 'HS01'"));
          if (isCurrentSLoc) return []; // no stock in HS01
          return [{ LGORT: 'CS01', VERME: '500.000' }]; // stock in CS01
        }
        return [];
      });

      const resSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createReservation').mockResolvedValueOnce({
        success: true,
        reservationNo: '527599',
        reservationNoRaw: '0000527599',
        reservationItem: '0001',
        status: '01'
      });

      const trSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement').mockResolvedValueOnce({
        success: true,
        warehouseNumber: 'W01',
        trNumber: '1007780',
        trNumberRaw: '0001007780',
        trItem: '0001',
        status: '02'
      });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/createReservationEntry',
          {
            MovementType: '201',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '000000008000000023',
            Quantity: 1,
            Unit: 'NOS',
            CostCenter: '1011201301',
            WarehouseNumber: 'W01'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data.StorageLocation).toBe('HS01'); // Not silently changed!
        expect(resSpy).toHaveBeenCalledWith(expect.objectContaining({
          storageLocation: 'HS01'
        }));
      } finally {
        resSpy.mockRestore();
        trSpy.mockRestore();
      }
    });

    test('action executeReservationWarehouseFlow calls adapter orchestrator and returns OrchestratorProcessResult', async () => {
      const orchestratorSpy = jest.spyOn(ReservationProcessAdapter.prototype, 'executeReservationWarehouseFlow').mockResolvedValueOnce({
        success: true,
        state: 'COMPLETED',
        currentState: 'COMPLETED',
        completed: true,
        stages: ['RESERVATION_CREATED', 'TR_CREATED', 'TR_VERIFIED', 'TO_CREATED', 'TO_CONFIRMED', 'MIGO_POSTED', 'STOCK_VERIFIED', 'RESERVATION_VERIFIED', 'COMPLETED'],
        reservation: { reservationNo: '520235', reservationItem: '0001' },
        tr: { trNumber: '1000850', trItem: '0001' },
        verifiedTR: { trNumber: '1000850' },
        to: { toNumber: '1037299', toItem: '0001' },
        confirmation: { confirmed: true },
        migo: { materialDocument: '5000999999', materialDocumentYear: '2026' },
        stock: { success: true, verified: true },
        finalReservation: { success: true, verified: true, completelyProcessed: true }
      });

      try {
        const { status, data } = await POST(
          '/odata/v4/reservation-entry/executeReservationWarehouseFlow',
          {
            MovementType: '201',
            Plant: '1120',
            StorageLocation: 'HS01',
            Material: '000000008000000023',
            Quantity: 10,
            Unit: 'NOS',
            CostCenter: '1011201301',
            WarehouseNumber: 'W01'
          },
          authClerk
        );

        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.state).toBe('COMPLETED');
        expect(data.currentState).toBe('COMPLETED');
        expect(data.completed).toBe(true);
        expect(data.reservationNumber).toBe('520235');
        expect(data.trNumber).toBe('1000850');
        expect(data.toNumber).toBe('1037299');
        expect(data.toConfirmed).toBe(true);
        expect(data.materialDocument).toBe('5000999999');
        expect(data.completelyProcessed).toBe(true);
      } finally {
        orchestratorSpy.mockRestore();
      }
    });
  });
});
