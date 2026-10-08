const cds = require('@sap/cds');
const Mvt261Adapter = require('../../integration/s4hana/wm/Mvt261Adapter');
const GoodsIssueAttemptStore = require('../goods-issue/GoodsIssueAttemptStore');

/** CAP service for movement type 261. */
module.exports = class Mvt261Service extends cds.ApplicationService {
  async init() {
    const adapter = new Mvt261Adapter();
    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {});
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };
    this.on('findFirst', run((data) => adapter.findFirst(data)));
    this.on('openItems', run((data) => adapter.openItems(data)));
    this.on('cycle', run((data) => adapter.cycle(data)));
    this.on('scanContext', run((data) => adapter.scanContext(data)));
    this.on('checkStorageUnit', run((data) => adapter.checkStorageUnit(data)));

    this.on('postGoodsIssue', async (req) => {
      const data = req.data || {};
      const reservation = String(data.reservation || '').trim();
      const item = String(data.item || '').trim();
      const quantity = Number(data.quantity);
      const batch = data.batch ? String(data.batch).trim() : '';

      if (!reservation || !item) {
        return req.error(400, 'Reservation and item are required');
      }
      if (!(quantity > 0)) {
        return req.error(400, 'Quantity must be greater than zero');
      }

      // Idempotency guard: prevent duplicate concurrent postings
      const hasOpen = await GoodsIssueAttemptStore.hasOpenAttemptForReservation(reservation, item);
      if (hasOpen) {
        return req.error(409, `A Goods Issue posting for reservation ${reservation}/${item} is already in progress or pending verification.`);
      }

      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(-14);
      const refDoc = `GI${suffix}`;

      const attemptData = {
        ReferenceDocument: refDoc,
        MovementType: '261',
        ReservationNo: reservation,
        ReservationItem: item,
        IssueQty: quantity,
        User: req.user?.id || 'anonymous',
        PostingDate: new Date().toISOString().slice(0, 10)
      };

      try {
        await GoodsIssueAttemptStore.create(attemptData);
      } catch (storeErr) {
        req.warn?.(storeErr.message);
      }

      try {
        const result = await adapter.postGoodsIssue({
          reservation,
          item,
          quantity,
          batch: batch || undefined,
          referenceDocument: refDoc
        });

        // WM-managed outcome: SAP created an outbound delivery, not a material document. The goods
        // issue is not yet posted, so the attempt is 'not_posted' (carrying the delivery), not 'posted'.
        await GoodsIssueAttemptStore.setStatus(refDoc, result.Pending ? 'not_posted' : 'posted', {
          MaterialDocument: result.MaterialDocument,
          MaterialDocYear: result.MaterialDocumentYear,
          DeliveryNumber: result.DeliveryNumber || '',
          LastError: result.Pending ? (result.Message || '') : ''
        }).catch(() => {});

        return result;
      } catch (err) {
        await GoodsIssueAttemptStore.setStatus(refDoc, 'rejected', {
          LastError: err.message || 'Posting failed'
        }).catch(() => {});

        return req.error(err.status || 500, err.message || 'Goods issue posting failed');
      }
    });

    return super.init();
  }
};
