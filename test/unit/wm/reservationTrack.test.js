/**
 * Unit Test Suite for Chunk 1: Data Model (ZRES_TRACK & ZRES_LOG)
 * Validates:
 * 1. Schema active in database & seed data loaded
 * 2. Status Domain / Value List resolution
 * 3. Test data insertable & queryable
 * 4. Step-wise progression: MB21 -> LB01 -> LT04 -> LT12 -> MIGO
 * 5. Validation constraints & log recording
 * 6. ReservationTrackAdapter normalization
 */
const cds = require('@sap/cds');

const { POST, GET } = cds.test(__dirname + '/../../../');
const { SELECT, DELETE } = cds.ql;

const TRACK_ENTITY = 'saps4hana.wm.ReservationTrack';
const STATUS_ENTITY = 'saps4hana.wm.ReservationStatus';
const LOG_ENTITY = 'saps4hana.wm.ReservationLog';

const authClerk = { auth: { username: 'carol', password: '' } };
const authViewer = { auth: { username: 'bob', password: '' } };

describe('Chunk 1: Data Model — ZRES_TRACK & ZRES_LOG', () => {
  describe('1. Tables Active & Code List Resolution', () => {
    test('ReservationStatus code list contains all 6 valid statuses with criticality', async () => {
      const statuses = await cds.db.run(SELECT.from(STATUS_ENTITY));
      expect(statuses.length).toBeGreaterThanOrEqual(6);

      const codes = statuses.map((s) => s.code);
      expect(codes).toContain('01');
      expect(codes).toContain('02');
      expect(codes).toContain('03');
      expect(codes).toContain('04');
      expect(codes).toContain('05');
      expect(codes).toContain('99');

      const s01 = statuses.find((s) => s.code === '01');
      expect(s01.name).toBe('Reservation Created');
      const s05 = statuses.find((s) => s.code === '05');
      expect(s05.name).toBe('Goods Issue Posted');
      expect(s05.criticality).toBe(3); // Green / Success
    });

    test('Initial seed data loaded for live proven reservations 0000524979 and 0000524301', async () => {
      const tracks = await cds.db.run(SELECT.from(TRACK_ENTITY));
      expect(tracks.length).toBeGreaterThanOrEqual(2);

      const r524979 = tracks.find((t) => t.ReservationNo === '0000524979');
      expect(r524979).toBeTruthy();
      expect(r524979.MovementType).toBe('311');
      expect(r524979.WarehouseNumber).toBe('W01');
      expect(r524979.Status_code).toBe('01');

      const r524301 = tracks.find((t) => t.ReservationNo === '0000524301');
      expect(r524301).toBeTruthy();
      expect(r524301.TransferRequirement).toBe('0001001839');
      expect(r524301.TransferOrder).toBe('0001012966');
      expect(r524301.MaterialDocument).toBe('4900050128');
      expect(r524301.Status_code).toBe('05');
    });

    test('Initial seed logs are linked and present for historical trace', async () => {
      const logs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: '0000524301' }));
      expect(logs.length).toBe(5); // MB21, LB01, LT04, LT12, MIGO
      const steps = logs.map((l) => l.Step);
      expect(steps).toEqual(['MB21', 'LB01', 'LT04', 'LT12', 'MIGO']);
    });

    test('OData GET on ReservationStatuses returns code list for F4 Value Help', async () => {
      const { status, data } = await GET('/odata/v4/reservation-track/ReservationStatuses', authViewer);
      expect(status).toBe(200);
      expect(data.value.length).toBeGreaterThanOrEqual(6);
      expect(data.value.some((s) => s.code === '01')).toBe(true);
    });
  });

  describe('2. Test Data Insertable via Service Actions', () => {
    const testResNo = '0000999001';
    const testResItem = '0001';

    afterEach(async () => {
      await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
    });

    test('Insert new tracking record for Movement 201 (MB21 stage)', async () => {
      const { status, data } = await POST(
        '/odata/v4/reservation-track/updateTrack',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          MovementType: '201',
          WarehouseNumber: 'W01',
          Status: '01'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toBeTruthy();
      expect(data.ReservationNo).toBe(testResNo);
      expect(data.ReservationItem).toBe(testResItem);
      expect(data.MovementType).toBe('201');
      expect(data.Status_code).toBe('01');

      // Verify read-back from db
      const [dbRow] = await cds.db.run(SELECT.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
      expect(dbRow.Status_code).toBe('01');
      expect(dbRow.WarehouseNumber).toBe('W01');
    });

    test('Add step-wise log entry via addLog action', async () => {
      const { status, data } = await POST(
        '/odata/v4/reservation-track/addLog',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          Step: 'MB21',
          Status: '01',
          MessageType: 'S',
          MessageId: 'M7',
          MessageNo: '060',
          MessageText: 'Reservation 0000999001 created'
        },
        authClerk
      );

      expect(status).toBe(200);
      expect(data).toBeTruthy();
      expect(data.ReservationNo).toBe(testResNo);
      expect(data.Step).toBe('MB21');
      expect(data.MessageType).toBe('S');
      expect(data.MessageText).toBe('Reservation 0000999001 created');

      const dbLogs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      expect(dbLogs.length).toBe(1);
    });

    test('Complete step-wise lifecycle: MB21 -> LB01 -> LT04 -> LT12 -> MIGO', async () => {
      // Step 1: Initialize MB21
      await POST(
        '/odata/v4/reservation-track/updateTrack',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          MovementType: '311',
          WarehouseNumber: 'W01',
          Status: '01'
        },
        authClerk
      );

      // Step 2: LB01 (Transfer Requirement created)
      await POST(
        '/odata/v4/reservation-track/advanceStatus',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          NextStatus: '02',
          DocumentNo: '0001009999',
          Step: 'LB01',
          Message: 'Transfer Requirement created via LB01'
        },
        authClerk
      );

      let track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
      expect(track.Status_code).toBe('02');
      expect(track.TransferRequirement).toBe('0001009999');

      // Step 3: LT04 (Transfer Order created)
      await POST(
        '/odata/v4/reservation-track/advanceStatus',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          NextStatus: '03',
          DocumentNo: '0001059999',
          Step: 'LT04',
          Message: 'Transfer Order created via LT04'
        },
        authClerk
      );

      track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
      expect(track.Status_code).toBe('03');
      expect(track.TransferOrder).toBe('0001059999');

      // Step 4: LT12 (Transfer Order confirmed)
      await POST(
        '/odata/v4/reservation-track/advanceStatus',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          NextStatus: '04',
          DocumentNo: '0001059999',
          Step: 'LT12',
          Message: 'Transfer Order confirmed via LT12'
        },
        authClerk
      );

      track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
      expect(track.Status_code).toBe('04');

      // Step 5: MIGO (Goods Issue posted)
      await POST(
        '/odata/v4/reservation-track/advanceStatus',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          NextStatus: '05',
          DocumentNo: '4900099999',
          Step: 'MIGO',
          Message: 'Material Document posted via MIGO'
        },
        authClerk
      );

      track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: testResNo }));
      expect(track.Status_code).toBe('05');
      expect(track.MaterialDocument).toBe('4900099999');
      expect(track.MaterialDocYear).toBeTruthy();

      // Check all 4 automated logs were created
      const logs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: testResNo }));
      expect(logs.length).toBe(4);
      expect(logs.map((l) => l.Step)).toEqual(['LB01', 'LT04', 'LT12', 'MIGO']);
    });
  });

  describe('3. Validation & Error Handling', () => {
    test('Rejects invalid status code with 400 Bad Request', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-track/updateTrack',
          {
            ReservationNo: '0000999999',
            ReservationItem: '0001',
            Status: 'INVALID_STATUS'
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Rejects missing keys with 400 Bad Request', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-track/updateTrack',
          {
            ReservationItem: '0001',
            Status: '01'
          },
          authClerk
        )
      ).rejects.toMatchObject({ response: { status: 400 } });
    });

    test('Error status 99 records error message in tracking and log', async () => {
      const resNo = '0000888001';
      try {
        await POST(
          '/odata/v4/reservation-track/updateTrack',
          {
            ReservationNo: resNo,
            ReservationItem: '0001',
            MovementType: '241',
            Status: '01'
          },
          authClerk
        );

        await POST(
          '/odata/v4/reservation-track/advanceStatus',
          {
            ReservationNo: resNo,
            ReservationItem: '0001',
            NextStatus: '99',
            Step: 'LT04',
            Message: 'Available stock shortfall in interim bin'
          },
          authClerk
        );

        const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: resNo }));
        expect(track.Status_code).toBe('99');
        expect(track.ErrorMessage).toBe('Available stock shortfall in interim bin');

        const logs = await cds.db.run(SELECT.from(LOG_ENTITY).where({ ReservationNo: resNo }));
        expect(logs.length).toBe(1);
        expect(logs[0].MessageType).toBe('E');
      } finally {
        await cds.db.run(DELETE.from(LOG_ENTITY).where({ ReservationNo: resNo }));
        await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: resNo }));
      }
    });

    test('Viewer role (bob) is forbidden from calling write action', async () => {
      await expect(
        POST(
          '/odata/v4/reservation-track/updateTrack',
          {
            ReservationNo: '0000111111',
            ReservationItem: '0001',
            Status: '01'
          },
          authViewer
        )
      ).rejects.toMatchObject({ response: { status: 403 } });
    });
  });

  describe('4. ReservationTrackAdapter', () => {
    const ReservationTrackAdapter = require('../../../srv/integration/s4hana/wm/ReservationTrackAdapter');

    test('getTrack normalizes leading zeros and formats response', async () => {
      const mockRfc = {
        readTable: jest.fn().mockResolvedValue([
          {
            RSNUM: '0000524979',
            RSPOS: '0001',
            MOVE_TYPE: '311',
            LGNUM: 'W01',
            TBNUM: '0001000123',
            TANUM: '0001000456',
            MBLNR: '0000000000',
            MJAHR: '0000',
            STATUS: '03',
            ERR_MSG: '',
            ERNAM: 'KHUSHAL',
            ERDAT: '20261010',
            AENAM: 'KHUSHAL',
            AEDAT: '20261010'
          }
        ])
      };

      const adapter = new ReservationTrackAdapter({ rfc: mockRfc });
      const track = await adapter.getTrack('524979', '1');

      expect(mockRfc.readTable).toHaveBeenCalledWith(
        'ZRES_TRACK',
        expect.any(Array),
        ["RSNUM = '0000524979' AND RSPOS = '0001'"]
      );
      expect(track).toMatchObject({
        ReservationNo: '524979',
        ReservationItem: '1',
        MovementType: '311',
        WarehouseNumber: 'W01',
        TransferRequirement: '1000123',
        TransferOrder: '1000456',
        Status: '03',
        CreatedBy: 'KHUSHAL'
      });
    });

    test('getTrack returns null when row does not exist', async () => {
      const mockRfc = { readTable: jest.fn().mockResolvedValue([]) };
      const adapter = new ReservationTrackAdapter({ rfc: mockRfc });
      const track = await adapter.getTrack('999999');
      expect(track).toBeNull();
    });

    test('getLogs returns mapped log array', async () => {
      const mockRfc = {
        readTable: jest.fn().mockResolvedValue([
          {
            LOG_ID: 'uuid-1',
            RSNUM: '0000524979',
            RSPOS: '0001',
            STEP: 'MB21',
            STATUS: '01',
            MSGTY: 'S',
            MSGID: 'M7',
            MSGNO: '060',
            MESSAGE: 'Reservation created',
            ERNAM: 'KHUSHAL',
            ERDAT: '20261010',
            ERZET: '103000'
          }
        ])
      };

      const adapter = new ReservationTrackAdapter({ rfc: mockRfc });
      const logs = await adapter.getLogs('524979');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        ReservationNo: '524979',
        Step: 'MB21',
        Status: '01',
        MessageType: 'S',
        MessageText: 'Reservation created'
      });
    });
  });
});
