const LOG = require('../../../../common/logger')('delivery-no-ref-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const s4Config = require('../../../../common/s4Config');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');

const SERVICE_PATH = '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV';

/**
 * Formats a Date instance or ISO string to OData v2 Edm.DateTime JSON representation (/Date(ms)/).
 *
 * @param {string|Date|number} dateVal
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

function _toError(mapped) {
  const err = new Error(mapped.message);
  err.status = mapped.status;
  err.statusCode = mapped.status;
  err.code = mapped.code;
  err.details = mapped.details;
  return err;
}

class DeliveryNoRefAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.servicePath = options.servicePath || SERVICE_PATH;
  }

  /**
   * Creates an Outbound Delivery without reference using C_DelivWthoutRefQuickCreate deep insert.
   *
   * @param {Object} payload
   * @param {string} payload.shippingPoint - e.g. '1104'
   * @param {string} [payload.deliveryType='LO2'] - e.g. 'LO2'
   * @param {string} [payload.salesOrg='1000'] - Sales Organization
   * @param {string} [payload.distChannel='10'] - Distribution Channel
   * @param {string} [payload.division='52'] - Division
   * @param {string} payload.shipToParty - Customer number e.g. '10135'
   * @param {string} payload.plant - Delivering Plant e.g. '1110'
   * @param {string} payload.storageLocation - Storage Location e.g. 'FG01'
   * @param {string|Date} payload.plannedGoodsIssueDate - Planned GI date
   * @param {Array<Object>} payload.items - Line items [{ material, quantity, uom, itemNo }]
   * @param {Object} [options]
   * @returns {Promise<Object>} Created delivery details from SAP
   */
  async createDeliveryWithoutRef(payload = {}, options = {}) {
    if (!payload.shippingPoint || String(payload.shippingPoint).trim() === '') {
      const err = new Error('ShippingPoint is required for delivery creation.');
      err.status = 400;
      throw err;
    }

    if (!payload.shipToParty || String(payload.shipToParty).trim() === '') {
      const err = new Error('ShipToParty is required for delivery creation.');
      err.status = 400;
      throw err;
    }

    if (!payload.plant || String(payload.plant).trim() === '') {
      const err = new Error('Plant is required for delivery creation.');
      err.status = 400;
      throw err;
    }

    if (!payload.storageLocation || String(payload.storageLocation).trim() === '') {
      const err = new Error('StorageLocation is required for delivery creation.');
      err.status = 400;
      throw err;
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      const err = new Error('At least one item is required to create a delivery.');
      err.status = 400;
      throw err;
    }

    const formattedPgiDate = _formatODataV2Date(payload.plannedGoodsIssueDate) ||
      _formatODataV2Date(new Date(Date.now() + 86400000));

    const s4Items = items.map((it, idx) => {
      const itemNum = it.itemNo || it.DeliveryDocumentItem || String((idx + 1) * 10).padStart(6, '0');
      const qtyNum = parseFloat(it.quantity || it.ActualDeliveryQuantity || 1);
      return {
        DeliveryDocumentItem: String(itemNum).padStart(6, '0'),
        Material: String(it.material || it.Material || '').trim(),
        ActualDeliveryQuantity: qtyNum.toFixed(3),
        DeliveryQuantityUnit: String(it.uom || it.DeliveryQuantityUnit || 'KG').toUpperCase()
      };
    });

    for (const it of s4Items) {
      if (!it.Material) {
        const err = new Error('Material is required for each delivery item.');
        err.status = 400;
        throw err;
      }
    }

    const s4Payload = {
      ShippingPoint: String(payload.shippingPoint).trim(),
      DeliveryDocumentType: String(payload.deliveryType || 'LO2').trim(),
      SalesOrganization: String(payload.salesOrg || s4Config.getSalesOrganization() || '1000').trim(),
      DistributionChannel: String(payload.distChannel || s4Config.getDistributionChannel() || '10').trim(),
      Division: String(payload.division || s4Config.getDivision() || '52').trim(),
      ShipToParty: String(payload.shipToParty).trim(),
      Plant: String(payload.plant).trim(),
      StorageLocation: String(payload.storageLocation).trim(),
      PlannedGoodsIssueDate: formattedPgiDate,
      to_DeliveryItemQuickCreate: s4Items
    };

    LOG.info(`Creating Delivery Without Reference: SP=${s4Payload.ShippingPoint}, Type=${s4Payload.DeliveryDocumentType}, Plant=${s4Payload.Plant}, SLoc=${s4Payload.StorageLocation}, ShipTo=${s4Payload.ShipToParty}, Items=${s4Items.length}`);

    try {
      const res = await this.client.post(`${this.servicePath}/C_DelivWthoutRefQuickCreate`, {
        ...options,
        data: s4Payload
      });

      const d = res.data?.d || res.data;
      const deliveryNum = d?.OutboundDelivery;

      if (!deliveryNum) {
        throw new Error('SAP S/4HANA responded with HTTP 201 but no OutboundDelivery number was returned.');
      }

      LOG.info(`Successfully created SAP Outbound Delivery without reference: ${deliveryNum}`);

      return {
        OutboundDelivery: deliveryNum,
        ShippingPoint: d.ShippingPoint || s4Payload.ShippingPoint,
        DeliveryDocumentType: d.DeliveryDocumentType || s4Payload.DeliveryDocumentType,
        PlannedGoodsIssueDate: _parseODataV2Date(d.PlannedGoodsIssueDate) || payload.plannedGoodsIssueDate,
        Plant: d.Plant || s4Payload.Plant,
        StorageLocation: d.StorageLocation || s4Payload.StorageLocation,
        ShipToParty: d.ShipToParty || s4Payload.ShipToParty,
        ItemCount: s4Items.length
      };
    } catch (err) {
      const mapped = mapS4Error(err, 'createDeliveryWithoutRef');
      LOG.error(`Failed to create delivery without reference: ${mapped.message}`);
      throw _toError(mapped);
    }
  }

  /**
   * Reads an Outbound Delivery without reference directly back from S/4HANA.
   *
   * @param {string} deliveryId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async getDeliveryWithoutRef(deliveryId, options = {}) {
    if (!deliveryId) {
      const err = new Error('OutboundDelivery ID is required.');
      err.status = 400;
      throw err;
    }

    try {
      const [headerRes, itemsRes] = await Promise.all([
        this.client.get(`${this.servicePath}/C_DelivWthoutRefQuickCreate(${odataString(deliveryId)})`, options),
        this.client.get(`${this.servicePath}/C_DelivItmWthoutRefQuickCrte?$filter=OutboundDelivery eq ${odataString(deliveryId)}`, options)
      ]);

      const h = headerRes.data?.d || headerRes.data;
      const rawItems = itemsRes.data?.d?.results || itemsRes.data?.results || [];

      return {
        OutboundDelivery: h.OutboundDelivery,
        ShippingPoint: h.ShippingPoint,
        ShippingPointName: h.ShippingPointName,
        DeliveryDocumentType: h.DeliveryDocumentType,
        DeliveryDocumentTypeName: h.DeliveryDocumentTypeName,
        SalesOrganization: h.SalesOrganization,
        DistributionChannel: h.DistributionChannel,
        Division: h.Division,
        ShipToParty: h.ShipToParty,
        CustomerName: h.CustomerName,
        PlannedGoodsIssueDate: _parseODataV2Date(h.PlannedGoodsIssueDate),
        Plant: h.Plant,
        PlantName: h.PlantName,
        StorageLocation: h.StorageLocation,
        StorageLocationName: h.StorageLocationName,
        Items: rawItems.map(it => ({
          OutboundDelivery: it.OutboundDelivery,
          DeliveryDocumentItem: it.DeliveryDocumentItem,
          Material: it.Material,
          MaterialName: it.MaterialName,
          ActualDeliveryQuantity: it.ActualDeliveryQuantity,
          DeliveryQuantityUnit: it.DeliveryQuantityUnit,
          UnitOfMeasureLongName: it.UnitOfMeasureLongName
        }))
      };
    } catch (err) {
      const mapped = mapS4Error(err, 'getDeliveryWithoutRef');
      LOG.error(`Failed to get delivery without reference ${deliveryId}: ${mapped.message}`);
      throw _toError(mapped);
    }
  }

  /**
   * Reads supported Delivery Document Types without reference from C_DelivTypeNoRefVH.
   *
   * @param {Object} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getDeliveryTypes(options = {}) {
    try {
      const res = await this.client.get(`${this.servicePath}/C_DelivTypeNoRefVH`, options);
      const list = res.data?.d?.results || res.data?.results || [];
      return list.map(dt => ({
        DeliveryDocumentType: dt.DeliveryDocumentType,
        DeliveryDocumentTypeName: dt.DeliveryDocumentTypeName,
        SDDocumentCategory: dt.SDDocumentCategory,
        PrecedingDocumentRequirement: dt.PrecedingDocumentRequirement
      }));
    } catch (err) {
      const mapped = mapS4Error(err, 'getDeliveryTypes');
      LOG.error(`Failed to get delivery document types: ${mapped.message}`);
      throw _toError(mapped);
    }
  }

  /**
   * Reads Shipping Points from C_ShippingPointVH.
   *
   * @param {Object} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getShippingPoints(options = {}) {
    try {
      const res = await this.client.get(`${this.servicePath}/C_ShippingPointVH`, options);
      const list = res.data?.d?.results || res.data?.results || [];
      return list.map(sp => ({
        ShippingPoint: sp.ShippingPoint,
        ShippingPointName: sp.ShippingPointName || sp.ShippingPoint_Text,
        ActiveDepartureCountry: sp.ActiveDepartureCountry
      }));
    } catch (err) {
      const mapped = mapS4Error(err, 'getShippingPoints');
      LOG.error(`Failed to get shipping points: ${mapped.message}`);
      throw _toError(mapped);
    }
  }

  /**
   * Reads Ship-To Parties from C_DeliveryShipToPartyVH.
   *
   * @param {string} [top='50']
   * @param {Object} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getShipToParties(top = 50, options = {}) {
    try {
      const res = await this.client.get(`${this.servicePath}/C_DeliveryShipToPartyVH?$top=${top}`, options);
      const list = res.data?.d?.results || res.data?.results || [];
      return list.map(st => ({
        Customer: st.Customer,
        CustomerName: st.CustomerName || st.BusinessPartnerName1,
        CityName: st.CityName,
        Country: st.Country
      }));
    } catch (err) {
      const mapped = mapS4Error(err, 'getShipToParties');
      LOG.error(`Failed to get ship-to parties: ${mapped.message}`);
      throw _toError(mapped);
    }
  }

  /**
   * Reads Materials from C_Materialvaluehelp.
   *
   * @param {string} [top='50']
   * @param {Object} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getMaterials(top = 50, options = {}) {
    try {
      const res = await this.client.get(`${this.servicePath}/C_Materialvaluehelp?$top=${top}`, options);
      const list = res.data?.d?.results || res.data?.results || [];
      return list.map(m => ({
        Material: m.Material,
        MaterialName: m.Material_Text,
        MaterialType: m.MaterialType,
        MaterialBaseUnit: m.MaterialBaseUnit
      }));
    } catch (err) {
      const mapped = mapS4Error(err, 'getMaterials');
      LOG.error(`Failed to get materials: ${mapped.message}`);
      throw _toError(mapped);
    }
  }
}

module.exports = new DeliveryNoRefAdapter();
module.exports.DeliveryNoRefAdapter = DeliveryNoRefAdapter;
module.exports._formatODataV2Date = _formatODataV2Date;
module.exports._parseODataV2Date = _parseODataV2Date;
