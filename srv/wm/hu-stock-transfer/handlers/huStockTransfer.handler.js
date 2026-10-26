const crypto = require('crypto');
const cds = require('@sap/cds');
const LOG = cds.log('hu-stock-transfer-handler');
const HuStockTransferAdapter = require('../../../integration/s4hana/wm/HuStockTransferAdapter');
const GoodsIssueAttemptStore = require('../../goods-issue/GoodsIssueAttemptStore');
const { plantScope, isPlantAllowed } = require('../../reservation-entry/readScope');

const adapter = new HuStockTransferAdapter();

function scopeError(plant) {
  const err = new Error(`Plant ${plant || '(none)'} is outside the authenticated user's plant scope`);
  err.status = 403;
  return err;
}

/** Non-Admin users may only touch reservations of their own plants; returns the cockpit it had to read, else null. */
async function assertReservationInScope(req, reservation, item) {
  const allowed = plantScope(req.user);
  if (allowed === null) return null;
  const cockpit = await adapter.getCockpitDetail(reservation, item);
  if (!isPlantAllowed(cockpit.Plant, allowed)) throw scopeError(cockpit.Plant);
  return cockpit;
}

const HuStockTransferHandler = {
  init(srv) {
    srv.on('getOpenReservations', async (req) => {
      try {
        const allowed = plantScope(req.user);
        if (allowed !== null && !isPlantAllowed(req.data.plant, allowed)) throw scopeError(req.data.plant);
        return await adapter.getOpenReservations(req.data);
      } catch (err) {
        LOG.error('getOpenReservations failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('getCockpitDetail', async (req) => {
      try {
        const { reservation, item } = req.data;
        return (await assertReservationInScope(req, reservation, item)) || await adapter.getCockpitDetail(reservation, item);
      } catch (err) {
        LOG.error('getCockpitDetail failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('validateUnit', async (req) => {
      try {
        const { reservation, item, unitNumber } = req.data;
        await assertReservationInScope(req, reservation, item);
        return await adapter.validateUnit(reservation, item, unitNumber);
      } catch (err) {
        LOG.error('validateUnit failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('validateHuStockTransferSelection', async (req) => {
      try {
        // Adapter method is read-only; deliberately do not route to executeHuStockTransfer.
        await assertReservationInScope(req, req.data?.ReservationNo, req.data?.ReservationItem || '1');
        return await adapter.validateHuStockTransferSelection(req.data || {});
      } catch (err) {
        LOG.error('validateHuStockTransferSelection failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('getStorageBins', async (req) => {
      try {
        const { reservation, item } = req.data;
        await assertReservationInScope(req, reservation, item);
        return await adapter.getStorageBins(reservation, item);
      } catch (err) {
        LOG.error('getStorageBins failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('getVisualRack', async (req) => {
      try {
        const { reservation, item } = req.data;
        await assertReservationInScope(req, reservation, item);
        return await adapter.getVisualRack(reservation, item);
      } catch (err) {
        LOG.error('getVisualRack failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    srv.on('rackLayout', async (req) => {
      try {
        if (req.data.reservation) await assertReservationInScope(req, req.data.reservation, req.data.item || '1');
        else if (plantScope(req.user) !== null) throw scopeError(''); // a warehouse-wide layout has no plant to scope by
        return await adapter.rackLayout(req.data);
      } catch (err) {
        LOG.error('rackLayout failed:', err.message);
        return req.error(err.status || 500, err.message);
      }
    });

    /** Posts one unit: scope check, attempt claim (fail closed), adapter posting, status bookkeeping. Throws on failure. */
    async function postOne(req, data) {
      const resv = String(data.ReservationNo || '').trim();
      const item = String(data.ReservationItem || '1').trim();
      const unit = String(data.UnitNumber || '').trim();
      const qty = Number(data.TransferQty || 0);
      const clientAttemptId = String(data.ClientAttemptId || '').trim();

      await assertReservationInScope(req, resv, item);

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
        const err = new Error(`HU stock transfer was NOT sent to SAP: production transaction logging is unavailable (${attemptErr.message || 'database unavailable'}). Check the document list before retrying.`);
        err.status = attemptErr.status || 503;
        throw err;
      }

      if (!claim.created) {
        const err = new Error(`An HU stock transfer for reservation ${resv}/${item} unit ${unit} is already in progress.`);
        err.status = 409;
        throw err;
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
        // A write whose SAP outcome is unknown stays 'unconfirmed' so recheck can find the document; it is not a rejection.
        const status = err.sapWriteAttempted ? 'unconfirmed' : 'rejected';
        await GoodsIssueAttemptStore.setStatus(baseRef, status, {
          LastError: err.message || '',
          ...(err.materialDocument ? { MaterialDocument: err.materialDocument, MaterialDocYear: err.materialDocYear || '' } : {})
        }).catch((e) => LOG.error(`Failed to record ${status} status for ${baseRef}:`, e));
        LOG.error('executeHuStockTransfer failed:', err.message);
        throw err;
      }
    }

    srv.on('executeHuStockTransfer', async (req) => {
      try {
        return await postOne(req, req.data || {});
      } catch (err) {
        return req.error(err.status || 500, err.message);
      }
    });

    // Multi-HU posting: one 311 document per HU, in the given order. The whole selection is validated
    // read-only first; posting stops at the first failure and every outcome is reported per HU.
    srv.on('executeHuStockTransferSelection', async (req) => {
      const data = req.data || {};
      const selections = Array.isArray(data.Selections) ? data.Selections : [];
      const attemptBase = String(data.ClientAttemptId || '').trim();
      if (!attemptBase) return req.error(400, 'ClientAttemptId is required');
      try {
        await assertReservationInScope(req, data.ReservationNo, data.ReservationItem || '1');
        await adapter.validateHuStockTransferSelection({ ReservationNo: data.ReservationNo, ReservationItem: data.ReservationItem, Selections: selections });
      } catch (err) {
        return req.error(err.status || 500, err.message);
      }

      const items = [];
      for (let i = 0; i < selections.length; i++) {
        const sel = selections[i];
        const base = { UnitNumber: sel.UnitNumber, TransferQty: Number(sel.TransferQty) };
        try {
          const r = await postOne(req, { ReservationNo: data.ReservationNo, ReservationItem: data.ReservationItem, ...base, IsFullUnit: false, ClientAttemptId: `${attemptBase}-${i + 1}` });
          items.push({ ...base, Success: true, MaterialDocument: r.MaterialDocument, MaterialDocYear: r.MaterialDocYear, Message: r.Message });
        } catch (err) {
          items.push({ ...base, Success: false, MaterialDocument: '', MaterialDocYear: '', Message: err.message });
          break; // documents already posted above are real; the remaining HUs are left untouched
        }
      }
      const posted = items.filter((x) => x.Success).length;
      const failed = items.length - posted;
      const skipped = selections.length - items.length;
      return {
        Success: failed === 0 && skipped === 0,
        ReservationNo: String(data.ReservationNo || ''),
        ReservationItem: String(data.ReservationItem || '1'),
        PostedCount: posted,
        FailedCount: failed,
        SkippedCount: skipped,
        Items: items,
        Message: failed
          ? `${posted} of ${selections.length} handling units posted; posting stopped at ${items[items.length - 1].UnitNumber} (${skipped} not attempted).`
          : `${posted} handling unit(s) posted and read back from SAP.`
      };
    });
  }
};

module.exports = HuStockTransferHandler;
