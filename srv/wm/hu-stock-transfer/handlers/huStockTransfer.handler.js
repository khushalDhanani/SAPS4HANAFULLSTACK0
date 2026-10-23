'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('hu-stock-transfer-handler');
const HuStockTransferAdapter = require('../../../integration/s4hana/wm/HuStockTransferAdapter');

const adapter = new HuStockTransferAdapter();

const HuStockTransferHandler = {
  init(srv) {
    srv.on('getOpenReservations', async (req) => {
      try {
        return await adapter.getOpenReservations(req.data);
      } catch (err) {
        LOG.error('getOpenReservations failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('getCockpitDetail', async (req) => {
      try {
        const { reservation, item } = req.data;
        return await adapter.getCockpitDetail(reservation, item);
      } catch (err) {
        LOG.error('getCockpitDetail failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('validateUnit', async (req) => {
      try {
        const { reservation, item, unitNumber } = req.data;
        return await adapter.validateUnit(reservation, item, unitNumber);
      } catch (err) {
        LOG.error('validateUnit failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('getStorageBins', async (req) => {
      try {
        const { reservation, item } = req.data;
        return await adapter.getStorageBins(reservation, item);
      } catch (err) {
        LOG.error('getStorageBins failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('getVisualRack', async (req) => {
      try {
        const { reservation, item } = req.data;
        return await adapter.getVisualRack(reservation, item);
      } catch (err) {
        LOG.error('getVisualRack failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('rackLayout', async (req) => {
      try {
        return await adapter.rackLayout(req.data);
      } catch (err) {
        LOG.error('rackLayout failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('executeHuStockTransfer', async (req) => {
      try {
        return await adapter.executeHuStockTransfer(req.data);
      } catch (err) {
        LOG.error('executeHuStockTransfer failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });
  }
};

module.exports = HuStockTransferHandler;
