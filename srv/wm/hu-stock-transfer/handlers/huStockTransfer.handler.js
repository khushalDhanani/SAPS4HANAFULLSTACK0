const crypto = require('crypto');
const cds = require('@sap/cds');
const LOG = cds.log('hu-stock-transfer-handler');
const HuStockTransferAdapter = require('../../../integration/s4hana/wm/HuStockTransferAdapter');
const GoodsIssueAttemptStore = require('../../goods-issue/GoodsIssueAttemptStore');

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
      const data = req.data || {};
      const resv = String(data.ReservationNo || '').trim();
      const item = String(data.ReservationItem || '1').trim();
      const unit = String(data.UnitNumber || '').trim();
      const qty = Number(data.TransferQty || 0);
      const clientAttemptId = String(data.ClientAttemptId || '').trim();

      const keyHash = crypto.createHash('sha1').update(`311|HU|${resv}|${item}|${unit}|${qty}`).digest('hex');
      const baseRef = clientAttemptId
        ? `HU${crypto.createHash('sha1').update(clientAttemptId).digest('hex').slice(0, 12)}`.toUpperCase()
        : `HU${keyHash.slice(0, 12)}`.toUpperCase();

      let claim;
      try {
        claim = await GoodsIssueAttemptStore.createOrGet({
          ReferenceDocument: baseRef,
          RequestHash: keyHash,
          MovementType: '311',
          ReservationNo: resv,
          ReservationItem: item,
          IssueQty: qty,
          User: req.user?.id || 'anonymous',
          PostingDate: new Date().toISOString().slice(0, 10)
        }, { reclaimableStatuses: ['rejected', 'not_posted'] });
      } catch (attemptErr) {
        LOG.error('HU transfer posting attempt could not be recorded; SAP write blocked:', attemptErr.message || attemptErr);
        return req.error(attemptErr.status || 503, `HU stock transfer was NOT sent to SAP: production transaction logging is unavailable (${attemptErr.message || 'database unavailable'}). Check the document list before retrying.`);
      }

      if (!claim.created) {
        return req.error(409, `An HU stock transfer for reservation ${resv}/${item} unit ${unit} is already in progress.`);
      }

      try {
        const result = await adapter.executeHuStockTransfer(data);
        if (result && result.MaterialDocument) {
          await GoodsIssueAttemptStore.setStatus(baseRef, 'posted', {
            MaterialDocument: result.MaterialDocument,
            MaterialDocYear: result.MaterialDocYear || String(new Date().getFullYear())
          }).catch((e) => LOG.error(`Failed to record posted status for ${baseRef}:`, e));
        }
        return result;
      } catch (err) {
        await GoodsIssueAttemptStore.setStatus(baseRef, 'rejected', { LastError: err.message || '' })
          .catch((e) => LOG.error(`Failed to record rejected status for ${baseRef}:`, e));
        LOG.error('executeHuStockTransfer failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });
  }
};

module.exports = HuStockTransferHandler;
