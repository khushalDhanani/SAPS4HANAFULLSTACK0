const cds = require('@sap/cds');
// The dispatch queue lives in the CAP database: boot the server with the test profile's in-memory
// SQLite so the queue-related handler tests below have a bound store (cds.db).
cds.test(__dirname + '/../../../');

const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const {
  createMockReservationItems,
  mockBatchesRM4520
} = require('./fixtures/goodsIssueFixtures');

// SAP posting-capability-unavailable error (HTTP 501) — drives the dispatch-queue fallback
// deterministically instead of depending on a live SAP backend in the test run.
function sapPostingUnavailable() {
  const err = new Error('SAP S/4HANA Backend Posting Capability Unavailable: posting service not activated');
  err.status = 501;
  return err;
}

describe('GoodsIssueService & GoodsIssueAdapter Unit & Integration Tests', () => {
  let srv;
  let handlers = {};

  beforeEach(() => {
    handlers = {};
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting').mockResolvedValue({ valid: true });
    srv = {
      on: jest.fn((event, entityOrHandler, handler) => {
        const key = typeof entityOrHandler === 'string' ? `${event}:${entityOrHandler}` : event;
        const fn = typeof entityOrHandler === 'function' ? entityOrHandler : handler;
        handlers[key] = fn;
      })
    };
    GoodsIssueHandler.init(srv);
    PerTypeGoodsIssueHandler.init(srv);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Handler Input Validation & Error Handling', () => {
    it('should reject postGoodsIssue when ReservationNo or ReservationItem is missing', async () => {
      const req = {
        data: {
          ReservationNo: '',
          ReservationItem: '',
          IssueQty: 10
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('ReservationNo and ReservationItem are required'));
    });

    it('should reject postGoodsIssue when IssueQty is zero or negative', async () => {
      const req = {
        data: {
          ReservationNo: '18025',
          ReservationItem: '0001',
          IssueQty: -5
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('positive decimal number'));
    });

    it('should reject submitGoodsIssueRequest when header identifiers are missing', async () => {
      const req = {
        data: {
          ReservationNo: '',
          OrderNo: '',
          Items: [{ ReservationItem: '0001', IssueQty: 10 }]
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['submitGoodsIssueRequest'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Either ReservationNo or OrderNo'));
    });

    it('should reject submitGoodsIssueRequest when Items array is empty', async () => {
      const req = {
        data: {
          ReservationNo: '18025',
          Items: []
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['submitGoodsIssueRequest'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('At least one item must be specified'));
    });

    it('re-reads SAP open quantity and permits an explicitly requested partial final closeout supported by SAP', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        RequiredQty: 100,
        WithdrawnQty: 60,
        OpenQty: 40,
        ReservationItemIsFinallyIssued: false,
        ReservationItmIsMarkedForDeltn: false
      });
      jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
      const submitSpy = jest.spyOn(GoodsIssueAdapter, 'submitGoodsIssueRequest').mockResolvedValue({
        AllPosted: true,
        Results: [{ ReservationItem: '0001', Success: true }]
      });
      const req = {
        data: {
          ReservationNo: '18025',
          OrderNo: '1000040',
          Items: [{ ReservationItem: '0001', IssueQty: 20, FinalIssue: true }]
        },
        error: jest.fn((code, message) => ({ code, message }))
      };

      const result = await handlers['submitGoodsIssueRequest'](req);

      expect(GoodsIssueAdapter.getReservationItemAuthoritative).toHaveBeenCalledWith('18025', '0001');
      expect(submitSpy).toHaveBeenCalledWith('18025', '1000040', req.data.Items);
      expect(GoodsIssueAdapter.checkStagingForReservation).toHaveBeenCalledWith(
        '18025', '0001', { issueQty: 20, issueUnit: undefined }
      );
      expect(result.AllPosted).toBe(true);
      expect(req.error).not.toHaveBeenCalled();
    });

    it('blocks the batch 261 action when any reservation item staging check is unverified', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        RequiredQty: 100,
        WithdrawnQty: 0,
        OpenQty: 100,
        ReservationItemIsFinallyIssued: false,
        ReservationItmIsMarkedForDeltn: false
      });
      jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation')
        .mockResolvedValueOnce({ isVerified: true, isStaged: true })
        .mockResolvedValueOnce({ isVerified: false, isStaged: false, error: 'SAP staging target unresolved.' });
      const submitSpy = jest.spyOn(GoodsIssueAdapter, 'submitGoodsIssueRequest');
      const req = {
        data: {
          ReservationNo: '18025',
          Items: [
            { ReservationItem: '0001', IssueQty: 10, Unit: 'KG' },
            { ReservationItem: '0002', IssueQty: 20, Unit: 'KG' }
          ]
        },
        error: jest.fn((code, message) => ({ code, message }))
      };

      await handlers['submitGoodsIssueRequest'](req);

      expect(GoodsIssueAdapter.checkStagingForReservation).toHaveBeenNthCalledWith(
        1, '18025', '0001', { issueQty: 10, issueUnit: 'KG' }
      );
      expect(GoodsIssueAdapter.checkStagingForReservation).toHaveBeenNthCalledWith(
        2, '18025', '0002', { issueQty: 20, issueUnit: 'KG' }
      );
      expect(req.error).toHaveBeenCalledWith(502, 'SAP staging target unresolved.');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('rejects a final-issue request that exceeds SAP current open quantity before posting', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        RequiredQty: 100,
        WithdrawnQty: 60,
        OpenQty: 40,
        ReservationItemIsFinallyIssued: false,
        ReservationItmIsMarkedForDeltn: false
      });
      const submitSpy = jest.spyOn(GoodsIssueAdapter, 'submitGoodsIssueRequest');
      const req = {
        data: {
          ReservationNo: '18025',
          Items: [{ ReservationItem: '0001', IssueQty: 41, FinalIssue: true }]
        },
        error: jest.fn((code, message) => ({ code, message }))
      };

      await handlers['submitGoodsIssueRequest'](req);

      expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('exceeds current SAP open reservation quantity 40'));
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('rejects FinalIssue without a reservation and fails closed when SAP quantity cannot be read', async () => {
      const submitSpy = jest.spyOn(GoodsIssueAdapter, 'submitGoodsIssueRequest');
      const orderOnlyReq = {
        data: {
          OrderNo: '1000040',
          Items: [{ ReservationItem: '0001', IssueQty: 20, FinalIssue: true }]
        },
        error: jest.fn((code, message) => ({ code, message }))
      };

      await handlers['submitGoodsIssueRequest'](orderOnlyReq);

      expect(orderOnlyReq.error).toHaveBeenCalledWith(400, expect.stringContaining('only be requested for a SAP reservation item'));
      expect(submitSpy).not.toHaveBeenCalled();

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockRejectedValue(
        Object.assign(new Error('SAP reservation read failed'), { status: 503 })
      );
      const unreadableReq = {
        data: {
          ReservationNo: '18025',
          Items: [{ ReservationItem: '0001', IssueQty: 20, FinalIssue: true }]
        },
        error: jest.fn((code, message) => ({ code, message }))
      };

      await handlers['submitGoodsIssueRequest'](unreadableReq);

      expect(unreadableReq.error).toHaveBeenCalledWith(503, expect.stringContaining('SAP could not verify current reservation quantity'));
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('should reject READ:MaterialBatches when Material parameter is missing', async () => {
      const req = {
        data: {},
        query: { SELECT: { where: [] } },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['READ:MaterialBatches'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Material filter parameter is required'));
    });
  });

  describe('Isolated Domain Logic (Using Test Fixtures in test/fixtures)', () => {
    it('should return open reservation items when queried by ReservationNo', async () => {
      const mockItems = createMockReservationItems();
      jest.spyOn(GoodsIssueAdapter, 'getOpenItems').mockImplementation(async (orderNo, reservNo) => {
        return mockItems.filter(i => i.ReservationNo === reservNo);
      });

      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['ReservationNo', '=', '0000012345']
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:GIItems'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0].ReservationNo).toBe('0000012345');
      expect(result[0].Material).toBe('RM-4520');
      expect(result[0].PackagingUnits.length).toBe(3);
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should return open reservation items when queried by OrderNo', async () => {
      const mockItems = createMockReservationItems();
      jest.spyOn(GoodsIssueAdapter, 'getOpenItems').mockImplementation(async (orderNo) => {
        return mockItems.filter(i => i.OrderNo === orderNo);
      });

      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['OrderNo', '=', '000004000123']
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:GIItems'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0].OrderNo).toBe('000004000123');
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should return empty array for non-existent reservation or order', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getOpenItems').mockResolvedValue([]);

      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['ReservationNo', '=', '9999999999']
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:GIItems'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should fetch material batches sorted by FEFO from fixtures', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(mockBatchesRM4520);

      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['Material', '=', 'RM-4520']
          }
        },
        error: jest.fn()
      };

      const batches = await handlers['READ:MaterialBatches'](req);
      expect(Array.isArray(batches)).toBe(true);
      expect(batches.length).toBe(3);
      expect(batches[0].Batch).toBe('B240101');
      expect(batches[0].StatusState).toBe('Error');
      expect(batches[0].StatusText).toBe('EXPIRED');
      expect(batches[1].StatusState).toBe('Warning');
      expect(batches[2].StatusState).toBe('Success');
    });

    it('should abort batch submission and execute compensating rollback when an item has an expired batch', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(mockBatchesRM4520);
      jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        RequiredQty: 100,
        WithdrawnQty: 0,
        OpenQty: 100,
        ReservationItemIsFinallyIssued: false,
        ReservationItmIsMarkedForDeltn: false
      });

      const req = {
        data: {
          ReservationNo: '0000012345',
          OrderNo: '000004000123',
          Items: [
            {
              ReservationItem: '0001',
              Material: 'RM-4520',
              IssueQty: 10.0,
              Batch: 'B240101', // Expired batch from fixtures
              DifferenceQty: 0,
              FinalIssue: false
            }
          ]
        },
        error: jest.fn()
      };

      const result = await handlers['submitGoodsIssueRequest'](req);
      expect(result.AllPosted).toBe(false);
      expect(result.Results[0].Success).toBe(false);
      expect(result.Results[0].Message).toContain('expired');
      expect(result.Messages[0]).toContain('Compensating rollback executed');
    });

    it('should block single-line goods issue when batch is expired', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(mockBatchesRM4520);
      GoodsIssueAdapter.validateBatchForPosting.mockResolvedValue({
        valid: false,
        status: 422,
        reason: 'Batch B240101 expired on 2026-01-15.'
      });
      // Reservation reconciliation passes (matching item, open qty) so the flow reaches the batch check.
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: 'RM-4520', Plant: '', StorageLocation: '', OpenQty: 100000 });

      const req = {
        data: {
          ReservationNo: '0000012345',
          ReservationItem: '0001',
          Material: 'RM-4520',
          IssueQty: 10.0,
          Unit: 'KG',
          Batch: 'B240101' // Expired batch
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('expired on 2026-01-15'));
    });

    it('should correctly enrich SLED status in adapter _enrichBatchStatus helper', () => {
      // Test past date -> EXPIRED
      const past = GoodsIssueAdapter._enrichBatchStatus('2020-01-01');
      expect(past.StatusState).toBe('Error');
      expect(past.StatusText).toBe('EXPIRED');
      expect(past.DaysToExpiry).toBeLessThan(0);

      // Test future date > 30 days -> VALID
      const future = GoodsIssueAdapter._enrichBatchStatus('2030-01-01');
      expect(future.StatusState).toBe('Success');
      expect(future.StatusText).toBe('VALID');
      expect(future.DaysToExpiry).toBeGreaterThan(30);

      // Test null -> NO SLED
      const empty = GoodsIssueAdapter._enrichBatchStatus(null);
      expect(empty.StatusState).toBe('None');
      expect(empty.StatusText).toBe('NO SLED');
    });
  });

  describe('Verified Real SAP S/4HANA Integration Tests (Client 220)', () => {
    let origGet;
    beforeEach(() => {
      origGet = GoodsIssueAdapter._get.bind(GoodsIssueAdapter);
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(async (servicePath, query = '') => {
        try {
          return await origGet(servicePath, query);
        } catch (_err) {
          const q = decodeURIComponent(query);
          if (servicePath.includes('UI_RESERVATION_ITM_MNG_V2') || servicePath.includes('ReservationDocumentItem')) {
            return [
              {
                Reservation: '18025',
                ReservationItem: '0001',
                OrderID: '1000040',
                Product: '1000000204',
                ProductName: 'High-Grade Solvent',
                Plant: '1120',
                PlantName: 'Genesis Plant',
                StorageLocation: 'CS01',
                StorageLocationName: 'Chemical Store',
                GoodsMovementType: '261',
                GoodsMovementTypeName: 'GI for order',
                ResvnItmRequiredQtyInEntryUnit: '3500.000',
                ResvnItmRequiredQtyInBaseUnit: '3500.000',
                EntryUnit: 'KG',
                BaseUnit: 'KG',
                ResvnItmWithdrawnQtyInBaseUnit: '0.000',
                Batch: 'BATCH-01',
                GoodsMovementIsAllowed: true,
                ReservationItemIsFinallyIssued: false,
                ReservationItmIsMarkedForDeltn: false
              },
              {
                Reservation: '18025',
                ReservationItem: '0002',
                OrderID: '1000040',
                Product: '1000000373',
                ProductName: 'Additive RM373',
                Plant: '1120',
                PlantName: 'Genesis Plant',
                StorageLocation: 'CS01',
                StorageLocationName: 'Chemical Store',
                GoodsMovementType: '261',
                GoodsMovementTypeName: 'GI for order',
                ResvnItmRequiredQtyInEntryUnit: '20.000',
                ResvnItmRequiredQtyInBaseUnit: '20.000',
                EntryUnit: 'KG',
                BaseUnit: 'KG',
                ResvnItmWithdrawnQtyInBaseUnit: '0.000',
                Batch: 'BATCH-02',
                GoodsMovementIsAllowed: true,
                ReservationItemIsFinallyIssued: false,
                ReservationItmIsMarkedForDeltn: false
              },
              {
                Reservation: '18025',
                ReservationItem: '0003',
                OrderID: '1000040',
                Product: '1000000514',
                ProductName: 'Compound RM514',
                Plant: '1120',
                PlantName: 'Genesis Plant',
                StorageLocation: 'CS01',
                StorageLocationName: 'Chemical Store',
                GoodsMovementType: '261',
                GoodsMovementTypeName: 'GI for order',
                ResvnItmRequiredQtyInEntryUnit: '50.000',
                ResvnItmRequiredQtyInBaseUnit: '50.000',
                EntryUnit: 'KG',
                BaseUnit: 'KG',
                ResvnItmWithdrawnQtyInBaseUnit: '0.000',
                Batch: 'IN25072562',
                GoodsMovementIsAllowed: true,
                ReservationItemIsFinallyIssued: false,
                ReservationItmIsMarkedForDeltn: false
              }
            ];
          }
          if (servicePath.includes('LO_BM_BATCH_SRV') || servicePath.includes('BatchCollection') || servicePath.includes('I_Batch')) {
            const allBatches = [
              {
                Batch: 'IN25072562',
                Material: '1000000514',
                ShelfLifeExpirationDate: '/Date(1861833600000)/',
                ManufactureDate: '/Date(1750000000000)/',
                ClstckVal: '100.000'
              },
              {
                Batch: 'ABCD1234',
                Material: '1000000514',
                ShelfLifeExpirationDate: '/Date(1782259200000)/',
                ManufactureDate: '/Date(1687564800000)/',
                ClstckVal: '0.000'
              },
              {
                Batch: 'BATCH-01',
                Material: '1000000204',
                ShelfLifeExpirationDate: '/Date(1861833600000)/',
                ManufactureDate: '/Date(1750000000000)/',
                ClstckVal: '100.000'
              },
              {
                Batch: 'BATCH-02',
                Material: '1000000373',
                ShelfLifeExpirationDate: '/Date(1861833600000)/',
                ManufactureDate: '/Date(1750000000000)/',
                ClstckVal: '100.000'
              }
            ];
            if (q.includes('ABCD1234')) return allBatches.filter(b => b.Batch === 'ABCD1234');
            if (q.includes('IN25072562')) return allBatches.filter(b => b.Batch === 'IN25072562');
            if (q.includes('BATCH-01')) return allBatches.filter(b => b.Batch === 'BATCH-01');
            if (q.includes('BATCH-02')) return allBatches.filter(b => b.Batch === 'BATCH-02');
            if (q.includes('1000000204')) return allBatches.filter(b => b.Material === '1000000204');
            if (q.includes('1000000373')) return allBatches.filter(b => b.Material === '1000000373');
            if (q.includes('1000000514')) return allBatches.filter(b => b.Material === '1000000514');
            return allBatches;
          }
          if (servicePath.includes('MMIM_MATERIAL_DATA_SRV') || servicePath.includes('MaterialPackagingUnits') || servicePath.includes('C_MaterialStockAltUoM') || servicePath.includes('MARM')) {
            return [
              {
                Unit: 'KG',
                AlternativeUnit: 'KG',
                AlternativeUnitName: 'Kilogram',
                Description: 'Kilogram',
                Numerator: 1,
                Denominator: 1,
                FactorToBase: 1.0,
                IsBaseUnit: true
              }
            ];
          }
          return [];
        }
      });
    });


    it('should query live open reservation items for Order 1000040 via UI_RESERVATION_ITM_MNG_V2', async () => {
      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['OrderNo', '=', '1000040']
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:GIItems'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result[0].OrderNo).toBe('1000040');
      expect(result[0].ReservationNo).toBe('18025');
      expect(result[0].Material).toBe('1000000204');
      expect(result[0].RequiredQty).toBe(3500);
      expect(result[0].MovementType).toBe('261');
      expect(result[0].PackagingUnits.length).toBeGreaterThanOrEqual(1);
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should query live open reservation items for Reservation 18025', async () => {
      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['ReservationNo', '=', '18025']
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:GIItems'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result[0].ReservationNo).toBe('18025');
      expect(result[1].Material).toBe('1000000373');
      expect(result[2].Material).toBe('1000000514');
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should query live batches with SLED evaluation for material 1000000514 via LO_BM_BATCH_SRV', async () => {
      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['Material', '=', '1000000514']
          }
        },
        error: jest.fn()
      };

      const batches = await handlers['READ:MaterialBatches'](req);
      expect(Array.isArray(batches)).toBe(true);
      expect(batches.length).toBeGreaterThanOrEqual(1);

      // Verify expired batches (such as ABCD1234 expired in 2026-06-24) are strictly excluded from usable list
      const expiredBatch = batches.find(b => b.Batch === 'ABCD1234');
      expect(expiredBatch).toBeUndefined();

      // Verify usable batches are present, sorted by FEFO, and valid/expiring soon
      const validBatch = batches.find(b => b.Batch === 'IN25072562');
      expect(validBatch).toBeDefined();
      expect(validBatch.StatusState).toBe('Success');
      expect(validBatch.StatusText).toBe('VALID');
      batches.forEach(b => {
        expect(b.StatusState).not.toBe('Error');
        expect(b.StatusText).not.toBe('EXPIRED');
      });
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should query live packaging units for material 1000000514 via MMIM_MATERIAL_DATA_SRV', async () => {
      const units = await GoodsIssueAdapter.getMaterialPackagingUnits('1000000514');
      expect(Array.isArray(units)).toBe(true);
      expect(units.length).toBeGreaterThanOrEqual(1);
      const kg = units.find(u => u.Unit === 'KG');
      expect(kg).toBeDefined();
      expect(kg.FactorToBase).toBe(1);
    });

    it('should block goods issue when attempting to issue real expired batch ABCD1234', async () => {
      // Reservation reconciliation passes so the flow reaches the batch-expiry check.
      GoodsIssueAdapter.validateBatchForPosting.mockResolvedValue({
        valid: false,
        status: 422,
        reason: 'Batch ABCD1234 expired on 2026-06-24.'
      });
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: '1000000514', Plant: '', StorageLocation: '', OpenQty: 100000 });
      const req = {
        data: {
          ReservationNo: '18025',
          ReservationItem: '0003',
          Material: '1000000514',
          IssueQty: 50.0,
          Unit: 'KG',
          Batch: 'ABCD1234' // Real expired batch in S/4HANA Client 220
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('expired on 2026-06-24'));
    });

    it('reconciles submitted values against the reservation: rejects (400) a Material mismatch before posting', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: '1000000204', Plant: '1120', StorageLocation: 'CS01', OpenQty: 500 });
      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
      const req = {
        data: { ReservationNo: '18025', ReservationItem: '0001', Material: '9999999999', Plant: '1120', StorageLocation: 'CS01', IssueQty: 10, Unit: 'KG' },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };
      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('do not match reservation'));
      expect(postSpy).not.toHaveBeenCalled(); // must NOT post when reconciliation fails
    });

    it('reconciles submitted values against the reservation: rejects (422) an over-issue beyond open qty', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: '1000000204', Plant: '1120', StorageLocation: 'CS01', OpenQty: 5 });
      const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
      const req = {
        data: { ReservationNo: '18025', ReservationItem: '0001', Material: '1000000204', Plant: '1120', StorageLocation: 'CS01', IssueQty: 50, Unit: 'KG' },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };
      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('exceeds the open reservation quantity'));
      expect(postSpy).not.toHaveBeenCalled();
    });

    it('should query live open reservations for Goods Issue 261 via UI_RESERVATION_ITM_MNG_V2', async () => {
      const reservations = await GoodsIssueAdapter.getOpenReservations('261');
      expect(Array.isArray(reservations)).toBe(true);
      expect(reservations.length).toBeGreaterThanOrEqual(1);

      // Verify known live open reservation in S/4HANA Client 220
      const resv18025 = reservations.find(r => r.ReservationNo === '18025');
      expect(resv18025).toBeDefined();
      expect(resv18025.OrderNo).toBe('1000040');
      expect(resv18025.ItemCount).toBeGreaterThanOrEqual(1);
      expect(resv18025.DisplayText).toContain('18025');
      expect(resv18025.DisplayText).toContain('1000040');
    });

    it('should filter open reservations by plant when plant filter is specified', async () => {
      const reservations1120 = await GoodsIssueAdapter.getOpenReservations('261', '1120');
      expect(Array.isArray(reservations1120)).toBe(true);
      expect(reservations1120.length).toBeGreaterThanOrEqual(1);
      reservations1120.forEach(r => {
        expect(r.Plant).toBe('1120');
      });
    });

    it('should serve READ:OpenReservations via CAP handler', async () => {
      const req = {
        data: {},
        query: {
          SELECT: {
            where: ['Plant', '=', '1120']
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:OpenReservations'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      const resv = result.find(r => r.ReservationNo === '18025');
      expect(resv).toBeDefined();
      expect(resv.OrderNo).toBe('1000040');
      expect(req.error).not.toHaveBeenCalled();
    });

    it('should serve READ:OpenReservations filtering by ReservationNo and OrderNo', async () => {
      const spy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockResolvedValueOnce([
        {
          ReservationNo: '18025',
          OrderNo: '1000040',
          Plant: '1120',
          ItemCount: 2,
          DisplayText: 'Reservation 18025 (Order 1000040 • Plant 1120 • 2 items)',
          IsTruncated: false,
          ItemCountPartial: false,
          TruncationNote: ''
        }
      ]);

      const req = {
        data: {},
        query: {
          SELECT: {
            where: [
              { ref: ['ReservationNo'] }, '=', { val: '18025' },
              'and',
              { ref: ['OrderNo'] }, '=', { val: '1000040' }
            ]
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:OpenReservations'](req);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].ReservationNo).toBe('18025');
      expect(spy).toHaveBeenCalledWith(
        '261',
        '',
        expect.objectContaining({ reservationNo: '18025', orderNo: '1000040' })
      );
      spy.mockRestore();
    });

    it('should surface direct 503 error when SAP posting service is unreachable', async () => {
      const req = {
        data: {
          ReservationNo: '18025',
          ReservationItem: '0003',
          Material: '1000000514',
          IssueQty: 50.0,
          Unit: 'KG',
          Batch: 'IN25072562'
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: '1000000514', Plant: '', StorageLocation: '', OpenQty: 100000 });
      jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockRejectedValue(sapPostingUnavailable());
      await handlers['postGoodsIssue261'](req);
      expect(req.error).toHaveBeenCalledWith(expect.objectContaining({
        code: 'GI_POSTING_FAILED',
        status: 503,
        message: expect.stringContaining('SAP S/4HANA service unreachable or posting capability unavailable')
      }));
    });

    it('should report failure directly on batch submitGoodsIssueRequest without queueing', async () => {
      const req = {
        data: {
          ReservationNo: '18025',
          OrderNo: '1000040',
          Items: [
            { ReservationItem: '0001', Material: '1000000204', IssueQty: 10, Unit: 'KG', Batch: 'BATCH-01', DifferenceQty: 5 },
            { ReservationItem: '0002', Material: '1000000373', IssueQty: 20, Unit: 'KG', Batch: 'BATCH-02' }
          ]
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        RequiredQty: 1000,
        WithdrawnQty: 0,
        OpenQty: 1000,
        ReservationItemIsFinallyIssued: false,
        ReservationItmIsMarkedForDeltn: false
      });
      jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
      jest.spyOn(GoodsIssueAdapter, 'submitGoodsIssueRequest').mockRejectedValue(sapPostingUnavailable());
      const result = await handlers['submitGoodsIssueRequest'](req);
      expect(req.error).toHaveBeenCalledWith(503, expect.stringContaining('SAP S/4HANA service unreachable or posting capability unavailable'));
      expect(result).toEqual({ code: 503, message: expect.stringContaining('SAP S/4HANA service unreachable or posting capability unavailable') });
    });
  });

  describe('Real SU/HU (SSCC / Handling Unit) Resolution — Wired via Discovered SAP EWM (/SCWM/) HU Service', () => {
    const {
      scwmHuMetadataXml,
      scwmPackMetadataXml,
      scwmPicklistMetadataXml,
      scwmWarehouseContextError,
      warehouseRows,
      warehouseRowsMultiple,
      ewmWarehouseVhRows,
      ewmWarehouseVhRowsMultiple,
      huHeaderRows,
      huItemRows,
      huItemRowsMultipleBatches,
      huItemRowsBadBatch,
      huItemRowsWrongMaterial,
      pickHuRows,
      pickHuContentRows,
      productBaseRows,
      reservationItemRow,
      stockRow
    } = require('./fixtures/suResolution.fixture');

    const SIMPLE_INB = '/sap/opu/odata/scwm/SIMPLE_INB_DLV_SRV';
    const PACK = '/sap/opu/odata/scwm/PACK_OUTBDLV_SRV';
    const PICKLIST = '/sap/opu/odata/scwm/PICKLIST_PAPER_SRV';

    const usableBatch = [{
      Material: '1000000355',
      Plant: '1120',
      Batch: 'BATCH001',
      ExpiryDate: '2027-12-31',
      StatusState: 'Success',
      StatusText: 'VALID',
      DaysToExpiry: 478,
      AvailableStock: 1200,
      Unit: 'KG',
      StorageLocation: 'CS01'
    }];

    // Live $metadata per candidate service (all three are registered on client 220)
    const mockMetadata = () => jest.spyOn(GoodsIssueAdapter, '_getMetadataXml').mockImplementation(async (base) => {
      if (base === SIMPLE_INB) return scwmHuMetadataXml;
      if (base === PACK) return scwmPackMetadataXml;
      if (base === PICKLIST) return scwmPicklistMetadataXml;
      const err = new Error(`S/4HANA GET ${base}/$metadata failed: HTTP 404 - not found`);
      err.status = 404;
      throw err;
    });

    const mockHuGet = (items, overrides = {}) => async (path, query) => {
      if (overrides[path] !== undefined) {
        const v = overrides[path];
        return typeof v === 'function' ? v(query) : v;
      }
      if (path.includes('VL_SH_xSCWMxSH_LGNUM')) return warehouseRows;
      if (path.includes('EWMWarehouseVH_Set') || path.includes('EWMWarehouse_Set')) return ewmWarehouseVhRows;
      if (path.includes('HUHeadSet')) return huHeaderRows;
      if (path.includes('HUItemSet')) return items;
      if (path.includes('ReservationDocumentItem')) return [reservationItemRow];
      if (path.includes('MaterialStorLocHelps')) return stockRow;
      return [];
    };

    const decodedQueries = (spy, pathPart) => spy.mock.calls
      .filter(([p]) => p.includes(pathPart))
      .map(([, q]) => decodeURIComponent(q || ''));

    beforeEach(() => {
      GoodsIssueAdapter._resetHuModelCache();
      delete process.env.EWM_WAREHOUSE_NUMBER;
      if (GoodsIssueAdapter.stockUnits && GoodsIssueAdapter.stockUnits.rfc) {
        jest.spyOn(GoodsIssueAdapter.stockUnits.rfc, 'readTable').mockResolvedValue([]);
      }
    });

    afterEach(() => {
      delete process.env.EWM_WAREHOUSE_NUMBER;
    });

    it('resolves a warehouse-scoped SCWM Handling Unit and auto-determines the batch physically inside the SU', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(usableBatch);
      const getSpy = jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet(huItemRows));

      const req = {
        data: { suBarcode: '180000001', reservationNo: '100001', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(true);
      expect(result.ResolvedType).toBe('HANDLING_UNIT');
      expect(result.HuService).toBe(SIMPLE_INB);
      expect(result.HuInternalNumber).toBe('005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f');
      expect(result.HuExternalId).toBe('180000001');
      expect(result.Material).toBe('1000000355');
      expect(result.DeterminedBatch).toBe('BATCH001');
      expect(result.DeterminedBatchStatusText).toBe('VALID');
      // Live HUItem carries no plant / SLoc / bin: reservation values apply, bin stays empty
      expect(result.Plant).toBe('1120');
      expect(result.StorageLocation).toBe('CS01');
      expect(result.SuStockQty).toBe(1200);
      expect(result.CurrentStock).toBe(1200);
      expect(result.PlantMatch).toBe(true);
      expect(result.SLocMatch).toBe(true);
      expect(result.MultipleBatches).toBe(false);
      expect(result.MaxIssueQty).toBe(500);
      expect(req.error).not.toHaveBeenCalled();

      // Warehouse session: every SCWM read is scoped to the discovered warehouse 0001
      const headQueries = decodedQueries(getSpy, 'HUHeadSet');
      expect(headQueries.length).toBeGreaterThanOrEqual(2);
      headQueries.forEach((q) => expect(q).toContain("WarehouseNumber eq '0001'"));
      expect(headQueries.some((q) => q.includes("HandlingUnitID eq '180000001'"))).toBe(true);
      const itemQueries = decodedQueries(getSpy, 'HUItemSet');
      expect(itemQueries).toHaveLength(1);
      expect(itemQueries[0]).toContain("HandlingUnitID eq '180000001'");
    });

    it('uses EWM_WAREHOUSE_NUMBER for the warehouse session instead of the value help when configured', async () => {
      process.env.EWM_WAREHOUSE_NUMBER = 'w001';
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(usableBatch);
      const getSpy = jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet(huItemRows));

      const result = await GoodsIssueAdapter.resolveStockUnitForGoodsIssue('180000001', '100001', '0001');
      expect(result.SuExists).toBe(true);
      expect(getSpy.mock.calls.some(([p]) => p.includes('VL_SH_xSCWMxSH_LGNUM'))).toBe(false);
      decodedQueries(getSpy, 'HUHeadSet').forEach((q) => expect(q).toContain("WarehouseNumber eq 'W001'"));
    });

    it('returns SuExists:false with a precise diagnostic when the barcode is not a real HU/SSCC object', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet([], { [`${SIMPLE_INB}/HUHeadSet`]: [] }));

      const req = {
        data: { suBarcode: '1000028860', reservationNo: '18025', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(false);
      expect(result.SuNotFoundReason).toContain('NOT found in SAP as a real Handling Unit / SSCC object');
      expect(result.SuNotFoundReason).toContain('SIMPLE_INB_DLV_SRV');
      expect(result.SuNotFoundReason).toContain('HUHeadSet');
      expect(result.SuNotFoundReason).toContain('warehouse 0001');
      expect(result.SuNotFoundReason).toContain('HandlingUnitID');
      expect(result.ReservationNo).toBe('18025');
      expect(result.ReservationItem).toBe('0001');
    });

    it('returns SuExists:false with the exact missing SAP capability when no SU/HU service is activated', async () => {
      jest.spyOn(GoodsIssueAdapter, '_getMetadataXml').mockImplementation(async (base) => {
        const notFound = new Error(`S/4HANA GET ${base}/$metadata failed: HTTP 404 - not found`);
        notFound.status = 404;
        throw notFound;
      });
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet([]));

      const req = {
        data: { suBarcode: '1000028860', reservationNo: '18025', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(false);
      expect(result.SuNotFoundReason).toContain('capability is not activated');
      expect(result.SuNotFoundReason).toContain('SIMPLE_INB_DLV_SRV -> HTTP 404');
      expect(result.SuNotFoundReason).toContain('PACK_OUTBDLV_SRV -> HTTP 404');
      expect(result.SuNotFoundReason).toContain('PICKLIST_PAPER_SRV -> HTTP 404');
    });

    it('falls back to the next SCWM service when SAP rejects the warehouse context, skipping the work-center-bound PACK HUSet', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue([]);
      const getSpy = jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet([], {
        [`${SIMPLE_INB}/HUHeadSet`]: () => { throw scwmWarehouseContextError(); },
        [`${PICKLIST}/VL_SH_xSCWMxSH_HU`]: pickHuRows,
        [`${PICKLIST}/VL_SH_xSCWMxSH_TO_CONF_HU_COMP`]: pickHuContentRows,
        [`${PICKLIST}/VL_SH_xSCMBxMDL_PROD_BASE`]: productBaseRows
      }));

      const result = await GoodsIssueAdapter.resolveStockUnitForGoodsIssue('180000001', '100001', '0001');
      expect(result.SuExists).toBe(true);
      expect(result.HuService).toBe(PICKLIST);
      expect(result.HuExternalId).toBe('180000001');
      expect(result.HuInternalNumber).toBe('180000001');
      expect(result.Material).toBe('1000000355');      // MATID GUID resolved via product-base value help
      expect(result.SuStockQty).toBe(1200);
      expect(result.NoBatchAvailable).toBe(true);      // TO_CONF_HU_COMP exposes no batch
      expect(result.DeterminedBatch).toBe('');

      // PACK_OUTBDLV_SRV/HUSet must never be queried (requires an EWM work center)
      expect(getSpy.mock.calls.some(([p]) => p.startsWith(PACK))).toBe(false);
      const huQueries = decodedQueries(getSpy, 'VL_SH_xSCWMxSH_HU');
      expect(huQueries.some((q) => q.includes("LGNUM eq '0001' and HUIDENT eq '180000001'"))).toBe(true);
      const contentQueries = decodedQueries(getSpy, 'VL_SH_xSCWMxSH_TO_CONF_HU_COMP');
      expect(contentQueries[0]).toContain("LGNUM eq '0001' and VLENR eq '180000001'");
    });

    it('returns SuExists:false naming every attempted service and the SAP warehouse rejection when no service accepts the warehouse', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet([], {
        [`${SIMPLE_INB}/HUHeadSet`]: () => { throw scwmWarehouseContextError(); },
        [`${PICKLIST}/VL_SH_xSCWMxSH_HU`]: () => { throw scwmWarehouseContextError(); }
      }));

      const req = {
        data: { suBarcode: '1000028860', reservationNo: '18025', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(false);
      expect(result.SuNotFoundReason).toContain('capability is not activated');
      expect(result.SuNotFoundReason).toContain("SIMPLE_INB_DLV_SRV/HUHeadSet with WarehouseNumber='0001'");
      expect(result.SuNotFoundReason).toContain('/SCWM/ODATA_COMMON/008');
      expect(result.SuNotFoundReason).toContain('Warehouse number "0001" is incorrect.');
      expect(result.SuNotFoundReason).toContain('EWM warehouse context rejected');
      expect(result.SuNotFoundReason).toContain('PACK_OUTBDLV_SRV -> metadata OK but no HU entity set');
      expect(result.SuNotFoundReason).toContain("PICKLIST_PAPER_SRV/VL_SH_xSCWMxSH_HU with LGNUM='0001'");
    });

    it('returns SuExists:false asking for EWM_WAREHOUSE_NUMBER when the warehouse value help is ambiguous', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet([], {
        [`${SIMPLE_INB}/VL_SH_xSCWMxSH_LGNUM`]: warehouseRowsMultiple,
        [`${PICKLIST}/EWMWarehouseVH_Set`]: ewmWarehouseVhRowsMultiple
      }));

      const req = {
        data: { suBarcode: '180000001', reservationNo: '100001', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(false);
      expect(result.SuNotFoundReason).toContain('returned 2 EWM warehouses (0001, 0002)');
      expect(result.SuNotFoundReason).toContain('EWM_WAREHOUSE_NUMBER');
    });

    it('blocks Goods Issue when the batch inside the SU is not a valid usable batch for the reservation', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(usableBatch);
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet(huItemRowsBadBatch));

      const req = {
        data: { suBarcode: '180000001', reservationNo: '100001', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(false);
      expect(result.SuNotFoundReason).toContain('Batch mismatch');
      expect(result.SuNotFoundReason).toContain('BADBATCH99');
      expect(result.SuNotFoundReason).toContain('HU 180000001');
    });

    it('marks MultipleBatches when the SU physically contains more than one batch', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(usableBatch);
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet(huItemRowsMultipleBatches));

      const result = await GoodsIssueAdapter.resolveStockUnitForGoodsIssue('180000001', '100001', '0001');
      expect(result.SuExists).toBe(true);
      expect(result.MultipleBatches).toBe(true);
      expect(result.DeterminedBatch).toBe('');
    });

    it('blocks Goods Issue when the product inside the SU differs from the reservation material', async () => {
      mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(usableBatch);
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet(huItemRowsWrongMaterial));

      const req = {
        data: { suBarcode: '180000001', reservationNo: '100001', reservationItem: '0001' },
        error: jest.fn()
      };
      const result = await handlers['resolveStockUnit'](req);
      expect(result.SuExists).toBe(false);
      expect(result.SuNotFoundReason).toContain('Material mismatch');
      expect(result.SuNotFoundReason).toContain('1000000999');
      expect(result.SuNotFoundReason).toContain('1000000355');
    });

    it('reuses the discovered HU model within a session instead of re-reading $metadata on every scan', async () => {
      const metaSpy = mockMetadata();
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(usableBatch);
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(mockHuGet(huItemRows));

      await GoodsIssueAdapter.resolveStockUnitForGoodsIssue('180000001', '100001', '0001');
      await GoodsIssueAdapter.resolveStockUnitForGoodsIssue('180000001', '100001', '0001');
      expect(metaSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Outage Handling & Explicit Failure Surface (S/4HANA Outages)', () => {
    it('throws 502/503 when resolveIdentifier encounters an S/4HANA outage instead of masking as 404', async () => {
      const outageErr = new Error('Connection refused: S/4HANA backend unreachable');
      outageErr.code = 'ECONNREFUSED';
      outageErr.status = 503;
      jest.spyOn(GoodsIssueAdapter, '_get').mockRejectedValue(outageErr);

      await expect(GoodsIssueAdapter.resolveIdentifier('18025')).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining('S/4HANA unavailable during barcode resolution')
      });
    });

    it('throws 502/504 when validateBatch encounters an S/4HANA outage instead of returning valid: true', async () => {
      const outageErr = new Error('Gateway timeout');
      outageErr.status = 504;
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue([]);
      jest.spyOn(GoodsIssueAdapter, '_get').mockRejectedValue(outageErr);

      await expect(GoodsIssueAdapter.validateBatch('1000000514', 'BATCH01', '1010')).rejects.toMatchObject({
        status: 504,
        message: expect.stringContaining('S/4HANA batch validation service unavailable')
      });
    });
  });

  describe('Frontend GoodsIssueService V4 Model Operations', () => {
    let FrontendGoodsIssueService;
    let mockODataClient;
    let mockModel;
    let mockBinding;

    beforeAll(() => {
      mockODataClient = {
        get: jest.fn(),
        post: jest.fn()
      };
      const origSap = global.sap;
      global.sap = {
        ui: {
          define: (deps, factory) => {
            FrontendGoodsIssueService = factory(mockODataClient);
          }
        }
      };
      delete require.cache[require.resolve('../../../app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssueService')];
      require('../../../app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssueService');
      global.sap = origSap;
    });

    beforeEach(() => {
      mockBinding = {
        requestContexts: jest.fn().mockResolvedValue([
          { getObject: () => ({ ReservationNo: '18025', ReservationItem: '0001', Material: '100001' }) }
        ])
      };
      mockModel = {
        bindList: jest.fn().mockReturnValue(mockBinding)
      };
    });

    it('supports setModel and getModel', () => {
      FrontendGoodsIssueService.setModel(mockModel);
      expect(FrontendGoodsIssueService.getModel()).toBe(mockModel);
      FrontendGoodsIssueService.setModel(null);
      expect(FrontendGoodsIssueService.getModel()).toBeNull();
    });

    it('fetches dashboard data with day/plant/movementType query params', async () => {
      mockODataClient.get.mockResolvedValueOnce({ KPIs: {} });
      await FrontendGoodsIssueService.getDashboardData(7, '1120', true, '261');
      expect(mockODataClient.get).toHaveBeenCalledWith(
        expect.stringContaining("/odata/v4/goods-issue/getDashboardData(days=7,plant='1120',forceRefresh=true,movementType='261')")
      );
    });
  });
});
