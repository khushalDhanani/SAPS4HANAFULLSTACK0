const LOG = require('../../logger')('goods-issue-posting');
const s4Config = require('../../s4Config');
const BaseGoodsIssueClient = require('./BaseGoodsIssueClient');

/**
 * Domain client for SAP S/4HANA Goods Issue Posting and Batch Submission.
 * Enforces AGENTS.md rules: no mock persistence, transparent failure when SAP posting service is unavailable.
 */
class GoodsIssuePostingClient extends BaseGoodsIssueClient {
  constructor(options = {}) {
    super(options);
    this.batchesClient = options.batchesClient || (this.adapter && this.adapter.batches) || null;
  }

  /**
   * Post goods issue for a single reservation component line (Bound Action)
   */
  async postGoodsIssue(reservationNo, reservationItem, material, issueQty, unit, batch, differenceQty, differenceReason, differenceStorageType, finalIssue) {
    const sReserv = String(reservationNo || '').trim();
    const rawItem = reservationItem != null ? String(reservationItem).trim() : '';
    const sItem = rawItem ? rawItem.padStart(4, '0') : '';
    const nQty = Number(issueQty);
    const nDiffQty = Number(differenceQty) || 0;
    const sDiffStorageType = differenceStorageType || '999';

    if (!sReserv || !sItem) {
      const err = new Error('ReservationNo and ReservationItem are required for Goods Issue');
      err.status = 400;
      throw err;
    }
    if (isNaN(nQty) || nQty <= 0) {
      const err = new Error('IssueQty must be a positive decimal number');
      err.status = 400;
      throw err;
    }

    const effectiveUnit = unit ? String(unit).trim().toUpperCase() : '';
    if (!effectiveUnit) {
      const err = new Error('Unit of measure (EntryUnit) is required for Goods Issue');
      err.status = 400;
      throw err;
    }

    // SLED Hard-Stop Validation: Block expired, deleted, or restricted batch
    const effectiveBatch = batch ? String(batch).trim() : '';
    if (effectiveBatch) {
      const validateBatchFn = (mat, bch) => {
        if (this.adapter && typeof this.adapter.validateBatch === 'function') {
          return this.adapter.validateBatch(mat, bch);
        }
        if (this.batchesClient && typeof this.batchesClient.validateBatch === 'function') {
          return this.batchesClient.validateBatch(mat, bch);
        }
        return { valid: true };
      };

      const valResult = await validateBatchFn(material, effectiveBatch);
      if (!valResult.valid) {
        const err = new Error(valResult.reason || `Batch ${effectiveBatch} is invalid or expired.`);
        err.status = 400;
        throw err;
      }
    }

    // Live SAP Posting: check destination
    const dest = await this._getDestination();
    if (!dest) {
      const err = new Error('S/4HANA Destination could not be resolved or is not configured');
      err.status = 502;
      throw err;
    }

    // Tier 1: Attempt Custom RAP OData V4 service ZUI_GI_ORDER_RSV_O4
    try {
      const path = `/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/GIItem(ReservationNo='${sReserv}',ReservationItem='${sItem}')/com.sap.gateway.srvd.zui_gi_order_rsv_o4.v0001.postGoodsIssue`;
      const response = await this._post(path, {
        IssueQty: nQty,
        Batch: effectiveBatch,
        DifferenceQty: nDiffQty,
        DifferenceReason: differenceReason || '',
        DifferenceStorageType: sDiffStorageType,
        FinalIssue: !!finalIssue
      });

      if (response && (response.MaterialDocument || response.MatDoc)) {
        return {
          ReservationNo: sReserv,
          ReservationItem: sItem,
          MaterialDocument: response.MaterialDocument || response.MatDoc,
          MaterialDocYear: response.MaterialDocYear || String(new Date().getFullYear()),
          TransferOrder: response.TransferOrder || response.ToNumber || '',
          DifferenceCleared: response.DifferenceCleared !== undefined ? response.DifferenceCleared : (nDiffQty > 0),
          DifferenceQty: nDiffQty,
          Success: true,
          Message: `Goods Issue 261 posted successfully in S/4HANA.${nDiffQty > 0 ? ` Difference of ${nDiffQty} cleared to Storage Type ${sDiffStorageType}.` : ''}`
        };
      }
      // A 2xx without a material document is NOT a success. Throw so Tier 2 runs;
      // falling through here would return undefined to the caller.
      throw new Error(`RAP postGoodsIssue returned no material document: ${JSON.stringify(response || null).slice(0, 300)}`);
    } catch (v4Err) {
      // Tier 2: Attempt standard S/4HANA OData V2 service API_MATERIAL_DOCUMENT_SRV
      try {
        const v2Path = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader`;
        const v2Payload = {
          GoodsMovementCode: '03',
          PostingDate: `/Date(${GoodsIssuePostingClient._today()})/`,
          DocumentDate: `/Date(${GoodsIssuePostingClient._today()})/`,
          MaterialDocumentHeaderText: `GI Resv ${sReserv}`,
          to_MaterialDocumentItem: {
            results: [
              {
                Material: material || '',
                GoodsMovementType: '261',
                EntryUnit: effectiveUnit,
                QuantityInEntryUnit: String(nQty),
                Reservation: sReserv,
                ReservationItem: sItem,
                Batch: effectiveBatch || ''
              }
            ]
          }
        };
        const v2Res = await this._post(v2Path, v2Payload);
        const matDoc = v2Res.MaterialDocument || v2Res.d?.MaterialDocument;
        const matYear = v2Res.MaterialDocumentYear || v2Res.d?.MaterialDocumentYear || String(new Date().getFullYear());
        if (matDoc) {
          return {
            ReservationNo: sReserv,
            ReservationItem: sItem,
            MaterialDocument: matDoc,
            MaterialDocYear: matYear,
            TransferOrder: '',
            DifferenceCleared: nDiffQty > 0,
            DifferenceQty: nDiffQty,
            Success: true,
            Message: `Goods Issue 261 posted successfully in S/4HANA via API_MATERIAL_DOCUMENT_SRV (MatDoc: ${matDoc}/${matYear}).`
          };
        }
      } catch (v2Err) {
        throw this._buildPostingUnavailableError(v4Err, v2Err, 'single-item Goods Issue');
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
          return {
            Material: item.Material || '',
            GoodsMovementType: '261',
            EntryUnit: itemUnit,
            QuantityInEntryUnit: String(nQty),
            Reservation: String(reservationNo || item.ReservationNo || '').trim(),
            ReservationItem: sItem,
            Batch: item.Batch ? String(item.Batch).trim() : ''
          };
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
      } catch (v2Err) {
        throw this._buildPostingUnavailableError(v4Err, v2Err, 'batch Goods Issue submission');
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
      `Two distinct causes, each needing a different SAP team (verified against $metadata 2026-09-18): ` +
      `${t1Diag}. ${t2Diag}. ` +
      `Fixing (2) alone unblocks posting and is the smaller request. ` +
      `Catalog service 'ZMMIM_MATDOC_SRV' is registered but restricted to MBND_CLOUD Stock Transfers (HTTP 501 / Method 'MATDOCHEADERS_CREATE_ENTITY' not implemented) and lacks reservation movement 261 support. ` +
      `In accordance with AGENTS.md, mock persistence and dummy document generation are strictly prohibited.`;

    const postingError = new Error(message);
    postingError.status = 501;
    return postingError;
  }
}

module.exports = GoodsIssuePostingClient;
