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

const { POST, GET } = cds.test(__dirname + '/../../../');
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
      expect(openResvSpy).toHaveBeenCalledWith('311,201,241,301', '1120');
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

    test('strictly restricts open reservations to 311, 201, 241, 301 and filters out 261', async () => {
      openResvSpy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockResolvedValue([
        {
          ReservationNo: '0000519944', MovementType: '261', MovementTypeName: 'GI for order',
          SampleMaterial: '8000001000', SampleMaterialDesc: 'Component', Plant: '1130', StorageLocation: 'CS02',
          ItemCount: 1, DisplayText: 'Reservation 0000519944 (261)'
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
      expect(openResvSpy).toHaveBeenCalledWith('311,201,241,301', '1120');
      // Movement 261 must be excluded from the returned rows
      expect(data.value).toHaveLength(2);
      expect(data.value.map((r) => r.MovementType)).toEqual(['311', '201']);
      expect(data.value.some((r) => r.MovementType === '261')).toBe(false);
    });

    test('returns empty array immediately if caller specifies unsupported movement type like 261', async () => {
      openResvSpy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations');

      const { status, data } = await GET(
        "/odata/v4/reservation-entry/getOpenReservations(plant='1120',movementType='261')",
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

    test('returns 404 when reservation has unsupported movement type like 261', async () => {
      rtSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'RKPF') return [{ BWART: '261', KOSTL: '', ANLN1: '', ANLN2: '', UMWRK: '', UMLGO: '' }];
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
  });
});
