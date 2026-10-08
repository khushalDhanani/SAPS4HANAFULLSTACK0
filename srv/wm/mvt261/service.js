const cds = require('@sap/cds');
const crypto = require('crypto');
const Mvt261Adapter = require('../../integration/s4hana/wm/Mvt261Adapter');
const GoodsIssueAttemptStore = require('../goods-issue/GoodsIssueAttemptStore');
const plantScope = require('../handling-unit/plantScope');

const strip = (v) => String(v || '').replace(/^0+(?=.)/, '');

/** CAP service for movement type 261. */
module.exports = class Mvt261Service extends cds.ApplicationService {
  async init() {
    const adapter = new Mvt261Adapter();
    // Plant authorization (server-side, from the authenticated user; never from the browser) - see
    // ../handling-unit/plantScope. Out-of-scope plant -> 403 in the adapter, never a silent empty list.
    const scope = (req) => plantScope(req.user);
    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {}, req);
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };
    this.on('findFirst', run((data, req) => adapter.findFirst({ ...data, allowedPlants: scope(req) })));
    this.on('openItems', run((data, req) => adapter.openItems({ ...data, allowedPlants: scope(req) })));
    this.on('cycle', run((data, req) => adapter.cycle({ ...data, allowedPlants: scope(req) })));
    this.on('scanContext', run((data, req) => adapter.scanContext({ ...data, allowedPlants: scope(req) })));
    this.on('checkStorageUnit', run((data, req) => adapter.checkStorageUnit({ ...data, allowedPlants: scope(req) })));

    this.on('postGoodsIssue', async (req) => {
      const data = req.data || {};
      const reservation = String(data.reservation || '').trim();
      const item = String(data.item || '').trim();
      const quantity = Number(data.quantity);
      const batch = data.batch ? String(data.batch).trim().toUpperCase() : '';

      if (!reservation || !item) {
        return req.error(400, 'Reservation and item are required');
      }
      if (!(quantity > 0)) {
        return req.error(400, 'Quantity must be greater than zero');
      }

      // Read the current cycle once: the open quantity makes the idempotency key (so consecutive
      // partial posts get distinct keys while a concurrent duplicate collides), and it carries the
      // reservation's pinned batch for F9. The adapter re-reads it immediately before posting.
      // allowedPlants enforces plant authorization (F10): an out-of-scope reservation is a 403 here.
      const allowedPlants = scope(req);
      let c;
      try {
        c = await adapter.cycle({ reservation, item, allowedPlants });
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }

      // F9: a batch-specific reservation may only issue its own batch. Force it; reject a mismatch.
      const reservedBatch = c.Batch ? String(c.Batch).trim().toUpperCase() : '';
      if (reservedBatch && batch && batch !== reservedBatch) {
        return req.error(422, `Batch ${batch} does not match the reservation batch ${reservedBatch}`);
      }
      const effBatch = reservedBatch || batch;

      // F3: deterministic idempotency identity = reservation + item + open quantity. Two concurrent
      // posts compute the same base key and only one wins; after a partial post the open quantity drops,
      // so the next post gets a new key. Re-claim (createOrGet with a policy): a prior attempt that
      // proves nothing posted ('rejected' = definite SAP refusal, or 'not_posted' = recheck confirmed
      // no document) is re-claimable, so fixing the cause and retrying works; a live/posted attempt
      // ('sending'/'unconfirmed'/'posted'/'delivery_created'/'needs-attention') still blocks (409). The
      // old row is kept and a new generation is suffixed to the base reference (audit trail).
      const openQty = Number(c.OpenQuantity) || 0;
      const keyHash = crypto.createHash('sha1').update(`261|${strip(reservation)}|${strip(item)}|${openQty}`).digest('hex');
      const baseRef = `GI${keyHash.slice(0, 12)}`.toUpperCase(); // base (14 chars); createOrGet adds the generation suffix
      const requestHash = crypto.createHash('sha1').update(`${strip(reservation)}|${strip(item)}|${quantity}|${effBatch}|${openQty}`).digest('hex');

      let claim;
      try {
        claim = await GoodsIssueAttemptStore.createOrGet({
          ReferenceDocument: baseRef,
          RequestHash: requestHash,
          MovementType: '261',
          ReservationNo: reservation,
          ReservationItem: item,
          Material: c.Material || '',
          Plant: c.Plant || '',
          StorageLocation: c.StorageLocation || '',
          IssueQty: quantity,
          Unit: c.Unit || '',
          User: req.user?.id || 'anonymous',
          PostingDate: new Date().toISOString().slice(0, 10)
        }, { reclaimableStatuses: ['rejected', 'not_posted'] });
      } catch (claimErr) {
        if (claimErr.status === 409) {
          // Same key, different request details: a different posting is already claimed under this key.
          return req.error(409, claimErr.message);
        }
        // Fail CLOSED: if the attempt log cannot be written we do not post, so a posting whose outcome
        // we could not record never reaches SAP.
        return req.error(503, 'The goods issue posting-attempt log is unavailable; the goods issue was NOT posted. Check the document list before retrying.');
      }

      if (!claim.created) {
        // A live or already-posted attempt holds this key (concurrent double-submit / retry).
        return req.error(409, `A goods issue for reservation ${reservation}/${item} is already in progress.`);
      }
      const refDoc = claim.row.ReferenceDocument; // base + generation; the SAP header ReferenceDocument

      try {
        const result = await adapter.postGoodsIssue({
          reservation,
          item,
          quantity,
          batch: effBatch || undefined,
          referenceDocument: refDoc,
          allowedPlants
        });

        // WM-managed outcome: SAP created an outbound delivery, not a material document. The goods
        // issue is not yet posted, so the attempt is 'delivery_created' (carrying the delivery), not
        // 'posted' - the same final status GoodsIssueAttemptStore.recheck uses for this outcome.
        await GoodsIssueAttemptStore.setStatus(refDoc, result.Pending ? 'delivery_created' : 'posted', {
          MaterialDocument: result.MaterialDocument,
          MaterialDocYear: result.MaterialDocumentYear,
          DeliveryNumber: result.DeliveryNumber || '',
          LastError: result.Pending ? (result.Message || '') : ''
        }).catch(() => {});

        return result;
      } catch (err) {
        // Unknown outcome (network / timeout: the adapter surfaces it as 502, or no status at all):
        // SAP may or may not have posted. Keep the attempt OPEN ('unconfirmed') so the recheck job can
        // resolve it, instead of dead-ending it as 'rejected'. A definite SAP rejection (e.g. 403/422)
        // stays 'rejected'. Either way the deterministic key still blocks a blind retry (409).
        const unknown = !err.status || err.status === 502 || err.status === 504;
        await GoodsIssueAttemptStore.setStatus(refDoc, unknown ? 'unconfirmed' : 'rejected', {
          LastError: err.message || 'Posting failed'
        }).catch(() => {});

        return req.error(err.status || 500, err.message || 'Goods issue posting failed');
      }
    });

    this.on('reverse', async (req) => {
      const data = req.data || {};
      const reservation = String(data.reservation || '').trim();
      const item = String(data.item || '').trim();
      const doc = String(data.materialDocument || '').trim();
      const year = String(data.materialDocumentYear || '').trim();
      const docItem = String(data.materialDocumentItem || '').trim();
      if (!reservation || !item || !doc || !year || !docItem) {
        return req.error(400, 'Reservation, item and the material document (number, year, item) are required');
      }

      // Read the cycle: enforces plant scope (F10) and gives the document history to verify the target.
      const allowedPlants = scope(req);
      let c;
      try {
        c = await adapter.cycle({ reservation, item, allowedPlants });
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }

      // The target must be a 261 document of this reservation item, and not already reversed.
      const h = (c.History || []).find((d) =>
        d.MovementType === '261' &&
        strip(d.MaterialDocument) === strip(doc) &&
        String(d.MaterialDocumentYear) === year &&
        strip(d.MaterialDocumentItem) === strip(docItem));
      if (!h) {
        return req.error(422, `Material document ${doc}/${year}/${docItem} is not a movement type 261 document of reservation ${reservation}/${item}`);
      }
      if (h.IsReversed) {
        return req.error(422, `Material document ${doc}/${year} item ${docItem} is already reversed`);
      }

      // Atomic idempotency claim keyed on the exact document item. Re-claim ONLY on 'rejected' (a
      // definite SAP refusal, e.g. a closed period reopened): NOT on 'not_posted', because the shared
      // recheck looks a reversal up by our RV key but SAP's CancelItem stamps the 262 with the ORIGINAL
      // 261's ReferenceDocument - so a reversal that actually posted can be mislabelled 'not_posted', and
      // re-claiming it would risk a double reversal. A stuck 'not_posted'/'unconfirmed' reversal is cleared
      // by an operator only after an MB51 check (see the runbook in QA_261.md).
      const keyHash = crypto.createHash('sha1').update(`262|${strip(doc)}|${year}|${strip(docItem)}`).digest('hex');
      const baseRef = `RV${keyHash.slice(0, 12)}`.toUpperCase();
      const requestHash = keyHash;
      let claim;
      try {
        claim = await GoodsIssueAttemptStore.createOrGet({
          ReferenceDocument: baseRef, RequestHash: requestHash, MovementType: '262',
          ReservationNo: reservation, ReservationItem: item, Material: c.Material || '', Plant: c.Plant || '',
          MaterialDocument: doc, MaterialDocYear: year, User: req.user?.id || 'anonymous', PostingDate: new Date().toISOString().slice(0, 10)
        }, { reclaimableStatuses: ['rejected'] });
      } catch (claimErr) {
        if (claimErr.status === 409) return req.error(409, claimErr.message);
        return req.error(503, 'The reversal attempt log is unavailable; the reversal was NOT posted. Check the document list before retrying.');
      }
      if (!claim.created) {
        return req.error(409, `A reversal for material document ${doc}/${year} item ${docItem} is already in progress.`);
      }
      const refDoc = claim.row.ReferenceDocument; // base + generation

      try {
        const result = await adapter.reverse({ materialDocument: doc, materialDocumentYear: year, materialDocumentItem: docItem });
        await GoodsIssueAttemptStore.setStatus(refDoc, 'posted', {
          MaterialDocument: result.MaterialDocument, MaterialDocYear: result.MaterialDocumentYear, LastError: ''
        }).catch(() => {});
        return result;
      } catch (err) {
        const msg = String(err.message || '');
        const alreadyReversed = /already|reversed|cancel/i.test(msg);
        // Definite "already reversed" stays 'rejected'; an unknown outcome (timeout → 502, or no status)
        // is kept OPEN ('unconfirmed') for the recheck job rather than dead-ended.
        const unknown = !alreadyReversed && (!err.status || err.status === 502 || err.status === 504);
        await GoodsIssueAttemptStore.setStatus(refDoc, unknown ? 'unconfirmed' : 'rejected', { LastError: msg || 'Reversal failed' }).catch(() => {});
        if (alreadyReversed) {
          return req.error(422, `Material document ${doc}/${year} item ${docItem} is already reversed`);
        }
        return req.error(err.status || 500, msg || 'Reversal failed');
      }
    });

    return super.init();
  }
};
