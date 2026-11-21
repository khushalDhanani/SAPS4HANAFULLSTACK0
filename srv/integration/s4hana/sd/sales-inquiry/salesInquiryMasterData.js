const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const businessConfigResolver = require('../../../../common/BusinessConfigResolver');

/**
 * SalesInquiryAdapter methods: creation defaults and RFC master data (payment terms, contact persons).
 * Mixed into SalesInquiryAdapter.prototype; `this` is the adapter instance.
 */
module.exports = {
  /**
   * Retrieves standard default parameters for Sales Inquiry VA11 creation.
   */
  async getSalesInquiryDefaults(context = {}) {
    const today = new Date().toISOString().split('T')[0];
    const plant = (context && context.plant) || '1120';
    let cfg = {};
    try {
      cfg = await (this.resolver || businessConfigResolver).resolve({
        plant,
        flow: 'sd',
        fields: ['salesOrganization', 'distributionChannel', 'division', 'currency', 'inquiryType'],
        isTrusted: true
      });
    } catch (_) {
      cfg = {
        inquiryType: 'ZIN',
        salesOrganization: '1000',
        distributionChannel: '10',
        division: '52',
        currency: 'INR'
      };
    }
    return {
      SalesInquiryType: cfg.inquiryType || 'ZIN',
      SalesOrganization: cfg.salesOrganization || '1000',
      DistributionChannel: cfg.distributionChannel || '10',
      OrganizationDivision: cfg.division || '52',
      SalesInquiryDate: today,
      BindingPeriodValidityStartDate: today,
      BindingPeriodValidityEndDate: today,
      TransactionCurrency: cfg.currency || 'INR',
      derived: true
    };
  },

  /**
   * Reads a whole SAP table via RFC_READ_TABLE (no row cap); the CAP value-help handler applies the
   * OData $filter in memory. Fails with 503 when RFC is unavailable: no local list is ever substituted.
   */
  async _readTableOrFail(table, fields, where = []) {
    try {
      return await this.rfc.readTable(table, fields, where, 0);
    } catch (err) {
      LOG.warn(`RFC readTable ${table} failed:`, err.message);
      const e = new Error(`SAP table ${table} could not be read via RFC: ${err.message}`);
      e.status = err.status || 503;
      throw e;
    }
  },

  /**
   * Payment terms with English texts from SAP table T052U, cached for 5 minutes.
   *
   * @returns {Promise<Array<{ PaymentTerms: string, PaymentTermsName: string }>>}
   */
  async getPaymentTerms(_query) {
    const cached = this.masterDataCache.get('paymentTerms');
    if (cached) return cached;
    const rows = await this._readTableOrFail('T052U', ['ZTERM', 'TEXT1'], ["SPRAS = 'E'"]);
    const terms = rows.map((r) => ({
      PaymentTerms: r.ZTERM ? r.ZTERM.trim() : '',
      PaymentTermsName: r.TEXT1 ? r.TEXT1.trim() : (r.ZTERM ? r.ZTERM.trim() : '')
    })).filter((r) => r.PaymentTerms);
    this.masterDataCache.set('paymentTerms', terms);
    return terms;
  },

  /**
   * Contact persons from SAP table KNVK, cached for 5 minutes per customer. A `Customer eq` filter is
   * pushed to SAP; any other filter (name search) is applied in memory by the value-help handler.
   * `Customer` is returned without leading zeros, as the rest of the application shows customers.
   */
  async getContactPersons(query) {
    let sCustomer = '';
    const where = query?.SELECT?.where;
    if (Array.isArray(where)) {
      for (let i = 0; i < where.length; i++) {
        const item = where[i];
        if (item && ((item.ref && item.ref[0] === 'Customer') || item === 'Customer')) {
          if (where[i + 2] && where[i + 2].val !== undefined) {
            sCustomer = String(where[i + 2].val).trim();
          }
        }
      }
    }
    const sCustPadded = sCustomer ? sCustomer.padStart(10, '0') : '';
    const cacheKey = `contacts:${sCustPadded || '*'}`;
    const cached = this.masterDataCache.get(cacheKey);
    if (cached) return cached;

    const rows = await this._readTableOrFail(
      'KNVK',
      ['PARNR', 'KUNNR', 'NAME1', 'NAMEV', 'TELF1'],
      sCustPadded ? [`KUNNR = '${sCustPadded}'`] : []
    );
    const noZeros = (v) => String(v || '').trim().replace(/^0+/, '');
    const contacts = rows.map((r) => {
      const first = r.NAMEV ? r.NAMEV.trim() : '';
      const last = r.NAME1 ? r.NAME1.trim() : '';
      return {
        ContactPerson: r.PARNR ? r.PARNR.trim() : '',
        Customer: noZeros(r.KUNNR),
        FirstName: first,
        LastName: last,
        FullName: [first, last].filter(Boolean).join(' ') || last,
        PhoneNumber: r.TELF1 ? r.TELF1.trim() : ''
      };
    }).filter((c) => c.ContactPerson);
    this.masterDataCache.set(cacheKey, contacts);
    return contacts;
  }
};
