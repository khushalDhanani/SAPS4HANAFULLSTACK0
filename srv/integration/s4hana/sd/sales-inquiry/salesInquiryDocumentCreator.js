const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const { SalesInquiryRfcCreator, BAPI: INQUIRY_BAPI, UNSUPPORTED_HEADER_FIELDS } = require('./SalesInquiryRfcCreator');
const { LEAN_ORDER_PATH } = require('./salesInquiryODataHelper');
const { createSalesOrderDocument } = require('./SalesOrderDocumentCreator');

async function createSalesDocument(adapter, docType, header, items, options = {}) {
  const effectiveDocType = String(docType || header.SalesOrderType || header.SalesInquiryType || '').trim();
  if (!effectiveDocType) {
    throw new Error('Document Type is required for Sales Document creation');
  }
  // Inquiries are created only through BAPI_INQUIRY_CREATEFROMDATA2 (createSalesInquiryViaRfc), which reads the
  // document back from SAP. The order path must not create one.
  if (effectiveDocType.toUpperCase() === 'ZIN') {
    throw Object.assign(
      new Error('Document type ZIN is a Sales Inquiry and cannot be created as a Sales Order. Create it on the Sales Inquiry screen.'),
      { status: 400 }
    );
  }
  return createSalesOrderDocument(adapter, effectiveDocType, header, items, options);
}

async function createSalesInquiryViaRfc(adapter, header, items, options = {}) {
  const creator = options.creator || new SalesInquiryRfcCreator({ rfc: adapter.rfc });
  const result = await creator.create(header, items, { testRun: options.testRun === true });
  if (result.testRun) return result;
  const stored = await creator.readBack(result.SalesInquiry);
  if (!stored) {
    throw Object.assign(new Error(`SAP committed inquiry ${result.SalesInquiry}, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.`),
      { status: 502, SalesInquiry: result.SalesInquiry, name: 'PartialSalesInquiryError', $sanitize: false });
  }
  return result;
}

async function _getLeanOrderFields(adapter, destination, executeFn = adapter.client._execute) {
  if (adapter._leanOrderFields) return adapter._leanOrderFields;
  const empty = { header: new Set(), item: new Set(), partner: new Set() };
  try {
    const res = await executeFn(destination, {
      method: 'get',
      url: `${LEAN_ORDER_PATH}/$metadata`,
      headers: { 'Accept': 'application/xml, text/xml' }
    }, { fetchCsrfToken: false });
    const xml = typeof res?.data === 'string' ? res.data : '';
    const props = (name) => {
      const m = xml.match(new RegExp(`<EntityType Name="${name}"[\\s\\S]*?</EntityType>`));
      return new Set(m ? [...m[0].matchAll(/<Property Name="([^"]+)"/g)].map(x => x[1]) : []);
    };
    const fields = { header: props('Header'), item: props('Item'), partner: props('HeaderPartner') };
    if (fields.header.size === 0) {
      LOG.warn('LORD_ODATA_ORDER_SRV $metadata returned no Header properties; capabilities unknown.');
      return empty;
    }
    adapter._leanOrderFields = fields;
    return fields;
  } catch (err) {
    LOG.warn('Could not read LORD_ODATA_ORDER_SRV $metadata:', err.message);
    return empty;
  }
}

function getInquiryCreationCapabilities() {
  const caps = { service: INQUIRY_BAPI, Plant: true };
  for (const f of ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson']) caps[f] = !UNSUPPORTED_HEADER_FIELDS.includes(f);
  return caps;
}

module.exports = {
  createSalesDocument,
  createSalesInquiryViaRfc,
  _getLeanOrderFields,
  getInquiryCreationCapabilities
};
