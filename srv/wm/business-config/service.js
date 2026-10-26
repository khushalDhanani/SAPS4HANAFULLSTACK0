'use strict';

const cds = require('@sap/cds');
const businessConfigResolver = require('../../common/BusinessConfigResolver');
const StorageTypeConfigAdapter = require('../../integration/s4hana/wm/StorageTypeConfigAdapter');

const storageTypeConfigAdapter = new StorageTypeConfigAdapter();

module.exports = class BusinessConfigService extends cds.ApplicationService {
  async init() {
    const { BusinessConfigs } = this.entities;

    this.before(['CREATE', 'UPDATE'], BusinessConfigs, async (req) => {
      const data = req.data || {};
      const suppliedRules = ['PickableStorageTypes', 'HoldStorageTypes', 'InterimStorageTypes']
        .some((field) => Object.prototype.hasOwnProperty.call(data, field));
      if (suppliedRules) {
        let lists;
        try {
          lists = businessConfigResolver.validateHuStorageTypeLists(data);
          data.PickableStorageTypes = lists.pickableStorageTypes.join(',');
          data.HoldStorageTypes = lists.holdStorageTypes.join(',');
          data.InterimStorageTypes = lists.interimStorageTypes.join(',');
        } catch (error) {
          return req.error(400, error.message);
        }

        const requestKeys = Array.isArray(req.params) ? (req.params[0] || {}) : {};
        const warehouse = data.WarehouseNumber || requestKeys.WarehouseNumber;
        if (!warehouse) return req.error(400, 'WarehouseNumber is required to validate storage types against T301.');
        try {
          const validator = this.storageTypeConfigAdapter || storageTypeConfigAdapter;
          await validator.validateStorageTypeListsForWarehouse(warehouse, lists);
        } catch (error) {
          return req.error(error.status || 503, error.message);
        }
      }
      if (data.OversizeHuSelectionBehavior !== undefined) {
        const policy = String(data.OversizeHuSelectionBehavior || '').trim().toUpperCase();
        if (!['BLOCK', 'WARN'].includes(policy)) {
          return req.error(400, 'OversizeHuSelectionBehavior must be BLOCK or WARN.');
        }
        data.OversizeHuSelectionBehavior = policy;
      }
    });

    // Invalidate per-key TTL cache on admin writes
    this.after(['CREATE', 'UPDATE', 'DELETE'], BusinessConfigs, (data) => {
      const plant = data?.Plant;
      const warehouse = data?.WarehouseNumber;
      businessConfigResolver.invalidate(plant, warehouse);
    });

    return super.init();
  }
};
