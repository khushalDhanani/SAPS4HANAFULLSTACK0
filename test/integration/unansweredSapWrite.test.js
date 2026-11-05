'use strict';

/**
 * Integration: a write that got no answer from SAP, in production mode, where CAP hides 5xx text unless the error opts out.
 * Real CAP HTTP, handlers and adapters; only SAP is doubled. SAP may have saved such a write, so the user must be told to check.
 */

const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { axios } = cdsTest;
const returnAdapter = require('../../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');
const inquiryAdapter = require('../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const { unansweredWrite } = require('../../srv/integration/s4hana/S4HttpClient');

const WARNING = 'SAP did not answer this request, so the result is NOT confirmed: it may have been saved. Check it in SAP before trying again.';
const NO_ANSWER = [
  ['a timeout', () => Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })],
  ['a dropped connection', () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
  ['a gateway 504', () => Object.assign(new Error('Request failed with status code 504'), { response: { status: 504, data: 'Gateway Timeout', headers: {} } })],
  ['a gateway 502', () => Object.assign(new Error('Request failed with status code 502'), { response: { status: 502, data: 'Bad Gateway', headers: {} } })]
];
const WRITES = [
  ['invoice release', '/odata/v4/customer-invoice/releaseInvoiceToAccounting', { BillingDocument: '31000112' }],
  ['invoice cancel', '/odata/v4/customer-invoice/cancelBillingDocument', { BillingDocument: '31000112' }],
  ['customer return', '/odata/v4/customer-return/createCustomerReturn', {
    SoldToParty: '10082', ReturnsOrderReason: '101', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52',
    Items: [{ Material: '4000000001', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }]
  }],
  ['delivery from order', '/odata/v4/outbound-delivery/createOutboundDelivery', { SalesOrder: '5000104', ShippingPoint: 'WAVG' }],
  ['delivery without reference', '/odata/v4/outbound-delivery/createDeliveryWithoutRef', {
    ShippingPoint: '1104', DeliveryDocumentType: 'LO2', SalesOrganization: '1000', DistributionChannel: '10', Division: '52', ShipToParty: '1',
    Plant: '1120', StorageLocation: 'FG01', PlannedGoodsIssueDate: '2026-10-27', Items: [{ Material: 'E2E', ActualDeliveryQuantity: 1, DeliveryQuantityUnit: 'KG' }]
  }],
  ['goods issue', '/odata/v4/outbound-delivery/postGoodsIssue', { DeliveryDocument: '80000001' }],
  ['billing', '/odata/v4/outbound-delivery/createBillingDocument', { DeliveryDocument: '80000001', BillingDocumentType: 'F2' }],
  ['packing instruction', '/odata/v4/packing-instruction/create', {
    externalName: 'BOX1', weightUnit: 'KG', components: [{ item: '10', category: 'P', material: '2000000041', targetQty: 1, unit: 'NOS' }]
  }]
];
const ORDER = {
  header: { SalesOrderType: 'ZDOM', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52', SoldToParty: '10135', TransactionCurrency: 'INR' },
  items: [{ SalesOrderItem: '000010', Material: '4000000091', OrderQuantity: 10, OrderQuantityUnit: 'KG', Plant: '1120', NetPriceAmount: 250 }]
};
const send = (path, body) => axios.post(path, body, { validateStatus: () => true });

function stubSap({ post }) {
  jest.spyOn(connectivity, 'getDestination').mockResolvedValue({ url: 'https://s4.example.test', sapClient: '220' });
  const posts = [];
  jest.spyOn(httpClient, 'executeHttpRequest').mockImplementation(async (_d, config) => {
    if (config.headers && config.headers['x-csrf-token'] === 'Fetch') return { status: 200, data: {}, headers: { 'x-csrf-token': 'T' } };
    if (config.method === 'get') {
      return { status: 200, headers: {}, data: { d: { BillingDocument: '31000112', BillingDocumentIsCancelled: false, AccountingTransferStatus: '', SDDocumentCategory: 'M', results: [] } } };
    }
    posts.push(config);
    return post();
  });
  return posts;
}

describe('Integration: a write SAP did not answer (production mode)', () => {
  const original = { env: process.env.NODE_ENV, rfc: returnAdapter.rfc };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    returnAdapter.rfc = {
      readTable: async (table) => {
        if (table === 'KNVV') return [{ VKORG: '1000', VTWEG: '10', SPART: '52', LOEVM: '' }];
        return table === 'T001W' ? [{ WERKS: '1110' }] : [];
      }
    };
  });
  afterEach(() => {
    process.env.NODE_ENV = original.env;
    returnAdapter.rfc = original.rfc;
    jest.restoreAllMocks();
  });

  describe.each(WRITES)('%s', (_name, path, body) => {
    it.each(NO_ANSWER)('warns after %s, and posts once', async (_kind, make) => {
      const posts = stubSap({ post: () => { throw make(); } });

      const res = await send(path, body);

      expect(res.status).toBe(504);
      expect(res.data.error.message).toBe(WARNING);
      expect(posts).toHaveLength(1);
    });

    it('does not warn when the connection was refused, because nothing reached SAP', async () => {
      stubSap({ post: () => { throw Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }); } });

      const res = await send(path, body);

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.data.error.message).not.toBe(WARNING);
    });

    it('does not warn when SAP answered with a refusal', async () => {
      stubSap({ post: () => { throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { error: { message: { value: 'SAP says no' } } }, headers: {} } }); } });

      const res = await send(path, body);

      expect(res.status).toBeLessThan(500);
      expect(res.data.error.message).not.toBe(WARNING);
    });
  });

  describe('sales order', () => {
    it('keeps the code and text the screen needs when the order is already in SAP', async () => {
      const message = 'Sales Order 5000999 was created in SAP S/4HANA, but the read-back check failed. Do not create it again.';
      jest.spyOn(inquiryAdapter, 'createSalesDocument').mockRejectedValue(Object.assign(new Error(message), { status: 502, SalesOrder: '5000999' }));

      const res = await send('/odata/v4/sales-order/createSalesOrder', ORDER);

      expect(res.status).toBe(502);
      expect(res.data.error).toMatchObject({ code: 'SALES_ORDER_CREATED_VERIFICATION_FAILED', message });
    });

    it('warns when SAP did not answer the create', async () => {
      jest.spyOn(inquiryAdapter, 'createSalesDocument').mockRejectedValue(unansweredWrite(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })));

      const res = await send('/odata/v4/sales-order/createSalesOrder', ORDER);

      expect(res.status).toBe(504);
      expect(res.data.error.message).toBe(WARNING);
    });

    it.each(NO_ANSWER)('warns when the real header POST gets %s, and posts once', async (_kind, make) => {
      const posts = stubSap({ post: () => { throw make(); } });

      const res = await send('/odata/v4/sales-order/createSalesOrder', ORDER);

      expect(res.data.error.message).toBe(WARNING);
      expect(res.status).toBe(504);
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain('/HeaderSet');
    });

    it('does not warn when SAP refused the real header POST', async () => {
      stubSap({ post: () => { throw Object.assign(new Error('refused'), { response: { status: 400, data: { error: { message: { value: 'Material is blocked' } } }, headers: {} } }); } });

      const res = await send('/odata/v4/sales-order/createSalesOrder', ORDER);

      expect(res.status).toBe(400);
      expect(res.data.error.message).not.toBe(WARNING);
    });

    it('still hides the text of an ordinary failure', async () => {
      jest.spyOn(inquiryAdapter, 'createSalesDocument').mockRejectedValue(Object.assign(new Error('internal detail'), { status: 500 }));

      const res = await send('/odata/v4/sales-order/createSalesOrder', ORDER);

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.data)).not.toContain('internal detail');
    });
  });
});
