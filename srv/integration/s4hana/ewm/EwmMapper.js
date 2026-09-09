/**
 * Mapper utility for SAP S/4HANA EWM (Extended Warehouse Management) data.
 * Transforms remote S/4HANA Gateway payloads to CAP entities and validates contracts.
 */
class EwmMapper {
  /**
   * Map S/4HANA Warehouse entity to CAP Warehouse model
   */
  static mapWarehouse(s4Whse) {
    if (!s4Whse) return null;
    const texts = s4Whse.to_WarehouseText?.results || [];
    const enText = texts.find(t => t.Language === 'EN')?.WarehouseName;
    const deText = texts.find(t => t.Language === 'DE')?.WarehouseName;
    const fallbackText = texts[0]?.WarehouseName || '';

    return {
      Warehouse: s4Whse.Warehouse || '',
      WarehouseName: enText || deText || fallbackText || s4Whse.WarehouseName || `Warehouse ${s4Whse.Warehouse}`
    };
  }

  /**
   * Map S/4HANA WarehouseStorageType entity to CAP StorageType model
   */
  static mapStorageType(s4Type) {
    if (!s4Type) return null;
    const texts = s4Type.to_WarehouseStorageTypeText?.results || [];
    const enText = texts.find(t => t.Language === 'EN')?.StorageTypeName;
    const deText = texts.find(t => t.Language === 'DE')?.StorageTypeName;
    const fallbackText = texts[0]?.StorageTypeName || '';

    return {
      Warehouse: s4Type.Warehouse || '',
      StorageType: s4Type.StorageType || '',
      StorageTypeName: enText || deText || fallbackText || s4Type.StorageTypeName || `Type ${s4Type.StorageType}`
    };
  }

  /**
   * Map S/4HANA WarehouseStorageBin entity to CAP StorageBin model
   */
  static mapStorageBin(s4Bin) {
    if (!s4Bin) return null;
    return {
      Warehouse: s4Bin.Warehouse || '',
      StorageBin: s4Bin.StorageBin || '',
      StorageType: s4Bin.StorageType || '',
      StorageSection: s4Bin.StorageSection || '',
      StorageBinType: s4Bin.StorageBinType || '',
      MaxWeight: s4Bin.MaximumWeight || 0,
      WeightUnit: s4Bin.WeightUnit || 'KG',
      IsBlockedForPutaway: Boolean(s4Bin.StorageBinIsBlockedForPutaway),
      IsBlockedForRemoval: Boolean(s4Bin.StorageBinIsBlockedForRemoval)
    };
  }

  /**
   * Map S/4HANA WarehouseOrder to CAP WarehouseOrder model
   */
  static mapWarehouseOrder(s4Order) {
    if (!s4Order) return null;
    return {
      Warehouse: s4Order.Warehouse || '',
      WarehouseOrder: s4Order.WarehouseOrder || '',
      WarehouseOrderStatus: s4Order.WarehouseOrderStatus || 'O', // O = Open, C = Confirmed, I = In Process
      WarehouseOrderQueue: s4Order.WarehouseOrderQueue || '',
      ActivityArea: s4Order.ActivityArea || '',
      AssignedUser: s4Order.WarehouseOrderAssignedUser || '',
      CreationDate: s4Order.CreationDate ? EwmMapper.formatDate(s4Order.CreationDate) : null
    };
  }

  /**
   * Map S/4HANA WarehouseTask to CAP WarehouseTask model
   */
  static mapWarehouseTask(s4Task) {
    if (!s4Task) return null;
    return {
      Warehouse: s4Task.Warehouse || '',
      WarehouseTask: s4Task.WarehouseTask || '',
      WarehouseOrder: s4Task.WarehouseOrder || '',
      WarehouseProcessType: s4Task.WarehouseProcessType || '',
      WarehouseProcessCategory: s4Task.WarehouseProcessCategory || '',
      WarehouseTaskStatus: s4Task.WarehouseTaskStatus || 'O', // O = Open, C = Confirmed, X = Cancelled
      Product: s4Task.ProductName || s4Task.Product || '',
      ProductName: s4Task.ProductDescription || s4Task.ProductName || '',
      TargetQuantity: parseFloat(s4Task.TargetQuantityInBaseUnit || s4Task.TargetQuantity || 0),
      ConfirmedQuantity: parseFloat(s4Task.ConfirmedQuantityInBaseUnit || s4Task.ConfirmedQuantity || 0),
      BaseUnit: s4Task.BaseUnit || s4Task.TargetQuantityUnit || 'EA',
      SourceStorageType: s4Task.SourceStorageType || '',
      SourceStorageBin: s4Task.SourceStorageBin || '',
      TargetStorageType: s4Task.TargetStorageType || s4Task.DestinationStorageType || '',
      TargetStorageBin: s4Task.TargetStorageBin || s4Task.DestinationStorageBin || '',
      DestinationStorageBin: s4Task.DestinationStorageBin || s4Task.TargetStorageBin || '',
      PurchasingDocument: s4Task.PurchasingDocument || '',
      PurchasingDocumentItem: s4Task.PurchasingDocumentItem || '',
      Delivery: s4Task.Delivery || '',
      DeliveryItem: s4Task.DeliveryItem || '',
      CreationDate: s4Task.CreationDate ? EwmMapper.formatDate(s4Task.CreationDate) : null,
      ConfirmedByUser: s4Task.ConfirmedByUser || ''
    };
  }

  /**
   * Map S/4HANA Inbound Delivery to CAP InboundDelivery model
   */
  static mapInboundDelivery(s4Head, defaultWarehouse = '') {
    if (!s4Head) return null;
    const rawItems = s4Head.to_WhseInboundDeliveryItem?.results || s4Head.to_InboundDeliveryItem?.results || [];
    const items = rawItems.map(item => EwmMapper.mapInboundDeliveryItem(item, defaultWarehouse));
    const supplierName = s4Head.to_Supplier?.SupplierName ||
                         s4Head.to_Supplier?.OrganizationBPName1 ||
                         s4Head.ShipFromPartyName ||
                         s4Head.SupplierName ||
                         (s4Head.Supplier ? `Supplier ${s4Head.Supplier}` : '');

    const resolvedWarehouse = (s4Head.Warehouse && s4Head.Warehouse.length <= 4)
      ? s4Head.Warehouse
      : (s4Head.ShippingPoint || defaultWarehouse || '');

    return {
      Warehouse: resolvedWarehouse,
      DeliveryDocument: s4Head.InboundDelivery || s4Head.DeliveryDocument || '',
      Supplier: s4Head.ShipFromParty || s4Head.Supplier || '',
      SupplierName: supplierName,
      DeliveryDocumentType: s4Head.DeliveryType || s4Head.DeliveryDocumentType || 'INB',
      OverallGoodsReceiptStatus: s4Head.OverallGoodsReceiptStatus || 'A', // A = Not Yet Started, B = Partially, C = Completely
      DeliveryDate: s4Head.PlannedDeliveryUTCDateTime ? EwmMapper.formatDate(s4Head.PlannedDeliveryUTCDateTime) : (s4Head.DeliveryDate ? EwmMapper.formatDate(s4Head.DeliveryDate) : null),
      Items: items
    };
  }

  /**
   * Map S/4HANA Inbound Delivery Item
   */
  static mapInboundDeliveryItem(s4Item, defaultWarehouse = '') {
    if (!s4Item) return null;
    const resolvedWarehouse = (s4Item.Warehouse && s4Item.Warehouse.length <= 4)
      ? s4Item.Warehouse
      : (defaultWarehouse || '');

    return {
      Warehouse: resolvedWarehouse,
      DeliveryDocument: s4Item.InboundDelivery || s4Item.DeliveryDocument || '',
      DeliveryDocumentItem: s4Item.InboundDeliveryItem || s4Item.DeliveryDocumentItem || '',
      Product: s4Item.Product || '',
      ProductDescription: s4Item.ProductDescription || '',
      DeliveryQuantity: parseFloat(s4Item.ActualDeliveryQuantity || s4Item.DeliveryQuantity || s4Item.ProductQuantity || 0),
      DeliveryQuantityUnit: s4Item.DeliveryQuantityUnit || s4Item.QuantityUnit || 'EA',
      GoodsReceiptStatus: s4Item.GoodsReceiptStatus || 'A',
      PurchasingDocument: s4Item.PurchasingDocument || '',
      PurchasingDocumentItem: s4Item.PurchasingDocumentItem || '',
      PutawayStatus: s4Item.PutawayStatus || 'A'
    };
  }

  /**
   * Map S/4HANA Outbound Delivery Order to CAP OutboundDelivery model
   */
  static mapOutboundDelivery(s4Head, defaultWarehouse = '') {
    if (!s4Head) return null;
    const rawItems = s4Head.to_WhseOutboundDeliveryOrderItem?.results || s4Head.to_OutboundDeliveryOrderItem?.results || [];
    const items = rawItems.map(item => EwmMapper.mapOutboundDeliveryItem(item, defaultWarehouse));
    const shipToName = s4Head.to_ShipToParty?.CustomerName ||
                       s4Head.to_ShipToParty?.OrganizationBPName1 ||
                       s4Head.ShipToPartyName ||
                       (s4Head.ShipToParty ? `Customer ${s4Head.ShipToParty}` : '');

    const resolvedWarehouse = (s4Head.Warehouse && s4Head.Warehouse.length <= 4)
      ? s4Head.Warehouse
      : (s4Head.ShippingPoint || defaultWarehouse || '');

    return {
      Warehouse: resolvedWarehouse,
      OutboundDeliveryOrder: s4Head.OutboundDeliveryOrder || s4Head.OutboundDelivery || s4Head.DeliveryDocument || '',
      ShipToParty: s4Head.ShipToParty || '',
      ShipToPartyName: shipToName,
      OutboundDeliveryOrderType: s4Head.DeliveryType || s4Head.OutboundDeliveryOrderType || 'OUT',
      OverallGoodsIssueStatus: s4Head.OverallGoodsIssueStatus || 'A', // A = Not Started, B = Partial, C = Completed
      OverallPickingStatus: s4Head.OverallPickingStatus || 'A',
      PlannedGoodsIssueDate: s4Head.PlannedDeliveryUTCDateTime ? EwmMapper.formatDate(s4Head.PlannedDeliveryUTCDateTime) : (s4Head.PlannedGoodsIssueDate ? EwmMapper.formatDate(s4Head.PlannedGoodsIssueDate) : null),
      Items: items
    };
  }

  /**
   * Map S/4HANA Storage Location to CAP StorageType model
   */
  static mapStorageLocationToStorageType(s4Loc) {
    if (!s4Loc) return null;
    return {
      Warehouse: s4Loc.Plant || '',
      StorageType: s4Loc.StorageLocation || '',
      StorageTypeName: s4Loc.StorageLocationName || `Storage Location ${s4Loc.StorageLocation}`
    };
  }

  /**
   * Map S/4HANA Storage Location to representative StorageBin model
   */
  static mapStorageLocationToStorageBin(s4Loc) {
    if (!s4Loc) return null;
    return {
      Warehouse: s4Loc.Plant || '',
      StorageBin: `${s4Loc.StorageLocation}-01-01`,
      StorageType: s4Loc.StorageLocation || '',
      StorageSection: '0001',
      StorageBinType: 'STD',
      MaxWeight: 1000,
      WeightUnit: 'KG',
      IsBlockedForPutaway: false,
      IsBlockedForRemoval: false
    };
  }

  /**
   * Map S/4HANA Outbound Delivery Item
   */
  static mapOutboundDeliveryItem(s4Item) {
    if (!s4Item) return null;
    return {
      Warehouse: s4Item.Warehouse || '',
      OutboundDeliveryOrder: s4Item.OutboundDeliveryOrder || s4Item.DeliveryDocument || '',
      OutboundDeliveryOrderItem: s4Item.OutboundDeliveryOrderItem || s4Item.DeliveryDocumentItem || '',
      Product: s4Item.Product || '',
      ProductDescription: s4Item.ProductDescription || '',
      DeliveryQuantity: parseFloat(s4Item.ActualDeliveryQuantity || s4Item.DeliveryQuantity || s4Item.ProductQuantity || 0),
      DeliveryQuantityUnit: s4Item.DeliveryQuantityUnit || s4Item.QuantityUnit || 'EA',
      PickingStatus: s4Item.PickingStatus || 'A'
    };
  }

  /**
   * Format S/4HANA date representation into ISO YYYY-MM-DD string
   */
  static formatDate(val) {
    if (!val) return null;
    if (typeof val === 'string') {
      const match = /\/Date\((\d+)\)\//.exec(val);
      if (match) {
        return new Date(parseInt(match[1], 10)).toISOString().split('T')[0];
      }
      if (val.includes('T')) {
        return val.split('T')[0];
      }
      return val;
    }
    if (val instanceof Date) {
      return val.toISOString().split('T')[0];
    }
    return String(val);
  }

  /**
   * Map S/4HANA Warehouse Resource entity to CAP WarehouseResources model
   */
  static mapWarehouseResource(s4Rsrc) {
    if (!s4Rsrc) return null;
    return {
      Warehouse: s4Rsrc.Warehouse || '',
      Resource: s4Rsrc.WarehouseResource || s4Rsrc.Resource || '',
      ResourceType: s4Rsrc.ResourceType || 'CART',
      AssignedQueue: s4Rsrc.AssignedQueue || s4Rsrc.Queue || '',
      LogonStatus: s4Rsrc.UserName ? 'LOGGED_ON' : 'AVAILABLE',
      UserName: s4Rsrc.UserName || '',
      ResourceLogonDateTime: s4Rsrc.ResourceLogonDateTime || null
    };
  }

  /**
   * Map S/4HANA Warehouse Process Type entity to CAP WarehouseProcessTypes model
   */
  static mapWarehouseProcessType(s4Wpt) {
    if (!s4Wpt) return null;
    return {
      Warehouse: s4Wpt.EWMWarehouse || s4Wpt.Warehouse || '',
      WarehouseProcessType: s4Wpt.WarehouseProcessType || '',
      WarehouseProcessTypeName: s4Wpt.WarehouseProcessType_Text || s4Wpt.WarehouseProcessTypeName || ''
    };
  }
}

module.exports = EwmMapper;

