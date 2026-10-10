'use strict';

/**
 * Unit Test Suite for Chunk 6: Monitor App, Retry Actions & SLG1 Application Log
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

const { POST, GET } = cds.test(__dirname + '/../../../');
const { INSERT, UPDATE, DELETE } = cds.ql;

const authClerk = { auth: { username: 'carol', password: '' } };

describe('Chunk 6: Monitor App, Retry Handling & SLG1 Integration', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ReservationProcessAdapter();
  });

  describe('1. Backend SLG1 Application Log Wrapper in ReservationProcessAdapter', () => {
    test('writeApplicationLog creates structured log entry with LogHandle and ExternalId', async () => {
      const result = await adapter.writeApplicationLog({
        object: 'ZWM_RES',
        subObject: 'TRACK',
        externalId: '0000524979/0001',
        reservationNo: '0000524979',
        reservationItem: '0001',
        step: 'MB21',
        messageText: 'Reservation created'
      });

      expect(result.success).toBe(true);
      expect(result.logHandle).toBeDefined();
      expect(result.logHandle.length).toBeLessThanOrEqual(22);
      expect(result.externalId).toBe('0000524979/0001');
      expect(result.object).toBe('ZWM_RES');
      expect(result.subObject).toBe('TRACK');
    });

    test('readApplicationLogs queries logs by externalId or handle', async () => {
      const result = await adapter.readApplicationLogs({
        externalId: '0000524979/0001',
        object: 'ZWM_RES',
        subObject: 'TRACK'
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.logs)).toBe(true);
    });
  });

  describe('2. Retry Action Orchestration in ReservationEntryService', () => {
    const testResNo = '0000999001';
    const testResItem = '0001';

    beforeEach(async () => {
      const { ReservationTrack, ReservationLog } = cds.entities('saps4hana.wm');
      await DELETE.from(ReservationLog).where({ ReservationNo: testResNo });
      await DELETE.from(ReservationTrack).where({ ReservationNo: testResNo });
    });

    afterEach(async () => {
      const { ReservationTrack, ReservationLog } = cds.entities('saps4hana.wm');
      await DELETE.from(ReservationLog).where({ ReservationNo: testResNo });
      await DELETE.from(ReservationTrack).where({ ReservationNo: testResNo });
    });

    test('Retries TR creation (LB01) when status is 01 and TR is missing', async () => {
      const { ReservationTrack } = cds.entities('saps4hana.wm');
      await INSERT.into(ReservationTrack).entries({
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'EA',
        WarehouseNumber: 'W01',
        ReceivingStorageLocation: 'CS01',
        TransferRequirement: '',
        Status_code: '01',
        ErrorMessage: 'Initial TR creation deferred'
      });

      const spyTr = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferRequirement')
        .mockResolvedValueOnce({
          success: true,
          warehouseNumber: 'W01',
          trNumber: '10001',
          trNumberRaw: '0000010001',
          status: '02'
        });

      const res = await POST(
        '/odata/v4/reservation-entry/retryStep',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          Step: 'AUTO'
        },
        authClerk
      );

      expect(res.status).toBe(200);
      expect(res.data.TransferRequirement).toBe('0000010001');
      expect(res.data.Status_code).toBe('02');
      expect(res.data.ErrorMessage).toBe('');
      expect(res.data.LogHandle).toBeDefined();

      spyTr.mockRestore();
    });

    test('Retries TO creation and confirmation (LT04) when status is 02 and TO is missing', async () => {
      const { ReservationTrack } = cds.entities('saps4hana.wm');
      await INSERT.into(ReservationTrack).entries({
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'EA',
        WarehouseNumber: 'W01',
        TransferRequirement: '0000010001',
        TransferOrder: '',
        Status_code: '02',
        ErrorMessage: 'TO creation failed previously'
      });

      const spyTo = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferOrderFromTR')
        .mockResolvedValueOnce({
          success: true,
          warehouseNumber: 'W01',
          toNumber: '20002',
          toNumberRaw: '0000020002',
          status: '03'
        });

      const spyConfirm = jest.spyOn(ReservationProcessAdapter.prototype, 'confirmTransferOrder')
        .mockResolvedValueOnce({
          success: true,
          warehouseNumber: 'W01',
          toNumber: '20002',
          status: '04',
          confirmed: true
        });

      const res = await POST(
        '/odata/v4/reservation-entry/retryStep',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          Step: 'AUTO'
        },
        authClerk
      );

      expect(res.status).toBe(200);
      expect(res.data.TransferOrder).toBe('0000020002');
      expect(res.data.Status_code).toBe('04');
      expect(res.data.ErrorMessage).toBe('');

      spyTo.mockRestore();
      spyConfirm.mockRestore();
    });

    test('Retries MIGO Goods Movement when status is 04 or 99', async () => {
      const { ReservationTrack } = cds.entities('saps4hana.wm');
      await INSERT.into(ReservationTrack).entries({
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'EA',
        WarehouseNumber: 'W01',
        TransferRequirement: '0000010001',
        TransferOrder: '0000020002',
        Status_code: '99',
        ErrorMessage: 'Deficit of BA St.Loc. unrestricted-use stock'
      });

      const spyMigo = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement')
        .mockResolvedValueOnce({
          success: true,
          materialDocument: '5000000099',
          materialDocYear: '2026',
          status: '05',
          stockEffect: 'Stock transferred to Storage Location CS01'
        });

      const res = await POST(
        '/odata/v4/reservation-entry/retryStep',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          Step: 'MIGO'
        },
        authClerk
      );

      expect(res.status).toBe(200);
      expect(res.data.MaterialDocument).toBe('5000000099');
      expect(res.data.MaterialDocYear).toBe('2026');
      expect(res.data.Status_code).toBe('05');
      expect(res.data.ErrorMessage).toBe('');

      spyMigo.mockRestore();
    });

    test('Handles retry error cleanly by setting status 99 and logging failure', async () => {
      const { ReservationTrack } = cds.entities('saps4hana.wm');
      await INSERT.into(ReservationTrack).entries({
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        MovementType: '311',
        Plant: '1120',
        StorageLocation: 'HS01',
        Material: '1000000045',
        Quantity: 10,
        Unit: 'EA',
        WarehouseNumber: 'W01',
        TransferRequirement: '0000010001',
        Status_code: '02'
      });

      const spyTo = jest.spyOn(ReservationProcessAdapter.prototype, 'createTransferOrderFromTR')
        .mockRejectedValueOnce(new Error('Storage bin 01-01-01 locked'));

      const res = await POST(
        '/odata/v4/reservation-entry/retryStep',
        {
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          Step: 'LT04'
        },
        authClerk
      );

      expect(res.status).toBe(200);
      expect(res.data.Status_code).toBe('99');
      expect(res.data.ErrorMessage).toContain('Storage bin 01-01-01 locked');

      spyTo.mockRestore();
    });

    test('getApplicationLogs returns audit log history for reservation item', async () => {
      const { ReservationTrack, ReservationLog } = cds.entities('saps4hana.wm');
      await INSERT.into(ReservationTrack).entries({
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        MovementType: '311',
        Status_code: '02'
      });

      await INSERT.into(ReservationLog).entries([
        {
          ID: cds.utils.uuid(),
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          LogHandle: 'LOG_TEST_01',
          ExternalId: `${testResNo}/${testResItem}`,
          SubObject: 'TRACK',
          Step: 'MB21',
          Status: '01',
          MessageType: 'S',
          MessageId: 'M7',
          MessageNo: '060',
          MessageText: 'Reservation created'
        },
        {
          ID: cds.utils.uuid(),
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          LogHandle: 'LOG_TEST_01',
          ExternalId: `${testResNo}/${testResItem}`,
          SubObject: 'TRACK',
          Step: 'LB01',
          Status: '02',
          MessageType: 'S',
          MessageId: 'L3',
          MessageNo: '001',
          MessageText: 'TR created'
        }
      ]);

      const res = await GET(
        `/odata/v4/reservation-entry/getApplicationLogs(ReservationNo='${testResNo}',ReservationItem='${testResItem}')`,
        authClerk
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.data.value)).toBe(true);
      expect(res.data.value.length).toBeGreaterThanOrEqual(2);
      expect(res.data.value.some((l) => l.Step === 'MB21')).toBe(true);
      expect(res.data.value.some((l) => l.Step === 'LB01')).toBe(true);
    });
  });
});
