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
            ProductName: 'Material 1',
            ResvnItmRequiredQtyInBaseUnit: '100',
            ResvnItmWithdrawnQtyInBaseUnit: '20'
          },
          {
            Reservation: '10001',
            OrderID: '40001',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT02',
            ProductName: 'Material 2',
            ResvnItmRequiredQtyInBaseUnit: '50',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          },
          {
            Reservation: '10002',
            OrderID: '',
            Plant: '1120',
            GoodsMovementType: '201',
            GoodsMovementTypeName: 'GI for cost center',
            Product: 'MAT03',
            ProductName: 'Material 3',
            ResvnItmRequiredQtyInBaseUnit: '200',
            ResvnItmWithdrawnQtyInBaseUnit: '50'
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

    it('should page through reservations and aggregate a reservation spanning page boundary whole', async () => {
      // Page 1: 100 items - 99 items for Resv 20002, and 1 item for Resv 20001
      const page1 = Array.from({ length: 99 }, (_, i) => ({
        Reservation: '20002',
        OrderID: '40002',
        Plant: '1120',
        GoodsMovementType: '261',
        GoodsMovementTypeName: 'GI for order',
        Product: `MAT_${i}`,
        ProductName: `Material ${i}`,
        ResvnItmRequiredQtyInBaseUnit: '100',
        ResvnItmWithdrawnQtyInBaseUnit: '10'
      }));
      page1.push({
        Reservation: '20001',
        OrderID: '40001',
        Plant: '1120',
        GoodsMovementType: '261',
        GoodsMovementTypeName: 'GI for order',
        Product: 'MAT_SPLIT_1',
        ProductName: 'Split Material 1',
        ResvnItmRequiredQtyInBaseUnit: '50',
        ResvnItmWithdrawnQtyInBaseUnit: '0'
      });

      // Page 2: 1 item for Resv 20001 (straddling the page boundary)
      const page2 = [
        {
          Reservation: '20001',
          OrderID: '40001',
          Plant: '1120',
          GoodsMovementType: '261',
          GoodsMovementTypeName: 'GI for order',
          Product: 'MAT_SPLIT_2',
          ProductName: 'Split Material 2',
          ResvnItmRequiredQtyInBaseUnit: '75',
          ResvnItmWithdrawnQtyInBaseUnit: '5'
        }
      ];

      const mockAdapter = {
        _get: jest.fn()
          .mockResolvedValueOnce(page1)
          .mockResolvedValueOnce(page2)
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const result = await reservationsClient.getOpenReservations('261', '1120');

      expect(mockAdapter._get).toHaveBeenCalledTimes(2);
      expect(mockAdapter._get).toHaveBeenNthCalledWith(
        1,
        '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
        expect.stringContaining('$top=100&$skip=0')
      );
      expect(mockAdapter._get).toHaveBeenNthCalledWith(
        2,
        '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
        expect.stringContaining('$top=100&$skip=100')
      );

      // Verify reservation spanning page boundary comes back whole
      const splitResv = result.find(r => r.ReservationNo === '20001');
      expect(splitResv).toBeDefined();
      expect(splitResv.ItemCount).toBe(2);
      expect(splitResv.DisplayText).toContain('2 items');

      const otherResv = result.find(r => r.ReservationNo === '20002');
      expect(otherResv).toBeDefined();
      expect(otherResv.ItemCount).toBe(99);
    });

    it('should push reservationNo and orderNo server-side into SAP OData $filter', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '18025',
            OrderID: '1000040',
            Plant: '1120',
            GoodsMovementType: '261',
            Product: 'MAT01',
            ResvnItmRequiredQtyInBaseUnit: '10',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          }
        ])
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const result = await reservationsClient.getOpenReservations('261', '1120', {
        reservationNo: '18025',
        orderNo: '1000040'
      });

      expect(mockAdapter._get).toHaveBeenCalledTimes(1);
      const urlFilter = mockAdapter._get.mock.calls[0][1];
      expect(urlFilter).toContain(encodeURIComponent("Reservation eq '18025' or Reservation eq '0000018025'"));
      expect(urlFilter).toContain(encodeURIComponent("OrderID eq '1000040' or OrderID eq '000001000040'"));
      expect(result).toHaveLength(1);
      expect(result[0].ReservationNo).toBe('18025');
      expect(result[0].IsTruncated).toBe(false);
    });

    it('should detect truncation non-silently, log diagnostic warning, and flag partial boundary reservation', async () => {
      // 2 pages of 10 items; maxItems set to 20
      const page1 = Array.from({ length: 10 }, (_, i) => ({
        Reservation: `RES_${i}`,
        OrderID: `ORD_${i}`,
        Plant: '1120',
        GoodsMovementType: '261',
        Product: 'MAT',
        ResvnItmRequiredQtyInBaseUnit: '10',
        ResvnItmWithdrawnQtyInBaseUnit: '0'
      }));
      const page2 = Array.from({ length: 9 }, (_, i) => ({
        Reservation: `RES_${i + 10}`,
        OrderID: `ORD_${i + 10}`,
        Plant: '1120',
        GoodsMovementType: '261',
        Product: 'MAT',
        ResvnItmRequiredQtyInBaseUnit: '10',
        ResvnItmWithdrawnQtyInBaseUnit: '0'
      }));
      // Boundary item at index 19 (item 20 total)
      page2.push({
        Reservation: 'RES_BOUNDARY',
        OrderID: 'ORD_BOUNDARY',
        Plant: '1120',
        GoodsMovementType: '261',
        Product: 'MAT_BOUNDARY',
        ResvnItmRequiredQtyInBaseUnit: '10',
        ResvnItmWithdrawnQtyInBaseUnit: '0'
      });

      const mockAdapter = {
        _get: jest.fn()
          .mockResolvedValueOnce(page1)
          .mockResolvedValueOnce(page2)
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const result = await reservationsClient.getOpenReservations('261', '1120', {
        maxItems: 20,
        pageSize: 10
      });

      expect(mockAdapter._get).toHaveBeenCalledTimes(2);
      expect(result.isTruncated).toBe(true);
      expect(result.totalScannedItems).toBe(20);

      const boundary = result.find(r => r.ReservationNo === 'RES_BOUNDARY');
      expect(boundary).toBeDefined();
      expect(boundary.IsTruncated).toBe(true);
      expect(boundary.ItemCountPartial).toBe(true);
      expect(boundary.DisplayText).toContain('1+ items (partial)');
      expect(boundary.TruncationNote).toContain('first 20 SAP items');

      const nonBoundary = result.find(r => r.ReservationNo === 'RES_0');
      expect(nonBoundary.IsTruncated).toBe(true);
      expect(nonBoundary.ItemCountPartial).toBe(false);
      expect(nonBoundary.DisplayText).toContain('1 item');
    });

    it('should exclude items with OpenQty <= 0 from ItemCount (single source of truth)', async () => {
      // Simulate SAP reality: items not-finally-issued but with Req=0 / Wdn=0
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '516233',
            OrderID: '1000040',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT01',
            ProductName: 'Material 1',
            ResvnItmRequiredQtyInBaseUnit: '100',
            ResvnItmWithdrawnQtyInBaseUnit: '20'
          },
          {
            Reservation: '516233',
            OrderID: '1000040',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT02',
            ProductName: 'Material 2',
            ResvnItmRequiredQtyInBaseUnit: '50',
            ResvnItmWithdrawnQtyInBaseUnit: '10'
          },
          {
            Reservation: '516233',
            OrderID: '1000040',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT03',
            ProductName: 'Material 3',
            ResvnItmRequiredQtyInBaseUnit: '75',
            ResvnItmWithdrawnQtyInBaseUnit: '25'
          },
          {
            // Item 11: Req=0, Wdn=0, Final=false — should be EXCLUDED
            Reservation: '516233',
            OrderID: '1000040',
            Plant: '1120',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Product: 'MAT04',
            ProductName: 'Material 4 (zero-qty line)',
            ResvnItmRequiredQtyInBaseUnit: '0',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          }
        ])
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const result = await reservationsClient.getOpenReservations('261', '1120');

      expect(result).toHaveLength(1);
      // ItemCount = 3, not 4 — the zero-qty line is excluded
      expect(result[0].ItemCount).toBe(3);
      expect(result[0].DisplayText).toContain('3 items');
    });

    it('should return empty array for a reservation where all items have OpenQty <= 0', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '99999',
            OrderID: '1000099',
            Plant: '1120',
            GoodsMovementType: '261',
            Product: 'MAT01',
            ProductName: 'Material 1',
            ResvnItmRequiredQtyInBaseUnit: '0',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          },
          {
            Reservation: '99999',
            OrderID: '1000099',
            Plant: '1120',
            GoodsMovementType: '261',
            Product: 'MAT02',
            ProductName: 'Material 2',
            ResvnItmRequiredQtyInBaseUnit: '50',
            ResvnItmWithdrawnQtyInBaseUnit: '50'
          }
        ])
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const result = await reservationsClient.getOpenReservations('261', '1120');

      // No items have OpenQty > 0, so the reservation is not listed
      expect(result).toHaveLength(0);
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

    it('should not include StorageBin in returned items (field removed — SAP holds no bin data)', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '1',
            OrderID: '40001',
            Product: 'MAT01',
            ProductName: 'Material 1',
            Plant: '1120',
            StorageLocation: 'CS01',
            StorageLocationName: 'Raw Material',
            BaseUnit: 'KG',
            Batch: 'BATCH_A',
            ResvnItmRequiredQtyInBaseUnit: '100',
            ResvnItmWithdrawnQtyInBaseUnit: '20',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order'
          }
        ]),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([
          { Unit: 'KG', Description: 'Kilogram', Numerator: 1, Denominator: 1, FactorToBase: 1, IsBaseUnit: true }
        ]),
        getMaterialBatches: jest.fn().mockResolvedValue([
          {
            Batch: 'BATCH_A',
            ExpiryDate: '2030-06-15',
            StatusState: 'Success',
            StatusText: 'VALID',
            AvailableStock: 500
          }
        ]),
        _enrichBatchStatus: jest.fn()
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const items = await reservationsClient.getOpenItems('40001', '10001');

      expect(items).toHaveLength(1);
      // StorageBin field was removed — SAP holds no material-to-bin data
      expect(items[0].StorageBin).toBeUndefined();
    });

    it('should set BatchStatusText to unknown when batch lookup fails, never defaulting to NO SLED', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '1',
            OrderID: '40001',
            Product: 'MAT01',
            ProductName: 'Material 1',
            Plant: '1120',
            StorageLocation: 'CS01',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '50.000',
            ResvnItmWithdrawnQtyInBaseUnit: '10.000',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Batch: 'BATCH_PREASSIGNED'
          }
        ]),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([]),
        getMaterialBatches: jest.fn().mockRejectedValue(new Error('Batch service unavailable')),
        _enrichBatchStatus: jest.fn()
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const items = await reservationsClient.getOpenItems('40001', '10001');

      expect(items).toHaveLength(1);
      expect(items[0].Batch).toBe('BATCH_PREASSIGNED');
      expect(items[0].BatchStatusText).toBe('unknown');
      expect(items[0].BatchStatusState).toBe('None');
      expect(items[0].PackagingUnits).toHaveLength(1);
      expect(items[0].PackagingUnits[0].Unit).toBe('KG');
      expect(items[0].PackagingUnits[0].Barcode).toBeUndefined();
    });

    it('should return strictly open lines — no fallback to closed items', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '1',
            OrderID: '40001',
            Product: 'MAT01',
            ProductName: 'Material 1',
            Plant: '1120',
            StorageLocation: 'CS01',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '100',
            ResvnItmWithdrawnQtyInBaseUnit: '100',
            GoodsMovementType: '261'
          },
          {
            Reservation: '10001',
            ReservationItem: '2',
            OrderID: '40001',
            Product: 'MAT02',
            ProductName: 'Material 2',
            Plant: '1120',
            StorageLocation: 'CS01',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '0',
            ResvnItmWithdrawnQtyInBaseUnit: '0',
            GoodsMovementType: '261'
          }
        ]),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([]),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const reservationsClient = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const items = await reservationsClient.getOpenItems('40001', '10001');

      // Both items have OpenQty = 0 — should return empty, not fall back to all items
      expect(items).toHaveLength(0);
    });

    it('should deduct queued quantity from OpenQty and exclude items fully queued in dispatch queue', async () => {
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
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '50.000',
            ResvnItmWithdrawnQtyInBaseUnit: '10.000',
            GoodsMovementType: '261'
          },
          {
            Reservation: '10001',
            ReservationItem: '2',
            OrderID: '40001',
            Product: 'MAT02',
            ProductName: 'Material 2',
            Plant: '1120',
            StorageLocation: '1120',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '30.000',
            ResvnItmWithdrawnQtyInBaseUnit: '0.000',
            GoodsMovementType: '261'
          }
        ]),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([]),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const mockQueueManager = {
        getPendingQueueMap: jest.fn().mockResolvedValue(new Map([
          ['10001:1', { queuedQty: 15, finalIssue: false }], // 40 open - 15 queued = 25 open
          ['10001:2', { queuedQty: 30, finalIssue: false }]  // 30 open - 30 queued = 0 open -> excluded!
        ]))
      };

      const reservationsClient = new GoodsIssueReservationsClient({
        adapter: mockAdapter,
        queueManager: mockQueueManager
      });

      const items = await reservationsClient.getOpenItems('40001', '10001');

      // Item 2 is fully queued, so only Item 1 is returned
      expect(items).toHaveLength(1);
      expect(items[0].ReservationItem).toBe('0001');
      expect(items[0].RequiredQty).toBe(50);
      expect(items[0].WithdrawnQty).toBe(10);
      expect(items[0].QueuedQty).toBe(15);
      expect(items[0].OpenQty).toBe(25); // 50 - 10 - 15
    });

    it('should deduct queued quantity in getOpenReservations and skip reservation if all items are queued', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '1',
            OrderID: '40001',
            Product: 'MAT01',
            ResvnItmRequiredQtyInBaseUnit: '20',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          },
          {
            Reservation: '20002',
            ReservationItem: '1',
            OrderID: '40002',
            Product: 'MAT02',
            ResvnItmRequiredQtyInBaseUnit: '50',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          }
        ])
      };

      const mockQueueManager = {
        getPendingQueueMap: jest.fn().mockResolvedValue(new Map([
          ['10001:1', { queuedQty: 20, finalIssue: false }], // fully queued
          ['20002:1', { queuedQty: 10, finalIssue: false }]  // partially queued (40 remaining)
        ]))
      };

      const reservationsClient = new GoodsIssueReservationsClient({
        adapter: mockAdapter,
        queueManager: mockQueueManager
      });

      const reservations = await reservationsClient.getOpenReservations('261');

      // Reservation 10001 is completely queued, so only 20002 is listed
      expect(reservations).toHaveLength(1);
      expect(reservations[0].ReservationNo).toBe('20002');
      expect(reservations[0].ItemCount).toBe(1);
    });

    it('should exclude items with FinalIssue queued in dispatch queue even if queued qty is less than open qty', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '1',
            OrderID: '40001',
            Product: 'MAT01',
            ResvnItmRequiredQtyInBaseUnit: '100',
            ResvnItmWithdrawnQtyInBaseUnit: '0'
          }
        ]),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([]),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const mockQueueManager = {
        getPendingQueueMap: jest.fn().mockResolvedValue(new Map([
          ['10001:1', { queuedQty: 20, finalIssue: true }] // Final issue marked
        ]))
      };

      const reservationsClient = new GoodsIssueReservationsClient({
        adapter: mockAdapter,
        queueManager: mockQueueManager
      });

      const items = await reservationsClient.getOpenItems('40001', '10001');
      expect(items).toHaveLength(0);
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
      expect(units[0].Barcode).toBeUndefined();
      expect(units[1].IsBaseUnit).toBe(true);
      expect(units[1].Barcode).toBeUndefined();
    });

    it('should exclude expired batches and sort remaining by FEFO with batch-grain stock in getMaterialBatches', async () => {
      const mockAdapter = {
        _get: jest.fn().mockImplementation((path) => {
          if (path.includes('MaterialMultiStockByDates')) {
            return Promise.resolve([
              { Batch: 'B_SOONER', CurrentStock: '500', BaseUnit: 'KG', StorageLocation: 'CS01' },
              { Batch: 'B_LATER', CurrentStock: '200', BaseUnit: 'KG', StorageLocation: 'CS01' }
            ]);
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
      const batches = await batchesClient.getMaterialBatches('MAT01', '1120', 'CS01');

      expect(batches).toHaveLength(2);
      expect(batches[0].Batch).toBe('B_SOONER');
      expect(batches[0].AvailableStock).toBe(500);
      expect(batches[0].IsSelectable).toBe(true);
      expect(batches[1].Batch).toBe('B_LATER');
      expect(batches[1].AvailableStock).toBe(200);
      expect(batches[1].IsSelectable).toBe(true);
    });

    it('should set AvailableStock: null and keep IsSelectable: true when batch stock is unknown (never silent zero)', async () => {
      const mockAdapter = {
        _get: jest.fn().mockImplementation((path) => {
          if (path.includes('MaterialMultiStockByDates')) {
            // Stock lookup fails or returns empty array
            return Promise.resolve([]);
          }
          if (path.includes('I_Batch')) {
            return Promise.resolve([
              { Batch: 'B_UNKNOWN_STOCK', ShelfLifeExpirationDate: '/Date(1893456000000)/', Plant: '1120' }
            ]);
          }
          return Promise.resolve([]);
        }),
        _enrichBatchStatus: (d) => GoodsIssueAdapter._enrichBatchStatus(d),
        _formatDate: (d) => GoodsIssueAdapter._formatDate(d)
      };

      const batchesClient = new GoodsIssueBatchesClient({ adapter: mockAdapter });
      const batches = await batchesClient.getMaterialBatches('MAT03', '1120', 'CS01');

      expect(batches).toHaveLength(1);
      expect(batches[0].Batch).toBe('B_UNKNOWN_STOCK');
      // Unknown stock must NEVER become silent zero
      expect(batches[0].AvailableStock).toBeNull();
      // An unexpired batch with unknown stock must remain selectable, not blocked
      expect(batches[0].IsSelectable).toBe(true);
    });

    it('should mark confirmed zero-stock batches as IsSelectable: false in getMaterialBatches', async () => {
      const mockAdapter = {
        _get: jest.fn().mockImplementation((path) => {
          if (path.includes('MaterialMultiStockByDates')) {
            return Promise.resolve([{ Batch: 'B_ZERO_STOCK', CurrentStock: '0', BaseUnit: 'KG' }]);
          }
          if (path.includes('I_Batch')) {
            return Promise.resolve([
              { Batch: 'B_ZERO_STOCK', ShelfLifeExpirationDate: '/Date(1893456000000)/', Plant: '1120' }
            ]);
          }
          return Promise.resolve([]);
        }),
        _enrichBatchStatus: (d) => GoodsIssueAdapter._enrichBatchStatus(d),
        _formatDate: (d) => GoodsIssueAdapter._formatDate(d)
      };

      const batchesClient = new GoodsIssueBatchesClient({ adapter: mockAdapter });
      const batches = await batchesClient.getMaterialBatches('MAT02', '1120', 'CS01');

      expect(batches).toHaveLength(1);
      expect(batches[0].Batch).toBe('B_ZERO_STOCK');
      expect(batches[0].AvailableStock).toBe(0);
      expect(batches[0].IsSelectable).toBe(false);
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

    it('should successfully post batch Goods Issue via Tier 1 RAP service when available', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        AllPosted: true,
        Results: [
          { ReservationItem: '0001', Success: true, MaterialDocument: '4900001111' },
          { ReservationItem: '0002', Success: true, MaterialDocument: '4900001111' }
        ],
        Messages: ['Batch posted successfully']
      });
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const items = [
        { ReservationItem: '1', Material: 'MAT01', IssueQty: 10, Unit: 'KG' },
        { ReservationItem: '2', Material: 'MAT02', IssueQty: 20, Unit: 'PC' }
      ];

      const res = await postingClient.submitGoodsIssueRequest('18025', '1000040', items);

      expect(res.AllPosted).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost.mock.calls[0][0]).toContain('zui_gi_order_rsv_o4/0001/submitRequest');
    });

    it('should fallback to Tier 2 API_MATERIAL_DOCUMENT_SRV deep insert when Tier 1 returns 404', async () => {
      const v4Err = new Error('HTTP 404 Not Found');
      v4Err.status = 404;

      const mockPost = jest.fn()
        .mockRejectedValueOnce(v4Err)
        .mockResolvedValueOnce({
          MaterialDocument: '4900005555',
          MaterialDocYear: '2026'
        });

      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const items = [
        { ReservationItem: '1', Material: 'MAT01', IssueQty: 10, Unit: 'KG', Batch: 'B01', DifferenceQty: 2 },
        { ReservationItem: '2', Material: 'MAT02', IssueQty: 25, Unit: 'KG', Batch: 'B02' }
      ];

      const res = await postingClient.submitGoodsIssueRequest('18025', '1000040', items);

      expect(res.AllPosted).toBe(true);
      expect(res.Results).toHaveLength(2);
      expect(res.Results[0].ReservationItem).toBe('0001');
      expect(res.Results[0].MaterialDocument).toBe('4900005555');
      expect(res.Results[0].DifferenceCleared).toBe(true);
      expect(res.Results[1].ReservationItem).toBe('0002');
      expect(res.Results[1].MaterialDocument).toBe('4900005555');

      // Verify Tier 2 deep-insert call arguments
      expect(mockPost).toHaveBeenCalledTimes(2);
      expect(mockPost.mock.calls[1][0]).toBe('/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
      const v2Payload = mockPost.mock.calls[1][1];
      expect(v2Payload.GoodsMovementCode).toBe('03');
      expect(v2Payload.to_MaterialDocumentItem.results).toHaveLength(2);
      expect(v2Payload.to_MaterialDocumentItem.results[0]).toEqual({
        Material: 'MAT01',
        GoodsMovementType: '261',
        EntryUnit: 'KG',
        QuantityInEntryUnit: '10',
        Reservation: '18025',
        ReservationItem: '0001',
        Batch: 'B01'
      });
      expect(v2Payload.to_MaterialDocumentItem.results[1]).toEqual({
        Material: 'MAT02',
        GoodsMovementType: '261',
        EntryUnit: 'KG',
        QuantityInEntryUnit: '25',
        Reservation: '18025',
        ReservationItem: '0002',
        Batch: 'B02'
      });
    });

    it('should distinguish 403 from 404 in submitGoodsIssueRequest and specify required SAP teams', async () => {
      const v4Err = new Error('Not Found');
      v4Err.status = 404;
      const v2Err = new Error('Forbidden');
      v2Err.status = 403;

      const mockPost = jest.fn()
        .mockRejectedValueOnce(v4Err)
        .mockRejectedValueOnce(v2Err);

      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const items = [{ ReservationItem: '1', Material: 'MAT01', IssueQty: 10, Unit: 'KG' }];

      try {
        await postingClient.submitGoodsIssueRequest('18025', '1000040', items);
        throw new Error('Expected submitGoodsIssueRequest to throw');
      } catch (err) {
        expect(err.status).toBe(501);
        expect(err.message).toContain('HTTP 404 - NOT PUBLISHED');
        expect(err.message).toContain('ABAP/Basis');
        expect(err.message).toContain('it IS registered and this is an authorization failure');
        expect(err.message).toContain('Security must grant S_SERVICE');
      }
    });

    it('should throw validation error when an item is missing Unit in postGoodsIssue', async () => {
      const postingClient = new GoodsIssuePostingClient();
      await expect(postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, ''))
        .rejects.toThrow(/Unit of measure \(EntryUnit\) is required for Goods Issue/);
    });

    it('should distinguish 403 from 404 in postGoodsIssue and specify required SAP teams', async () => {
      const v4Err = new Error('HTTP 404 Not Found');
      v4Err.status = 404;
      const v2Err = new Error('HTTP 403 Forbidden');
      v2Err.status = 403;

      const mockPost = jest.fn()
        .mockRejectedValueOnce(v4Err)
        .mockRejectedValueOnce(v2Err);

      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      try {
        await postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, 'KG', 'B01');
        throw new Error('Expected postGoodsIssue to throw');
      } catch (err) {
        expect(err.status).toBe(501);
        expect(err.message).toContain('HTTP 404 - NOT PUBLISHED');
        expect(err.message).toContain('ABAP/Basis');
        expect(err.message).toContain('it IS registered and this is an authorization failure');
        expect(err.message).toContain('Security must grant S_SERVICE');
      }
    });

    it('should read a 403 carrying /IWFND/MED/170 as NOT REGISTERED, not as an authorization failure', async () => {
      const v4Err = new Error('HTTP 404 Not Found');
      v4Err.status = 404;
      // Verbatim shape DS4 client 220 returns for an unregistered service.
      const v2Err = new Error("/IWFND/MED/170 No service found for namespace '', name 'API_MATERIAL_DOCUMENT_SRV', version '0001'");
      v2Err.status = 403;

      const mockPost = jest.fn()
        .mockRejectedValueOnce(v4Err)
        .mockRejectedValueOnce(v2Err);

      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      try {
        await postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, 'KG', 'B01');
        throw new Error('Expected postGoodsIssue to throw');
      } catch (err) {
        expect(err.status).toBe(501);
        expect(err.message).toContain('NOT REGISTERED');
        expect(err.message).toContain('/IWFND/MAINT_SERVICE');
        expect(err.message).toContain('registration task, not an authorization grant');
        expect(err.message).not.toContain('Security must grant S_SERVICE');
      }
    });

    it('should not invent an HTTP status when the error carries none', async () => {
      const v4Err = new Error('connect ETIMEDOUT');   // no .status
      const v2Err = new Error('socket hang up');      // no .status

      const mockPost = jest.fn()
        .mockRejectedValueOnce(v4Err)
        .mockRejectedValueOnce(v2Err);

      const mockAdapter = {
        validateBatch: jest.fn().mockResolvedValue({ valid: true }),
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: mockPost
      };
      const postingClient = new GoodsIssuePostingClient({ adapter: mockAdapter });

      try {
        await postingClient.postGoodsIssue('18025', '1', 'MAT01', 10, 'KG', 'B01');
        throw new Error('Expected postGoodsIssue to throw');
      } catch (err) {
        expect(err.message).toContain('no HTTP status');
        expect(err.message).not.toContain('NOT PUBLISHED');
        expect(err.message).not.toContain('NOT REGISTERED');
      }
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
      expect(res.CurrentStock).toBe(50);
      expect(res.SuStockQty).toBe(50);
      expect(res.MaxIssueQty).toBe(50);
      expect(res.ReservationRemainingQty).toBe(80);
    });

    it('should default missing determined batch status to unknown and None, never VALID or Success', async () => {
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
                StorageLocation: 'CS01',
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
        getOpenItems: jest.fn().mockResolvedValue([
          {
            ReservationNo: '10001',
            ReservationItem: '0001',
            Material: 'MAT01',
            Plant: '1120',
            StorageLocation: 'CS01',
            OpenQty: 50,
            RequiredQty: 50,
            BaseUnit: 'KG'
          }
        ]),
        getMaterialBatches: jest.fn().mockResolvedValue([
          {
            Batch: 'BATCH_NO_STATUS',
            ExpiryDate: null,
            StatusState: '',
            StatusText: '',
            AvailableStock: 50
          }
        ])
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      const res = await stockUnitClient.resolveStockUnitForGoodsIssue('BATCH_NO_STATUS', '10001', '0001');

      expect(res.DeterminedBatch).toBe('BATCH_NO_STATUS');
      expect(res.DeterminedBatchStatusText).toBe('unknown');
      expect(res.DeterminedBatchStatusState).toBe('None');
    });

    it('should preserve null for unknown stock in resolveStockUnitForGoodsIssue and not clamp MaxIssueQty to 0', async () => {
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
          return Promise.resolve([]);
        }),
        getMaterialBatches: jest.fn().mockResolvedValue([
          {
            Batch: 'BATCH_UNKNOWN',
            ExpiryDate: '2030-01-01',
            StatusState: 'Success',
            StatusText: 'VALID',
            DaysToExpiry: 1500,
            AvailableStock: null,
            StorageBin: 'BIN-10'
          }
        ])
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      const res = await stockUnitClient.resolveStockUnitForGoodsIssue('BATCH_UNKNOWN', '10001', '0001');

      expect(res.SuExists).toBe(true);
      expect(res.ResolvedType).toBe('BATCH');
      expect(res.DeterminedBatch).toBe('BATCH_UNKNOWN');
      // Unknown stock must remain null, never silent zero
      expect(res.CurrentStock).toBeNull();
      expect(res.SuStockQty).toBeNull();
      // MaxIssueQty must not be clamped to 0 when stock is unknown; defaults to open quantity (80)
      expect(res.MaxIssueQty).toBe(80);
      expect(res.ReservationRemainingQty).toBe(80);
    });

    it('should not treat unknown stock (null) as zero in Handling Unit branch and not clamp MaxIssueQty to 0', async () => {
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
          // MaterialStorLocHelps and C_STOCKQUANTITYVALUEBYTYPE return empty => currentStock is null
          return Promise.resolve([]);
        }),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      stockUnitClient._discoverHuModel = jest.fn().mockResolvedValue({
        base: '/scwm/test',
        warehouse: 'W01',
        huIdField: 'HUId'
      });
      stockUnitClient._findHuByBarcode = jest.fn().mockResolvedValue({ HUId: 'HU_TEST_01' });
      stockUnitClient._readHuContents = jest.fn().mockResolvedValue({
        primary: { material: 'MAT01', plant: '1120', sloc: '1120', qty: 0, unit: 'KG' },
        items: []
      });

      const res = await stockUnitClient.resolveStockUnitForGoodsIssue('HU_TEST_01', '10001', '0001');

      expect(res.SuExists).toBe(true);
      expect(res.ResolvedType).toBe('HANDLING_UNIT');
      // Unknown stock must remain null, never treated as <= 0 or zero
      expect(res.CurrentStock).toBeNull();
      expect(res.SuStockQty).toBeNull();
      // MaxIssueQty must not be clamped to 0 by Math.min(null, openQty); defaults to open quantity (80)
      expect(res.MaxIssueQty).toBe(80);
      expect(res.ReservationRemainingQty).toBe(80);
    });

    it('should constrain MaxIssueQty by suQty when stock is unknown (null) in Handling Unit branch', async () => {
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
          return Promise.resolve([]);
        }),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      stockUnitClient._discoverHuModel = jest.fn().mockResolvedValue({
        base: '/scwm/test',
        warehouse: 'W01',
        huIdField: 'HUId'
      });
      stockUnitClient._findHuByBarcode = jest.fn().mockResolvedValue({ HUId: 'HU_TEST_02' });
      stockUnitClient._readHuContents = jest.fn().mockResolvedValue({
        primary: { material: 'MAT01', plant: '1120', sloc: '1120', qty: 25, unit: 'KG' },
        items: []
      });

      const res = await stockUnitClient.resolveStockUnitForGoodsIssue('HU_TEST_02', '10001', '0001');

      expect(res.CurrentStock).toBeNull();
      expect(res.SuStockQty).toBe(25);
      // MaxIssueQty is constrained by HU physical quantity Math.min(25, 80) = 25
      expect(res.MaxIssueQty).toBe(25);
    });

    it('should reject with 422 when SAP explicitly reports 0 stock in Handling Unit branch', async () => {
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
            return Promise.resolve([{ CurrentStock: '0', BaseUnit: 'KG' }]);
          }
          return Promise.resolve([]);
        }),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      stockUnitClient._discoverHuModel = jest.fn().mockResolvedValue({
        base: '/scwm/test',
        warehouse: 'W01',
        huIdField: 'HUId'
      });
      stockUnitClient._findHuByBarcode = jest.fn().mockResolvedValue({ HUId: 'HU_TEST_03' });
      stockUnitClient._readHuContents = jest.fn().mockResolvedValue({
        primary: { material: 'MAT01', plant: '1120', sloc: '1120', qty: 10, unit: 'KG' },
        items: []
      });

      await expect(stockUnitClient.resolveStockUnitForGoodsIssue('HU_TEST_03', '10001', '0001'))
        .rejects.toMatchObject({
          status: 422,
          message: expect.stringContaining('SAP reports no stock there')
        });
    });

    it('should deduct queued quantity in resolveStockUnitForGoodsIssue and reject with 400 when no open quantity remains', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            Reservation: '10001',
            ReservationItem: '0001',
            OrderID: '40001',
            Product: 'MAT01',
            Plant: '1120',
            StorageLocation: '1120',
            BaseUnit: 'KG',
            ResvnItmRequiredQtyInBaseUnit: '100',
            ResvnItmWithdrawnQtyInBaseUnit: '20' // 80 open in SAP
          }
        ]),
        getMaterialBatches: jest.fn().mockResolvedValue([])
      };

      const mockQueueManager = {
        getPendingQueueMap: jest.fn().mockResolvedValue(new Map([
          ['10001:1', { queuedQty: 80, finalIssue: false }] // All 80 are in dispatch queue
        ]))
      };

      const stockUnitClient = new GoodsIssueStockUnitClient({
        adapter: mockAdapter,
        queueManager: mockQueueManager
      });

      await expect(stockUnitClient.resolveStockUnitForGoodsIssue('BATCH01', '10001', '0001'))
        .rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('has no open quantity remaining (already fully issued or queued in dispatch)')
        });
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

    it('should filter zero-stock batches from AvailableBatches and avoid auto-picking empty batch in resolveIdentifier', async () => {
      const spyOpen = jest.spyOn(GoodsIssueAdapter, 'getOpenItems').mockResolvedValue([
        {
          ReservationNo: '375047',
          ReservationItem: '0001',
          OrderNo: '1001952',
          Material: '3000000297',
          Plant: '1120',
          StorageLocation: 'CS01',
          OpenQty: 100,
          Batch: ''
        }
      ]);
      const spyBatches = jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue([
        {
          Batch: '345B250001',
          AvailableStock: 0,
          IsSelectable: false,
          StatusState: 'Success',
          StatusText: 'VALID',
          ExpiryDate: '2026-12-19'
        }
      ]);

      const res = await GoodsIssueAdapter.resolveIdentifier('375047');
      expect(res.AvailableBatches).toHaveLength(0);
      expect(res.ActiveItem.Batch).toBe('');
      expect(res.AvailableStock).toBe(0);

      spyOpen.mockRestore();
      spyBatches.mockRestore();
    });

    it('should preserve unknown stock as null in AvailableBatches and AvailableStock, never defaulting to 0', async () => {
      const spyOpen = jest.spyOn(GoodsIssueAdapter, 'getOpenItems').mockResolvedValue([
        {
          ReservationNo: '375048',
          ReservationItem: '0001',
          OrderNo: '1001953',
          Material: '3000000298',
          Plant: '1120',
          StorageLocation: 'CS01',
          OpenQty: 50,
          Batch: ''
        }
      ]);
      const spyBatches = jest.spyOn(GoodsIssueAdapter, 'getMaterialBatches').mockResolvedValue([
        {
          Batch: 'BATCH_NULL_STOCK',
          AvailableStock: null,
          IsSelectable: true,
          StatusState: 'Success',
          StatusText: 'VALID',
          ExpiryDate: '2028-12-19'
        }
      ]);

      const res = await GoodsIssueAdapter.resolveIdentifier('375048');
      expect(res.AvailableBatches).toHaveLength(1);
      expect(res.AvailableBatches[0].AvailableStock).toBeNull();
      expect(res.ActiveItem.Batch).toBe('BATCH_NULL_STOCK');
      // Unknown stock must remain null, never silent 0
      expect(res.AvailableStock).toBeNull();

      spyOpen.mockRestore();
      spyBatches.mockRestore();
    });
  });
});
