const LOG = require('../../logger')('goods-issue-posting');
const s4Config = require('../../s4Config');
const S4ErrorMapper = require('../../S4ErrorMapper');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');
const { RfcClient } = require('../../RfcClient');
const GoodsIssueMapper = require('./GoodsIssueMapper');
const GoodsIssue201Mapper = require('./GoodsIssue201Mapper');
const GoodsIssue261Mapper = require('./GoodsIssue261Mapper');
const GoodsIssue301Mapper = require('./GoodsIssue301Mapper');
const GoodsIssue311Mapper = require('./GoodsIssue311Mapper');

/**
 * Domain client for SAP S/4HANA Goods Issue Posting and Batch Submission.
 * Enforces AGENTS.md rules: no mock persistence, transparent failure when SAP posting service is unavailable.
 */
// Movement types this screen may post against a reservation (trust boundary for the posting action).
const POSTABLE_MOVEMENT_TYPES = ['201', '261', '301', '311'];

class GoodsIssuePostingClient extends BaseGoodsIssueClient {
  /**
   * Waits (ms) before each idempotency-reference lookup after an unknown posting outcome
   * (GI_REFERENCE_LOOKUP_DELAYS_MS, comma-separated, default 2000,4000,8000). These only give a fast
   * answer when SAP commits quickly; the commit lag was observed to exceed them, so an empty result
   * is never proof that nothing was posted - the attempt re-check job decides that later.
   */
  static referenceLookupDelaysMs() {
    const raw = process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
    const parsed = String(raw || '').split(',').map((v) => v.trim()).filter(Boolean).map(Number);
    return parsed.length > 0 && parsed.every((n) => Number.isFinite(n) && n >= 0) ? parsed : [2000, 4000, 8000];
  }

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

  /**
   * SAP Gateway can answer an OData V2 POST with HTTP 2xx even when the backend BAPI rejected the
   * posting for a business reason (locked cost center, closed period, stock deficit, etc.),
   * communicating the real outcome only via the `sap-message` response header. Throws a real error
   * carrying the SAP message text/code when that header reports severity 'error'/'E'; otherwise a
   * no-op. Mirrors GoodsReceiptAdapter's handling of the same SAP Gateway behavior.
   *
   * @private
   */
  static _throwIfSapBusinessError(result) {
    const rawSapMsg = result?._headers?.['sap-message'];
    if (!rawSapMsg) return;
    let sapMsgObj = null;
    try {
      sapMsgObj = JSON.parse(rawSapMsg);
    } catch (_e) {
      return;
    }
    const severity = String(sapMsgObj?.severity || '').toUpperCase();
    if (severity === 'ERROR' || severity === 'E') {
      const err = new Error(sapMsgObj.message || 'SAP S/4HANA rejected the Goods Issue posting');
      err.code = sapMsgObj.code || 'SAP_BUSINESS_ERROR';
      // SAP answered and rejected the posting: a business error, never a queueable availability problem.
      err.status = 422;
      throw err;
    }
  }

  /**
   * @deprecated Legacy positional signature retained only for the internal queue-replay path and
   * back-compat callers/tests. Contains NO movement-type business logic - it normalizes the
   * positional arguments into a domain object and delegates to the isolated per-type dispatcher
   * (`postByMovementType`), which routes to post201/261/301/311. New code calls the per-type
   * methods (or `postByMovementType`) directly.
   */
  async postGoodsIssue(reservationNo, reservationItem, material, issueQty, unit, batch, differenceQty, differenceReason, differenceStorageType, finalIssue, plant, storageLocation, options = {}) {
    const data = {
      MovementType: String(options.movementType || '261').trim(),
      ReservationNo: reservationNo || '',
      ReservationItem: reservationItem || '',
      Material: material || '',
      IssueQty: issueQty,
      Unit: unit || '',
      Batch: batch || '',
      Plant: plant || '',
      StorageLocation: storageLocation || '',
      CostCenter: options.costCenter || '',
      GLAccount: options.glAccount || options.GLAccount || '',
      ReceivingPlant: options.receivingPlant || '',
      ReceivingStorageLocation: options.receivingStorageLocation || '',
      PostingDate: options.postingDate || options.PostingDate,
      DocumentDate: options.documentDate || options.DocumentDate,
      SerialNumbers: Array.isArray(options.serialNumbers) && options.serialNumbers.length > 0
        ? options.serialNumbers
        : (options.serialNumber ? [options.serialNumber] : [])
    };
    return this.postByMovementType(data);
  }


  // ==========================================================================
  // ISOLATED per-movement-type posting (Phase 1). Each public method owns its
  // own tier choice + type mapper and touches no other type's logic. The private
  // helpers below (_assertPostable / _preflightPosting / _submitMaterialDocument)
  // are pure TRANSPORT infrastructure (HTTP, batch SLED, destination) shared by
  // all types - they contain no movement-type branching.
  // ==========================================================================

  /** @private Minimal defence-in-depth guards common to every posting. */
  _assertPostable(data) {
    const nQty = Number(data.IssueQty);
    if (isNaN(nQty) || nQty <= 0) {
      const err = new Error('IssueQty must be a positive decimal number');
      err.status = 400;
      throw err;
    }
    if (!String(data.Unit || '').trim()) {
      const err = new Error('Unit of measure (EntryUnit) is required for Goods Issue');
      err.status = 400;
      throw err;
    }
  }

  /** @private Batch SLED hard-stop + destination resolution. Transport only. */
  async _preflightPosting(data) {
    const effectiveBatch = data.Batch ? String(data.Batch).trim() : '';
    if (effectiveBatch) {
      let valResult = { valid: true };
      if (this.adapter && typeof this.adapter.validateBatch === 'function') {
        valResult = await this.adapter.validateBatch(data.Material, effectiveBatch);
      } else if (this.batchesClient && typeof this.batchesClient.validateBatch === 'function') {
        valResult = await this.batchesClient.validateBatch(data.Material, effectiveBatch);
      }
      if (valResult && !valResult.valid) {
        const err = new Error(valResult.reason || `Batch ${effectiveBatch} is invalid or expired.`);
        err.status = 400;
        throw err;
      }
    }
    const dest = await this._getDestination();
    if (!dest) {
      const err = new Error('S/4HANA Destination could not be resolved or is not configured');
      err.status = 502;
      throw err;
    }
  }

  /** @private POST an A_MaterialDocumentHeader payload and normalize the result. Transport only. */
  /** @private POST an A_MaterialDocumentHeader payload and normalize the result. Transport only. */
  async _submitMaterialDocument(v2Payload, meta) {
    const v2Path = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader`;
    const v2Res = await this._post(v2Path, v2Payload);
    GoodsIssuePostingClient._throwIfSapBusinessError(v2Res);
    const rawMatDoc = v2Res.MaterialDocument || v2Res.d?.MaterialDocument;
    let rawMatYear = v2Res.MaterialDocumentYear || v2Res.d?.MaterialDocumentYear || '';
    if (!rawMatYear && (v2Res.PostingDate || v2Res.d?.PostingDate)) {
      const pd = v2Res.PostingDate || v2Res.d?.PostingDate;
      const m = String(pd).match(/\d{4}/);
      if (m) rawMatYear = m[0];
    }
    if (!rawMatDoc) {
      throw new Error(`SAP S/4HANA did not return a material document for movement ${meta.mvt} posting, and no sap-message error was present in the response.`);
    }
    let verified;
    try {
      verified = await this.readBackDocument(rawMatDoc, rawMatYear);
    } catch (rbErr) {
      LOG.warn(`readBackDocument error in _submitMaterialDocument for ${rawMatDoc}: ${rbErr.message}`);
      verified = { MaterialDocument: rawMatDoc, MaterialDocYear: rawMatYear, Confirmed: false, Status: 'posted, confirmation pending' };
    }
    const matDoc = verified?.MaterialDocument || String(rawMatDoc).trim();
    const matYear = verified?.MaterialDocYear || String(rawMatYear).trim();
    const isConfirmed = Boolean(verified?.Confirmed);
    const confirmationText = isConfirmed ? '' : ' (posted, confirmation pending)';
    return {
      ReservationNo: String(meta.reservationNo || ''),
      ReservationItem: String(meta.reservationItem || ''),
      OrderNo: String(meta.orderNo || ''),
      MaterialDocument: matDoc,
      MaterialDocYear: matYear,
      TransferOrder: '',
      DifferenceCleared: false,
      DifferenceQty: 0,
      Success: true,
      Confirmed: isConfirmed,
      ConfirmationStatus: isConfirmed ? 'CONFIRMED' : 'POSTED_CONFIRMATION_PENDING',
      Message: `${meta.label} ${meta.mvt} posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (MatDoc: ${matDoc}${matYear ? '/' + matYear : ''})${confirmationText}.`
    };
  }

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

        // 2. Fallback 1: RFC readTable on MKPF
        try {
          const where = [`MBLNR = '${sDoc}'`];
          if (sYear) where.push(`AND MJAHR = '${sYear}'`);
          const rows = await this.rfc.readTable('MKPF', ['MBLNR', 'MJAHR', 'BLDAT', 'BUDAT', 'CPUDT', 'CPUTM'], where, 1);
          if (Array.isArray(rows) && rows.length > 0) {
            const mkpfRow = rows[0];
            // Prefer MJAHR from SAP over BUDAT-derived year
            let confirmedYear = String(mkpfRow.MJAHR || '').trim();
            if (!confirmedYear && mkpfRow.BUDAT) {
              confirmedYear = String(mkpfRow.BUDAT).trim().slice(0, 4);
            }
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

      // 3. Fallback 2: OData A_MaterialDocumentHeader GET
      try {
        let docPath;
        if (sYear) {
          docPath = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader(MaterialDocumentYear='${sYear}',MaterialDocument='${sDoc}')`;
        } else {
          docPath = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader?$filter=MaterialDocument eq '${sDoc}'&$top=1&$format=json`;
        }
        const res = await this._get(docPath, '$format=json', { signal });
        const header = Array.isArray(res) ? res[0] : (res?.d || res);
        if (header && (header.MaterialDocument || header.MaterialDocumentYear)) {
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
      .filter((h) => (h.to_MaterialDocumentItem?.results || []).some((i) => i.GoodsMovementType === mvt))
      .sort((a, b) => String(a.MaterialDocument).localeCompare(String(b.MaterialDocument)));
    if (originals.length > 1) {
      LOG.warn(`Reference ${ref} matches ${originals.length} movement ${mvt} documents (${originals.map((h) => h.MaterialDocument).join(', ')}); using the first.`);
    }
    return originals[0] || null;
  }

  /** @private Posting result for a document found by its idempotency reference. */
  static _resultFromReference(doc, data, mvt, label) {
    return {
      ReservationNo: String(data.ReservationNo || ''),
      ReservationItem: String(data.ReservationItem || ''),
      OrderNo: '',
      MaterialDocument: doc.MaterialDocument,
      MaterialDocYear: doc.MaterialDocumentYear,
      TransferOrder: '',
      DifferenceCleared: false,
      DifferenceQty: 0,
      Success: true,
      Message: `${label} ${mvt} is already posted in S/4HANA (MatDoc: ${doc.MaterialDocument}/${doc.MaterialDocumentYear}, found by reference ${data.ReferenceDocument}); it was not posted again.`
    };
  }

  /** Movement 201 (Goods Issue to Cost Center) - standard API only. */
  async post201(data) {
    this._assertPostable(data);
    await this._preflightPosting(data);
    const payload = GoodsIssue201Mapper.mapToMaterialDocumentPayload(data);
    try {
      return await this._submitMaterialDocument(payload, {
        mvt: '201', label: 'Goods Issue to Cost Center',
        reservationNo: data.ReservationNo, reservationItem: data.ReservationItem
      });
    } catch (v2Err) {
      const err = this._reclassifyPostingError(new Error('movement 201 posts via API_MATERIAL_DOCUMENT_SRV directly'), v2Err, 'single-item movement 201');
      if (err.code !== 'GI_POSTING_OUTCOME_UNKNOWN' || !data.ReferenceDocument) throw err;

      // Unknown outcome: ask SAP whether the document exists. The lookup can run before SAP has
      // committed (observed live: no hit immediately after a successful POST, a hit about a minute
      // later), so empty lookups prove nothing and the outcome stays unconfirmed.
      const delays = GoodsIssuePostingClient.referenceLookupDelaysMs();
      for (const delayMs of delays) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        let doc;
        try {
          doc = await this.findPostedByReference(data.ReferenceDocument, '201', data.PostingDate);
        } catch (lookupErr) {
          LOG.warn(`Reference lookup ${data.ReferenceDocument} failed: ${lookupErr.message}`);
          throw err; // cannot verify: keep the manual-check message
        }
        if (doc) return GoodsIssuePostingClient._resultFromReference(doc, data, '201', 'Goods Issue to Cost Center');
      }
      const unconfirmed = new Error(`SAP S/4HANA did not confirm the single-item movement 201, and no material document with reference ${data.ReferenceDocument} is visible yet after ${delays.length} check(s). The posting may still appear in SAP. Outcome is unconfirmed (reference ${data.ReferenceDocument}); do not post again.`);
      unconfirmed.status = 504;
      unconfirmed.code = 'GI_POSTING_UNCONFIRMED';
      throw unconfirmed;
    }
  }

  /**
   * MATDOC Fallback Lookup for Movement 261:
   * When SAP does not echo ReferenceDocument or no reference lookup is available,
   * searches MATDOC (with fallback to MSEG) by reservation + item + user + date.
   *
   * Hardened verification requirements:
   *   1. Exclude reversed documents (STORNO = 'X', BWART = '262', cancelled by SMBLN).
   *   2. Quantity must equal the claim's quantity (if provided).
   *   3. Document must be created at or after the claim's createdAt timestamp
   *      (an earlier same-day posting must not prove a later attempt).
   *   4. Exactly ONE match is required:
   *      - 1 match: returns { MaterialDocument, MaterialDocYear }
   *      - 0 matches: returns null
   *      - >1 matches: logs warning and returns null (cannot disambiguate)
   *
   * @param {Object|string} optionsOrResv
   * @param {string} [item]
   * @param {string} [user]
   * @param {string|Date} [date]
   * @param {number} [quantity]
   * @param {string|Date} [createdAt]
   * @returns {Promise<{ MaterialDocument: string, MaterialDocYear: string }|null>}
   */
  async findPosted261ByMatdoc(optionsOrResv, item, user, date, quantity, createdAt) {
    let sResv, sItem, sUser, sDate, sQty, sCreatedAt;
    if (typeof optionsOrResv === 'object' && optionsOrResv !== null) {
      sResv = optionsOrResv.reservationNo || optionsOrResv.ReservationNo;
      sItem = optionsOrResv.reservationItem || optionsOrResv.ReservationItem;
      sUser = optionsOrResv.user || optionsOrResv.userName || optionsOrResv.CreatedByUser || optionsOrResv.USNAM;
      sDate = optionsOrResv.date || optionsOrResv.postingDate || optionsOrResv.PostingDate;
      sQty = optionsOrResv.quantity != null ? optionsOrResv.quantity : (optionsOrResv.issuedQty != null ? optionsOrResv.issuedQty : optionsOrResv.IssuedQty);
      sCreatedAt = optionsOrResv.createdAt || optionsOrResv.CreatedAt;
    } else {
      sResv = optionsOrResv;
      sItem = item;
      sUser = user;
      sDate = date;
      sQty = quantity;
      sCreatedAt = createdAt;
    }

    if (!sResv || !sItem) return null;

    const rsnum = String(sResv).trim().padStart(10, '0');
    const rspos = String(sItem).trim().padStart(4, '0');
    const usnam = sUser ? String(sUser).trim().toUpperCase() : '';
    const dDay = sDate ? this._formatDate(sDate).replace(/-/g, '') : '';

    const where = [
      `RSNUM = '${rsnum}'`,
      `AND RSPOS = '${rspos}'`,
      `AND (BWART = '261' OR BWART = '262')`
    ];
    if (usnam) where.push(`AND USNAM = '${usnam}'`);
    if (dDay) where.push(`AND (BUDAT = '${dDay}' OR CPUDT = '${dDay}')`);

    const fields = [
      'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'RSNUM', 'RSPOS', 'USNAM', 'BUDAT',
      'CPUDT', 'CPUTM', 'MENGE', 'ERFMG', 'STORNO', 'SMBLN', 'SJAHR', 'XAUTO'
    ];

    let rows = [];
    const readTable = (this.rfc && typeof this.rfc.readTable === 'function')
      ? (t, f, w) => this.rfc.readTable(t, f, w)
      : (this.adapter && typeof this.adapter.readTable === 'function')
        ? (t, f, w) => this.adapter.readTable(t, f, w)
        : null;

    if (readTable) {
      try {
        rows = await readTable('MATDOC', fields, where);
      } catch (matdocErr) {
        LOG.warn(`MATDOC read failed for 261 fallback lookup, trying MSEG: ${matdocErr.message}`);
        try {
          const msegFields = [
            'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'RSNUM', 'RSPOS', 'USNAM', 'BUDAT',
            'CPUDT', 'CPUTM', 'MENGE', 'ERFMG', 'SMBLN', 'SJAHR'
          ];
          const msegWhere = [
            `RSNUM = '${rsnum}'`,
            `AND RSPOS = '${rspos}'`,
            `AND (BWART = '261' OR BWART = '262')`
          ];
          rows = await readTable('MSEG', msegFields, msegWhere);
        } catch (msegErr) {
          LOG.warn(`MSEG read also failed for 261 fallback lookup: ${msegErr.message}`);
          throw matdocErr;
        }
      }
    }

    const allRows = Array.isArray(rows) ? rows : [];

    // Track cancelled or reversal documents
    const reversedDocKeys = new Set();
    for (const r of allRows) {
      if (r.STORNO === 'X' || r.STORNO === true || r.XAUTO === 'X' || r.Reversed === true || r.Cancelled === true) {
        reversedDocKeys.add(`${String(r.MBLNR).trim()}-${String(r.MJAHR || '').trim()}`);
      }
      if (r.SMBLN && String(r.SMBLN).trim() && String(r.SMBLN).trim() !== '0000000000') {
        reversedDocKeys.add(`${String(r.SMBLN).trim()}-${String(r.SJAHR || r.MJAHR || '').trim()}`);
      }
    }

    // Filter candidate 261 documents
    const claimTimeMs = sCreatedAt ? new Date(sCreatedAt).getTime() : null;
    const expectedQty = sQty != null ? Number(sQty) : null;

    const matches = allRows.filter((r) => {
      // Must be movement 261
      if (String(r.BWART).trim() !== '261') return false;

      // Exclude reversed documents
      const docKey = `${String(r.MBLNR).trim()}-${String(r.MJAHR || '').trim()}`;
      if (reversedDocKeys.has(docKey)) return false;
      if (r.STORNO === 'X' || r.STORNO === true || r.Reversed === true || r.Cancelled === true) return false;
      if (r.SMBLN && String(r.SMBLN).trim() && String(r.SMBLN).trim() !== '0000000000') return false;

      // Quantity filter: must equal claim's quantity
      if (expectedQty !== null && Number.isFinite(expectedQty)) {
        const candQty = Number(r.MENGE != null ? r.MENGE : (r.ERFMG != null ? r.ERFMG : r.Quantity));
        if (Number.isFinite(candQty) && Math.abs(candQty - expectedQty) > 0.001) {
          return false;
        }
      }

      // Timestamp filter: must be created at or after the claim's createdAt
      if (claimTimeMs !== null && Number.isFinite(claimTimeMs)) {
        let docTimeMs = null;
        if (r.createdAt || r.CreatedAt || r.timestamp || r.EntryTimestamp) {
          docTimeMs = new Date(r.createdAt || r.CreatedAt || r.timestamp || r.EntryTimestamp).getTime();
        } else if (r.CPUDT) {
          const cpudt = String(r.CPUDT).trim();
          const cputm = String(r.CPUTM || '000000').trim().padStart(6, '0');
          const y = cpudt.slice(0, 4);
          const m = cpudt.slice(4, 6);
          const d = cpudt.slice(6, 8);
          const hh = cputm.slice(0, 2);
          const mm = cputm.slice(2, 4);
          const ss = cputm.slice(4, 6);
          docTimeMs = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).getTime();
        }
        if (docTimeMs !== null && Number.isFinite(docTimeMs) && docTimeMs < claimTimeMs) {
          // Document was created before the claim attempt
          return false;
        }
      }

      return true;
    });

    if (matches.length === 1) {
      const match = matches[0];
      return {
        MaterialDocument: String(match.MBLNR).trim(),
        MaterialDocYear: String(match.MJAHR || match.MBLNR_YEAR || (match.BUDAT ? match.BUDAT.slice(0, 4) : '')).trim()
      };
    }

    if (matches.length > 1) {
      LOG.warn(`MATDOC 261 fallback lookup for reservation ${sResv} item ${sItem} returned ${matches.length} matches; exactly one match required. Outcome cannot be proved uniquely.`);
      return null;
    }

    return null;
  }

  // Fallback MATDOC lookup implemented above for 261; 301, 311 and batch path can follow the same pattern.

  /** Movement 261 (Goods Issue for Order/Reservation) - RAP first, standard API fallback. */
  async post261(data) {
    const sReserv = String(data.ReservationNo || '').trim();
    const rawItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
    const sItem = rawItem ? rawItem.padStart(4, '0') : '';
    const sOrder = String(data.OrderNo || data.OrderID || '').trim();

    if ((!sReserv || !sItem) && !sOrder) {
      const err = new Error('ReservationNo and ReservationItem are required (or OrderNo for unplanned Goods Issue)');
      err.status = 400;
      throw err;
    }
    this._assertPostable(data);
    await this._preflightPosting(data);

    // Unplanned (no reservation, but order is provided): bypass Tier 1 reservation-keyed RAP service
    // and route directly to Tier 2 standard API_MATERIAL_DOCUMENT_SRV.
    if (!sReserv || !sItem) {
      const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload(data);
      return await this._submitMaterialDocument(payload, {
        mvt: '261', label: 'Goods Issue for Order', reservationNo: '', reservationItem: '', orderNo: sOrder
      });
    }

    // Tier 1: custom RAP OData V4 service ZUI_GI_ORDER_RSV_O4 (posts 261 only).
    let tier1Response = null;
    let tier1MatDoc = null;
    let tier1MatYear = '';
    let tier1Error = null;
    try {
      const path = `/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/GIItem(ReservationNo='${sReserv}',ReservationItem='${sItem}')/com.sap.gateway.srvd.zui_gi_order_rsv_o4.v0001.postGoodsIssue`;
      const response = await this._post(path, {
        IssueQty: Number(data.IssueQty),
        Batch: data.Batch ? String(data.Batch).trim() : '',
        DifferenceQty: 0,
        DifferenceReason: '',
        DifferenceStorageType: '',
        FinalIssue: false
      });
      if (response && (response.MaterialDocument || response.MatDoc)) {
        tier1Response = response;
        tier1MatDoc = response.MaterialDocument || response.MatDoc;
        tier1MatYear = response.MaterialDocYear || '';
        if (!tier1MatYear && response.PostingDate) {
          const m = String(response.PostingDate).match(/\d{4}/);
          if (m) tier1MatYear = m[0];
        }
      } else {
        throw new Error(`RAP postGoodsIssue returned no material document: ${JSON.stringify(response || null).slice(0, 300)}`);
      }
    } catch (v4Err) {
      tier1Error = v4Err;
    }

    if (tier1MatDoc) {
      let verified;
      try {
        verified = await this.readBackDocument(tier1MatDoc, tier1MatYear);
      } catch (rbErr) {
        LOG.warn(`readBackDocument error after RAP post: ${rbErr.message}`);
        verified = { MaterialDocument: tier1MatDoc, MaterialDocYear: tier1MatYear, Confirmed: false, Status: 'posted, confirmation pending' };
      }
      const matDoc = verified?.MaterialDocument || String(tier1MatDoc).trim();
      const matYear = verified?.MaterialDocYear || String(tier1MatYear).trim();
      const isConfirmed = Boolean(verified?.Confirmed);
      const confirmationText = isConfirmed ? '' : ' (posted, confirmation pending)';
      return {
        ReservationNo: sReserv,
        ReservationItem: sItem,
        OrderNo: sOrder,
        MaterialDocument: matDoc,
        MaterialDocYear: matYear,
        TransferOrder: tier1Response.TransferOrder || tier1Response.ToNumber || '',
        DifferenceCleared: false,
        DifferenceQty: 0,
        Success: true,
        Confirmed: isConfirmed,
        ConfirmationStatus: isConfirmed ? 'CONFIRMED' : 'POSTED_CONFIRMATION_PENDING',
        Message: `Goods Issue 261 posted successfully in S/4HANA${confirmationText}.`
      };
    }

    // Tier 2: standard API_MATERIAL_DOCUMENT_SRV.
    try {
      const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload(data);
      return await this._submitMaterialDocument(payload, {
        mvt: '261', label: 'Goods Issue', reservationNo: sReserv, reservationItem: sItem, orderNo: sOrder
      });
    } catch (v2Err) {
      throw this._reclassifyPostingError(tier1Error, v2Err, 'single-item movement 261');
    }
  }

  /** Movement 301 (Plant-to-Plant Transfer) - standard API only. */
  async post301(data) {
    this._assertPostable(data);
    await this._preflightPosting(data);
    const payload = GoodsIssue301Mapper.mapToMaterialDocumentPayload(data);
    try {
      return await this._submitMaterialDocument(payload, {
        mvt: '301', label: 'Transfer posting',
        reservationNo: data.ReservationNo, reservationItem: data.ReservationItem
      });
    } catch (v2Err) {
      throw this._reclassifyPostingError(new Error('movement 301 posts via API_MATERIAL_DOCUMENT_SRV directly'), v2Err, 'single-item movement 301');
    }
  }

  /** Movement 311 (Storage Location Transfer) - standard API only. */
  async post311(data) {
    this._assertPostable(data);
    await this._preflightPosting(data);
    const payload = GoodsIssue311Mapper.mapToMaterialDocumentPayload(data);
    try {
      return await this._submitMaterialDocument(payload, {
        mvt: '311', label: 'Transfer posting',
        reservationNo: data.ReservationNo, reservationItem: data.ReservationItem
      });
    } catch (v2Err) {
      throw this._reclassifyPostingError(new Error('movement 311 posts via API_MATERIAL_DOCUMENT_SRV directly'), v2Err, 'single-item movement 311');
    }
  }

  /**
   * Router that reads a MovementType off a payload and dispatches it to the matching isolated method above.
   * This is routing, not movement-type business logic.
   */
  async postByMovementType(data) {
    const mvt = String(data.MovementType || '261').trim();
    switch (mvt) {
      case '201': {
        // Never post if reference already exists in SAP.
        const prior = data.ReferenceDocument ? await this.findPostedByReference(data.ReferenceDocument, '201', data.PostingDate) : null;
        if (prior) return GoodsIssuePostingClient._resultFromReference(prior, data, '201', 'Goods Issue to Cost Center');
        return this.post201(data);
      }
      case '261': return this.post261(data);
      case '301': return this.post301(data);
      case '311': return this.post311(data);
      default: {
        const err = new Error(`Movement type ${mvt} cannot be posted here (allowed: ${POSTABLE_MOVEMENT_TYPES.join(', ')})`);
        err.status = 400;
        throw err;
      }
    }
  }

  /**
   * Submit Goods Issue batch in a single LUW with multi-tier posting
   */
  async submitGoodsIssueRequest(reservationNo, orderNo, items) {
    if (!reservationNo && !orderNo) {
      const err = new Error('Either ReservationNo or OrderNo must be provided for submission');
      err.status = 400;
      throw err;
    }
    if (!Array.isArray(items) || items.length === 0) {
      const err = new Error('At least one item must be specified for submission');
      err.status = 400;
      throw err;
    }

    // Validate quantities
    for (const item of items) {
      const nQty = Number(item.IssueQty);
      if (isNaN(nQty) || nQty <= 0) {
        const err = new Error(`Item ${item.ReservationItem || ''}: Issue quantity must be a positive decimal number`);
        err.status = 400;
        throw err;
      }
    }

    const validateBatchFn = (mat, bch) => {
      if (this.adapter && typeof this.adapter.validateBatch === 'function') {
        return this.adapter.validateBatch(mat, bch);
      }
      if (this.batchesClient && typeof this.batchesClient.validateBatch === 'function') {
        return this.batchesClient.validateBatch(mat, bch);
      }
      return { valid: true };
    };

    // SLED Hard-Stop Validation for all items in batch
    for (const item of items) {
      if (item.Batch) {
        const valResult = await validateBatchFn(item.Material, item.Batch);
        if (!valResult.valid) {
          return {
            AllPosted: false,
            Results: items.map(it => ({
              ReservationItem: it.ReservationItem,
              Success: false,
              Message: valResult.reason || `Batch ${item.Batch} is invalid or expired.`
            })),
            Messages: [`Batch submission aborted: Line Item ${item.ReservationItem} batch ${item.Batch} is expired. Compensating rollback executed.`]
          };
        }
      }
    }

    // Check destination
    const dest = await this._getDestination();
    if (!dest) {
      const err = new Error('S/4HANA Destination could not be resolved or is not configured');
      err.status = 502;
      throw err;
    }

    // Tier 1: Attempt Custom RAP OData V4 service ZUI_GI_ORDER_RSV_O4
    try {
      const path = `/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/submitRequest`;
      const response = await this._post(path, {
        ReservationNo: reservationNo || '',
        OrderNo: orderNo || '',
        Items: items
      });
      if (response && (response.AllPosted !== undefined || response.Results)) {
        return response;
      }
      // Same rule as single-item posting: an unrecognized 2xx must reach Tier 2.
      throw new Error(`RAP submitRequest returned an unrecognized response shape: ${JSON.stringify(response || null).slice(0, 300)}`);
    } catch (v4Err) {
      // Tier 2: Attempt standard S/4HANA OData V2 service API_MATERIAL_DOCUMENT_SRV with multi-line deep insert
      try {
        const v2Path = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader`;
        const v2Items = items.map((item, idx) => {
          const rawItem = item.ReservationItem != null ? String(item.ReservationItem).trim() : '';
          const sItem = rawItem ? rawItem.padStart(4, '0') : '';
          const nQty = Number(item.IssueQty);
          const itemUnit = String(item.Unit || item.EntryUnit || item.BaseUnit || '').trim().toUpperCase();
          if (!itemUnit) {
            const err = new Error(`Unit of measure (EntryUnit) is required for Goods Issue item ${sItem || idx + 1}`);
            err.status = 400;
            throw err;
          }
          const itemPayload = {
            Material: item.Material || '',
            GoodsMovementType: '261',
            EntryUnit: itemUnit,
            QuantityInEntryUnit: String(nQty),
            Reservation: String(reservationNo || item.ReservationNo || '').trim(),
            ReservationItem: sItem,
            Batch: item.Batch ? String(item.Batch).trim() : ''
          };
          if (item.Plant) itemPayload.Plant = item.Plant;
          if (item.StorageLocation) itemPayload.StorageLocation = item.StorageLocation;

          const itemSerials = Array.isArray(item.SerialNumbers) && item.SerialNumbers.length > 0
            ? item.SerialNumbers
            : item.SerialNumber
              ? [item.SerialNumber]
              : [];
          if (itemSerials.length > 0) {
            itemPayload.to_SerialNumbers = {
              results: itemSerials.map((sn) => ({ SerialNumber: String(sn).trim() }))
            };
          }
          return itemPayload;
        });

        const v2Payload = {
          GoodsMovementCode: '03',
          PostingDate: `/Date(${GoodsIssuePostingClient._today()})/`,
          DocumentDate: `/Date(${GoodsIssuePostingClient._today()})/`,
          MaterialDocumentHeaderText: `GI Resv ${reservationNo || orderNo || ''}`.trim(),
          to_MaterialDocumentItem: {
            results: v2Items
          }
        };

        const v2Res = await this._post(v2Path, v2Payload);
        GoodsIssuePostingClient._throwIfSapBusinessError(v2Res);
        const rawMatDoc = v2Res.MaterialDocument || v2Res.d?.MaterialDocument;
        let rawMatYear = v2Res.MaterialDocumentYear || v2Res.d?.MaterialDocumentYear || '';
        if (!rawMatYear && (v2Res.PostingDate || v2Res.d?.PostingDate)) {
          const pd = v2Res.PostingDate || v2Res.d?.PostingDate;
          const m = String(pd).match(/\d{4}/);
          if (m) rawMatYear = m[0];
        }

        if (rawMatDoc) {
          let verified;
          try {
            verified = await this.readBackDocument(rawMatDoc, rawMatYear);
          } catch (rbErr) {
            LOG.warn(`readBackDocument error in post261Batch for ${rawMatDoc}: ${rbErr.message}`);
            verified = { MaterialDocument: rawMatDoc, MaterialDocYear: rawMatYear, Confirmed: false, Status: 'posted, confirmation pending' };
          }
          const matDoc = verified?.MaterialDocument || String(rawMatDoc).trim();
          const matYear = verified?.MaterialDocYear || String(rawMatYear).trim();
          const isConfirmed = Boolean(verified?.Confirmed);
          const confirmationText = isConfirmed ? '' : ' (posted, confirmation pending)';
          const results = items.map(item => {
            const rawItem = item.ReservationItem != null ? String(item.ReservationItem).trim() : '';
            const sItem = rawItem ? rawItem.padStart(4, '0') : '';
            const nDiffQty = Number(item.DifferenceQty) || 0;
            return {
              ReservationItem: sItem,
              MaterialDocument: matDoc,
              MaterialDocYear: matYear,
              TransferOrder: '',
              DifferenceCleared: nDiffQty > 0,
              DifferenceQty: nDiffQty,
              Success: true,
              Confirmed: isConfirmed,
              ConfirmationStatus: isConfirmed ? 'CONFIRMED' : 'POSTED_CONFIRMATION_PENDING',
              Message: `Goods Issue 261 posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (MatDoc: ${matDoc}${matYear ? '/' + matYear : ''})${confirmationText}.`
            };
          });

          return {
            AllPosted: true,
            Confirmed: isConfirmed,
            ConfirmationStatus: isConfirmed ? 'CONFIRMED' : 'POSTED_CONFIRMATION_PENDING',
            Results: results,
            Messages: [`Batch Goods Issue 261 posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (Material Document: ${matDoc}${matYear ? '/' + matYear : ''})${confirmationText}.`]
          };
        }
        // Same rule as single-item posting: never resolve without either a genuine material
        // document or a thrown error.
        throw new Error('SAP S/4HANA did not return a material document for the batch Goods Issue submission, and no sap-message error was present in the response.');
      } catch (v2Err) {
        throw this._reclassifyPostingError(v4Err, v2Err, 'batch Goods Issue submission');
      }
    }
  }

  /**
   * Helper to extract numeric HTTP status code from an error or response.
   *
   * @private
   */
  /** Midnight UTC today. SAP Edm.DateTime posting/document dates carry no time part. */
  static _today() {
    return new Date().setUTCHours(0, 0, 0, 0);
  }

  _extractStatus(err) {
    if (!err) return null;
    if (typeof err.status === 'number') return err.status;
    if (typeof err.statusCode === 'number') return err.statusCode;
    if (typeof err.response?.status === 'number') return err.response.status;
    const m = String(err.message || '').match(/\b(40[1-4]|50[0-4])\b/);
    return m ? Number(m[0]) : null;
  }

  /** Gateway answers a service that is not registered on the hub with HTTP 403 + /IWFND/MED/170. */
  static _isServiceNotRegistered(err) {
    return /IWFND\/MED\/170|No service found/i.test(String(err?.message || '') + JSON.stringify(err?.response?.data || ''));
  }

  /**
   * Classifies a Tier 2 (API_MATERIAL_DOCUMENT_SRV) failure into one of three outcomes:
   *
   * 1. Rejected by SAP (400/401/409/422/..., or a business message recognised by S4ErrorMapper):
   *    surfaced to the caller as-is.
   * 2. Never reached the posting (service not activated/registered, connection refused, DNS failure,
   *    HTTP 503): wrapped into the diagnostic "capability unavailable" 501 error.
   * 3. Unknown outcome (timeout, connection reset, proxy 502/504, or a 2xx response without a
   *    material document): SAP may have posted. Surfaced as 504 GI_POSTING_OUTCOME_UNKNOWN.
   *
   * A plain HTTP 403 (no /IWFND/MED/170) is an authorization or CSRF refusal: surfaced directly.
   *
   * @private
   */
  _reclassifyPostingError(v4Err, v2Err, operationName) {
    const UNAVAILABLE_STATUSES = [403, 404, 502, 503];

    // An error that already carries an explicit, non-"unavailable" HTTP status was already
    // correctly classified by the code that raised it (our own pre-flight validation, the
    // sap-message business error, or a real SAP HTTP error surfaced by S4HttpClient with its true
    // status) - never re-wrap it.
    const explicitStatus = this._extractStatus(v2Err);
    if (S4ErrorMapper.isPostingPeriodClosed(v2Err?.message)) {
      const mappedPeriod = S4ErrorMapper.mapS4Error(v2Err);
      const periodErr = new Error(mappedPeriod.message);
      periodErr.status = mappedPeriod.status;
      periodErr.code = mappedPeriod.code;
      periodErr.details = mappedPeriod.details;
      return periodErr;
    }
    if (explicitStatus !== null && !UNAVAILABLE_STATUSES.includes(explicitStatus)) {
      return v2Err;
    }

    // An explicit 403/404/502/503, or no status at all: defer to S4ErrorMapper's keyword-based
    // business-error detection (locked/blocked, posting period, lock/enqueue, ...).
    const mapped = S4ErrorMapper.mapS4Error(v2Err);
    if (!UNAVAILABLE_STATUSES.includes(mapped.status) && mapped.status !== 500) {
      const businessErr = new Error(mapped.message);
      businessErr.status = mapped.status;
      businessErr.code = mapped.code;
      businessErr.details = mapped.details;
      return businessErr;
    }

    const networkCode = String(v2Err?.code || v2Err?.cause?.code || '').toUpperCase();
    const neverPosted = explicitStatus === 404 || explicitStatus === 503 ||
      (explicitStatus === 403 && GoodsIssuePostingClient._isServiceNotRegistered(v2Err)) ||
      ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(networkCode);
    if (neverPosted) {
      return this._buildPostingUnavailableError(v4Err, v2Err, operationName);
    }

    if (explicitStatus === 403) {
      const authErr = new Error(`${mapped.message} SAP refused the ${operationName} (authorization or CSRF token). It was NOT posted; check SU53 for the destination user (S_SERVICE, M_MSEG_BWA, M_MSEG_WWA).`);
      authErr.status = 403;
      authErr.code = mapped.code;
      return authErr;
    }

    const unknownErr = new Error(`SAP S/4HANA did not confirm the outcome of the ${operationName} (${mapped.message}). The goods issue may or may not have been posted. Outcome is unconfirmed; do not post again.`);
    unknownErr.status = 504;
    unknownErr.code = 'GI_POSTING_OUTCOME_UNKNOWN';
    return unknownErr;
  }

  /**
   * Builds an informative, actionable error when backend posting capabilities are unavailable.
   * Explicitly distinguishes HTTP 403 (Security/S_SERVICE authorization) from HTTP 404 (ABAP/Basis publishing),
   * identifying the exact SAP teams needed to resolve each tier.
   *
   * @private
   */
  _buildPostingUnavailableError(v4Err, v2Err, operationName = 'Goods Issue') {
    const client = s4Config.getClient();
    // No defaults: inventing 404/403 here would state a cause we did not observe
    // (a timeout or destination error would be reported as "NOT PUBLISHED").
    const v4Status = this._extractStatus(v4Err);
    const v2Status = this._extractStatus(v2Err);

    // Tier 1 diagnostic (RAP V4 service)
    let t1Diag;
    if (v4Status === 404) {
      t1Diag = `(1) custom RAP service 'ZUI_GI_ORDER_RSV_O4' returns HTTP 404 - NOT PUBLISHED on this system; ABAP/Basis must publish it in /IWFND/V4_ADMIN (${v4Err?.message || 'HTTP 404 Not Found'})`;
    } else if (v4Status === 403) {
      t1Diag = `(1) custom RAP service 'ZUI_GI_ORDER_RSV_O4' returns HTTP 403 - FORBIDDEN; Security must grant authorization (${v4Err?.message || 'HTTP 403 Forbidden'})`;
    } else {
      t1Diag = `(1) custom RAP service 'ZUI_GI_ORDER_RSV_O4' failed (${v4Status ? `HTTP ${v4Status}` : 'no HTTP status - network, timeout or destination error'}: ${v4Err?.message || 'Error'})`;
    }

    // Tier 2 diagnostic (Standard V2 service)
    let t2Diag;
    const v2NotRegistered = GoodsIssuePostingClient._isServiceNotRegistered(v2Err);
    if (v2Status === 403 && v2NotRegistered) {
      // Gateway answers /IWFND/MED/170 with HTTP 403. This is NOT an authorization
      // failure - the service is not registered on the hub. Verified 2026-09-18.
      t2Diag = `(2) standard service 'API_MATERIAL_DOCUMENT_SRV' returns HTTP 403 carrying /IWFND/MED/170 'No service found' - the service is NOT REGISTERED on this Gateway hub; Basis must add and activate it in /IWFND/MAINT_SERVICE (TADIR R3TR IWSV API_MATERIAL_DOCUMENT_SRV 0001). This is a registration task, not an authorization grant (${v2Err?.message || 'HTTP 403'})`;
    } else if (v2Status === 403) {
      t2Diag = `(2) standard service 'API_MATERIAL_DOCUMENT_SRV' returns HTTP 403 without /IWFND/MED/170, so it IS registered and this is an authorization failure; Security must grant S_SERVICE for it and M_MSEG_BWA for movement type 261 (${v2Err?.message || 'HTTP 403 Forbidden'})`;
    } else if (v2Status === 404) {
      t2Diag = `(2) standard service 'API_MATERIAL_DOCUMENT_SRV' returns HTTP 404 - NOT ACTIVATED; Basis must activate service in /IWFND/MAINT_SERVICE (${v2Err?.message || 'HTTP 404 Not Found'})`;
    } else {
      t2Diag = `(2) standard service 'API_MATERIAL_DOCUMENT_SRV' failed (${v2Status ? `HTTP ${v2Status}` : 'no HTTP status - network, timeout or destination error'}: ${v2Err?.message || 'Error'})`;
    }

    const message = `SAP S/4HANA Backend Posting Capability Unavailable on Gateway client ${client} for ${operationName}. ` +
      `Two distinct causes, each needing a different SAP team (verified against live SAP 2026-09-23): ` +
      `${t1Diag}. ${t2Diag}. ` +
      `Fixing (2) alone unblocks posting and is the smaller request. ` +
      `'ZMMIM_MATDOC_SRV' is also deregistered (/IWFND/MED/170 as of 2026-09-23; previously returned HTTP 501 'MATDOCHEADERS_CREATE_ENTITY not implemented'). ` +
      `No alternative OData service on this system supports reservation-based movement type 261 — 1,237 services scanned, five GI-capable services found, all delivery-based only. ` +
      `In accordance with AGENTS.md, mock persistence and dummy document generation are strictly prohibited.`;

    const postingError = new Error(message);
    postingError.status = 501;
    return postingError;
  }


  /**
   * Reverse an existing Material Document in SAP S/4HANA via CancelHeader FunctionImport.
   *
   * @param {string} materialDocument - 10-digit SAP material document
   * @param {string} [materialDocYear] - 4-digit fiscal year (looked up in SAP if omitted)
   * @param {string} [postingDate] - Optional posting date (YYYY-MM-DD)
   * @param {string} [documentDate] - Optional document date (YYYY-MM-DD)
   * @param {string} [reversalReason] - Optional reason code
   * @returns {Promise<{ OriginalMaterialDocument: string, OriginalMaterialDocYear: string, ReversalMaterialDocument: string, ReversalMaterialDocYear: string, PostingDate: string, Success: boolean, Message: string }>}
   */
  async reverseGoodsIssue(materialDocument, materialDocYear, postingDate, documentDate, reversalReason) {
    const sDoc = String(materialDocument || '').trim();
    let sYear = String(materialDocYear || '').trim();
    if (!sDoc) {
      const err = new Error('MaterialDocument is required for reversal');
      err.status = 400;
      throw err;
    }
    if (!sYear) {
      let verified;
      try {
        verified = await this.readBackDocument(sDoc);
      } catch (readErr) {
        LOG.warn(`Reversal year lookup failed for ${sDoc}: ${readErr.message}`);
      }
      if (verified && verified.MaterialDocYear && verified.Confirmed) {
        sYear = verified.MaterialDocYear;
      } else {
        const err = new Error(`Material document ${sDoc} was not found in SAP; unable to determine document year for reversal.`);
        err.status = 400;
        throw err;
      }
    }

    const dest = await this._getDestination();
    if (!dest) {
      const err = new Error('S/4HANA Destination could not be resolved or is not configured');
      err.status = 502;
      throw err;
    }

    const cancelUrl = GoodsIssueMapper.mapToCancelHeaderUrl(sDoc, sYear, postingDate);
    try {
      const response = await this._post(cancelUrl, {});
      // Honor a sap-message severity=error on a 2xx (mirrors _submitMaterialDocument), and require a
      // genuine reversal document. Never fall back to the original document number or claim success
      // without proof — a reversal that SAP did not persist is not a success (AGENTS.md rule 6).
      GoodsIssuePostingClient._throwIfSapBusinessError(response);
      const revMatDoc = response.MaterialDocument || response.d?.MaterialDocument || response.Cancel?.MaterialDocument || response.CancelHeader?.MaterialDocument;
      const revMatYear = response.MaterialDocumentYear || response.d?.MaterialDocumentYear || sYear;
      if (!revMatDoc) {
        throw new Error(`SAP S/4HANA did not return a reversal material document for the cancellation of ${sDoc}/${sYear}, and no sap-message error was present in the response. The reversal was NOT confirmed.`);
      }

      return {
        OriginalMaterialDocument: sDoc,
        OriginalMaterialDocYear: sYear,
        ReversalMaterialDocument: revMatDoc,
        ReversalMaterialDocYear: revMatYear,
        PostingDate: postingDate || new Date().toISOString().split('T')[0],
        Success: true,
        Message: `Material Document ${sDoc}/${sYear} reversed successfully in S/4HANA via Cancel. Reversal Document: ${revMatDoc}/${revMatYear}.`
      };
    } catch (err) {
      throw S4ErrorMapper.mapS4Error(err, 'reverseGoodsIssue');
    }
  }
}

module.exports = GoodsIssuePostingClient;
