const { CustomerInvoiceAdapter, _formatInvoiceRow, _parseODataV2Date } = require('../../../srv/integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter');

describe('Unit: CustomerInvoiceAdapter', () => {
  let adapter;
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };
    adapter = new CustomerInvoiceAdapter({ client: mockHttpClient });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Helper: _parseODataV2Date', () => {
    test('parses /Date(ms)/ format correctly', () => {
      const ms = 1790121600000;
      const res = _parseODataV2Date(`/Date(${ms})/`);
      expect(res).toBe(new Date(ms).toISOString().slice(0, 10));
    });

    test('returns null for empty/null date', () => {
      expect(_parseODataV2Date(null)).toBeNull();
      expect(_parseODataV2Date('')).toBeNull();
    });

    test('formats Date instance', () => {
      const d = new Date('2026-09-23T12:00:00Z');
      expect(_parseODataV2Date(d)).toBe('2026-09-23');
    });
  });

  describe('Helper: _formatInvoiceRow', () => {
    test('normalizes raw SAP C_BillingDocument_F0797 row', () => {
      const raw = {
        BillingDocument: '31000111',
        BillingDocumentType: 'ZDOM',
        BillingDocumentTypeName: 'Domestic Billing',
        SoldToParty: '10358',
        SoldToPartyFullName: 'R L Fine Chem Pvt Ltd',
        SDDocumentCategory: 'M',
        AccountingTransferStatus: 'C',
        AccountingDocument: '9000000100',
        FiscalYear: '2026',
        CompanyCode: '1000',
        TotalNetAmount: '187500.00',
        TaxAmount: '33750.00',
        TotalGrossAmount: '221250.00',
        TransactionCurrency: 'INR',
        BillingDocumentDate: '/Date(1790121600000)/',
        BillingDocumentIsCancelled: false,
        CancelledBillingDocument: ''
      };

      const res = _formatInvoiceRow(raw);
      expect(res.BillingDocument).toBe('31000111');
      expect(res.BillingDocumentType).toBe('ZDOM');
      expect(res.AccountingDocument).toBe('9000000100');
      expect(res.AccountingTransferStatus).toBe('C');
      expect(res.TotalNetAmount).toBe(187500.00);
      expect(res.TotalGrossAmount).toBe(221250.00);
      expect(res.BillingDocumentIsCancelled).toBe(false);
    });

    test('returns null when row is null or undefined', () => {
      expect(_formatInvoiceRow(null)).toBeNull();
    });
  });

  describe('getBillingDocuments', () => {
    test('calls SAP Gateway with pagination and filters', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            __count: '2',
            results: [
              { BillingDocument: '31000111', TotalNetAmount: '100' },
              { BillingDocument: '31000112', TotalNetAmount: '200' }
            ]
          }
        }
      });

      const query = {
        top: 10,
        skip: 0,
        filter: "SoldToParty eq '10358'",
        orderby: 'BillingDocument desc'
      };

      const res = await adapter.getBillingDocuments(query);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      const calledUrl = mockHttpClient.get.mock.calls[0][0];
      expect(calledUrl).toContain('/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/C_BillingDocument_F0797?');
      expect(calledUrl).toContain('$top=10');
      expect(calledUrl).toContain('$skip=0');
      expect(calledUrl).toContain('$inlinecount=allpages');
      expect(res.count).toBe(2);
      expect(res.results).toHaveLength(2);
      expect(res.results[0].BillingDocument).toBe('31000111');
    });
  });

  describe('getBillingDocument', () => {
    test('fetches single document by key', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '31000111',
            BillingDocumentType: 'ZDOM',
            AccountingDocument: '9000000100'
          }
        }
      });

      const res = await adapter.getBillingDocument('31000111');
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/C_BillingDocument_F0797('31000111')",
        {}
      );
      expect(res.BillingDocument).toBe('31000111');
      expect(res.AccountingDocument).toBe('9000000100');
    });

    test('throws 400 when billingDocument is missing', async () => {
      await expect(adapter.getBillingDocument('')).rejects.toThrow('BillingDocument is required.');
    });
  });

  describe('postBillingDocumentToAccounting', () => {
    test('executes POST and confirms accounting document via readback', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          d: {
            results: []
          }
        }
      });

      // Mock readback
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '31000111',
            AccountingDocument: '9000000100',
            FiscalYear: '2026',
            AccountingTransferStatus: 'C'
          }
        }
      });

      const res = await adapter.postBillingDocumentToAccounting({ billingDocument: '31000111' });

      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      const postUrl = mockHttpClient.post.mock.calls[0][0];
      expect(postUrl).toBe("/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/PostBillingDocumentToAccounting?BillingDocument='31000111'&SDDocumentCategory='M'");

      expect(res.BillingDocument).toBe('31000111');
      expect(res.AccountingDocument).toBe('9000000100');
      expect(res.FiscalYear).toBe('2026');
      expect(res.AccountingTransferStatus).toBe('C');
      expect(res.Success).toBe(true);
    });

    test('throws 400 when billing document is empty', async () => {
      await expect(adapter.postBillingDocumentToAccounting({ billingDocument: '' }))
        .rejects.toThrow('BillingDocument is required to post to accounting.');
    });

    test('sanitizes CAP request object so browser headers are not passed to S4HttpClient', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { d: { results: [{ Message: 'Document 31000111 has been saved.' }] } }
      });
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '31000111',
            AccountingDocument: '9000000100',
            FiscalYear: '2026',
            AccountingTransferStatus: 'C'
          }
        }
      });

      const fakeCapReq = {
        data: { BillingDocument: '31000111' },
        headers: { 'x-csrf-token': 'browser-cap-token', cookie: 'local-session=1' },
        reject: jest.fn()
      };

      await adapter.postBillingDocumentToAccounting({ billingDocument: '31000111' }, fakeCapReq);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      const passedOptions = mockHttpClient.post.mock.calls[0][1];
      expect(passedOptions.headers).toBeUndefined();
    });

    test('throws 400 when SAP returns MessageType E in FunctionImportResult', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          d: {
            results: [{
              BillingDocument: '30000029',
              MessageType: 'E',
              Message: 'Payment term AT03 not defined'
            }]
          }
        }
      });

      await expect(adapter.postBillingDocumentToAccounting({ billingDocument: '30000029' }))
        .rejects.toThrow('Payment term AT03 not defined');
    });

    test('throws 400 when readback indicates document is Pro Forma (Status D)', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { d: { results: [{ Message: 'Document 34000001 has been saved.' }] } }
      });
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '34000001',
            AccountingDocument: '',
            AccountingTransferStatus: 'D'
          }
        }
      });

      await expect(adapter.postBillingDocumentToAccounting({ billingDocument: '34000001' }))
        .rejects.toThrow(/Pro Forma invoice/);
    });

    test('throws 400 when readback indicates document is cancelled (Status E)', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { d: { results: [] } }
      });
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '90000017',
            AccountingDocument: '',
            AccountingTransferStatus: 'E'
          }
        }
      });

      await expect(adapter.postBillingDocumentToAccounting({ billingDocument: '90000017' }))
        .rejects.toThrow(/cancelled \(Status E\)/);
    });

    test('maps SAP ASSERTION_FAILED HTTP 500 error to friendly 400 business error', async () => {
      mockHttpClient.post.mockRejectedValue(
        new Error("S/4HANA POST ... failed: HTTP 500 - <code>ASSERTION_FAILED</code><message>Runtime Error: 'ASSERTION_FAILED'</message>")
      );

      await expect(adapter.postBillingDocumentToAccounting({ billingDocument: '31000055' }))
        .rejects.toThrow(/Posting Block \(Status A\)/);
    });

    test('enhances account determination error when SAP returns saved with error in account determination', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          d: {
            results: [{
              BillingDocument: '600000000',
              MessageType: 'E',
              Message: 'Document 600000000 saved (error in account determination).'
            }]
          }
        }
      });

      await expect(adapter.postBillingDocumentToAccounting({ billingDocument: '600000000' }))
        .rejects.toThrow(/table VKOA/);
    });
  });

  describe('cancelBillingDocument', () => {
    test('executes POST and confirms cancellation and reversal document number via readback', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          d: {
            results: [
              {
                BillingDocument: '90000053',
                MessageId: '311',
                MessageType: 'S',
                Message: 'Document 90000053 has been saved.'
              }
            ]
          }
        }
      });
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '31000112',
            BillingDocumentIsCancelled: true,
            AccountingTransferStatus: 'E',
            CancelledBillingDocument: '90000053'
          }
        }
      });

      const res = await adapter.cancelBillingDocument({ billingDocument: '31000112' });

      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      const postUrl = mockHttpClient.post.mock.calls[0][0];
      expect(postUrl).toBe("/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/CancelBillingDocument?BillingDocument='31000112'&SDDocumentCategory='M'");

      expect(res.BillingDocument).toBe('31000112');
      expect(res.CancellationDocument).toBe('90000053');
      expect(res.BillingDocumentIsCancelled).toBe(true);
      expect(res.AccountingTransferStatus).toBe('E');
      expect(res.Success).toBe(true);
      expect(res.Message).toContain('90000053');
    });

    test('throws 400 when billing document is missing', async () => {
      await expect(adapter.cancelBillingDocument({ billingDocument: '' }))
        .rejects.toThrow('BillingDocument is required to cancel billing document.');
    });
  });
});
