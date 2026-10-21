const LOG = require('../../../../common/logger')('outbound-delivery-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { odataString, extractFilterParam } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');

let RfcClient = null;
try {
  ({ RfcClient } = require('../../RfcClient'));
} catch (_) {}

let BusinessConfigResolver = null;
try {
  BusinessConfigResolver = require('../../../../common/BusinessConfigResolver');
} catch (_) {}

let plantScope = null;
try {
  plantScope = require('../../../../wm/handling-unit/plantScope');
} catch (_) {}

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVREF_SRV';
// Verified in docs/sd-metadata (22 Sep 2026): function imports, HttpMethod POST, parameters in the URL.
const PGI_SERVICE_PATH = '/sap/opu/odata/sap/SD_SOFM_CREDIT_BLOCK_SRV';
const BILLING_SERVICE_PATH = '/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_CREATE';
// Delivery header statuses: SD_SOF/I_DeliveryDocument (verified live 22 Sep 2026; single-key read fails with LCX_INVALID_SECTION_TYPE, $filter works)
const DELIVERY_READ_PATH = '/sap/opu/odata/sap/SD_SOF';
// SAP SD document category of an outbound delivery (VBTYP 'J'); a fixed SAP domain value, not data of this delivery.
const SD_DOC_CATEGORY_DELIVERY = 'J';

/**
 * Formats a Date instance or ISO string to OData v2 Edm.DateTime JSON representation (/Date(ms)/).
 *
 * @param {string|Date} dateVal
 * @returns {string|undefined}
 */
function _formatODataV2Date(dateVal) {
  if (!dateVal) return undefined;
  if (typeof dateVal === 'string' && dateVal.startsWith('/Date(')) return dateVal;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return undefined;
  return `/Date(${d.getTime()})/`;
}

/**
 * Parses an OData v2 /Date(ms)/ timestamp to ISO Date format (YYYY-MM-DD).
 *
 * @param {string|Date} dateVal
 * @returns {string|null}
 */
function _parseODataV2Date(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
    if (match) {
      const d = new Date(parseInt(match[1], 10));
      return d.toISOString().slice(0, 10);
    }
  }
  if (dateVal instanceof Date) {
    return dateVal.toISOString().slice(0, 10);
  }
  return String(dateVal);
}

class OutboundDeliveryAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.rfc = options.rfc || (RfcClient && RfcClient.isAvailable && RfcClient.isAvailable() ? new RfcClient() : null);
    this.businessConfigResolver = options.businessConfigResolver || BusinessConfigResolver;
    this.servicePath = options.servicePath || SERVICE_PATH;
    this.cacheTtlMs = options.cacheTtlMs !== undefined ? options.cacheTtlMs : 60000;
    this._approvalCache = {
      timestamp: 0,
      map: new Map()
    };
    this._tvstzCache = new Map();
  }

  /**
   * Retrieves valid shipping points for a plant from TVSTZ (or BusinessConfigResolver).
   *
   * @param {string} plant
   * @param {Object} [options]
   * @returns {Promise<Array<string>>}
   */
  async getShippingPointsForPlant(plant, options = {}) {
    if (!plant) return [];
    const cleanPlant = String(plant).trim().toUpperCase();
    if (!cleanPlant) return [];

    if (options.shippingPoints && Array.isArray(options.shippingPoints)) {
      return options.shippingPoints;
    }
    if (typeof options.tvstzResolver === 'function') {
      return await options.tvstzResolver(cleanPlant);
    }

    if (!options.forceRefresh && this._tvstzCache && this._tvstzCache.has(cleanPlant)) {
      const entry = this._tvstzCache.get(cleanPlant);
      if (entry && entry.expiresAt > Date.now()) {
        return entry.points;
      }
    }

    let points = [];
    const rfc = options.rfc || this.rfc;
    if (rfc && typeof rfc.readTable === 'function') {
      try {
        const rows = await rfc.readTable('TVSTZ', ['WERKS', 'VSTEL'], [`WERKS = '${cleanPlant}'`]);
        if (Array.isArray(rows)) {
          points = Array.from(new Set(rows.map(r => r.VSTEL && r.VSTEL.trim()).filter(Boolean)));
        }
      } catch (err) {
        LOG.warn(`Failed to read TVSTZ for plant ${cleanPlant}: ${err.message}`);
      }
    }

    if (points.length === 0 && this.businessConfigResolver) {
      try {
        const cfg = await this.businessConfigResolver.resolve({
          plant: cleanPlant,
          fields: ['shippingPoints'],
          rfc
        });
        if (cfg && Array.isArray(cfg.shippingPoints)) {
          points = cfg.shippingPoints;
        }
      } catch (_) {}
    }

    if (this._tvstzCache) {
      this._tvstzCache.set(cleanPlant, {
        points,
        expiresAt: Date.now() + this.cacheTtlMs
      });
    }

    return points;
  }

  /**
   * Clears in-memory TVSTZ cache.
   */
  clearTvstzCache() {
    if (this._tvstzCache) {
      this._tvstzCache.clear();
    }
  }

  /**
   * Gets cached TVSTZ entry for a plant.
   *
   * @param {string} plant
   * @returns {Object|null}
   */
  getTvstzCacheEntry(plant) {
    if (!this._tvstzCache || !plant) return null;
    const cleanPlant = String(plant).trim().toUpperCase();
    return this._tvstzCache.get(cleanPlant) || null;
  }

  /**
   * Reads sales orders due for delivery from C_SalesOrderDueForDeliveryVH.
   *
   * @param {Object|string} [query] - Query options, CAP request, or filter object
   * @param {Object} [options] - Optional execution overrides
   * @returns {Promise<Array<Object>>}
   */
  async getOrdersDueForDelivery(query = {}, options = {}) {
    try {
      let filterClauses = [];
      let top = null;
      let skip = null;

      // Resolve user context from options, query, or ambient CDS context
      const user = options.user ||
        query.user ||
        query.req?.user ||
        options.req?.user ||
        (query && typeof query.is === 'function' ? query : null) ||
        (typeof cds !== 'undefined' && cds?.context?.user) ||
        null;

      // Determine authorized plants from authenticated user (server-side, never from browser)
      let authorizedPlants = null;
      if (user) {
        authorizedPlants = plantScope ? plantScope(user) : (user.is && user.is('Admin') ? null : [].concat(user.attr?.Plant || []).map(p => String(p).trim().toUpperCase()).filter(Boolean));
      }

      // Extract requested plant from query or options (e.g., query params, CAP filters, options)
      let requestedPlant = options.plant ||
        query.plant ||
        query.Plant ||
        (query.req || query.query || query.data ? extractFilterParam(query, 'Plant') : null) ||
        null;
      if (requestedPlant) {
        requestedPlant = String(requestedPlant).trim().toUpperCase();
      }

      // Authenticated user plant derivation & tamper protection
      let resolvedPlant = null;
      if (user) {
        if (authorizedPlants !== null) {
          // Non-admin user: authorizedPlants is strictly checked
          if (authorizedPlants.length === 0) {
            const err = new Error('User has no authorized plants. Access denied.');
            err.status = 403;
            err.statusCode = 403;
            throw err;
          }
          if (requestedPlant && !authorizedPlants.includes(requestedPlant)) {
            const err = new Error(`Plant '${requestedPlant}' is outside user's authorized plants: [${authorizedPlants.join(', ')}]. Access denied.`);
            err.status = 403;
            err.statusCode = 403;
            throw err;
          }
          // Take plant from authenticated user attribute only
          resolvedPlant = requestedPlant && authorizedPlants.includes(requestedPlant)
            ? requestedPlant
            : authorizedPlants[0];
        } else {
          // Admin user: unrestricted
          resolvedPlant = requestedPlant || (user.attr?.Plant && [].concat(user.attr.Plant).map(p => String(p).trim().toUpperCase()).filter(Boolean)[0]) || null;
        }
      } else {
        // No user context (e.g. system calls or unit tests specifying plant directly)
        resolvedPlant = requestedPlant;
      }

      // (1) Fail closed when no plant resolves
      if (!resolvedPlant) {
        const err = new Error('No plant resolved for orders due for delivery. Query failed closed.');
        err.status = 400;
        err.statusCode = 400;
        throw err;
      }

      if (typeof query === 'string') {
        const url = `${this.servicePath}/C_SalesOrderDueForDeliveryVH?${query}`;
        const res = await this.client.get(url, options);
        return this._formatOrderResults(res.data?.d?.results || res.data?.results || res.data?.value || []);
      }

      // Extract filter parameters if CAP request or plain object
      let sp = null;
      let so = null;

      if (query.req || query.query || query.data) {
        // CAP request branch: read all matching due orders from SAP and let the handler's
        // applyPaging handle pagination, avoiding double-skipping across pages.
        sp = extractFilterParam(query, 'ShippingPoint');
        so = extractFilterParam(query, 'SalesOrder');
      } else {
        sp = query.shippingPoint || query.ShippingPoint || null;
        so = query.salesOrder || query.SalesOrder || null;
        if (query.top || query.$top) top = Number(query.top || query.$top);
        if (query.skip || query.$skip) skip = Number(query.skip || query.$skip);
      }

      // If ShippingPoint is specified, filter by it using odataString
      if (sp) {
        filterClauses.push(`ShippingPoint eq ${odataString(sp)}`);
      } else {
        // When ShippingPoint is not specified, filter by valid points from TVSTZ for the resolved plant
        const validPoints = await this.getShippingPointsForPlant(resolvedPlant, options);
        if (validPoints.length === 1) {
          filterClauses.push(`ShippingPoint eq ${odataString(validPoints[0])}`);
        } else if (validPoints.length > 1) {
          const spOrs = validPoints.map(item => `ShippingPoint eq ${odataString(item)}`).join(' or ');
          filterClauses.push(`(${spOrs})`);
        }
      }

      // Filter by SalesOrder if provided
      if (so) {
        filterClauses.push(`SalesOrder eq ${odataString(so)}`);
      }

      const queryParts = [];
      if (filterClauses.length > 0) {
        queryParts.push(`$filter=${filterClauses.join(' and ')}`);
      }
      if (top > 0) {
        queryParts.push(`$top=${top}`);
      }
      if (skip > 0) {
        queryParts.push(`$skip=${skip}`);
      }

      const queryString = queryParts.join('&');
      const url = `${this.servicePath}/C_SalesOrderDueForDeliveryVH${queryString ? `?${queryString}` : ''}`;

      LOG.info(`Reading due orders from: ${url}`);
      const res = await this.client.get(url, options);
      const rawResults = res.data?.d?.results || res.data?.results || res.data?.value || [];

      let approvalMap = new Map();
      if (!options.skipApprovalCheck) {
        approvalMap = await this._fetchApprovalStatusMap(so, options);
      }
      return this._formatOrderResults(rawResults, approvalMap);
    } catch (err) {
      const sapErr = mapS4Error(err);
      LOG.error(`Failed to read due orders (${sapErr.status}): ${sapErr.message}`);
      const error = new Error(sapErr.message);
      error.status = sapErr.status;
      error.statusCode = sapErr.status;
      error.code = sapErr.code;
      error.details = sapErr.details;
      throw error;
    }
  }

  /**
   * Reads shipping points value help from C_ShippingPointVH.
   *
   * @param {Object} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getShippingPoints(options = {}) {
    try {
      const url = `${this.servicePath}/C_ShippingPointVH?$top=100`;
      LOG.info(`Reading shipping points from: ${url}`);
      const res = await this.client.get(url, options);
      const rawResults = res.data?.d?.results || res.data?.results || res.data?.value || [];
      let list = rawResults.map(sp => ({
        ShippingPoint: sp.ShippingPoint,
        ShippingPointName: sp.ShippingPointName || sp.ShippingPoint_Text || '',
        ShippingPoint_Text: sp.ShippingPoint_Text || sp.ShippingPointName || '',
        ActiveDepartureCountry: sp.ActiveDepartureCountry || ''
      }));

      // If plant is specified or derived from request context, filter to points valid in TVSTZ
      const plant = options.plant ||
        (options.req?.user?.attr?.Plant && [].concat(options.req.user.attr.Plant)[0]) ||
        (options.user?.attr?.Plant && [].concat(options.user.attr.Plant)[0]) ||
        null;

      if (plant) {
        const validPoints = await this.getShippingPointsForPlant(plant, options);
        if (validPoints && validPoints.length > 0) {
          const set = new Set(validPoints);
          list = list.filter(sp => set.has(sp.ShippingPoint));
        }
      }

      return list;
    } catch (err) {
      const sapErr = mapS4Error(err);
      LOG.error(`Failed to read shipping points (${sapErr.status}): ${sapErr.message}`);
      const error = new Error(sapErr.message);
      error.status = sapErr.status;
      error.statusCode = sapErr.status;
      error.code = sapErr.code;
      error.details = sapErr.details;
      throw error;
    }
  }

  /**
   * Creates an Outbound Delivery from a Sales Order reference.
   *
   * @param {Object} params
   * @param {string} params.salesOrder - Reference Sales Order document number
   * @param {string} [params.shippingPoint] - Shipping point (defaults to cds.s4.shippingPoints[0])
   * @param {string|Date} [params.deliveryDate] - Optional delivery date
   * @param {Object} [options]
   * @returns {Promise<{ OutboundDelivery: string, ReferenceSDDocument: string, ShippingPoint: string }>}
   */
  async createDeliveryFromOrder({ salesOrder, shippingPoint, deliveryDate }, options = {}) {
    if (!salesOrder || String(salesOrder).trim() === '') {
      const err = new Error('SalesOrder reference is required to create an outbound delivery.');
      err.status = 400;
      err.statusCode = 400;
      throw err;
    }

    if (!shippingPoint || String(shippingPoint).trim() === '') {
      const err = new Error('ShippingPoint is required to create an outbound delivery and cannot be defaulted.');
      err.status = 400;
      err.statusCode = 400;
      throw err;
    }

    const cleanOrder = String(salesOrder).trim();
    const cleanSP = String(shippingPoint).trim();

    // Verify approval status unless explicitly skipped
    if (!options.skipApprovalCheck) {
      const approvalMap = await this._fetchApprovalStatusMap(cleanOrder, options);
      if (approvalMap === null) {
        const err = new Error(`Could not verify approval status for Sales Order ${cleanOrder}. Outbound delivery creation blocked.`);
        err.status = 502;
        err.statusCode = 502;
        throw err;
      }
      const approvalStatus = approvalMap.get(cleanOrder);
      if (approvalStatus && approvalStatus !== 'B') {
        const statusDescriptions = {
          'A': 'in approval',
          'C': 'rejected',
          'D': 'being reworked'
        };
        const desc = statusDescriptions[approvalStatus] || `status '${approvalStatus}'`;
        const err = new Error(`Sales Order ${cleanOrder} is ${desc} and cannot be delivered.`);
        err.status = 400;
        err.statusCode = 400;
        throw err;
      }
    }

    const payload = {
      ReferenceSDDocument: cleanOrder,
      ShippingPoint: cleanSP
    };

    if (deliveryDate) {
      const formattedDate = _formatODataV2Date(deliveryDate);
      if (formattedDate) {
        payload.DeliveryDate = formattedDate;
      }
    }

    const url = `${this.servicePath}/C_DelivWthRefQuickCreate`;
    LOG.info(`Creating outbound delivery: POST ${url} for Order ${cleanOrder}, SP ${cleanSP}`);

    try {
      const res = await this.client.post(url, {
        data: payload,
        ...options
      });

      const d = res.data?.d || res.data || {};
      const outboundDelivery = d.OutboundDelivery;

      if (!outboundDelivery) {
        LOG.warn('S/4HANA POST succeeded but no OutboundDelivery number was returned.');
        return {
          OutboundDelivery: '',
          ReferenceSDDocument: cleanOrder,
          ShippingPoint: cleanSP,
          rawResponse: d
        };
      }

      LOG.info(`Successfully created Outbound Delivery: ${outboundDelivery} for Order ${cleanOrder}`);
      return {
        OutboundDelivery: outboundDelivery,
        ReferenceSDDocument: cleanOrder,
        ShippingPoint: cleanSP,
        DeliveryDate: _parseODataV2Date(d.DeliveryDate),
        DeliveryDocumentType: d.DeliveryDocumentType || ''
      };
    } catch (err) {
      const sapErr = mapS4Error(err);
      LOG.error(`Failed to create Outbound Delivery (${sapErr.status}): ${sapErr.message}`);
      const error = new Error(sapErr.message);
      error.status = sapErr.status;
      error.statusCode = sapErr.status;
      error.code = sapErr.code;
      error.details = sapErr.details;
      throw error;
    }
  }

  /**
   * Fetches unapproved / in-approval sales order statuses from SD_F1873_SO_WL_SRV.
   * Caches results in-memory for `cacheTtlMs` (default 60s) to avoid extra SAP calls on worklist reads.
   *
   * @private
   */
  async _fetchApprovalStatusMap(so, options = {}) {
    const now = Date.now();
    // Return cached map if querying full list (no specific SO) and cache has not expired
    if (!so && !options.forceRefresh && (now - this._approvalCache.timestamp < this.cacheTtlMs)) {
      return this._approvalCache.map;
    }

    const map = new Map();
    try {
      let filter = "SalesDocApprovalStatus ne ''";
      if (so) {
        filter = `SalesOrder eq ${odataString(so)} and ${filter}`;
      }
      const url = `/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873?$select=SalesOrder,SalesDocApprovalStatus&$filter=${filter}&$top=1000`;
      const res = await this.client.get(url, options);
      const items = res.data?.d?.results || res.data?.results || res.data?.value || [];
      items.forEach(item => {
        if (item.SalesOrder && item.SalesDocApprovalStatus) {
          map.set(item.SalesOrder, item.SalesDocApprovalStatus);
        }
      });
      // Cache global results
      if (!so) {
        this._approvalCache = {
          timestamp: now,
          map
        };
      }
      return map;
    } catch (err) {
      LOG.warn(`Could not fetch sales order approval status map: ${err.message}`);
      // Invalidate cache and return null so callers know approval lookup failed
      this._approvalCache = {
        timestamp: 0,
        map: new Map()
      };
      return null;
    }
  }

  /**
   * Helper to format raw OData v2 C_SalesOrderDueForDeliveryVH records.
   *
   * @private
   */
  _formatOrderResults(rawResults, approvalStatusMap = new Map()) {
    const isUnknown = approvalStatusMap === null;
    return rawResults.map(r => {
      const approvalStatus = isUnknown
        ? 'unknown'
        : ((approvalStatusMap && typeof approvalStatusMap.get === 'function' ? approvalStatusMap.get(r.SalesOrder) : '') || '');
      const delivBlock = r.DelivBlockReasonForSchedLine || '';
      const isDeliverable = !delivBlock && approvalStatus !== 'unknown' && (approvalStatus === 'B' || !approvalStatus);
      return {
        SalesOrder: r.SalesOrder,
        SalesOrderItem: r.SalesOrderItem,
        ScheduleLine: r.ScheduleLine,
        ShippingPoint: r.ShippingPoint,
        DeliveryCreationDate: _parseODataV2Date(r.DeliveryCreationDate),
        DeliveryPriority: r.DeliveryPriority || '',
        Route: r.Route || '',
        ForwardingAgent: r.ForwardingAgent || '',
        GoodsIssueDate: _parseODataV2Date(r.GoodsIssueDate),
        ShipToParty: r.ShipToParty || '',
        DelivBlockReasonForSchedLine: delivBlock,
        SalesDocApprovalStatus: approvalStatus,
        IsDeliverable: isDeliverable
      };
    });
  }

  /**
   * Reads the delivery header statuses from S/4HANA (picking, goods movement, billing). Returns null when SAP has no such delivery.
   */
  async getDeliveryStatus(deliveryDocument, options = {}) {
    const dlv = String(deliveryDocument || '').trim();
    if (!dlv) {
      const err = new Error('DeliveryDocument is required.');
      err.status = 400;
      throw err;
    }
    const select = 'DeliveryDocument,DeliveryDocumentType,ShippingPoint,SoldToParty,SalesOrganization,OverallPickingStatus,OverallGoodsMovementStatus,OverallDelivReltdBillgStatus,OverallSDProcessStatus,ActualGoodsMovementDate';
    const url = `${DELIVERY_READ_PATH}/I_DeliveryDocument?$filter=${encodeURIComponent(`DeliveryDocument eq ${odataString(dlv)}`)}&$select=${select}&$top=1&$format=json`;
    let res;
    try {
      res = await this.client.get(url, options);
    } catch (err) {
      throw mapS4Error(err, 'getDeliveryStatus');
    }
    const rows = res.data?.d?.results || res.data?.value || [];
    const r = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!r) return null;
    return {
      DeliveryDocument: r.DeliveryDocument || dlv,
      DeliveryDocumentType: r.DeliveryDocumentType || '',
      ShippingPoint: r.ShippingPoint || '',
      SoldToParty: r.SoldToParty || '',
      SalesOrganization: r.SalesOrganization || '',
      OverallPickingStatus: r.OverallPickingStatus || '',
      OverallGoodsMovementStatus: r.OverallGoodsMovementStatus || '',
      OverallDelivReltdBillgStatus: r.OverallDelivReltdBillgStatus || '',
      OverallSDProcessStatus: r.OverallSDProcessStatus || '',
      ActualGoodsMovementDate: _parseODataV2Date(r.ActualGoodsMovementDate)
    };
  }

  /**
   * Posts goods issue for an outbound delivery via SD_SOFM_CREDIT_BLOCK_SRV/PostGoodsIssue.
   * SAP answers with PostGoodsReturnInfo flags only (no material document number) — that is what is reported.
   */
  async postGoodsIssue(deliveryDocument, options = {}) {
    const dlv = String(deliveryDocument || '').trim();
    if (!dlv) {
      const err = new Error('DeliveryDocument is required to post goods issue.');
      err.status = 400;
      throw err;
    }
    const url = `${PGI_SERVICE_PATH}/PostGoodsIssue?DeliveryNumber=${odataString(dlv)}`;
    LOG.info(`Posting goods issue: POST ${url}`);
    let res;
    try {
      res = await this.client.post(url, { data: {}, ...options });
    } catch (err) {
      throw mapS4Error(err, 'postGoodsIssue');
    }
    const d = (res.data && (res.data.d || res.data)) || {};
    const info = d.PostGoodsIssue || d;
    const errorFlags = Object.keys(info).filter(k => k.startsWith('Error') && k !== 'ErrorAny' && info[k] === true);
    const done = info.Done === true && info.ErrorAny !== true;
    if (!done) {
      const err = new Error(`S/4HANA did not post goods issue for delivery ${dlv}${errorFlags.length ? ` (${errorFlags.join(', ')})` : ''}.`);
      err.status = 422;
      err.details = info;
      throw err;
    }
    return { DeliveryDocument: dlv, Done: true, ErrorFlags: errorFlags };
  }

  /**
   * Releases credit block for an outbound delivery via SD_SOFM_CREDIT_BLOCK_SRV/ReleaseCreditDelivery.
   */
  async releaseCreditDelivery(deliveryDocument, options = {}) {
    const dlv = String(deliveryDocument || '').trim();
    if (!dlv) {
      const err = new Error('DeliveryDocument is required to release credit block.');
      err.status = 400;
      throw err;
    }
    const url = `${PGI_SERVICE_PATH}/ReleaseCreditDelivery?DeliveryNumber=${odataString(dlv)}`;
    LOG.info(`Releasing credit block for delivery: POST ${url}`);
    let res;
    try {
      res = await this.client.post(url, { data: {}, ...options });
    } catch (err) {
      throw mapS4Error(err, 'releaseCreditDelivery');
    }
    const d = (res.data && (res.data.d || res.data)) || {};
    const info = d.ReleaseCreditDelivery || d;
    return { DeliveryDocument: dlv, Done: info.Done === true };
  }

  /**
   * Billing document types S/4HANA allows for this delivery (SD_CUSTOMER_INVOICES_CREATE/GetBillingDocumentTypes).
   */
  async getBillingDocumentTypes(deliveryDocument, options = {}) {
    const dlv = String(deliveryDocument || '').trim();
    if (!dlv) {
      const err = new Error('DeliveryDocument is required.');
      err.status = 400;
      throw err;
    }
    const url = `${BILLING_SERVICE_PATH}/GetBillingDocumentTypes?ReferenceSDDocument=${odataString(dlv)}`;
    let res;
    try {
      res = await this.client.post(url, { data: {}, ...options });
    } catch (err) {
      throw mapS4Error(err, 'getBillingDocumentTypes');
    }
    const rows = res.data?.d?.results || res.data?.d || res.data?.value || [];
    return (Array.isArray(rows) ? rows : []).map(r => ({
      BillingDocumentType: r.BillingDocumentType || '',
      BillingDocumentTypeName: r.BillingDocumentTypeName || ''
    })).filter(r => r.BillingDocumentType);
  }

  /**
   * Creates a billing document for an outbound delivery via SD_CUSTOMER_INVOICES_CREATE/CreateBillingDocuments.
   * The billing document number comes only from SAP's FunctionImportResult; SAP's messages are returned verbatim.
   */
  async createBillingDocument({ deliveryDocument, billingDocumentType, billingDocumentDate, salesOrganization }, options = {}) {
    const dlv = String(deliveryDocument || '').trim();
    const type = String(billingDocumentType || '').trim();
    if (!dlv) {
      const err = new Error('DeliveryDocument is required to create a billing document.');
      err.status = 400;
      throw err;
    }

    // Date formatting: S/4HANA expects YYYYMMDD string. Default to today if not provided.
    const ymd = billingDocumentDate
      ? String(billingDocumentDate).slice(0, 10).replace(/-/g, '')
      : new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // S/4HANA SD_CUSTOMER_INVOICES_CREATE/CreateBillingDocuments requires all 16 function import
    // parameters to be present in the query string; omitting any parameter causes Gateway to return
    // HTTP 404 "Invalid Function Import Parameter '<ParamName>'".
    const params = [
      `RefSDDocWithInvalidPartner=''`,
      `OldBillToPartyAddressId=''`,
      `NewBillToPartyAddressId=''`,
      `SalesOrganization=${odataString(salesOrganization || '')}`,
      `ReferenceSDDocumentItem=''`,
      `ToBeBilledQuantity=''`,
      `SnapshotRequested=''`,
      `ReferenceSDDocumentCategory=${odataString(SD_DOC_CATEGORY_DELIVERY)}`,
      `DestinationCountry=''`,
      `BillingDocumentType=${odataString(type)}`,
      `SeparateBilllingDocumentsRequested=''`,
      `RequestedBillingDocumentDate=${odataString(ymd)}`,
      `BillingDocumentReleaseRequested=''`,
      `BillingDocumentDate=${odataString(ymd)}`,
      `ReferenceSDDocument=${odataString(dlv)}`,
      `RequestedBillingDocumentType=${odataString(type)}`
    ];
    const url = `${BILLING_SERVICE_PATH}/CreateBillingDocuments?${params.join('&')}`;
    LOG.info(`Creating billing document: POST ${url}`);
    let res;
    try {
      res = await this.client.post(url, { data: {}, ...options });
    } catch (err) {
      throw mapS4Error(err, 'createBillingDocument');
    }
    const rows = res.data?.d?.results || res.data?.d || res.data?.value || [];
    const results = Array.isArray(rows) ? rows : [rows];
    const messages = results
      .filter(r => r && (r.Message || r.MessageType))
      .map(r => ({ MessageType: r.MessageType || '', MessageId: r.MessageId || '', Message: r.Message || '' }));
    const created = results.find(r => r && r.BillingDocument && String(r.BillingDocument).trim() !== '');
    if (!created) {
      const err = new Error(`S/4HANA returned no billing document for delivery ${dlv}: ${messages.map(m => m.Message).filter(Boolean).join(' | ') || 'no message'}`);
      err.status = 422;
      err.details = messages;
      throw err;
    }
    return {
      BillingDocument: String(created.BillingDocument).trim(),
      BillToParty: created.BillToParty || '',
      BillToPartyName: created.BillToPartyName || '',
      Messages: messages
    };
  }

}

module.exports = new OutboundDeliveryAdapter();
module.exports.OutboundDeliveryAdapter = OutboundDeliveryAdapter;
module.exports._formatODataV2Date = _formatODataV2Date;
module.exports._parseODataV2Date = _parseODataV2Date;
