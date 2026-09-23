const LOG = require('../../../../common/logger')('customer-invoice-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');

const SERVICE_PATH = '/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE';
const ENTITY_SET = 'C_BillingDocument_F0797';
const DEFAULT_SD_CATEGORY = 'M'; // Standard Billing Document

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

/**
 * Normalizes a raw SAP C_BillingDocument_F0797 row to a clean domain object.
 *
 * @param {Object} row
 * @returns {Object}
 */
function _formatInvoiceRow(row) {
  if (!row) return null;
  return {
    BillingDocument: String(row.BillingDocument || '').trim(),
    BillingDocumentType: row.BillingDocumentType || '',
    BillingDocumentTypeName: row.BillingDocumentTypeName || '',
    SoldToParty: row.SoldToParty || '',
    SoldToPartyFullName: row.SoldToPartyFullName || row.SoldToPartyName || '',
    PayerParty: row.PayerParty || '',
    PayerPartyName: row.PayerPartyName || '',
    SDDocumentCategory: row.SDDocumentCategory || DEFAULT_SD_CATEGORY,
    AccountingTransferStatus: row.AccountingTransferStatus || '',
    AccountingDocument: row.AccountingDocument || '',
    FiscalYear: row.FiscalYear || '',
    CompanyCode: row.CompanyCode || '',
    SalesOrganization: row.SalesOrganization || '',
    DistributionChannel: row.DistributionChannel || '',
    Division: row.Division || '',
    TotalNetAmount: row.TotalNetAmount !== null && row.TotalNetAmount !== undefined ? Number(row.TotalNetAmount) : null,
    TaxAmount: row.TaxAmount !== null && row.TaxAmount !== undefined ? Number(row.TaxAmount) : null,
    TotalGrossAmount: row.TotalGrossAmount !== null && row.TotalGrossAmount !== undefined ? Number(row.TotalGrossAmount) : null,
    TransactionCurrency: row.TransactionCurrency || row.Currency || '',
    BillingDocumentDate: _parseODataV2Date(row.BillingDocumentDate),
    BillingDocumentIsCancelled: Boolean(row.BillingDocumentIsCancelled),
    CancelledBillingDocument: row.CancelledBillingDocument || ''
  };
}

class CustomerInvoiceAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.servicePath = options.servicePath || SERVICE_PATH;
  }

  /**
   * Queries customer billing documents from C_BillingDocument_F0797.
   *
   * @param {Object} [query] - Query options (top, skip, filter, orderby)
   * @param {Object} [options] - Transport options
   * @returns {Promise<{ results: Array<Object>, count: number }>}
   */
  async getBillingDocuments(query = {}, options = {}) {
    const params = [];
    if (query.top !== undefined && query.top !== null) params.push(`$top=${Number(query.top)}`);
    if (query.skip !== undefined && query.skip !== null) params.push(`$skip=${Number(query.skip)}`);
    if (query.filter) params.push(`$filter=${encodeURIComponent(query.filter)}`);
    if (query.orderby) params.push(`$orderby=${encodeURIComponent(query.orderby)}`);
    params.push('$inlinecount=allpages');

    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    const url = `${this.servicePath}/${ENTITY_SET}${qs}`;
    LOG.info(`Fetching customer invoices: GET ${url}`);

    let res;
    try {
      res = await this.client.get(url, options);
    } catch (err) {
      throw mapS4Error(err, 'getBillingDocuments');
    }

    const d = res.data?.d || {};
    const rows = d.results || (Array.isArray(d) ? d : []);
    const count = d.__count !== undefined ? parseInt(d.__count, 10) : rows.length;
    const formatted = rows.map(_formatInvoiceRow).filter(Boolean);

    return {
      results: formatted,
      count: isNaN(count) ? formatted.length : count
    };
  }

  /**
   * Retrieves single billing document by document number.
   *
   * @param {string} billingDocument
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async getBillingDocument(billingDocument, options = {}) {
    const doc = String(billingDocument || '').trim();
    if (!doc) {
      const err = new Error('BillingDocument is required.');
      err.status = 400;
      throw err;
    }
    const url = `${this.servicePath}/${ENTITY_SET}('${doc}')`;
    LOG.info(`Fetching billing document details: GET ${url}`);

    let res;
    try {
      res = await this.client.get(url, options);
    } catch (err) {
      throw mapS4Error(err, 'getBillingDocument');
    }

    const d = res.data?.d || {};
    return _formatInvoiceRow(d);
  }

  /**
   * Releases a billing document to Financial Accounting via PostBillingDocumentToAccounting.
   * On success, reads back the updated document to confirm the generated AccountingDocument and FiscalYear.
   *
   * @param {Object} payload
   * @param {string} payload.billingDocument
   * @param {string} [payload.sdDocumentCategory='M']
   * @param {Object} [options]
   * @returns {Promise<{ BillingDocument: string, AccountingDocument: string, FiscalYear: string, AccountingTransferStatus: string, Success: boolean, Message: string }>}
   */
  async postBillingDocumentToAccounting({ billingDocument, sdDocumentCategory = DEFAULT_SD_CATEGORY }, options = {}) {
    const doc = String(billingDocument || '').trim();
    const cat = String(sdDocumentCategory || DEFAULT_SD_CATEGORY).trim();
    if (!doc) {
      const err = new Error('BillingDocument is required to post to accounting.');
      err.status = 400;
      throw err;
    }

    const url = `${this.servicePath}/PostBillingDocumentToAccounting?BillingDocument=${odataString(doc)}&SDDocumentCategory=${odataString(cat)}`;
    LOG.info(`Releasing billing document to accounting: POST ${url}`);

    let res;
    try {
      res = await this.client.post(url, { data: {}, ...options });
    } catch (err) {
      throw mapS4Error(err, 'postBillingDocumentToAccounting');
    }

    // Direct readback from SAP to confirm generated Accounting Document number
    let acctDoc = '';
    let fiscalYear = '';
    let transferStatus = 'C';
    try {
      const updated = await this.getBillingDocument(doc, options);
      if (updated) {
        acctDoc = updated.AccountingDocument || '';
        fiscalYear = updated.FiscalYear || '';
        transferStatus = updated.AccountingTransferStatus || 'C';
      }
    } catch (readErr) {
      LOG.warn(`Readback of billing document ${doc} after accounting release encountered non-critical issue: ${readErr.message}`);
    }

    const rows = res.data?.d?.results || res.data?.d || [];
    const results = Array.isArray(rows) ? rows : [rows];
    const msgObj = results.find(r => r && (r.Message || r.MessageType)) || {};

    return {
      BillingDocument: doc,
      AccountingDocument: acctDoc,
      FiscalYear: fiscalYear,
      AccountingTransferStatus: transferStatus,
      Success: true,
      Message: msgObj.Message || (acctDoc ? `Transferred to Accounting. Document: ${acctDoc}` : 'Successfully released to accounting.')
    };
  }

  /**
   * Cancels a billing document via CancelBillingDocument.
   * SAP generates an official reversal document (e.g. Type S1) and returns FunctionImportResult.
   *
   * @param {Object} payload
   * @param {string} payload.billingDocument
   * @param {string} [payload.sdDocumentCategory='M']
   * @param {Object} [options]
   * @returns {Promise<{ BillingDocument: string, CancellationDocument: string, Success: boolean, Message: string }>}
   */
  async cancelBillingDocument({ billingDocument, sdDocumentCategory = DEFAULT_SD_CATEGORY }, options = {}) {
    const doc = String(billingDocument || '').trim();
    const cat = String(sdDocumentCategory || DEFAULT_SD_CATEGORY).trim();
    if (!doc) {
      const err = new Error('BillingDocument is required to cancel billing document.');
      err.status = 400;
      throw err;
    }

    const url = `${this.servicePath}/CancelBillingDocument?BillingDocument=${odataString(doc)}&SDDocumentCategory=${odataString(cat)}`;
    LOG.info(`Cancelling billing document: POST ${url}`);

    let res;
    try {
      res = await this.client.post(url, { data: {}, ...options });
    } catch (err) {
      throw mapS4Error(err, 'cancelBillingDocument');
    }

    const rows = res.data?.d?.results || res.data?.d || [];
    const results = Array.isArray(rows) ? rows : [rows];
    const item = results.find(r => r && r.BillingDocument) || results[0] || {};
    const cancelDoc = String(item.BillingDocument || '').trim();

    return {
      BillingDocument: doc,
      CancellationDocument: cancelDoc,
      Success: true,
      Message: item.Message || (cancelDoc ? `Cancellation document ${cancelDoc} saved.` : 'Billing document successfully cancelled.')
    };
  }
}

module.exports = new CustomerInvoiceAdapter();
module.exports.CustomerInvoiceAdapter = CustomerInvoiceAdapter;
module.exports._formatInvoiceRow = _formatInvoiceRow;
module.exports._parseODataV2Date = _parseODataV2Date;
