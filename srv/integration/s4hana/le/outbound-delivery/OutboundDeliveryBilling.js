'use strict';

const LOG = require('../../../../common/logger')('outbound-delivery-adapter');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');
const { _parseODataV2Date } = require('./outboundDeliveryDateUtils');

const CREDIT_BLOCK_SERVICE_PATH = '/sap/opu/odata/sap/SD_SOFM_CREDIT_BLOCK_SRV';
const BILLING_SERVICE_PATH = '/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_CREATE';
const DELIVERY_READ_PATH = '/sap/opu/odata/sap/SD_SOF';
const SD_DOC_CATEGORY_DELIVERY = 'J';

class OutboundDeliveryBilling {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get client() {
    return this.adapter.client;
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
   * Releases credit block for an outbound delivery via SD_SOFM_CREDIT_BLOCK_SRV/ReleaseCreditDelivery.
   */
  async releaseCreditDelivery(deliveryDocument, options = {}) {
    const dlv = String(deliveryDocument || '').trim();
    if (!dlv) {
      const err = new Error('DeliveryDocument is required to release credit block.');
      err.status = 400;
      throw err;
    }
    const url = `${CREDIT_BLOCK_SERVICE_PATH}/ReleaseCreditDelivery?DeliveryNumber=${odataString(dlv)}`;
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

    const ymd = billingDocumentDate
      ? String(billingDocumentDate).slice(0, 10).replace(/-/g, '')
      : new Date().toISOString().slice(0, 10).replace(/-/g, '');

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

module.exports = OutboundDeliveryBilling;
