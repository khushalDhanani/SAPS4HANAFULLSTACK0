'use strict';

const HuStockTransferAdapter = require('../../../srv/integration/s4hana/wm/HuStockTransferAdapter');

describe('HuStockTransferAdapter (ZRF_RES_HU_DNR)', () => {
  let adapter;
  let mockRfc;

  beforeEach(() => {
    mockRfc = {
      readTable: jest.fn(),
      call: jest.fn()
    };
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

    it('rejects with 404 when reservation is not found', async () => {
      mockRfc.readTable.mockResolvedValue([]);
      await expect(adapter.getCockpitDetail('99999', '1')).rejects.toThrow('not found');
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
    });

    it('returns cached result on idempotent retry without re-calling SAP', async () => {
      mockRfc.readTable.mockResolvedValue([{ WERKS: '1120', LGORT: 'CS02', XHUPF: '' }]);
      mockRfc.call.mockResolvedValue({ GOODSMVT_HEADRET: { MAT_DOC: '4900012345', DOC_YEAR: '2026' } });

      const res1 = await adapter.executeHuStockTransfer({
        ReservationNo: '10042',
        ReservationItem: '1',
        UnitNumber: '2000019371',
        TransferQty: 50,
        ClientAttemptId: 'idempotent-key-42'
      });

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

    it('generates multi-level visual rack structure (B0 to B6)', async () => {
      const rack = await adapter.getVisualRack('10042', '1');
      expect(rack.length).toBe(2);
      expect(rack[0].LevelCode).toBe('B4');
      expect(rack[0].LevelNumber).toBe(4);
      expect(rack[0].ShelfLevelDesc).toContain('Shelf Level 4');
    });
  });
});
