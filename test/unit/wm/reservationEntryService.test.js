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

const { POST, GET } = cds.test(__dirname + '/../../../');
const { SELECT, DELETE } = cds.ql;

const TRACK_ENTITY = 'saps4hana.wm.ReservationTrack';
const LOG_ENTITY = 'saps4hana.wm.ReservationLog';

const authClerk = { auth: { username: 'carol', password: '' } };

describe('Chunk 3: Step 1 Service — ReservationEntryService (Create Reservation + Auto-TR)', () => {
  let createResSpy;
  let createTrSpy;

  afterEach(async () => {
    createResSpy?.mockRestore();
    createTrSpy?.mockRestore();
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

    test('Fallback: when TR creation fails, reservation is preserved with status 01 and warning log', async () => {
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
      expect(data.Status_code).toBe('01'); // Preserved in status 01
      expect(data.ErrorMessage).toContain('Warehouse movement not active');

      const logs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      expect(logs).toHaveLength(2);
      expect(logs[1].MessageType).toBe('W');
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

    test('POST /odata/v4/reservation-entry/postMigoGoodsMovement handles failure with status 99 and error log', async () => {
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
      expect(data.Status_code).toBe('99');
      expect(data.ErrorMessage).toContain('Posting period 10/2026 closed');

      // Verify DB update to 99
      const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testMigoResNo }));
      expect(track.Status_code).toBe('99');
      expect(track.ErrorMessage).toContain('Posting period 10/2026 closed');

      // Verify error log entry
      const log = await cds.db.run(
        SELECT.one.from(LOG_ENTITY).where({ ReservationNo: testMigoResNo, Step: 'MIGO', Status: '99' })
      );
      expect(log).toBeTruthy();
      expect(log.MessageType).toBe('E');
    });
  });
});
