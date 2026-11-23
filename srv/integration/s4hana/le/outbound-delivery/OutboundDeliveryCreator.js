'use strict';

const LOG = require('../../../../common/logger')('outbound-delivery-adapter');
const { mapS4Error } = require('../../S4ErrorMapper');
const { _formatODataV2Date, _parseODataV2Date } = require('./outboundDeliveryDateUtils');

class OutboundDeliveryCreator {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get client() {
    return this.adapter.client;
  }

  get servicePath() {
    return this.adapter.servicePath;
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
      const approvalMap = await this.adapter._fetchApprovalStatusMap(cleanOrder, options);
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
      if (err.$sanitize === false) throw err;
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
}

module.exports = OutboundDeliveryCreator;
