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
    // Row and count shape are hand-written; C_BillingDocument_F0797 metadata is not in the repo, so the SAP shape is not proven.
    const twoRows = {
      data: {
        d: {
          __count: '2',
          results: [
            { BillingDocument: '31000111', TotalNetAmount: '100' },
            { BillingDocument: '31000112', TotalNetAmount: '200' }
          ]
        }
      }
    };

    test('builds the exact URL from paging, encoded filter and encoded order', async () => {
      mockHttpClient.get.mockResolvedValue(twoRows);

      await adapter.getBillingDocuments({ top: 10, skip: 0, filter: "SoldToParty eq '10358'", orderby: 'BillingDocument desc' });

      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get.mock.calls[0][0]).toBe(
        "/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/C_BillingDocument_F0797?$top=10&$skip=0&$filter=SoldToParty%20eq%20'10358'&$orderby=BillingDocument%20desc&$inlinecount=allpages"
      );
    });

    test('returns the mapped rows and the inline count', async () => {
      mockHttpClient.get.mockResolvedValue(twoRows);

      const res = await adapter.getBillingDocuments({});

      expect(res.count).toBe(2);
      expect(res.results.map((r) => [r.BillingDocument, r.TotalNetAmount])).toEqual([['31000111', 100], ['31000112', 200]]);
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

    test('preserves and propagates If-Match header from CAP request to S4HttpClient', async () => {
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
        headers: { 'if-match': 'W/"2026-10-28T10:00:00Z"' },
        reject: jest.fn()
      };

      await adapter.postBillingDocumentToAccounting({ billingDocument: '31000111' }, fakeCapReq);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      const passedOptions = mockHttpClient.post.mock.calls[0][1];
      expect(passedOptions.headers['If-Match']).toBe('W/"2026-10-28T10:00:00Z"');
    });

    test('preserves and propagates If-Match header from nested Express req.headers', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { d: { results: [{ BillingDocument: '31000111', MessageType: 'S', Message: 'Success' }] } }
      });
      mockHttpClient.get.mockResolvedValue({
        data: {
          d: {
            BillingDocument: '31000111',
            AccountingDocument: '9000000101',
            FiscalYear: '2026',
            AccountingTransferStatus: 'C'
          }
        }
      });

      const fakeCapReq = {
        data: { BillingDocument: '31000111' },
        req: { headers: { 'If-Match': 'W/"express-nested-etag"' } },
        reject: jest.fn()
      };

      await adapter.postBillingDocumentToAccounting({ billingDocument: '31000111' }, fakeCapReq);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      const passedOptions = mockHttpClient.post.mock.calls[0][1];
      expect(passedOptions.headers['If-Match']).toBe('W/"express-nested-etag"');
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

    // SAP response shapes below are hand-written, as in the test above; only OUR reaction to them is checked.
    const acceptedCancel = { data: { d: { results: [{ BillingDocument: '90000053', MessageType: 'S', Message: 'Document 90000053 has been saved.' }] } } };

    const invoiceRead = (over) => ({ data: { d: { BillingDocument: '31000112', BillingDocumentIsCancelled: false, AccountingTransferStatus: 'C', ...over } } });
    const notConfirmed = "SAP accepted the cancellation of billing document 31000112 (reversal document 90000053), but reading it back did not show it as cancelled, so it is NOT confirmed. Check it in SAP before trying again.";

    test('refuses to report success when every read-back still shows the invoice as not cancelled', async () => {
      mockHttpClient.post.mockResolvedValue(acceptedCancel);
      mockHttpClient.get.mockResolvedValue(invoiceRead());

      await expect(adapter.cancelBillingDocument({ billingDocument: '31000112' })).rejects.toMatchObject({ status: 502, message: notConfirmed, $sanitize: false });
      expect(mockHttpClient.get).toHaveBeenCalledTimes(3);
    });

    test('refuses to report success when no read-back succeeded', async () => {
      mockHttpClient.post.mockResolvedValue(acceptedCancel);
      mockHttpClient.get.mockRejectedValue(new Error('read-back unavailable'));

      await expect(adapter.cancelBillingDocument({ billingDocument: '31000112' })).rejects.toMatchObject({ status: 502, message: notConfirmed });
    });

    test('a later failed read does not turn into a confirmation', async () => {
      mockHttpClient.post.mockResolvedValue(acceptedCancel);
      mockHttpClient.get.mockResolvedValueOnce(invoiceRead()).mockRejectedValue(new Error('read-back unavailable'));

      await expect(adapter.cancelBillingDocument({ billingDocument: '31000112' })).rejects.toMatchObject({ status: 502 });
    });

    test('leaves the reversal document out of the warning when SAP named none', async () => {
      mockHttpClient.post.mockResolvedValue({ data: { d: { results: [{ MessageType: 'S', Message: 'Saved' }] } } });
      mockHttpClient.get.mockResolvedValue(invoiceRead());

      await expect(adapter.cancelBillingDocument({ billingDocument: '31000112' })).rejects.toThrow(/^SAP accepted the cancellation of billing document 31000112, but/);
    });

    test('accepts a read-back on a later attempt', async () => {
      mockHttpClient.post.mockResolvedValue(acceptedCancel);
      mockHttpClient.get.mockRejectedValueOnce(new Error('not yet')).mockResolvedValueOnce(invoiceRead({ BillingDocumentIsCancelled: true }));

      const res = await adapter.cancelBillingDocument({ billingDocument: '31000112' });

      expect(res.Success).toBe(true);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });

    test('treats accounting status E as cancelled and says so, as the cancel and release checks do', async () => {
      mockHttpClient.post.mockResolvedValue(acceptedCancel);
      mockHttpClient.get.mockResolvedValue(invoiceRead({ AccountingTransferStatus: 'E' }));

      const res = await adapter.cancelBillingDocument({ billingDocument: '31000112' });

      expect(res).toMatchObject({ BillingDocumentIsCancelled: true, AccountingTransferStatus: 'E', Success: true });
    });
  });
});
