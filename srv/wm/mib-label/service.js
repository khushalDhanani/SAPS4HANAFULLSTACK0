'use strict';

const cds = require('@sap/cds');
const { MibLabelAdapter } = require('../../integration/s4hana/wm/MibLabelAdapter');
const { warehouseScope, assertWarehouseAllowed } = require('./warehouseScope');

/**
 * CAP Service Implementation for MibLabelService.
 * Orchestrates authorization, input handling and delegates to MibLabelAdapter.
 *
 * Hardened warehouse authorization discipline (Finding SEC-01):
 *   - Enforces warehouse roles at CAP boundary (@requires: ['WarehouseClerk', 'WarehouseManager', 'Admin']).
 *   - Derives allowed warehouses server-side via warehouseScope(req.user).
 *   - Validates each requested WarehouseNumber against authoritative server-side scope before delegation.
 *   - Passes allowedWarehouses to adapter for defense-in-depth enforcement.
 */
module.exports = class MibLabelService extends cds.ApplicationService {
  async init() {
    const adapter = this.adapter || new MibLabelAdapter();

    this.on('generateMibSticker', async (req) => {
      try {
        const payload = req.data || {};
        const allowedWarehouses = warehouseScope(req.user);
        assertWarehouseAllowed(payload.WarehouseNumber, allowedWarehouses);
        return await adapter.generateMibSticker(payload, { allowedWarehouses });
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to generate Material Issued Batch Sticker');
      }
    });

    this.on('readMibStickerData', async (req) => {
      try {
        const payload = req.data || {};
        const allowedWarehouses = warehouseScope(req.user);
        assertWarehouseAllowed(payload.WarehouseNumber, allowedWarehouses);
        return await adapter.readMibStickerData(payload, { allowedWarehouses });
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Failed to read Material Issued Batch Sticker data');
      }
    });

    this.on('listTransferOrders', async (req) => {
      try {
        const payload = req.data || {};
        const allowedWarehouses = warehouseScope(req.user);
        assertWarehouseAllowed(payload.WarehouseNumber, allowedWarehouses);
        return await adapter.listTransferOrders(payload, { allowedWarehouses });
      } catch (err) {
        return req.error(err.status || 500, err.message || 'Transfer orders could not be read');
      }
    });

    this.on('getWarehouseContext', (req) => {
      const allowedWarehouses = warehouseScope(req.user);
      const isUnrestricted = allowedWarehouses === null;
      const warehouses = isUnrestricted ? ['W01'] : allowedWarehouses;
      return {
        warehouses,
        unrestricted: isUnrestricted
      };
    });

    return super.init();
  }
};
