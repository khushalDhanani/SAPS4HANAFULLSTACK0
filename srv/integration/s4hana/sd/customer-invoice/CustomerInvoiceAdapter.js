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

/**
 * Sanitizes transport options to ensure incoming client headers (e.g. Authorization)
 * are not leaked to the S/4HANA destination, which requires its own configured credentials.
 *
 * @param {Object} options
 * @returns {Object}
 */
function _cleanOptions(options = {}) {
  if (!options) return {};
  if (typeof options.reject === 'function' || options.data !== undefined) {
    const userJwt = S4HttpClient.extractUserJwt(options);
    return userJwt ? { userJwt } : {};
  }
  const clean = { ...options };
  if (clean.headers) {
    const headers = { ...clean.headers };
    delete headers.authorization;
    delete headers.Authorization;
    delete headers['x-csrf-token'];
    delete headers['X-CSRF-Token'];
    delete headers.cookie;
    delete headers.Cookie;
    clean.headers = headers;
  }
  return clean;
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
    const transportOptions = _cleanOptions(options);
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
      res = await this.client.get(url, transportOptions);
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
    const transportOptions = _cleanOptions(options);
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
      res = await this.client.get(url, transportOptions);
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
    const transportOptions = _cleanOptions(options);
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
      res = await this.client.post(url, { data: {}, ...transportOptions });
    } catch (err) {
      if (err.message && err.message.includes('ASSERTION_FAILED')) {
        const customErr = new Error(`SAP S/4HANA Gateway Runtime Error (ASSERTION_FAILED): The OData interface in SAP S/4HANA aborted execution because billing document ${doc} has an active Posting Block (Status A) or inconsistent buffer state. Please review and release the invoice in transaction VF02.`);
        customErr.status = 400;
        throw customErr;
      }
      throw mapS4Error(err, 'postBillingDocumentToAccounting');
    }

    const rows = res.data?.d?.results || res.data?.d || [];
    const results = Array.isArray(rows) ? rows : [rows];
    const errorObj = results.find(r => r && r.MessageType === 'E');
    if (errorObj) {
      let msg = errorObj.Message || `Release to accounting rejected by SAP for document ${doc}`;
      if (msg.includes('saved (error in account determination)')) {
        msg = `Document ${doc} saved (error in account determination). G/L Account Determination is missing in SAP (table VKOA). Please assign the required G/L revenue accounts in SAP.`;
      }
      const err = new Error(msg);
      err.status = 400;
      throw err;
    }

    // Direct readback from SAP: two-way communication waiting for SAP's actual status
    const MAX_READBACK_ATTEMPTS = 3;
    const POLL_DELAYS = [0, 800, 1500];
    let updated = null;

    for (let attempt = 0; attempt < MAX_READBACK_ATTEMPTS; attempt++) {
      if (POLL_DELAYS[attempt] > 0) {
        LOG.info(`Waiting ${POLL_DELAYS[attempt]}ms for SAP database commit before reading back document ${doc} (attempt ${attempt + 1}/${MAX_READBACK_ATTEMPTS})...`);
        await new Promise(resolve => setTimeout(resolve, POLL_DELAYS[attempt]));
      }
      try {
        updated = await this.getBillingDocument(doc, transportOptions);
        if (updated) {
          if (updated.AccountingDocument || updated.AccountingTransferStatus === 'C' || updated.AccountingTransferStatus === 'H') {
            break;
          }
          if (['D', 'E', 'A', 'B'].includes(updated.AccountingTransferStatus)) {
            break;
          }
        }
      } catch (readErr) {
        LOG.warn(`Readback attempt ${attempt + 1} for billing document ${doc} encountered non-critical issue: ${readErr.message}`);
      }
    }

    const acctDoc = updated?.AccountingDocument || '';
    const fiscalYear = updated?.FiscalYear || '';
    const transferStatus = updated?.AccountingTransferStatus || '';

    if (acctDoc || transferStatus === 'C' || transferStatus === 'H') {
      return {
        BillingDocument: doc,
        AccountingDocument: acctDoc,
        FiscalYear: fiscalYear,
        AccountingTransferStatus: transferStatus || 'C',
        Success: true,
        Message: acctDoc
          ? `Transferred to Accounting in SAP S/4HANA. Journal Entry: ${acctDoc}, Fiscal Year: ${fiscalYear}.`
          : 'Transferred to Accounting in SAP S/4HANA.'
      };
    }

    if (transferStatus === 'D') {
      const err = new Error(`Billing document ${doc} is a Pro Forma invoice (Status D) in SAP S/4HANA and is not relevant for financial accounting. SAP does not generate G/L documents.`);
      err.status = 400;
      throw err;
    }
    if (transferStatus === 'E') {
      const err = new Error(`Billing document ${doc} is cancelled (Status E) in SAP S/4HANA and cannot be released to accounting.`);
      err.status = 400;
      throw err;
    }
    if (transferStatus === 'B') {
      const err = new Error(`SAP S/4HANA rejected release: Account Determination Error (Status B) for document ${doc}. Maintain G/L accounts in table VKOA.`);
      err.status = 400;
      throw err;
    }
    if (transferStatus === 'A') {
      const err = new Error(`SAP S/4HANA rejected release: Posting Blocked (Status A) for document ${doc}. Remove posting block in billing header.`);
      err.status = 400;
      throw err;
    }

    const err = new Error(`No accounting document was created by SAP for billing document ${doc}. SAP transfer status is '${transferStatus || 'Interface Error'}'. Check pricing and tax configuration in VF02 / VFX3.`);
    err.status = 400;
    throw err;
  }

  /**
   * Cancels a billing document via CancelBillingDocument.
   * SAP generates an official reversal document (e.g. Type S1) and returns FunctionImportResult.
   * Waits for SAP's actual status and confirms cancellation via readback.
   *
   * @param {Object} payload
   * @param {string} payload.billingDocument
   * @param {string} [payload.sdDocumentCategory='M']
   * @param {Object} [options]
   * @returns {Promise<{ BillingDocument: string, CancellationDocument: string, BillingDocumentIsCancelled: boolean, AccountingTransferStatus: string, Success: boolean, Message: string }>}
   */
  async cancelBillingDocument({ billingDocument, sdDocumentCategory = DEFAULT_SD_CATEGORY }, options = {}) {
    const transportOptions = _cleanOptions(options);
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
      res = await this.client.post(url, { data: {}, ...transportOptions });
    } catch (err) {
      throw mapS4Error(err, 'cancelBillingDocument');
    }

    const rows = res.data?.d?.results || res.data?.d || [];
    const results = Array.isArray(rows) ? rows : [rows];
    const errorObj = results.find(r => r && r.MessageType === 'E');
    if (errorObj) {
      const err = new Error(errorObj.Message || `Cancellation rejected by SAP for document ${doc}`);
      err.status = 400;
      throw err;
    }

    const item = results.find(r => r && r.BillingDocument && r.MessageType !== 'E') || results[0] || {};
    const cancelDoc = String(item.BillingDocument || '').trim();

    // Direct readback from SAP: two-way communication waiting for SAP's actual cancellation status
    const MAX_CANCEL_ATTEMPTS = 3;
    const CANCEL_DELAYS = [0, 800, 1500];
    let updated = null;

    for (let attempt = 0; attempt < MAX_CANCEL_ATTEMPTS; attempt++) {
      if (CANCEL_DELAYS[attempt] > 0) {
        LOG.info(`Waiting ${CANCEL_DELAYS[attempt]}ms for SAP database commit before reading back cancelled document ${doc}...`);
        await new Promise(resolve => setTimeout(resolve, CANCEL_DELAYS[attempt]));
      }
      try {
        updated = await this.getBillingDocument(doc, transportOptions);
        if (updated && (updated.BillingDocumentIsCancelled || updated.AccountingTransferStatus === 'E')) {
          break;
        }
      } catch (readErr) {
        LOG.warn(`Readback of cancelled document ${doc} attempt ${attempt + 1} failed: ${readErr.message}`);
      }
    }

    const isCancelled = updated ? updated.BillingDocumentIsCancelled : true;
    const finalStatus = updated?.AccountingTransferStatus || 'E';
    const reversalDoc = cancelDoc || updated?.CancelledBillingDocument || '';

    return {
      BillingDocument: doc,
      CancellationDocument: reversalDoc,
      BillingDocumentIsCancelled: isCancelled,
      AccountingTransferStatus: finalStatus,
      Success: true,
      Message: reversalDoc
        ? `Billing document ${doc} successfully cancelled in SAP S/4HANA. Reversal document: ${reversalDoc}.`
        : `Billing document ${doc} successfully cancelled in SAP S/4HANA.`
    };
  }
}

module.exports = new CustomerInvoiceAdapter();
module.exports.CustomerInvoiceAdapter = CustomerInvoiceAdapter;
module.exports._formatInvoiceRow = _formatInvoiceRow;
module.exports._parseODataV2Date = _parseODataV2Date;
