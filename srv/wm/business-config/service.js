'use strict';

const cds = require('@sap/cds');
const businessConfigResolver = require('../../common/BusinessConfigResolver');

module.exports = class BusinessConfigService extends cds.ApplicationService {
  async init() {
    const { BusinessConfigs } = this.entities;

    // Invalidate per-key TTL cache on admin writes
    this.after(['CREATE', 'UPDATE', 'DELETE'], BusinessConfigs, (data) => {
      const plant = data?.Plant;
      const warehouse = data?.WarehouseNumber;
      businessConfigResolver.invalidate(plant, warehouse);
    });

    return super.init();
  }
};
