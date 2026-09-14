const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const {
  createMockReservationItems,
  mockBatchesRM4520
} = require('./fixtures/goodsIssueFixtures');

describe('GoodsIssueService & GoodsIssueAdapter Unit & Integration Tests', () => {
  let srv;
  let handlers = {};

  beforeEach(() => {
    handlers = {};
    srv = {
      on: jest.fn((event, entityOrHandler, handler) => {
        const key = typeof entityOrHandler === 'string' ? `${event}:${entityOrHandler}` : event;
        const fn = typeof entityOrHandler === 'function' ? entityOrHandler : handler;
        handlers[key] = fn;
      })
    };
    GoodsIssueHandler.init(srv);
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

      await handlers['postGoodsIssue'](req);
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

      await handlers['postGoodsIssue'](req);
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

      await handlers['postGoodsIssue'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('expired on 2026-01-15'));
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

      await handlers['postGoodsIssue'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('expired on 2026-06-24'));
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

    it('should enqueue transaction to Dispatch Queue when SAP posting service is unavailable (Outbox Queue pattern)', async () => {
      const req = {
        data: {
          ReservationNo: '18025',
          ReservationItem: '0003',
          Material: '1000000514',
          IssueQty: 50.0,
          Unit: 'KG',
          Batch: 'IN25072562' // Valid batch
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      const result = await handlers['postGoodsIssue'](req);
      expect(result).toBeDefined();
      expect(result.Success).toBe(true);
      expect(result.Queued).toBe(true);
      expect(result.SyncStatus).toBe('QUEUED');
      expect(result.QueueReference).toMatch(/^GI-QUEUE-18025-0003-\d{4}$/);
      expect(result.MaterialDocument).toBe(''); // Strictly no fake document number per AGENTS.md
    });

    it('should query queue items and return queue summary', async () => {
      const summary = await handlers['getQueueSummary']({});
      expect(summary).toBeDefined();
      expect(summary.QueuedCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(summary.Items)).toBe(true);
    });

    it('should handle retryQueuedGoodsIssue against S/4HANA', async () => {
      const summary = await handlers['getQueueSummary']({});
      const item = summary.Items[0];
      expect(item).toBeDefined();

      const retryReq = {
        data: { QueueReference: item.QueueReference },
        error: jest.fn()
      };

      const retryRes = await handlers['retryQueuedGoodsIssue'](retryReq);
      expect(retryRes).toBeDefined();
      expect(retryRes.QueueReference).toBe(item.QueueReference);
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
      expect(result.StorageBin).toBe('');
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
      expect(result.StorageBin).toBe('A1-01-02');      // VLPLA from the HU contents value help
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
});
