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
  let mockRfc;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };
    mockRfc = {
      readTable: jest.fn(async (table, fields, where) => {
        if (table === 'KNVV') return [{ VKORG: '1000', VTWEG: '14', SPART: '00', LOEVM: '' }, { VKORG: '1000', VTWEG: '10', SPART: '52', LOEVM: '' }];
        if (table === 'T001W') return String(where).includes("'1110'") ? [{ WERKS: '1110' }] : [];
        return [];
      })
    };
    adapter = new CustomerReturnAdapter({ client: mockHttpClient, rfcClient: mockRfc });
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

  // Query parameters of the URL the adapter requested, decoded
  const requestedParams = () => new URL(mockHttpClient.get.mock.calls[0][0], 'http://sap.mock').searchParams;

  // Entity and field names in the value-help and list tests below are hand-written: no metadata for
  // SD_F2651_CRT_CREATE_SRV is in the repo, so the SAP shape is not proven. Only OUR URL and mapping are checked.
  describe('getCustomerReturns', () => {
    test('requests the given paging and filter, newest first, with the inline count', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: { d: { results: [] } } });

      await adapter.getCustomerReturns({ top: 10, skip: 0, filter: "SoldToParty eq '10082'" });

      const params = requestedParams();
      expect(params.get('$top')).toBe('10');
      expect(params.get('$skip')).toBe('0');
      expect(params.get('$filter')).toBe("SoldToParty eq '10082'");
      expect(params.get('$orderby')).toBe('CustomerReturn desc');
      expect(params.get('$inlinecount')).toBe('allpages');
    });

    test('reads the worklist entity and returns mapped rows with the count', async () => {
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
    test('fetches return reasons and maps ReturnsOrderReason_Text property', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { ReturnsOrderReason: '101', ReturnsOrderReason_Text: 'Poor quality' },
              { ReturnsOrderReason: '102', ReturnsOrderReason_Text: 'Damaged in transit' }
            ]
          }
        }
      });

      const res = await adapter.getReturnReasons();
      expect(res.length).toBe(2);
      expect(res[0].ReasonCode).toBe('101');
      expect(res[0].ReasonText).toBe('Poor quality');
    });

    test('falls back to SDDocumentReasonText if ReturnsOrderReason_Text is missing', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { ReturnsOrderReason: '004', SDDocumentReasonText: 'Customer recommendation' }
            ]
          }
        }
      });

      const res = await adapter.getReturnReasons();
      expect(res.length).toBe(1);
      expect(res[0].ReasonCode).toBe('004');
      expect(res[0].ReasonText).toBe('Customer recommendation');
    });
  });

  describe('getCustomers', () => {
    test('fetches customers from C_SoldToValueHelp and maps the rows', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { Customer: '10082', OrganizationBPName1: 'Bajaj Healthcare Limited', CityName: 'Mumbai' }
            ]
          }
        }
      });

      const res = await adapter.getCustomers({ search: 'Bajaj', top: 10 });
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('C_SoldToValueHelp'),
        expect.anything()
      );
      expect(res.length).toBe(1);
      expect(res[0].Customer).toBe('10082');
      expect(res[0].OrganizationBPName1).toBe('Bajaj Healthcare Limited');
    });

    test('searches number and name with the given top', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: { d: { results: [] } } });

      await adapter.getCustomers({ search: ' Bajaj ', top: 10 });

      const params = requestedParams();
      expect(params.get('$top')).toBe('10');
      expect(params.get('$filter')).toBe("substringof('Bajaj', Customer) or substringof('Bajaj', OrganizationBPName1)");
    });
  });

  describe('getMaterials', () => {
    test('fetches materials from I_MaterialStdVH and maps the rows', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { Material: '4000000001', Material_Text: 'X-265 Active' }
            ]
          }
        }
      });

      const res = await adapter.getMaterials({ search: '40000', top: 5 });
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('I_MaterialStdVH'),
        expect.anything()
      );
      expect(res.length).toBe(1);
      expect(res[0].Material).toBe('4000000001');
    });

    test('searches number and text with the given top', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: { d: { results: [] } } });

      await adapter.getMaterials({ search: '40000', top: 5 });

      const params = requestedParams();
      expect(params.get('$top')).toBe('5');
      expect(params.get('$filter')).toBe("substringof('40000', Material) or substringof('40000', Material_Text)");
    });
  });

  describe('getPlants', () => {
    test('fetches plants from I_AllwdPlantsPerSlsOrgVH', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { Plant: '1110', PlantName: 'Ascend Plant 1' },
              { Plant: '1110', PlantName: 'Ascend Plant 1' }, // duplicate to test deduplication
              { Plant: '1130', PlantName: 'Ascend Plant 2' }
            ]
          }
        }
      });

      const res = await adapter.getPlants();
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/I_AllwdPlantsPerSlsOrgVH'),
        expect.anything()
      );
      expect(res.length).toBe(2);
      expect(res[0].Plant).toBe('1110');
      expect(res[1].Plant).toBe('1130');
    });
  });

  describe('getDocumentTypes', () => {
    test('fetches document types from C_CustomerReturnTypeManageVH', async () => {
      mockHttpClient.get.mockResolvedValueOnce({
        data: {
          d: {
            results: [
              { CustomerReturnType: 'ZRET', CustomerReturnType_Text: 'Sales Return Order' }
            ]
          }
        }
      });

      const res = await adapter.getDocumentTypes();
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/C_CustomerReturnTypeManageVH'),
        expect.anything()
      );
      expect(res.length).toBe(1);
      expect(res[0].CustomerReturnType).toBe('ZRET');
    });
  });

  describe('getReferenceDocuments', () => {
    test('searches document number and sold-to with the given top, newest first', async () => {
      mockHttpClient.get.mockResolvedValueOnce({ data: { d: { results: [] } } });

      await adapter.getReferenceDocuments({ search: '31000007', top: 5 });

      const params = requestedParams();
      expect(params.get('$top')).toBe('5');
      expect(params.get('$orderby')).toBe('DocumentDate desc');
      expect(params.get('$filter')).toBe("substringof('31000007', ReferenceSDDocument) or substringof('31000007', SoldToParty)");
    });

    test('maps the eligible reference documents', async () => {
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

    test.each([
      ['Plant', { Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG' }] }, 'Plant for item M1'],
      ['OrderQuantity', { Items: [{ Material: 'M1', OrderQuantityUnit: 'KG', ProductionPlant: '1110' }] }, 'Order quantity for item M1'],
      ['OrderQuantityUnit', { Items: [{ Material: 'M1', OrderQuantity: 1, ProductionPlant: '1110' }] }, 'Order quantity unit for item M1'],
      ['Currency with a price', { Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110', UnitPrice: '5' }] }, 'Currency for the unit price of item M1'],
      ['SalesOrganization (partial sales area)', { Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }], DistributionChannel: '10', OrganizationDivision: '52' }, 'given together'],
      ['DistributionChannel (partial sales area)', { Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }], SalesOrganization: '1000', OrganizationDivision: '52' }, 'given together'],
      ['Division (partial sales area)', { Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }], SalesOrganization: '1000', DistributionChannel: '10' }, 'given together']
    ])('rejects a missing %s with 400 instead of assuming a default; nothing is posted', async (_what, extra, text) => {
      await expect(adapter.createCustomerReturn({ SoldToParty: '10082', ReturnsOrderReason: '101', ...extra })).rejects.toMatchObject({ code: 400, message: expect.stringContaining(text) });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    test('sales area comes from KNVV: a single maintained area is used without any request values', async () => {
      mockRfc.readTable.mockImplementation(async (table) => (table === 'KNVV' ? [{ VKORG: '1000', VTWEG: '14', SPART: '00', LOEVM: '' }] : table === 'T001W' ? [{ WERKS: '1110' }] : []));
      mockHttpClient.post.mockResolvedValueOnce({ data: { d: { SalesOrderID: '4500100', SalesOrderTypeCode: 'ZRET', DocumentCurrency: 'INR' } } });
      mockHttpClient.get.mockResolvedValueOnce({ data: { d: { CustomerReturn: '4500100', TransactionCurrency: 'INR' } } });
      await adapter.createCustomerReturn({ SoldToParty: '1120', ReturnsOrderReason: '101', Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }] });
      expect(mockHttpClient.post.mock.calls[0][1].data).toMatchObject({ SalesOrganization: '1000', DistributionChannel: '14', Division: '00' });
    });

    test('a requested sales area that KNVV does not hold for the customer is rejected with 400; nothing is posted', async () => {
      await expect(adapter.createCustomerReturn({ SoldToParty: '10082', ReturnsOrderReason: '101', SalesOrganization: '2000', DistributionChannel: '10', OrganizationDivision: '52', Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }] }))
        .rejects.toMatchObject({ code: 400, message: expect.stringContaining('not maintained for customer 10082') });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    test('a plant unknown to SAP (T001W) is rejected with 400; nothing is posted', async () => {
      await expect(adapter.createCustomerReturn({ SoldToParty: '10082', ReturnsOrderReason: '101', Items: [{ Material: 'M1', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '9999' }] }))
        .rejects.toMatchObject({ code: 400, message: expect.stringContaining('Plant 9999 does not exist in SAP (T001W)') });
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    test('rejects missing ReturnsOrderReason with 400', async () => {
      await expect(adapter.createCustomerReturn({ SoldToParty: '10082' })).rejects.toThrow(
        'ReturnsOrderReason is mandatory for Customer Return creation'
      );
    });

    test('creates customer return via LORD_ODATA_ORDER_SRV deep insert, confirms persistence via readback', async () => {
      // 1. Deep insert POST response
      mockHttpClient.post.mockResolvedValueOnce({
        data: {
          d: {
            SalesOrderID: '4500099',
            SalesOrderTypeCode: 'ZRET',
            SoldToPartyID: '10082',
            TotalAmount: '15000.00',
            DocumentCurrency: 'INR'
          }
        }
      });

      // 2. Readback GET response
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
        SalesOrganization: '1000',
        DistributionChannel: '10',
        OrganizationDivision: '52',
        Items: [
          {
            Material: '4000000001',
            OrderQuantity: 10,
            OrderQuantityUnit: 'KG',
            ProductionPlant: '1110'
          }
        ]
      };

      const res = await adapter.createCustomerReturn(payload);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV/HeaderSet',
        expect.objectContaining({
          data: expect.objectContaining({
            SalesOrderTypeCode: 'ZRET',
            SoldToPartyID: '10082',
            ItemSet: expect.arrayContaining([
              expect.objectContaining({ MaterialID: '4000000001', OrderQty: '10' })
            ])
          })
        }),
        expect.any(Object)
      );
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      expect(res.CustomerReturn).toBe('4500099');
      expect(res.Success).toBe(true);
      expect(res.TotalNetAmount).toBe(15000.00);
      expect(res.TransactionCurrency).toBe('INR');
      expect(res.Message).toContain('4500099 successfully created and verified');
    });

    describe('read-back of the created return', () => {
      const payload = {
        SoldToParty: '10082',
        ReturnsOrderReason: '101',
        SalesOrganization: '1000',
        DistributionChannel: '10',
        OrganizationDivision: '52',
        Items: [{ Material: '4000000001', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }]
      };
      const notConfirmed = {
        status: 502,
        code: 502,
        CustomerReturn: '4500099',
        name: 'PartialCustomerReturnError',
        $sanitize: false,
        message: 'SAP created customer return 4500099, but it could not be read back from SAP, so it is NOT confirmed. Check it in SAP before creating it again.'
      };
      const readBack = (CustomerReturn) => ({ data: { d: { CustomerReturn, TransactionCurrency: 'INR' } } });

      beforeEach(() => {
        mockHttpClient.post.mockResolvedValueOnce({ data: { d: { SalesOrderID: '4500099', DocumentCurrency: 'INR' } } });
      });

      test('answers not confirmed, naming the number, when every read-back failed, and posts once', async () => {
        mockHttpClient.get.mockRejectedValue(new Error('read-back unavailable'));

        await expect(adapter.createCustomerReturn(payload)).rejects.toMatchObject(notConfirmed);
        expect(mockHttpClient.get).toHaveBeenCalledTimes(3);
        expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
      });

      test('answers not confirmed when SAP does not find the return', async () => {
        mockHttpClient.get.mockRejectedValue(Object.assign(new Error('not found'), { response: { status: 404 } }));

        await expect(adapter.createCustomerReturn(payload)).rejects.toMatchObject(notConfirmed);
      });

      test('answers not confirmed when the read-back is a different return', async () => {
        mockHttpClient.get.mockResolvedValue(readBack('4500100'));

        await expect(adapter.createCustomerReturn(payload)).rejects.toMatchObject(notConfirmed);
      });

      test('accepts the same number with leading zeros', async () => {
        mockHttpClient.get.mockResolvedValue(readBack('0004500099'));

        const res = await adapter.createCustomerReturn(payload);

        expect(res).toMatchObject({ CustomerReturn: '4500099', Success: true });
        expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      });

      test('accepts a read-back on a later attempt', async () => {
        mockHttpClient.get.mockRejectedValueOnce(new Error('not yet')).mockResolvedValueOnce(readBack('4500099'));

        await expect(adapter.createCustomerReturn(payload)).resolves.toMatchObject({ Success: true });
      });
    });

    test('rejects when no items with material are provided', async () => {
      await expect(
        adapter.createCustomerReturn({ SoldToParty: '10082', ReturnsOrderReason: '101', Items: [] })
      ).rejects.toThrow('At least one line item with a Material is required');
    });

    test('throws 502 when SAP returns empty SalesOrderID / CustomerReturn number', async () => {
      mockHttpClient.post.mockResolvedValueOnce({
        data: {
          d: {
            SalesOrderID: ''
          }
        }
      });
      await expect(
        adapter.createCustomerReturn({
          SoldToParty: '10082',
          ReturnsOrderReason: '101',
          SalesOrganization: '1000',
          DistributionChannel: '10',
          OrganizationDivision: '52',
          Items: [{ Material: '4000000001', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1110' }]
        })
      ).rejects.toMatchObject({
        code: 502,
        message: expect.stringContaining('Sales Order / Customer Return number not returned')
      });
    });
  });
});
