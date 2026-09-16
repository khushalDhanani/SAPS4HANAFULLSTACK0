const {
  BaseGoodsIssueClient,
  GoodsIssueReservationsClient,
  GoodsIssueBatchesClient,
  GoodsIssueStockUnitClient,
  GoodsIssuePostingClient
} = require('../../../srv/integration/s4hana/wm/goods-issue');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

describe('Goods Issue Domain Clients Unit Tests', () => {
  describe('BaseGoodsIssueClient', () => {
    it('should correctly detect backend outages and network errors in _isOutage', () => {
      const client = new BaseGoodsIssueClient();

      expect(client._isOutage(null)).toBe(false);
      expect(client._isOutage({ status: 502 })).toBe(true);
      expect(client._isOutage({ status: 503 })).toBe(true);
      expect(client._isOutage({ status: 504 })).toBe(true);
      expect(client._isOutage({ code: 'ECONNREFUSED' })).toBe(true);
      expect(client._isOutage({ code: 'ETIMEDOUT' })).toBe(true);
      expect(client._isOutage({ code: 'DESTINATION_NOT_CONFIGURED' })).toBe(true);
      expect(client._isOutage({ message: 'Network Error: connection refused' })).toBe(true);
      expect(client._isOutage({ status: 404, message: 'Not found' })).toBe(false);
    });

    it('should delegate _isOutage to adapter when adapter is provided', () => {
      const mockAdapter = {
        _isOutage: jest.fn().mockReturnValue(true)
      };
      const client = new BaseGoodsIssueClient({ adapter: mockAdapter });
      const err = new Error('Test error');
      expect(client._isOutage(err)).toBe(true);
      expect(mockAdapter._isOutage).toHaveBeenCalledWith(err);
    });

    it('should delegate _get and _post to adapter when adapter is provided', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([{ id: 1 }]),
        _post: jest.fn().mockResolvedValue({ success: true })
      };
      const client = new BaseGoodsIssueClient({ adapter: mockAdapter });

      const getRes = await client._get('/test/path', 'query=1');
      expect(getRes).toEqual([{ id: 1 }]);
      expect(mockAdapter._get).toHaveBeenCalledWith('/test/path', 'query=1');

      const postRes = await client._post('/test/post', { key: 'val' });
      expect(postRes).toEqual({ success: true });
      expect(mockAdapter._post).toHaveBeenCalledWith('/test/post', { key: 'val' }, {});
    });

    it('should format dates and enrich batch status using shared utilities', () => {
      const client = new BaseGoodsIssueClient();
      expect(client._formatDate('/Date(1767225600000)/')).toBe('2026-01-01');

      const expiredStatus = client._enrichBatchStatus('2020-01-01');
      expect(expiredStatus.StatusState).toBe('Error');
      expect(expiredStatus.StatusText).toBe('EXPIRED');

      const validStatus = client._enrichBatchStatus('2035-01-01');
      expect(validStatus.StatusState).toBe('Success');
      expect(validStatus.StatusText).toBe('VALID');
    });
  });

  describe('GoodsIssueReservationsClient', () => {
    it('should query UI_RESERVATION_ITM_MNG_V2 and aggregate open reservations', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            OrderID: '40001',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT01',
            ProductName: 'Material 1'
          },
          {
            Reservation: '10001',
            OrderID: '40001',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT02',
            ProductName: 'Material 2'
          },
          {
            Reservation: '10002',
            OrderID: '',
            Plant: '1120',
            GoodsMovementType: '201',
            GoodsMovementTypeName: 'GI for cost center',
            Product: 'MAT03',
            ProductName: 'Material 3'
          }
        ])
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const result = await reservationsClient.getOpenReservations('261', '1120');

      expect(result).toHaveLength(2);
      expect(result[0].ReservationNo).toBe('10002');
      expect(result[1].ReservationNo).toBe('10001');
      expect(result[1].ItemCount).toBe(2);
      expect(result[1].DisplayText).toContain('Reservation 10001 (Order 40001 • Plant 1120 • 2 items)');
    });

    it('should calculate openQty and attach packaging units in getOpenItems', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '1',
            OrderID: '40001',
            Product: 'MAT01',
            ProductName: 'Material 1',
            Plant: '1120',
            StorageLocation: '1120',
            StorageLocationName: 'Storage Bin A',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '50.000',
            ResvnItmWithdrawnQtyInBaseUnit: '10.000',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order'
          }
        ]),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([
          { Unit: 'KG', Description: 'Kilogram', Numerator: 1, Denominator: 1, FactorToBase: 1, IsBaseUnit: true }
        ]),
        getMaterialBatches: jest.fn().mockResolvedValue([]),
        _enrichBatchStatus: jest.fn()
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const items = await reservationsClient.getOpenItems('40001', '10001');

      expect(items).toHaveLength(1);
      expect(items[0].ReservationItem).toBe('0001');
      expect(items[0].RequiredQty).toBe(50);
      expect(items[0].WithdrawnQty).toBe(10);
      expect(items[0].OpenQty).toBe(40);
      expect(items[0].PackagingUnits).toHaveLength(1);
    });

    it('should return empty array when orderNo and reservNo are both blank', async () => {
      const reservationsClient = new GoodsIssueReservationsClient();
      const items = await reservationsClient.getOpenItems('', '');
      expect(items).toEqual([]);
    });
  });

  describe('GoodsIssueBatchesClient', () => {
    it('should fetch and map alternative packaging units in getMaterialPackagingUnits', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          { AlternativeUnit: 'PAL', AlternativeUnitName: 'Pallet', Numerator: '100', Denominator: '1', IsBaseUnit: false },
          { AlternativeUnit: 'KG', AlternativeUnitName: 'Kilogram', Numerator: '1', Denominator: '1', IsBaseUnit: true }
        ])
      };

      const batchesClient = new GoodsIssueBatchesClient({ adapter: mockAdapter });
      const units = await batchesClient.getMaterialPackagingUnits('MAT01');

      expect(units).toHaveLength(2);
      expect(units[0].Unit).toBe('PAL');
      expect(units[0].FactorToBase).toBe(100);
      expect(units[0].Barcode).toBe('MAT01-PAL');
      expect(units[1].IsBaseUnit).toBe(true);
    });

    it('should exclude expired batches and sort remaining by FEFO in getMaterialBatches', async () => {
      const mockAdapter = {
        _get: jest.fn().mockImplementation((path) => {
          if (path.includes('MaterialStorLocHelps')) {
            return Promise.resolve([{ CurrentStock: '500', BaseUnit: 'KG', WarehouseStorageBin: 'BIN-01' }]);
          }
          if (path.includes('I_Batch')) {
            return Promise.resolve([
              { Batch: 'B_LATER', ShelfLifeExpirationDate: '/Date(1893456000000)/', Plant: '1120' }, // 2030
              { Batch: 'B_EXPIRED', ShelfLifeExpirationDate: '/Date(1577836800000)/', Plant: '1120' }, // 2020
              { Batch: 'B_SOONER', ShelfLifeExpirationDate: '/Date(1798761600000)/', Plant: '1120' }  // 2027
            ]);
          }
          return Promise.resolve([]);
        }),
        _enrichBatchStatus: (d) => GoodsIssueAdapter._enrichBatchStatus(d),
        _formatDate: (d) => GoodsIssueAdapter._formatDate(d)
      };

      const batchesClient = new GoodsIssueBatchesClient({ adapter: mockAdapter });
      const batches = await batchesClient.getMaterialBatches('MAT01', '1120', '1120');

      expect(batches).toHaveLength(2);
      expect(batches[0].Batch).toBe('B_SOONER');
      expect(batches[1].Batch).toBe('B_LATER');
    });

    it('should validate batch and detect expired or deleted batch', async () => {
      const mockAdapter = {
        getMaterialBatches: jest.fn().mockResolvedValue([
          { Batch: 'B_EXPIRED', StatusState: 'Error', StatusText: 'EXPIRED', ExpiryDate: '2020-01-01' }
        ]),
        _isOutage: () => false
      };

      const batchesClient = new GoodsIssueBatchesClient({ adapter: mockAdapter });
      const valResult = await batchesClient.validateBatch('MAT01', 'B_EXPIRED', '1120');

      expect(valResult.valid).toBe(false);
      expect(valResult.reason).toContain('expired');
    });

    it('should revalidate stock and verify sufficient quantity in revalidateStockBeforePosting', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          { CurrentStock: '100', BaseUnit: 'KG' }
        ]),
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        getMaterialBatches: jest.fn().mockResolvedValue([
          { Batch: 'BATCH01', StatusState: 'Success', StatusText: 'VALID', ExpiryDate: '2030-01-01' }
        ]),
        _isOutage: () => false
      };

      const batchesClient = new GoodsIssueBatchesClient({ adapter: mockAdapter });

      // Case 1: Sufficient stock
      const resultPass = await batchesClient.revalidateStockBeforePosting('MAT01', '1120', '1120', 'BATCH01', 50);
      expect(resultPass.Valid).toBe(true);
      expect(resultPass.StockSufficient).toBe(true);

      // Case 2: Insufficient stock
      const resultFail = await batchesClient.revalidateStockBeforePosting('MAT01', '1120', '1120', 'BATCH01', 150);
      expect(resultFail.Valid).toBe(false);
      expect(resultFail.StockSufficient).toBe(false);
      expect(resultFail.Message).toContain('less than requested quantity');
    });
  });

  describe('GoodsIssuePostingClient', () => {
    it('should reject posting with missing or invalid parameters', async () => {
      const postingClient = new GoodsIssuePostingClient();

      await expect(postingClient.postGoodsIssue('', '1', 'MAT01', 10)).rejects.toThrow('ReservationNo and ReservationItem are required');
      await expect(postingClient.postGoodsIssue('10001', '', 'MAT01', 10)).rejects.toThrow('ReservationNo and ReservationItem are required');
      await expect(postingClient.postGoodsIssue('10001', '1', 'MAT01', 0)).rejects.toThrow('IssueQty must be a positive decimal number');
      await expect(postingClient.postGoodsIssue('10001', '1', 'MAT01', -5)).rejects.toThrow('IssueQty must be a positive decimal number');
    });

    it('should block posting if batch is expired', async () => {
      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: false, reason: 'Batch EXPIRED01 has expired.' })
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      await expect(
        postingClient.postGoodsIssue('10001', '1', 'MAT01', 10, 'KG', 'EXPIRED01')
      ).rejects.toThrow('Batch EXPIRED01 has expired.');
    });

    it('should successfully post Goods Issue when SAP service responds', async () => {
      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({
          MaterialDocument: '4900009999',
          MaterialDocYear: '2026',
          TransferOrder: '123'
        })
      };

      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const res = await postingClient.postGoodsIssue('10001', '1', 'MAT01', 10, 'KG', 'B01', 2, 'DAMAGE', '999');

      expect(res.Success).toBe(true);
      expect(res.MaterialDocument).toBe('4900009999');
      expect(res.DifferenceCleared).toBe(true);
      expect(res.DifferenceQty).toBe(2);
    });

    it('should validate items in submitGoodsIssueRequest', async () => {
      const postingClient = new GoodsIssuePostingClient();

      await expect(postingClient.submitGoodsIssueRequest('', '', [])).rejects.toThrow('Either ReservationNo or OrderNo must be provided');
      await expect(postingClient.submitGoodsIssueRequest('10001', '', [])).rejects.toThrow('At least one item must be specified');
      await expect(postingClient.submitGoodsIssueRequest('10001', '', [{ ReservationItem: '1', IssueQty: -1 }])).rejects.toThrow('Issue quantity must be a positive decimal number');
    });
  });

  describe('GoodsIssueStockUnitClient', () => {
    it('should validate inputs for resolveStockUnitForGoodsIssue', async () => {
      const stockUnitClient = new GoodsIssueStockUnitClient();

      await expect(stockUnitClient.resolveStockUnitForGoodsIssue('', '10001', '1')).rejects.toThrow('Stock Unit / SU barcode is required');
      await expect(stockUnitClient.resolveStockUnitForGoodsIssue('SU100', '', '1')).rejects.toThrow('Reservation number and item are required');
    });

    it('should match direct SAP batch barcode against usable batches', async () => {
      const mockAdapter = {
        _get: jest.fn().mockImplementation((path) => {
          if (path.includes('ReservationDocumentItem')) {
            return Promise.resolve([
              {
                Reservation: '10001',
                ReservationItem: '0001',
                OrderID: '40001',
                Product: 'MAT01',
                ProductName: 'Material 1',
                Plant: '1120',
                StorageLocation: '1120',
                BaseUnit: 'KG',
                ResvnItmRequiredQtyInBaseUnit: '100',
                ResvnItmWithdrawnQtyInBaseUnit: '20'
              }
            ]);
          }
          if (path.includes('MaterialStorLocHelps')) {
            return Promise.resolve([{ CurrentStock: '50', BaseUnit: 'KG' }]);
          }
          return Promise.resolve([]);
        }),
        getMaterialBatches: jest.fn().mockResolvedValue([
          {
            Batch: 'BATCH_DIRECT',
            ExpiryDate: '2030-01-01',
            StatusState: 'Success',
            StatusText: 'VALID',
            DaysToExpiry: 1500,
            AvailableStock: 50,
            StorageBin: 'BIN-10'
          }
        ])
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      const res = await stockUnitClient.resolveStockUnitForGoodsIssue('BATCH_DIRECT', '10001', '0001');

      expect(res.SuExists).toBe(true);
      expect(res.ResolvedType).toBe('BATCH');
      expect(res.DeterminedBatch).toBe('BATCH_DIRECT');
      expect(res.MaxIssueQty).toBe(50);
      expect(res.ReservationRemainingQty).toBe(80);
    });

    it('should extract entity sets and type property details from $metadata XML', () => {
      const stockUnitClient = new GoodsIssueStockUnitClient();
      const mockXml = `
        <Schema Namespace="SCWM">
          <EntityType Name="HUHead">
            <Key>
              <PropertyRef Name="HandlingUnitID"/>
            </Key>
            <Property Name="HandlingUnitID" Type="Edm.String"/>
            <Property Name="WarehouseNumber" Type="Edm.String"/>
          </EntityType>
          <EntityContainer Name="Entities">
            <EntitySet Name="HUHeadSet" EntityType="SCWM.HUHead"/>
          </EntityContainer>
        </Schema>
      `;

      const entitySets = stockUnitClient._extractEntitySets(mockXml);
      expect(entitySets).toHaveLength(1);
      expect(entitySets[0].name).toBe('HUHeadSet');
      expect(entitySets[0].type).toBe('HUHead');

      const props = stockUnitClient._typePropDetails(mockXml, 'HUHead');
      expect(props).toHaveLength(2);
      expect(props[0]).toEqual({ name: 'HandlingUnitID', type: 'Edm.String', key: true });
      expect(props[1]).toEqual({ name: 'WarehouseNumber', type: 'Edm.String', key: false });
    });

    it('should reset HU model cache on _resetHuModelCache', () => {
      const stockUnitClient = new GoodsIssueStockUnitClient();
      stockUnitClient._huModelCache = { model: {}, expires: Date.now() + 10000 };
      expect(stockUnitClient._huModelCache).not.toBeNull();
      stockUnitClient._resetHuModelCache();
      expect(stockUnitClient._huModelCache).toBeNull();
    });
  });

  describe('GoodsIssueAdapter Facade & Integration Wiring', () => {
    it('should instantiate all 4 domain clients and delegate method calls', () => {
      expect(GoodsIssueAdapter.reservations).toBeInstanceOf(GoodsIssueReservationsClient);
      expect(GoodsIssueAdapter.batches).toBeInstanceOf(GoodsIssueBatchesClient);
      expect(GoodsIssueAdapter.stockUnits).toBeInstanceOf(GoodsIssueStockUnitClient);
      expect(GoodsIssueAdapter.posting).toBeInstanceOf(GoodsIssuePostingClient);
    });

    it('should delegate getMaterialPackagingUnits to batches client', async () => {
      const spy = jest.spyOn(GoodsIssueAdapter.batches, 'getMaterialPackagingUnits').mockResolvedValue([{ Unit: 'BOX' }]);
      const res = await GoodsIssueAdapter.getMaterialPackagingUnits('MAT01');
      expect(res).toEqual([{ Unit: 'BOX' }]);
      expect(spy).toHaveBeenCalledWith('MAT01');
      spy.mockRestore();
    });

    it('should delegate getOpenReservations to reservations client', async () => {
      const spy = jest.spyOn(GoodsIssueAdapter.reservations, 'getOpenReservations').mockResolvedValue([{ ReservationNo: '101' }]);
      const res = await GoodsIssueAdapter.getOpenReservations('261', '1120');
      expect(res).toEqual([{ ReservationNo: '101' }]);
      expect(spy).toHaveBeenCalledWith('261', '1120');
      spy.mockRestore();
    });

    it('should delegate postGoodsIssue to posting client', async () => {
      const spy = jest.spyOn(GoodsIssueAdapter.posting, 'postGoodsIssue').mockResolvedValue({ Success: true, MaterialDocument: '12345' });
      const res = await GoodsIssueAdapter.postGoodsIssue('10001', '1', 'MAT01', 10, 'KG');
      expect(res.Success).toBe(true);
      expect(spy).toHaveBeenCalledWith('10001', '1', 'MAT01', 10, 'KG', undefined, undefined, undefined, undefined, undefined);
      spy.mockRestore();
    });
  });
});
