const LOG = require('../logger')('goods-receipt-adapter');
const S4ErrorMapper = require('../S4ErrorMapper');
const { S4HttpClient } = require('../S4HttpClient');
const { RfcClient } = require('../RfcClient');
const { enrichBatchStatus } = require('../../../common/batchUtils');
const { formatDateToYMD } = require('../../../common/dateUtils');

const suResolver = require('./GoodsReceiptStorageUnitResolver');
const postingHelper = require('./GoodsReceiptPostingHelper');
const GoodsReceiptItemReader = require('./GoodsReceiptItemReader');
const GoodsReceiptMasterDataReader = require('./GoodsReceiptMasterDataReader');

class GoodsReceiptAdapter {
  static CSRF_FETCH_PATH = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1';

  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;
    this.rfc = options.rfc || new RfcClient();
    this.itemReader = new GoodsReceiptItemReader(this);
    this.masterData = new GoodsReceiptMasterDataReader(this);
  }

  _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  static _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  _formatDate(dateVal) {
    return formatDateToYMD(dateVal, { emptyFallback: '' });
  }

  static _formatDate(dateVal) {
    return formatDateToYMD(dateVal, { emptyFallback: '' });
  }

  _isOutage(err) {
    return GoodsReceiptAdapter._isOutage(err);
  }

  static _isOutage(err) {
    if (!err) return false;
    if (String(err.message || '').includes('node-rfc is not available')) return false;
    if (err.code === 'DESTINATION_NOT_CONFIGURED' || err.code === 'S4_DESTINATION_NOT_CONFIGURED') return true;
    const status = err.status || err.statusCode || err.response?.status;
    if (status && (status === 502 || status === 503 || status === 504 || status === 500 || status === 401 || status === 403)) {
      return true;
    }
    const code = String(err.code || err.cause?.code || '').toUpperCase();
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return true;
    }
    const msg = String(err.message || '').toLowerCase();
    if (
      msg.includes('destination') ||
      msg.includes('network error') ||
      msg.includes('connection refused') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound')
    ) {
      return true;
    }
    return false;
  }

  async _getDestination() {
    return this.client.resolveDestination();
  }

  static _toGatewayError(err) {
    const mapped = S4ErrorMapper.mapS4Error ? S4ErrorMapper.mapS4Error(err) : null;
    if (mapped && (mapped.status === 409 || mapped.code === 'STALE_DATA' || mapped.status === 412)) {
      mapped.statusCode = mapped.status || 409;
      return mapped;
    }
    const errObj = new Error(S4ErrorMapper.extractS4ErrorMessage(err));
    errObj.statusCode = err.status || err.statusCode;
    errObj.status = errObj.statusCode;
    errObj.code = err.code;
    return errObj;
  }

  async _get(servicePath, queryString = '') {
    try {
      const { data } = await this.client.get(servicePath, { query: queryString });
      return data?.d?.results || data?.d || data;
    } catch (err) {
      throw GoodsReceiptAdapter._toGatewayError(err);
    }
  }

  async _post(servicePath, body = {}, customHeaders = {}) {
    try {
      const { data, headers } = await this.client.post(servicePath, {
        data: body,
        headers: customHeaders,
        csrfPath: GoodsReceiptAdapter.CSRF_FETCH_PATH
      });
      const res = (data && typeof data === 'object') ? (data.d || data) : data;
      if (res && typeof res === 'object' && headers) {
        res._headers = headers;
      }
      return res;
    } catch (err) {
      throw GoodsReceiptAdapter._toGatewayError(err);
    }
  }

  async getOpenInboundDeliveries(plant = '') {
    return (this.masterData || new GoodsReceiptMasterDataReader(this)).getOpenInboundDeliveries(plant);
  }

  async getMaterialStorageLocations(material, plant) {
    return (this.masterData || new GoodsReceiptMasterDataReader(this)).getMaterialStorageLocations(material, plant);
  }

  async getMaterialBatches(material, plant = '', storageLocation = '') {
    return (this.masterData || new GoodsReceiptMasterDataReader(this)).getMaterialBatches(material, plant, storageLocation);
  }

  async _readDeliveryItemFacts(deliveryDocument, deliveryItem) {
    return (this.itemReader || new GoodsReceiptItemReader(this))._readDeliveryItemFacts(deliveryDocument, deliveryItem);
  }

  async readDeliveryPlant(deliveryDocument, deliveryItem) {
    return (this.itemReader || new GoodsReceiptItemReader(this)).readDeliveryPlant(deliveryDocument, deliveryItem);
  }

  async readPurchaseOrderItemPlant(purchaseOrder, purchaseOrderItem) {
    return (this.itemReader || new GoodsReceiptItemReader(this)).readPurchaseOrderItemPlant(purchaseOrder, purchaseOrderItem);
  }

  async getGoodsReceiptItem(deliveryDocument = '', deliveryItem = '', purchaseOrder = '', purchaseOrderItem = '') {
    return (this.itemReader || new GoodsReceiptItemReader(this)).getGoodsReceiptItem(deliveryDocument, deliveryItem, purchaseOrder, purchaseOrderItem);
  }

  async resolveStorageUnit(suNumber) {
    return suResolver.resolveStorageUnit(this, suNumber);
  }

  async postGoodsReceipt(payload = {}, options = {}) {
    return postingHelper.postGoodsReceipt(this, payload, options);
  }

  async _read101Docs(delivery, item, extraWhere = []) {
    return postingHelper._read101Docs(this, delivery, item, extraWhere);
  }

  async findReceiptForAttempt(attempt) {
    return postingHelper.findReceiptForAttempt(this, attempt);
  }

  /** SAP logon users this application posts with (RFC logon user, HTTP destination user). */
  async _postingUsers() {
    return postingHelper._postingUsers(this);
  }

  async postGoodsReceiptWithStorageUnit(payload = {}) {
    return postingHelper.postGoodsReceiptWithStorageUnit(this, payload);
  }
}

module.exports = new GoodsReceiptAdapter();
module.exports.GoodsReceiptAdapter = GoodsReceiptAdapter;
