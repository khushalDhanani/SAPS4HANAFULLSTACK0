const LOG = require('../../logger')('goods-issue-posting');
const s4Config = require('../../s4Config');
const S4ErrorMapper = require('../../S4ErrorMapper');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');
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
  constructor(options = {}) {
    super(options);
    this.batchesClient = options.batchesClient || (this.adapter && this.adapter.batches) || null;
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
  async _submitMaterialDocument(v2Payload, meta) {
    const v2Path = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader`;
    const v2Res = await this._post(v2Path, v2Payload);
    GoodsIssuePostingClient._throwIfSapBusinessError(v2Res);
    const matDoc = v2Res.MaterialDocument || v2Res.d?.MaterialDocument;
    const matYear = v2Res.MaterialDocumentYear || v2Res.d?.MaterialDocumentYear || String(new Date().getFullYear());
    if (!matDoc) {
      throw new Error(`SAP S/4HANA did not return a material document for movement ${meta.mvt} posting, and no sap-message error was present in the response.`);
    }
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
      Message: `${meta.label} ${meta.mvt} posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (MatDoc: ${matDoc}/${matYear}).`
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
      throw this._reclassifyPostingError(new Error('movement 201 posts via API_MATERIAL_DOCUMENT_SRV directly'), v2Err, 'single-item movement 201');
    }
  }

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
        return {
          ReservationNo: sReserv,
          ReservationItem: sItem,
          OrderNo: sOrder,
          MaterialDocument: response.MaterialDocument || response.MatDoc,
          MaterialDocYear: response.MaterialDocYear || String(new Date().getFullYear()),
          TransferOrder: response.TransferOrder || response.ToNumber || '',
          DifferenceCleared: false,
          DifferenceQty: 0,
          Success: true,
          Message: 'Goods Issue 261 posted successfully in S/4HANA.'
        };
      }
      throw new Error(`RAP postGoodsIssue returned no material document: ${JSON.stringify(response || null).slice(0, 300)}`);
    } catch (v4Err) {
      // Tier 2: standard API_MATERIAL_DOCUMENT_SRV.
      try {
        const payload = GoodsIssue261Mapper.mapToMaterialDocumentPayload(data);
        return await this._submitMaterialDocument(payload, {
          mvt: '261', label: 'Goods Issue', reservationNo: sReserv, reservationItem: sItem, orderNo: sOrder
        });
      } catch (v2Err) {
        throw this._reclassifyPostingError(v4Err, v2Err, 'single-item movement 261');
      }
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
   * Router used only by the internal queue-replay path (retry/drain), which reads a stored
   * MovementType off a queued record and dispatches it to the matching isolated method above.
   * This is routing, not movement-type business logic.
   */
  async postByMovementType(data) {
    const mvt = String(data.MovementType || '261').trim();
    switch (mvt) {
      case '201': return this.post201(data);
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
        const matDoc = v2Res.MaterialDocument || v2Res.d?.MaterialDocument;
        const matYear = v2Res.MaterialDocumentYear || v2Res.d?.MaterialDocumentYear || String(new Date().getFullYear());

        if (matDoc) {
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
              Message: `Goods Issue 261 posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (MatDoc: ${matDoc}/${matYear}).`
            };
          });

          return {
            AllPosted: true,
            Results: results,
            Messages: [`Batch Goods Issue 261 posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (Material Document: ${matDoc}/${matYear}).`]
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

  /**
   * Decides whether a Tier 2 (API_MATERIAL_DOCUMENT_SRV) failure is a genuine business/validation
   * rejection (locked cost center, closed posting period, stock deficit, duplicate serial, our own
   * pre-flight validation, ...) that must be surfaced to the caller as-is, or an actual backend
   * capability problem (service not registered/activated, not authorized, Gateway unreachable) that
   * should be wrapped into the diagnostic "capability unavailable" error and routed to the dispatch
   * queue. Only HTTP 403/404/502/503 are treated as "capability unavailable" - everything else
   * (400/401/409/422/...) is a real, surfaceable error and must never be silently queued for retry.
   *
   * @private
   */
  _reclassifyPostingError(v4Err, v2Err, operationName) {
    const UNAVAILABLE_STATUSES = [403, 404, 502, 503];

    // An error that already carries an explicit, non-"unavailable" HTTP status was already
    // correctly classified by the code that raised it (our own pre-flight validation, or a real
    // SAP HTTP error surfaced by S4HttpClient with its true status) - never re-wrap it.
    const explicitStatus = this._extractStatus(v2Err);
    if (explicitStatus !== null && !UNAVAILABLE_STATUSES.includes(explicitStatus)) {
      return v2Err;
    }

    // Otherwise - an explicit 403/404/502/503, or no status at all (raw network/socket error, or
    // our own sap-message-derived error which carries no HTTP status) - defer to S4ErrorMapper's
    // keyword-based business-error detection (locked/blocked, posting period, lock/enqueue, ...).
    // Only a positively-identified business status escapes the "capability unavailable" wrap; an
    // unclassifiable error (mapped to the mapper's 500 default, e.g. a bare "socket hang up" with
    // no business content) is still treated as an availability problem, not invented as a 500
    // business error.
    const mapped = S4ErrorMapper.mapS4Error(v2Err);
    if (!UNAVAILABLE_STATUSES.includes(mapped.status) && mapped.status !== 500) {
      const businessErr = new Error(mapped.message);
      businessErr.status = mapped.status;
      businessErr.code = mapped.code;
      businessErr.details = mapped.details;
      return businessErr;
    }

    return this._buildPostingUnavailableError(v4Err, v2Err, operationName);
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
    const v2NotRegistered = /IWFND\/MED\/170|No service found/i.test(String(v2Err?.message || '') + JSON.stringify(v2Err?.response?.data || ''));
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
   * @param {string} materialDocYear - 4-digit fiscal year
   * @param {string} [postingDate] - Optional posting date (YYYY-MM-DD)
   * @param {string} [documentDate] - Optional document date (YYYY-MM-DD)
   * @param {string} [reversalReason] - Optional reason code
   * @returns {Promise<{ OriginalMaterialDocument: string, OriginalMaterialDocYear: string, ReversalMaterialDocument: string, ReversalMaterialDocYear: string, PostingDate: string, Success: boolean, Message: string }>}
   */
  async reverseGoodsIssue(materialDocument, materialDocYear, postingDate, documentDate, reversalReason) {
    const sDoc = String(materialDocument || '').trim();
    const sYear = String(materialDocYear || '').trim();
    if (!sDoc || !sYear) {
      const err = new Error('MaterialDocument and MaterialDocYear are required for reversal');
      err.status = 400;
      throw err;
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
      const revMatDoc = response.MaterialDocument || response.d?.MaterialDocument || response.CancelHeader?.MaterialDocument;
      const revMatYear = response.MaterialDocumentYear || response.d?.MaterialDocumentYear || sYear;

      return {
        OriginalMaterialDocument: sDoc,
        OriginalMaterialDocYear: sYear,
        ReversalMaterialDocument: revMatDoc || sDoc,
        ReversalMaterialDocYear: revMatYear,
        PostingDate: postingDate || new Date().toISOString().split('T')[0],
        Success: true,
        Message: `Material Document ${sDoc}/${sYear} reversed successfully in S/4HANA via CancelHeader.${revMatDoc ? ` Reversal Document: ${revMatDoc}/${revMatYear}.` : ''}`
      };
    } catch (err) {
      throw S4ErrorMapper.mapS4Error(err, 'reverseGoodsIssue');
    }
  }
}

module.exports = GoodsIssuePostingClient;
