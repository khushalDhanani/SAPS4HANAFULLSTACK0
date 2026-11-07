'use strict';

const cds = require('@sap/cds');
const { MibLabelAdapter } = require('../../integration/s4hana/wm/MibLabelAdapter');
const plantScope = require('../handling-unit/plantScope');

/**
 * CAP Service Implementation for MibLabelService.
 * Orchestrates authorization, input handling and delegates to MibLabelAdapter.
 */
module.exports = class MibLabelService extends cds.ApplicationService {
  async init() {
    const adapter = this.adapter || new MibLabelAdapter();

    this.on('generateMibSticker', async (req) => {
      try {
        const payload = req.data || {};
        return await adapter.generateMibSticker(payload);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to generate Material Issued Batch Sticker');
      }
    });

    this.on('readMibStickerData', async (req) => {
      try {
        const payload = req.data || {};
        return await adapter.readMibStickerData(payload);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read Material Issued Batch Sticker data');
      }
    });

    this.on('getWarehouseContext', (req) => {
      const scope = plantScope(req.user);
      const isUnrestricted = scope === null;
      // Default standard warehouse W01
      const defaultWarehouses = ['W01'];
      return {
        warehouses: defaultWarehouses,
        unrestricted: isUnrestricted
      };
    });

    return super.init();
  }
};
