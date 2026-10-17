jest.mock('../../../srv/integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter', () => ({
  getBillingDocuments: jest.fn(),
  getBillingDocument: jest.fn(),
  postBillingDocumentToAccounting: jest.fn(),
  cancelBillingDocument: jest.fn()
}));

const customerInvoiceAdapter = require('../../../srv/integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter');
const registerCustomerInvoiceHandlers = require('../../../srv/sd/customer-invoice/handlers/customerInvoice.handler');

function createMockService() {
  const handlers = {};
  const mockSrv = {
    on: (event, entity, handlerFn) => {
      if (!handlerFn) {
        handlers[event] = entity;
      } else {
        handlers[`${event}_${entity}`] = handlerFn;
      }
    }
  };
  registerCustomerInvoiceHandlers(mockSrv);
  return handlers;
}

describe('Unit: CustomerInvoiceService Handlers', () => {
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = createMockService();
  });

  describe('READ CustomerInvoices', () => {
    test('fetches invoices and applies paging', async () => {
      const mockInvoices = [
        { BillingDocument: '31000111', AccountingTransferStatus: 'C', BillingDocumentIsCancelled: false },
        { BillingDocument: '31000112', AccountingTransferStatus: '', BillingDocumentIsCancelled: false },
        { BillingDocument: '31000113', AccountingTransferStatus: '', BillingDocumentIsCancelled: true }
      ];
      customerInvoiceAdapter.getBillingDocuments.mockResolvedValue({ results: mockInvoices, count: 3 });

      const req = {
        query: { SELECT: { limit: { rows: { val: 2 } } } },
        error: jest.fn()
      };

      const res = await handlers['READ_CustomerInvoices'](req);
      expect(customerInvoiceAdapter.getBillingDocuments).toHaveBeenCalled();
      expect(res).toHaveLength(2);
      expect(res[0].BillingDocument).toBe('31000111');
      expect(res[1].BillingDocument).toBe('31000112');
    });

    test('filters by AccountingTransferStatus', async () => {
      const mockInvoices = [
        { BillingDocument: '31000111', AccountingTransferStatus: 'C' },
        { BillingDocument: '31000112', AccountingTransferStatus: 'A' }
      ];
      customerInvoiceAdapter.getBillingDocuments.mockResolvedValue({ results: mockInvoices, count: 2 });

      const req = {
        data: { AccountingTransferStatus: 'C' },
        query: {},
        error: jest.fn()
      };

      const res = await handlers['READ_CustomerInvoices'](req);
      expect(res).toHaveLength(1);
      expect(res[0].BillingDocument).toBe('31000111');
    });

    test('filters by AccountingTransferStatus NE C (Pending)', async () => {
      const mockInvoices = [
        { BillingDocument: '31000111', AccountingTransferStatus: 'C', BillingDocumentIsCancelled: false },
        { BillingDocument: '31000112', AccountingTransferStatus: '', BillingDocumentIsCancelled: false },
        { BillingDocument: '31000113', AccountingTransferStatus: 'A', BillingDocumentIsCancelled: false }
      ];
      customerInvoiceAdapter.getBillingDocuments.mockResolvedValue({ results: mockInvoices, count: 3 });

      const req = {
        _queryOptions: { $filter: "(AccountingTransferStatus ne 'C' and BillingDocumentIsCancelled eq false)", $count: 'true' },
        query: {},
        error: jest.fn()
      };

      const res = await handlers['READ_CustomerInvoices'](req);
      expect(res).toHaveLength(2);
      expect(res.$count).toBe(2);
      expect(res.map(i => i.BillingDocument)).toEqual(['31000112', '31000113']);
    });

    test('filters by contains in $filter', async () => {
      const mockInvoices = [
        { BillingDocument: '31000111', SoldToParty: '1000', SoldToPartyFullName: 'Alpha Corp', BillingDocumentType: 'F2' },
        { BillingDocument: '32000222', SoldToParty: '2000', SoldToPartyFullName: 'Beta Corp', BillingDocumentType: 'F2' }
      ];
      customerInvoiceAdapter.getBillingDocuments.mockResolvedValue({ results: mockInvoices, count: 2 });

      const req = {
        _queryOptions: { $filter: "contains(SoldToPartyFullName, 'Beta')", $count: 'true' },
        query: {},
        error: jest.fn()
      };

      const res = await handlers['READ_CustomerInvoices'](req);
      expect(res).toHaveLength(1);
      expect(res.$count).toBe(1);
      expect(res[0].BillingDocument).toBe('32000222');
    });
  });

  describe('getInvoiceMetrics', () => {
    test('calculates correct metrics counts', async () => {
      const mockInvoices = [
        { BillingDocument: '1', AccountingTransferStatus: 'C', BillingDocumentIsCancelled: false },
        { BillingDocument: '2', AccountingTransferStatus: 'C', BillingDocumentIsCancelled: false },
        { BillingDocument: '3', AccountingTransferStatus: '', BillingDocumentIsCancelled: false },
        { BillingDocument: '4', AccountingTransferStatus: 'A', BillingDocumentIsCancelled: true }
      ];
      customerInvoiceAdapter.getBillingDocuments.mockResolvedValue({ results: mockInvoices });

      const req = { error: jest.fn() };
      const metrics = await handlers['getInvoiceMetrics'](req);

      expect(metrics.totalInvoices).toBe(4);
      expect(metrics.transferredCount).toBe(2);
      expect(metrics.pendingAccountingCount).toBe(1);
      expect(metrics.cancelledCount).toBe(1);
    });
  });

  describe('releaseInvoiceToAccounting', () => {
    test('rejects missing BillingDocument with 400', async () => {
      const req = { data: {}, error: jest.fn((code, msg) => ({ code, msg })) };
      await handlers['releaseInvoiceToAccounting'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'BillingDocument is required to release invoice to accounting.');
    });

    test('rejects release of cancelled invoice with 400', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '31000113',
        BillingDocumentIsCancelled: true
      });

      const req = {
        data: { BillingDocument: '31000113' },
        error: jest.fn((code, msg) => ({ code, msg }))
      };

      await handlers['releaseInvoiceToAccounting'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Cannot release cancelled billing document 31000113 to accounting.');
      expect(customerInvoiceAdapter.postBillingDocumentToAccounting).not.toHaveBeenCalled();
    });

    test('returns early if already transferred to accounting', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '31000111',
        BillingDocumentIsCancelled: false,
        AccountingTransferStatus: 'C',
        AccountingDocument: '9000000100',
        FiscalYear: '2026'
      });

      const req = {
        data: { BillingDocument: '31000111' },
        error: jest.fn()
      };

      const res = await handlers['releaseInvoiceToAccounting'](req);
      expect(customerInvoiceAdapter.postBillingDocumentToAccounting).not.toHaveBeenCalled();
      expect(res.Success).toBe(true);
      expect(res.AccountingDocument).toBe('9000000100');
      expect(res.Message).toContain('already released to accounting');
    });

    test('rejects release of Pro Forma status D document with 400', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '34000001',
        BillingDocumentIsCancelled: false,
        AccountingTransferStatus: 'D'
      });

      const req = {
        data: { BillingDocument: '34000001' },
        error: jest.fn()
      };

      await handlers['releaseInvoiceToAccounting'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Status D'));
      expect(customerInvoiceAdapter.postBillingDocumentToAccounting).not.toHaveBeenCalled();
    });

    test('rejects release of cancelled status E document with 400', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '90000017',
        BillingDocumentIsCancelled: false,
        AccountingTransferStatus: 'E',
        SDDocumentCategory: 'N'
      });

      const req = {
        data: { BillingDocument: '90000017' },
        error: jest.fn()
      };

      await handlers['releaseInvoiceToAccounting'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Cannot release cancelled billing document'));
      expect(customerInvoiceAdapter.postBillingDocumentToAccounting).not.toHaveBeenCalled();
    });

    test('rejects release of posting blocked status A document with 400', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '31000055',
        BillingDocumentIsCancelled: false,
        AccountingTransferStatus: 'A'
      });

      const req = {
        data: { BillingDocument: '31000055' },
        error: jest.fn()
      };

      await handlers['releaseInvoiceToAccounting'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Status A'));
      expect(customerInvoiceAdapter.postBillingDocumentToAccounting).not.toHaveBeenCalled();
    });

    test('delegates to adapter when eligible', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '31000112',
        BillingDocumentIsCancelled: false,
        AccountingTransferStatus: ''
      });
      customerInvoiceAdapter.postBillingDocumentToAccounting.mockResolvedValue({
        BillingDocument: '31000112',
        AccountingDocument: '9000000101',
        FiscalYear: '2026',
        Success: true,
        Message: 'Transferred to Accounting.'
      });

      const req = {
        data: { BillingDocument: '31000112' },
        error: jest.fn()
      };

      const res = await handlers['releaseInvoiceToAccounting'](req);
      expect(customerInvoiceAdapter.postBillingDocumentToAccounting).toHaveBeenCalledWith(
        { billingDocument: '31000112' },
        req
      );
      expect(res.Success).toBe(true);
      expect(res.AccountingDocument).toBe('9000000101');
    });
  });

  describe('cancelBillingDocument', () => {
    test('rejects missing BillingDocument with 400', async () => {
      const req = { data: {}, error: jest.fn((code, msg) => ({ code, msg })) };
      await handlers['cancelBillingDocument'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'BillingDocument is required to cancel billing document.');
    });

    test('rejects already cancelled billing document with 400', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '31000112',
        BillingDocumentIsCancelled: true
      });

      const req = {
        data: { BillingDocument: '31000112' },
        error: jest.fn((code, msg) => ({ code, msg }))
      };

      await handlers['cancelBillingDocument'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Billing document 31000112 is already cancelled.');
      expect(customerInvoiceAdapter.cancelBillingDocument).not.toHaveBeenCalled();
    });

    test('delegates to adapter when eligible', async () => {
      customerInvoiceAdapter.getBillingDocument.mockResolvedValue({
        BillingDocument: '31000112',
        BillingDocumentIsCancelled: false
      });
      customerInvoiceAdapter.cancelBillingDocument.mockResolvedValue({
        BillingDocument: '31000112',
        CancellationDocument: '90000053',
        Success: true,
        Message: 'Document 90000053 saved.'
      });

      const req = {
        data: { BillingDocument: '31000112' },
        error: jest.fn()
      };

      const res = await handlers['cancelBillingDocument'](req);
      expect(customerInvoiceAdapter.cancelBillingDocument).toHaveBeenCalledWith(
        { billingDocument: '31000112' },
        req
      );
      expect(res.Success).toBe(true);
      expect(res.CancellationDocument).toBe('90000053');
    });
  });
});
