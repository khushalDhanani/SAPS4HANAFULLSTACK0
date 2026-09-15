const { S4HttpClient, DESTINATION_NOT_CONFIGURED } = require('../S4HttpClient');
const S4ErrorMapper = require('../S4ErrorMapper');
const EwmMapper = require('./EwmMapper');

/**
 * Adapter class to encapsulate communication with SAP S/4HANA EWM Services:
 * - API_WAREHOUSE (Warehouse & Storage Type Master Data)
 * - API_WAREHOUSE_STORAGE_BIN (Storage Bins)
 * - API_WAREHOUSE_ORDER_TASK (Warehouse Orders, Tasks, Confirmations)
 * - API_WHSE_INBOUND_DELIVERY (Inbound Deliveries & Goods Receipt)
 * - API_WHSE_OUTB_DLV_ORDER (Outbound Delivery Orders & Goods Issue)
 */
class EwmAdapter {
  constructor(options = {}) {
    // All HTTP traffic to S/4HANA goes through the shared SAP Cloud SDK based client (BTP destination,
    // Connectivity proxy for on-premise systems, per-call CSRF/cookie handling). No session state lives here.
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;
  }

  /**
   * Resolve the S/4HANA destination through the shared client. Returns null when nothing is configured.
   */
  async _getDestination() {
    return this.client.resolveDestination();
  }

  /**
   * HTTP GET against an S/4HANA OData service via the SAP Cloud SDK.
   */
  async _get(servicePath, queryParams = '') {
    try {
      const { data } = await this.client.get(servicePath, { query: queryParams });
      return data?.d?.results || data?.d || [];
    } catch (err) {
      if (err.code === DESTINATION_NOT_CONFIGURED) throw err;
      throw S4ErrorMapper.mapS4Error(err);
    }
  }

  /**
   * HTTP POST against an S/4HANA OData service via the SAP Cloud SDK. The CSRF token is fetched from the
   * target service root for this call only, together with the session cookies; nothing is cached here.
   */
  async _post(servicePath, payload = {}, customHeaders = {}) {
    try {
      const { data } = await this.client.post(servicePath, { data: payload, headers: customHeaders });
      if (data && typeof data === 'object') {
        return data.d || data;
      }
      if (typeof data === 'string' && data.trim() !== '') {
        try {
          const parsed = JSON.parse(data);
          return parsed.d || parsed;
        } catch (_) {
          // Non-JSON body (e.g. an empty OData response): treated as success below
        }
      }
      return { success: true };
    } catch (err) {
      if (err.code === DESTINATION_NOT_CONFIGURED) throw err;
      throw S4ErrorMapper.mapS4Error(err);
    }
  }

  // ==========================================
  // Master Data (Warehouse & Storage Bins)
  // ==========================================

  async getWarehouses() {
    const whMap = new Map();

    // 1. Fetch EWM Warehouses
    try {
      const rawEwm = await this._get('/sap/opu/odata/sap/API_WAREHOUSE/Warehouse', '$expand=to_WarehouseText&$format=json');
      const listEwm = Array.isArray(rawEwm) ? rawEwm : (rawEwm ? [rawEwm] : []);
      listEwm.map(EwmMapper.mapWarehouse).filter(Boolean).forEach(w => {
        const whKey = (w.Warehouse || '').trim();
        const whName = (w.WarehouseName || `Warehouse ${whKey}`).trim();
        if (whKey) {
          whMap.set(whKey, {
            Warehouse: whKey,
            WarehouseName: whName,
            IsEwm: true
          });
        }
      });
    } catch (_) {}

    // 2. Fetch Master Warehouse Numbers (WHN / LGNUM from T300)
    try {
      const rawWhn = await this._get('/sap/opu/odata/sap/LE_SHP_OD_LIST_SRV/I_WarehouseStdVH', '$format=json');
      const listWhn = Array.isArray(rawWhn) ? rawWhn : (rawWhn ? [rawWhn] : []);
      listWhn.forEach(w => {
        const whKey = (w.Warehouse || '').trim();
        const whName = (w.Warehouse_Text || w.WarehouseName || `Warehouse ${whKey}`).trim();
        if (whKey && !whMap.has(whKey)) {
          whMap.set(whKey, {
            Warehouse: whKey,
            WarehouseName: whName,
            IsEwm: false
          });
        }
      });
    } catch (_) {}

    const allWh = Array.from(whMap.values());
    allWh.sort((a, b) => a.Warehouse.localeCompare(b.Warehouse, undefined, { numeric: true }));
    return allWh;
  }

  async getStorageTypes(warehouse) {
    if (!warehouse) return [];

    // First try standard EWM Storage Types
    try {
      const path = `/sap/opu/odata/sap/API_WAREHOUSE/Warehouse('${warehouse}')/to_WarehouseStorageType`;
      const raw = await this._get(path, '$expand=to_WarehouseStorageTypeText&$format=json');
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const mapped = list.map(EwmMapper.mapStorageType).filter(Boolean);
      if (mapped.length > 0) return mapped;
    } catch (_) {}

    // For plant/warehouse sites like 1120, query authentic SAP Storage Locations
    try {
      const query = `$filter=Plant eq '${warehouse}'&$format=json`;
      const rawLocs = await this._get('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/C_MM_StorLocValueHelp', query);
      const listLocs = Array.isArray(rawLocs) ? rawLocs : (rawLocs ? [rawLocs] : []);
      return listLocs.map(EwmMapper.mapStorageLocationToStorageType).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async getStorageBins(warehouse, top = 100) {
    if (!warehouse) return [];

    // First try standard EWM Storage Bins
    try {
      const filter = `$filter=Warehouse eq '${warehouse}'`;
      const query = `${filter}&$top=${top}&$format=json`;
      const raw = await this._get('/sap/opu/odata/sap/API_WAREHOUSE_STORAGE_BIN/WarehouseStorageBin', query);
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const mapped = list.map(EwmMapper.mapStorageBin).filter(Boolean);
      if (mapped.length > 0) return mapped;
    } catch (_) {}

    // If no standalone EWM bins (e.g. Plant 1120), map from active storage locations
    try {
      const query = `$filter=Plant eq '${warehouse}'&$top=${top}&$format=json`;
      const rawLocs = await this._get('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/C_MM_StorLocValueHelp', query);
      const listLocs = Array.isArray(rawLocs) ? rawLocs : (rawLocs ? [rawLocs] : []);
      return listLocs.map(EwmMapper.mapStorageLocationToStorageBin).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async getWarehouseResources(warehouse, top = 100) {
    const filter = warehouse ? `$filter=Warehouse eq '${warehouse}'` : '';
    const query = `${filter ? filter + '&' : ''}$top=${top}&$format=json`;
    try {
      const raw = await this._get('/sap/opu/odata/sap/API_WAREHOUSE_RESOURCE/WarehouseResource', query);
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map(EwmMapper.mapWarehouseResource).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  // ==========================================
  // Warehouse Orders & Tasks
  // ==========================================

  async getWarehouseOrders(warehouse, top = 100) {
    const filter = warehouse ? `$filter=Warehouse eq '${warehouse}'` : '';
    const query = `${filter ? filter + '&' : ''}$top=${top}&$format=json`;
    try {
      const raw = await this._get('/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/WarehouseOrder', query);
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map(EwmMapper.mapWarehouseOrder).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async getWarehouseTasks(warehouse, top = 100) {
    const filter = warehouse ? `$filter=Warehouse eq '${warehouse}'` : '';
    const query = `${filter ? filter + '&' : ''}$top=${top}&$format=json`;
    try {
      const raw = await this._get('/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/WarehouseTask', query);
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map(EwmMapper.mapWarehouseTask).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async getWarehouseProcessTypes(warehouse) {
    if (!warehouse) return [];
    try {
      const query = `$filter=EWMWarehouse eq '${warehouse}'&$format=json`;
      const raw = await this._get('/sap/opu/odata/scwm/WAREHOUSE_KPIS_SRV/I_EWM_WhseProcTypeVH', query);
      const list = Array.isArray(raw) ? raw : (raw?.results || (raw ? [raw] : []));
      return list.map(EwmMapper.mapWarehouseProcessType).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async createWarehouseTask(taskData) {
    if (!taskData || !taskData.Warehouse) {
      throw new Error('Warehouse is required to create a Warehouse Task');
    }
    if (!taskData.Product && !taskData.ProductName) {
      throw new Error('Product is required to create a Warehouse Task');
    }
    const qty = Number(taskData.Quantity || taskData.TargetQuantity);
    if (!taskData.Quantity && !taskData.TargetQuantity || isNaN(qty) || qty <= 0) {
      throw new Error('Valid positive Quantity is required to create a Warehouse Task');
    }
    const uom = (taskData.UnitOfMeasure || taskData.BaseUnit || '').trim().toUpperCase();
    if (!uom) {
      throw new Error('UnitOfMeasure is required to create a Warehouse Task');
    }
    const wpt = (taskData.WarehouseProcessType || '').trim().toUpperCase();
    if (!wpt) {
      throw new Error('WarehouseProcessType is required to create a Warehouse Task');
    }

    const warehouse = (taskData.Warehouse || '').trim().toUpperCase();
    const product = (taskData.Product || taskData.ProductName || '').trim().toUpperCase();
    const strategyErrors = [];

    // ─── Strategy 1: Direct POST to API_WAREHOUSE_ORDER_TASK/WarehouseTask ───
    try {
      const payload = {
        Warehouse: warehouse,
        WarehouseProcessType: wpt,
        ProductName: product,
        TargetQuantityInBaseUnit: String(qty),
        BaseUnit: uom
      };
      const cleanse = (v, len) => {
        if (!v) return '';
        let s = String(v).trim();
        if (s.includes(' - ')) s = s.split(' - ')[0].trim();
        if (len && s.length > len) s = s.substring(0, len);
        return s.toUpperCase();
      };

      if (taskData.SourceStorageBin) payload.SourceStorageBin = cleanse(taskData.SourceStorageBin, 18);
      if (taskData.TargetStorageBin || taskData.DestinationStorageBin) {
        payload.DestinationStorageBin = cleanse(taskData.TargetStorageBin || taskData.DestinationStorageBin, 18);
      }
      if (taskData.SourceStorageType) payload.SourceStorageType = cleanse(taskData.SourceStorageType, 4);
      if (taskData.TargetStorageType || taskData.DestinationStorageType) {
        payload.DestinationStorageType = cleanse(taskData.TargetStorageType || taskData.DestinationStorageType, 4);
      }
      if (taskData.Batch) payload.Batch = taskData.Batch.trim().toUpperCase();
      if (taskData.SourceHandlingUnit) payload.SourceHandlingUnit = taskData.SourceHandlingUnit.trim();
      if (taskData.TargetHandlingUnit || taskData.DestinationHandlingUnit) {
        payload.DestinationHandlingUnit = (taskData.TargetHandlingUnit || taskData.DestinationHandlingUnit).trim();
      }
      if (taskData.PurchasingDocument) payload.PurchasingDocument = taskData.PurchasingDocument.trim();
      if (taskData.PurchasingDocumentItem) payload.PurchasingDocumentItem = taskData.PurchasingDocumentItem.trim();
      if (taskData.Delivery) payload.Delivery = taskData.Delivery.trim();
      if (taskData.DeliveryItem) payload.DeliveryItem = taskData.DeliveryItem.trim();

      const raw = await this._post('/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/WarehouseTask', payload);
      return EwmMapper.mapWarehouseTask(raw);
    } catch (err) {
      strategyErrors.push({ strategy: 'API_WAREHOUSE_ORDER_TASK', error: err.message || String(err) });
    }

    // ─── Strategy 2: POST to PICKCART_SRV/WarehouseTaskSet (SCWM fields) ───
    try {
      const scwmPayload = {
        EWMWarehouse: warehouse,
        Pmat: product,
        TargetQuantityInBaseUnit: String(qty),
        BaseUnit: uom
      };
      const cleanse = (v, len) => {
        if (!v) return '';
        let s = String(v).trim();
        if (s.includes(' - ')) s = s.split(' - ')[0].trim();
        if (len && s.length > len) s = s.substring(0, len);
        return s.toUpperCase();
      };
      if (taskData.SourceStorageBin) scwmPayload.SourceStorageBin = cleanse(taskData.SourceStorageBin, 18);
      if (taskData.SourceHandlingUnit) scwmPayload.SourceHandlingUnit = String(taskData.SourceHandlingUnit).trim();
      if (taskData.DestinationHandlingUnit) scwmPayload.DestinationHandlingUnit = String(taskData.DestinationHandlingUnit).trim();

      const raw = await this._post('/sap/opu/odata/scwm/PICKCART_SRV/WarehouseTaskSet', scwmPayload);
      return EwmMapper.mapWarehouseTask(raw);
    } catch (err) {
      strategyErrors.push({ strategy: 'PICKCART_SRV', error: err.message || String(err) });
    }

    // ─── All strategies failed ───
    const summary = strategyErrors.map(s =>
      `[${s.strategy}]: ${s.error}`
    ).join('\n');

    // No fallback of any kind: a task either exists in SAP EWM or it does not (AGENTS.md, ADR-0001).
    const error = new Error(
      `Warehouse Task creation failed — all SAP strategies exhausted; no task was created:\n${summary}\n\n` +
      `In this SAP S/4HANA instance API_WAREHOUSE_ORDER_TASK is deprecated and PICKCART_SRV/WarehouseTaskSet ` +
      `does not accept creates. EWM warehouse tasks are normally generated by the business process itself ` +
      `(goods receipt, goods issue, transfer posting) in SAP.`
    );
    error.status = 422;
    throw error;
  }

  async confirmWarehouseTask(warehouse, warehouseTask, confirmedQuantity) {
    if (!warehouse || !warehouseTask) {
      throw new Error('Warehouse and WarehouseTask are required for task confirmation');
    }
    const qty = Number(confirmedQuantity);
    if (!confirmedQuantity || isNaN(qty) || qty <= 0) {
      throw new Error('Valid positive ConfirmedQuantity is required for task confirmation');
    }
    const path = `/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/ConfirmWarehouseTaskExact`;
    const query = `Warehouse='${warehouse}'&WarehouseTask='${warehouseTask}'&WarehouseTaskItem='1'`;
    return await this._post(`${path}?${query}`);
  }

  async cancelWarehouseTask(warehouse, warehouseTask) {
    if (!warehouse || !warehouseTask) {
      throw new Error('Warehouse and WarehouseTask are required to cancel a task');
    }
    const path = `/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/CancelWarehouseTask`;
    const query = `Warehouse='${warehouse}'&WarehouseTask='${warehouseTask}'&WarehouseTaskItem='1'`;
    return await this._post(`${path}?${query}`);
  }

  // ==========================================
  // Inbound & Outbound Deliveries
  // ==========================================

  async getInboundDeliveries(warehouse, top = 50) {
    // 1. Try real SAP deliveries from LE_SHP_WHSE_CLERK_OVP_SRV
    try {
      const filter = (warehouse === '1120' || warehouse === '1130')
        ? `$filter=Supplier eq '${warehouse}'`
        : '';
      const query = `${filter ? filter + '&' : ''}$expand=to_Supplier&$top=${top}&$format=json`;
      const raw = await this._get('/sap/opu/odata/sap/LE_SHP_WHSE_CLERK_OVP_SRV/C_WhseClerkInbDeliv', query);
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const mapped = list.map(d => EwmMapper.mapInboundDelivery(d, warehouse)).filter(Boolean);
      if (mapped.length > 0) return mapped;
    } catch (_) {}

    // 2. Try EWM Inbound Deliveries
    try {
      const filter = warehouse ? `$filter=Warehouse eq '${warehouse}'` : '';
      const query = `${filter ? filter + '&' : ''}$expand=to_WhseInboundDeliveryItem&$top=${top}&$format=json`;
      const raw = await this._get('/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/WhseInboundDeliveryHead', query);
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      return list.map(d => EwmMapper.mapInboundDelivery(d, warehouse)).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async postGoodsReceipt(warehouse, deliveryDocument) {
    if (!warehouse || !deliveryDocument) {
      throw new Error('Warehouse and DeliveryDocument are required to post Goods Receipt');
    }
    const path = `/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/PostGoodsReceipt`;
    const query = `InboundDelivery='${deliveryDocument}'`;
    return await this._post(`${path}?${query}`, {}, { 'If-Match': '*' });
  }

  async getOutboundDeliveries(warehouse, top = 50) {
    // 1. Try real SAP Outbound Deliveries from LE_SHP_WHSE_CLERK_OVP_SRV
    try {
      let filter = '';
      if (warehouse === '1120') {
        filter = `$filter=ShippingPoint eq '1120' or ShippingPoint eq '1112' or ShippingPoint eq '1108' or ShippingPoint eq '1109'`;
      } else if (warehouse === '1130') {
        filter = `$filter=ShippingPoint eq '1130' or ShippingPoint eq '1113'`;
      } else if (warehouse) {
        filter = `$filter=ShippingPoint eq '${warehouse}'`;
      }
      const query = `${filter ? filter + '&' : ''}$expand=to_ShippingPoint,to_ShipToParty&$top=${top}&$format=json`;
      const raw = await this._get('/sap/opu/odata/sap/LE_SHP_WHSE_CLERK_OVP_SRV/C_WhseClerkOutbDeliv', query);
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const mapped = list.map(d => EwmMapper.mapOutboundDelivery(d, warehouse)).filter(Boolean);
      if (mapped.length > 0) return mapped;
    } catch (_) {}

    // 2. Try EWM Outbound Deliveries
    try {
      const filter = warehouse ? `$filter=Warehouse eq '${warehouse}'` : '';
      const query = `${filter ? filter + '&' : ''}$expand=to_WhseOutboundDeliveryOrderItem&$top=${top}&$format=json`;
      const raw = await this._get('/sap/opu/odata/sap/API_WHSE_OUTB_DLV_ORDER/WhseOutboundDeliveryOrderHead', query);
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      return list.map(d => EwmMapper.mapOutboundDelivery(d, warehouse)).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  async postGoodsIssue(warehouse, outboundDeliveryOrder) {
    if (!warehouse || !outboundDeliveryOrder) {
      throw new Error('Warehouse and OutboundDeliveryOrder are required to post Goods Issue');
    }
    const path = `/sap/opu/odata/sap/API_WHSE_OUTB_DLV_ORDER/PostGoodsIssue`;
    const query = `Warehouse='${warehouse}',OutboundDeliveryOrder='${outboundDeliveryOrder}'`;
    return await this._post(`${path}?${query}`);
  }

  // ==========================================
  // RF Terminal & Pick-by-Cart Operations
  // ==========================================

  async logonResource(warehouse, resource, queue) {
    if (!warehouse || !resource) {
      throw new Error('Warehouse and Resource are required for RF logon');
    }
    if (!queue) {
      throw new Error('Queue is required for RF logon');
    }
    // The logon is reported only after SAP EWM accepted it; a rejection propagates to the caller.
    const path = `/sap/opu/odata/scwm/PICKCART_SRV/LogonRSRC`;
    const query = `Lgnum='${warehouse}',Rsrc='${resource}'`;
    await this._post(`${path}?${query}`);
    return {
      Warehouse: warehouse,
      Resource: resource,
      Queue: queue,
      LogonStatus: 'ACTIVE',
      LogonTimestamp: new Date().toISOString()
    };
  }

  async verifyScan(warehouse, scanType, barcodeValue, expectedValue) {
    if (!barcodeValue || !expectedValue) {
      return false;
    }
    const cleanScan = String(barcodeValue).trim().toUpperCase();
    const cleanExp = String(expectedValue).trim().toUpperCase();

    // Standard direct match or prefixed barcode match (e.g. "P" for product or "S" for storage bin)
    if (cleanScan === cleanExp) return true;
    if (cleanScan.replace(/^[SBP]/, '') === cleanExp) return true;
    return false;
  }

  async confirmRfPickTask(warehouse, warehouseTask, confirmedQuantity, destinationHu, scannedBin) {
    if (!warehouse || !warehouseTask) {
      throw new Error('Warehouse and WarehouseTask are required for RF task confirmation');
    }
    const qty = Number(confirmedQuantity);
    if (!confirmedQuantity || isNaN(qty) || qty <= 0) {
      throw new Error('Valid positive ConfirmedQuantity is required for RF task confirmation');
    }
    if (!destinationHu || typeof destinationHu !== 'string' || !destinationHu.trim()) {
      throw new Error('DestinationHU is required for RF task confirmation');
    }
    if (!scannedBin || typeof scannedBin !== 'string' || !scannedBin.trim()) {
      throw new Error('ScannedBin is required for RF task confirmation');
    }
    // Call standard exact confirmation
    await this.confirmWarehouseTask(warehouse, warehouseTask, qty);
    return {
      success: true,
      Warehouse: warehouse,
      WarehouseTask: warehouseTask,
      ConfirmedQuantity: qty,
      DestinationHU: destinationHu.trim(),
      ScannedBin: scannedBin.trim(),
      ConfirmedAt: new Date().toISOString()
    };
  }
}


module.exports = new EwmAdapter();
