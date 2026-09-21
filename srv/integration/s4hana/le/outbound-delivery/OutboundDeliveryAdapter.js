const LOG = require('../../../../common/logger')('outbound-delivery-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const s4Config = require('../../../../common/s4Config');
const { odataString, extractFilterParam } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVREF_SRV';

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
    this.servicePath = options.servicePath || SERVICE_PATH;
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
      let top = 50;
      let skip = 0;

      if (typeof query === 'string') {
        const url = `${this.servicePath}/C_SalesOrderDueForDeliveryVH?${query}`;
        const res = await this.client.get(url, options);
        return this._formatOrderResults(res.data?.d?.results || res.data?.results || res.data?.value || []);
      }

      // Extract filter parameters if CAP request or plain object
      let sp = null;
      let so = null;

      if (query.req || query.query || query.data) {
        sp = extractFilterParam(query, 'ShippingPoint');
        so = extractFilterParam(query, 'SalesOrder');
        if (query.query?.SELECT?.limit?.rows) {
          top = Number(query.query.SELECT.limit.rows);
        }
        if (query.query?.SELECT?.limit?.offset) {
          skip = Number(query.query.SELECT.limit.offset);
        }
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
        // Default to configured shipping points from cds.s4.shippingPoints
        const configuredSPs = s4Config.getShippingPoints() || ['1120'];
        if (configuredSPs.length === 1) {
          filterClauses.push(`ShippingPoint eq ${odataString(configuredSPs[0])}`);
        } else if (configuredSPs.length > 1) {
          const spOrs = configuredSPs.map(item => `ShippingPoint eq ${odataString(item)}`).join(' or ');
          filterClauses.push(`(${spOrs})`);
        }
      }

      // Filter by SalesOrder if provided
      if (so) {
        filterClauses.push(`SalesOrder eq ${odataString(so)}`);
      }

      // Only schedule lines without delivery block
      filterClauses.push("DelivBlockReasonForSchedLine eq ''");

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
      return this._formatOrderResults(rawResults);
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
      return rawResults.map(sp => ({
        ShippingPoint: sp.ShippingPoint,
        ShippingPointName: sp.ShippingPointName || sp.ShippingPoint_Text || '',
        ShippingPoint_Text: sp.ShippingPoint_Text || sp.ShippingPointName || '',
        ActiveDepartureCountry: sp.ActiveDepartureCountry || ''
      }));
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

    const cleanOrder = String(salesOrder).trim();
    const configuredSPs = s4Config.getShippingPoints() || ['1120'];
    const cleanSP = String(shippingPoint || configuredSPs[0] || '1120').trim();

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
   * Helper to format raw OData v2 C_SalesOrderDueForDeliveryVH records.
   *
   * @private
   */
  _formatOrderResults(rawResults) {
    return rawResults.map(r => ({
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
      DelivBlockReasonForSchedLine: r.DelivBlockReasonForSchedLine || ''
    }));
  }
}

module.exports = new OutboundDeliveryAdapter();
module.exports.OutboundDeliveryAdapter = OutboundDeliveryAdapter;
module.exports._formatODataV2Date = _formatODataV2Date;
module.exports._parseODataV2Date = _parseODataV2Date;
