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
      expect(openResvSpy).toHaveBeenCalledWith('', '1120');
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
  });
});
