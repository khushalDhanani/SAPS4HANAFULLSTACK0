'use strict';

const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');
const BusinessConfigResolver = require('../../../srv/common/BusinessConfigResolver');

describe('HuStockTransferAdapter (ZRF_RES_HU_DNR)', () => {
  let adapter;
  let mockRfc;

  beforeAll(() => {
    BusinessConfigResolver.registerWarehouseStorageTypes('W01', {
      pickableStorageTypes: ['EN1'],
      holdStorageTypes: ['OH1'],
      interimStorageTypes: ['921']
    });
  });

  afterAll(() => {
    BusinessConfigResolver.unregisterWarehouseStorageTypes('W01');
  });

  beforeEach(() => {
    mockRfc = {
      readTable: jest.fn(),
      call: jest.fn()
    };
    mockRfc.session = jest.fn((fn) => fn(mockRfc.call)); // one LUW: BAPI + COMMIT on the same connection
    adapter = new HuStockTransferAdapter({ rfcClient: mockRfc });
  });

  describe('getOpenReservations', () => {
    it('returns formatted open reservations filtered by plant and status', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'RESB') {
          return Promise.resolve([
            {
              RSNUM: '0000010042',
              RSPOS: '0001',
              BWART: '311',
              MATNR: '000000008000009754',
              CHARG: 'BATCH01',
              BDMNG: '100.000',
              ENMNG: '20.000',
              MEINS: 'NOS',
              WERKS: '1120',
              LGORT: 'CS02',
              UMLGO: 'CS01',
              BDTER: '2026-10-25',
              KZEAR: '',
              XLOEK: ''
            },
            {
              RSNUM: '0000010043',
              RSPOS: '0001',
              BWART: '311',
              MATNR: '000000008000009754',
              CHARG: '',
              BDMNG: '50.000',
              ENMNG: '50.000',
              MEINS: 'NOS',
              WERKS: '1120',
              LGORT: 'CS02',
              UMLGO: 'CS01',
              BDTER: '2026-10-24',
              KZEAR: 'X',
              XLOEK: ''
            }
          ]);
        }
        if (table === 'RKPF') {
          return Promise.resolve([
            { RSNUM: '0000010042', USNAM: 'DIPAK', BWART: '311' }
          ]);
        }
        if (table === 'MAKT') {
          return Promise.resolve([
            { MATNR: '000000008000009754', MAKTX: 'Raw Material 9754' }
          ]);
        }
        if (table === 'T320') {
          return Promise.resolve([
            { WERKS: '1120', LGORT: 'CS02', LGNUM: 'W01' }
          ]);
        }
        if (table === 'USR21') {
          return Promise.resolve([
            { BNAME: 'DIPAK', PERSNUMBER: '0000012345', ADDRNUMBER: '0000054321' }
          ]);
        }
        if (table === 'ADRP') {
          return Promise.resolve([
            { PERSNUMBER: '0000012345', NAME_TEXT: 'Dipak Rathod' }
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.getOpenReservations({ plant: '1120', status: 'open' });
      expect(res.TotalCount).toBe(1);
      const item = res.Items[0];
      expect(item.ReservationNo).toBe('10042');
      expect(item.ReservationItem).toBe('1');
      expect(item.Material).toBe('8000009754');
      expect(item.MaterialDesc).toBe('Raw Material 9754');
      expect(item.OpenQty).toBe(80);
      expect(item.Status).toBe('Partial');
      expect(item.Requester).toBe('DIPAK');
      expect(item.RequesterName).toBe('Dipak Rathod');
      expect(item.Warehouse).toBe('W01');
    });

    it('returns empty when no reservations exist', async () => {
      mockRfc.readTable.mockResolvedValue([]);
      const res = await adapter.getOpenReservations({ plant: '1120' });
      expect(res.TotalCount).toBe(0);
      expect(res.Items).toEqual([]);
    });
  });

  describe('getCockpitDetail', () => {
    it('returns complete transfer cockpit context with picking strategy and stock', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'RESB') {
          return Promise.resolve([{
            RSNUM: '0000010042',
            RSPOS: '0001',
            BWART: '311',
            MATNR: '000000008000009754',
            CHARG: 'BATCH01',
            BDMNG: '100.000',
            ENMNG: '20.000',
            MEINS: 'NOS',
            WERKS: '1120',
            LGORT: 'CS02',
            UMLGO: 'CS01'
          }]);
        }
        if (table === 'RKPF') return Promise.resolve([{ USNAM: 'DIPAK' }]);
        if (table === 'MAKT') return Promise.resolve([{ MAKTX: 'Chemical Compound' }]);
        if (table === 'T320') return Promise.resolve([{ LGNUM: 'W01' }]);
        if (table === 'MLGN') return Promise.resolve([{ LTKZA: 'EN1' }]);
        if (table === 'T334T') return Promise.resolve([{ LGTY0: 'EN1' }]);
        if (table === 'VEPO') {
          return Promise.resolve([
            { VENUM: '0001', VEMNG: '40.000' },
            { VENUM: '0002', VEMNG: '40.000' }
          ]);
        }
        return Promise.resolve([]);
      });

      const cockpit = await adapter.getCockpitDetail('10042', '1');
      expect(cockpit.ReservationNo).toBe('10042');
      expect(cockpit.Material).toBe('8000009754');
      expect(cockpit.OpenQty).toBe(80);
      expect(cockpit.Warehouse).toBe('W01');
      expect(cockpit.PreferredStorageType).toBe('EN1');
      expect(cockpit.AvailableUnitCount).toBe(2);
      expect(cockpit.TotalAvailableStock).toBe(80);
    });

    it('does not count a trailing-sign negative LQUA quant as available stock', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'RESB') {
          return Promise.resolve([{
            RSNUM: '0000010042', RSPOS: '0001', BWART: '311', MATNR: '000000008000009754',
            CHARG: '', BDMNG: '2.000', ENMNG: '0.000', MEINS: 'NOS', WERKS: '1120', LGORT: 'CS02', UMLGO: 'CS01'
          }]);
        }
        if (table === 'RKPF') return Promise.resolve([{ USNAM: 'DIPAK' }]);
        if (table === 'T320') return Promise.resolve([{ LGNUM: 'W01' }]);
        if (table === 'VEPO') return Promise.resolve([]);
        if (table === 'LQUA') return Promise.resolve([
          { LENUM: '00000000002000000001', GESME: '1.000' },
          { LENUM: '00000000002000000002', GESME: '1.000-' }
        ]);
        return Promise.resolve([]);
      });

      const cockpit = await adapter.getCockpitDetail('10042', '1');

      expect(cockpit.AvailableUnitCount).toBe(1);
      expect(cockpit.TotalAvailableStock).toBe(1);
    });

    it('rejects with 404 when reservation is not found', async () => {
      mockRfc.readTable.mockResolvedValue([]);
      await expect(adapter.getCockpitDetail('99999', '1')).rejects.toThrow('not found');
    });
  });

  describe('getCockpitDetail requester contact', () => {
    it('leaves the e-mail blank when ADR6 has no address instead of deriving one from the user name', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'RESB') return Promise.resolve([{ RSNUM: '0000010042', RSPOS: '0001', BWART: '311', MATNR: '000000008000009754', BDMNG: '10.000', ENMNG: '0.000', MEINS: 'NOS', WERKS: '1120', LGORT: 'CS02', UMLGO: 'CS01' }]);
        if (table === 'RKPF') return Promise.resolve([{ USNAM: 'DIPAK', BWART: '311' }]);
        if (table === 'USR21') return Promise.resolve([{ PERSNUMBER: '0000000123', ADDRNUMBER: '0000000456' }]);
        if (table === 'ADRP') return Promise.resolve([{ NAME_TEXT: 'Dipak Patel' }]);
        return Promise.resolve([]);
      });
      const res = await adapter.getCockpitDetail('10042', '1');
      expect(res.RequesterName).toBe('Dipak Patel');
      expect(res.RequesterEmail).toBe('');
    });

    it('rejects a reservation value containing a quote before any SAP read', async () => {
      await expect(adapter.getCockpitDetail("1' OR RSNUM LIKE '%", '1')).rejects.toMatchObject({ status: 400 });
      expect(mockRfc.readTable).not.toHaveBeenCalled();
    });
  });

  describe('validateUnit', () => {
    beforeEach(() => {
      // Mock cockpit base data
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        ReservationNo: '10042',
        ReservationItem: '1',
        MovementType: '311',
        Material: '8000009754',
        Batch: 'BATCH01',
        OpenQty: 80,
        BaseUnit: 'NOS',
        Plant: '1120',
        StorageLocation: 'CS02',
        ReceivingStorageLocation: 'CS01',
        Warehouse: 'W01',
        PreferredStorageType: 'EN1'
      });
    });

    it('validates a valid Handling Unit (HU) with serial and SUT', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'VEKP') {
          return Promise.resolve([{
            VENUM: '0000012345',
            STATUS: '0020',
            WERKS: '1120',
            LGORT: 'CS02',
            EXIDV: '00000000002000019371'
          }]);
        }
        if (table === 'VEPO') {
          return Promise.resolve([{
            MATNR: '000000008000009754',
            CHARG: 'BATCH01',
            VEMNG: '50.000',
            VEMEH: 'NOS',
            WERKS: '1120',
            LGORT: 'CS02'
          }]);
        }
        if (table === 'SER06') return Promise.resolve([{ OBKNR: '0000099999' }]);
        if (table === 'OBJK') return Promise.resolve([{ SERNR: 'SN-9754-001' }]);
        if (table === 'LQUA') {
          return Promise.resolve([{
            LGNUM: 'W01',
            LGTYP: 'EN1',
            LGPLA: '1-L0001-04',
            LETYP: 'E10'
          }]);
        }
        if (table === 'T307T') return Promise.resolve([{ LETYT: 'Standard Euro Pallet' }]);
        return Promise.resolve([]);
      });

      const res = await adapter.validateUnit('10042', '1', '2000019371');
      expect(res.Valid).toBe(true);
      expect(res.UnitType).toBe('Handling Unit (HU)');
      expect(res.AvailableQuantity).toBe(50);
      expect(res.DefaultTransferQty).toBe(50); // min(50, 80)
      expect(res.SerialNumber).toBe('SN-9754-001');
      expect(res.SutCode).toBe('E10');
      expect(res.SutDescription).toBe('Standard Euro Pallet');
      expect(res.IsPreferredStorage).toBe(true);
      expect(res.StatusState).toBe('Success');
    });

    it('rejects an HU that has already been goods-issued (status 0050)', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'VEKP') {
          return Promise.resolve([{
            VENUM: '0000012345',
            STATUS: '0050',
            EXIDV: '00000000002000019371'
          }]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.validateUnit('10042', '1', '2000019371');
      expect(res.Valid).toBe(false);
      expect(res.StatusMessage).toContain('already Goods Issued (Status 0050)');
    });

    it('validates a Storage Unit (SU) when not present in VEKP', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'VEKP') return Promise.resolve([]);
        if (table === 'LQUA') {
          return Promise.resolve([{
            MATNR: '000000008000009754',
            CHARG: 'BATCH01',
            GESME: '80.000',
            MEINS: 'NOS',
            WERKS: '1120',
            LGORT: 'CS02',
            LGNUM: 'W01',
            LGTYP: 'EN1',
            LGPLA: '1-L0001-05',
            LETYP: 'E10'
          }]);
        }
        if (table === 'T307T') return Promise.resolve([{ LETYT: 'Standard Pallet' }]);
        return Promise.resolve([]);
      });

      const res = await adapter.validateUnit('10042', '1', 'SU-10042');
      expect(res.Valid).toBe(true);
      expect(res.UnitType).toBe('Storage Unit (SU)');
      expect(res.AvailableQuantity).toBe(80);
      expect(res.StatusState).toBe('Success');
    });

    it('warns when unit is in On-Hold storage type (OH1)', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'VEKP') return Promise.resolve([{ VENUM: '1', STATUS: '0020', EXIDV: '2000019371' }]);
        if (table === 'VEPO') return Promise.resolve([{ MATNR: '000000008000009754', CHARG: 'BATCH01', VEMNG: '50.000', VEMEH: 'NOS', WERKS: '1120', LGORT: 'CS02' }]);
        if (table === 'LQUA') return Promise.resolve([{ LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'ONHOLD' }]);
        return Promise.resolve([]);
      });

      const res = await adapter.validateUnit('10042', '1', '2000019371');
      expect(res.Valid).toBe(true);
      expect(res.IsOnHold).toBe(true);
      expect(res.StatusState).toBe('Warning');
    });

    it('rejects when storage location differs from reservation source SLoc', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'VEKP') return Promise.resolve([{ VENUM: '1', STATUS: '0020', EXIDV: '2000019371', LGORT: 'CS01' }]);
        if (table === 'VEPO') return Promise.resolve([{ MATNR: '000000008000009754', CHARG: 'BATCH01', VEMNG: '50.000', VEMEH: 'NOS', WERKS: '1120', LGORT: 'CS01' }]);
        return Promise.resolve([]);
      });

      const res = await adapter.validateUnit('10042', '1', '2000019371');
      expect(res.Valid).toBe(false);
      expect(res.StatusMessage).toContain('Storage Location Mismatch');
    });
  });

  describe('validateUnit input guard and packaging type', () => {
    beforeEach(() => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        ReservationNo: '10042', ReservationItem: '1', Material: '8000009754', Batch: '', OpenQty: 80, BaseUnit: 'NOS',
        Plant: '1120', StorageLocation: 'CS02', ReceivingStorageLocation: 'CS01', Warehouse: 'W01', PreferredStorageType: 'EN1', TransferPath: 'A'
      });
    });

    it('rejects a unit number containing a quote before any SAP read', async () => {
      await expect(adapter.validateUnit('10042', '1', "X' OR MATNR LIKE '%")).rejects.toMatchObject({ status: 400 });
      expect(mockRfc.readTable).not.toHaveBeenCalled();
    });

    it('reads VHART/VHILM from VEKP so the T319A packaging warning can fire on Path A', async () => {
      mockRfc.readTable.mockImplementation((table, fields) => {
        if (table === 'VEKP') {
          expect(fields).toEqual(expect.arrayContaining(['VHART', 'VHILM']));
          return Promise.resolve([{ VENUM: '0000012345', STATUS: '0020', WERKS: '1120', LGORT: 'CS02', EXIDV: '00000000002000019372', VHART: 'Z007', VHILM: '000000002000000340' }]);
        }
        if (table === 'VEPO') return Promise.resolve([{ MATNR: '000000008000009754', CHARG: '', VEMNG: '1.000', VEMEH: 'NOS', WERKS: '1120', LGORT: 'CS02' }]);
        if (table === 'LQUA') return Promise.resolve([{ LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LETYP: 'E10' }]);
        if (table === 'T319A') return Promise.resolve([{ LGNUM: 'W01', VHART: '0001', LETYP: 'E1' }]); // no Z007 row (live W01 evidence)
        return Promise.resolve([]);
      });
      const res = await adapter.validateUnit('10042', '1', '2000019372');
      expect(res.Valid).toBe(true);
      expect(res.WarningDetails.map((w) => w.code)).toEqual(['NO_T319A_ROW']);
      expect(res.WarningDetails[0].params).toEqual(['Z007', 'W01']);
      expect(res.StatusState).toBe('Warning');
    });
  });

  describe('validateHuStockTransferSelection (read-only)', () => {
    const baseCockpit = {
      ReservationNo: '10042', ReservationItem: '1', OpenQty: 5,
      Plant: '1120', Warehouse: 'W01', BaseUnit: 'NOS',
      OversizeHuSelectionBehavior: 'BLOCK'
    };
    const validUnit = (unitNumber, available) => ({
      Valid: true,
      UnitNumber: unitNumber,
      UnitType: 'Handling Unit (HU)',
      AvailableQuantity: available,
      BaseUnit: 'NOS',
      StorageType: 'EN1',
      StorageBin: '1-L0001-01'
    });

    beforeEach(() => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({ ...baseCockpit });
      jest.spyOn(adapter, 'validateUnit').mockImplementation(async (_res, _item, unit) => validUnit(unit, 3));
    });

    afterEach(() => jest.restoreAllMocks());

    it('accepts several HU quantities whose sum is within the open quantity and performs no RFC write', async () => {
      const result = await adapter.validateHuStockTransferSelection({
        ReservationNo: '10042', ReservationItem: '1',
        Selections: [{ UnitNumber: 'HU1', TransferQty: 2 }, { UnitNumber: 'HU2', TransferQty: 3 }]
      });
      expect(result).toMatchObject({ Valid: true, OpenQuantity: 5, SelectedQuantity: 5, RemainingQuantity: 0 });
      expect(result.Items).toHaveLength(2);
      expect(mockRfc.call).not.toHaveBeenCalled();
    });

    it('rejects totals above the open quantity', async () => {
      await expect(adapter.validateHuStockTransferSelection({
        ReservationNo: '10042', ReservationItem: '1',
        Selections: [{ UnitNumber: 'HU1', TransferQty: 3 }, { UnitNumber: 'HU2', TransferQty: 3 }]
      })).rejects.toMatchObject({ status: 422, message: expect.stringContaining('remaining reservation quantity') });
      expect(mockRfc.call).not.toHaveBeenCalled();
    });

    it('rejects an item quantity above that HU stock', async () => {
      await expect(adapter.validateHuStockTransferSelection({
        ReservationNo: '10042', ReservationItem: '1',
        Selections: [{ UnitNumber: 'HU1', TransferQty: 4 }]
      })).rejects.toMatchObject({ status: 422, message: expect.stringContaining('available stock') });
    });

    it('blocks an HU whose stock exceeds the remaining open quantity by default', async () => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({ ...baseCockpit, OpenQty: 2 });
      jest.spyOn(adapter, 'validateUnit').mockResolvedValue(validUnit('HU1', 3));
      await expect(adapter.validateHuStockTransferSelection({
        ReservationNo: '10042', ReservationItem: '1', Selections: [{ UnitNumber: 'HU1', TransferQty: 1 }]
      })).rejects.toMatchObject({ status: 422, message: expect.stringContaining('blocked by the current warehouse policy') });
    });

    it('honors WARN policy while still limiting selected quantity to the open amount', async () => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({ ...baseCockpit, OpenQty: 2, OversizeHuSelectionBehavior: 'WARN' });
      jest.spyOn(adapter, 'validateUnit').mockResolvedValue(validUnit('HU1', 3));
      const result = await adapter.validateHuStockTransferSelection({
        ReservationNo: '10042', ReservationItem: '1', Selections: [{ UnitNumber: 'HU1', TransferQty: 2 }]
      });
      expect(result.OversizeHuSelectionBehavior).toBe('WARN');
      expect(result.SelectedQuantity).toBe(2);
      expect(result.Warnings).toHaveLength(1);
      expect(mockRfc.call).not.toHaveBeenCalled();
    });

    it('rejects duplicate HU selection', async () => {
      await expect(adapter.validateHuStockTransferSelection({
        ReservationNo: '10042', ReservationItem: '1',
        Selections: [{ UnitNumber: 'HU1', TransferQty: 1 }, { UnitNumber: 'hu1', TransferQty: 1 }]
      })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('selected more than once') });
    });
  });

  describe('executeHuStockTransfer', () => {
    beforeEach(() => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        ReservationNo: '10042',
        ReservationItem: '1',
        MovementType: '311',
        Material: '8000009754',
        Batch: 'BATCH01',
        OpenQty: 50,
        BaseUnit: 'NOS',
        Plant: '1120',
        StorageLocation: 'CS02',
        ReceivingStorageLocation: 'CS01',
        Warehouse: 'W01',
        PreferredStorageType: 'EN1',
        Requester: 'DIPAK'
      });

      jest.spyOn(adapter, 'validateUnit').mockResolvedValue({
        Valid: true,
        UnitNumber: '2000019371',
        UnitType: 'Handling Unit (HU)',
        Batch: 'BATCH01',
        AvailableQuantity: 50,
        BaseUnit: 'NOS',
        StorageLocation: 'CS02'
      });
    });

    it('executes Path B (BAPI_GOODSMVT_CREATE) for standard / fallback location and commits', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'T001L') return Promise.resolve([{ WERKS: '1120', LGORT: 'CS02', XHUPF: '' }]);
        if (table === 'MATDOC') return Promise.resolve([{ MBLNR: '4900012345', MJAHR: '2026', BWART: '311' }]);
        return Promise.resolve([]);
      });

      mockRfc.call.mockImplementation((fm) => {
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          return Promise.resolve({
            GOODSMVT_HEADRET: { MAT_DOC: '4900012345', DOC_YEAR: '2026' }
          });
        }
        if (fm === 'BAPI_TRANSACTION_COMMIT') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const res = await adapter.executeHuStockTransfer({
        ReservationNo: '10042',
        ReservationItem: '1',
        UnitNumber: '2000019371',
        TransferQty: 50,
        IsFullUnit: true,
        ClientAttemptId: 'attempt-001'
      });

      expect(res.Success).toBe(true);
      expect(res.MaterialDocument).toBe('4900012345');
      expect(res.MaterialDocYear).toBe('2026');
      expect(res.PostingPath).toBe('STANDARD_BAPI_06');
      expect(res.IsFinalIssue).toBe(true);
      expect(res.UpdatedOpenQty).toBe(0);
      expect(res.UpdatedStatus).toBe('Completed');
      expect(res.ReadBackVerified).toBe(true);
      expect(res.RequesterAlertSent).toBe(false);
      expect(res.Message).not.toMatch(/alert/i);
      expect(mockRfc.session).toHaveBeenCalledTimes(1);
      expect(mockRfc.readTable).toHaveBeenCalledWith('MATDOC', ['MBLNR', 'MJAHR', 'BWART'], ["MBLNR = '4900012345'", "AND MJAHR = '2026'"], 10);
    });

    it('returns cached result on idempotent retry without re-calling SAP', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'MATDOC') return Promise.resolve([{ MBLNR: '4900012345', MJAHR: '2026', BWART: '311' }]);
        return Promise.resolve([{ WERKS: '1120', LGORT: 'CS02', XHUPF: '' }]);
      });
      mockRfc.call.mockResolvedValue({ GOODSMVT_HEADRET: { MAT_DOC: '4900012345', DOC_YEAR: '2026' } });

      const res1 = await adapter.executeHuStockTransfer({
        ReservationNo: '10042',
        ReservationItem: '1',
        UnitNumber: '2000019371',
        TransferQty: 50,
        ClientAttemptId: 'idempotent-key-42'
      });

      expect(res1.MaterialDocument).toBe('4900012345');
      expect(mockRfc.call).toHaveBeenCalledTimes(2); // BAPI + COMMIT

      // Re-submit with same attempt ID
      const res2 = await adapter.executeHuStockTransfer({
        ReservationNo: '10042',
        ReservationItem: '1',
        UnitNumber: '2000019371',
        TransferQty: 50,
        ClientAttemptId: 'idempotent-key-42'
      });

      // No new RFC calls made
      expect(mockRfc.call).toHaveBeenCalledTimes(2);
      expect(res2.MaterialDocument).toBe('4900012345');
    });

    it('propagates SAP BAPI rejection with 422', async () => {
      mockRfc.readTable.mockResolvedValue([{ WERKS: '1120', LGORT: 'CS02', XHUPF: '' }]);
      mockRfc.call.mockImplementation((fm) => {
        if (fm === 'BAPI_GOODSMVT_CREATE') {
          return Promise.resolve({
            GOODSMVT_HEADRET: {},
            RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Deficit of BA Unrestricted-use stock' }]
          });
        }
        if (fm === 'BAPI_TRANSACTION_ROLLBACK') return Promise.resolve({});
        return Promise.resolve({});
      });

      await expect(adapter.executeHuStockTransfer({
        ReservationNo: '10042',
        ReservationItem: '1',
        UnitNumber: '2000019371',
        TransferQty: 50,
        ClientAttemptId: 'attempt-fail'
      })).rejects.toThrow('Deficit of BA Unrestricted-use stock');
    });
  });

  describe('executeHuStockTransfer outcome classification', () => {
    const payload = { ReservationNo: '10042', ReservationItem: '1', UnitNumber: '2000019371', TransferQty: 50, ClientAttemptId: 'rb-1' };
    beforeEach(() => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        OpenQty: 50, BaseUnit: 'NOS', Plant: '1120', Material: '8000009754', Batch: '',
        StorageLocation: 'CS02', ReceivingStorageLocation: 'CS01', Requester: 'DIPAK'
      });
      jest.spyOn(adapter, 'validateUnit').mockResolvedValue({ Valid: true, UnitType: 'Handling Unit (HU)', AvailableQuantity: 50, StorageLocation: 'CS02' });
    });

    it('reports an unconfirmed outcome (not a rejection) when the document cannot be read back', async () => {
      mockRfc.readTable.mockImplementation((table) => Promise.resolve(table === 'T001L' ? [{ XHUPF: '' }] : []));
      mockRfc.call.mockResolvedValue({ GOODSMVT_HEADRET: { MAT_DOC: '4900012345', DOC_YEAR: '2026' } });
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({
        status: 502, sapWriteAttempted: true, materialDocument: '4900012345', message: expect.stringMatching(/could not be read back/)
      });
      expect(mockRfc.readTable).toHaveBeenCalledWith('MSEG', expect.any(Array), expect.any(Array), 10);
      expect(adapter._attemptCache.size).toBe(0);
    });

    it('reports an unconfirmed outcome when the read-back shows a different movement type', async () => {
      mockRfc.readTable.mockImplementation((table) => Promise.resolve(
        table === 'T001L' ? [{ XHUPF: '' }] : table === 'MATDOC' ? [{ MBLNR: '4900012345', MJAHR: '2026', BWART: '301' }] : []));
      mockRfc.call.mockResolvedValue({ GOODSMVT_HEADRET: { MAT_DOC: '4900012345', DOC_YEAR: '2026' } });
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status: 502, sapWriteAttempted: true, message: expect.stringMatching(/301 instead of 311/) });
    });

    it('marks an RFC failure during the BAPI session as unconfirmed, and a SAP rejection as definitive', async () => {
      mockRfc.readTable.mockResolvedValue([{ XHUPF: '' }]);
      mockRfc.call.mockRejectedValue(new Error('connection reset'));
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status: 502, sapWriteAttempted: true });

      mockRfc.call.mockImplementation((fm) => Promise.resolve(fm === 'BAPI_GOODSMVT_CREATE'
        ? { GOODSMVT_HEADRET: {}, RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'Deficit' }] } : {}));
      const rejected = await adapter.executeHuStockTransfer({ ...payload, ClientAttemptId: 'rb-2' }).catch((e) => e);
      expect(rejected.status).toBe(422);
      expect(rejected.sapWriteAttempted).toBeUndefined();
    });

    it('does not fall back to BAPI_GOODSMVT_CREATE when HU_CREATE_GOODS_MOVEMENT fails for a reason other than FU_NOT_FOUND', async () => {
      mockRfc.readTable.mockImplementation(async (table) => (table === 'TFDIR' ? [{ FUNCNAME: 'HU_CREATE_GOODS_MOVEMENT', FMODE: 'R' }] : [{ XHUPF: 'X' }]));
      mockRfc.call.mockImplementation((fm) => fm === 'HU_CREATE_GOODS_MOVEMENT' ? Promise.reject(new Error('timeout')) : Promise.resolve({}));
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status: 502, sapWriteAttempted: true });
      expect(mockRfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
      expect(mockRfc.session).not.toHaveBeenCalled();
    });
  });

  describe('HU follow-up regressions (mock SAP only)', () => {
    const payload = { ReservationNo: '10042', ReservationItem: '1', UnitNumber: '2000019371', TransferQty: 1 };
    beforeEach(() => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({ OpenQty: 5, Plant: '1150', Material: '8000009803', StorageLocation: 'CS02', ReceivingStorageLocation: 'CIS1' });
      jest.spyOn(adapter, 'validateUnit').mockResolvedValue({ Valid: true, UnitType: 'Handling Unit (HU)', AvailableQuantity: 5 });
      // T001L: HU-managed; TFDIR: function remote-enabled (the live system has FMODE blank, see the gate tests below)
      mockRfc.readTable.mockImplementation(async (table) => (table === 'TFDIR' ? [{ FUNCNAME: 'HU_CREATE_GOODS_MOVEMENT', FMODE: 'R' }] : [{ XHUPF: 'X' }]));
    });

    it.each([
      ['FMODE blank (live 2026-10-26 evidence)', [{ FUNCNAME: 'HU_CREATE_GOODS_MOVEMENT', FMODE: '' }], 501, /not RFC-enabled \(TFDIR FMODE ''\)/],
      ['function missing from TFDIR', [], 501, /not found/],
      ['TFDIR read failure', new Error('read unavailable'), 503, /Cannot verify in SAP \(TFDIR\)/]
    ])('refuses the HU-managed posting before any function call when %s', async (_label, tfdir, status, message) => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'TFDIR') { if (tfdir instanceof Error) throw tfdir; return tfdir; }
        return [{ XHUPF: 'X' }];
      });
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status, message });
      expect(mockRfc.call).not.toHaveBeenCalled();
      expect(mockRfc.session).not.toHaveBeenCalled();
      expect(adapter._attemptCache.size).toBe(0);
    });

    it('sends HUM_EXIDV / HUM_DATA_MOVE_TO rows with the DD03L-confirmed field names', async () => {
      mockRfc.call.mockResolvedValue({ ES_EMKPF: { MBLNR: '4900000001', MJAHR: '2026' } });
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'TFDIR') return [{ FUNCNAME: 'HU_CREATE_GOODS_MOVEMENT', FMODE: 'R' }];
        if (table === 'MATDOC') return [{ MBLNR: '4900000001', MJAHR: '2026', BWART: '311' }];
        return [{ XHUPF: 'X' }];
      });
      await adapter.executeHuStockTransfer(payload);
      expect(mockRfc.call).toHaveBeenCalledWith('HU_CREATE_GOODS_MOVEMENT', {
        IF_EVENT: '0006', IF_COMMIT: 'X',
        IT_EXTERNAL_ID: [{ EXIDV: '00000000002000019371' }],
        IT_MOVE_TO: [{ HUWBEVENT: '0006', WERKS: '1150', LGORT: 'CIS1', BWART: '311' }]
      });
    });

    it('reads TFDIR once per adapter instance', async () => {
      mockRfc.call.mockResolvedValue({ ES_EMKPF: { MBLNR: '4900000001', MJAHR: '2026' } });
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'TFDIR') return [{ FUNCNAME: 'HU_CREATE_GOODS_MOVEMENT', FMODE: 'R' }];
        if (table === 'MATDOC') return [{ MBLNR: '4900000001', MJAHR: '2026', BWART: '311' }];
        return [{ XHUPF: 'X' }];
      });
      await adapter.executeHuStockTransfer({ ...payload, ClientAttemptId: 'a1' });
      await adapter.executeHuStockTransfer({ ...payload, ClientAttemptId: 'a2' });
      expect(mockRfc.readTable.mock.calls.filter(([t]) => t === 'TFDIR')).toHaveLength(1);
      expect(mockRfc.call.mock.calls.map(([fm]) => fm)).toEqual(['HU_CREATE_GOODS_MOVEMENT', 'HU_CREATE_GOODS_MOVEMENT']);
    });

    it.each([
      [{}, 422, /returned no material document/],
      [{ ES_MESSAGE: { MSGTY: 'E', MSGID: 'M7', MSGNO: '021', MSGV1: 'stock rejected' } }, 422, /stock rejected/],
      [Object.assign(new Error('missing'), { key: 'FU_NOT_FOUND' }), 501, /not callable via RFC/]
    ])('blocks HUM failure without a BAPI fallback (%j)', async (response, status, message) => {
      if (response instanceof Error) mockRfc.call.mockRejectedValue(response);
      else mockRfc.call.mockResolvedValue(response);
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status, message });
      expect(mockRfc.call.mock.calls.map(([fm]) => fm)).toEqual(['HU_CREATE_GOODS_MOVEMENT']);
      expect(mockRfc.session).not.toHaveBeenCalled();
      expect(adapter._attemptCache.size).toBe(0);
    });

    it('rejects a storage unit on an HU-managed location before any posting call', async () => {
      adapter.validateUnit.mockResolvedValue({ Valid: true, UnitType: 'Storage Unit (SU)', AvailableQuantity: 5 });
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('only a handling unit') });
      expect(mockRfc.call).not.toHaveBeenCalled();
      expect(mockRfc.session).not.toHaveBeenCalled();
    });

    it.each([
      ['read failure', new Error('read unavailable')],
      ['missing location', []],
      ['missing HU flag', [{}]],
      ['unknown HU flag', [{ XHUPF: '?' }]],
      ['ambiguous location', [{ XHUPF: '' }, { XHUPF: 'X' }]]
    ])('blocks posting on %s without invoking either write path', async (_label, response) => {
      if (response instanceof Error) mockRfc.readTable.mockRejectedValue(response);
      else mockRfc.readTable.mockResolvedValue(response);
      await expect(adapter.executeHuStockTransfer(payload)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Nothing was posted') });
      expect(mockRfc.call).not.toHaveBeenCalled();
      expect(mockRfc.session).not.toHaveBeenCalled();
      expect(adapter._attemptCache.size).toBe(0);
    });

    it('requires explicit plant and warehouse without querying default locations', async () => {
      await expect(adapter.getOpenReservations()).rejects.toMatchObject({ status: 400 });
      await expect(adapter.getStorageTypeRules({ plant: '1150' })).rejects.toMatchObject({ status: 400 });
      await expect(adapter.rackLayout()).rejects.toMatchObject({ status: 400 });
      expect(mockRfc.readTable).not.toHaveBeenCalled();
    });
  });

  describe('cockpit status-aware stock regression', () => {
    it('counts distinct retained HUs and excludes every item of a goods-issued HU', async () => {
      mockRfc.readTable.mockImplementation(async (table) => {
        if (table === 'RESB') return [{ RSNUM: '0000010042', RSPOS: '0001', BWART: '311', WERKS: '1150', LGORT: 'CS02', MATNR: '000000008000009803', BDMNG: '5', ENMNG: '0' }];
        if (table === 'VEPO') return [{ VENUM: '1', VEMNG: '2' }, { VENUM: '1', VEMNG: '1' }, { VENUM: '2', VEMNG: '7' }];
        if (table === 'VEKP') return [{ VENUM: '1', STATUS: '0020' }, { VENUM: '2', STATUS: '0050' }];
        return [];
      });
      const cockpit = await adapter.getCockpitDetail('10042', '1');
      expect(cockpit).toMatchObject({ AvailableUnitCount: 1, TotalAvailableStock: 3, Warehouse: '', PreferredStorageType: '' });
      expect(mockRfc.readTable).not.toHaveBeenCalledWith('LQUA', expect.anything(), expect.anything(), expect.anything());
    });
  });

  describe('getStorageBins & getVisualRack', () => {
    beforeEach(() => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        ReservationNo: '10042',
        ReservationItem: '1',
        Material: '8000009754',
        Plant: '1120',
        StorageLocation: 'CS02',
        Warehouse: 'W01',
        PreferredStorageType: 'EN1'
      });

      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'LQUA') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LGORT: 'CS02', LENUM: '2000019371', CHARG: 'B1', GESME: '50.000', MEINS: 'NOS', LETYP: 'E10', KZHUQ: 'X' },
            { LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'HOLD-01', LGORT: 'CS02', LENUM: '2000019372', CHARG: 'B2', GESME: '10.000', MEINS: 'NOS', LETYP: 'E10', KZHUQ: ' ' }
          ]);
        }
        if (table === 'LAGP') return Promise.resolve([
          { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LGBER: 'IT1', LPTYP: 'P01' },
          { LGNUM: 'W01', LGTYP: 'OH1', LGPLA: 'HOLD-01', LGBER: '', LPTYP: 'H01' }
        ]);
        if (table === 'T302T') return Promise.resolve([
          { LGNUM: 'W01', LGTYP: 'EN1', LGBER: 'IT1', SPRAS: 'E', LBERT: 'Operations' }
        ]);
        if (table === 'T301T') return Promise.resolve([{ LGNUM: 'W01', LGTYP: 'EN1', LTYPT: 'High Rack Storage' }]);
        if (table === 'T307T') return Promise.resolve([{ LGNUM: 'W01', LETYP: 'E10', LETYT: 'Standard Pallet' }]);
        return Promise.resolve([]);
      });
    });

    it('retrieves sorted storage bins with status priorities', async () => {
      const bins = await adapter.getStorageBins('10042', '1');
      expect(bins.length).toBe(2);
      expect(bins[0].StorageType).toBe('EN1');
      expect(bins[0].SortPriority).toBe(1); // Preferred
      expect(bins[1].StorageType).toBe('OH1');
      expect(bins[1].SortPriority).toBe(4); // On-Hold
    });

    it('maps rack parts strictly from the bin name and keeps LPTYP as bin type', async () => {
      const bins = await adapter.getStorageBins('10042', '1');
      expect(bins[0]).toMatchObject({
        Floor: '1', Rack: 'L0001', Position: '04', BinPosition: '04', IsRackBin: true,
        BinType: 'P01', SectionCode: 'IT1', SectionName: 'Operations', BinMasterFound: true
      });
      expect(bins[1]).toMatchObject({
        Floor: '', Rack: '', Position: '', BinPosition: '', IsRackBin: false,
        BinType: 'H01', SectionCode: '', SectionName: '', BinMasterFound: true
      });
    });

    it('does not infer a section when the LAGP bin-master row is missing', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'LQUA') return Promise.resolve([
          { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LGORT: 'CS02', LENUM: '2000019371', CHARG: 'B1', GESME: '50.000', MEINS: 'NOS', LETYP: 'E10', KZHUQ: 'X' }
        ]);
        if (table === 'LAGP') return Promise.resolve([]);
        if (table === 'T302T') return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const [bin] = await adapter.getStorageBins('10042', '1');
      expect(bin).toMatchObject({ IsRackBin: true, Floor: '1', Rack: 'L0001', Position: '04', SectionCode: '', SectionName: '', BinMasterFound: false });
    });

    it('keeps the compatibility visual-rack response neutral about levels and bays', async () => {
      const rack = await adapter.getVisualRack('10042', '1');
      expect(rack.length).toBe(2);
      expect(rack[0]).toMatchObject({ FloorId: '1', RackNumber: 'L0001', Position: '04', LevelCode: '', LevelNumber: null, ShelfLevelDesc: '' });
      expect(rack[1].IsRackBin).toBe(false);
    });
  });

  describe('storage type rules per warehouse', () => {
    beforeAll(() => BusinessConfigResolver.registerWarehouseStorageTypes('W15', {
      pickableStorageTypes: ['OH9'], holdStorageTypes: ['EN1'], interimStorageTypes: ['921']
    }));
    afterAll(() => BusinessConfigResolver.unregisterWarehouseStorageTypes('W15'));

    it('caches resolved rules per plant|warehouse instead of reusing the first warehouse', async () => {
      const w01 = await adapter.getStorageTypeRules({ plant: '1120', warehouse: 'W01' });
      const w15 = await adapter.getStorageTypeRules({ plant: '1150', warehouse: 'W15' });
      expect(w01.isPickable('EN1')).toBe(true);
      expect(w15.isPickable('EN1')).toBe(false);
      expect(w15.isOnHold('EN1')).toBe(true);
      expect(await adapter.getStorageTypeRules({ plant: '1120', warehouse: 'W01' })).toBe(w01);
    });

    it('getStorageBins evaluates bins with the rules of the reservation warehouse (W15), not W01', async () => {
      jest.spyOn(adapter, 'getCockpitDetail').mockResolvedValue({
        Material: '8000009803', Plant: '1150', StorageLocation: 'CS02', Warehouse: 'W15', PreferredStorageType: ''
      });
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'LQUA') return Promise.resolve([{ LGNUM: 'W15', LGTYP: 'EN1', LGPLA: '1-L0002-01', LGORT: 'CS02', LENUM: '00000000002000019900', CHARG: '', GESME: '4.000', MEINS: 'NOS', LETYP: 'E10', KZHUQ: 'X' }]);
        return Promise.resolve([]);
      });
      const bins = await adapter.getStorageBins('520235', '1');
      expect(bins).toHaveLength(1);
      expect(bins[0].StorageStatus).toBe('On-Hold');
      expect(bins[0].Warehouse).toBe('W15');
    });
  });

  describe('rackLayout', () => {
    it('marks 1-L0001-04 occupied with handling unit details', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'LAGP') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LGBER: 'IT1', LPTYP: '04' }
          ]);
        }
        if (table === 'LQUA') {
          return Promise.resolve([
            {
              LGNUM: 'W01',
              LGTYP: 'EN1',
              LGPLA: '1-L0001-04',
              LGORT: 'CS02',
              LENUM: '00000000002000019372',
              CHARG: '',
              GESME: '1.000',
              MEINS: 'NOS',
              LETYP: 'E10',
              KZHUQ: 'X',
              MATNR: '000000008000009754'
            }
          ]);
        }
        if (table === 'T302T') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGBER: 'IT1', SPRAS: 'E', LBERT: 'Blue' }
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.rackLayout({ warehouse: 'W01', storageType: 'EN1', rackPrefix: '1-L0001' });

      expect(res.Cells).toHaveLength(1);
      const cell = res.Cells[0];
      expect(cell.StorageBin).toBe('1-L0001-04');
      expect(cell.Occupied).toBe(true);
      expect(cell.Status).toBe('occupied');
      expect(cell.UnitNumber).toBe('2000019372');
      expect(cell.UnitCategory).toBe('HU');
      expect(cell.AvailableStock).toBe(1);
      expect(cell.BaseUnit).toBe('NOS');
      expect(cell.BinType).toBe('04');
      expect(cell.SectionCode).toBe('IT1');
      expect(cell.SectionName).toBe('Blue');
      expect(cell.IsRackBin).toBe(true);
    });

    it('marks maintained bins without quants as empty and enforces exactly two cell states (no unmaintained state)', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'LAGP') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-01', LGBER: 'IT3', LPTYP: '01' },
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LGBER: 'IT1', LPTYP: '04' }
          ]);
        }
        if (table === 'LQUA') {
          return Promise.resolve([
            {
              LGNUM: 'W01',
              LGTYP: 'EN1',
              LGPLA: '1-L0001-04',
              LGORT: 'CS02',
              LENUM: '00000000002000019372',
              CHARG: '',
              GESME: '1.000',
              MEINS: 'NOS',
              LETYP: 'E10',
              KZHUQ: 'X',
              MATNR: '000000008000009754'
            }
          ]);
        }
        if (table === 'T302T') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGBER: 'IT3', SPRAS: 'E', LBERT: 'Orange' },
            { LGNUM: 'W01', LGTYP: 'EN1', LGBER: 'IT1', SPRAS: 'E', LBERT: 'Blue' }
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.rackLayout({ warehouse: 'W01', storageType: 'EN1', rackPrefix: '1-L0001' });

      expect(res.Cells).toHaveLength(2);
      const emptyCell = res.Cells.find((c) => c.StorageBin === '1-L0001-01');
      const occupiedCell = res.Cells.find((c) => c.StorageBin === '1-L0001-04');

      expect(emptyCell.Occupied).toBe(false);
      expect(emptyCell.Status).toBe('empty');
      expect(emptyCell.UnitNumber).toBe('');
      expect(emptyCell.AvailableStock).toBe(0);
      expect(emptyCell.IsRackBin).toBe(true);

      expect(occupiedCell.Occupied).toBe(true);
      expect(occupiedCell.Status).toBe('occupied');

      // Only two cell states allowed: 'empty' and 'occupied'
      for (const cell of res.Cells) {
        expect(['empty', 'occupied']).toContain(cell.Status);
        expect(cell.Status).not.toBe('no bin maintained');
      }
    });

    it('places non-rack bin 921/TRANSFER into separate NonRackBins list and not in Cells', async () => {
      mockRfc.readTable.mockImplementation((table, _fields, _where) => {
        if (table === 'LAGP') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LGBER: 'IT1', LPTYP: '04' }
          ]);
        }
        if (table === 'LQUA') {
          // Both 1-L0001-04 and non-rack 921/TRANSFER
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-04', LENUM: '2000019372', GESME: '1.000', MEINS: 'NOS', KZHUQ: 'X', MATNR: '8000009754' },
            { LGNUM: 'W01', LGTYP: '921', LGPLA: 'TRANSFER', LENUM: '', GESME: '25.000', MEINS: 'NOS', KZHUQ: '', MATNR: '8000009754' }
          ]);
        }
        if (table === 'T301T') {
          return Promise.resolve([{ LGNUM: 'W01', LGTYP: '921', LTYPT: 'Stock Transfers (StLoc)' }]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.rackLayout({
        warehouse: 'W01',
        storageType: 'EN1',
        rackPrefix: '1-L0001'
      });

      // Cells must only contain rack bins
      expect(res.Cells.every((c) => c.IsRackBin === true)).toBe(true);
      expect(res.Cells.some((c) => c.StorageBin === 'TRANSFER')).toBe(false);

      // NonRackBins must contain the non-rack transfer bin
      expect(res.NonRackBins.length).toBeGreaterThanOrEqual(1);
      const transferBin = res.NonRackBins.find((b) => b.StorageBin === 'TRANSFER' && b.StorageType === '921');
      expect(transferBin).toBeDefined();
      expect(transferBin.IsRackBin).toBe(false);
      expect(transferBin.AvailableStock).toBe(25);
      expect(transferBin.StorageTypeDesc).toBe('Stock Transfers (StLoc)');
    });

    it('excludes negative quants (e.g. 1.000- in 922/TR-ZONE) from available stock and occupancy', async () => {
      mockRfc.readTable.mockImplementation((table) => {
        if (table === 'LAGP') {
          return Promise.resolve([
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-01', LGBER: 'IT3', LPTYP: '01' }
          ]);
        }
        if (table === 'LQUA') {
          return Promise.resolve([
            // Negative quant on 1-L0001-01
            { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-01', LENUM: '', GESME: '5.000-', MEINS: 'NOS', KZHUQ: '', MATNR: '8000009754' },
            // Negative quant on 922/TR-ZONE
            { LGNUM: 'W01', LGTYP: '922', LGPLA: 'TR-ZONE', LENUM: '', GESME: '1.000-', MEINS: 'NOS', KZHUQ: '', MATNR: '8000009754' }
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.rackLayout({ warehouse: 'W01', storageType: 'EN1', rackPrefix: '1-L0001' });

      // Negative quant must NOT mark bin occupied
      const bin1 = res.Cells.find((c) => c.StorageBin === '1-L0001-01');
      expect(bin1.Occupied).toBe(false);
      expect(bin1.Status).toBe('empty');
      expect(bin1.AvailableStock).toBe(0);

      // Negative quant on 922/TR-ZONE must NOT appear in NonRackBins with negative or positive stock
      expect(res.NonRackBins.some((b) => b.StorageBin === 'TR-ZONE')).toBe(false);
    });

    it('handles RFC_READ_TABLE row limit with deterministic ROWCOUNT and ROWSKIPS paging', async () => {
      // 75 LAGP bins across 2 pages (page 0: 50 rows, page 1: 25 rows) with pageSize = 50
      const page0 = Array.from({ length: 50 }, (_, i) => ({
        LGNUM: 'W01',
        LGTYP: 'EN1',
        LGPLA: `1-L0001-${String(i + 1).padStart(2, '0')}`,
        LGBER: 'IT1',
        LPTYP: '01'
      }));
      const page1 = Array.from({ length: 25 }, (_, i) => ({
        LGNUM: 'W01',
        LGTYP: 'EN1',
        LGPLA: `1-L0001-${String(i + 51).padStart(2, '0')}`,
        LGBER: 'IT1',
        LPTYP: '01'
      }));

      const readCalls = [];
      mockRfc.readTable.mockImplementation((table, fields, where, rowCount, rowSkips) => {
        if (table === 'LAGP') {
          readCalls.push({ rowCount, rowSkips });
          if (rowSkips === 0) return Promise.resolve(page0);
          if (rowSkips === 50) return Promise.resolve(page1);
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.rackLayout({ warehouse: 'W01', storageType: 'EN1', rackPrefix: '1-L0001', pageSize: 50 });

      expect(readCalls).toEqual([
        { rowCount: 50, rowSkips: 0 },
        { rowCount: 50, rowSkips: 50 }
      ]);
      expect(res.Cells).toHaveLength(75);
      expect(res.Cells[0].StorageBin).toBe('1-L0001-01');
      expect(res.Cells[74].StorageBin).toBe('1-L0001-75');
    });

    it('falls back to keyset paging when ROWSKIPS is unsupported or throws', async () => {
      const page0 = [
        { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-01', LGBER: 'IT1', LPTYP: '01' }
      ];
      const page1 = [
        { LGNUM: 'W01', LGTYP: 'EN1', LGPLA: '1-L0001-02', LGBER: 'IT1', LPTYP: '01' }
      ];

      mockRfc.readTable.mockImplementation((table, fields, where, rowCount, rowSkips) => {
        if (table === 'LAGP') {
          if (rowSkips !== undefined && rowSkips !== 0) {
            return Promise.reject(new Error('ROWSKIPS unsupported'));
          }
          if (where.some((w) => w.includes('>'))) {
            const hasPrev = where.some((w) => w.includes("'1-L0001-01'"));
            return Promise.resolve(hasPrev ? page1 : []);
          }
          return Promise.resolve(page0);
        }
        return Promise.resolve([]);
      });

      const res = await adapter.rackLayout({ warehouse: 'W01', storageType: 'EN1', rackPrefix: '1-L0001', pageSize: 1 });
      expect(res.Cells.map((c) => c.StorageBin)).toEqual(['1-L0001-01', '1-L0001-02']);
    });
  });
});
