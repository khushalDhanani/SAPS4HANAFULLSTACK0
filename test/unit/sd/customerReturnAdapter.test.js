const {
  CustomerReturnAdapter,
  _formatReturnHeaderRow,
  _formatReturnItemRow,
  _parseODataV2Date,
  _cleanOptions
} = require('../../../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');

describe('Unit: CustomerReturnAdapter', () => {
  let adapter;
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };
    adapter = new CustomerReturnAdapter({ client: mockHttpClient });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Helper: _parseODataV2Date', () => {
    test('parses /Date(ms)/ format correctly', () => {
      const ms = 1753833600000;
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

  describe('Helper: _formatReturnHeaderRow', () => {
    test('normalizes raw SAP C_CustomerReturnOPg row', () => {
      const raw = {
        CustomerReturn: '4500009',
        CustomerReturnType: 'ZRET',
        CustomerReturnType_Text: 'Sales Return order',
        SoldToParty: '10082',
        SoldToPartyName: 'Bajaj Healthcare Limited',
        ReturnsOrderReason: '004',
        SDDocumentReasonText: 'Customer recommendation',
        ReferenceSDDocument: '31000007',
        ReferenceSDDocumentCategory: 'M',
        TotalNetAmount: '232100.00',
        TransactionCurrency: 'INR',
        CustomerReturnDate: '/Date(1753833600000)/'
      };

      const res = _formatReturnHeaderRow(raw);
      expect(res.CustomerReturn).toBe('4500009');
      expect(res.CustomerReturnType).toBe('ZRET');
      expect(res.SoldToParty).toBe('10082');
      expect(res.SoldToPartyName).toBe('Bajaj Healthcare Limited');
      expect(res.ReferenceSDDocument).toBe('31000007');
      expect(res.ReferenceSDDocumentCategory).toBe('M');
      expect(res.TotalNetAmount).toBe(232100.00);
      expect(res.TransactionCurrency).toBe('INR');
      expect(res.CustomerReturnDate).toBe(new Date(1753833600000).toISOString().slice(0, 10));
    });

    test('returns null for null row', () => {
      expect(_formatReturnHeaderRow(null)).toBeNull();
    });
  });

  describe('Helper: _formatReturnItemRow', () => {
    test('normalizes raw SAP C_CustomerReturnItemOPg row', () => {
      const raw = {
        CustomerReturn: '4500009',
        CustomerReturnItem: '10',
        Material: '4000000001',
        Material_Text: 'X-265',
        OrderQuantity: '100.000',
        OrderQuantityUnit: 'KG',
        NetAmount: '232100.00',
        Currency: 'INR',
        ProductionPlant: '1110',
        StorageLocation: 'FG01',
        GoodsMovementType: '655'
      };

      const res = _formatReturnItemRow(raw);
      expect(res.CustomerReturn).toBe('4500009');
      expect(res.CustomerReturnItem).toBe('10');
      expect(res.Material).toBe('4000000001');
      expect(res.OrderQuantity).toBe(100.000);
      expect(res.NetAmount).toBe(232100.00);
      expect(res.GoodsMovementType).toBe('655');
    });

    test('returns null for null row', () => {
      expect(_formatReturnItemRow(null)).toBeNull();
    });
  });

  describe('Helper: _cleanOptions', () => {
    test('strips authorization header to avoid S/4 basic auth override', () => {
      const opts = {
        headers: {
          authorization: 'Bearer client-token',
          Authorization: 'Bearer client-token',
          'x-custom': 'val'
        }
      };
      const cleaned = _cleanOptions(opts);
      expect(cleaned.headers.authorization).toBeUndefined();
      expect(cleaned.headers.Authorization).toBeUndefined();
      expect(cleaned.headers['x-custom']).toBe('val');
    });
  });

  describe('getCustomerReturns', () => {
    test('calls SAP Gateway with pagination and filters', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              {
                CustomerReturn: '4500009',
                CustomerReturnType: 'ZRET',
                SoldToParty: '10082',
                TotalNetAmount: '232100.00',
                TransactionCurrency: 'INR'
              }
            ],
            __count: '1'
          }
        }
      });

      const res = await adapter.getCustomerReturns({ top: 10, skip: 0, filter: "SoldToParty eq '10082'" });
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/sap/opu/odata/sap/SD_F2651_CRT_CREATE_SRV/C_CustomerReturnOPg?'),
        expect.any(Object)
      );
      expect(res.results.length).toBe(1);
      expect(res.results[0].CustomerReturn).toBe('4500009');
      expect(res.count).toBe(1);
    });
  });

  describe('getCustomerReturn', () => {
    test('fetches single customer return header by key', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            CustomerReturn: '4500009',
            CustomerReturnType: 'ZRET',
            SoldToParty: '10082',
            TotalNetAmount: '232100.00',
            TransactionCurrency: 'INR'
          }
        }
      });

      const res = await adapter.getCustomerReturn('4500009');
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        '/sap/opu/odata/sap/SD_F2651_CRT_CREATE_SRV/C_CustomerReturnOPg(\'4500009\')',
        expect.any(Object)
      );
      expect(res.CustomerReturn).toBe('4500009');
    });

    test('throws 400 when document number is empty', async () => {
      await expect(adapter.getCustomerReturn('')).rejects.toThrow('Customer Return document number is required');
    });

    test('returns null when SAP responds with 404', async () => {
      const notFoundErr = new Error('Not found');
      notFoundErr.response = { status: 404 };
      mockHttpClient.get.mockRejectedValueOnce(notFoundErr);

      const res = await adapter.getCustomerReturn('9999999');
      expect(res).toBeNull();
    });
  });

  describe('getCustomerReturnItems', () => {
    test('fetches items filtered by CustomerReturn', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              {
                CustomerReturn: '4500009',
                CustomerReturnItem: '10',
                Material: '4000000001',
                OrderQuantity: '100.000',
                OrderQuantityUnit: 'KG'
              }
            ]
          }
        }
      });

      const res = await adapter.getCustomerReturnItems('4500009');
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('CustomerReturn eq \'4500009\''),
        expect.any(Object)
      );
      expect(res.length).toBe(1);
      expect(res[0].CustomerReturnItem).toBe('10');
    });

    test('returns empty array if return number is missing', async () => {
      const res = await adapter.getCustomerReturnItems('');
      expect(res).toEqual([]);
    });
  });

  describe('getReturnReasons', () => {
    test('fetches return reasons value help', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { ReturnsOrderReason: '101', SDDocumentReasonText: 'Poor quality' },
              { ReturnsOrderReason: '102', SDDocumentReasonText: 'Damaged in transit' }
            ]
          }
        }
      });

      const res = await adapter.getReturnReasons();
      expect(res.length).toBe(2);
      expect(res[0].ReasonCode).toBe('101');
      expect(res[0].ReasonText).toBe('Poor quality');
    });
  });

  describe('getReferenceDocuments', () => {
    test('fetches eligible reference documents with search', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              {
                ReferenceSDDocument: '31000007',
                SDDocumentCategory: 'M',
                SDDocumentCategoryName: 'Invoice',
                SoldToParty: '10082',
                DocumentDate: '/Date(1753833600000)/'
              }
            ]
          }
        }
      });

      const res = await adapter.getReferenceDocuments({ search: '31000007', top: 5 });
      expect(res.length).toBe(1);
      expect(res[0].ReferenceSDDocument).toBe('31000007');
      expect(res[0].SDDocumentCategory).toBe('M');
    });
  });

  describe('createCustomerReturn', () => {
    test('rejects missing SoldToParty with 400', async () => {
      await expect(adapter.createCustomerReturn({ ReturnsOrderReason: '101' })).rejects.toThrow(
        'SoldToParty is mandatory for Customer Return creation'
      );
    });

    test('rejects missing ReturnsOrderReason with 400', async () => {
      await expect(adapter.createCustomerReturn({ SoldToParty: '10082' })).rejects.toThrow(
        'ReturnsOrderReason is mandatory for Customer Return creation'
      );
    });

    test('creates header and item, confirms persistence via readback', async () => {
      // 1. Header POST response
      mockHttpClient.post.mockResolvedValueOnce({
        data: {
          d: {
            CustomerReturn: '4500099',
            CustomerReturnType: 'ZRET',
            SoldToParty: '10082',
            TotalNetAmount: '15000.00',
            TransactionCurrency: 'INR'
          }
        }
      });

      // 2. Item POST response
      mockHttpClient.post.mockResolvedValueOnce({
        data: {
          d: {
            CustomerReturn: '4500099',
            CustomerReturnItem: '10'
          }
        }
      });

      // 3. Readback GET response
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            CustomerReturn: '4500099',
            CustomerReturnType: 'ZRET',
            SoldToParty: '10082',
            TotalNetAmount: '15000.00',
            TransactionCurrency: 'INR'
          }
        }
      });

      const payload = {
        SoldToParty: '10082',
        ReturnsOrderReason: '101',
        ReferenceSDDocument: '31000007',
        ReferenceSDDocumentCategory: 'M',
        Items: [
          {
            Material: '4000000001',
            OrderQuantity: 10,
            OrderQuantityUnit: 'KG'
          }
        ]
      };

      const res = await adapter.createCustomerReturn(payload);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      expect(res.CustomerReturn).toBe('4500099');
      expect(res.Success).toBe(true);
      expect(res.TotalNetAmount).toBe(15000.00);
      expect(res.TransactionCurrency).toBe('INR');
      expect(res.Message).toContain('4500099 successfully created and verified');
    });
  });
});
