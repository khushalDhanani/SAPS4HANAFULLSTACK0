'use strict';

const { S4HttpClient } = require('../../S4HttpClient');
const { _formatODataV2Date, _parseODataV2Date } = require('./outboundDeliveryDateUtils');

const OutboundDeliveryShippingPoints = require('./OutboundDeliveryShippingPoints');
const OutboundDeliveryOrdersDue = require('./OutboundDeliveryOrdersDue');
const OutboundDeliveryCreator = require('./OutboundDeliveryCreator');
const OutboundDeliveryBilling = require('./OutboundDeliveryBilling');

let RfcClient = null;
try {
  ({ RfcClient } = require('../../RfcClient'));
} catch (_) {}

let BusinessConfigResolver = null;
try {
  BusinessConfigResolver = require('../../../../common/BusinessConfigResolver');
} catch (_) {}

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVREF_SRV';

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

    this.shippingPoints = new OutboundDeliveryShippingPoints(this);
    this.ordersDue = new OutboundDeliveryOrdersDue(this);
    this.creator = new OutboundDeliveryCreator(this);
    this.billing = new OutboundDeliveryBilling(this);
  }

  async getShippingPointsForPlant(plant, options = {}) {
    return this.shippingPoints.getShippingPointsForPlant(plant, options);
  }

  async _shippingPointsInScope(plants, options = {}) {
    return this.shippingPoints._shippingPointsInScope(plants, options);
  }

  async assertShippingPointInPlants(shippingPoint, plants, options = {}) {
    return this.shippingPoints.assertShippingPointInPlants(shippingPoint, plants, options);
  }

  async readDeliveryPlants(deliveryDocument) {
    return this.shippingPoints.readDeliveryPlants(deliveryDocument);
  }

  clearTvstzCache() {
    return this.shippingPoints.clearTvstzCache();
  }

  getTvstzCacheEntry(plant) {
    return this.shippingPoints.getTvstzCacheEntry(plant);
  }

  async getShippingPoints(options = {}) {
    return this.shippingPoints.getShippingPoints(options);
  }

  async getOrdersDueForDelivery(query = {}, options = {}) {
    return this.ordersDue.getOrdersDueForDelivery(query, options);
  }

  async _fetchApprovalStatusMap(so, options = {}) {
    return this.ordersDue._fetchApprovalStatusMap(so, options);
  }

  _formatOrderResults(rawResults, approvalStatusMap = new Map()) {
    return this.ordersDue._formatOrderResults(rawResults, approvalStatusMap);
  }

  async createDeliveryFromOrder({ salesOrder, shippingPoint, deliveryDate }, options = {}) {
    return this.creator.createDeliveryFromOrder({ salesOrder, shippingPoint, deliveryDate }, options);
  }

  async getDeliveryStatus(deliveryDocument, options = {}) {
    return this.billing.getDeliveryStatus(deliveryDocument, options);
  }

  async releaseCreditDelivery(deliveryDocument, options = {}) {
    return this.billing.releaseCreditDelivery(deliveryDocument, options);
  }

  async getBillingDocumentTypes(deliveryDocument, options = {}) {
    return this.billing.getBillingDocumentTypes(deliveryDocument, options);
  }

  async createBillingDocument({ deliveryDocument, billingDocumentType, billingDocumentDate, salesOrganization }, options = {}) {
    return this.billing.createBillingDocument({ deliveryDocument, billingDocumentType, billingDocumentDate, salesOrganization }, options);
  }
}

module.exports = new OutboundDeliveryAdapter();
module.exports.OutboundDeliveryAdapter = OutboundDeliveryAdapter;
module.exports._formatODataV2Date = _formatODataV2Date;
module.exports._parseODataV2Date = _parseODataV2Date;
