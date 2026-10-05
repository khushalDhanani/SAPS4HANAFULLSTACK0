/**
 * goodsIssue261SuScan.test.js
 * Comprehensive tests for Goods Issue 261 Storage Unit (SU) scan-to-complete workflow:
 *  1. 6-drum case with unequal weights
 *  2. 8-drum case with unequal weights
 *  3. Partial last drum
 *  4. Duplicate scan prevention (frontend & server-side)
 *  5. Wrong SU detection (material, plant, storage location, invalid)
 *  6. Over-issue blocking (frontend & server-side)
 *  7. Tampered payload detection (server-side HTTP 400 without queueing)
 *  8. Under-issue detection
 *  9. No SU data gap reporting
 */

const cds = require('@sap/cds');
const GoodsIssue261Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue261Model');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const GoodsIssueIssuedSuStore = require('../../../srv/wm/goods-issue/GoodsIssueIssuedSuStore');
const { ATTEMPT_ENTITY } = GoodsIssueAttemptStore;
const { DELETE } = cds.ql;

describe('GoodsIssue261Model: SU Scanning & Drum Weight Calculations', () => {

  describe('calculateSuggestedUnits', () => {
    it('handles 6-drum case with unequal weights without assuming fixed weight', () => {
      const available = [
        { StorageUnit: 'SU01', AvailableStock: 75, Unit: 'KG', Batch: 'B01', StorageBin: '01-01' },
        { StorageUnit: 'SU02', AvailableStock: 85, Unit: 'KG', Batch: 'B01', StorageBin: '01-02' },
        { StorageUnit: 'SU03', AvailableStock: 90, Unit: 'KG', Batch: 'B01', StorageBin: '01-03' },
        { StorageUnit: 'SU04', AvailableStock: 65, Unit: 'KG', Batch: 'B01', StorageBin: '01-04' },
        { StorageUnit: 'SU05', AvailableStock: 110, Unit: 'KG', Batch: 'B01', StorageBin: '01-05' },
        { StorageUnit: 'SU06', AvailableStock: 55, Unit: 'KG', Batch: 'B01', StorageBin: '01-06' },
        { StorageUnit: 'SU07', AvailableStock: 80, Unit: 'KG', Batch: 'B01', StorageBin: '01-07' }
      ];
      // 75 + 85 + 90 + 65 + 110 + 55 = 480
      const suggested = GoodsIssue261Model.calculateSuggestedUnits(available, 480);
      expect(suggested).toHaveLength(6);
      expect(suggested.map(s => s.StorageUnit)).toEqual(['SU01', 'SU02', 'SU03', 'SU04', 'SU05', 'SU06']);
      const total = suggested.reduce((sum, s) => sum + s.AvailableStock, 0);
      expect(total).toBe(480);
    });

    it('handles 8-drum case with unequal weights without assuming fixed weight', () => {
      const available = [
        { StorageUnit: 'DRUM01', AvailableStock: 52, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM02', AvailableStock: 68, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM03', AvailableStock: 55, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM04', AvailableStock: 65, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM05', AvailableStock: 60, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM06', AvailableStock: 58, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM07', AvailableStock: 62, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM08', AvailableStock: 60, Unit: 'KG', Batch: 'B02' },
        { StorageUnit: 'DRUM09', AvailableStock: 100, Unit: 'KG', Batch: 'B02' }
      ];
      // 52+68+55+65+60+58+62+60 = 480
      const suggested = GoodsIssue261Model.calculateSuggestedUnits(available, 480);
      expect(suggested).toHaveLength(8);
      expect(suggested.map(s => s.StorageUnit)).toEqual([
        'DRUM01', 'DRUM02', 'DRUM03', 'DRUM04', 'DRUM05', 'DRUM06', 'DRUM07', 'DRUM08'
      ]);
      const total = suggested.reduce((sum, s) => sum + s.AvailableStock, 0);
      expect(total).toBe(480);
    });

    it('handles partial last drum case correctly', () => {
      const available = [
        { StorageUnit: 'D1', AvailableStock: 100, Unit: 'KG' },
        { StorageUnit: 'D2', AvailableStock: 100, Unit: 'KG' },
        { StorageUnit: 'D3', AvailableStock: 100, Unit: 'KG' },
        { StorageUnit: 'D4', AvailableStock: 100, Unit: 'KG' },
        { StorageUnit: 'D5', AvailableStock: 80, Unit: 'KG' } // partial last drum
      ];
      // 4 x 100 + 1 x 80 = 480
      const suggested = GoodsIssue261Model.calculateSuggestedUnits(available, 480);
      expect(suggested).toHaveLength(5);
      expect(suggested[4].AvailableStock).toBe(80);
      const total = suggested.reduce((sum, s) => sum + s.AvailableStock, 0);
      expect(total).toBe(480);
    });
  });

  describe('applyScanResolution & validate', () => {
    const makeBaseData = (requiredQty = 480) => {
      const data = GoodsIssue261Model.getInitialData();
      data.reservationNo = '480962';
      data.reservationItem = '0001';
      data.material = '1000000264';
      data.plant = '1110';
      data.storageLocation = 'CS01';
      data.quantity = requiredQty;
      data.openQty = requiredQty;
      data.unit = 'KG';
      data.scanEnabled = true;
      data.requiredScanCount = requiredQty;
      data.batch = 'IN26000905';
      data.isBatchManaged = true;
      data.fromReservation = true;
      return data;
    };

    it('6-drum case: scans 6 unequal drums, updates progress and enables completion', () => {
      const data = makeBaseData(480);
      const drums = [
        { su: 'SU01', qty: 75 },
        { su: 'SU02', qty: 85 },
        { su: 'SU03', qty: 90 },
        { su: 'SU04', qty: 65 },
        { su: 'SU05', qty: 110 },
        { su: 'SU06', qty: 55 }
      ];

      for (let i = 0; i < drums.length; i++) {
        const d = drums[i];
        const res = GoodsIssue261Model.applyScanResolution(data, {
          SuExists: true,
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          SuStockQty: d.qty,
          BaseUnit: 'KG',
          DeterminedBatch: 'IN26000905'
        }, d.su);
        expect(res.ok).toBe(true);
        expect(res.state).toBe('Success');
      }

      expect(data.scannedUnits).toHaveLength(6);
      expect(GoodsIssue261Model.scannedQty(data)).toBe(480);

      const val = GoodsIssue261Model.validate(data);
      expect(val.isValid).toBe(true);
      expect(val.errors.scannedUnits).toBe('');

      const payload = GoodsIssue261Model.toBackendPayload(data);
      expect(payload.StorageUnits).toEqual(['SU01', 'SU02', 'SU03', 'SU04', 'SU05', 'SU06']);
      expect(payload.IssueQty).toBe(480);
    });

    it('8-drum case: scans 8 unequal drums and reaches exact completion', () => {
      const data = makeBaseData(480);
      const drums = [
        { su: 'D1', qty: 52 }, { su: 'D2', qty: 68 }, { su: 'D3', qty: 55 }, { su: 'D4', qty: 65 },
        { su: 'D5', qty: 60 }, { su: 'D6', qty: 58 }, { su: 'D7', qty: 62 }, { su: 'D8', qty: 60 }
      ];

      for (const d of drums) {
        const res = GoodsIssue261Model.applyScanResolution(data, {
          SuExists: true,
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          SuStockQty: d.qty,
          BaseUnit: 'KG',
          DeterminedBatch: 'IN26000905'
        }, d.su);
        expect(res.ok).toBe(true);
      }

      expect(GoodsIssue261Model.scannedQty(data)).toBe(480);
      const val = GoodsIssue261Model.validate(data);
      expect(val.isValid).toBe(true);
      expect(val.errors.scannedUnits).toBe('');
    });

    it('blocks duplicate scan and preserves single entry', () => {
      const data = makeBaseData(480);
      const res1 = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        SuStockQty: 75,
        DeterminedBatch: 'IN26000905'
      }, 'SU01');
      expect(res1.ok).toBe(true);

      const res2 = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        SuStockQty: 75,
        DeterminedBatch: 'IN26000905'
      }, 'SU01');
      expect(res2.ok).toBe(false);
      expect(res2.state).toBe('Warning');
      expect(res2.text).toMatch(/already scanned/i);
      expect(data.scannedUnits).toHaveLength(1);
    });

    it('rejects wrong material with clear error message', () => {
      const data = makeBaseData(480);
      const res = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '9999999999',
        Plant: '1110',
        StorageLocation: 'CS01',
        SuStockQty: 80
      }, 'SU_WRONG_MAT');
      expect(res.ok).toBe(false);
      expect(res.state).toBe('Error');
      expect(res.text).toContain('Wrong material: scanned unit belongs to 9999999999, expected 1000000264.');
      expect(data.scannedUnits).toHaveLength(0);
    });

    it('rejects wrong storage location with clear error message', () => {
      const data = makeBaseData(480);
      const res = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'WR01',
        SuStockQty: 80
      }, 'SU_WRONG_SLOC');
      expect(res.ok).toBe(false);
      expect(res.state).toBe('Error');
      expect(res.text).toContain('Wrong storage location: scanned unit is in storage location WR01, expected CS01.');
      expect(data.scannedUnits).toHaveLength(0);
    });

    it('rejects wrong plant with clear error message', () => {
      const data = makeBaseData(480);
      const res = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '2000',
        StorageLocation: 'CS01',
        SuStockQty: 80
      }, 'SU_WRONG_PLANT');
      expect(res.ok).toBe(false);
      expect(res.state).toBe('Error');
      expect(res.text).toContain('Wrong plant: scanned unit is in plant 2000, expected 1110.');
      expect(data.scannedUnits).toHaveLength(0);
    });

    it('caps last SU at remaining open qty and blocks subsequent scans as over-issue', () => {
      const data = makeBaseData(480);
      // Already scanned 400 KG
      data.scannedUnits = [
        { key: 'S1', storageUnit: 'S1', barcode: 'S1', material: '1000000264', plant: '1110', storageLocation: 'CS01', qty: 400, isSerial: false }
      ];

      // Scanning 100 KG drum when only 80 KG is needed: caps at 80 KG (partial last drum)
      const res = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        SuStockQty: 100,
        DeterminedBatch: 'IN26000905'
      }, 'SU_PARTIAL');

      expect(res.ok).toBe(true);
      expect(res.state).toBe('Success');
      expect(res.text).toContain('partial 80 of 100');
      expect(data.scannedUnits).toHaveLength(2);
      expect(GoodsIssue261Model.scannedQty(data)).toBe(480);
      expect(data.scannedUnits[1].isPartial).toBe(true);
      expect(data.scannedUnits[1].qty).toBe(80);

      // Now requirement is met: scanning another drum is blocked
      const resOver = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        SuStockQty: 50,
        DeterminedBatch: 'IN26000905'
      }, 'SU_EXTRA');

      expect(resOver.ok).toBe(false);
      expect(resOver.state).toBe('Warning');
      expect(resOver.text).toContain('Quantity exceeded: 480 already covered');
      expect(data.scannedUnits).toHaveLength(2);
    });

    it('validate blocks completion when scanned sum is under required quantity', () => {
      const data = makeBaseData(480);
      data.scannedUnits = [
        { key: 'S1', storageUnit: 'S1', barcode: 'S1', material: '1000000264', plant: '1110', storageLocation: 'CS01', qty: 300, isSerial: false }
      ];

      const val = GoodsIssue261Model.validate(data);
      expect(val.isValid).toBe(false);
      expect(val.errors.scannedUnits).toContain('Required 480 units scanned, currently 300');
    });
  });
});

describe('Server-Side postGoodsIssue261: Storage Unit Reconciliation', () => {
  let handlers = {};

  beforeAll(() => {
    const srv = {
      on: jest.fn((action, fn) => {
        handlers[action] = fn;
      })
    };
    PerTypeGoodsIssueHandler.init(srv);
  });

  beforeEach(async () => {
    if (GoodsIssueAttemptStore.db) {
      await GoodsIssueAttemptStore.db.run(DELETE.from(ATTEMPT_ENTITY));
    }
    GoodsIssueAttemptStore.clearMemoryStore();
    await GoodsIssueIssuedSuStore.clear();
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (GoodsIssueAttemptStore.db) {
      await GoodsIssueAttemptStore.db.run(DELETE.from(ATTEMPT_ENTITY));
    }
    GoodsIssueAttemptStore.clearMemoryStore();
    await GoodsIssueIssuedSuStore.clear();
  });

  const setupMockSap = ({ openQty = 480, stockUnits = [] } = {}) => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      ReservationNo: '480962',
      ReservationItem: '0001',
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      Batch: 'IN26000905',
      OpenQty: openQty,
      RequiredQty: openQty
    });

    const sapStockUnits = stockUnits.map((su) => ({
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      Batch: 'IN26000905',
      Warehouse: 'W01',
      StorageType: 'IP1',
      StorageBin: '0000001001',
      ...su
    }));
    return jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
      ReservationNo: '480962',
      ReservationItem: '0001',
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      StockUnits: sapStockUnits,
      IsStagingRequired: false,
      IsFullyStaged: true
    });
  };

  it('revalidates SAP reservation and selected SUs after claims and immediately before posting', async () => {
    const listStockUnits = setupMockSap({
      openQty: 100,
      stockUnits: [{ StorageUnit: 'SU100', AvailableStock: 100 }]
    });
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockImplementation(async () => {
      expect(listStockUnits).toHaveBeenCalledTimes(2);
      expect(listStockUnits).toHaveBeenLastCalledWith('480962', '0001', {
        excludeReferenceDocument: expect.any(String)
      });
      const claims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('1000000264', '1110', 'CS01');
      expect(claims).toHaveLength(1);
      expect(claims[0].Status).toBe('claiming');
      return { MaterialDocument: '4900012369', MaterialDocYear: '2026' };
    });

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 70,
        Unit: 'KG',
        StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    const result = await handlers['postGoodsIssue261'](req);
    expect(result.MaterialDocument).toBe('4900012369');
    expect(post).toHaveBeenCalledTimes(1);
    expect(req.error).not.toHaveBeenCalled();
  });

  it('allows an SU partial issue when staging covers the issue quantity even if the full open quantity is not staged', async () => {
    // IsFullyStaged (full open qty) is false, but the staging engine confirms the issue qty.
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      ReservationNo: '480962', ReservationItem: '0001', Material: '1000000264', Plant: '1110',
      StorageLocation: 'CS01', Batch: 'IN26000905', OpenQty: 100, RequiredQty: 100
    });
    jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
      ReservationNo: '480962', ReservationItem: '0001', Material: '1000000264', Plant: '1110',
      StorageLocation: 'CS01',
      StockUnits: [{
        Material: '1000000264', Plant: '1110', StorageLocation: 'CS01', Batch: 'IN26000905',
        Warehouse: 'W01', StorageType: 'IP1', StorageBin: '0000001001',
        StorageUnit: 'SU100', AvailableStock: 40
      }],
      IsStagingRequired: true,
      IsFullyStaged: false,
      TargetStorageType: 'IP1',
      TargetStorageBin: '0000001001'
    });
    const stagingSpy = jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation')
      .mockResolvedValue({ isVerified: true, isStaged: true, stagingStatus: 'OK' });
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261')
      .mockResolvedValue({ MaterialDocument: '4900012370', MaterialDocYear: '2026' });

    const req = {
      data: {
        ReservationNo: '480962', ReservationItem: '0001', Material: '1000000264',
        Plant: '1110', StorageLocation: 'CS01', IssueQty: 40, Unit: 'KG', StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    const result = await handlers['postGoodsIssue261'](req);
    expect(req.error).not.toHaveBeenCalled();
    expect(result.MaterialDocument).toBe('4900012370');
    expect(post).toHaveBeenCalledTimes(1);
    // The final reconcile re-verifies staging for the ISSUE quantity, not the open quantity.
    expect(stagingSpy).toHaveBeenLastCalledWith('480962', '0001', { issueQty: 40, issueUnit: 'KG' });
  });

  it('blocks posting with 422 when the final staging re-check no longer covers the issue quantity', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      ReservationNo: '480962', ReservationItem: '0001', Material: '1000000264', Plant: '1110',
      StorageLocation: 'CS01', Batch: 'IN26000905', OpenQty: 100, RequiredQty: 100
    });
    jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
      ReservationNo: '480962', ReservationItem: '0001', Material: '1000000264', Plant: '1110',
      StorageLocation: 'CS01',
      StockUnits: [{
        Material: '1000000264', Plant: '1110', StorageLocation: 'CS01', Batch: 'IN26000905',
        Warehouse: 'W01', StorageType: 'IP1', StorageBin: '0000001001',
        StorageUnit: 'SU100', AvailableStock: 40
      }],
      IsStagingRequired: true,
      IsFullyStaged: false,
      TargetStorageType: 'IP1',
      TargetStorageBin: '0000001001'
    });
    // Pre-check passes, the final re-check finds the staged stock gone.
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation')
      .mockResolvedValueOnce({ isVerified: true, isStaged: true, stagingStatus: 'OK' })
      .mockResolvedValueOnce({ isVerified: true, isStaged: false, stagingStatus: 'NOT_STAGED', error: 'Only 0 of 40 KG staged in W01/IP1/0000001001.' });
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = {
      data: {
        ReservationNo: '480962', ReservationItem: '0001', Material: '1000000264',
        Plant: '1110', StorageLocation: 'CS01', IssueQty: 40, Unit: 'KG', StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn((status, message) => ({ status, message }))
    };

    await handlers['postGoodsIssue261'](req);
    expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('staged'));
    expect(post).not.toHaveBeenCalled();
  });

  it('does not post if final SU audit evidence cannot be persisted', async () => {
    setupMockSap({
      openQty: 100,
      stockUnits: [{ StorageUnit: 'SU100', AvailableStock: 100 }]
    });
    jest.spyOn(GoodsIssueIssuedSuStore, 'updateClaimEvidence').mockRejectedValue(new Error('audit store unavailable'));
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 70,
        Unit: 'KG',
        StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn((status, message) => ({ status, message }))
    };

    const result = await handlers['postGoodsIssue261'](req);
    expect(req.error).toHaveBeenCalledWith(503, expect.stringContaining('audit evidence could not be persisted'));
    expect(post).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(await GoodsIssueIssuedSuStore.getActiveIssuedSUs('1000000264', '1110', 'CS01')).toHaveLength(0);
  });

  it.each([
    ['the SU disappeared', () => ({ StockUnits: [] })],
    ['the usable quantity shrank', (unit) => ({ StockUnits: [{ ...unit, AvailableStock: 69 }] })],
    ['the batch changed', (unit) => ({ StockUnits: [{ ...unit, Batch: 'OTHER-BATCH' }] })],
    ['the material changed', (unit) => ({ StockUnits: [{ ...unit, Material: 'OTHER-MATERIAL' }] })],
    ['the confirmed staging bin changed', (unit) => ({
      IsStagingRequired: true,
      IsFullyStaged: true,
      TargetStorageType: 'IP1',
      TargetStorageBin: '0000001001',
      StockUnits: [{ ...unit, StorageBin: '0000002002' }]
    })]
  ])('blocks and releases claims when %s between allocation and posting', async (_change, makeChange) => {
    const initialUnit = {
      StorageUnit: 'SU100',
      AvailableStock: 100,
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      Batch: 'IN26000905',
      Warehouse: 'W01',
      StorageType: 'IP1',
      StorageBin: '0000001001'
    };
    const listStockUnits = setupMockSap({ openQty: 100, stockUnits: [initialUnit] });
    const initialRead = {
      ReservationNo: '480962',
      ReservationItem: '0001',
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      StockUnits: [initialUnit],
      IsStagingRequired: false,
      IsFullyStaged: true
    };
    listStockUnits
      .mockResolvedValueOnce(initialRead)
      .mockResolvedValueOnce({
        ...initialRead,
        ...makeChange(initialUnit)
      });
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 70,
        Unit: 'KG',
        StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);

    expect(listStockUnits).toHaveBeenCalledTimes(2);
    expect(req.error).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(await GoodsIssueIssuedSuStore.getActiveIssuedSUs('1000000264', '1110', 'CS01')).toHaveLength(0);
  });

  it.each([
    ['reservation batch changed', { Batch: 'NEW-BATCH', OpenQty: 100 }, 'NEW-BATCH'],
    ['reservation open quantity shrank', { Batch: 'IN26000905', OpenQty: 60 }, 'IN26000905']
  ])('blocks and releases claims when the %s before final validation', async (_change, freshValues, freshBatch) => {
    const initialReservation = {
      ReservationNo: '480962',
      ReservationItem: '0001',
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      Batch: 'IN26000905',
      OpenQty: 100,
      RequiredQty: 100
    };
    const getReservation = jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative')
      .mockResolvedValueOnce(initialReservation)
      .mockResolvedValueOnce({ ...initialReservation, ...freshValues });
    const initialUnit = {
      StorageUnit: 'SU100',
      AvailableStock: 100,
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      Batch: 'IN26000905',
      Warehouse: 'W01',
      StorageType: 'IP1',
      StorageBin: '0000001001'
    };
    const initialRead = {
      ReservationNo: '480962',
      ReservationItem: '0001',
      Material: '1000000264',
      Plant: '1110',
      StorageLocation: 'CS01',
      StockUnits: [initialUnit],
      IsStagingRequired: false,
      IsFullyStaged: true
    };
    const listStockUnits = jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem')
      .mockResolvedValueOnce(initialRead)
      .mockResolvedValueOnce({
        ...initialRead,
        StockUnits: [{ ...initialUnit, Batch: freshBatch }]
      });
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 70,
        Unit: 'KG',
        StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);

    expect(getReservation).toHaveBeenCalledTimes(2);
    expect(listStockUnits).toHaveBeenCalledTimes(2);
    expect(req.error).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(await GoodsIssueIssuedSuStore.getActiveIssuedSUs('1000000264', '1110', 'CS01')).toHaveLength(0);
  });

  it('allocates the requested partial quantity from a larger SAP storage unit', async () => {
    setupMockSap({
      openQty: 100,
      stockUnits: [{ StorageUnit: 'SU100', AvailableStock: 100, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' }]
    });
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900012370',
      MaterialDocYear: '2026'
    });

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 70,
        Unit: 'KG',
        StorageUnits: ['SU100']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    const result = await handlers['postGoodsIssue261'](req);
    expect(req.error).not.toHaveBeenCalled();
    expect(result.MaterialDocument).toBe('4900012370');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ IssueQty: 70 }));

    const claims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('1000000264', '1110', 'CS01');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      StorageUnit: 'SU100',
      IssuedQty: 70,
      PreIssueStock: 100,
      Batch: 'IN26000905',
      Warehouse: 'W01',
      StorageType: 'IP1',
      StorageBin: '0000001001',
      MultipleBatches: false,
      Status: 'issued',
      MaterialDocument: '4900012370'
    });
    expect(claims[0].ReferenceDocument).toBeTruthy();
    expect(claims[0].EvidenceCapturedAt).toEqual(expect.any(String));
  });

  it('allocates 30 and 40 from two SAP storage units for a 70-unit issue', async () => {
    setupMockSap({
      openQty: 100,
      stockUnits: [
        { StorageUnit: 'SU30', AvailableStock: 30, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
        { StorageUnit: 'SU40', AvailableStock: 40, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' }
      ]
    });
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900012371',
      MaterialDocYear: '2026'
    });

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 70,
        Unit: 'KG',
        StorageUnits: ['SU40', 'SU30']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    const result = await handlers['postGoodsIssue261'](req);
    expect(req.error).not.toHaveBeenCalled();
    expect(result.MaterialDocument).toBe('4900012371');

    const claims = await GoodsIssueIssuedSuStore.getActiveIssuedSUs('1000000264', '1110', 'CS01');
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => [claim.StorageUnit, claim.IssuedQty]).sort()).toEqual([
      ['SU30', 30],
      ['SU40', 40]
    ]);
  });

  it('posts 6-drum case with unequal weights when SUs match SAP stock and sum equals required', async () => {
    const stock = [
      { StorageUnit: 'SU01', AvailableStock: 75, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
      { StorageUnit: 'SU02', AvailableStock: 85, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
      { StorageUnit: 'SU03', AvailableStock: 90, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
      { StorageUnit: 'SU04', AvailableStock: 65, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
      { StorageUnit: 'SU05', AvailableStock: 110, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
      { StorageUnit: 'SU06', AvailableStock: 55, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' }
    ];
    setupMockSap({ openQty: 480, stockUnits: stock });

    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900012345',
      MaterialDocYear: '2026'
    });

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 480,
        Unit: 'KG',
        Batch: 'IN26000905',
        StorageUnits: ['SU01', 'SU02', 'SU03', 'SU04', 'SU05', 'SU06']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    const res = await handlers['postGoodsIssue261'](req);
    expect(req.error).not.toHaveBeenCalled();
    expect(res).toBeDefined();
    expect(res.MaterialDocument).toBe('4900012345');
  });

  it('posts 8-drum case with unequal weights', async () => {
    const stock = [
      { StorageUnit: 'D1', AvailableStock: 52 }, { StorageUnit: 'D2', AvailableStock: 68 },
      { StorageUnit: 'D3', AvailableStock: 55 }, { StorageUnit: 'D4', AvailableStock: 65 },
      { StorageUnit: 'D5', AvailableStock: 60 }, { StorageUnit: 'D6', AvailableStock: 58 },
      { StorageUnit: 'D7', AvailableStock: 62 }, { StorageUnit: 'D8', AvailableStock: 60 }
    ];
    setupMockSap({ openQty: 480, stockUnits: stock });

    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900012346',
      MaterialDocYear: '2026'
    });

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 480,
        Unit: 'KG',
        StorageUnits: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    const res = await handlers['postGoodsIssue261'](req);
    expect(req.error).not.toHaveBeenCalled();
    expect(res.MaterialDocument).toBe('4900012346');
  });

  it('returns 400 on duplicate scan in payload without queueing', async () => {
    const stock = [
      { StorageUnit: 'SU01', AvailableStock: 240 },
      { StorageUnit: 'SU02', AvailableStock: 240 }
    ];
    setupMockSap({ openQty: 480, stockUnits: stock });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 480,
        Unit: 'KG',
        StorageUnits: ['SU01', 'SU01'] // duplicate
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Duplicate Storage Unit SU01 in submission'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('returns 400 on wrong SU not in SAP stock without queueing', async () => {
    const stock = [
      { StorageUnit: 'SU01', AvailableStock: 480 }
    ];
    setupMockSap({ openQty: 480, stockUnits: stock });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 480,
        Unit: 'KG',
        StorageUnits: ['SU_INVALID_999']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Storage Unit SU_INVALID_999 is not valid for material'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('returns 400 on tampered payload where IssueQty does not match real SU sum without queueing', async () => {
    const stock = [
      { StorageUnit: 'SU01', AvailableStock: 80 }
    ];
    setupMockSap({ openQty: 480, stockUnits: stock });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 480, // Tampered: client claims 480, but SU01 in SAP is only 80
        Unit: 'KG',
        StorageUnits: ['SU01']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('exceeds the scanned SAP Storage Unit stock allocated by the server'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('returns 400 on over-issue where SU total exceeds open reservation quantity without queueing', async () => {
    const stock = [
      { StorageUnit: 'SU01', AvailableStock: 300 },
      { StorageUnit: 'SU02', AvailableStock: 250 } // Total = 550 > 480
    ];
    setupMockSap({ openQty: 480, stockUnits: stock });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 550,
        Unit: 'KG',
        StorageUnits: ['SU01', 'SU02']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);
    // Blocked either by reservationReconcileCheck or storageUnitReconcileCheck261
    expect(req.error).toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when no SU data exists in SAP for submitted StorageUnits without queueing', async () => {
    setupMockSap({ openQty: 480, stockUnits: [] });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = {
      data: {
        ReservationNo: '480962',
        ReservationItem: '0001',
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        IssueQty: 480,
        Unit: 'KG',
        StorageUnits: ['SU01']
      },
      user: { id: 'TESTUSER' },
      error: jest.fn()
    };

    await handlers['postGoodsIssue261'](req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('No Storage Units exist in SAP'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  describe('Requirement 4 Tests: 450 kg with 48 kg drums, partial above open qty, consumed SU, no queueing', () => {

    it('handles 450 kg with 48 kg drums (9 full + 18 partial) in UI suggestion and scan model', () => {
      // 10 drums of 48 KG each
      const availableDrums = [];
      for (let i = 1; i <= 10; i++) {
        availableDrums.push({
          StorageUnit: `DRUM_${String(i).padStart(2, '0')}`,
          AvailableStock: 48,
          Unit: 'KG',
          Batch: 'B2601'
        });
      }

      // calculateSuggestedUnits: should suggest 10 drums (9 full + 1 partial of 18 KG)
      const suggested = GoodsIssue261Model.calculateSuggestedUnits(availableDrums, 450);
      expect(suggested).toHaveLength(10);
      expect(suggested[8].SuggestedQty).toBe(48);
      expect(suggested[8].IsPartial).toBe(false);
      expect(suggested[9].SuggestedQty).toBe(18);
      expect(suggested[9].IsPartial).toBe(true);
      const totalSuggested = suggested.reduce((sum, d) => sum + d.SuggestedQty, 0);
      expect(totalSuggested).toBe(450);

      // UI scan: scan 9 full drums + 1 partial drum
      const data = GoodsIssue261Model.getInitialData();
      data.reservationNo = '480962';
      data.reservationItem = '0001';
      data.material = '1000000264';
      data.plant = '1110';
      data.storageLocation = 'CS01';
      data.quantity = 450;
      data.openQty = 450;
      data.unit = 'KG';
      data.scanEnabled = true;
      data.requiredScanCount = 450;
      data.batch = 'B2601';
      data.isBatchManaged = true;
      data.fromReservation = true;

      // Scan first 9 drums (48 KG each)
      for (let i = 0; i < 9; i++) {
        const suId = availableDrums[i].StorageUnit;
        const res = GoodsIssue261Model.applyScanResolution(data, {
          SuExists: true,
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          SuStockQty: 48,
          BaseUnit: 'KG',
          DeterminedBatch: 'B2601'
        }, suId);
        expect(res.ok).toBe(true);
        expect(res.state).toBe('Success');
      }
      expect(GoodsIssue261Model.scannedQty(data)).toBe(432); // 9 x 48

      // Scan 10th drum (48 KG): capped at remaining open qty (18 KG)
      const resLast = GoodsIssue261Model.applyScanResolution(data, {
        SuExists: true,
        Material: '1000000264',
        Plant: '1110',
        StorageLocation: 'CS01',
        SuStockQty: 48,
        BaseUnit: 'KG',
        DeterminedBatch: 'B2601'
      }, availableDrums[9].StorageUnit);

      expect(resLast.ok).toBe(true);
      expect(resLast.text).toContain('partial 18 of 48');
      expect(GoodsIssue261Model.scannedQty(data)).toBe(450);
      expect(data.scannedUnits).toHaveLength(10);
      expect(data.scannedUnits[9].isPartial).toBe(true);
      expect(data.scannedUnits[9].qty).toBe(18);

      // Validate enables completion
      const val = GoodsIssue261Model.validate(data);
      expect(val.isValid).toBe(true);

      // Payload includes 10 StorageUnits and explicit LastStorageUnitQty = 18
      const payload = GoodsIssue261Model.toBackendPayload(data);
      expect(payload.StorageUnits).toHaveLength(10);
      expect(payload.LastStorageUnitQty).toBe(18);
      expect(payload.IssueQty).toBe(450);
    });

    it('posts 450 kg with 48 kg drums (9 full + 18 partial) server-side against SAP reservation', async () => {
      const stock = [];
      const suList = [];
      for (let i = 1; i <= 10; i++) {
        const id = `DRUM_${String(i).padStart(2, '0')}`;
        stock.push({ StorageUnit: id, AvailableStock: 48, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        suList.push(id);
      }
      setupMockSap({ openQty: 450, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
        MaterialDocument: '4900099999',
        MaterialDocYear: '2026',
        Confirmed: true
      });

      const req = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 18
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      const res = await handlers['postGoodsIssue261'](req);
      expect(req.error).not.toHaveBeenCalled();
      expect(res).toBeDefined();
      expect(res.MaterialDocument).toBe('4900099999');
      expect(postSpy).toHaveBeenCalled();
    });

    it('rejects partial above open qty', async () => {
      const stock = [];
      const suList = [];
      for (let i = 1; i <= 10; i++) {
        const id = `DRUM_${String(i).padStart(2, '0')}`;
        stock.push({ StorageUnit: id, AvailableStock: 48, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        suList.push(id);
      }
      setupMockSap({ openQty: 450, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

      // 9 full drums = 432. Partial submitted = 25 -> Total = 457 > 450 open qty
      const req = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450, // matches reservation openQty, but last SU partial qty pushes real sum to 457
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 25
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Partial above open qty rejected'));
      expect(postSpy).not.toHaveBeenCalled();
    });

    it('rejects when an SU was consumed between suggest and post without queueing', async () => {
      // 10 drums suggested, but DRUM_05 was consumed in SAP before posting (not in SAP stock or AvailableStock = 0)
      const stock = [];
      const suList = [];
      for (let i = 1; i <= 10; i++) {
        const id = `DRUM_${String(i).padStart(2, '0')}`;
        if (i === 5) {
          // DRUM_05 has 0 available stock in SAP
          stock.push({ StorageUnit: id, AvailableStock: 0, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        } else {
          stock.push({ StorageUnit: id, AvailableStock: 48, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        }
        suList.push(id);
      }
      setupMockSap({ openQty: 450, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

      const req = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 18
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('has no available stock or was consumed in SAP'));
      expect(postSpy).not.toHaveBeenCalled();
    });

    it('confirms no queueing on any 400 error', async () => {
      const stock = [
        { StorageUnit: 'SU01', AvailableStock: 24, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' },
        { StorageUnit: 'SU02', AvailableStock: 24, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' }
      ];
      setupMockSap({ openQty: 48, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

      // Tampered payload: real SUs sum to 48, but client submits IssueQty: 40
      const req = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 40, // Tampered: real sum is 48
          Unit: 'KG',
          StorageUnits: ['SU01', 'SU02'],
          LastStorageUnitQty: 24
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('cannot equal or exceed full stock'));
      expect(postSpy).not.toHaveBeenCalled();
    });

    it('surfaces 400 without queueing when SAP rejects at post time because SU was consumed after re-read', async () => {
      const stock = [];
      const suList = [];
      for (let i = 1; i <= 10; i++) {
        const id = `DRUM_${String(i).padStart(2, '0')}`;
        stock.push({ StorageUnit: id, AvailableStock: 48, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        suList.push(id);
      }
      setupMockSap({ openQty: 450, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockRejectedValue((() => {
        const err = new Error('Deficit of SL Unrestricted-use: Storage Unit DRUM_05 was consumed in SAP');
        err.status = 400;
        return err;
      })());

      const req = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 18
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      await handlers['postGoodsIssue261'](req);
      expect(postSpy).toHaveBeenCalled();
      expect(req.error).toHaveBeenCalledWith(expect.objectContaining({
        code: 'GI_POSTING_FAILED',
        status: 400,
        message: expect.stringContaining('Storage Unit DRUM_05 was consumed in SAP')
      }));
    });

    it('accepts any valid SU set whose sum equals open qty: server picks which SU takes the partial regardless of drum order', async () => {
      const stock = [];
      const suList = [];
      for (let i = 1; i <= 10; i++) {
        const id = `DRUM_${String(i).padStart(2, '0')}`;
        stock.push({ StorageUnit: id, AvailableStock: 48, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        suList.push(id);
      }
      setupMockSap({ openQty: 450, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
        MaterialDocument: '4900099999',
        MaterialDocYear: '2026',
        Confirmed: true
      });

      // 1) Different valid drum order (reversed): client lists DRUM_10 first and DRUM_01 last
      const reversedList = [...suList].reverse();

      const reqReversed = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: reversedList,
          LastStorageUnitQty: 18
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      const resReversed = await handlers['postGoodsIssue261'](reqReversed);
      expect(reqReversed.error).not.toHaveBeenCalled();
      expect(resReversed).toBeDefined();
      expect(resReversed.MaterialDocument).toBe('4900099999');
      expect(resReversed.PostingStatus).toBe('POSTED');
      expect(postSpy).toHaveBeenCalled();

      // 2) Different valid drum order (shuffled / arbitrary scan sequence)
      await GoodsIssueIssuedSuStore.clear();
      postSpy.mockClear();
      const shuffledList = ['DRUM_05', 'DRUM_10', 'DRUM_02', 'DRUM_01', 'DRUM_08', 'DRUM_03', 'DRUM_07', 'DRUM_04', 'DRUM_09', 'DRUM_06'];

      const reqShuffled = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: shuffledList,
          LastStorageUnitQty: 18
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };

      const resShuffled = await handlers['postGoodsIssue261'](reqShuffled);
      expect(reqShuffled.error).not.toHaveBeenCalled();
      expect(resShuffled).toBeDefined();
      expect(resShuffled.MaterialDocument).toBe('4900099999');
      expect(postSpy).toHaveBeenCalled();
    });

    it('server rejects partial quantity <= 0 or >= that SU full stock', async () => {
      const stock = [];
      const suList = [];
      for (let i = 1; i <= 10; i++) {
        const id = `DRUM_${String(i).padStart(2, '0')}`;
        stock.push({ StorageUnit: id, AvailableStock: 48, Material: '1000000264', Plant: '1110', StorageLocation: 'CS01' });
        suList.push(id);
      }
      setupMockSap({ openQty: 450, stockUnits: stock });

      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

      // 1) partial = 0
      const reqZero = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 0
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };
      await handlers['postGoodsIssue261'](reqZero);
      expect(reqZero.error).toHaveBeenCalledWith(400, expect.stringContaining('must be greater than zero'));

      // 2) partial >= full stock (48)
      const reqFull = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 48
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };
      await handlers['postGoodsIssue261'](reqFull);
      expect(reqFull.error).toHaveBeenCalledWith(400, expect.stringContaining('cannot equal or exceed full stock'));

      // 3) partial > full stock (50)
      const reqOver = {
        data: {
          ReservationNo: '480962',
          ReservationItem: '0001',
          Material: '1000000264',
          Plant: '1110',
          StorageLocation: 'CS01',
          IssueQty: 450,
          Unit: 'KG',
          StorageUnits: suList,
          LastStorageUnitQty: 50
        },
        user: { id: 'TESTUSER' },
        error: jest.fn()
      };
      await handlers['postGoodsIssue261'](reqOver);
      expect(reqOver.error).toHaveBeenCalledWith(400, expect.stringContaining('cannot equal or exceed full stock'));

      expect(postSpy).not.toHaveBeenCalled();
    });
  });
});
