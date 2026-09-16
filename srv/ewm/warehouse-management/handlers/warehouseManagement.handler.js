const EwmAdapter = require('../../../integration/s4hana/ewm/EwmAdapter');
const { extractFilterParam } = require('../../../common/filterUtils');

function _extractWarehouse(req) {
  return extractFilterParam(req, 'Warehouse');
}

function _cleanseCode(val, maxLen) {
  if (!val) return '';
  let s = String(val).trim();
  if (s.includes(' - ')) {
    s = s.split(' - ')[0].trim();
  }
  if (maxLen && s.length > maxLen) {
    s = s.substring(0, maxLen);
  }
  return s.toUpperCase();
}

/**
 * CAP Event Handler for WarehouseManagementService
 *
 * Every read and every transaction goes to SAP S/4HANA / EWM. When SAP rejects a request the
 * rejection is returned to the caller unchanged: nothing is staged, simulated or marked complete
 * locally (AGENTS.md: no local substitute for an SAP transaction; ADR-0001).
 */
class WarehouseManagementHandler {
  static init(srv) {
    // -------------------------------------------------------------
    // READ Handlers
    // -------------------------------------------------------------

    srv.on('READ', 'Warehouses', async (req) => {
      try {
        const list = await EwmAdapter.getWarehouses();
        // If query specifies a specific key
        if (req.params && req.params.length > 0 && req.params[0].Warehouse) {
          const found = list.find(w => w.Warehouse === req.params[0].Warehouse);
          return found || null;
        }
        return list;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'WarehouseProcessTypes', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        // Exactly what SAP EWM configures for the warehouse; an empty list is an empty list.
        const list = await EwmAdapter.getWarehouseProcessTypes(warehouse);
        const processTypes = Array.isArray(list) ? list : [];
        if (req.params && req.params.length > 0 && req.params[0].WarehouseProcessType) {
          const found = processTypes.find(p => p.WarehouseProcessType === req.params[0].WarehouseProcessType);
          return found || null;
        }
        return processTypes;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'StorageTypes', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getStorageTypes(warehouse);
        if (req.params && req.params.length > 0 && req.params[0].StorageType) {
          const found = list.find(s => s.StorageType === req.params[0].StorageType);
          return found || null;
        }
        return list;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'StorageBins', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getStorageBins(warehouse);
        if (req.params && req.params.length > 0 && req.params[0].StorageBin) {
          const found = list.find(b => b.StorageBin === req.params[0].StorageBin);
          return found || null;
        }
        return list;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'WarehouseOrders', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getWarehouseOrders(warehouse);
        if (req.params && req.params.length > 0 && req.params[0].WarehouseOrder) {
          const found = list.find(o => o.WarehouseOrder === req.params[0].WarehouseOrder);
          return found || null;
        }
        return list;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'WarehouseTasks', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getWarehouseTasks(warehouse);
        const tasks = Array.isArray(list) ? list : [];
        if (req.params && req.params.length > 0 && req.params[0].WarehouseTask) {
          const found = tasks.find(t => t.WarehouseTask === req.params[0].WarehouseTask);
          return found || null;
        }
        return tasks;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'InboundDeliveries', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getInboundDeliveries(warehouse);
        const deliveries = Array.isArray(list) ? list : [];
        if (req.params && req.params.length > 0 && req.params[0].DeliveryDocument) {
          const found = deliveries.find(d => d.DeliveryDocument === req.params[0].DeliveryDocument);
          return found || null;
        }
        return deliveries;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'OutboundDeliveries', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getOutboundDeliveries(warehouse);
        const deliveries = Array.isArray(list) ? list : [];
        if (req.params && req.params.length > 0 && req.params[0].OutboundDeliveryOrder) {
          const found = deliveries.find(d => d.OutboundDeliveryOrder === req.params[0].OutboundDeliveryOrder);
          return found || null;
        }
        return deliveries;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('READ', 'WarehouseKPIs', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const [tasks, inb, outb, bins, storageTypes] = await Promise.allSettled([
          EwmAdapter.getWarehouseTasks(warehouse),
          EwmAdapter.getInboundDeliveries(warehouse),
          EwmAdapter.getOutboundDeliveries(warehouse),
          EwmAdapter.getStorageBins(warehouse),
          EwmAdapter.getStorageTypes(warehouse)
        ]);

        const taskList = tasks.status === 'fulfilled' ? (tasks.value || []) : [];
        const inbList = inb.status === 'fulfilled' ? (inb.value || []) : [];
        const outbList = outb.status === 'fulfilled' ? (outb.value || []) : [];
        const binList = bins.status === 'fulfilled' ? (bins.value || []) : [];
        const typeList = storageTypes.status === 'fulfilled' ? (storageTypes.value || []) : [];

        const openTasks = taskList.filter(t => t.WarehouseTaskStatus === 'O').length;
        const pendingInb = inbList.filter(d => d.OverallGoodsReceiptStatus !== 'C').length;
        const pendingOutb = outbList.filter(d => d.OverallGoodsIssueStatus !== 'C').length;
        const totalBins = binList.length > 0 ? binList.length : typeList.length;

        return [{
          Warehouse: warehouse,
          OpenTasksCount: openTasks,
          PendingInbound: pendingInb,
          PendingOutbound: pendingOutb,
          TotalStorageBins: totalBins
        }];
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    // -------------------------------------------------------------
    // Action Handlers
    // -------------------------------------------------------------

    srv.on('confirmWarehouseTask', async (req) => {
      const { Warehouse, WarehouseTask, ConfirmedQuantity } = req.data;
      if (!Warehouse || !WarehouseTask) {
        return req.error(400, 'Warehouse and WarehouseTask are required');
      }
      const qty = Number(ConfirmedQuantity);
      if (!ConfirmedQuantity || isNaN(qty) || qty <= 0) {
        return req.error(400, 'Valid positive ConfirmedQuantity is required');
      }

      try {
        await EwmAdapter.confirmWarehouseTask(Warehouse, WarehouseTask, qty);
        return true;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('createWarehouseTask', async (req) => {
      const {
        Warehouse,
        Product,
        Quantity,
        UnitOfMeasure,
        WarehouseProcessType,
        SourceStorageType,
        SourceStorageBin,
        TargetStorageType,
        TargetStorageBin,
        DestinationStorageType,
        DestinationStorageBin,
        Batch,
        SourceHandlingUnit,
        DestinationHandlingUnit
      } = req.data;

      const sWhse = _cleanseCode(Warehouse, 4);
      if (!sWhse) {
        return req.error(400, 'Warehouse is required');
      }
      if (!Product) {
        return req.error(400, 'Product is required');
      }
      const qty = Number(Quantity);
      if (!Quantity || isNaN(qty) || qty <= 0) {
        return req.error(400, 'Valid positive Quantity is required');
      }
      if (!UnitOfMeasure) {
        return req.error(400, 'UnitOfMeasure is required');
      }
      const sWpt = _cleanseCode(WarehouseProcessType, 4);
      if (!sWpt) {
        return req.error(400, 'WarehouseProcessType is required');
      }

      const sResolvedTargetType = _cleanseCode(TargetStorageType || DestinationStorageType, 4);
      const sResolvedTargetBin = (TargetStorageBin || DestinationStorageBin) ? String(TargetStorageBin || DestinationStorageBin).trim() : '';

      try {
        return await EwmAdapter.createWarehouseTask({
          Warehouse: sWhse,
          Product: String(Product).trim(),
          Quantity: qty,
          UnitOfMeasure: String(UnitOfMeasure).trim().toUpperCase(),
          WarehouseProcessType: sWpt,
          SourceStorageType: _cleanseCode(SourceStorageType, 4),
          SourceStorageBin: SourceStorageBin ? String(SourceStorageBin).trim() : '',
          TargetStorageType: sResolvedTargetType,
          DestinationStorageType: sResolvedTargetType,
          TargetStorageBin: sResolvedTargetBin,
          DestinationStorageBin: sResolvedTargetBin,
          Batch: Batch ? String(Batch).trim() : '',
          SourceHandlingUnit: SourceHandlingUnit ? String(SourceHandlingUnit).trim() : '',
          DestinationHandlingUnit: DestinationHandlingUnit ? String(DestinationHandlingUnit).trim() : ''
        });
      } catch (err) {
        // SAP rejected the creation: return the rejection unchanged. No task is created or simulated locally.
        return req.error(err.status || 500, err.message || 'Warehouse Task creation was rejected by SAP S/4HANA');
      }
    });

    srv.on('cancelWarehouseTask', async (req) => {
      const { Warehouse, WarehouseTask } = req.data;
      if (!Warehouse || !WarehouseTask) {
        return req.error(400, 'Warehouse and WarehouseTask are required');
      }

      try {
        await EwmAdapter.cancelWarehouseTask(Warehouse, WarehouseTask);
        return true;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('postGoodsReceipt', async (req) => {
      const { Warehouse, DeliveryDocument } = req.data;
      const sDoc = String(DeliveryDocument || '').trim();
      const sWhse = _cleanseCode(Warehouse, 4);
      if (!sWhse || !sDoc) {
        return req.error(400, 'Warehouse and DeliveryDocument are required');
      }

      try {
        // True only when SAP posted the goods receipt; a rejection is returned unchanged.
        await EwmAdapter.postGoodsReceipt(sWhse, sDoc);
        return true;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Goods Receipt posting was rejected by SAP S/4HANA');
      }
    });

    srv.on('postGoodsIssue', async (req) => {
      const { Warehouse, OutboundDeliveryOrder } = req.data;
      const sOdo = String(OutboundDeliveryOrder || '').trim();
      const sWhse = _cleanseCode(Warehouse, 4);
      if (!sWhse || !sOdo) {
        return req.error(400, 'Warehouse and OutboundDeliveryOrder are required');
      }

      try {
        // True only when SAP posted the goods issue; a rejection is returned unchanged.
        await EwmAdapter.postGoodsIssue(sWhse, sOdo);
        return true;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Goods Issue posting was rejected by SAP S/4HANA');
      }
    });

    // -------------------------------------------------------------
    // RF Terminal Handlers
    // -------------------------------------------------------------

    srv.on('READ', 'WarehouseResources', async (req) => {
      try {
        const warehouse = _extractWarehouse(req);
        if (!warehouse) return req.error(400, 'Warehouse parameter or filter is required');
        const list = await EwmAdapter.getWarehouseResources(warehouse);
        if (req.params && req.params.length > 0 && req.params[0].Resource) {
          const found = list.find(r => r.Resource === req.params[0].Resource);
          return found || null;
        }
        return list;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('logonResource', async (req) => {
      const { Warehouse, Resource, Queue } = req.data;
      if (!Warehouse || !Resource || !Queue) {
        return req.error(400, 'Warehouse, Resource, and Queue are required for RF logon');
      }
      try {
        await EwmAdapter.logonResource(Warehouse, Resource, Queue);
        return true;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });

    srv.on('verifyRfScan', async (req) => {
      const { Warehouse, ScanType, BarcodeValue, ExpectedValue } = req.data;
      if (!Warehouse || !ScanType || !BarcodeValue || !ExpectedValue) {
        return false;
      }
      return await EwmAdapter.verifyScan(Warehouse, ScanType, BarcodeValue, ExpectedValue);
    });

    srv.on('confirmRfPick', async (req) => {
      const { Warehouse, WarehouseTask, ConfirmedQuantity, DestinationHU, ScannedBin } = req.data;
      if (!Warehouse || !WarehouseTask) {
        return req.error(400, 'Warehouse and WarehouseTask are required');
      }
      const qty = Number(ConfirmedQuantity);
      if (!ConfirmedQuantity || isNaN(qty) || qty <= 0) {
        return req.error(400, 'Valid positive ConfirmedQuantity is required');
      }
      if (!DestinationHU || !ScannedBin) {
        return req.error(400, 'DestinationHU and ScannedBin are required for RF pick confirmation');
      }

      try {
        await EwmAdapter.confirmRfPickTask(Warehouse, WarehouseTask, qty, DestinationHU, ScannedBin);
        return true;
      } catch (err) {
        req.error(err.status || 500, err.message);
      }
    });
  }
}

module.exports = WarehouseManagementHandler;
