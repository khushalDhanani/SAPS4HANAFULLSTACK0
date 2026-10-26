'use strict';

/**
 * Unit Test Suite for Chunk 6: Monitor App, Retry Actions & SLG1 Application Log
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST, GET } = cds.test(__dirname + '/../../../');
const { INSERT, DELETE } = cds.ql;

const authClerk = { auth: { username: 'carol', password: '' } };
const { seedLocalWmData } = require('../../wmSeedHelper');

describe('Chunk 6: Monitor App, Retry Handling & SLG1 Integration', () => {
  beforeAll(async () => {
    await seedLocalWmData();
  });

  let adapter;

  beforeEach(() => {
    adapter = new ReservationProcessAdapter();
    jest.spyOn(RfcClient.prototype, 'readTable').mockResolvedValue([]);
    jest.spyOn(RfcClient.prototype, 'session').mockImplementation(async (fn) => fn(async (fm) => {
      if (fm === 'BAL_LOG_CREATE') return { E_LOG_HANDLE: 'MOCK_LOG_HANDLE' };
      if (fm === 'BAL_GLB_SEARCH_LOG') return { E_T_LOG_HANDLE: [] };
      return {};
    }));
    jest.spyOn(ReservationProcessAdapter.prototype, 'checkAuthorization').mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

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
        Status_code: '90',
        ErrorMessage: 'Deficit of BA St.Loc. unrestricted-use stock'
      });
      RfcClient.prototype.readTable.mockImplementation(async (table) => table === 'RESB' ? [{ BWART: '311' }] : []);

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
          Step: 'MIGO',
          MovementType: '311'
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

    describe('MIGO retry movement type is pinned to SAP RESB/RKPF', () => {
      const addFailedMigoTrack = async () => {
        const { ReservationTrack } = cds.entities('saps4hana.wm');
        await INSERT.into(ReservationTrack).entries({
          ReservationNo: testResNo,
          ReservationItem: testResItem,
          MovementType: '311',
          Plant: '1120',
          StorageLocation: 'HS01',
          Material: '1000000045',
          Quantity: 1,
          Unit: 'EA',
          WarehouseNumber: 'W01',
          TransferRequirement: '0000010001',
          TransferOrder: '0000020001',
          Status_code: '90'
        });
      };

      const retry = (overrides = {}) => POST('/odata/v4/reservation-entry/retryStep', {
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        Step: 'MIGO',
        MovementType: '311',
        ...overrides
      }, authClerk);

      test('posts only when requested, SAP RESB, and stored movement types all match', async () => {
        await addFailedMigoTrack();
        RfcClient.prototype.readTable.mockImplementation(async (table) => table === 'RESB' ? [{ BWART: '311' }] : []);
        const post = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockResolvedValue({
          success: true, materialDocument: '5000000199', materialDocYear: '2026', status: '05', quantity: 1
        });

        const response = await retry();
        expect(response.status).toBe(200);
        expect(RfcClient.prototype.readTable).toHaveBeenCalledWith('RESB', ['BWART'], expect.any(Array), 2);
        expect(RfcClient.prototype.readTable).not.toHaveBeenCalledWith('RKPF', expect.anything(), expect.anything(), expect.anything());
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ movementType: '311' }));
        post.mockRestore();
      });

      test('uses RKPF only when RESB-BWART is blank', async () => {
        await addFailedMigoTrack();
        RfcClient.prototype.readTable.mockImplementation(async (table) => {
          if (table === 'RESB') return [{ BWART: '' }];
          if (table === 'RKPF') return [{ BWART: '311' }];
          return [];
        });
        const post = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockResolvedValue({
          success: true, materialDocument: '5000000200', materialDocYear: '2026', status: '05', quantity: 1
        });

        const response = await retry();
        expect(response.status).toBe(200);
        expect(RfcClient.prototype.readTable).toHaveBeenCalledWith('RKPF', ['BWART'], expect.any(Array), 2);
        expect(post).toHaveBeenCalledTimes(1);
        post.mockRestore();
      });

      test.each([
        ['SAP BWART mismatch', async () => [{ BWART: '201' }], 400],
        ['missing RESB row', async () => [], 503],
        ['duplicate RESB rows', async () => [{ BWART: '311' }, { BWART: '311' }], 503]
      ])('%s aborts before posting', async (_name, rows, status) => {
        await addFailedMigoTrack();
        RfcClient.prototype.readTable.mockImplementation(async (table) => table === 'RESB' ? rows() : []);
        const post = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement');
        await expect(retry()).rejects.toMatchObject({ response: { status } });
        expect(post).not.toHaveBeenCalled();
        post.mockRestore();
      });

      test.each([
        ['blank RKPF fallback', async () => [{ BWART: '' }], 503],
        ['missing RKPF row', async () => [], 503],
        ['duplicate RKPF rows', async () => [{ BWART: '311' }, { BWART: '311' }], 503],
        ['unreadable RESB', async () => { throw new Error('RFC unavailable'); }, 503]
      ])('%s fails closed before posting', async (_name, resbResult, status) => {
        await addFailedMigoTrack();
        RfcClient.prototype.readTable.mockImplementation(async (table) => {
          if (table === 'RESB') return resbResult();
          if (table === 'RKPF') return [{ BWART: '' }];
          return [];
        });
        const post = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement');
        await expect(retry()).rejects.toMatchObject({ response: { status } });
        expect(post).not.toHaveBeenCalled();
        post.mockRestore();
      });

      test.each([
        ['RKPF fallback mismatch', async () => [{ BWART: '201' }], 400],
        ['unreadable RKPF fallback', async () => { throw new Error('RFC unavailable'); }, 503]
      ])('%s aborts before posting', async (_name, rkpfResult, status) => {
        await addFailedMigoTrack();
        RfcClient.prototype.readTable.mockImplementation(async (table) => {
          if (table === 'RESB') return [{ BWART: '' }];
          if (table === 'RKPF') return rkpfResult();
          return [];
        });
        const post = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement');
        await expect(retry()).rejects.toMatchObject({ response: { status } });
        expect(post).not.toHaveBeenCalled();
        post.mockRestore();
      });

      test.each([
        ['reservation number', { ReservationNo: "0000999001' OR '1'='1" }],
        ['reservation item', { ReservationItem: "0001' OR '1'='1" }]
      ])('rejects injection-style %s before an RFC read or post', async (_name, input) => {
        await addFailedMigoTrack();
        const read = RfcClient.prototype.readTable;
        const post = jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement');
        await expect(retry(input)).rejects.toMatchObject({ response: { status: 400 } });
        expect(read).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
        post.mockRestore();
      });
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
      expect(res.data.Status_code).toBe('12'); // the failed step's own status, never 99
      expect(res.data.ErrorMessage).toContain('Storage bin 01-01-01 locked');

      spyTo.mockRestore();
    });

    test('getApplicationLogs returns audit log history for reservation item', async () => {
      const { ReservationTrack, ReservationLog } = cds.entities('saps4hana.wm');
      await INSERT.into(ReservationTrack).entries({
        ReservationNo: testResNo,
        ReservationItem: testResItem,
        MovementType: '311',
        Plant: '1120',
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
