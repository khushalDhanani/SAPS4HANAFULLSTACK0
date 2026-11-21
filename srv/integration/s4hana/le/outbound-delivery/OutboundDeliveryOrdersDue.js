'use strict';

const LOG = require('../../../../common/logger')('outbound-delivery-adapter');
const { odataString, extractFilterParam } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');
const { _parseODataV2Date } = require('./outboundDeliveryDateUtils');

let plantScope = null;
try {
  plantScope = require('../../../../wm/handling-unit/plantScope');
} catch (_) {}

class OutboundDeliveryOrdersDue {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get client() {
    return this.adapter.client;
  }

  get servicePath() {
    return this.adapter.servicePath;
  }

  get cacheTtlMs() {
    return this.adapter.cacheTtlMs;
  }

  get _approvalCache() {
    return this.adapter._approvalCache;
  }

  set _approvalCache(val) {
    this.adapter._approvalCache = val;
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

      // Extract requested plant from query or options
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
          resolvedPlant = requestedPlant && authorizedPlants.includes(requestedPlant)
            ? requestedPlant
            : authorizedPlants[0];
        } else {
          resolvedPlant = requestedPlant || (user.attr?.Plant && [].concat(user.attr.Plant).map(p => String(p).trim().toUpperCase()).filter(Boolean)[0]) || null;
        }
      } else {
        resolvedPlant = requestedPlant;
      }

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

      let sp = null;
      let so = null;

      if (query.req || query.query || query.data) {
        sp = extractFilterParam(query, 'ShippingPoint');
        so = extractFilterParam(query, 'SalesOrder');
      } else {
        sp = query.shippingPoint || query.ShippingPoint || null;
        so = query.salesOrder || query.SalesOrder || null;
        if (query.top || query.$top) top = Number(query.top || query.$top);
        if (query.skip || query.$skip) skip = Number(query.skip || query.$skip);
      }

      const isPlantScoped = authorizedPlants !== null;

      if (sp) {
        if (isPlantScoped) {
          await this.adapter.assertShippingPointInPlants(sp, requestedPlant ? [resolvedPlant] : authorizedPlants, options);
        }
        filterClauses.push(`ShippingPoint eq ${odataString(sp)}`);
      } else {
        const validPoints = isPlantScoped
          ? await this.adapter._shippingPointsInScope([resolvedPlant], options)
          : await this.adapter.getShippingPointsForPlant(resolvedPlant, options);
        if (validPoints.length === 1) {
          filterClauses.push(`ShippingPoint eq ${odataString(validPoints[0])}`);
        } else if (validPoints.length > 1) {
          const spOrs = validPoints.map(item => `ShippingPoint eq ${odataString(item)}`).join(' or ');
          filterClauses.push(`(${spOrs})`);
        }
      }

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
      if (err.isScopeRefusal) throw err;
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
   * Fetches unapproved / in-approval sales order statuses from SD_F1873_SO_WL_SRV.
   * Caches results in-memory for `cacheTtlMs` (default 60s) to avoid extra SAP calls on worklist reads.
   */
  async _fetchApprovalStatusMap(so, options = {}) {
    const now = Date.now();
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
      if (!so) {
        this._approvalCache = {
          timestamp: now,
          map
        };
      }
      return map;
    } catch (err) {
      LOG.warn(`Could not fetch sales order approval status map: ${err.message}`);
      this._approvalCache = {
        timestamp: 0,
        map: new Map()
      };
      return null;
    }
  }

  /**
   * Helper to format raw OData v2 C_SalesOrderDueForDeliveryVH records.
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
}

module.exports = OutboundDeliveryOrdersDue;
