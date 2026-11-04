const cds = require('@sap/cds');
// The dispatch queue lives in the CAP database: boot the server with the test profile's in-memory
// SQLite so the queue-related handler tests below have a bound store (cds.db).
cds.test(__dirname + '/../../../');

const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const { mockBatchesRM4520 } = require('./fixtures/goodsIssueFixtures');

// SAP posting-capability-unavailable error (HTTP 501).
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
    it('should reject postGoodsIssue311 when ReservationNo or ReservationItem is missing', async () => {
      const req = {
        data: {
          ReservationNo: '',
          ReservationItem: '',
          IssueQty: 10
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue311'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('ReservationNo and ReservationItem are required'));
    });

    it('should reject postGoodsIssue311 when IssueQty is zero or negative', async () => {
      const req = {
        data: {
          ReservationNo: '18025',
          ReservationItem: '0001',
          IssueQty: -5
        },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue311'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('positive decimal number'));
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
    // Only the OData read (_get) is doubled. Field names follow the service's own $select list and test/unit/wm/fixtures/suResolution.fixture.js; the SAP shape is not proven here.
    const reservationRow = {
      Reservation: '12345', ReservationItem: '1', OrderID: '4000123', Product: 'RM-4520', Plant: '1010',
      StorageLocation: '101A', BaseUnit: 'KG', GoodsMovementType: '261',
      ResvnItmRequiredQtyInBaseUnit: '100.000', ResvnItmWithdrawnQtyInBaseUnit: '40.000'
    };
    const stubReservationRead = (rows) => {
      const queries = [];
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(async (path, query = '') => {
        if (!path.includes('ReservationDocumentItem')) return [];
        queries.push(decodeURIComponent(query));
        return rows;
      });
      return queries;
    };
    const giItemsRequest = (where) => ({ data: {}, query: { SELECT: { where } }, error: jest.fn() });

    it('READ:GIItems by ReservationNo filters SAP on the short and padded number and returns the open quantity', async () => {
      const queries = stubReservationRead([reservationRow]);
      const req = giItemsRequest(['ReservationNo', '=', '0000012345']);

      const result = await handlers['READ:GIItems'](req);

      expect(queries[0]).toContain("(Reservation eq '12345' or Reservation eq '0000012345') and ReservationItemIsFinallyIssued eq false");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ ReservationNo: '12345', ReservationItem: '0001', Material: 'RM-4520', RequiredQty: 100, WithdrawnQty: 40, OpenQty: 60, MovementType: '261' });
      expect(req.error).not.toHaveBeenCalled();
    });

    it('READ:GIItems by OrderNo filters SAP on the short and padded order number', async () => {
      const queries = stubReservationRead([reservationRow]);
      const req = giItemsRequest(['OrderNo', '=', '000004000123']);

      const result = await handlers['READ:GIItems'](req);

      expect(queries[0]).toContain("(OrderID eq '4000123' or OrderID eq '000004000123') and ReservationItemIsFinallyIssued eq false");
      expect(result[0].OrderNo).toBe('4000123');
    });

    it('READ:OpenReservations filters SAP by all five movement types, reservation and order', async () => {
      const queries = stubReservationRead([reservationRow]);
      const req = {
        data: {},
        query: {
          SELECT: {
            where: [
              { ref: ['ReservationNo'] }, '=', { val: '12345' },
              'and',
              { ref: ['OrderNo'] }, '=', { val: '4000123' }
            ]
          }
        },
        error: jest.fn()
      };

      const result = await handlers['READ:OpenReservations'](req);

      expect(queries[0]).toContain("(GoodsMovementType eq '201' or GoodsMovementType eq '241' or GoodsMovementType eq '261' or GoodsMovementType eq '301' or GoodsMovementType eq '311')");
      expect(queries[0]).toContain("(Reservation eq '12345' or Reservation eq '0000012345')");
      expect(queries[0]).toContain("(OrderID eq '4000123' or OrderID eq '000004000123')");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ ReservationNo: '12345', OrderNo: '4000123', ItemCount: 1 });
    });

    it('postGoodsIssue311 answers 503 and can be tried again when SAP answers the posting with 501', async () => {
      const row = { ...reservationRow, GoodsMovementType: '311', Product: 'RM-4520', Plant: '1120', StorageLocation: 'CS01' };
      jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(async (path) => (path.includes('ReservationDocumentItem') ? [row] : []));
      jest.spyOn(GoodsIssueAdapter, '_getDestination').mockResolvedValue({ name: 'DEST' });
      const http = jest.spyOn(GoodsIssueAdapter, '_post').mockRejectedValue(sapPostingUnavailable());
      const req = {
        data: {
          MovementType: '311', ReservationNo: '12345', ReservationItem: '0001', Material: 'RM-4520', Plant: '1120',
          StorageLocation: 'CS01', IssueQty: 5, Unit: 'KG', ReceivingStorageLocation: 'CS02'
        },
        user: { attr: { Plant: ['1120'] } },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue311'](req);

      expect(http).toHaveBeenCalledTimes(1);
      expect(req.error).toHaveBeenCalledWith(503, expect.stringContaining('The posting was not made and can be tried again.'));
    });

    it('should block single-line goods issue when batch is expired', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue(mockBatchesRM4520);
      GoodsIssueAdapter.validateBatchForPosting.mockResolvedValue({
        valid: false,
        status: 422,
        reason: 'Batch B240101 expired on 2026-01-15.'
      });
      // Reservation reconciliation passes (matching item, open qty) so the flow reaches the batch check.
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: 'RM-4520', Plant: '1120', StorageLocation: 'HS01', OpenQty: 100000 });

      const req = {
        data: {
          ReservationNo: '0000012345',
          ReservationItem: '0001',
          Material: 'RM-4520',
          Plant: '1120',
          StorageLocation: 'HS01',
          IssueQty: 10.0,
          Unit: 'KG',
          ReceivingStorageLocation: 'CS02',
          Batch: 'B240101', // Expired batch
          MovementType: '311'
        },
        user: { attr: { Plant: ['1120'] } },
        error: jest.fn((code, msg) => ({ code, message: msg }))
      };

      await handlers['postGoodsIssue311'](req);
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

    it('rejects an invalid movement filter instead of substituting 201', async () => {
      const spy = jest.spyOn(GoodsIssueAdapter, 'getOpenReservations');
      const req = {
        data: {},
        query: { SELECT: { where: [{ ref: ['MovementType'] }, '=', { val: '999' }] } },
        error: jest.fn((code, message) => ({ code, message }))
      };
      await handlers['READ:OpenReservations'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('MovementType filter'));
      expect(spy).not.toHaveBeenCalled();
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
});
