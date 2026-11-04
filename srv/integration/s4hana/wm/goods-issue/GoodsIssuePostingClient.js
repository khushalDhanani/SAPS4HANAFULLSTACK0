const LOG = require('../../logger')('goods-issue-posting');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');
const { RfcClient } = require('../../RfcClient');

/**
 * Read-only SAP lookups behind the posting-attempt re-check: posted document, delivery and read-back.
 */
class GoodsIssuePostingClient extends BaseGoodsIssueClient {

  constructor(options = {}) {
    super(options);
    this.batchesClient = options.batchesClient || (this.adapter && this.adapter.batches) || null;
    this.rfc = options.rfc || (options.adapter && options.adapter.rfc) || new RfcClient();
    this.readBackTimeoutMs = options.readBackTimeoutMs || Number(process.env.GI_READBACK_TIMEOUT_MS) || 5000;
    this.maxConcurrentReadBacks = options.maxConcurrentReadBacks || Number(process.env.GI_MAX_CONCURRENT_READBACKS) || 5;
    this._activeReadBacks = 0;
    this._readBackWaiters = [];
  }

  async _acquireReadBackSlot(signal) {
    if (this._activeReadBacks < this.maxConcurrentReadBacks) {
      this._activeReadBacks++;
      return;
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      if (signal && typeof signal.addEventListener === 'function') {
        const onAbort = () => {
          const idx = this._readBackWaiters.indexOf(waiter);
          if (idx >= 0) this._readBackWaiters.splice(idx, 1);
          const err = new Error('Read-back slot acquisition aborted');
          err.name = 'AbortError';
          reject(err);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      this._readBackWaiters.push(waiter);
    });
  }

  _releaseReadBackSlot() {
    this._activeReadBacks = Math.max(0, this._activeReadBacks - 1);
    while (this._readBackWaiters.length > 0 && this._activeReadBacks < this.maxConcurrentReadBacks) {
      const next = this._readBackWaiters.shift();
      if (next.cleanup) next.cleanup();
      this._activeReadBacks++;
      next.resolve();
    }
  }

  /** @private RFC_READ_TABLE accessor, or null when no RFC table access exists. */
  _readTableFn() {
    if (this.rfc && typeof this.rfc.readTable === 'function') return (t, f, w) => this.rfc.readTable(t, f, w);
    if (this.adapter && typeof this.adapter.readTable === 'function') return (t, f, w) => this.adapter.readTable(t, f, w);
    return null;
  }

  /** @private LIKP headers for delivery numbers, mapped to the delivery shape. Field set live-verified. */
  async _readDeliveryHeaders(readTable, where) {
    const rows = await readTable('LIKP', ['VBELN', 'LFART', 'ERDAT', 'ERZET', 'WBSTK', 'LIFEX'], where);
    return rows.map((r) => ({
      DeliveryNumber: String(r.VBELN || '').trim(),
      DeliveryType: String(r.LFART || '').trim(),
      CreatedOn: String(r.ERDAT || '').trim(),
      CreatedTime: String(r.ERZET || '').trim(), // SAP server time; time zone not verified
      GoodsMovementStatus: String(r.WBSTK || '').trim(),
      ExternalId: String(r.LIFEX || '').trim(),
      // WBSTK C = goods movement completed; anything else (A/B/blank) still needs PGI.
      Open: String(r.WBSTK || '').trim() !== 'C'
    }));
  }

  /**
   * Deliveries SAP created for a reservation item (LIPS by RSNUM/RSPOS, joined to LIKP), read-only.
   * Throws (never returns []) when the tables cannot be read, so a failed read is never mistaken
   * for "no delivery".
   */
  async findDeliveriesForReservationItem(reservationNo, reservationItem) {
    const readTable = this._readTableFn();
    if (!readTable) {
      const err = new Error('No RFC table access: cannot verify outbound deliveries (LIKP/LIPS) for the reservation item.');
      err.status = 502;
      throw err;
    }
    const rsnum = String(reservationNo || '').trim().padStart(10, '0');
    const rspos = String(reservationItem || '').trim().padStart(4, '0');
    const items = await readTable('LIPS', ['VBELN', 'POSNR', 'LFIMG', 'VRKME', 'BWART'],
      [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`]);
    if (items.length === 0) return [];
    const numbers = [...new Set(items.map((i) => String(i.VBELN).trim()))];
    // One equality per line, OR-joined without parentheses (the RFC parser rejects them).
    const headers = await this._readDeliveryHeaders(readTable, numbers.map((n, i) => `${i ? 'OR ' : ''}VBELN = '${n}'`));
    const byNo = new Map(headers.map((h) => [h.DeliveryNumber, h]));
    return items.map((i) => ({
      ...(byNo.get(String(i.VBELN).trim()) || { DeliveryNumber: String(i.VBELN).trim(), Open: true }),
      Item: String(i.POSNR || '').trim(),
      Quantity: Number(i.LFIMG),
      Unit: String(i.VRKME || '').trim(),
      MovementType: String(i.BWART || '').trim()
    }));
  }

  /**
   * Delivery carrying our posting reference. SAP copies the material document header
   * ReferenceDocument into LIKP-LIFEX (live-verified: 0080000074 <-> GI65GEUZ94A5JDZ0).
   * Null when none; throws when the table cannot be read.
   */
  async findDeliveryByReference(referenceDocument) {
    const ref = String(referenceDocument || '').trim();
    if (!ref) return null;
    const readTable = this._readTableFn();
    if (!readTable) {
      const err = new Error('No RFC table access: cannot verify outbound deliveries (LIKP) for the posting reference.');
      err.status = 502;
      throw err;
    }
    const [hit] = await this._readDeliveryHeaders(readTable, [`LIFEX = '${ref}'`]);
    return hit || null;
  }

  // ==========================================================================
  // ISOLATED per-movement-type posting (Phase 1). Each public method owns its
  // own tier choice + type mapper and touches no other type's logic. The private
  // helpers below (_assertPostable / _preflightPosting / _submitMaterialDocument)
  // are pure TRANSPORT infrastructure (HTTP, batch SLED, destination) shared by
  // all types - they contain no movement-type branching.
  // ==========================================================================

  /** @private POST an A_MaterialDocumentHeader payload and normalize the result. Transport only. */

  /**
   * Reads a material document back from SAP to confirm persistence and verify authoritative values.
   *
   * Fallback Sequence on SAP S/4HANA:
   * 1. Primary (Tier 1): RFC readTable on SAP S/4HANA universal journal/doc table 'MATDOC'
   * 2. Fallback 1 (Tier 2): RFC readTable on material document header table 'MKPF'
   * 3. Fallback 2 (Tier 3): OData GET API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader
   *
   * Commit-Lag & Error Contract:
   * If SAP returned a document number but read-back returns nothing (e.g. Gateway commit lag),
   * times out, or throws an error, the document number is STILL returned marked as "not yet confirmed"
   * (Confirmed: false, Status: 'not yet confirmed'). It NEVER reports failure, NEVER 504s, and NEVER queues.
   *
   * Year Contract:
   * MaterialDocYear is obtained from SAP MJAHR or derived from the SAP posting date (BUDAT).
   * MJAHR from SAP is strictly preferred over BUDAT-derived year. It is NEVER derived from the local clock.
   *
   * @param {string} matDoc - Material document number returned by SAP
   * @param {string} [matYear] - Material document year returned by SAP
   * @param {Object} [options]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<{ MaterialDocument: string, MaterialDocYear: string, Confirmed: boolean, Status: string, Tier?: string, Items?: Array }>}
   */
  async readBackDocument(matDoc, matYear, options = {}) {
    const sDoc = String(matDoc || '').trim();
    const sYear = String(matYear || '').trim();
    if (!sDoc) return null;

    const timeoutMs = Number(options.timeoutMs || this.readBackTimeoutMs || 5000);
    const unconfirmedFallback = {
      MaterialDocument: sDoc,
      MaterialDocYear: sYear,
      Confirmed: false,
      Status: 'posted, confirmation pending'
    };

    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const signal = options.signal || controller?.signal;
    const clientRef = options.client || this.client;
    if (clientRef && clientRef.supportsAbort) {
      clientRef.abortSignal = signal;
    }

    let slotAcquired = false;
    try {
      await this._acquireReadBackSlot(signal);
      slotAcquired = true;
    } catch (acqErr) {
      LOG.warn(`Could not acquire read-back slot: ${acqErr.message}`);
      return unconfirmedFallback;
    }

    const doReadBack = async () => {
      // 1. Primary: RFC readTable on MATDOC
      if (this.rfc && typeof this.rfc.readTable === 'function') {
        try {
          const where = [`MBLNR = '${sDoc}'`];
          if (sYear) where.push(`AND MJAHR = '${sYear}'`);
          const rows = await this.rfc.readTable(
            'MATDOC',
            ['MBLNR', 'MJAHR', 'BUDAT', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'MENGE', 'MEINS', 'RSNUM', 'RSPOS'],
            where,
            10
          );
          if (Array.isArray(rows) && rows.length > 0) {
            const docRow = rows[0];
            // Prefer MJAHR from SAP over BUDAT-derived year
            let confirmedYear = String(docRow.MJAHR || '').trim();
            if (!confirmedYear && docRow.BUDAT) {
              confirmedYear = String(docRow.BUDAT).trim().slice(0, 4);
            }
            const movementTypes = rows.map((row) => String(row.BWART || '').trim());
            if (options.expectedMovementType && (movementTypes.length === 0 || movementTypes.some((value) => value !== options.expectedMovementType))) {
              return {
                MaterialDocument: sDoc, MaterialDocYear: sYear, Confirmed: false,
                Status: 'movement type mismatch', Tier: 'MATDOC', Items: rows
              };
            }
            return {
              MaterialDocument: String(docRow.MBLNR).trim(),
              MaterialDocYear: confirmedYear || sYear,
              Confirmed: true,
              Status: 'confirmed',
              Tier: 'MATDOC',
              Items: rows
            };
          }
        } catch (err) {
          LOG.warn(`RFC readTable MATDOC readback for ${sDoc}/${sYear} failed: ${err.message}. Trying MKPF fallback...`);
        }

        // MKPF has no movement type. It can prove document-header persistence only, so do not
        // use it when the caller requires strict GoodsMovementType confirmation.
        if (!options.expectedMovementType) {
          // 2. Fallback 1: RFC readTable on MKPF
          try {
            const where = [`MBLNR = '${sDoc}'`];
            if (sYear) where.push(`AND MJAHR = '${sYear}'`);
            const rows = await this.rfc.readTable('MKPF', ['MBLNR', 'MJAHR', 'BLDAT', 'BUDAT', 'CPUDT', 'CPUTM'], where, 1);
            if (Array.isArray(rows) && rows.length > 0) {
              const mkpfRow = rows[0];
              let confirmedYear = String(mkpfRow.MJAHR || '').trim();
              if (!confirmedYear && mkpfRow.BUDAT) confirmedYear = String(mkpfRow.BUDAT).trim().slice(0, 4);
              return {
                MaterialDocument: String(mkpfRow.MBLNR).trim(),
                MaterialDocYear: confirmedYear || sYear,
                Confirmed: true,
                Status: 'confirmed',
                Tier: 'MKPF'
              };
            }
          } catch (mkpfErr) {
            LOG.warn(`RFC readTable MKPF readback failed: ${mkpfErr.message}. Trying OData fallback...`);
          }
        }
      }

      // 3. Fallback 2: OData A_MaterialDocumentHeader GET
      try {
        let docPath;
        if (sYear) {
          docPath = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader(MaterialDocumentYear='${sYear}',MaterialDocument='${sDoc}')${options.expectedMovementType ? '?$expand=to_MaterialDocumentItem' : ''}`;
        } else {
          docPath = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader?$filter=MaterialDocument eq '${sDoc}'&$top=1&$format=json${options.expectedMovementType ? '&$expand=to_MaterialDocumentItem' : ''}`;
        }
        const res = await this._get(docPath, '$format=json', { signal });
        const header = Array.isArray(res) ? res[0] : (res?.d || res);
        if (header && (header.MaterialDocument || header.MaterialDocumentYear)) {
          const items = header.to_MaterialDocumentItem?.results || [];
          if (options.expectedMovementType && (items.length === 0 || items.some((item) => String(item.GoodsMovementType || '').trim() !== options.expectedMovementType))) {
            return {
              MaterialDocument: sDoc, MaterialDocYear: sYear, Confirmed: false,
              Status: 'movement type mismatch', Tier: 'OData', Items: items
            };
          }
          let confirmedYear = String(header.MaterialDocumentYear || '').trim();
          if (!confirmedYear && header.PostingDate) {
            const m = String(header.PostingDate).match(/\d{4}/);
            if (m) confirmedYear = m[0];
          }
          return {
            MaterialDocument: String(header.MaterialDocument || sDoc).trim(),
            MaterialDocYear: confirmedYear || sYear,
            Confirmed: true,
            Status: 'confirmed',
            Tier: 'OData'
          };
        }
      } catch (odataErr) {
        LOG.warn(`OData readback for ${sDoc}/${sYear} failed: ${odataErr.message}`);
      }

      return unconfirmedFallback;
    };

    let timer;
    try {
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
          LOG.warn(`readBackDocument for ${sDoc}/${sYear} timed out after ${timeoutMs}ms; returning unconfirmed document`);
          if (controller) {
            try { controller.abort(); } catch (_) {}
          }
          resolve(unconfirmedFallback);
        }, timeoutMs);
      });
      const result = await Promise.race([
        doReadBack().catch((err) => {
          LOG.warn(`readBackDocument error for ${sDoc}/${sYear}: ${err.message}; returning unconfirmed document`);
          return unconfirmedFallback;
        }),
        timeoutPromise
      ]);
      return result || unconfirmedFallback;
    } catch (err) {
      LOG.warn(`readBackDocument unexpected error for ${sDoc}/${sYear}: ${err.message}`);
      return unconfirmedFallback;
    } finally {
      if (timer) clearTimeout(timer);
      if (slotAcquired) this._releaseReadBackSlot();
    }
  }

  /**
   * Looks up a material document this app already posted under an idempotency reference.
   * SAP does not enforce uniqueness on ReferenceDocument and the 202 reversal copies it from the
   * original, so several headers can match: only one carrying an item of the expected movement type
   * counts. The posting date narrows the filter when known. The SAP user is not filtered on: it is
   * the destination's technical (or propagated) user, which this layer does not know.
   *
   * @param {string} referenceDocument
   * @param {string} mvt - expected GoodsMovementType of the original document
   * @param {string|Date} [postingDate]
   * @returns {Promise<{MaterialDocument:string,MaterialDocumentYear:string}|null>}
   */
  async findPostedByReference(referenceDocument, mvt, postingDate) {
    const ref = String(referenceDocument || '').trim().replace(/'/g, '');
    if (!ref) return null;
    const day = postingDate ? this._formatDate(postingDate) : '';
    const filter = `ReferenceDocument eq '${ref}'` +
      (/^\d{4}-\d{2}-\d{2}$/.test(day) ? ` and PostingDate eq datetime'${day}T00:00:00'` : '');
    const hits = await this._get(
      '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
      `$format=json&$expand=to_MaterialDocumentItem&$filter=${encodeURIComponent(filter)}`
    );
    const originals = (Array.isArray(hits) ? hits : [])
      .filter((h) => {
        const items = h.to_MaterialDocumentItem?.results || [];
        return items.length > 0 && items.every((i) => String(i.GoodsMovementType || '').trim() === mvt);
      })
      .sort((a, b) => String(a.MaterialDocument).localeCompare(String(b.MaterialDocument)));
    if (originals.length > 1) {
      LOG.warn(`Reference ${ref} matches ${originals.length} movement ${mvt} documents (${originals.map((h) => h.MaterialDocument).join(', ')}); using the first.`);
    }
    return originals[0] || null;
  }

}

module.exports = GoodsIssuePostingClient;
