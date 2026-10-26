'use strict';

const cds = require('@sap/cds');
const businessConfigResolver = require('../../common/BusinessConfigResolver');

module.exports = class BusinessConfigService extends cds.ApplicationService {
  async init() {
    const { BusinessConfigs } = this.entities;

    this.before(['CREATE', 'UPDATE'], BusinessConfigs, (req) => {
      const data = req.data || {};
      const suppliedRules = ['PickableStorageTypes', 'HoldStorageTypes', 'InterimStorageTypes']
        .some((field) => Object.prototype.hasOwnProperty.call(data, field));
      if (suppliedRules) {
        try {
          const lists = businessConfigResolver.validateHuStorageTypeLists(data);
          data.PickableStorageTypes = lists.pickableStorageTypes.join(',');
          data.HoldStorageTypes = lists.holdStorageTypes.join(',');
          data.InterimStorageTypes = lists.interimStorageTypes.join(',');
        } catch (error) {
          return req.error(400, error.message);
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
