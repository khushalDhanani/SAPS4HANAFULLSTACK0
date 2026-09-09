const EwmMapper = require('../../../srv/integration/s4hana/ewm/EwmMapper');

describe('Unit: EWM Mapping (EwmMapper)', () => {
  describe('mapWarehouse', () => {
    it('should map warehouse with English and German text prioritizing English', () => {
      const s4Data = {
        Warehouse: '0001',
        to_WarehouseText: {
          results: [
            { Language: 'DE', WarehouseName: 'Zentrallager' },
            { Language: 'EN', WarehouseName: 'Central Warehouse' }
          ]
        }
      };
      const result = EwmMapper.mapWarehouse(s4Data);
      expect(result).toEqual({
        Warehouse: '0001',
        WarehouseName: 'Central Warehouse'
      });
    });

    it('should fallback to German or first text if English is missing', () => {
      const s4Data = {
        Warehouse: '0002',
        to_WarehouseText: {
          results: [
            { Language: 'DE', WarehouseName: 'Regionallager' }
          ]
        }
      };
      const result = EwmMapper.mapWarehouse(s4Data);
      expect(result).toEqual({
        Warehouse: '0002',
        WarehouseName: 'Regionallager'
      });
    });

    it('should return null if input is falsy', () => {
      expect(EwmMapper.mapWarehouse(null)).toBeNull();
    });
  });

  describe('mapStorageType', () => {
    it('should map storage type with multilingual names', () => {
      const s4Data = {
        Warehouse: '0001',
        StorageType: '0010',
        to_WarehouseStorageTypeText: {
          results: [
            { Language: 'DE', StorageTypeName: 'Hochregallager' },
            { Language: 'EN', StorageTypeName: 'High Rack Storage' }
          ]
        }
      };
      const result = EwmMapper.mapStorageType(s4Data);
      expect(result).toEqual({
        Warehouse: '0001',
        StorageType: '0010',
        StorageTypeName: 'High Rack Storage'
      });
    });
  });

  describe('mapStorageBin', () => {
    it('should map storage bin attributes accurately', () => {
      const s4Data = {
        Warehouse: '0001',
        StorageBin: 'BIN-01-01-01',
        StorageType: '0010',
        StorageSection: '0001',
        StorageBinType: 'B01',
        MaximumWeight: '1000.500',
        WeightUnit: 'KG',
        StorageBinIsBlockedForPutaway: 'X',
        StorageBinIsBlockedForRemoval: ''
      };
      const result = EwmMapper.mapStorageBin(s4Data);
      expect(result).toEqual({
        Warehouse: '0001',
        StorageBin: 'BIN-01-01-01',
        StorageType: '0010',
        StorageSection: '0001',
        StorageBinType: 'B01',
        MaxWeight: '1000.500',
        WeightUnit: 'KG',
        IsBlockedForPutaway: true,
        IsBlockedForRemoval: false
      });
    });
  });

  describe('mapWarehouseTask', () => {
    it('should map warehouse task with quantity conversion', () => {
      const s4Data = {
        Warehouse: '0001',
        WarehouseTask: '10001234',
        WarehouseOrder: '5001',
        WarehouseProcessType: '1010',
        WarehouseProcessCategory: '1',
        WarehouseTaskStatus: 'O',
        Product: 'TG11',
        ProductDescription: 'Standard Bicycle',
        TargetQuantityInBaseUnit: '10.000',
        ConfirmedQuantityInBaseUnit: '0.000',
        BaseUnit: 'EA',
        SourceStorageType: '0010',
        SourceStorageBin: 'BIN-01',
        TargetStorageType: '8030',
        TargetStorageBin: 'PACK-01',
        CreationDate: '/Date(1725753600000)/',
        ConfirmedByUser: ''
      };
      const result = EwmMapper.mapWarehouseTask(s4Data);
      expect(result.Warehouse).toBe('0001');
      expect(result.WarehouseTask).toBe('10001234');
      expect(result.TargetQuantity).toBe(10);
      expect(result.ConfirmedQuantity).toBe(0);
      expect(result.BaseUnit).toBe('EA');
      expect(result.SourceStorageBin).toBe('BIN-01');
      expect(result.TargetStorageBin).toBe('PACK-01');
    });
  });

  describe('mapInboundDelivery & mapOutboundDelivery', () => {
    it('should map inbound delivery header and items', () => {
      const s4Data = {
        Warehouse: '0001',
        DeliveryDocument: '180000123',
        Supplier: '100000',
        SupplierName: 'Acme Corp',
        OverallGoodsReceiptStatus: 'A',
        DeliveryDate: '2026-09-10',
        to_InboundDeliveryItem: {
          results: [
            {
              Warehouse: '0001',
              DeliveryDocument: '180000123',
              DeliveryDocumentItem: '10',
              Product: 'MAT-A',
              ProductDescription: 'Material A',
              ActualDeliveryQuantity: '50.000',
              DeliveryQuantityUnit: 'EA',
              GoodsReceiptStatus: 'A'
            }
          ]
        }
      };
      const result = EwmMapper.mapInboundDelivery(s4Data);
      expect(result.DeliveryDocument).toBe('180000123');
      expect(result.SupplierName).toBe('Acme Corp');
      expect(result.Items).toHaveLength(1);
      expect(result.Items[0].DeliveryQuantity).toBe(50);
    });

    it('should map inbound delivery header and items using to_WhseInboundDeliveryItem with purchasing document', () => {
      const s4Data = {
        Warehouse: '0001',
        InboundDelivery: '180000124',
        ShipFromParty: '100000',
        ShipFromPartyName: 'Acme Corp',
        DeliveryType: 'INB',
        OverallGoodsReceiptStatus: 'A',
        PlannedDeliveryUTCDateTime: '2026-09-10T12:00:00.000Z',
        to_WhseInboundDeliveryItem: {
          results: [
            {
              Warehouse: '0001',
              InboundDelivery: '180000124',
              InboundDeliveryItem: '10',
              Product: '1000000003',
              ProductDescription: 'Test Material',
              ProductQuantity: '100.000',
              QuantityUnit: 'KG',
              GoodsReceiptStatus: 'A',
              PurchasingDocument: '4500000001',
              PurchasingDocumentItem: '10',
              PutawayStatus: 'A'
            }
          ]
        }
      };
      const result = EwmMapper.mapInboundDelivery(s4Data);
      expect(result.DeliveryDocument).toBe('180000124');
      expect(result.SupplierName).toBe('Acme Corp');
      expect(result.DeliveryDate).toBe('2026-09-10');
      expect(result.Items).toHaveLength(1);
      expect(result.Items[0].DeliveryQuantity).toBe(100);
      expect(result.Items[0].DeliveryQuantityUnit).toBe('KG');
      expect(result.Items[0].PurchasingDocument).toBe('4500000001');
      expect(result.Items[0].PurchasingDocumentItem).toBe('10');
    });

    it('should never assign Supplier to Warehouse and should use defaultWarehouse when Warehouse is absent', () => {
      const s4Data = {
        DeliveryDocument: '180000125',
        Supplier: '100003',
        SupplierName: 'Divis Laboratories',
        OverallGoodsReceiptStatus: 'A'
      };
      const result = EwmMapper.mapInboundDelivery(s4Data, 'W22');
      expect(result.Warehouse).toBe('W22');
      expect(result.Supplier).toBe('100003');
      expect(result.DeliveryDocument).toBe('180000125');
    });

    it('should map outbound delivery order header and items', () => {
      const s4Data = {
        Warehouse: '0001',
        OutboundDeliveryOrder: '80000456',
        ShipToParty: '200001',
        ShipToPartyName: 'Global Logistics',
        OverallGoodsIssueStatus: 'A',
        OverallPickingStatus: 'B',
        PlannedGoodsIssueDate: '2026-09-12',
        to_OutboundDeliveryOrderItem: {
          results: [
            {
              Warehouse: '0001',
              OutboundDeliveryOrder: '80000456',
              OutboundDeliveryOrderItem: '10',
              Product: 'MAT-B',
              ProductDescription: 'Material B',
              ActualDeliveryQuantity: '25.000',
              DeliveryQuantityUnit: 'EA',
              PickingStatus: 'B'
            }
          ]
        }
      };
      const result = EwmMapper.mapOutboundDelivery(s4Data);
      expect(result.OutboundDeliveryOrder).toBe('80000456');
      expect(result.ShipToPartyName).toBe('Global Logistics');
      expect(result.Items).toHaveLength(1);
      expect(result.Items[0].DeliveryQuantity).toBe(25);
    });

    it('should map outbound delivery order using to_WhseOutboundDeliveryOrderItem with live properties', () => {
      const s4Data = {
        Warehouse: '0001',
        OutboundDeliveryOrder: '80000457',
        ShipToParty: '200002',
        ShipToPartyName: 'Logistics Partner Inc',
        DeliveryType: 'OUT',
        OverallGoodsIssueStatus: 'A',
        PlannedDeliveryUTCDateTime: '2026-09-15T08:30:00.000Z',
        to_WhseOutboundDeliveryOrderItem: {
          results: [
            {
              Warehouse: '0001',
              OutboundDeliveryOrder: '80000457',
              OutboundDeliveryOrderItem: '10',
              Product: '1000000003',
              ProductDescription: 'Test Material',
              ProductQuantity: '30.000',
              QuantityUnit: 'KG',
              PickingStatus: 'A'
            }
          ]
        }
      };
      const result = EwmMapper.mapOutboundDelivery(s4Data);
      expect(result.OutboundDeliveryOrder).toBe('80000457');
      expect(result.ShipToPartyName).toBe('Logistics Partner Inc');
      expect(result.DeliveryDate).toBeUndefined();
      expect(result.PlannedGoodsIssueDate).toBe('2026-09-15');
      expect(result.Items).toHaveLength(1);
      expect(result.Items[0].DeliveryQuantity).toBe(30);
      expect(result.Items[0].DeliveryQuantityUnit).toBe('KG');
    });

    it('should map outbound delivery with to_ShipToParty navigation and OutboundDelivery field', () => {
      const s4Data = {
        ShippingPoint: '1120',
        OutboundDelivery: '10000000',
        ShipToParty: '1120',
        to_ShipToParty: {
          CustomerName: "Divi's Laboratories Limited"
        },
        OverallGoodsIssueStatus: 'A',
        PlannedDeliveryUTCDateTime: '2026-09-10T00:00:00.000Z'
      };
      const result = EwmMapper.mapOutboundDelivery(s4Data);
      expect(result.Warehouse).toBe('1120');
      expect(result.OutboundDeliveryOrder).toBe('10000000');
      expect(result.ShipToPartyName).toBe("Divi's Laboratories Limited");
      expect(result.PlannedGoodsIssueDate).toBe('2026-09-10');
    });
  });

  describe('mapStorageLocationToStorageType and mapStorageLocationToStorageBin', () => {
    it('should map storage location to storage type', () => {
      const loc = {
        Plant: '1120',
        StorageLocation: 'CS01',
        StorageLocationName: 'Chemical Storage 01'
      };
      const result = EwmMapper.mapStorageLocationToStorageType(loc);
      expect(result).toEqual({
        Warehouse: '1120',
        StorageType: 'CS01',
        StorageTypeName: 'Chemical Storage 01'
      });
    });

    it('should map storage location to representative storage bin', () => {
      const loc = {
        Plant: '1120',
        StorageLocation: 'FG01'
      };
      const result = EwmMapper.mapStorageLocationToStorageBin(loc);
      expect(result).toEqual({
        Warehouse: '1120',
        StorageBin: 'FG01-01-01',
        StorageType: 'FG01',
        StorageSection: '0001',
        StorageBinType: 'STD',
        MaxWeight: 1000,
        WeightUnit: 'KG',
        IsBlockedForPutaway: false,
        IsBlockedForRemoval: false
      });
    });

    it('should return null when input is falsy', () => {
      expect(EwmMapper.mapStorageLocationToStorageType(null)).toBeNull();
      expect(EwmMapper.mapStorageLocationToStorageBin(null)).toBeNull();
    });
  });

  describe('formatDate', () => {
    it('should parse SAP epoch timestamp', () => {
      const epoch = 1725753600000;
      const formatted = EwmMapper.formatDate(`/Date(${epoch})/`);
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should parse standard ISO string', () => {
      expect(EwmMapper.formatDate('2026-09-08T10:00:00.000Z')).toBe('2026-09-08');
    });

    it('should return null for empty or undefined dates', () => {
      expect(EwmMapper.formatDate(null)).toBeNull();
      expect(EwmMapper.formatDate(undefined)).toBeNull();
    });
  });

  describe('mapWarehouseResource', () => {
    it('should map SAP WarehouseResource to CAP model', () => {
      const s4Data = {
        Warehouse: '0001',
        WarehouseResource: 'CART-01',
        ResourceType: 'CART',
        AssignedQueue: 'PICK_FAST',
        UserName: 'ALICE',
        ResourceLogonDateTime: '1725790000000'
      };
      const result = EwmMapper.mapWarehouseResource(s4Data);
      expect(result).toEqual({
        Warehouse: '0001',
        Resource: 'CART-01',
        ResourceType: 'CART',
        AssignedQueue: 'PICK_FAST',
        LogonStatus: 'LOGGED_ON',
        UserName: 'ALICE',
        ResourceLogonDateTime: '1725790000000'
      });
    });

    it('should set LogonStatus to AVAILABLE when UserName is empty', () => {
      const s4Data = {
        Warehouse: '0001',
        WarehouseResource: 'FORK-01',
        UserName: ''
      };
      const result = EwmMapper.mapWarehouseResource(s4Data);
      expect(result.LogonStatus).toBe('AVAILABLE');
      expect(result.Resource).toBe('FORK-01');
    });

    it('should return null for null input', () => {
      expect(EwmMapper.mapWarehouseResource(null)).toBeNull();
    });
  });
});
